/**
 * Environment Variable Secret Provider
 *
 * Resolves secrets from environment variables (process.env).
 * This provider should be used as a FALLBACK after FileSecretProvider.
 *
 * Security Considerations:
 * - Environment variables are visible to all child processes
 * - May be accidentally logged in crash dumps or debug output
 * - Less secure than file-based secrets
 * - Recommended for development (.env files) and fallback only
 *
 * Usage:
 * ```typescript
 * // Development with .env file
 * import 'dotenv/config';  // Load .env into process.env
 * const provider = new EnvProvider();
 * const password = await provider.resolve('DB_PASSWORD');
 * // Reads from process.env.DB_PASSWORD
 * ```
 *
 * @see Docs/SECRETS-MANAGEMENT.md
 */

import { ISecretProvider } from '../ISecretProvider.js';

/**
 * Resolves secrets from environment variables
 *
 * This provider reads from process.env (e.g., from a .env file or platform-injected variables).
 * Recommended for local development and as a fallback for production.
 */
export class EnvProvider implements ISecretProvider {
  /**
   * Attempts to resolve a secret from an environment variable
   *
   * Reads from process.env[logicalName] and returns its value (trimmed).
   * Returns undefined if the environment variable is not set.
   *
   * Note: The main startup file should call dotenv.config() before using this provider:
   * ```typescript
   * import 'dotenv/config';  // IMPORTANT: Load .env first
   * ```
   *
   * @param logicalName - The logical name of the secret (e.g., "DB_PASSWORD")
   * @returns The secret string (trimmed), or undefined if not found
   */
  public async resolve(logicalName: string): Promise<string | undefined> {
    // Read from process.env
    const value = process.env[logicalName];

    // Return undefined if not set
    if (value === undefined || value === '') {
      return undefined;
    }

    // Trim whitespace (environment variables may have trailing spaces)
    return value.trim();
  }
}
