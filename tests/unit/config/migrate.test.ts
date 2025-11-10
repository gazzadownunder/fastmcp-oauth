import { describe, it, expect } from 'vitest';
import { migrateConfig, migrateConfigData } from '../../../src/config/migrate.js';

describe('Config Migration', () => {
  describe('migrateConfig', () => {
    it('should migrate legacy config to unified format', () => {
      const legacyConfig = {
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
        rateLimiting: {
          maxRequests: 100,
          windowMs: 900000
        },
        audit: {
          enabled: true,
          logAllAttempts: true,
          retentionDays: 90
        },
        sql: {
          server: 'localhost',
          database: 'testdb',
          options: {
            trustedConnection: true,
            encrypt: true
          }
        }
      };

      const result = migrateConfig(legacyConfig);

      // Check structure
      expect(result).toHaveProperty('auth');
      expect(result).toHaveProperty('delegation');
      expect(result).toHaveProperty('mcp');

      // Check auth section
      expect(result.auth.trustedIDPs).toEqual(legacyConfig.trustedIDPs);
      // Audit config gets logFailedAttempts default added
      expect(result.auth.audit?.enabled).toBe(legacyConfig.audit.enabled);
      expect(result.auth.audit?.logAllAttempts).toBe(legacyConfig.audit.logAllAttempts);
      expect(result.auth.audit?.retentionDays).toBe(legacyConfig.audit.retentionDays);

      // Check delegation section
      expect(result.delegation?.modules?.sql).toEqual(legacyConfig.sql);

      // Check MCP section has defaults
      expect(result.mcp).toBeDefined();
      expect(result.mcp?.serverName).toBeDefined();
    });

    it('should migrate config with only auth fields', () => {
      const legacyConfig = {
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
        }],
        audit: {
          enabled: true,
          logAllAttempts: false,
          retentionDays: 30
        }
      };

      const result = migrateConfig(legacyConfig);

      expect(result.auth.trustedIDPs).toEqual(legacyConfig.trustedIDPs);
      expect(result.auth.audit?.enabled).toBe(legacyConfig.audit.enabled);
      expect(result.auth.audit?.logAllAttempts).toBe(legacyConfig.audit.logAllAttempts);
      expect(result.delegation).toBeUndefined();
      expect(result.mcp).toBeDefined();
    });

    it('should migrate config with SQL delegation', () => {
      const legacyConfig = {
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
        }],
        sql: {
          server: 'sql.example.com',
          database: 'mydb',
          options: {
            user: 'dbuser',
            password: 'dbpass',
            encrypt: true
          }
        }
      };

      const result = migrateConfig(legacyConfig);

      expect(result.delegation?.modules?.sql).toEqual(legacyConfig.sql);
      expect(result.delegation?.modules?.sql?.server).toBe('sql.example.com');
      expect(result.delegation?.modules?.sql?.database).toBe('mydb');
    });

    it('should migrate config with Kerberos delegation', () => {
      const legacyConfig = {
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
        }],
        kerberos: {
          serviceAccount: 'svc_mcp_oauth',
          keytabPath: '/etc/krb5.keytab',
          realm: 'EXAMPLE.COM',
          kdc: 'kdc.example.com'
        }
      };

      const result = migrateConfig(legacyConfig);

      expect(result.delegation?.modules?.kerberos).toEqual(legacyConfig.kerberos);
    });

    it('should handle rate limiting migration', () => {
      const legacyConfig = {
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
        }],
        rateLimiting: {
          maxRequests: 200,
          windowMs: 600000
        }
      };

      const result = migrateConfig(legacyConfig);

      expect(result.auth.rateLimiting).toEqual(legacyConfig.rateLimiting);
    });

    it('should preserve all IDP configurations', () => {
      const legacyConfig = {
        trustedIDPs: [
          {
            issuer: 'https://auth1.example.com',
            discoveryUrl: 'https://auth1.example.com/.well-known/oauth-authorization-server',
            jwksUri: 'https://auth1.example.com/.well-known/jwks.json',
            audience: 'api1',
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
          },
          {
            issuer: 'https://auth2.example.com',
            discoveryUrl: 'https://auth2.example.com/.well-known/oauth-authorization-server',
            jwksUri: 'https://auth2.example.com/.well-known/jwks.json',
            audience: 'api2',
            algorithms: ['ES256'],
            claimMappings: {
              legacyUsername: 'sam_account',
              roles: 'roles',
              scopes: 'permissions'
            },
            security: {
              clockTolerance: 60,
              maxTokenAge: 3600,
              requireNbf: true
            }
          }
        ]
      };

      const result = migrateConfig(legacyConfig);

      expect(result.auth.trustedIDPs).toHaveLength(2);
      expect(result.auth.trustedIDPs[0].issuer).toBe('https://auth1.example.com');
      expect(result.auth.trustedIDPs[1].issuer).toBe('https://auth2.example.com');
    });

    it('should add default MCP config', () => {
      const legacyConfig = {
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

      const result = migrateConfig(legacyConfig);

      expect(result.mcp).toBeDefined();
      expect(result.mcp?.serverName).toBe('mcp-oauth-server');
      expect(result.mcp?.version).toBe('1.0.0');
      expect(result.mcp?.transport).toBe('http-stream');
      expect(result.mcp?.port).toBe(3000);
    });

    it('should validate migrated config', () => {
      const legacyConfig = {
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

      // Should not throw
      expect(() => migrateConfig(legacyConfig)).not.toThrow();
    });

    it('should migrate config with both SQL and Kerberos', () => {
      const legacyConfig = {
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
        }],
        sql: {
          server: 'localhost',
          database: 'testdb',
          options: {
            trustedConnection: true,
            encrypt: true
          }
        },
        kerberos: {
          enabled: true,
          domainController: 'dc.company.com',
          servicePrincipalName: 'HTTP/mcp-server.company.com',
          realm: 'COMPANY.COM',
          serviceAccount: {
            username: 'svc-mcp-server',
            password: 'SecurePassword123!'
          }
        }
      };

      const result = migrateConfig(legacyConfig);

      expect(result.delegation).toBeDefined();
      expect(result.delegation?.modules?.sql).toBeDefined();
      expect(result.delegation?.modules?.kerberos).toBeDefined();
    });

    it('should migrate config with only Kerberos (no SQL)', () => {
      const legacyConfig = {
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
        }],
        kerberos: {
          enabled: true,
          domainController: 'dc.company.com',
          servicePrincipalName: 'HTTP/mcp-server.company.com',
          realm: 'COMPANY.COM',
          serviceAccount: {
            username: 'svc-mcp-server',
            password: 'SecurePassword123!'
          }
        }
      };

      const result = migrateConfig(legacyConfig);

      expect(result.delegation).toBeDefined();
      expect(result.delegation?.modules?.sql).toBeUndefined();
      expect(result.delegation?.modules?.kerberos).toBeDefined();
    });

    it('should throw error with descriptive message when validation fails', () => {
      const invalidConfig = {
        trustedIDPs: [] // Invalid: empty array
      };

      expect(() => migrateConfig(invalidConfig)).toThrow('Configuration migration failed');
    });

    it('should handle unknown errors during migration', () => {
      // Pass a completely malformed config that will cause unexpected errors
      const malformedConfig: any = {
        trustedIDPs: null // Will cause runtime error
      };

      expect(() => migrateConfig(malformedConfig)).toThrow('Configuration migration failed');
    });
  });

  describe('migrateConfigData', () => {
    it('should migrate legacy config data format', () => {
      const oldData = {
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

      const result = migrateConfigData(oldData);

      expect(result).toHaveProperty('auth');
      expect(result).toHaveProperty('mcp');
    });

    it('should return validated config if already in new format', () => {
      const newData = {
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
        mcp: {
          serverName: 'mcp-oauth-server',
          version: '1.0.0',
          transport: 'http-stream',
          port: 3000
        }
      };

      const result = migrateConfigData(newData);

      expect(result.auth.trustedIDPs).toHaveLength(1);
      expect(result.mcp.serverName).toBe('mcp-oauth-server');
    });

    it('should throw error for non-object input', () => {
      expect(() => migrateConfigData('not an object')).toThrow('Configuration must be an object');
    });

    it('should throw error for null input', () => {
      expect(() => migrateConfigData(null)).toThrow('Configuration must be an object');
    });

    it('should throw error for unrecognized config format', () => {
      const unknownFormat = {
        someRandomKey: 'value',
        anotherKey: 123
      };

      expect(() => migrateConfigData(unknownFormat)).toThrow('Unrecognized configuration format');
    });

    it('should throw error for array input', () => {
      expect(() => migrateConfigData([])).toThrow('Unrecognized configuration format');
    });
  });
});
