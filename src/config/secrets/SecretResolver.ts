/**
 * Secret Resolver
 *
 * Orchestrates the loading and resolution of configuration secrets via a provider chain.
 * This is the central component of the Dynamic Configuration Resolution system.
 *
 * Features:
 * - Provider chain with priority ordering
 * - Recursive config walking to find {"$secret": "NAME"} descriptors
 * - Fail-fast behavior (application exits if secrets cannot be resolved)
 * - Optional audit logging integration
 *
 * Usage:
 * ```typescript
 * const resolver = new SecretResolver();
 * resolver.addProvider(new FileSecretProvider('/run/secrets'));
 * resolver.addProvider(new EnvProvider());
 *
 * const config = JSON.parse(await fs.readFile('config.json', 'utf-8'));
 * await resolver.resolveSecrets(config);
 * // Config now has secrets resolved in-place
 * ```
 *
 * @see Docs/SECRETS-MANAGEMENT.md
 */

import { ISecretProvider, isSecretProvider } from './ISecretProvider.js';
import { AuditService } from '../../core/audit-service.js';

/**
 * Configuration for SecretResolver
 */
export interface SecretResolverConfig {
  /** Optional audit service for logging secret access */
  auditService?: AuditService;

  /** Whether to fail fast if secrets cannot be resolved (default: true) */
  failFast?: boolean;
}

/**
 * Orchestrates the resolution of configuration secrets via a provider chain
 */
export class SecretResolver {
  private providers: ISecretProvider[] = [];
  private auditService?: AuditService;
  private failFast: boolean;

  /**
   * Creates a new SecretResolver
   *
   * @param config - Optional configuration
   */
  constructor(config?: SecretResolverConfig) {
    this.auditService = config?.auditService;
    this.failFast = config?.failFast ?? true;
  }

  /**
   * Adds a secret provider to the resolution chain
   *
   * Providers are tried in the order they are added.
   * When a secret is found, the chain stops and does not query remaining providers.
   *
   * Recommended order:
   * 1. FileSecretProvider (highest priority - production)
   * 2. EnvProvider (fallback - development)
   * 3. Cloud providers (optional - AWS/Azure/GCP)
   *
   * @param provider - An instance of a class implementing ISecretProvider
   * @throws Error if provider doesn't implement ISecretProvider
   */
  public addProvider(provider: ISecretProvider): void {
    if (!isSecretProvider(provider)) {
      throw new Error('Provider must implement ISecretProvider interface');
    }
    this.providers.push(provider);
  }

  /**
   * Resolves all secrets in a configuration object
   *
   * Recursively walks the config object and replaces {"$secret": "NAME"} descriptors
   * with the resolved secret values from the provider chain.
   *
   * This method modifies the config object in-place.
   *
   * @param config - The configuration object (will be modified)
   * @throws Error if failFast is true and a secret cannot be resolved
   */
  public async resolveSecrets(config: any): Promise<void> {
    await this.resolveNode(config);
  }

  /**
   * Internal recursive function to walk the configuration object
   *
   * @param node - The current node (object, array, or primitive) to resolve
   * @param path - Current path in the config tree (for error messages)
   */
  private async resolveNode(node: any, path: string = 'config'): Promise<void> {
    // Not an object/array - stop recursion
    if (typeof node !== 'object' || node === null) {
      return;
    }

    // Handle arrays
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        await this.resolveNode(node[i], `${path}[${i}]`);
      }
      return;
    }

    // Handle objects - iterate over keys
    for (const key of Object.keys(node)) {
      const child = node[key];
      const childPath = `${path}.${key}`;

      // Check if the child is a secret descriptor: {"$secret": "NAME"}
      if (this.isSecretDescriptor(child)) {
        const logicalName = child.$secret;
        const resolvedValue = await this.resolveSecret(logicalName, childPath);

        if (resolvedValue === undefined) {
          // Secret could not be resolved by any provider
          const errorMessage = `Secret "${logicalName}" at path "${childPath}" could not be resolved by any provider.`;

          if (this.failFast) {
            // Fail-fast: Exit application (security requirement)
            throw new Error(`[SecretResolver] ${errorMessage}`);
          } else {
            // Non-fatal: Log warning and continue
            console.warn(`[SecretResolver] ${errorMessage}`);
          }
        } else {
          // Replace the descriptor object with the resolved value
          node[key] = resolvedValue;
        }
      } else {
        // Not a secret descriptor - recurse into the child
        await this.resolveNode(child, childPath);
      }
    }
  }

  /**
   * Checks if an object is a secret descriptor
   *
   * A secret descriptor is an object with a single "$secret" property containing a string.
   *
   * @param obj - Object to check
   * @returns True if object is {"$secret": "string"}
   */
  private isSecretDescriptor(obj: any): obj is { $secret: string } {
    return (
      obj &&
      typeof obj === 'object' &&
      obj.$secret &&
      typeof obj.$secret === 'string' &&
      Object.keys(obj).length === 1
    );
  }

  /**
   * Tries to resolve a logical secret name using the provider chain
   *
   * Queries each provider in order until one returns a value.
   * Logs audit entries for successful and failed resolutions.
   *
   * @param logicalName - The logical name of the secret
   * @param path - Current path in the config tree (for error messages)
   * @returns The resolved secret string, or undefined if not found
   */
  private async resolveSecret(logicalName: string, path: string): Promise<string | undefined> {
    for (const provider of this.providers) {
      try {
        const value = await provider.resolve(logicalName);

        if (value !== undefined) {
          // Secret found! Log audit entry and return
          if (this.auditService) {
            await this.auditService.log({
              source: 'secret:resolution',
              timestamp: new Date(),
              userId: 'system',
              action: `resolve:${logicalName}`,
              success: true,
              metadata: {
                secretName: logicalName,
                provider: provider.constructor.name,
                configPath: path,
              },
            });
          }

          return value;
        }
      } catch (error) {
        // Provider threw an error - log warning and try next provider
        console.warn(
          `[SecretResolver] Provider ${provider.constructor.name} failed to resolve "${logicalName}": ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    // Secret not found by any provider - log failure
    if (this.auditService) {
      await this.auditService.log({
        source: 'secret:resolution',
        timestamp: new Date(),
        userId: 'system',
        action: `resolve:${logicalName}`,
        success: false,
        metadata: {
          secretName: logicalName,
          provider: 'none',
          configPath: path,
          error: 'No provider could resolve this secret',
        },
      });
    }

    return undefined;
  }

  /**
   * Get the list of registered providers
   *
   * @returns Array of provider instances
   */
  public getProviders(): ISecretProvider[] {
    return [...this.providers];
  }

  /**
   * Clear all registered providers (useful for testing)
   */
  public clearProviders(): void {
    this.providers = [];
  }
}
