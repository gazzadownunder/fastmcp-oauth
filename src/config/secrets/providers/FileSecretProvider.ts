/**
 * File-Based Secret Provider
 *
 * Resolves secrets from files on the filesystem. This is the RECOMMENDED provider for production
 * environments (Kubernetes secret mounts, Docker secrets, etc.).
 *
 * Security Benefits:
 * - Secrets never exposed in process.env (prevents accidental logging)
 * - File permissions can be restricted (e.g., 0400 read-only)
 * - More secure than environment variables for production
 * - Supports in-memory file systems (tmpfs, ramfs)
 *
 * Usage:
 * ```typescript
 * // Kubernetes mounts secrets to /run/secrets/
 * const provider = new FileSecretProvider('/run/secrets');
 * const password = await provider.resolve('DB_PASSWORD');
 * // Reads from /run/secrets/DB_PASSWORD
 * ```
 *
 * @see Docs/SECRETS-MANAGEMENT.md
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { ISecretProvider } from '../ISecretProvider.js';

/**
 * Resolves secrets from files on the file system
 *
 * This is the recommended provider for production (e.g., from Docker/Kubernetes secret mounts).
 */
export class FileSecretProvider implements ISecretProvider {
  private readonly secretDir: string;

  /**
   * Creates a new FileSecretProvider
   *
   * @param secretDir - The directory to search for secret files (e.g., "/run/secrets/")
   *                    Defaults to "/run/secrets" (standard for Docker/Kubernetes)
   */
  constructor(secretDir: string = '/run/secrets') {
    this.secretDir = secretDir;
  }

  /**
   * Attempts to resolve a secret from a file
   *
   * Reads the file at `{secretDir}/{logicalName}` and returns its contents (trimmed).
   * Returns undefined if the file doesn't exist or cannot be read.
   *
   * Security Notes:
   * - Validates that resolved path stays within secretDir (prevents path traversal)
   * - Rejects paths containing '..' or starting with '/'
   * - File permissions should be set to 0400 (read-only) in production
   *
   * @param logicalName - The logical name of the secret (e.g., "DB_PASSWORD")
   * @returns The secret string (trimmed), or undefined if not found
   */
  public async resolve(logicalName: string): Promise<string | undefined> {
    // Security: Prevent path traversal attacks
    // Reject any path containing '..' or starting with '/'
    if (logicalName.includes('..') || logicalName.startsWith('/')) {
      return undefined;
    }

    // Construct file path
    const filePath = path.join(this.secretDir, logicalName);

    // Security: Verify resolved path is still within secretDir
    const normalizedSecretDir = path.resolve(this.secretDir);
    const normalizedFilePath = path.resolve(filePath);

    if (!normalizedFilePath.startsWith(normalizedSecretDir + path.sep)) {
      // Path escaped secretDir boundary - reject
      return undefined;
    }

    try {
      // Read file contents
      const secretValue = await fs.readFile(filePath, 'utf-8');

      // Trim whitespace (files often have trailing newlines from echo/heredoc)
      return secretValue.trim();
    } catch (error: any) {
      // Expected errors when file doesn't exist or isn't readable
      if (error.code === 'ENOENT' || error.code === 'EACCES') {
        // File not found or permission denied - return undefined to try next provider
        return undefined;
      }

      // Unexpected error - log warning but still return undefined (fail gracefully)
      console.warn(`[FileSecretProvider] Unexpected error reading ${filePath}: ${error.message}`);
      return undefined;
    }
  }

  /**
   * Get the configured secret directory
   *
   * @returns The secret directory path
   */
  public getSecretDir(): string {
    return this.secretDir;
  }
}
