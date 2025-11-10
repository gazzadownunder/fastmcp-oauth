/**
 * Unit Tests for Legacy Configuration Schema (schema.ts)
 *
 * Tests Zod schema validation for the legacy OAuth OBO configuration format.
 * These schemas enforce security requirements like HTTPS URLs and secure algorithms.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  RoleMappingSchema,
  ClaimMappingsSchema,
  SecurityConfigSchema,
  IDPConfigSchema,
  RateLimitConfigSchema,
  AuditConfigSchema,
  KerberosConfigSchema,
  SQLConfigSchema,
  OAuthOBOConfigSchema,
  EnvironmentSchema,
} from '../../../src/config/schema.js';

describe('Configuration Schema Validation', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.NODE_ENV = originalEnv;
    } else {
      delete process.env.NODE_ENV;
    }
  });

  describe('RoleMappingSchema', () => {
    it('should accept valid role mappings', () => {
      const validMapping = {
        admin: ['admin', 'administrator'],
        user: ['user', 'member'],
        guest: ['guest'],
        defaultRole: 'guest' as const,
      };

      const result = RoleMappingSchema.parse(validMapping);
      expect(result).toEqual(validMapping);
    });

    it('should use default values for missing fields', () => {
      const minimalMapping = {};

      const result = RoleMappingSchema.parse(minimalMapping);

      expect(result.admin).toEqual(['admin', 'administrator']);
      expect(result.user).toEqual(['user']);
      expect(result.guest).toEqual([]);
      expect(result.defaultRole).toBe('guest');
    });

    it('should allow custom role mappings (passthrough)', () => {
      const customMapping = {
        admin: ['admin'],
        user: ['user'],
        auditor: ['auditor', 'audit-user'], // Custom role
        developer: ['dev'], // Custom role
        defaultRole: 'guest' as const,
      };

      const result = RoleMappingSchema.parse(customMapping);

      expect(result.auditor).toEqual(['auditor', 'audit-user']);
      expect(result.developer).toEqual(['dev']);
    });

    it('should reject invalid defaultRole values', () => {
      const invalidMapping = {
        defaultRole: 'invalid',
      };

      expect(() => RoleMappingSchema.parse(invalidMapping)).toThrow();
    });
  });

  describe('ClaimMappingsSchema', () => {
    it('should accept valid claim mappings', () => {
      const validClaims = {
        legacyUsername: 'legacy_sam_account',
        roles: 'user_roles',
        scopes: 'authorized_scopes',
        userId: 'sub',
        username: 'preferred_username',
      };

      const result = ClaimMappingsSchema.parse(validClaims);
      expect(result).toEqual(validClaims);
    });

    it('should accept minimal claim mappings', () => {
      const minimalClaims = {
        legacyUsername: 'legacy_name',
        roles: 'roles',
        scopes: 'scopes',
      };

      const result = ClaimMappingsSchema.parse(minimalClaims);
      expect(result.userId).toBeUndefined();
      expect(result.username).toBeUndefined();
    });

    it('should reject empty claim mapping values', () => {
      const invalidClaims = {
        legacyUsername: '',
        roles: 'roles',
        scopes: 'scopes',
      };

      expect(() => ClaimMappingsSchema.parse(invalidClaims)).toThrow();
    });

    it('should reject missing required fields', () => {
      const missingClaims = {
        legacyUsername: 'legacy_name',
        // Missing roles and scopes
      };

      expect(() => ClaimMappingsSchema.parse(missingClaims)).toThrow();
    });
  });

  describe('SecurityConfigSchema', () => {
    it('should accept valid security configuration', () => {
      const validSecurity = {
        clockTolerance: 60,
        maxTokenAge: 3600,
        requireNbf: true,
      };

      const result = SecurityConfigSchema.parse(validSecurity);
      expect(result).toEqual(validSecurity);
    });

    it('should reject clockTolerance > 300 seconds', () => {
      const invalidSecurity = {
        clockTolerance: 600, // 10 minutes (too high)
        maxTokenAge: 3600,
        requireNbf: true,
      };

      expect(() => SecurityConfigSchema.parse(invalidSecurity)).toThrow();
    });

    it('should reject clockTolerance < 0', () => {
      const invalidSecurity = {
        clockTolerance: -1,
        maxTokenAge: 3600,
        requireNbf: true,
      };

      expect(() => SecurityConfigSchema.parse(invalidSecurity)).toThrow();
    });

    it('should reject maxTokenAge < 300 seconds', () => {
      const invalidSecurity = {
        clockTolerance: 60,
        maxTokenAge: 120, // 2 minutes (too low)
        requireNbf: true,
      };

      expect(() => SecurityConfigSchema.parse(invalidSecurity)).toThrow();
    });

    it('should reject maxTokenAge > 7200 seconds', () => {
      const invalidSecurity = {
        clockTolerance: 60,
        maxTokenAge: 10800, // 3 hours (too high)
        requireNbf: true,
      };

      expect(() => SecurityConfigSchema.parse(invalidSecurity)).toThrow();
    });

    it('should accept edge case values', () => {
      const edgeCaseSecurity = {
        clockTolerance: 0, // Minimum
        maxTokenAge: 300, // Minimum (5 minutes)
        requireNbf: false,
      };

      const result = SecurityConfigSchema.parse(edgeCaseSecurity);
      expect(result.clockTolerance).toBe(0);
      expect(result.maxTokenAge).toBe(300);
    });
  });

  describe('IDPConfigSchema', () => {
    it('should accept valid HTTPS IDP configuration in production', () => {
      process.env.NODE_ENV = 'production';

      const validIDP = {
        issuer: 'https://auth.example.com',
        discoveryUrl: 'https://auth.example.com/.well-known/openid-configuration',
        jwksUri: 'https://auth.example.com/.well-known/jwks.json',
        audience: 'mcp-server',
        algorithms: ['RS256', 'ES256'] as const,
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
      };

      const result = IDPConfigSchema.parse(validIDP);
      expect(result.issuer).toBe(validIDP.issuer);
    });

    it('should reject HTTP URLs in production', () => {
      process.env.NODE_ENV = 'production';

      const httpIDP = {
        issuer: 'http://auth.example.com', // HTTP not allowed in production
        discoveryUrl: 'https://auth.example.com/.well-known/openid-configuration',
        jwksUri: 'https://auth.example.com/.well-known/jwks.json',
        audience: 'mcp-server',
        algorithms: ['RS256'] as const,
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
      };

      expect(() => IDPConfigSchema.parse(httpIDP)).toThrow('must use HTTPS');
    });

    it('should allow HTTP URLs in development', () => {
      process.env.NODE_ENV = 'development';

      const httpIDP = {
        issuer: 'http://localhost:8080',
        discoveryUrl: 'http://localhost:8080/.well-known/openid-configuration',
        jwksUri: 'http://localhost:8080/.well-known/jwks.json',
        audience: 'mcp-server',
        algorithms: ['RS256'] as const,
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
      };

      const result = IDPConfigSchema.parse(httpIDP);
      expect(result.issuer).toBe('http://localhost:8080');
    });

    it('should allow HTTP URLs in test environment', () => {
      process.env.NODE_ENV = 'test';

      const httpIDP = {
        issuer: 'http://localhost:8080',
        discoveryUrl: 'http://localhost:8080/.well-known/openid-configuration',
        jwksUri: 'http://localhost:8080/.well-known/jwks.json',
        audience: 'mcp-server',
        algorithms: ['ES256'] as const,
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
      };

      const result = IDPConfigSchema.parse(httpIDP);
      expect(result.issuer).toBe('http://localhost:8080');
    });

    it('should reject insecure algorithms', () => {
      const insecureIDP = {
        issuer: 'https://auth.example.com',
        discoveryUrl: 'https://auth.example.com/.well-known/openid-configuration',
        jwksUri: 'https://auth.example.com/.well-known/jwks.json',
        audience: 'mcp-server',
        algorithms: ['HS256'] as any, // Insecure algorithm
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
      };

      expect(() => IDPConfigSchema.parse(insecureIDP)).toThrow();
    });

    it('should require at least one secure algorithm', () => {
      const noSecureAlg = {
        issuer: 'https://auth.example.com',
        discoveryUrl: 'https://auth.example.com/.well-known/openid-configuration',
        jwksUri: 'https://auth.example.com/.well-known/jwks.json',
        audience: 'mcp-server',
        algorithms: [] as any, // Empty algorithms
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
      };

      expect(() => IDPConfigSchema.parse(noSecureAlg)).toThrow();
    });

    it('should accept RS256 only', () => {
      const rs256Only = {
        issuer: 'https://auth.example.com',
        discoveryUrl: 'https://auth.example.com/.well-known/openid-configuration',
        jwksUri: 'https://auth.example.com/.well-known/jwks.json',
        audience: 'mcp-server',
        algorithms: ['RS256'] as const,
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
      };

      const result = IDPConfigSchema.parse(rs256Only);
      expect(result.algorithms).toEqual(['RS256']);
    });

    it('should accept ES256 only', () => {
      const es256Only = {
        issuer: 'https://auth.example.com',
        discoveryUrl: 'https://auth.example.com/.well-known/openid-configuration',
        jwksUri: 'https://auth.example.com/.well-known/jwks.json',
        audience: 'mcp-server',
        algorithms: ['ES256'] as const,
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
      };

      const result = IDPConfigSchema.parse(es256Only);
      expect(result.algorithms).toEqual(['ES256']);
    });
  });

  describe('RateLimitConfigSchema', () => {
    it('should accept valid rate limit configuration', () => {
      const validRateLimit = {
        maxRequests: 100,
        windowMs: 900000, // 15 minutes
      };

      const result = RateLimitConfigSchema.parse(validRateLimit);
      expect(result).toEqual(validRateLimit);
    });

    it('should reject maxRequests < 1', () => {
      const invalidRateLimit = {
        maxRequests: 0,
        windowMs: 900000,
      };

      expect(() => RateLimitConfigSchema.parse(invalidRateLimit)).toThrow();
    });

    it('should reject maxRequests > 10000', () => {
      const invalidRateLimit = {
        maxRequests: 20000,
        windowMs: 900000,
      };

      expect(() => RateLimitConfigSchema.parse(invalidRateLimit)).toThrow();
    });

    it('should reject windowMs < 60000 (1 minute)', () => {
      const invalidRateLimit = {
        maxRequests: 100,
        windowMs: 30000, // 30 seconds (too short)
      };

      expect(() => RateLimitConfigSchema.parse(invalidRateLimit)).toThrow();
    });

    it('should reject windowMs > 3600000 (1 hour)', () => {
      const invalidRateLimit = {
        maxRequests: 100,
        windowMs: 7200000, // 2 hours (too long)
      };

      expect(() => RateLimitConfigSchema.parse(invalidRateLimit)).toThrow();
    });

    it('should accept edge case values', () => {
      const edgeCaseRateLimit = {
        maxRequests: 1, // Minimum
        windowMs: 60000, // Minimum (1 minute)
      };

      const result = RateLimitConfigSchema.parse(edgeCaseRateLimit);
      expect(result.maxRequests).toBe(1);
      expect(result.windowMs).toBe(60000);
    });
  });

  describe('AuditConfigSchema', () => {
    it('should accept valid audit configuration', () => {
      const validAudit = {
        logAllAttempts: true,
        logFailedAttempts: true,
        retentionDays: 90,
      };

      const result = AuditConfigSchema.parse(validAudit);
      expect(result).toEqual(validAudit);
    });

    it('should accept selective logging', () => {
      const selectiveAudit = {
        logAllAttempts: false,
        logFailedAttempts: true,
        retentionDays: 30,
      };

      const result = AuditConfigSchema.parse(selectiveAudit);
      expect(result.logAllAttempts).toBe(false);
      expect(result.logFailedAttempts).toBe(true);
    });

    it('should reject retentionDays < 1', () => {
      const invalidAudit = {
        logAllAttempts: true,
        logFailedAttempts: true,
        retentionDays: 0,
      };

      expect(() => AuditConfigSchema.parse(invalidAudit)).toThrow();
    });

    it('should reject retentionDays > 365', () => {
      const invalidAudit = {
        logAllAttempts: true,
        logFailedAttempts: true,
        retentionDays: 400,
      };

      expect(() => AuditConfigSchema.parse(invalidAudit)).toThrow();
    });

    it('should accept maximum retention period', () => {
      const maxRetention = {
        logAllAttempts: true,
        logFailedAttempts: true,
        retentionDays: 365, // Maximum (1 year)
      };

      const result = AuditConfigSchema.parse(maxRetention);
      expect(result.retentionDays).toBe(365);
    });
  });

  describe('KerberosConfigSchema', () => {
    it('should accept valid Kerberos configuration', () => {
      const validKerberos = {
        serviceAccount: 'svc-mcp-server',
        keytabPath: '/etc/keytabs/svc-mcp-server.keytab',
        realm: 'EXAMPLE.COM',
        kdc: 'kdc.example.com',
      };

      const result = KerberosConfigSchema.parse(validKerberos);
      expect(result).toEqual(validKerberos);
    });

    it('should reject empty service account', () => {
      const invalidKerberos = {
        serviceAccount: '',
        keytabPath: '/etc/keytabs/svc-mcp-server.keytab',
        realm: 'EXAMPLE.COM',
        kdc: 'kdc.example.com',
      };

      expect(() => KerberosConfigSchema.parse(invalidKerberos)).toThrow();
    });

    it('should reject missing required fields', () => {
      const incompleteKerberos = {
        serviceAccount: 'svc-mcp-server',
        // Missing keytabPath, realm, kdc
      };

      expect(() => KerberosConfigSchema.parse(incompleteKerberos)).toThrow();
    });
  });

  describe('SQLConfigSchema', () => {
    it('should accept valid SQL configuration', () => {
      const validSQL = {
        server: 'sql-server.example.com',
        database: 'myapp_db',
        options: {
          trustedConnection: true,
          enableArithAbort: true,
        },
      };

      const result = SQLConfigSchema.parse(validSQL);
      expect(result).toEqual(validSQL);
    });

    it('should allow additional options (passthrough)', () => {
      const sqlWithExtraOptions = {
        server: 'sql-server.example.com',
        database: 'myapp_db',
        options: {
          trustedConnection: true,
          enableArithAbort: true,
          encrypt: true, // Additional option
          port: 1433, // Additional option
        },
      };

      const result = SQLConfigSchema.parse(sqlWithExtraOptions);
      expect(result.options.encrypt).toBe(true);
      expect(result.options.port).toBe(1433);
    });

    it('should reject empty server name', () => {
      const invalidSQL = {
        server: '',
        database: 'myapp_db',
        options: {
          trustedConnection: true,
          enableArithAbort: true,
        },
      };

      expect(() => SQLConfigSchema.parse(invalidSQL)).toThrow();
    });
  });

  describe('OAuthOBOConfigSchema', () => {
    it('should accept valid full configuration', () => {
      const validConfig = {
        trustedIDPs: [
          {
            issuer: 'https://auth.example.com',
            discoveryUrl: 'https://auth.example.com/.well-known/openid-configuration',
            jwksUri: 'https://auth.example.com/.well-known/jwks.json',
            audience: 'mcp-server',
            algorithms: ['RS256', 'ES256'] as const,
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
        rateLimiting: {
          maxRequests: 100,
          windowMs: 900000,
        },
        audit: {
          logAllAttempts: true,
          logFailedAttempts: true,
          retentionDays: 90,
        },
        kerberos: {
          serviceAccount: 'svc-mcp-server',
          keytabPath: '/etc/keytabs/svc-mcp-server.keytab',
          realm: 'EXAMPLE.COM',
          kdc: 'kdc.example.com',
        },
        sql: {
          server: 'sql-server.example.com',
          database: 'myapp_db',
          options: {
            trustedConnection: true,
            enableArithAbort: true,
          },
        },
      };

      const result = OAuthOBOConfigSchema.parse(validConfig);
      expect(result.trustedIDPs).toHaveLength(1);
      expect(result.kerberos).toBeDefined();
      expect(result.sql).toBeDefined();
    });

    it('should accept minimal configuration without optional fields', () => {
      const minimalConfig = {
        trustedIDPs: [
          {
            issuer: 'https://auth.example.com',
            discoveryUrl: 'https://auth.example.com/.well-known/openid-configuration',
            jwksUri: 'https://auth.example.com/.well-known/jwks.json',
            audience: 'mcp-server',
            algorithms: ['RS256'] as const,
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
        rateLimiting: {
          maxRequests: 100,
          windowMs: 900000,
        },
        audit: {
          logAllAttempts: true,
          logFailedAttempts: true,
          retentionDays: 90,
        },
      };

      const result = OAuthOBOConfigSchema.parse(minimalConfig);
      expect(result.kerberos).toBeUndefined();
      expect(result.sql).toBeUndefined();
    });

    it('should require at least one trusted IDP', () => {
      const noIDPs = {
        trustedIDPs: [],
        rateLimiting: {
          maxRequests: 100,
          windowMs: 900000,
        },
        audit: {
          logAllAttempts: true,
          logFailedAttempts: true,
          retentionDays: 90,
        },
      };

      expect(() => OAuthOBOConfigSchema.parse(noIDPs)).toThrow();
    });
  });

  describe('EnvironmentSchema', () => {
    it('should accept valid environment configuration', () => {
      const validEnv = {
        NODE_ENV: 'production' as const,
        LOG_LEVEL: 'info' as const,
        SERVER_PORT: '3000',
        CONFIG_PATH: './config/oauth-obo.json',
        SECRETS_PATH: './secrets',
      };

      const result = EnvironmentSchema.parse(validEnv);
      expect(result.NODE_ENV).toBe('production');
      expect(result.SERVER_PORT).toBe(3000); // Transformed to number
    });

    it('should use default values for missing fields', () => {
      const minimalEnv = {};

      const result = EnvironmentSchema.parse(minimalEnv);

      expect(result.NODE_ENV).toBe('development');
      expect(result.LOG_LEVEL).toBe('info');
      expect(result.SERVER_PORT).toBe(3000);
    });

    it('should transform SERVER_PORT string to number', () => {
      const envWithPort = {
        SERVER_PORT: '8080',
      };

      const result = EnvironmentSchema.parse(envWithPort);

      expect(result.SERVER_PORT).toBe(8080);
      expect(typeof result.SERVER_PORT).toBe('number');
    });

    it('should reject invalid NODE_ENV values', () => {
      const invalidEnv = {
        NODE_ENV: 'staging', // Not in enum
      };

      expect(() => EnvironmentSchema.parse(invalidEnv)).toThrow();
    });

    it('should reject invalid LOG_LEVEL values', () => {
      const invalidEnv = {
        LOG_LEVEL: 'trace', // Not in enum
      };

      expect(() => EnvironmentSchema.parse(invalidEnv)).toThrow();
    });

    it('should reject non-numeric SERVER_PORT', () => {
      const invalidEnv = {
        SERVER_PORT: 'abc',
      };

      expect(() => EnvironmentSchema.parse(invalidEnv)).toThrow();
    });

    it('should accept all valid NODE_ENV values', () => {
      const envs = ['development', 'test', 'production'] as const;

      for (const env of envs) {
        const result = EnvironmentSchema.parse({ NODE_ENV: env });
        expect(result.NODE_ENV).toBe(env);
      }
    });

    it('should accept all valid LOG_LEVEL values', () => {
      const levels = ['debug', 'info', 'warn', 'error'] as const;

      for (const level of levels) {
        const result = EnvironmentSchema.parse({ LOG_LEVEL: level });
        expect(result.LOG_LEVEL).toBe(level);
      }
    });
  });
});
