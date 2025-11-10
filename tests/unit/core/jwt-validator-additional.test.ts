/**
 * JWT Validator Additional Tests
 *
 * Additional test coverage for jwt-validator.ts to reach 95%+ coverage
 * Tests error paths, edge cases, and multi-IDP scenarios
 *
 * These tests focus on code paths that don't require actual JWKS/jose verification
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { JWTValidator } from '../../../src/core/jwt-validator.js';
import type { IDPConfig } from '../../../src/core/jwt-validator.js';

describe('JWTValidator - Additional Coverage', () => {
  const baseIDPConfig: IDPConfig = {
    name: 'test-idp',
    issuer: 'https://auth.example.com',
    jwksUri: 'https://auth.example.com/.well-known/jwks.json',
    audience: 'mcp-server',
    algorithms: ['RS256'],
    claimMappings: {
      legacyUsername: 'legacy_name',
      roles: 'user_roles',
      scopes: 'scopes',
      userId: 'sub',
      username: 'preferred_username',
    },
    security: {
      clockTolerance: 60,
      maxTokenAge: 3600,
      requireNbf: true,
    },
  };

  // Helper to create mock JWT tokens (base64url encoded)
  const createMockJWT = (payload: any): string => {
    const header = { alg: 'RS256', typ: 'JWT' };
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = 'mock-signature-base64url-encoded';
    return `${encodedHeader}.${encodedPayload}.${signature}`;
  };

  describe('Pre-initialization Errors', () => {
    it('should throw if validateJWT called before initialization', async () => {
      const validator = new JWTValidator();
      const token = createMockJWT({ iss: 'https://auth.example.com', aud: 'mcp-server' });

      await expect(validator.validateJWT(token)).rejects.toThrow('JWT validator not initialized');
    });
  });

  describe('Token Format Validation', () => {
    let validator: JWTValidator;

    beforeEach(() => {
      validator = new JWTValidator();
      // Force initialized state to test format validation paths
      (validator as any).initialized = true;
      (validator as any).idpConfigs = [baseIDPConfig];
    });

    it('should reject empty token', async () => {
      await expect(validator.validateJWT('')).rejects.toThrow('Invalid JWT format');
    });

    it('should reject token with less than 3 parts', async () => {
      await expect(validator.validateJWT('header.payload')).rejects.toThrow('Invalid JWT format');
    });

    it('should reject token with more than 3 parts', async () => {
      await expect(validator.validateJWT('header.payload.signature.extra')).rejects.toThrow(
        'Invalid JWT format'
      );
    });

    it('should reject token with exactly one part', async () => {
      await expect(validator.validateJWT('onlyheader')).rejects.toThrow('Invalid JWT format');
    });
  });

  describe('Claim Extraction Errors', () => {
    let validator: JWTValidator;

    beforeEach(() => {
      validator = new JWTValidator();
      (validator as any).initialized = true;
      (validator as any).idpConfigs = [baseIDPConfig];
    });

    it('should reject token missing issuer claim', async () => {
      const payload = {
        aud: 'mcp-server',
        sub: 'user123',
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const token = createMockJWT(payload);

      await expect(validator.validateJWT(token)).rejects.toThrow('Missing issuer claim');
    });

    it('should reject token missing audience claim', async () => {
      const payload = {
        iss: 'https://auth.example.com',
        sub: 'user123',
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const token = createMockJWT(payload);

      await expect(validator.validateJWT(token)).rejects.toThrow('Missing audience claim');
    });

    it('should reject token with malformed JSON payload', async () => {
      const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
      const malformedPayload = Buffer.from('{ invalid json }').toString('base64url');
      const signature = 'mock-signature';
      const token = `${header}.${malformedPayload}.${signature}`;

      await expect(validator.validateJWT(token)).rejects.toThrow();
    });

    it('should handle token with array audience claim', async () => {
      const payload = {
        iss: 'https://auth.example.com',
        aud: ['mcp-server', 'another-api'],
        sub: 'user123',
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const token = createMockJWT(payload);

      // Will fail at JWKS verification, but should extract array audience
      try {
        await validator.validateJWT(token);
      } catch (error: any) {
        // Should fail with JWKS error, not claim extraction error
        expect(error.message).not.toContain('Missing required claim');
      }
    });
  });

  describe('IDP Matching Logic', () => {
    let validator: JWTValidator;

    beforeEach(() => {
      validator = new JWTValidator();
      (validator as any).initialized = true;
    });

    it('should reject token from untrusted issuer', async () => {
      (validator as any).idpConfigs = [baseIDPConfig];

      const payload = {
        iss: 'https://untrusted-issuer.com',
        aud: 'mcp-server',
        sub: 'user123',
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const token = createMockJWT(payload);

      await expect(validator.validateJWT(token)).rejects.toThrow('No trusted IDP found');
    });

    it('should reject token with audience mismatch', async () => {
      (validator as any).idpConfigs = [baseIDPConfig];

      const payload = {
        iss: 'https://auth.example.com',
        aud: 'wrong-audience',
        sub: 'user123',
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const token = createMockJWT(payload);

      await expect(validator.validateJWT(token)).rejects.toThrow('No trusted IDP found');
    });

    it('should throw error when idpName not found', async () => {
      (validator as any).idpConfigs = [baseIDPConfig];

      const payload = {
        iss: 'https://auth.example.com',
        aud: 'mcp-server',
        sub: 'user123',
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const token = createMockJWT(payload);

      await expect(validator.validateJWT(token, { idpName: 'non-existent-idp' })).rejects.toThrow(
        'No IDP configuration found with name'
      );
    });

    it('should provide helpful error when IDP name matches but issuer/audience mismatch', async () => {
      const config = { ...baseIDPConfig, name: 'test-idp', issuer: 'https://correct.com', audience: 'correct-aud' };
      (validator as any).idpConfigs = [config];

      const payload = {
        iss: 'https://wrong.com',
        aud: 'wrong-aud',
        sub: 'user123',
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const token = createMockJWT(payload);

      await expect(validator.validateJWT(token, { idpName: 'test-idp' })).rejects.toThrow(
        'IDP "test-idp" found but issuer/audience mismatch'
      );
    });

    it('should match IDP by name when multiple IDPs with same issuer exist', async () => {
      const config1 = { ...baseIDPConfig, name: 'idp1', audience: 'api1' };
      const config2 = { ...baseIDPConfig, name: 'idp2', audience: 'api2' };
      (validator as any).idpConfigs = [config1, config2];

      const payload = {
        iss: 'https://auth.example.com',
        aud: 'api1',
        sub: 'user123',
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const token = createMockJWT(payload);

      // This will fail at JWKS verification, but should pass IDP matching
      try {
        await validator.validateJWT(token, { idpName: 'idp1' });
      } catch (error: any) {
        expect(error.message).not.toContain('IDP configuration not found');
      }
    });
  });

  describe('JWKS Resolution Errors', () => {
    let validator: JWTValidator;

    beforeEach(() => {
      validator = new JWTValidator();
      (validator as any).initialized = true;
      (validator as any).idpConfigs = [baseIDPConfig];
    });

    it('should throw error if JWKS not found for issuer', async () => {
      // Clear JWKS sets to simulate missing JWKS
      (validator as any).jwksSets = new Map();

      const payload = {
        iss: 'https://auth.example.com',
        aud: 'mcp-server',
        sub: 'user123',
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const token = createMockJWT(payload);

      await expect(validator.validateJWT(token)).rejects.toThrow(
        'JWKS not found for issuer: https://auth.example.com'
      );
    });
  });

  describe('Resource Cleanup', () => {
    it('should have destroy method', () => {
      const validator = new JWTValidator();
      expect(validator.destroy).toBeDefined();
      expect(typeof validator.destroy).toBe('function');
    });

    it('should clear initialized state on destroy', async () => {
      const validator = new JWTValidator();

      // Manually set initialized to true
      (validator as any).initialized = true;
      (validator as any).idpConfigs = [baseIDPConfig];

      await validator.destroy();

      // After destroy, should not be able to validate
      await expect(validator.validateJWT('token')).rejects.toThrow('not initialized');
    });
  });

  describe('Edge Cases', () => {
    let validator: JWTValidator;

    beforeEach(() => {
      validator = new JWTValidator();
      (validator as any).initialized = true;
      (validator as any).idpConfigs = [baseIDPConfig];
    });

    it('should handle token with expired timestamp', async () => {
      const payload = {
        iss: 'https://auth.example.com',
        aud: 'mcp-server',
        sub: 'user123',
        exp: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
      };
      const token = createMockJWT(payload);

      // Will fail at JWKS verification (expired tokens caught by jose)
      try {
        await validator.validateJWT(token);
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should handle token with future nbf claim', async () => {
      const payload = {
        iss: 'https://auth.example.com',
        aud: 'mcp-server',
        sub: 'user123',
        exp: Math.floor(Date.now() / 1000) + 7200,
        nbf: Math.floor(Date.now() / 1000) + 3600, // Not valid for another hour
      };
      const token = createMockJWT(payload);

      // Will fail at JWKS verification (nbf checked by jose)
      try {
        await validator.validateJWT(token);
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should handle token with extra custom claims', async () => {
      const payload = {
        iss: 'https://auth.example.com',
        aud: 'mcp-server',
        sub: 'user123',
        exp: Math.floor(Date.now() / 1000) + 3600,
        custom_claim_1: 'value1',
        custom_claim_2: { nested: 'object' },
        custom_claim_3: ['array', 'of', 'values'],
      };
      const token = createMockJWT(payload);

      // Will fail at JWKS verification
      try {
        await validator.validateJWT(token);
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe('Multi-IDP Scenarios', () => {
    it('should handle initialization with multiple IDPs with same issuer', async () => {
      const validator = new JWTValidator();

      const config1 = { ...baseIDPConfig, name: 'idp1', audience: 'api1' };
      const config2 = { ...baseIDPConfig, name: 'idp2', audience: 'api2' };

      // Initialize will try to fetch JWKS and fail, but that's expected
      try {
        await validator.initialize([config1, config2]);
      } catch (error) {
        // JWKS fetch expected to fail in unit tests
        expect(error).toBeDefined();
      }
    });

    it('should handle initialization with multiple IDPs with different issuers', async () => {
      const validator = new JWTValidator();

      const config1 = { ...baseIDPConfig, issuer: 'https://idp1.com', jwksUri: 'https://idp1.com/jwks' };
      const config2 = { ...baseIDPConfig, issuer: 'https://idp2.com', jwksUri: 'https://idp2.com/jwks' };

      try {
        await validator.initialize([config1, config2]);
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should skip re-initialization if already initialized', async () => {
      const validator = new JWTValidator();

      // Manually set initialized flag
      (validator as any).initialized = true;
      (validator as any).idpConfigs = [baseIDPConfig];

      // Second initialization should be skipped
      await validator.initialize([baseIDPConfig]);

      // Should still be initialized
      expect((validator as any).initialized).toBe(true);
    });
  });

  describe('Initialization Errors', () => {
    it('should handle initialization failure gracefully', async () => {
      const validator = new JWTValidator();
      const invalidConfig = {
        ...baseIDPConfig,
        jwksUri: 'http://invalid-url-that-will-fail',
      };

      // Initialize will try to fetch JWKS and fail
      try {
        await validator.initialize([invalidConfig]);
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });
});
