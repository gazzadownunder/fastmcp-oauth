/**
 * Filesystem Delegation Example
 *
 * This example demonstrates how to create a delegation module that provides
 * secure file system access with user-specific permissions.
 *
 * Use Case: Delegate MCP tool calls to filesystem operations with user impersonation
 *
 * Features:
 * - Path validation and sanitization
 * - User-specific directory restrictions
 * - Read/write/delete operations
 * - File metadata retrieval
 * - Cross-platform support (Windows/Linux)
 *
 * Security:
 * - Path traversal prevention
 * - Whitelist-based directory access
 * - User-based permission enforcement
 * - Audit logging for all operations
 */

import type { DelegationModule, DelegationResult } from '../src/delegation/base.js';
import type { UserSession, AuditEntry } from '../src/core/index.js';
import type { CoreContext } from '../src/core/types.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync, statSync } from 'fs';

/**
 * Filesystem delegation module configuration
 */
export interface FilesystemDelegationConfig {
  baseDirectory: string;               // Base directory for all operations
  allowedPaths?: string[];             // Whitelist of allowed subdirectories
  maxFileSize?: number;                // Maximum file size in bytes
  allowedExtensions?: string[];        // Whitelist of file extensions
  userDirectories?: boolean;           // Enable per-user directories (e.g., /users/{userId})
  readOnly?: boolean;                  // Read-only mode (no writes/deletes)
}

/**
 * File operation request types
 */
export interface FileReadRequest {
  path: string;
  encoding?: 'utf8' | 'binary';
}

export interface FileWriteRequest {
  path: string;
  content: string;
  encoding?: 'utf8' | 'binary';
  overwrite?: boolean;
}

export interface FileDeleteRequest {
  path: string;
  recursive?: boolean;
}

export interface FileListRequest {
  path: string;
  recursive?: boolean;
  includeHidden?: boolean;
}

export interface FileMetadata {
  name: string;
  path: string;
  size: number;
  isDirectory: boolean;
  isFile: boolean;
  created: Date;
  modified: Date;
  permissions?: string;
}

/**
 * Filesystem Delegation Module
 *
 * Provides secure filesystem access with user-based permission enforcement.
 */
export class FilesystemDelegationModule implements DelegationModule {
  readonly name = 'filesystem';
  readonly type = 'storage';

  private config: FilesystemDelegationConfig | null = null;

  async initialize(config: FilesystemDelegationConfig): Promise<void> {
    if (!config.baseDirectory) {
      throw new Error('Base directory is required');
    }

    // Validate base directory exists
    if (!existsSync(config.baseDirectory)) {
      throw new Error(`Base directory does not exist: ${config.baseDirectory}`);
    }

    // Resolve to absolute path
    const absolutePath = path.resolve(config.baseDirectory);

    this.config = {
      maxFileSize: 10 * 1024 * 1024, // Default 10MB
      userDirectories: false,
      readOnly: false,
      ...config,
      baseDirectory: absolutePath,
    };

    console.log(`[FilesystemDelegation] Initialized with base: ${absolutePath}`);
    console.log(`[FilesystemDelegation] Read-only mode: ${this.config.readOnly}`);
  }

  async delegate<T>(
    session: UserSession,
    action: string,
    params: any,
    context?: { sessionId?: string; coreContext?: CoreContext }
  ): Promise<DelegationResult<T>> {
    const auditEntry: AuditEntry = {
      timestamp: new Date(),
      source: 'delegation:filesystem',
      userId: session.userId,
      action: `filesystem:${action}`,
      success: false,
    };

    try {
      if (!this.config) {
        throw new Error('FilesystemDelegationModule not initialized');
      }

      let result: T;

      switch (action) {
        case 'read':
          result = await this.readFile(session, params as FileReadRequest) as T;
          break;

        case 'write':
          if (this.config.readOnly) {
            throw new Error('Filesystem is in read-only mode');
          }
          result = await this.writeFile(session, params as FileWriteRequest) as T;
          break;

        case 'delete':
          if (this.config.readOnly) {
            throw new Error('Filesystem is in read-only mode');
          }
          result = await this.deleteFile(session, params as FileDeleteRequest) as T;
          break;

        case 'list':
          result = await this.listFiles(session, params as FileListRequest) as T;
          break;

        case 'metadata':
          result = await this.getMetadata(session, params.path) as T;
          break;

        case 'exists':
          result = await this.fileExists(session, params.path) as T;
          break;

        default:
          throw new Error(`Unknown filesystem action: ${action}`);
      }

      auditEntry.success = true;
      auditEntry.metadata = {
        action,
        path: params.path,
      };

      return {
        success: true,
        data: result,
        auditTrail: auditEntry,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown filesystem error';
      auditEntry.error = errorMessage;

      return {
        success: false,
        error: errorMessage,
        auditTrail: auditEntry,
      };
    }
  }

  /**
   * Validate and resolve file path
   */
  private validatePath(session: UserSession, requestedPath: string): string {
    if (!this.config) {
      throw new Error('FilesystemDelegationModule not initialized');
    }

    // Sanitize path (remove null bytes, etc.)
    const sanitized = requestedPath.replace(/\0/g, '');

    // Build full path
    let basePath = this.config.baseDirectory;

    // If user directories enabled, scope to user's directory
    if (this.config.userDirectories) {
      basePath = path.join(basePath, 'users', session.userId);
    }

    const fullPath = path.resolve(basePath, sanitized);

    // Prevent path traversal attacks
    if (!fullPath.startsWith(basePath)) {
      throw new Error('Access denied: Path traversal detected');
    }

    // Check against whitelist
    if (this.config.allowedPaths && this.config.allowedPaths.length > 0) {
      const isAllowed = this.config.allowedPaths.some(allowedPath => {
        const allowedFullPath = path.resolve(basePath, allowedPath);
        return fullPath.startsWith(allowedFullPath);
      });

      if (!isAllowed) {
        throw new Error('Access denied: Path not in whitelist');
      }
    }

    // Check file extension
    if (this.config.allowedExtensions && this.config.allowedExtensions.length > 0) {
      const ext = path.extname(fullPath).toLowerCase();
      if (ext && !this.config.allowedExtensions.includes(ext)) {
        throw new Error(`Access denied: File extension ${ext} not allowed`);
      }
    }

    return fullPath;
  }

  /**
   * Read file contents
   */
  private async readFile(session: UserSession, request: FileReadRequest): Promise<{ content: string; size: number }> {
    const fullPath = this.validatePath(session, request.path);

    // Check file exists
    if (!existsSync(fullPath)) {
      throw new Error(`File not found: ${request.path}`);
    }

    // Check it's a file
    const stats = statSync(fullPath);
    if (!stats.isFile()) {
      throw new Error(`Path is not a file: ${request.path}`);
    }

    // Check file size
    if (this.config && this.config.maxFileSize && stats.size > this.config.maxFileSize) {
      throw new Error(`File too large: ${stats.size} bytes (max: ${this.config.maxFileSize})`);
    }

    // Read file
    const content = await fs.readFile(fullPath, request.encoding || 'utf8');

    return {
      content: content.toString(),
      size: stats.size,
    };
  }

  /**
   * Write file contents
   */
  private async writeFile(session: UserSession, request: FileWriteRequest): Promise<{ success: boolean; path: string }> {
    const fullPath = this.validatePath(session, request.path);

    // Check if file exists and overwrite not allowed
    if (existsSync(fullPath) && !request.overwrite) {
      throw new Error(`File already exists: ${request.path}`);
    }

    // Check content size
    const contentSize = Buffer.byteLength(request.content, request.encoding || 'utf8');
    if (this.config && this.config.maxFileSize && contentSize > this.config.maxFileSize) {
      throw new Error(`Content too large: ${contentSize} bytes (max: ${this.config.maxFileSize})`);
    }

    // Ensure directory exists
    const directory = path.dirname(fullPath);
    await fs.mkdir(directory, { recursive: true });

    // Write file
    await fs.writeFile(fullPath, request.content, request.encoding || 'utf8');

    return {
      success: true,
      path: request.path,
    };
  }

  /**
   * Delete file or directory
   */
  private async deleteFile(session: UserSession, request: FileDeleteRequest): Promise<{ success: boolean }> {
    const fullPath = this.validatePath(session, request.path);

    // Check exists
    if (!existsSync(fullPath)) {
      throw new Error(`Path not found: ${request.path}`);
    }

    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      if (!request.recursive) {
        throw new Error('Cannot delete directory without recursive flag');
      }
      await fs.rm(fullPath, { recursive: true, force: true });
    } else {
      await fs.unlink(fullPath);
    }

    return { success: true };
  }

  /**
   * List files in directory
   */
  private async listFiles(session: UserSession, request: FileListRequest): Promise<FileMetadata[]> {
    const fullPath = this.validatePath(session, request.path);

    // Check exists and is directory
    if (!existsSync(fullPath)) {
      throw new Error(`Directory not found: ${request.path}`);
    }

    const stats = statSync(fullPath);
    if (!stats.isDirectory()) {
      throw new Error(`Path is not a directory: ${request.path}`);
    }

    const entries: FileMetadata[] = [];

    if (request.recursive) {
      // Recursive listing
      await this.listRecursive(fullPath, request.path, entries, request.includeHidden || false);
    } else {
      // Single level
      const files = await fs.readdir(fullPath);

      for (const file of files) {
        if (!request.includeHidden && file.startsWith('.')) {
          continue;
        }

        const filePath = path.join(fullPath, file);
        const fileStats = statSync(filePath);

        entries.push({
          name: file,
          path: path.join(request.path, file),
          size: fileStats.size,
          isDirectory: fileStats.isDirectory(),
          isFile: fileStats.isFile(),
          created: fileStats.birthtime,
          modified: fileStats.mtime,
        });
      }
    }

    return entries;
  }

  /**
   * Recursive directory listing helper
   */
  private async listRecursive(
    fullPath: string,
    relativePath: string,
    entries: FileMetadata[],
    includeHidden: boolean
  ): Promise<void> {
    const files = await fs.readdir(fullPath);

    for (const file of files) {
      if (!includeHidden && file.startsWith('.')) {
        continue;
      }

      const filePath = path.join(fullPath, file);
      const fileRelativePath = path.join(relativePath, file);
      const stats = statSync(filePath);

      entries.push({
        name: file,
        path: fileRelativePath,
        size: stats.size,
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
        created: stats.birthtime,
        modified: stats.mtime,
      });

      if (stats.isDirectory()) {
        await this.listRecursive(filePath, fileRelativePath, entries, includeHidden);
      }
    }
  }

  /**
   * Get file/directory metadata
   */
  private async getMetadata(session: UserSession, requestedPath: string): Promise<FileMetadata> {
    const fullPath = this.validatePath(session, requestedPath);

    if (!existsSync(fullPath)) {
      throw new Error(`Path not found: ${requestedPath}`);
    }

    const stats = statSync(fullPath);

    return {
      name: path.basename(fullPath),
      path: requestedPath,
      size: stats.size,
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
      created: stats.birthtime,
      modified: stats.mtime,
    };
  }

  /**
   * Check if file exists
   */
  private async fileExists(session: UserSession, requestedPath: string): Promise<{ exists: boolean }> {
    try {
      const fullPath = this.validatePath(session, requestedPath);
      return { exists: existsSync(fullPath) };
    } catch {
      return { exists: false };
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.config) {
      return false;
    }

    try {
      // Check base directory is accessible
      const stats = statSync(this.config.baseDirectory);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  async destroy(): Promise<void> {
    this.config = null;
    console.log(`[FilesystemDelegation] Destroyed`);
  }
}

/**
 * Example Usage
 */

/*
import { createDelegationTool } from '../src/mcp/tools/delegation-tool-factory.js';
import { z } from 'zod';

// 1. Create and initialize filesystem delegation module
const fsModule = new FilesystemDelegationModule();
await fsModule.initialize({
  baseDirectory: '/var/app/data',
  allowedPaths: ['documents', 'reports', 'uploads'],
  maxFileSize: 10 * 1024 * 1024, // 10MB
  allowedExtensions: ['.txt', '.json', '.csv', '.pdf'],
  userDirectories: true, // Each user gets /var/app/data/users/{userId}/
  readOnly: false,
});

// 2. Register module
const coreContext = server.getCoreContext();
coreContext.delegationRegistry.register(fsModule);

// 3. Create tools

// Read file
const readFileTool = createDelegationTool('filesystem', {
  name: 'fs-read-file',
  description: 'Read file contents',

  parameters: z.object({
    path: z.string().describe('File path relative to user directory'),
    encoding: z.enum(['utf8', 'binary']).default('utf8'),
  }),

  action: 'read',
  requiredPermission: 'fs:read',

  transformParams: (params) => ({
    path: params.path,
    encoding: params.encoding,
  }),

  transformResult: (result: any) => ({
    content: result.content,
    size: result.size,
  }),
}, coreContext);

// Write file
const writeFileTool = createDelegationTool('filesystem', {
  name: 'fs-write-file',
  description: 'Write content to file',

  parameters: z.object({
    path: z.string().describe('File path'),
    content: z.string().describe('File content'),
    overwrite: z.boolean().default(false),
  }),

  action: 'write',
  requiredPermission: 'fs:write',

  transformParams: (params) => ({
    path: params.path,
    content: params.content,
    overwrite: params.overwrite,
  }),

  transformResult: (result: any) => result,
}, coreContext);

// List directory
const listDirectoryTool = createDelegationTool('filesystem', {
  name: 'fs-list-directory',
  description: 'List files in directory',

  parameters: z.object({
    path: z.string().default('.').describe('Directory path'),
    recursive: z.boolean().default(false),
  }),

  action: 'list',
  requiredPermission: 'fs:read',

  transformParams: (params) => ({
    path: params.path,
    recursive: params.recursive,
    includeHidden: false,
  }),

  transformResult: (files: FileMetadata[]) => ({
    files: files.map(f => ({
      name: f.name,
      path: f.path,
      type: f.isDirectory ? 'directory' : 'file',
      size: f.size,
      modified: f.modified,
    })),
    count: files.length,
  }),
}, coreContext);

// Delete file
const deleteFileTool = createDelegationTool('filesystem', {
  name: 'fs-delete-file',
  description: 'Delete file or directory',

  parameters: z.object({
    path: z.string().describe('Path to delete'),
    recursive: z.boolean().default(false),
  }),

  action: 'delete',
  requiredPermission: 'fs:delete',
  requiredRoles: ['admin', 'user'],

  transformParams: (params) => ({
    path: params.path,
    recursive: params.recursive,
  }),

  transformResult: (result: any) => result,
}, coreContext);

// 4. Register tools
server.registerTools([
  readFileTool,
  writeFileTool,
  listDirectoryTool,
  deleteFileTool,
]);

console.log('Filesystem delegation tools registered successfully');

// Security best practices:
// 1. Always use userDirectories for multi-user scenarios
// 2. Set allowedPaths whitelist to restrict access
// 3. Limit file sizes with maxFileSize
// 4. Use allowedExtensions to prevent executable uploads
// 5. Enable read-only mode for sensitive directories
// 6. Audit all operations via audit logging
// 7. Validate paths to prevent directory traversal
// 8. Use HTTPS for file uploads in production
*/
