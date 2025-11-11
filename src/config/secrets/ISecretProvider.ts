/**
 * Secret Provider Interface
 *
 * Base interface for all secret providers in the Dynamic Configuration Resolution system.
 * Providers attempt to resolve logical secret names from various sources (files, environment variables, cloud vaults, etc.).
 *
 * Design Principles:
 * - Simple interface with single responsibility
 * - Return undefined if secret not found (allows provider chain)
 * - Providers tried in order of priority
 * - No configuration coupling - providers are self-contained
 *
 * @see Docs/SECRETS-MANAGEMENT.md
 */

/**
 * Interface for all secret providers
 *
 * A provider attempts to resolve a logical secret name from its source.
 * Providers are tried in order by SecretResolver until one returns a value.
 *
 * @example
 * ```typescript
 * class MyProvider implements ISecretProvider {
 *   async resolve(logicalName: string): Promise<string | undefined> {
 *     // Try to fetch secret from source
 *     const secret = await this.fetchFromSource(logicalName);
 *     return secret || undefined;
 *   }
 * }
 * ```
 */
export interface ISecretProvider {
  /**
   * Attempts to resolve a logical secret name from this provider's source.
   *
   * Return undefined to indicate the secret was not found, allowing the next
   * provider in the chain to be tried.
   *
   * @param logicalName - The logical name of the secret (e.g., "DB_PASSWORD", "OAUTH_CLIENT_SECRET")
   * @returns A Promise that resolves to the secret string, or undefined if not found
   * @throws Error only for unexpected failures (network errors, permission denied, etc.)
   *         Do NOT throw for "secret not found" - return undefined instead
   *
   * @example
   * ```typescript
   * // Found - return the secret
   * const password = await provider.resolve('DB_PASSWORD');
   * console.log(password); // "ServicePass123!"
   *
   * // Not found - return undefined (try next provider)
   * const notFound = await provider.resolve('NONEXISTENT');
   * console.log(notFound); // undefined
   * ```
   */
  resolve(logicalName: string): Promise<string | undefined>;
}

/**
 * Type guard to check if an object implements ISecretProvider
 *
 * @param obj - Object to check
 * @returns True if object has a resolve method
 */
export function isSecretProvider(obj: any): obj is ISecretProvider {
  return obj && typeof obj.resolve === 'function';
}
