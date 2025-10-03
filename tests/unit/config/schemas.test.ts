import { describe, it, expect } from 'vitest';
import {
  CoreAuthConfigSchema,
  DelegationConfigSchema,
  MCPConfigSchema,
  UnifiedConfigSchema,
  isLegacyConfig,
  isUnifiedConfig
} from '../../../src/config/schemas/index.js';

describe('Config Schemas', () => {
  describe('CoreAuthConfigSchema', () => {
    it('should validate valid core auth config', () => {
      const validConfig = {
        trustedIDPs: [{
          issuer: 'https://auth.example.com',
          discoveryUrl: 'https://auth.example.com/.well-known/oauth-authorization-server',
          jwksUri: 'https://auth.example.com/.well-known/jwks.json',
          audience: 'test-api',
          algorithms: ['RS256', 'ES256'],
          claimMappings: {
            legacyUsername: 'legacy_user',
            roles: 'user_roles',
            scopes: 'scopes'
          },
          security: {
            clockTolerance: 60,
            maxTokenAge: 3600,
            requireNbf: true
          }
        }],
        roleMappings: {
          adminRole: 'admin',
          userRole: 'user',
          guestRole: 'guest',
          customRoles: []
        },
        audit: {
          enabled: true,
          logAllAttempts: true,
          retentionDays: 90
        }
      };

      const result = CoreAuthConfigSchema.safeParse(validConfig);
      expect(result.success).toBe(true);
    });

    it('should reject config with HTTP URLs in production', () => {
      // Save original NODE_ENV
      const originalEnv = process.env.NODE_ENV;

      try {
        // Set to production
        process.env.NODE_ENV = 'production';

        const invalidConfig = {
          trustedIDPs: [{
            issuer: 'http://insecure.example.com', // HTTP not HTTPS
            discoveryUrl: 'http://insecure.example.com/.well-known/oauth-authorization-server',
            jwksUri: 'http://insecure.example.com/.well-known/jwks.json',
            audience: 'test-api',
            algorithms: ['RS256'],
            claimMappings: {
              legacyUsername: 'legacy_user',
              roles: 'user_roles',
              scopes: 'scopes'
            },
            security: {
              clockTolerance: 60,
              maxTokenAge: 3600,
              requireNbf: true
            }
          }]
        };

        const result = CoreAuthConfigSchema.safeParse(invalidConfig);
        expect(result.success).toBe(false);
      } finally {
        // Restore original NODE_ENV
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('should reject config with insecure algorithms', () => {
      const invalidConfig = {
        trustedIDPs: [{
          issuer: 'https://auth.example.com',
          discoveryUrl: 'https://auth.example.com/.well-known/oauth-authorization-server',
          jwksUri: 'https://auth.example.com/.well-known/jwks.json',
          audience: 'test-api',
          algorithms: ['none', 'HS256'], // Insecure algorithms
          claimMappings: {
            legacyUsername: 'legacy_user',
            roles: 'user_roles',
            scopes: 'scopes'
          },
          security: {
            clockTolerance: 60,
            maxTokenAge: 3600,
            requireNbf: true
          }
        }]
      };

      const result = CoreAuthConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });

    it('should accept minimal config with only required fields', () => {
      const minimalConfig = {
        trustedIDPs: [{
          issuer: 'https://auth.example.com',
          discoveryUrl: 'https://auth.example.com/.well-known/oauth-authorization-server',
          jwksUri: 'https://auth.example.com/.well-known/jwks.json',
          audience: 'test-api',
          algorithms: ['RS256'],
          claimMappings: {
            legacyUsername: 'legacy_user',
            roles: 'user_roles',
            scopes: 'scopes'
          },
          security: {
            clockTolerance: 60,
            maxTokenAge: 3600,
            requireNbf: true
          }
        }]
      };

      const result = CoreAuthConfigSchema.parse(minimalConfig);
      expect(result.trustedIDPs).toHaveLength(1);
      // audit and rateLimiting are optional
      expect(result.audit).toBeUndefined();
      expect(result.rateLimiting).toBeUndefined();
    });
  });

  describe('DelegationConfigSchema', () => {
    it('should validate valid delegation config', () => {
      const validConfig = {
        modules: {
          sql: {
            server: 'localhost',
            database: 'testdb',
            options: {
              trustedConnection: true,
              encrypt: true
            }
          }
        }
      };

      const result = DelegationConfigSchema.safeParse(validConfig);
      expect(result.success).toBe(true);
    });

    it('should accept empty modules', () => {
      const emptyConfig = {
        modules: {}
      };

      const result = DelegationConfigSchema.safeParse(emptyConfig);
      expect(result.success).toBe(true);
    });

    it('should validate SQL config with authentication', () => {
      const sqlConfig = {
        modules: {
          sql: {
            server: 'sql.example.com',
            database: 'mydb',
            options: {
              user: 'sqluser',
              password: 'sqlpass',
              encrypt: true
            }
          }
        }
      };

      const result = DelegationConfigSchema.safeParse(sqlConfig);
      expect(result.success).toBe(true);
    });
  });

  describe('MCPConfigSchema', () => {
    it('should validate valid MCP config', () => {
      const validConfig = {
        serverName: 'Test MCP Server',
        version: '1.0.0',
        transport: 'http-stream',
        port: 3000
      };

      const result = MCPConfigSchema.safeParse(validConfig);
      expect(result.success).toBe(true);
    });

    it('should use default values', () => {
      const minimalConfig = {};

      const result = MCPConfigSchema.parse(minimalConfig);
      expect(result.serverName).toBe('mcp-oauth-server');
      expect(result.version).toBe('1.0.0');
      expect(result.transport).toBe('http-stream');
      expect(result.port).toBe(3000);
    });

    it('should validate transport type', () => {
      const invalidConfig = {
        transport: 'invalid-transport'
      };

      const result = MCPConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });
  });

  describe('UnifiedConfigSchema', () => {
    it('should validate complete unified config', () => {
      const validConfig = {
        auth: {
          trustedIDPs: [{
            issuer: 'https://auth.example.com',
            discoveryUrl: 'https://auth.example.com/.well-known/oauth-authorization-server',
            jwksUri: 'https://auth.example.com/.well-known/jwks.json',
            audience: 'test-api',
            algorithms: ['RS256'],
            claimMappings: {
              legacyUsername: 'legacy_user',
              roles: 'user_roles',
              scopes: 'scopes'
            },
            security: {
              clockTolerance: 60,
              maxTokenAge: 3600,
              requireNbf: true
            }
          }]
        },
        delegation: {
          modules: {
            sql: {
              server: 'localhost',
              database: 'testdb',
              options: {
                trustedConnection: true,
                encrypt: true
              }
            }
          }
        },
        mcp: {
          serverName: 'Test Server',
          version: '1.0.0',
          transport: 'http-stream',
          port: 3000
        }
      };

      const result = UnifiedConfigSchema.safeParse(validConfig);
      expect(result.success).toBe(true);
    });

    it('should validate config with only auth section', () => {
      const authOnlyConfig = {
        auth: {
          trustedIDPs: [{
            issuer: 'https://auth.example.com',
            discoveryUrl: 'https://auth.example.com/.well-known/oauth-authorization-server',
            jwksUri: 'https://auth.example.com/.well-known/jwks.json',
            audience: 'test-api',
            algorithms: ['RS256'],
            claimMappings: {
              legacyUsername: 'legacy_user',
              roles: 'user_roles',
              scopes: 'scopes'
            },
            security: {
              clockTolerance: 60,
              maxTokenAge: 3600,
              requireNbf: true
            }
          }]
        }
      };

      const result = UnifiedConfigSchema.safeParse(authOnlyConfig);
      expect(result.success).toBe(true);
    });

    it('should reject config without auth section', () => {
      const invalidConfig = {
        delegation: {
          modules: {}
        },
        mcp: {
          serverName: 'Test'
        }
      };

      const result = UnifiedConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });
  });

  describe('Type Guards', () => {
    describe('isLegacyConfig', () => {
      it('should detect legacy config format', () => {
        const legacyConfig = {
          trustedIDPs: [{
            issuer: 'https://auth.example.com',
            jwksUri: 'https://auth.example.com/.well-known/jwks.json',
            audience: 'test-api',
            algorithms: ['RS256'],
            claimMappings: {
              legacyUsername: 'legacy_user',
              roles: 'user_roles',
              scopes: 'scopes'
            }
          }],
          sql: {
            server: 'localhost',
            database: 'testdb'
          }
        };

        expect(isLegacyConfig(legacyConfig)).toBe(true);
      });

      it('should reject unified config format', () => {
        const unifiedConfig = {
          auth: {
            trustedIDPs: [{
              issuer: 'https://auth.example.com',
              jwksUri: 'https://auth.example.com/.well-known/jwks.json',
              audience: 'test-api',
              algorithms: ['RS256'],
              claimMappings: {
                legacyUsername: 'legacy_user',
                roles: 'user_roles',
                scopes: 'scopes'
              }
            }]
          }
        };

        expect(isLegacyConfig(unifiedConfig)).toBe(false);
      });
    });

    describe('isUnifiedConfig', () => {
      it('should detect unified config format', () => {
        const unifiedConfig = {
          auth: {
            trustedIDPs: [{
              issuer: 'https://auth.example.com',
              jwksUri: 'https://auth.example.com/.well-known/jwks.json',
              audience: 'test-api',
              algorithms: ['RS256'],
              claimMappings: {
                legacyUsername: 'legacy_user',
                roles: 'user_roles',
                scopes: 'scopes'
              }
            }]
          }
        };

        expect(isUnifiedConfig(unifiedConfig)).toBe(true);
      });

      it('should reject legacy config format', () => {
        const legacyConfig = {
          trustedIDPs: [{
            issuer: 'https://auth.example.com',
            jwksUri: 'https://auth.example.com/.well-known/jwks.json',
            audience: 'test-api',
            algorithms: ['RS256'],
            claimMappings: {
              legacyUsername: 'legacy_user',
              roles: 'user_roles',
              scopes: 'scopes'
            }
          }]
        };

        expect(isUnifiedConfig(legacyConfig)).toBe(false);
      });
    });
  });
});
