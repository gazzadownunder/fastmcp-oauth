/**
 * Unit Tests for Configuration Manager
 *
 * Tests configuration loading, validation, and access methods.
 * Covers both legacy and unified configuration formats.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConfigManager } from '../../../src/config/manager.js';
import type { UnifiedConfig } from '../../../src/config/schemas/index.js';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';

describe('ConfigManager', () => {
  let manager: ConfigManager;
  const testConfigDir = './test-configs';
  const testConfigPath = join(testConfigDir, 'test-config.json');

  // Sample unified config
  const validUnifiedConfig: UnifiedConfig = {
    auth: {
      trustedIDPs: [
        {
          issuer: 'https://auth.example.com',
          discoveryUrl: 'https://auth.example.com/.well-known/openid-configuration',
          jwksUri: 'https://auth.example.com/.well-known/jwks.json',
          audience: 'mcp-server',
          algorithms: ['RS256', 'ES256'],
          claimMappings: {
            legacyUsername: 'legacy_name',
            roles: 'roles',
            scopes: 'scopes',
          },
          roleMappings: {
            admin: ['admin', 'administrator'],
            user: ['user'],
            guest: [],
            defaultRole: 'guest',
            rejectUnmappedRoles: false,
          },
          security: {
            clockTolerance: 60,
            maxTokenAge: 3600,
            requireNbf: true,
          },
        },
      ],
      rateLimiting: {
        maxRequests: 100,
        windowMs: 900000,
      },
      audit: {
        enabled: true,
        logAllAttempts: true,
        logFailedAttempts: true,
        retentionDays: 90,
      },
    },
    delegation: {
      defaultToolPrefix: 'sql', // Added for v2.2.0 compatibility
      sql: {
        server: 'localhost',
        database: 'testdb',
        options: {
          trustedConnection: true,
          encrypt: true,
          enableArithAbort: true,
          trustServerCertificate: false,
        },
      },
    },
    mcp: {
      serverName: 'fastmcp-oauth-server',
      version: '1.0.0',
      transport: 'http-stream',
      port: 3000,
      oauth: {
        protectedResource: true,
        scopes: ['mcp:read', 'mcp:write'],
        supportedGrantTypes: ['urn:ietf:params:oauth:grant-type:token-exchange'],
      },
    },
  };

  // Sample legacy config
  const validLegacyConfig = {
    trustedIDPs: [
      {
        issuer: 'https://auth.example.com',
        jwksUri: 'https://auth.example.com/.well-known/jwks.json',
        audience: 'mcp-server',
        algorithms: ['RS256', 'ES256'],
        security: {
          clockTolerance: 60,
          maxTokenAge: 3600,
          requireNbf: true,
        },
      },
    ],
    roleMappings: {
      admin: ['admin'],
      user: ['user'],
      guest: [],
      defaultRole: 'guest',
    },
  };

  beforeEach(async () => {
    manager = new ConfigManager();

    // Create test config directory
    await mkdir(testConfigDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test files
    try {
      await unlink(testConfigPath);
    } catch {
      // Ignore if file doesn't exist
    }
  });

  describe('constructor()', () => {
    it('should create a new ConfigManager instance', () => {
      expect(manager).toBeInstanceOf(ConfigManager);
    });

    it('should initialize with no config loaded', () => {
      expect(() => manager.getConfig()).toThrow('Configuration not loaded');
    });

    it('should store environment variables', () => {
      const env = manager.getEnvironment();
      expect(env).toBe(process.env);
    });
  });

  describe('loadConfig()', () => {
    it('should load valid unified configuration', async () => {
      await writeFile(testConfigPath, JSON.stringify(validUnifiedConfig));

      const config = await manager.loadConfig(testConfigPath);

      expect(config).toEqual(validUnifiedConfig);
      expect(config.auth.trustedIDPs).toHaveLength(1);
    });

    it('should load and migrate legacy configuration', async () => {
      await writeFile(testConfigPath, JSON.stringify(validLegacyConfig));

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

      const config = await manager.loadConfig(testConfigPath);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Detected legacy configuration format')
      );
      expect(infoSpy).toHaveBeenCalledWith('[ConfigManager] Configuration migrated successfully.');
      expect(config.auth).toBeDefined();

      consoleSpy.mockRestore();
      infoSpy.mockRestore();
    });

    it('should use CONFIG_PATH environment variable when no path provided', async () => {
      const envConfigPath = join(testConfigDir, 'env-config.json');
      await writeFile(envConfigPath, JSON.stringify(validUnifiedConfig));

      process.env.CONFIG_PATH = envConfigPath;
      const manager2 = new ConfigManager();

      const config = await manager2.loadConfig();

      expect(config).toEqual(validUnifiedConfig);

      delete process.env.CONFIG_PATH;
      await unlink(envConfigPath);
    });

    it('should throw error for non-existent file', async () => {
      await expect(manager.loadConfig('./nonexistent.json')).rejects.toThrow(
        'Failed to load configuration'
      );
    });

    it('should throw error for invalid JSON', async () => {
      await writeFile(testConfigPath, '{invalid json}');

      await expect(manager.loadConfig(testConfigPath)).rejects.toThrow(
        'Failed to load configuration'
      );
    });

    it('should throw error for invalid config schema', async () => {
      const invalidConfig = {
        auth: {
          // Missing required trustedIDPs field
        },
      };

      await writeFile(testConfigPath, JSON.stringify(invalidConfig));

      await expect(manager.loadConfig(testConfigPath)).rejects.toThrow();
    });

    it('should cache loaded configuration', async () => {
      await writeFile(testConfigPath, JSON.stringify(validUnifiedConfig));

      const config1 = await manager.loadConfig(testConfigPath);
      const config2 = await manager.loadConfig(testConfigPath);

      expect(config1).toBe(config2); // Same object reference (cached)
    });

    it('should validate security requirements', async () => {
      const configWithInsecureAlg = {
        ...validUnifiedConfig,
        auth: {
          ...validUnifiedConfig.auth,
          trustedIDPs: [
            {
              ...validUnifiedConfig.auth.trustedIDPs[0],
              algorithms: ['HS256'] as any, // Insecure algorithm - will fail Zod validation
            },
          ],
        },
      };

      await writeFile(testConfigPath, JSON.stringify(configWithInsecureAlg));

      // This will fail at Zod schema validation level (algorithms enum check)
      await expect(manager.loadConfig(testConfigPath)).rejects.toThrow('Failed to load configuration');
    });

    it('should validate token age limits', async () => {
      const configWithLongTokenAge = {
        ...validUnifiedConfig,
        auth: {
          ...validUnifiedConfig.auth,
          trustedIDPs: [
            {
              ...validUnifiedConfig.auth.trustedIDPs[0],
              security: {
                ...validUnifiedConfig.auth.trustedIDPs[0].security,
                maxTokenAge: 10800, // 3 hours (exceeds schema max of 7200)
              },
            },
          ],
        },
      };

      await writeFile(testConfigPath, JSON.stringify(configWithLongTokenAge));

      // This will fail at Zod schema validation level (max 7200 seconds)
      await expect(manager.loadConfig(testConfigPath)).rejects.toThrow('Failed to load configuration');
    });

    it('should warn about permissive rate limiting', async () => {
      const configWithHighRateLimit: UnifiedConfig = {
        ...validUnifiedConfig,
        auth: {
          ...validUnifiedConfig.auth,
          rateLimiting: {
            maxRequests: 2000, // Very high
            windowMs: 900000,
          },
        },
      };

      await writeFile(testConfigPath, JSON.stringify(configWithHighRateLimit));

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await manager.loadConfig(testConfigPath);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Rate limiting allows more than 1000 requests')
      );

      consoleSpy.mockRestore();
    });

    it('should warn about disabled audit logging in production', async () => {
      const configWithoutAudit: UnifiedConfig = {
        ...validUnifiedConfig,
        auth: {
          ...validUnifiedConfig.auth,
          audit: {
            logAllAttempts: false, // Disabled
            retentionDays: 90,
          },
        },
      };

      await writeFile(testConfigPath, JSON.stringify(configWithoutAudit));

      process.env.NODE_ENV = 'production';
      const prodManager = new ConfigManager();

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await prodManager.loadConfig(testConfigPath);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Audit logging should be enabled in production')
      );

      delete process.env.NODE_ENV;
      consoleSpy.mockRestore();
    });
  });

  describe('getConfig()', () => {
    it('should return loaded configuration', async () => {
      await writeFile(testConfigPath, JSON.stringify(validUnifiedConfig));
      await manager.loadConfig(testConfigPath);

      const config = manager.getConfig();

      expect(config).toEqual(validUnifiedConfig);
    });

    it('should throw error when config not loaded', () => {
      expect(() => manager.getConfig()).toThrow('Configuration not loaded. Call loadConfig() first.');
    });
  });

  describe('getAuthConfig()', () => {
    it('should return auth configuration', async () => {
      await writeFile(testConfigPath, JSON.stringify(validUnifiedConfig));
      await manager.loadConfig(testConfigPath);

      const authConfig = manager.getAuthConfig();

      expect(authConfig).toEqual(validUnifiedConfig.auth);
      expect(authConfig.trustedIDPs).toHaveLength(1);
    });

    it('should throw when config not loaded', () => {
      expect(() => manager.getAuthConfig()).toThrow('Configuration not loaded');
    });
  });

  describe('getDelegationConfig()', () => {
    it('should return delegation configuration when present', async () => {
      await writeFile(testConfigPath, JSON.stringify(validUnifiedConfig));
      await manager.loadConfig(testConfigPath);

      const delegationConfig = manager.getDelegationConfig();

      expect(delegationConfig).toEqual(validUnifiedConfig.delegation);
    });

    it('should return undefined when delegation config not present', async () => {
      const configWithoutDelegation: UnifiedConfig = {
        auth: validUnifiedConfig.auth,
      };

      await writeFile(testConfigPath, JSON.stringify(configWithoutDelegation));
      await manager.loadConfig(testConfigPath);

      const delegationConfig = manager.getDelegationConfig();

      expect(delegationConfig).toBeUndefined();
    });
  });

  describe('getFastMCPConfig()', () => {
    it('should return MCP configuration when present', async () => {
      await writeFile(testConfigPath, JSON.stringify(validUnifiedConfig));
      await manager.loadConfig(testConfigPath);

      const mcpConfig = manager.getFastMCPConfig();

      expect(mcpConfig).toEqual(validUnifiedConfig.mcp);
    });

    it('should return undefined when MCP config not present', async () => {
      const configWithoutMCP: UnifiedConfig = {
        auth: validUnifiedConfig.auth,
      };

      await writeFile(testConfigPath, JSON.stringify(configWithoutMCP));
      await manager.loadConfig(testConfigPath);

      const mcpConfig = manager.getFastMCPConfig();

      expect(mcpConfig).toBeUndefined();
    });
  });

  describe('getDelegationModuleConfig()', () => {
    it('should return SQL module configuration', async () => {
      await writeFile(testConfigPath, JSON.stringify(validUnifiedConfig));
      await manager.loadConfig(testConfigPath);

      const sqlConfig = manager.getDelegationModuleConfig('sql');

      expect(sqlConfig).toEqual(validUnifiedConfig.delegation?.sql);
    });

    it('should return Kerberos module configuration', async () => {
      const configWithKerberos: UnifiedConfig = {
        ...validUnifiedConfig,
        delegation: {
          kerberos: {
            serviceAccount: 'svc-mcp-oauth',
            keytabPath: '/etc/keytabs/svc-mcp-oauth.keytab',
            realm: 'EXAMPLE.COM',
            kdc: 'kdc.example.com',
          },
        },
      };

      await writeFile(testConfigPath, JSON.stringify(configWithKerberos));
      await manager.loadConfig(testConfigPath);

      const kerberosConfig = manager.getDelegationModuleConfig('kerberos');

      expect(kerberosConfig).toEqual(configWithKerberos.delegation?.kerberos);
    });

    it('should return custom module configuration from modules record', async () => {
      const configWithCustomModule: UnifiedConfig = {
        ...validUnifiedConfig,
        delegation: {
          modules: {
            'custom-api': {
              endpoint: 'https://api.example.com',
              timeout: 5000,
            },
          },
        },
      };

      await writeFile(testConfigPath, JSON.stringify(configWithCustomModule));
      await manager.loadConfig(testConfigPath);

      const customConfig = manager.getDelegationModuleConfig('custom-api');

      expect(customConfig).toEqual({
        endpoint: 'https://api.example.com',
        timeout: 5000,
      });
    });

    it('should return undefined for non-existent module', async () => {
      await writeFile(testConfigPath, JSON.stringify(validUnifiedConfig));
      await manager.loadConfig(testConfigPath);

      const config = manager.getDelegationModuleConfig('nonexistent');

      expect(config).toBeUndefined();
    });

    it('should return undefined when delegation config not present', async () => {
      const configWithoutDelegation: UnifiedConfig = {
        auth: validUnifiedConfig.auth,
      };

      await writeFile(testConfigPath, JSON.stringify(configWithoutDelegation));
      await manager.loadConfig(testConfigPath);

      const config = manager.getDelegationModuleConfig('sql');

      expect(config).toBeUndefined();
    });
  });

  describe('getTrustedIDP()', () => {
    it('should return IDP by issuer', async () => {
      await writeFile(testConfigPath, JSON.stringify(validUnifiedConfig));
      await manager.loadConfig(testConfigPath);

      const idp = manager.getTrustedIDP('https://auth.example.com');

      expect(idp).toEqual(validUnifiedConfig.auth.trustedIDPs[0]);
    });

    it('should return undefined for unknown issuer', async () => {
      await writeFile(testConfigPath, JSON.stringify(validUnifiedConfig));
      await manager.loadConfig(testConfigPath);

      const idp = manager.getTrustedIDP('https://unknown.example.com');

      expect(idp).toBeUndefined();
    });
  });

  describe('validateIssuer()', () => {
    it('should return true for trusted issuer', async () => {
      await writeFile(testConfigPath, JSON.stringify(validUnifiedConfig));
      await manager.loadConfig(testConfigPath);

      const isValid = manager.validateIssuer('https://auth.example.com');

      expect(isValid).toBe(true);
    });

    it('should return false for untrusted issuer', async () => {
      await writeFile(testConfigPath, JSON.stringify(validUnifiedConfig));
      await manager.loadConfig(testConfigPath);

      const isValid = manager.validateIssuer('https://untrusted.example.com');

      expect(isValid).toBe(false);
    });
  });

  describe('reloadConfig()', () => {
    it('should reload configuration', async () => {
      await writeFile(testConfigPath, JSON.stringify(validUnifiedConfig));
      await manager.loadConfig(testConfigPath);

      const config1 = manager.getConfig();

      // Modify config file
      const modifiedConfig: UnifiedConfig = {
        ...validUnifiedConfig,
        auth: {
          ...validUnifiedConfig.auth,
          trustedIDPs: [
            ...validUnifiedConfig.auth.trustedIDPs,
            {
              issuer: 'https://auth2.example.com',
              discoveryUrl: 'https://auth2.example.com/.well-known/openid-configuration',
              jwksUri: 'https://auth2.example.com/.well-known/jwks.json',
              audience: 'mcp-server',
              algorithms: ['RS256'],
              claimMappings: {
                legacyUsername: 'legacy_name',
                roles: 'roles',
                scopes: 'scopes',
              },
              security: {
                clockTolerance: 60,
                maxTokenAge: 3600,
                requireNbf: true,
              },
            },
          ],
        },
      };

      await writeFile(testConfigPath, JSON.stringify(modifiedConfig));

      const config2 = await manager.reloadConfig(testConfigPath);

      expect(config2).not.toBe(config1); // Different object reference
      expect(config2.auth.trustedIDPs).toHaveLength(2);
    });

    it('should clear cached config before reload', async () => {
      await writeFile(testConfigPath, JSON.stringify(validUnifiedConfig));
      await manager.loadConfig(testConfigPath);

      // Should load fresh config
      await manager.reloadConfig(testConfigPath);

      const config = manager.getConfig();
      expect(config).toBeDefined();
    });
  });

  describe('Environment Helper Methods', () => {
    describe('getEnvironment()', () => {
      it('should return process environment', () => {
        const env = manager.getEnvironment();
        expect(env).toBe(process.env);
      });
    });

    describe('isSecureEnvironment()', () => {
      it('should return true in production', () => {
        process.env.NODE_ENV = 'production';
        const prodManager = new ConfigManager();

        expect(prodManager.isSecureEnvironment()).toBe(true);

        delete process.env.NODE_ENV;
      });

      it('should return false in development', () => {
        process.env.NODE_ENV = 'development';
        const devManager = new ConfigManager();

        expect(devManager.isSecureEnvironment()).toBe(false);

        delete process.env.NODE_ENV;
      });

      it('should return false when NODE_ENV not set', () => {
        delete process.env.NODE_ENV;
        const manager = new ConfigManager();

        expect(manager.isSecureEnvironment()).toBe(false);
      });
    });

    describe('getLogLevel()', () => {
      it('should return LOG_LEVEL environment variable', () => {
        process.env.LOG_LEVEL = 'debug';
        const manager = new ConfigManager();

        expect(manager.getLogLevel()).toBe('debug');

        delete process.env.LOG_LEVEL;
      });

      it('should default to info when LOG_LEVEL not set', () => {
        delete process.env.LOG_LEVEL;
        const manager = new ConfigManager();

        expect(manager.getLogLevel()).toBe('info');
      });
    });

    describe('getServerPort()', () => {
      it('should return SERVER_PORT environment variable as number', () => {
        process.env.SERVER_PORT = '8080';
        const manager = new ConfigManager();

        expect(manager.getServerPort()).toBe(8080);

        delete process.env.SERVER_PORT;
      });

      it('should default to 3000 when SERVER_PORT not set', () => {
        delete process.env.SERVER_PORT;
        const manager = new ConfigManager();

        expect(manager.getServerPort()).toBe(3000);
      });

      it('should parse port number correctly', () => {
        process.env.SERVER_PORT = '5000';
        const manager = new ConfigManager();

        expect(manager.getServerPort()).toBe(5000);
        expect(typeof manager.getServerPort()).toBe('number');

        delete process.env.SERVER_PORT;
      });
    });
  });

  describe('getDelegationConfig_LEGACY() - Deprecated', () => {
    it('should return SQL configuration', async () => {
      await writeFile(testConfigPath, JSON.stringify(validUnifiedConfig));
      await manager.loadConfig(testConfigPath);

      const sqlConfig = manager.getDelegationConfig_LEGACY('sql');

      expect(sqlConfig).toEqual(validUnifiedConfig.delegation?.sql);
    });

    it('should return Kerberos configuration', async () => {
      const configWithKerberos: UnifiedConfig = {
        ...validUnifiedConfig,
        delegation: {
          kerberos: {
            serviceAccount: 'svc-mcp-oauth',
            keytabPath: '/etc/keytabs/svc-mcp-oauth.keytab',
            realm: 'EXAMPLE.COM',
            kdc: 'kdc.example.com',
          },
        },
      };

      await writeFile(testConfigPath, JSON.stringify(configWithKerberos));
      await manager.loadConfig(testConfigPath);

      const kerberosConfig = manager.getDelegationConfig_LEGACY('kerberos');

      expect(kerberosConfig).toEqual(configWithKerberos.delegation?.kerberos);
    });

    it('should throw when delegation config not found', async () => {
      const configWithoutDelegation: UnifiedConfig = {
        auth: validUnifiedConfig.auth,
      };

      await writeFile(testConfigPath, JSON.stringify(configWithoutDelegation));
      await manager.loadConfig(testConfigPath);

      expect(() => manager.getDelegationConfig_LEGACY('sql')).toThrow(
        'Delegation configuration not found'
      );
    });

    it('should throw when specific config type not found', async () => {
      const configWithoutSQL: UnifiedConfig = {
        auth: validUnifiedConfig.auth,
        delegation: {},
      };

      await writeFile(testConfigPath, JSON.stringify(configWithoutSQL));
      await manager.loadConfig(testConfigPath);

      expect(() => manager.getDelegationConfig_LEGACY('sql')).toThrow(
        'SQL configuration not found'
      );
    });
  });
});
