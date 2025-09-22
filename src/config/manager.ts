import { readFile } from 'fs/promises';
import { join } from 'path';
import { OAuthOBOConfigSchema, EnvironmentSchema, type OAuthOBOConfig, type Environment } from './schema.js';

export class ConfigManager {
  private config: OAuthOBOConfig | null = null;
  private env: Environment;

  constructor() {
    this.env = EnvironmentSchema.parse(process.env);
  }

  async loadConfig(configPath?: string): Promise<OAuthOBOConfig> {
    if (this.config) {
      return this.config;
    }

    const path = configPath || this.env.CONFIG_PATH || './config/oauth-obo.json';

    try {
      const configFile = await readFile(path, 'utf-8');
      const rawConfig = JSON.parse(configFile);

      // Validate configuration against schema
      this.config = OAuthOBOConfigSchema.parse(rawConfig);

      // Additional security validations
      this.validateSecurityRequirements(this.config);

      return this.config;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to load configuration: ${error.message}`);
      }
      throw error;
    }
  }

  getEnvironment(): Environment {
    return this.env;
  }

  getConfig(): OAuthOBOConfig {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call loadConfig() first.');
    }
    return this.config;
  }

  getTrustedIDP(issuer: string) {
    const config = this.getConfig();
    return config.trustedIDPs.find(idp => idp.issuer === issuer);
  }

  validateIssuer(issuer: string): boolean {
    const config = this.getConfig();
    return config.trustedIDPs.some(idp => idp.issuer === issuer);
  }

  private validateSecurityRequirements(config: OAuthOBOConfig): void {
    // Ensure all IDPs use secure algorithms
    for (const idp of config.trustedIDPs) {
      if (!idp.algorithms.includes('RS256') && !idp.algorithms.includes('ES256')) {
        throw new Error(`IDP ${idp.issuer} must support at least one secure algorithm (RS256 or ES256)`);
      }

      // Validate token age limits
      if (idp.security.maxTokenAge > 3600) {
        throw new Error(`IDP ${idp.issuer} maxTokenAge cannot exceed 1 hour for security`);
      }
    }

    // Validate rate limiting is not too permissive
    if (config.rateLimiting.maxRequests > 1000) {
      console.warn('Rate limiting allows more than 1000 requests - consider lowering for security');
    }

    // Ensure audit logging is enabled for production
    if (this.env.NODE_ENV === 'production' && !config.audit.logAllAttempts) {
      console.warn('Audit logging should be enabled in production environments');
    }
  }

  // Hot reload configuration (for development)
  async reloadConfig(configPath?: string): Promise<OAuthOBOConfig> {
    this.config = null;
    return this.loadConfig(configPath);
  }

  // Get configuration for specific delegation type
  getDelegationConfig(type: 'kerberos' | 'sql') {
    const config = this.getConfig();

    switch (type) {
      case 'kerberos':
        if (!config.kerberos) {
          throw new Error('Kerberos configuration not found');
        }
        return config.kerberos;

      case 'sql':
        if (!config.sql) {
          throw new Error('SQL configuration not found');
        }
        return config.sql;

      default:
        throw new Error(`Unknown delegation type: ${type}`);
    }
  }

  // Security helper methods
  isSecureEnvironment(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  getLogLevel(): string {
    return this.env.LOG_LEVEL;
  }

  getServerPort(): number {
    return this.env.SERVER_PORT;
  }
}

// Singleton instance
export const configManager = new ConfigManager();