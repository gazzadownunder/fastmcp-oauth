/**
 * JWT Validator Success Path Tests with Jose Mocking
 *
 * Tests the successful JWT verification paths that require jose library mocking.
 * Covers: successful verification, security validations, claim extraction
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { JWTVerifyResult, JWTPayload as JoseJWTPayload } from 'jose';

// Mock jose module at the top level
vi.mock('jose', () => ({
  jwtVerify: vi.fn(),
  createRemoteJWKSet: vi.fn(),
}));

import { JWTValidator } from '../../../src/core/jwt-validator.js';
import type { IDPConfig } from '../../../src/core/jwt-validator.js';
import * as jose from 'jose';

describe('JWTValidator - Success Paths (Jose Mocked)', () => {
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

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock createRemoteJWKSet to return a mock JWKS function
    vi.mocked(jose.createRemoteJWKSet).mockReturnValue((() => {}) as any);
  });

  describe('Successful JWT Verification', () => {
    it('should successfully verify valid JWT and extract claims', async () => {
      const validator = new JWTValidator();
      await validator.initialize([baseIDPConfig]);

      const now = Math.floor(Date.now() / 1000);
      const payload: JoseJWTPayload = {
        iss: 'https://auth.example.com',
        aud: 'mcp-server',
        sub: 'user123',
        exp: now + 3600,
        iat: now - 60,
        nbf: now - 60,
        preferred_username: 'johndoe',
        legacy_name: 'DOMAIN\\johndoe',
        user_roles: ['admin', 'user'],
        scopes: 'read write',
      };
      const token = createMockJWT(payload);

      // Mock successful jwtVerify
      vi.mocked(jose.jwtVerify).mockResolvedValue({
        payload,
        protectedHeader: { alg: 'RS256' },
      } as JWTVerifyResult);

      const result = await validator.validateJWT(token);

      expect(result.payload.sub).toBe('user123');
      expect(result.claims.userId).toBe('user123');
      expect(result.claims.username).toBe('johndoe');
      expect(result.claims.legacyUsername).toBe('DOMAIN\\johndoe');
      expect(result.claims.roles).toEqual(['admin', 'user']);
      expect(result.claims.scopes).toBe('read write');
    });

    it('should pass correct options to jwtVerify', async () => {
      const validator = new JWTValidator();
      await validator.initialize([baseIDPConfig]);

      const now = Math.floor(Date.now() / 1000);
      const payload: JoseJWTPayload = {
        iss: 'https://auth.example.com',
        aud: 'mcp-server',
        sub: 'user123',
        exp: now + 3600,
        iat: now,
        nbf: now,
      };
      const token = createMockJWT(payload);

      vi.mocked(jose.jwtVerify).mockResolvedValue({
        payload,
        protectedHeader: { alg: 'RS256' },
      } as JWTVerifyResult);

      await validator.validateJWT(token);

      expect(jose.jwtVerify).toHaveBeenCalledWith(
        token,
        expect.any(Function),
        expect.objectContaining({
          issuer: 'https://auth.example.com',
          audience: ['mcp-server'],
          algorithms: ['RS256'],
          clockTolerance: 60,
          maxTokenAge: 3600,
        })
      );
    });

    it('should handle array audience in token', async () => {
      const validator = new JWTValidator();
      await validator.initialize([baseIDPConfig]);

      const now = Math.floor(Date.now() / 1000);
      const payload: JoseJWTPayload = {
        iss: 'https://auth.example.com',
        aud: ['mcp-server', 'another-api'],
        sub: 'user123',
        exp: now + 3600,
        iat: now,
        nbf: now,
      };
      const token = createMockJWT(payload);

      vi.mocked(jose.jwtVerify).mockResolvedValue({
        payload,
        protectedHeader: { alg: 'RS256' },
      } as JWTVerifyResult);

      const result = await validator.validateJWT(token);

      expect(result.payload.aud).toEqual(['mcp-server', 'another-api']);
    });
  });

  describe('Security Validations - azp claim', () => {
    it('should validate azp claim matches audience', async () => {
      const validator = new JWTValidator();
      await validator.initialize([baseIDPConfig]);

      const now = Math.floor(Date.now() / 1000);
      const payload: JoseJWTPayload = {
        iss: 'https://auth.example.com',
        aud: 'mcp-server',
        sub: 'user123',
        exp: now + 3600,
        iat: now,
        nbf: now,
        azp: 'mcp-server', // Correct azp
      };
      const token = createMockJWT(payload);

      vi.mocked(jose.jwtVerify).mockResolvedValue({
        payload,
        protectedHeader: { alg: 'RS256' },
      } as JWTVerifyResult);

      const result = await validator.validateJWT(token);

      expect(result.payload.sub).toBe('user123');
    });

    it('should reject token with mismatched azp claim', async () => {
      const validator = new JWTValidator();
      await validator.initialize([baseIDPConfig]);

      const now = Math.floor(Date.now() / 1000);
      const payload: JoseJWTPayload = {
        iss: 'https://auth.example.com',
        aud: 'mcp-server',
        sub: 'user123',
        exp: now + 3600,
        iat: now,
        nbf: now,
        azp: 'wrong-audience', // Mismatched azp
      };
      const token = createMockJWT(payload);

      vi.mocked(jose.jwtVerify).mockResolvedValue({
        payload,
        protectedHeader: { alg: 'RS256' },
      } as JWTVerifyResult);

      await expect(validator.validateJWT(token)).rejects.toThrow('authorized party claim is invalid');
    });
  });

  describe('Security Validations - nbf claim', () => {
    it('should require nbf claim when requireNbf is true', async () => {
      const validator = new JWTValidator();
      await validator.initialize([baseIDPConfig]);

      const now = Math.floor(Date.now() / 1000);
      const payload: JoseJWTPayload = {
        iss: 'https://auth.example.com',
        aud: 'mcp-server',
        sub: 'user123',
        exp: now + 3600,
        iat: now,
        // Missing nbf claim
      };
      const token = createMockJWT(payload);

      vi.mocked(jose.jwtVerify).mockResolvedValue({
        payload,
        protectedHeader: { alg: 'RS256' },
      } as JWTVerifyResult);

      await expect(validator.validateJWT(token)).rejects.toThrow('missing not-before claim');
    });

    it('should reject token with future nbf claim beyond clock tolerance', async () => {
      const validator = new JWTValidator();
      await validator.initialize([baseIDPConfig]);

      const now = Math.floor(Date.now() / 1000);
      const payload: JoseJWTPayload = {
        iss: 'https://auth.example.com',
        aud: 'mcp-server',
        sub: 'user123',
        exp: now + 7200,
        iat: now,
        nbf: now + 120, // 2 minutes in future, beyond 60 second tolerance
      };
      const token = createMockJWT(payload);

      vi.mocked(jose.jwtVerify).mockResolvedValue({
        payload,
        protectedHeader: { alg: 'RS256' },
      } as JWTVerifyResult);

      await expect(validator.validateJWT(token)).rejects.toThrow('not yet valid');
    });

    it('should allow token with nbf within clock tolerance', async () => {
      const validator = new JWTValidator();
      await validator.initialize([baseIDPConfig]);

      const now = Math.floor(Date.now() / 1000);
      const payload: JoseJWTPayload = {
        iss: 'https://auth.example.com',
        aud: 'mcp-server',
        sub: 'user123',
        exp: now + 3600,
        iat: now,
        nbf: now + 30, // 30 seconds in future, within 60 second tolerance
      };
      const token = createMockJWT(payload);

      vi.mocked(jose.jwtVerify).mockResolvedValue({
        payload,
        protectedHeader: { alg: 'RS256' },
      } as JWTVerifyResult);

      const result = await validator.validateJWT(token);

      expect(result.payload.sub).toBe('user123');
    });
  });

  describe('Security Validations - maxTokenAge', () => {
    it('should reject token exceeding maxTokenAge', async () => {
      const validator = new JWTValidator();
      await validator.initialize([baseIDPConfig]);

      const now = Math.floor(Date.now() / 1000);
      const payload: JoseJWTPayload = {
        iss: 'https://auth.example.com',
        aud: 'mcp-server',
        sub: 'user123',
        exp: now + 3600,
        iat: now - 7200, // Issued 2 hours ago, maxTokenAge is 3600 seconds (1 hour)
        nbf: now - 7200,
      };
      const token = createMockJWT(payload);

      vi.mocked(jose.jwtVerify).mockResolvedValue({
        payload,
        protectedHeader: { alg: 'RS256' },
      } as JWTVerifyResult);

      await expect(validator.validateJWT(token)).rejects.toThrow('exceeds maximum age');
    });

    it('should accept token within maxTokenAge', async () => {
      const validator = new JWTValidator();
      await validator.initialize([baseIDPConfig]);

      const now = Math.floor(Date.now() / 1000);
      const payload: JoseJWTPayload = {
        iss: 'https://auth.example.com',
        aud: 'mcp-server',
        sub: 'user123',
        exp: now + 3600,
        iat: now - 1800, // Issued 30 minutes ago, maxTokenAge is 3600 seconds (1 hour)
        nbf: now - 1800,
      };
      const token = createMockJWT(payload);

      vi.mocked(jose.jwtVerify).mockResolvedValue({
        payload,
        protectedHeader: { alg: 'RS256' },
      } as JWTVerifyResult);

      const result = await validator.validateJWT(token);

      expect(result.payload.sub).toBe('user123');
    });
  });

  describe('Security Validations - exp claim', () => {
    it('should reject expired token beyond clock tolerance', async () => {
      const validator = new JWTValidator();
      await validator.initialize([baseIDPConfig]);

      const now = Math.floor(Date.now() / 1000);
      const payload: JoseJWTPayload = {
        iss: 'https://auth.example.com',
        aud: 'mcp-server',
        sub: 'user123',
        exp: now - 120, // Expired 2 minutes ago, beyond 60 second tolerance
        iat: now - 3600,
        nbf: now - 3600,
      };
      const token = createMockJWT(payload);

      vi.mocked(jose.jwtVerify).mockResolvedValue({
        payload,
        protectedHeader: { alg: 'RS256' },
      } as JWTVerifyResult);

      await expect(validator.validateJWT(token)).rejects.toThrow('expired');
    });
  });

  describe('Claim Mapping Extraction', () => {
    it('should extract claims using custom claim mappings', async () => {
      const customConfig: IDPConfig = {
        ...baseIDPConfig,
        claimMappings: {
          userId: 'custom_user_id',
          username: 'custom_username',
          legacyUsername: 'custom_legacy_name',
          roles: 'custom_roles',
          scopes: 'custom_scopes',
        },
      };

      const validator = new JWTValidator();
      await validator.initialize([customConfig]);

      const now = Math.floor(Date.now() / 1000);
      const payload: JoseJWTPayload = {
        iss: 'https://auth.example.com',
        aud: 'mcp-server',
        sub: 'fallback-user',
        exp: now + 3600,
        iat: now,
        nbf: now,
        custom_user_id: 'uid-456',
        custom_username: 'johndoe',
        custom_legacy_name: 'DOMAIN\\johndoe',
        custom_roles: ['admin', 'user'],
        custom_scopes: 'read write',
      };
      const token = createMockJWT(payload);

      vi.mocked(jose.jwtVerify).mockResolvedValue({
        payload,
        protectedHeader: { alg: 'RS256' },
      } as JWTVerifyResult);

      const result = await validator.validateJWT(token);

      expect(result.claims.userId).toBe('uid-456');
      expect(result.claims.username).toBe('johndoe');
      expect(result.claims.legacyUsername).toBe('DOMAIN\\johndoe');
      expect(result.claims.roles).toEqual(['admin', 'user']);
      expect(result.claims.scopes).toBe('read write');
    });

    it('should require userId claim', async () => {
      const validator = new JWTValidator();
      await validator.initialize([baseIDPConfig]);

      const now = Math.floor(Date.now() / 1000);
      const payload: JoseJWTPayload = {
        iss: 'https://auth.example.com',
        aud: 'mcp-server',
        // Missing sub claim (userId mapping)
        exp: now + 3600,
        iat: now,
        nbf: now,
      };
      const token = createMockJWT(payload);

      vi.mocked(jose.jwtVerify).mockResolvedValue({
        payload,
        protectedHeader: { alg: 'RS256' },
      } as JWTVerifyResult);

      await expect(validator.validateJWT(token)).rejects.toThrow('Missing required claim: sub');
    });

    it('should include raw payload in claims', async () => {
      const validator = new JWTValidator();
      await validator.initialize([baseIDPConfig]);

      const now = Math.floor(Date.now() / 1000);
      const payload: JoseJWTPayload = {
        iss: 'https://auth.example.com',
        aud: 'mcp-server',
        sub: 'user123',
        exp: now + 3600,
        iat: now,
        nbf: now,
        custom_field: 'custom_value',
      };
      const token = createMockJWT(payload);

      vi.mocked(jose.jwtVerify).mockResolvedValue({
        payload,
        protectedHeader: { alg: 'RS256' },
      } as JWTVerifyResult);

      const result = await validator.validateJWT(token);

      expect(result.claims.rawPayload).toBe(payload);
      expect((result.claims.rawPayload as any).custom_field).toBe('custom_value');
    });
  });

  describe('Nested Claim Extraction', () => {
    it('should extract nested claims using dot notation', async () => {
      const customConfig: IDPConfig = {
        ...baseIDPConfig,
        claimMappings: {
          userId: 'sub',
          username: 'preferred_username',
          legacyUsername: 'custom.legacy.name',
          roles: 'realm_access.roles',
          scopes: 'scope',
        },
      };

      const validator = new JWTValidator();
      await validator.initialize([customConfig]);

      const now = Math.floor(Date.now() / 1000);
      const payload: any = {
        iss: 'https://auth.example.com',
        aud: 'mcp-server',
        sub: 'user123',
        exp: now + 3600,
        iat: now,
        nbf: now,
        preferred_username: 'johndoe',
        custom: {
          legacy: {
            name: 'DOMAIN\\johndoe',
          },
        },
        realm_access: {
          roles: ['admin', 'user'],
        },
        scope: 'read write',
      };
      const token = createMockJWT(payload);

      vi.mocked(jose.jwtVerify).mockResolvedValue({
        payload,
        protectedHeader: { alg: 'RS256' },
      } as JWTVerifyResult);

      const result = await validator.validateJWT(token);

      expect(result.claims.legacyUsername).toBe('DOMAIN\\johndoe');
      expect(result.claims.roles).toEqual(['admin', 'user']);
    });

    it('should return undefined for non-existent nested paths', async () => {
      const customConfig: IDPConfig = {
        ...baseIDPConfig,
        claimMappings: {
          userId: 'sub',
          username: 'preferred_username',
          legacyUsername: 'non.existent.path',
          roles: 'user_roles',
          scopes: 'scope',
        },
      };

      const validator = new JWTValidator();
      await validator.initialize([customConfig]);

      const now = Math.floor(Date.now() / 1000);
      const payload: JoseJWTPayload = {
        iss: 'https://auth.example.com',
        aud: 'mcp-server',
        sub: 'user123',
        exp: now + 3600,
        iat: now,
        nbf: now,
        preferred_username: 'johndoe',
      };
      const token = createMockJWT(payload);

      vi.mocked(jose.jwtVerify).mockResolvedValue({
        payload,
        protectedHeader: { alg: 'RS256' },
      } as JWTVerifyResult);

      const result = await validator.validateJWT(token);

      expect(result.claims.legacyUsername).toBeUndefined();
    });
  });

  describe('JWKS Initialization Error Handling', () => {
    it('should throw error with IDP name when JWKS initialization fails', async () => {
      const validator = new JWTValidator();

      // Mock createRemoteJWKSet to throw error
      vi.mocked(jose.createRemoteJWKSet).mockImplementation(() => {
        throw new Error('Network timeout');
      });

      await expect(validator.initialize([baseIDPConfig])).rejects.toThrow(
        'Failed to initialize JWKS for IDP test-idp'
      );
    });

    it('should use audience as fallback name in error when name not provided', async () => {
      const validator = new JWTValidator();
      const configWithoutName = { ...baseIDPConfig };
      delete configWithoutName.name;

      vi.mocked(jose.createRemoteJWKSet).mockImplementation(() => {
        throw new Error('Network timeout');
      });

      await expect(validator.initialize([configWithoutName])).rejects.toThrow(
        'Failed to initialize JWKS for IDP mcp-server'
      );
    });
  });

  describe('Custom Validation Context', () => {
    it('should allow custom clockTolerance from validation context', async () => {
      const validator = new JWTValidator();
      await validator.initialize([baseIDPConfig]);

      const now = Math.floor(Date.now() / 1000);
      const payload: JoseJWTPayload = {
        iss: 'https://auth.example.com',
        aud: 'mcp-server',
        sub: 'user123',
        exp: now + 3600,
        iat: now,
        nbf: now,
      };
      const token = createMockJWT(payload);

      vi.mocked(jose.jwtVerify).mockResolvedValue({
        payload,
        protectedHeader: { alg: 'RS256' },
      } as JWTVerifyResult);

      await validator.validateJWT(token, { clockTolerance: 120 });

      expect(jose.jwtVerify).toHaveBeenCalledWith(
        token,
        expect.any(Function),
        expect.objectContaining({
          clockTolerance: 120, // Custom value overrides config
        })
      );
    });

    it('should allow custom maxTokenAge from validation context', async () => {
      const validator = new JWTValidator();
      await validator.initialize([baseIDPConfig]);

      const now = Math.floor(Date.now() / 1000);
      const payload: JoseJWTPayload = {
        iss: 'https://auth.example.com',
        aud: 'mcp-server',
        sub: 'user123',
        exp: now + 3600,
        iat: now,
        nbf: now,
      };
      const token = createMockJWT(payload);

      vi.mocked(jose.jwtVerify).mockResolvedValue({
        payload,
        protectedHeader: { alg: 'RS256' },
      } as JWTVerifyResult);

      await validator.validateJWT(token, { maxTokenAge: 7200 });

      expect(jose.jwtVerify).toHaveBeenCalledWith(
        token,
        expect.any(Function),
        expect.objectContaining({
          maxTokenAge: 7200, // Custom value overrides config
        })
      );
    });
  });

  describe('IDP Name Matching with Multiple IDPs', () => {
    it('should provide detailed error when named IDP exists but issuer/audience mismatch', async () => {
      const config1: IDPConfig = {
        ...baseIDPConfig,
        name: 'sql-delegation',
        issuer: 'https://idp1.com',
        audience: 'sql-api',
      };
      const config2: IDPConfig = {
        ...baseIDPConfig,
        name: 'sql-delegation',
        issuer: 'https://idp2.com',
        audience: 'sql-api-backup',
      };

      const validator = new JWTValidator();
      await validator.initialize([config1, config2]);

      const now = Math.floor(Date.now() / 1000);
      const payload: JoseJWTPayload = {
        iss: 'https://wrong-issuer.com',
        aud: 'wrong-audience',
        sub: 'user123',
        exp: now + 3600,
        iat: now,
        nbf: now,
      };
      const token = createMockJWT(payload);

      await expect(validator.validateJWT(token, { idpName: 'sql-delegation' })).rejects.toThrow(
        'IDP "sql-delegation" found but issuer/audience mismatch'
      );
    });
  });
});
