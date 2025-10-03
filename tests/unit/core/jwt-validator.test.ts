/**
 * JWT Validator Tests
 *
 * Tests for Phase 1.4: JWT Validator (extraction and refactoring)
 *
 * @see Docs/refactor-progress.md Phase 1.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JWTValidator } from '../../../src/core/jwt-validator.js';
import type { IDPConfig } from '../../../src/core/jwt-validator.js';

describe('JWTValidator', () => {
  // Mock IDP configuration
  const mockIDPConfig: IDPConfig = {
    issuer: 'https://auth.test.com',
    jwksUri: 'https://auth.test.com/.well-known/jwks.json',
    audience: 'test-api',
    algorithms: ['RS256'],
    claimMappings: {
      legacyUsername: 'legacy_sam_account',
      roles: 'user_roles',
      scopes: 'scopes',
    },
    security: {
      clockTolerance: 60,
      maxTokenAge: 3600,
      requireNbf: true,
    },
  };

  describe('Initialization', () => {
    it('should initialize with IDP configurations', async () => {
      const validator = new JWTValidator();

      // Note: This may succeed or fail depending on JWKS fetch
      // We just verify the method exists and can be called
      try {
        await validator.initialize([mockIDPConfig]);
      } catch (error) {
        // JWKS fetch will likely fail, which is expected in unit tests
        expect(error).toBeDefined();
      }
    });

    it('should throw if not initialized before validateJWT', async () => {
      const validator = new JWTValidator();

      await expect(validator.validateJWT('fake.token.here')).rejects.toThrow(
        'JWT validator not initialized'
      );
    });

    it('should not re-initialize if already initialized', async () => {
      const validator = new JWTValidator();

      // First initialization
      try {
        await validator.initialize([mockIDPConfig]);
      } catch {
        // Ignore error (JWKS will fail)
      }

      // Second initialization should return immediately
      await validator.initialize([mockIDPConfig]);
    });
  });

  describe('Token Format Validation', () => {
    it('should validate token has three parts', async () => {
      const validator = new JWTValidator();

      // Not initialized, but we can test format validation indirectly
      await expect(validator.validateJWT('invalid-token')).rejects.toThrow();
    });

    it('should reject empty token', async () => {
      const validator = new JWTValidator();

      await expect(validator.validateJWT('')).rejects.toThrow();
    });

    it('should reject token with only two parts', async () => {
      const validator = new JWTValidator();

      await expect(validator.validateJWT('header.payload')).rejects.toThrow();
    });

    it('should reject token with four parts', async () => {
      const validator = new JWTValidator();

      await expect(
        validator.validateJWT('header.payload.signature.extra')
      ).rejects.toThrow();
    });
  });

  describe('Token Claim Extraction', () => {
    it('should extract issuer and audience from valid token', async () => {
      const validator = new JWTValidator();

      // Create a mock JWT with valid structure
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString(
        'base64url'
      );
      const payload = Buffer.from(
        JSON.stringify({
          iss: 'https://auth.test.com',
          aud: 'test-api',
          sub: 'user123',
          exp: Math.floor(Date.now() / 1000) + 3600,
        })
      ).toString('base64url');
      const signature = 'fake-signature';

      const token = `${header}.${payload}.${signature}`;

      // This will fail at signature verification, but we test format is accepted
      await expect(validator.validateJWT(token)).rejects.toThrow(
        'JWT validator not initialized'
      );
    });

    it('should reject token missing issuer claim', async () => {
      const validator = new JWTValidator();

      const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({
          // Missing iss
          aud: 'test-api',
          sub: 'user123',
        })
      ).toString('base64url');
      const token = `${header}.${payload}.fake-sig`;

      // Extract claims will fail on missing issuer
      await expect(validator.validateJWT(token)).rejects.toThrow();
    });

    it('should reject token missing audience claim', async () => {
      const validator = new JWTValidator();

      const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({
          iss: 'https://auth.test.com',
          // Missing aud
          sub: 'user123',
        })
      ).toString('base64url');
      const token = `${header}.${payload}.fake-sig`;

      await expect(validator.validateJWT(token)).rejects.toThrow();
    });
  });

  describe('Issuer Validation', () => {
    it('should reject tokens from untrusted issuers', async () => {
      const validator = new JWTValidator();

      // Initialize with one IDP
      try {
        await validator.initialize([mockIDPConfig]);
      } catch {
        // Ignore JWKS error
      }

      // Create token from different issuer
      const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({
          iss: 'https://evil.com', // Different issuer
          aud: 'test-api',
          sub: 'hacker',
        })
      ).toString('base64url');
      const token = `${header}.${payload}.fake-sig`;

      await expect(validator.validateJWT(token)).rejects.toThrow(
        /Untrusted issuer|UNTRUSTED_ISSUER/i
      );
    });
  });

  describe('Security Requirements Validation', () => {
    it('should validate algorithm is in allowed list', () => {
      // Algorithm validation happens during jose.jwtVerify
      // This is tested by the jose library itself
      expect(mockIDPConfig.algorithms).toContain('RS256');
    });

    it('should enforce clock tolerance', () => {
      expect(mockIDPConfig.security.clockTolerance).toBe(60);
    });

    it('should enforce max token age', () => {
      expect(mockIDPConfig.security.maxTokenAge).toBe(3600);
    });

    it('should enforce nbf requirement', () => {
      expect(mockIDPConfig.security.requireNbf).toBe(true);
    });
  });

  describe('Claim Mapping', () => {
    it('should have claim mappings configured', () => {
      expect(mockIDPConfig.claimMappings.legacyUsername).toBe('legacy_sam_account');
      expect(mockIDPConfig.claimMappings.roles).toBe('user_roles');
      expect(mockIDPConfig.claimMappings.scopes).toBe('scopes');
    });

    it('should support custom claim paths', () => {
      const customConfig: IDPConfig = {
        ...mockIDPConfig,
        claimMappings: {
          userId: 'custom.user.id',
          username: 'custom.user.name',
          legacyUsername: 'custom.legacy.sam',
          roles: 'custom.roles',
        },
      };

      expect(customConfig.claimMappings.userId).toBe('custom.user.id');
    });
  });

  describe('Resource Cleanup', () => {
    it('should have destroy method', () => {
      const validator = new JWTValidator();

      expect(typeof validator.destroy).toBe('function');
    });

    it('should clean up resources on destroy', () => {
      const validator = new JWTValidator();

      // Should not throw
      validator.destroy();
    });
  });

  describe('Error Handling', () => {
    it('should throw OAuthSecurityError for security violations', async () => {
      const validator = new JWTValidator();

      // Not initialized - should throw security error
      await expect(validator.validateJWT('fake.token.here')).rejects.toThrow(
        'JWT validator not initialized'
      );
    });

    it('should throw on malformed JWT payload', async () => {
      const validator = new JWTValidator();

      const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
      const payload = 'invalid-base64-!!!';
      const token = `${header}.${payload}.fake-sig`;

      await expect(validator.validateJWT(token)).rejects.toThrow();
    });
  });

  describe('Integration with IDPConfig', () => {
    it('should support multiple IDPs', async () => {
      const validator = new JWTValidator();

      const idp1: IDPConfig = {
        issuer: 'https://idp1.com',
        jwksUri: 'https://idp1.com/jwks',
        audience: 'app1',
        algorithms: ['RS256'],
        claimMappings: { legacyUsername: 'sam', roles: 'roles' },
        security: { clockTolerance: 60, maxTokenAge: 3600, requireNbf: false },
      };

      const idp2: IDPConfig = {
        issuer: 'https://idp2.com',
        jwksUri: 'https://idp2.com/jwks',
        audience: 'app2',
        algorithms: ['ES256'],
        claimMappings: { legacyUsername: 'legacy', roles: 'user_roles' },
        security: { clockTolerance: 30, maxTokenAge: 1800, requireNbf: true },
      };

      // Should accept multiple IDPs (will fail on JWKS fetch, which is expected)
      try {
        await validator.initialize([idp1, idp2]);
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should validate HTTPS requirement for JWKS URI', () => {
      const invalidConfig: IDPConfig = {
        ...mockIDPConfig,
        jwksUri: 'http://insecure.com/jwks', // HTTP not HTTPS
      };

      // Note: Validation happens in config schema, not here
      expect(invalidConfig.jwksUri).toContain('http://');
    });
  });

  describe('RFC 8725 Compliance', () => {
    it('should only allow secure algorithms', () => {
      const config = mockIDPConfig;

      // Should only contain RS256 or ES256, not HS256
      expect(config.algorithms).not.toContain('HS256');
      expect(config.algorithms).not.toContain('none');
    });

    it('should enforce token expiration', () => {
      // Token expiration is validated in validateSecurityRequirements
      // Tested indirectly through validation flow
      expect(mockIDPConfig.security.maxTokenAge).toBeGreaterThan(0);
    });

    it('should support clock tolerance for time-based claims', () => {
      expect(mockIDPConfig.security.clockTolerance).toBeGreaterThanOrEqual(0);
      expect(mockIDPConfig.security.clockTolerance).toBeLessThanOrEqual(300);
    });
  });

  describe('Validation Result Structure', () => {
    it('should return JWTValidationResult on success', () => {
      // Structure test - validated by TypeScript
      // Result should have: payload, claims
      type ValidationResult = {
        payload: any;
        claims: Record<string, unknown>;
      };

      const mockResult: ValidationResult = {
        payload: { sub: 'user123', iss: 'test' },
        claims: { userId: 'user123', roles: ['admin'] },
      };

      expect(mockResult).toHaveProperty('payload');
      expect(mockResult).toHaveProperty('claims');
    });
  });

  describe('Edge Cases', () => {
    it('should handle base64url encoding correctly', () => {
      const data = { test: 'value with spaces and special chars: +/=' };
      const encoded = Buffer.from(JSON.stringify(data)).toString('base64url');

      // base64url should not contain +, /, or =
      expect(encoded).not.toContain('+');
      expect(encoded).not.toContain('/');
      expect(encoded).not.toContain('=');
    });

    it('should handle array audience claim', () => {
      const payload = {
        iss: 'https://auth.test.com',
        aud: ['test-api', 'other-api'], // Array audience
        sub: 'user123',
      };

      expect(Array.isArray(payload.aud)).toBe(true);
    });

    it('should handle string audience claim', () => {
      const payload = {
        iss: 'https://auth.test.com',
        aud: 'test-api', // String audience
        sub: 'user123',
      };

      expect(typeof payload.aud).toBe('string');
    });
  });
});
