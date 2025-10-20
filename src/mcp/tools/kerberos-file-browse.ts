/**
 * Kerberos File Browsing Tools
 *
 * Provides MCP tools for browsing Windows file shares using Kerberos authentication.
 * Supports SMB/CIFS access with S4U2Proxy delegation.
 *
 * Tools:
 * - list-directory: List files and folders in a directory
 * - read-file: Read file contents with Kerberos authentication
 * - file-info: Get detailed file/folder information
 *
 * @module mcp/tools/kerberos-file-browse
 */

import { z } from 'zod';
import type { CoreContext } from '../../core/types.js';
import type { MCPContext, LLMResponse, ToolFactory } from '../types.js';
import { Authorization } from '../authorization.js';
import { OAuthSecurityError } from '../../utils/errors.js';
import { handleToolError } from '../utils/error-helpers.js';
import { promises as fs } from 'fs';
import { join, parse, sep } from 'path';

// ============================================================================
// Zod Schemas
// ============================================================================

const ListDirectorySchema = z.object({
  path: z.string().describe('SMB path to list (e.g., //192.168.1.25/share/folder or \\\\fileserver\\share\\folder)'),
  includeHidden: z.boolean().default(false).optional().describe('Include hidden files and folders'),
});

const ReadFileSchema = z.object({
  path: z.string().describe('SMB path to file (e.g., //192.168.1.25/share/file.txt)'),
  encoding: z.enum(['utf8', 'ascii', 'base64', 'hex', 'binary']).default('utf8').optional().describe('File encoding'),
  maxBytes: z.number().max(10485760).default(1048576).optional().describe('Maximum bytes to read (default: 1MB, max: 10MB)'),
});

const FileInfoSchema = z.object({
  path: z.string().describe('SMB path to file or folder (e.g., //192.168.1.25/share/file.txt)'),
});

type ListDirectoryParams = z.infer<typeof ListDirectorySchema>;
type ReadFileParams = z.infer<typeof ReadFileSchema>;
type FileInfoParams = z.infer<typeof FileInfoSchema>;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * SMB path format: \\server\share\path or //server/share/path
 */
function parseSMBPath(smbPath: string): {
  server: string;
  share: string;
  path: string;
  spn: string;
} {
  // Normalize path separators
  const normalized = smbPath.replace(/\\/g, '/').replace(/^\/\//, '');
  const parts = normalized.split('/');

  if (parts.length < 2) {
    throw new Error(
      'Invalid SMB path format. Expected: //server/share/path or \\\\server\\share\\path'
    );
  }

  const server = parts[0];
  const share = parts[1];
  const path = parts.slice(2).join(sep);
  const spn = `cifs/${server}`;

  return { server, share, path, spn };
}

/**
 * Convert SMB path to local UNC path for Windows file access
 */
function toUNCPath(server: string, share: string, path: string): string {
  const uncPath = `\\\\${server}\\${share}`;
  return path ? join(uncPath, path) : uncPath;
}

/**
 * List files and directories in a Windows file share
 */
export const createListDirectoryTool: ToolFactory = (context: CoreContext) => ({
  name: 'kerberos-list-directory',
  description:
    'List files and folders in a Windows file share using Kerberos authentication. Uses token exchange to obtain legacy_username for delegation.',
  schema: ListDirectorySchema,

  canAccess: (mcpContext: MCPContext) => {
    const auth = new Authorization();
    return auth.isAuthenticated(mcpContext);
  },

  handler: async (params: ListDirectoryParams, mcpContext: MCPContext): Promise<LLMResponse> => {
    const auth = new Authorization();
      try {
        // Validate authentication
        auth.requireAuth(mcpContext);

        // NOTE: We do NOT check for legacy_username in requestor JWT here
        // The KerberosDelegationModule will perform token exchange to obtain
        // a delegation JWT containing the legacy_name claim

        // Parse SMB path
        const { server, share, path, spn } = parseSMBPath(params.path);

        // Check if Kerberos delegation module is available
        if (!context.delegationRegistry) {
          throw new Error('Delegation registry not available');
        }

        const kerberosModule = context.delegationRegistry.get('kerberos');
        if (!kerberosModule) {
          throw new Error(
            'Kerberos delegation module not available. Check server configuration.'
          );
        }

        // Obtain Kerberos proxy ticket for target file server
        // The delegation module will perform token exchange to get legacy_name
        // and construct the userPrincipal automatically
        const ticketResult = await kerberosModule.delegate<any>(
          mcpContext.session,
          's4u2proxy',
          {
            targetSPN: spn,
          }
        );

        if (!ticketResult.success || !ticketResult.data) {
          const error = ticketResult.error || 'Failed to obtain Kerberos ticket';
          throw new Error(`Kerberos delegation failed: ${error}`);
        }

        // Convert to UNC path for Windows file access
        const uncPath = toUNCPath(server, share, path);

        // Read directory contents
        const entries = await fs.readdir(uncPath, { withFileTypes: true });

        // Filter hidden files if requested
        const filtered = params.includeHidden
          ? entries
          : entries.filter((entry) => !entry.name.startsWith('.'));

        // Build directory listing
        const listing = await Promise.all(
          filtered.map(async (entry) => {
            const fullPath = join(uncPath, entry.name);
            const stats = await fs.stat(fullPath).catch(() => null);

            return {
              name: entry.name,
              type: entry.isDirectory() ? 'directory' : 'file',
              size: stats?.size || 0,
              modified: stats?.mtime.toISOString() || null,
              hidden: entry.name.startsWith('.'),
            };
          })
        );

        // Log successful access
        context.auditService?.log({
          timestamp: new Date(),
          userId: mcpContext.session.userId,
          action: 'kerberos-list-directory',
          resource: params.path,
          success: true,
          metadata: {
            itemCount: listing.length,
            server,
            share,
            delegatedUser: mcpContext.session.legacyUsername,
          },
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  path: params.path,
                  server,
                  share,
                  itemCount: listing.length,
                  items: listing,
                  authenticatedAs: mcpContext.session.legacyUsername,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        // SECURITY (SEC-3): Handle security and non-security errors differently
        if (error instanceof OAuthSecurityError || (error as any).code) {
          // Security error: Return specific error code for user guidance
          const secError = error as OAuthSecurityError;
          return {
            status: 'failure',
            code: secError.code || 'INTERNAL_ERROR',
            message: secError.message,
          };
        }

        // SECURITY (SEC-3): Non-security error - mask technical details
        // Logs full error to audit, returns generic message to client
        const errorResponse = await handleToolError(
          error,
          'kerberos-list-directory',
          mcpContext,
          context.auditService,
          params
        );
        return errorResponse;
      }
  },
});

/**
 * Read file contents from Windows file share
 */
export const createReadFileTool: ToolFactory = (context: CoreContext) => ({
  name: 'kerberos-read-file',
  description:
    'Read file contents from a Windows file share using Kerberos authentication. Uses token exchange to obtain legacy_username for delegation.',
  schema: ReadFileSchema,

  canAccess: (mcpContext: MCPContext) => {
    const auth = new Authorization();
    return auth.isAuthenticated(mcpContext);
  },

  handler: async (params: ReadFileParams, mcpContext: MCPContext): Promise<LLMResponse> => {
    const auth = new Authorization();
      try {
        // Validate authentication
        auth.requireAuth(mcpContext);

        // NOTE: We do NOT check for legacy_username in requestor JWT here
        // The KerberosDelegationModule will perform token exchange to obtain
        // a delegation JWT containing the legacy_name claim

        // Parse SMB path
        const { server, share, path, spn } = parseSMBPath(params.path);

        // Check if Kerberos delegation module is available
        if (!context.delegationRegistry) {
          throw new Error('Delegation registry not available');
        }

        const kerberosModule = context.delegationRegistry.get('kerberos');
        if (!kerberosModule) {
          throw new Error(
            'Kerberos delegation module not available. Check server configuration.'
          );
        }

        // Obtain Kerberos proxy ticket
        // The delegation module will perform token exchange to get legacy_name
        const ticketResult = await kerberosModule.delegate<any>(
          mcpContext.session,
          's4u2proxy',
          {
            targetSPN: spn,
          }
        );

        if (!ticketResult.success || !ticketResult.data) {
          const error = ticketResult.error || 'Failed to obtain Kerberos ticket';
          throw new Error(`Kerberos delegation failed: ${error}`);
        }

        // Convert to UNC path
        const uncPath = toUNCPath(server, share, path);

        // Get file stats
        const stats = await fs.stat(uncPath);
        if (!stats.isFile()) {
          throw new Error(`Path is not a file: ${params.path}`);
        }

        // Check file size limit
        const maxBytes = params.maxBytes || 1048576;
        if (stats.size > maxBytes) {
          throw new Error(
            `File size (${stats.size} bytes) exceeds maximum allowed (${maxBytes} bytes)`
          );
        }

        // Read file contents
        const encoding = (params.encoding || 'utf8') as BufferEncoding;
        const contents = await fs.readFile(uncPath, { encoding });

        // Log successful access
        context.auditService?.log({
          timestamp: new Date(),
          userId: mcpContext.session.userId,
          action: 'kerberos-read-file',
          resource: params.path,
          success: true,
          metadata: {
            fileSize: stats.size,
            encoding,
            server,
            share,
            delegatedUser: mcpContext.session.legacyUsername,
          },
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  path: params.path,
                  server,
                  share,
                  size: stats.size,
                  encoding,
                  modified: stats.mtime.toISOString(),
                  contents,
                  authenticatedAs: mcpContext.session.legacyUsername,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        // SECURITY (SEC-3): Handle security and non-security errors differently
        if (error instanceof OAuthSecurityError || (error as any).code) {
          // Security error: Return specific error code for user guidance
          const secError = error as OAuthSecurityError;
          return {
            status: 'failure',
            code: secError.code || 'INTERNAL_ERROR',
            message: secError.message,
          };
        }

        // SECURITY (SEC-3): Non-security error - mask technical details
        // Logs full error to audit, returns generic message to client
        const errorResponse = await handleToolError(
          error,
          'kerberos-read-file',
          mcpContext,
          context.auditService,
          params
        );
        return errorResponse;
      }
  },
});

/**
 * Get detailed file/folder information
 */
export const createFileInfoTool: ToolFactory = (context: CoreContext) => ({
  name: 'kerberos-file-info',
  description:
    'Get detailed information about a file or folder in a Windows file share using Kerberos authentication. Uses token exchange to obtain legacy_username for delegation.',
  schema: FileInfoSchema,

  canAccess: (mcpContext: MCPContext) => {
    const auth = new Authorization();
    return auth.isAuthenticated(mcpContext);
  },

  handler: async (params: FileInfoParams, mcpContext: MCPContext): Promise<LLMResponse> => {
    const auth = new Authorization();
      try {
        // Validate authentication
        auth.requireAuth(mcpContext);

        // NOTE: We do NOT check for legacy_username in requestor JWT here
        // The KerberosDelegationModule will perform token exchange to obtain
        // a delegation JWT containing the legacy_name claim

        // Parse SMB path
        const { server, share, path, spn } = parseSMBPath(params.path);

        // Check if Kerberos delegation module is available
        if (!context.delegationRegistry) {
          throw new Error('Delegation registry not available');
        }

        const kerberosModule = context.delegationRegistry.get('kerberos');
        if (!kerberosModule) {
          throw new Error(
            'Kerberos delegation module not available. Check server configuration.'
          );
        }

        // Obtain Kerberos proxy ticket
        // The delegation module will perform token exchange to get legacy_name
        const ticketResult = await kerberosModule.delegate<any>(
          mcpContext.session,
          's4u2proxy',
          {
            targetSPN: spn,
          }
        );

        if (!ticketResult.success || !ticketResult.data) {
          const error = ticketResult.error || 'Failed to obtain Kerberos ticket';
          throw new Error(`Kerberos delegation failed: ${error}`);
        }

        // Convert to UNC path
        const uncPath = toUNCPath(server, share, path);

        // Get file/folder stats
        const stats = await fs.stat(uncPath);
        const parsed = parse(uncPath);

        const info = {
          path: params.path,
          server,
          share,
          name: parsed.base,
          type: stats.isDirectory() ? 'directory' : 'file',
          size: stats.size,
          created: stats.birthtime.toISOString(),
          modified: stats.mtime.toISOString(),
          accessed: stats.atime.toISOString(),
          isReadOnly: (stats.mode & 0o200) === 0,
          isHidden: parsed.base.startsWith('.'),
          permissions: {
            user: {
              read: (stats.mode & 0o400) !== 0,
              write: (stats.mode & 0o200) !== 0,
              execute: (stats.mode & 0o100) !== 0,
            },
            group: {
              read: (stats.mode & 0o040) !== 0,
              write: (stats.mode & 0o020) !== 0,
              execute: (stats.mode & 0o010) !== 0,
            },
            others: {
              read: (stats.mode & 0o004) !== 0,
              write: (stats.mode & 0o002) !== 0,
              execute: (stats.mode & 0o001) !== 0,
            },
          },
          authenticatedAs: mcpContext.session.legacyUsername,
        };

        // Log successful access
        context.auditService?.log({
          timestamp: new Date(),
          userId: mcpContext.session.userId,
          action: 'kerberos-file-info',
          resource: params.path,
          success: true,
          metadata: {
            type: info.type,
            size: info.size,
            server,
            share,
            delegatedUser: mcpContext.session.legacyUsername,
          },
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(info, null, 2),
            },
          ],
        };
      } catch (error) {
        // SECURITY (SEC-3): Handle security and non-security errors differently
        if (error instanceof OAuthSecurityError || (error as any).code) {
          // Security error: Return specific error code for user guidance
          const secError = error as OAuthSecurityError;
          return {
            status: 'failure',
            code: secError.code || 'INTERNAL_ERROR',
            message: secError.message,
          };
        }

        // SECURITY (SEC-3): Non-security error - mask technical details
        // Logs full error to audit, returns generic message to client
        const errorResponse = await handleToolError(
          error,
          'kerberos-file-info',
          mcpContext,
          context.auditService,
          params
        );
        return errorResponse;
      }
  },
});
