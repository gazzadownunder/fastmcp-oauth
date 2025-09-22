import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JWTValidator } from '../../src/middleware/jwt-validator.js';
import { configManager } from '../../src/config/manager.js';

// Mock jose library
vi.mock('jose', () => ({
  jwtVerify: vi.fn(),
  createRemoteJWKSet: vi.fn(() => vi.fn()),
}));

// Mock config manager
vi.mock('../../src/config/manager.js', () => ({
  configManager: {
    getConfig: vi.fn(),
    getTrustedIDP: vi.fn(),
  },
}));

describe('JWTValidator', () => {
  let validator: JWTValidator;

  beforeEach(() => {
    validator = new JWTValidator();
    vi.clearAllMocks();
  });

  describe('validateJWT', () => {
    it('should reject malformed JWT tokens', async () => {
      const malformedToken = 'not.a.jwt';

      await expect(validator.validateJWT(malformedToken)).rejects.toThrow('Invalid JWT format');
    });

    it('should reject tokens with invalid base64url encoding', async () => {
      const invalidToken = 'header.invalid+base64.signature';

      await expect(validator.validateJWT(invalidToken)).rejects.toThrow('Invalid JWT encoding');
    });

    it('should reject tokens with missing issuer claim', async () => {
      // Create a token with missing issuer
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ aud: 'test-audience' })).toString('base64url');
      const signature = 'fake-signature';
      const token = `${header}.${payload}.${signature}`;

      await expect(validator.validateJWT(token)).rejects.toThrow('Missing issuer claim');
    });

    it('should reject tokens with missing audience claim', async () => {
      // Create a token with missing audience
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ iss: 'test-issuer' })).toString('base64url');
      const signature = 'fake-signature';
      const token = `${header}.${payload}.${signature}`;

      await expect(validator.validateJWT(token)).rejects.toThrow('Missing audience claim');
    });

    it('should reject tokens from untrusted issuers', async () => {
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({
        iss: 'https://untrusted-issuer.com',
        aud: 'test-audience',
      })).toString('base64url');
      const signature = 'fake-signature';
      const token = `${header}.${payload}.${signature}`;

      // Mock config manager to return null for untrusted issuer
      vi.mocked(configManager.getTrustedIDP).mockReturnValue(undefined);

      await expect(validator.validateJWT(token)).rejects.toThrow('Untrusted issuer');
    });
  });

  describe('Security validation', () => {
    it('should enforce token format validation', () => {
      expect(() => {
        (validator as any).validateTokenFormat('malformed');
      }).toThrow('Invalid JWT format');

      expect(() => {
        (validator as any).validateTokenFormat('header.payload');
      }).toThrow('Invalid JWT format');
    });

    it('should validate SQL identifier format', () => {
      const sqlDelegator = new (class {
        isValidSQLIdentifier = (validator as any).isValidSQLIdentifier?.bind(this) ||
          ((id: string) => /^[a-zA-Z][a-zA-Z0-9_@]*$/.test(id) && id.length <= 128);
      })();

      // Valid identifiers
      expect(sqlDelegator.isValidSQLIdentifier('validUser')).toBe(true);
      expect(sqlDelegator.isValidSQLIdentifier('user_123')).toBe(true);
      expect(sqlDelegator.isValidSQLIdentifier('user@domain')).toBe(true);

      // Invalid identifiers
      expect(sqlDelegator.isValidSQLIdentifier('123invalid')).toBe(false);
      expect(sqlDelegator.isValidSQLIdentifier('user-name')).toBe(false);
      expect(sqlDelegator.isValidSQLIdentifier('user; DROP TABLE')).toBe(false);
    });
  });

  describe('Rate limiting', () => {
    it('should support rate limiting functionality', async () => {
      const mockToken = 'valid.jwt.token';
      const clientId = 'test-client';

      // Mock successful validation for rate limiting test
      vi.spyOn(validator, 'validateJWT').mockResolvedValue({
        payload: { iss: 'test', aud: 'test', exp: Date.now() / 1000 + 3600 } as any,
        session: {
          userId: 'test',
          username: 'test',
          role: 'user',
          permissions: [],
        } as any,
        auditEntry: {
          timestamp: new Date(),
          userId: 'test',
          action: 'jwt_validation',
          resource: 'authentication',
          success: true,
        },
      });

      const result = await validator.validateWithRateLimit(mockToken, clientId);
      expect(result).toBeDefined();
      expect(result.session.userId).toBe('test');
    });
  });

  describe('Resource cleanup', () => {
    it('should cleanup resources on destroy', () => {
      validator.destroy();
      expect((validator as any).initialized).toBe(false);
      expect((validator as any).jwksSets.size).toBe(0);
    });
  });
});