import { readFile } from 'fs/promises';
import { join } from 'path';
import {
  UnifiedConfigSchema,
  isLegacyConfig,
  type UnifiedConfig,
  type CoreAuthConfig,
  type DelegationConfig,
  type FastMCPConfig,
  type MCPConfig,
} from './schemas/index.js';
import { migrateConfigData } from './migrate.js';
import { SecretResolver, FileSecretProvider, EnvProvider } from './secrets/index.js';
import { AuditService } from '../core/audit-service.js';

// Legacy schema import for backward compatibility
import { OAuthOBOConfigSchema, type OAuthOBOConfig } from './schema.js';

export class ConfigManager {
  private config: UnifiedConfig | null = null;
  private env: NodeJS.ProcessEnv;
  private secretResolver: SecretResolver;
  private auditService?: AuditService;

  /**
   * Creates a new ConfigManager
   *
   * @param options - Optional configuration
   * @param options.auditService - AuditService instance for logging secret access (optional)
   * @param options.secretsDir - Directory for file-based secrets (default: '/run/secrets')
   */
  constructor(options?: { auditService?: AuditService; secretsDir?: string }) {
    // Store environment variables
    this.env = process.env;
    this.auditService = options?.auditService;

    // Initialize SecretResolver with provider chain
    this.secretResolver = new SecretResolver({
      auditService: this.auditService,
      failFast: true, // Fail fast if secrets cannot be resolved
    });

    // Add providers in priority order
    // 1. FileSecretProvider (highest priority - production)
    const secretsDir = options?.secretsDir || '/run/secrets';
    this.secretResolver.addProvider(new FileSecretProvider(secretsDir));

    // 2. EnvProvider (fallback - development/test)
    this.secretResolver.addProvider(new EnvProvider());
  }

  async loadConfig(configPath?: string): Promise<UnifiedConfig> {
    if (this.config) {
      return this.config;
    }

    const path = configPath || this.env.CONFIG_PATH || './config/oauth-obo.json';

    try {
      const configFile = await readFile(path, 'utf-8');
      let rawConfig = JSON.parse(configFile);

      // STEP 1: Resolve secrets BEFORE validation
      // This allows {"$secret": "NAME"} descriptors in the config
      console.log('[ConfigManager] Resolving secrets...');
      await this.secretResolver.resolveSecrets(rawConfig);
      console.log('[ConfigManager] Secrets resolved successfully');

      // STEP 2: Check if legacy format and migrate if needed
      if (isLegacyConfig(rawConfig)) {
        console.warn('[ConfigManager] Detected legacy configuration format. Migrating to unified format...');
        this.config = migrateConfigData(rawConfig);
        console.info('[ConfigManager] Configuration migrated successfully.');
      } else {
        // STEP 3: Validate unified configuration
        // At this point, all {"$secret": "NAME"} descriptors have been replaced with actual values
        this.config = UnifiedConfigSchema.parse(rawConfig);
      }

      // STEP 4: Additional security validations
      this.validateSecurityRequirements(this.config);

      console.log('[ConfigManager] Configuration loaded and validated successfully');
      return this.config;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to load configuration: ${error.message}`);
      }
      throw error;
    }
  }

  getEnvironment(): NodeJS.ProcessEnv {
    return this.env;
  }

  getConfig(): UnifiedConfig {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call loadConfig() first.');
    }
    return this.config;
  }

  /**
   * Get Core authentication configuration
   *
   * Returns only the auth layer configuration for Core services.
   */
  getAuthConfig(): CoreAuthConfig {
    const config = this.getConfig();
    return config.auth;
  }

  /**
   * Get Delegation configuration
   *
   * Returns delegation layer configuration if present.
   */
  getDelegationConfig(): DelegationConfig | undefined {
    const config = this.getConfig();
    return config.delegation;
  }

  /**
   * Get FastMCP configuration
   *
   * Returns FastMCP layer configuration if present.
   */
  getFastMCPConfig(): FastMCPConfig | undefined {
    const config = this.getConfig();
    return config.mcp;
  }

  /**
   * @deprecated Use getFastMCPConfig() instead. This alias is for backward compatibility only.
   */
  getMCPConfig(): MCPConfig | undefined {
    return this.getFastMCPConfig();
  }

  /**
   * Get configuration for specific delegation module
   *
   * @param moduleName - Module name (e.g., 'sql', 'kerberos')
   * @returns Module configuration or undefined
   */
  getDelegationModuleConfig(moduleName: string): any | undefined {
    const delegationConfig = this.getDelegationConfig();
    if (!delegationConfig) {
      return undefined;
    }

    // Check direct module configs (sql, kerberos)
    if (moduleName === 'sql') {
      return delegationConfig.sql;
    }
    if (moduleName === 'kerberos') {
      return delegationConfig.kerberos;
    }

    // Check modules record for custom modules
    if (delegationConfig.modules && moduleName in delegationConfig.modules) {
      return delegationConfig.modules[moduleName];
    }

    return undefined;
  }

  getTrustedIDP(issuer: string) {
    const authConfig = this.getAuthConfig();
    return authConfig.trustedIDPs.find((idp) => idp.issuer === issuer);
  }

  validateIssuer(issuer: string): boolean {
    const authConfig = this.getAuthConfig();
    return authConfig.trustedIDPs.some((idp) => idp.issuer === issuer);
  }

  private validateSecurityRequirements(config: UnifiedConfig): void {
    const authConfig = config.auth;

    // Ensure all IDPs use secure algorithms
    for (const idp of authConfig.trustedIDPs) {
      if (!idp.algorithms.includes('RS256') && !idp.algorithms.includes('ES256')) {
        throw new Error(
          `IDP ${idp.issuer} must support at least one secure algorithm (RS256 or ES256)`
        );
      }

      // Validate token age limits
      if (idp.security.maxTokenAge > 3600) {
        throw new Error(`IDP ${idp.issuer} maxTokenAge cannot exceed 1 hour for security`);
      }
    }

    // Validate rate limiting is not too permissive
    if (authConfig.rateLimiting && authConfig.rateLimiting.maxRequests > 1000) {
      console.warn('Rate limiting allows more than 1000 requests - consider lowering for security');
    }

    // Ensure audit logging is enabled for production
    if (
      this.env.NODE_ENV === 'production' &&
      authConfig.audit &&
      !authConfig.audit.logAllAttempts
    ) {
      console.warn('Audit logging should be enabled in production environments');
    }
  }

  // Hot reload configuration (for development)
  async reloadConfig(configPath?: string): Promise<UnifiedConfig> {
    this.config = null;
    console.log('[ConfigManager] Reloading configuration...');
    return this.loadConfig(configPath);
  }

  /**
   * Get the SecretResolver instance
   *
   * Useful for testing and advanced use cases.
   *
   * @returns The SecretResolver instance
   */
  getSecretResolver(): SecretResolver {
    return this.secretResolver;
  }

  /**
   * @deprecated Use getDelegationModuleConfig('sql') instead
   */
  getDelegationConfig_LEGACY(type: 'kerberos' | 'sql') {
    const delegationConfig = this.getDelegationConfig();
    if (!delegationConfig) {
      throw new Error('Delegation configuration not found');
    }

    switch (type) {
      case 'kerberos':
        if (!delegationConfig.kerberos) {
          throw new Error('Kerberos configuration not found');
        }
        return delegationConfig.kerberos;

      case 'sql':
        if (!delegationConfig.sql) {
          throw new Error('SQL configuration not found');
        }
        return delegationConfig.sql;

      default:
        throw new Error(`Unknown delegation type: ${type}`);
    }
  }

  // Security helper methods
  isSecureEnvironment(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  getLogLevel(): string {
    return this.env.LOG_LEVEL || 'info';
  }

  getServerPort(): number {
    return parseInt(this.env.SERVER_PORT || '3000', 10);
  }
}

// Singleton instance
export const configManager = new ConfigManager();
