/**
 * Token Exchange Service Unit Tests
 *
 * Tests RFC 8693 token exchange implementation with comprehensive coverage.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TokenExchangeService } from '../../../src/delegation/token-exchange.js';
import type { TokenExchangeConfig } from '../../../src/delegation/types.js';

describe('TokenExchangeService', () => {
  let service: TokenExchangeService;
  let mockAuditService: any;
  let config: TokenExchangeConfig;

  beforeEach(() => {
    // Mock audit service
    mockAuditService = {
      log: vi.fn().mockResolvedValue(undefined),
    };

    // Default config
    config = {
      tokenEndpoint: 'https://idp.example.com/token',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      audience: 'sql-delegation',
    };

    // Mock fetch globally
    global.fetch = vi.fn();
  });

  describe('Configuration Validation', () => {
    it('should accept valid HTTPS token endpoint', () => {
      expect(() => {
        new TokenExchangeService(config, mockAuditService);
      }).not.toThrow();
    });

    it('should reject HTTP token endpoint', () => {
      const invalidConfig = { ...config, tokenEndpoint: 'http://idp.example.com/token' };
      expect(() => {
        new TokenExchangeService(invalidConfig, mockAuditService);
      }).toThrow('Token endpoint must use HTTPS');
    });

    it('should reject missing token endpoint', () => {
      const invalidConfig = { ...config, tokenEndpoint: '' };
      expect(() => {
        new TokenExchangeService(invalidConfig, mockAuditService);
      }).toThrow('Token exchange config missing tokenEndpoint');
    });

    it('should reject missing client credentials', () => {
      const invalidConfig = { ...config, clientId: '' };
      expect(() => {
        new TokenExchangeService(invalidConfig, mockAuditService);
      }).toThrow('Token exchange config missing clientId or clientSecret');
    });
  });

  describe('performExchange()', () => {
    beforeEach(() => {
      service = new TokenExchangeService(config, mockAuditService);
    });

    it('should successfully exchange token', async () => {
      const mockResponse = {
        access_token: 'exchanged-token',
        token_type: 'Bearer',
        expires_in: 3600,
        issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await service.performExchange({
        subjectToken: 'user-jwt-token',
        subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt',
        audience: 'sql-delegation',
        tokenEndpoint: 'https://idp.example.com/token',
        clientId: 'test-client',
        clientSecret: 'test-secret',
      });

      expect(result.success).toBe(true);
      expect(result.accessToken).toBe('exchanged-token');
      expect(result.tokenType).toBe('Bearer');
      expect(result.expiresIn).toBe(3600);
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'delegation:token-exchange',
          action: 'token_exchange',
          success: true,
        })
      );
    });

    it('should handle IDP error responses', async () => {
      const mockResponse = {
        error: 'invalid_grant',
        error_description: 'The provided authorization grant is invalid',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => mockResponse,
      });

      const result = await service.performExchange({
        subjectToken: 'invalid-token',
        subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt',
        audience: 'sql-delegation',
        tokenEndpoint: 'https://idp.example.com/token',
        clientId: 'test-client',
        clientSecret: 'test-secret',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('invalid_grant');
      expect(result.errorDescription).toContain('invalid');
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'invalid_grant',
        })
      );
    });

    it('should handle network errors', async () => {
      (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

      const result = await service.performExchange({
        subjectToken: 'user-jwt-token',
        subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt',
        audience: 'sql-delegation',
        tokenEndpoint: 'https://idp.example.com/token',
        clientId: 'test-client',
        clientSecret: 'test-secret',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('request_failed');
      expect(result.errorDescription).toContain('Network error');
    });

    it('should reject missing subject token', async () => {
      const result = await service.performExchange({
        subjectToken: '',
        subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt',
        audience: 'sql-delegation',
        tokenEndpoint: 'https://idp.example.com/token',
        clientId: 'test-client',
        clientSecret: 'test-secret',
      });

      expect(result.success).toBe(false);
      expect(result.errorDescription).toContain('Subject token is required');
    });

    it('should reject HTTP token endpoint in params', async () => {
      const result = await service.performExchange({
        subjectToken: 'user-jwt-token',
        subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt',
        audience: 'sql-delegation',
        tokenEndpoint: 'http://insecure.com/token',
        clientId: 'test-client',
        clientSecret: 'test-secret',
      });

      expect(result.success).toBe(false);
      expect(result.errorDescription).toContain('must use HTTPS');
    });

    it('should reject missing audience', async () => {
      const result = await service.performExchange({
        subjectToken: 'user-jwt-token',
        subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt',
        audience: '',
        tokenEndpoint: 'https://idp.example.com/token',
        clientId: 'test-client',
        clientSecret: 'test-secret',
      });

      expect(result.success).toBe(false);
      expect(result.errorDescription).toContain('Audience is required');
    });

    it('should send correct RFC 8693 request body', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'token' }),
      });

      await service.performExchange({
        subjectToken: 'user-jwt-token',
        subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt',
        audience: 'sql-delegation',
        tokenEndpoint: 'https://idp.example.com/token',
        clientId: 'test-client',
        clientSecret: 'test-secret',
        resource: 'https://sql-server.example.com',
        scope: 'database:read database:write',
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://idp.example.com/token',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/x-www-form-urlencoded',
          }),
        })
      );

      const callArgs = (global.fetch as any).mock.calls[0];
      const body = callArgs[1].body;

      expect(body).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Atoken-exchange');
      expect(body).toContain('subject_token=user-jwt-token');
      expect(body).toContain('audience=sql-delegation');
      expect(body).toContain('client_id=test-client');
      expect(body).toContain('client_secret=test-secret');
      expect(body).toContain('resource=https%3A%2F%2Fsql-server.example.com');
      expect(body).toContain('scope=database%3Aread+database%3Awrite');
    });
  });

  describe('decodeTokenClaims()', () => {
    beforeEach(() => {
      service = new TokenExchangeService(config, mockAuditService);
    });

    it('should decode valid JWT claims', () => {
      // Create a mock JWT: header.payload.signature
      const claims = {
        sub: 'user123',
        iss: 'https://idp.example.com',
        aud: 'sql-delegation',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        legacy_name: 'DOMAIN\\user123',
        roles: ['user', 'sql-reader'],
        permissions: ['sql:query'],
      };

      const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
      const signature = 'mock-signature';
      const jwt = `${header}.${payload}.${signature}`;

      const decoded = service.decodeTokenClaims(jwt);

      expect(decoded).not.toBeNull();
      expect(decoded?.sub).toBe('user123');
      expect(decoded?.legacy_name).toBe('DOMAIN\\user123');
      expect(decoded?.roles).toEqual(['user', 'sql-reader']);
      expect(decoded?.permissions).toEqual(['sql:query']);
    });

    it('should return null for invalid JWT format', () => {
      const result = service.decodeTokenClaims('not-a-jwt');
      expect(result).toBeNull();
    });

    it('should return null for malformed JWT', () => {
      const result = service.decodeTokenClaims('header.payload');
      expect(result).toBeNull();
    });

    it('should return null for invalid base64url encoding', () => {
      const result = service.decodeTokenClaims('invalid.invalid.invalid');
      expect(result).toBeNull();
    });
  });

  describe('Audit Logging', () => {
    beforeEach(() => {
      service = new TokenExchangeService(config, mockAuditService);
    });

    it('should work without audit service (Null Object Pattern)', async () => {
      const serviceWithoutAudit = new TokenExchangeService(config);

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'token' }),
      });

      const result = await serviceWithoutAudit.performExchange({
        subjectToken: 'user-jwt-token',
        subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt',
        audience: 'sql-delegation',
        tokenEndpoint: 'https://idp.example.com/token',
        clientId: 'test-client',
        clientSecret: 'test-secret',
      });

      expect(result.success).toBe(true);
    });

    it('should not crash if audit service log fails', async () => {
      mockAuditService.log.mockRejectedValueOnce(new Error('Audit failed'));

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'token' }),
      });

      const result = await service.performExchange({
        subjectToken: 'user-jwt-token',
        subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt',
        audience: 'sql-delegation',
        tokenEndpoint: 'https://idp.example.com/token',
        clientId: 'test-client',
        clientSecret: 'test-secret',
      });

      expect(result.success).toBe(true);
    });

    it('should log success with metadata', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'token' }),
      });

      await service.performExchange({
        subjectToken: 'user-jwt-token',
        subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt',
        audience: 'test-audience',
        tokenEndpoint: 'https://idp.example.com/token',
        clientId: 'test-client',
        clientSecret: 'test-secret',
      });

      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            audience: 'test-audience',
            tokenEndpoint: 'https://idp.example.com/token',
            durationMs: expect.any(Number),
          }),
        })
      );
    });
  });
});
