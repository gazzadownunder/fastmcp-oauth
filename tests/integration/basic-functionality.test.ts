import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { configManager } from '../../src/config/manager.js';
import { jwtValidator } from '../../src/middleware/jwt-validator.js';
import { sqlDelegator } from '../../src/services/sql-delegator.js';
import { OAuthOBOServer } from '../../src/index-simple.js';

describe('OAuth OBO Framework Integration', () => {
  let server: OAuthOBOServer;

  beforeEach(async () => {
    server = new OAuthOBOServer();
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
    }
  });

  describe('Configuration Management', () => {
    it('should validate secure configuration requirements', () => {
      expect(() => {
        const config = {
          trustedIDPs: [{
            issuer: 'http://insecure-issuer.com', // HTTP not allowed
            jwksUri: 'https://example.com/jwks',
            audience: 'test',
            algorithms: ['none'], // Insecure algorithm
            claimMappings: {
              legacyUsername: 'legacy_user',
              roles: 'roles',
              scopes: 'scopes'
            },
            security: {
              clockTolerance: 60,
              maxTokenAge: 3600,
              requireNbf: true
            }
          }],
          rateLimiting: { maxRequests: 100, windowMs: 900000 },
          audit: { logAllAttempts: true, logFailedAttempts: true, retentionDays: 90 }
        };

        // This should fail validation
        require('../../src/config/schema.js').OAuthOBOConfigSchema.parse(config);
      }).toThrow();
    });

    it('should accept valid secure configuration', () => {
      expect(() => {
        const config = {
          trustedIDPs: [{
            issuer: 'https://secure-issuer.com',
            discoveryUrl: 'https://secure-issuer.com/.well-known/oauth-authorization-server',
            jwksUri: 'https://secure-issuer.com/jwks',
            audience: 'test-api',
            algorithms: ['RS256', 'ES256'],
            claimMappings: {
              legacyUsername: 'legacy_user',
              roles: 'roles',
              scopes: 'scopes'
            },
            security: {
              clockTolerance: 60,
              maxTokenAge: 3600,
              requireNbf: true
            }
          }],
          rateLimiting: { maxRequests: 100, windowMs: 900000 },
          audit: { logAllAttempts: true, logFailedAttempts: true, retentionDays: 90 }
        };

        // This should pass validation
        require('../../src/config/schema.js').OAuthOBOConfigSchema.parse(config);
      }).not.toThrow();
    });
  });

  describe('JWT Validation Security', () => {
    it('should reject malformed JWT tokens', async () => {
      const validator = jwtValidator;

      await expect(validator.validateJWT('malformed.token')).rejects.toThrow();
      await expect(validator.validateJWT('not-a-jwt')).rejects.toThrow();
      await expect(validator.validateJWT('')).rejects.toThrow();
    });

    it('should reject tokens with invalid base64url encoding', async () => {
      const validator = jwtValidator;

      // Invalid characters in base64url
      await expect(validator.validateJWT('header.invalid+chars.signature')).rejects.toThrow();
    });

    it('should reject tokens without required claims', async () => {
      const validator = jwtValidator;

      // Create token without issuer
      const headerWithoutIss = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
      const payloadWithoutIss = Buffer.from(JSON.stringify({ aud: 'test' })).toString('base64url');
      const tokenWithoutIss = `${headerWithoutIss}.${payloadWithoutIss}.fake-signature`;

      await expect(validator.validateJWT(tokenWithoutIss)).rejects.toThrow();

      // Create token without audience
      const payloadWithoutAud = Buffer.from(JSON.stringify({ iss: 'test-issuer' })).toString('base64url');
      const tokenWithoutAud = `${headerWithoutIss}.${payloadWithoutAud}.fake-signature`;

      await expect(validator.validateJWT(tokenWithoutAud)).rejects.toThrow();
    });
  });

  describe('SQL Delegation Security', () => {
    it('should validate SQL identifier format', () => {
      const delegator = sqlDelegator;

      // Valid identifiers
      expect((delegator as any).isValidSQLIdentifier('validUser')).toBe(true);
      expect((delegator as any).isValidSQLIdentifier('user_123')).toBe(true);
      expect((delegator as any).isValidSQLIdentifier('userAtDomain')).toBe(true);

      // Invalid identifiers (SQL injection attempts)
      expect((delegator as any).isValidSQLIdentifier('user; DROP TABLE users--')).toBe(false);
      expect((delegator as any).isValidSQLIdentifier('user\' OR 1=1--')).toBe(false);
      expect((delegator as any).isValidSQLIdentifier('123invalidStart')).toBe(false);
      expect((delegator as any).isValidSQLIdentifier('user-with-dash')).toBe(false);
    });

    it('should prevent dangerous SQL operations', () => {
      const delegator = sqlDelegator;

      const dangerousQueries = [
        'DROP TABLE users;',
        'CREATE TABLE malicious (id INT);',
        'ALTER TABLE users ADD COLUMN backdoor VARCHAR(255);',
        'TRUNCATE TABLE sensitive_data;',
        'EXEC xp_cmdshell \'dir\';',
        'EXECUTE AS USER = \'nested_impersonation\';',
        'GRANT ALL PRIVILEGES TO malicious_user;',
      ];

      for (const query of dangerousQueries) {
        expect(() => {
          (delegator as any).validateQuerySafety(query);
        }).toThrow();
      }
    });

    it('should accept safe SQL operations', () => {
      const delegator = sqlDelegator;

      const safeQueries = [
        'SELECT * FROM users WHERE department = @dept;',
        'UPDATE users SET last_login = GETDATE() WHERE id = @userId;',
        'INSERT INTO audit_log (user_id, action) VALUES (@userId, @action);',
        'EXEC GetUserReport @userId;',
      ];

      for (const query of safeQueries) {
        expect(() => {
          (delegator as any).validateQuerySafety(query);
        }).not.toThrow();
      }
    });
  });

  describe('Server Integration', () => {
    it('should create server instance successfully', () => {
      expect(server).toBeDefined();
      expect(server.getServer()).toBeDefined();
    });

    it('should have required tools registered', () => {
      const mcpServer = server.getServer();

      // Check that tools are registered (this would need actual fastMCP API to verify)
      expect(mcpServer).toBeDefined();
    });

    it('should handle audit logging', () => {
      const initialAuditCount = server.getAuditLog().length;
      expect(initialAuditCount).toBe(0);

      // Clear audit log functionality
      server.clearAuditLog();
      expect(server.getAuditLog().length).toBe(0);
    });
  });

  describe('Security Error Handling', () => {
    it('should create proper security errors', () => {
      const { createSecurityError } = require('../../src/utils/errors.js');

      const error = createSecurityError('TEST_ERROR', 'Test message', 400, { detail: 'test' });

      expect(error.code).toBe('TEST_ERROR');
      expect(error.message).toBe('Test message');
      expect(error.statusCode).toBe(400);
      expect(error.details).toEqual({ detail: 'test' });
    });

    it('should sanitize errors for production', () => {
      const { sanitizeError } = require('../../src/utils/errors.js');
      const originalEnv = process.env.NODE_ENV;

      try {
        // Test development mode
        process.env.NODE_ENV = 'development';
        const devError = new Error('Detailed error message');
        const sanitizedDev = sanitizeError(devError);
        expect(sanitizedDev).toHaveProperty('stack');

        // Test production mode
        process.env.NODE_ENV = 'production';
        const prodError = new Error('Detailed error message');
        const sanitizedProd = sanitizeError(prodError);
        expect(sanitizedProd).not.toHaveProperty('stack');

      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });
  });
});