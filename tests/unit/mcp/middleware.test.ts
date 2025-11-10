/**
 * MCP Middleware Tests
 *
 * Tests for Phase 3.3: MCP Authentication Middleware
 *
 * @see Docs/refactor-progress.md Phase 3.3
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPAuthMiddleware, requireAuth, requireRole } from '../../../src/mcp/middleware.js';
import type { FastMCPRequest } from '../../../src/mcp/middleware.js';
import type { AuthenticationService } from '../../../src/core/authentication-service.js';
import type { UserSession } from '../../../src/core/types.js';

describe('MCP Middleware', () => {
  // Mock AuthenticationService
  const mockAuthService = {
    authenticate: vi.fn(),
  } as unknown as AuthenticationService;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('MCPAuthMiddleware', () => {
    describe('Token Extraction', () => {
      it('should extract Bearer token from Authorization header', async () => {
        const middleware = new MCPAuthMiddleware(mockAuthService);

        const mockSession: UserSession = {
          _version: 1,
          sessionId: 'test-session',
          userId: 'user123',
          username: 'testuser',
          legacyUsername: 'DOMAIN\\testuser',
          role: 'user',
          customRoles: [],
          scopes: [],
          customClaims: {},
          claims: {},
          rejected: false,
        };

        vi.mocked(mockAuthService.authenticate).mockResolvedValue({
          accepted: true,
          rejected: false,
          session: mockSession,
        });

        const request: FastMCPRequest = {
          headers: {
            authorization: 'Bearer test-token-123',
          },
        };

        const result = await middleware.authenticate(request);

        expect(result.authenticated).toBe(true);
        expect(result.session).toEqual(mockSession);
        expect(mockAuthService.authenticate).toHaveBeenCalledWith('test-token-123', { idpName: 'requestor-jwt' });
      });

      it('should handle Authorization header (capital A)', async () => {
        const middleware = new MCPAuthMiddleware(mockAuthService);

        const mockSession: UserSession = {
          userId: 'user123',
          username: 'testuser',
          legacyUsername: 'DOMAIN\\testuser',
          role: 'user',
          permissions: [],
          rejected: false,
          _version: 1,
        };

        vi.mocked(mockAuthService.authenticate).mockResolvedValue({
          accepted: true,
          rejected: false,
          session: mockSession,
        });

        const request: FastMCPRequest = {
          headers: {
            Authorization: 'Bearer test-token-456',
          },
        };

        const result = await middleware.authenticate(request);

        expect(result.authenticated).toBe(true);
        expect(mockAuthService.authenticate).toHaveBeenCalledWith('test-token-456', { idpName: 'requestor-jwt' });
      });

      it('should return error if Authorization header is missing', async () => {
        const middleware = new MCPAuthMiddleware(mockAuthService);

        const request: FastMCPRequest = {
          headers: {},
        };

        const result = await middleware.authenticate(request);

        expect(result.authenticated).toBe(false);
        expect(result.error).toContain('Missing Authorization header');
      });

      it('should return error if Bearer token format is invalid', async () => {
        const middleware = new MCPAuthMiddleware(mockAuthService);

        const request: FastMCPRequest = {
          headers: {
            authorization: 'InvalidFormat token123',
          },
        };

        const result = await middleware.authenticate(request);

        expect(result.authenticated).toBe(false);
        expect(result.error).toContain('Missing Authorization header');
      });
    });

    describe('Dual Rejection Checks (GAP #1)', () => {
      it('should reject if authResult.rejected is true', async () => {
        const middleware = new MCPAuthMiddleware(mockAuthService);

        const mockSession: UserSession = {
          userId: 'user123',
          username: 'testuser',
          legacyUsername: 'DOMAIN\\testuser',
          role: 'UNASSIGNED_ROLE',
          permissions: [],
          rejected: true,
          _version: 1,
        };

        vi.mocked(mockAuthService.authenticate).mockResolvedValue({
          accepted: false,
          rejected: true, // FIRST CHECK
          reason: 'Unassigned role',
          session: mockSession,
        });

        const request: FastMCPRequest = {
          headers: {
            authorization: 'Bearer test-token',
          },
        };

        const result = await middleware.authenticate(request);

        expect(result.authenticated).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.error).toContain('Unauthorized: User has no valid roles assigned');
      });

      it('should reject if session.rejected is true (GAP #1)', async () => {
        const middleware = new MCPAuthMiddleware(mockAuthService);

        const mockSession: UserSession = {
          userId: 'user123',
          username: 'testuser',
          legacyUsername: 'DOMAIN\\testuser',
          role: 'UNASSIGNED_ROLE',
          permissions: [],
          rejected: true, // SECOND CHECK
          _version: 1,
        };

        vi.mocked(mockAuthService.authenticate).mockResolvedValue({
          accepted: true,
          rejected: false, // First check passes
          session: mockSession,
        });

        const request: FastMCPRequest = {
          headers: {
            authorization: 'Bearer test-token',
          },
        };

        const result = await middleware.authenticate(request);

        expect(result.authenticated).toBe(false);
        expect(result.error).toBeDefined();
      });

      it('should accept if both checks pass', async () => {
        const middleware = new MCPAuthMiddleware(mockAuthService);

        const mockSession: UserSession = {
          userId: 'user123',
          username: 'testuser',
          legacyUsername: 'DOMAIN\\testuser',
          role: 'user',
          permissions: ['sql:query'],
          rejected: false, // BOTH CHECKS PASS
          _version: 1,
        };

        vi.mocked(mockAuthService.authenticate).mockResolvedValue({
          accepted: true,
          rejected: false, // BOTH CHECKS PASS
          session: mockSession,
        });

        const request: FastMCPRequest = {
          headers: {
            authorization: 'Bearer test-token',
          },
        };

        const result = await middleware.authenticate(request);

        expect(result.authenticated).toBe(true);
        expect(result.session).toEqual(mockSession);
      });
    });

    describe('Context Creation', () => {
      it('should create MCPContext from successful auth result', () => {
        const middleware = new MCPAuthMiddleware(mockAuthService);

        const mockSession: UserSession = {
          userId: 'user123',
          username: 'testuser',
          legacyUsername: 'DOMAIN\\testuser',
          role: 'user',
          permissions: [],
          rejected: false,
          _version: 1,
        };

        const authResult = {
          authenticated: true,
          session: mockSession,
        };

        const context = middleware.createContext(authResult);

        expect(context.session).toEqual(mockSession);
      });

      it('should throw if auth result is not authenticated', () => {
        const middleware = new MCPAuthMiddleware(mockAuthService);

        const authResult = {
          authenticated: false,
          error: 'Authentication failed',
        };

        expect(() => middleware.createContext(authResult)).toThrow('Authentication failed');
      });
    });
  });

  describe('Authorization Helpers', () => {
    const mockSession: UserSession = {
      _version: 1,
      sessionId: 'test-session',
      userId: 'user123',
      username: 'testuser',
      legacyUsername: 'DOMAIN\\testuser',
      role: 'user',
      customRoles: [],
      scopes: [],
      customClaims: {},
      claims: {},
      rejected: false,
    };

    const rejectedSession: UserSession = {
      ...mockSession,
      rejected: true,
    };

    describe('requireAuth', () => {
      it('should pass for authenticated session', () => {
        const context = { session: mockSession };
        expect(() => requireAuth(context)).not.toThrow();
      });

      it('should throw for rejected session', () => {
        const context = { session: rejectedSession };
        expect(() => requireAuth(context)).toThrow('Authentication required');
      });
    });

    describe('requireRole', () => {
      it('should pass for matching role', () => {
        const context = { session: mockSession };
        expect(() => requireRole(context, 'user')).not.toThrow();
      });

      it('should throw for non-matching role', () => {
        const context = { session: mockSession };
        expect(() => requireRole(context, 'admin')).toThrow('admin');
      });

      it('should throw for rejected session', () => {
        const context = { session: rejectedSession };
        expect(() => requireRole(context, 'user')).toThrow();
      });
    });

    // Note: requirePermission tests removed - framework now uses pure role-based authorization
  });

  describe('Edge Cases and Error Handling', () => {
    describe('Token Extraction Edge Cases', () => {
      it('should handle authorization header as array (take first)', async () => {
        const middleware = new MCPAuthMiddleware(mockAuthService);

        const mockSession: UserSession = {
          _version: 1,
          userId: 'user123',
          username: 'testuser',
          role: 'user',
          rejected: false,
        };

        vi.mocked(mockAuthService.authenticate).mockResolvedValue({
          accepted: true,
          rejected: false,
          session: mockSession,
        });

        const request: FastMCPRequest = {
          headers: {
            authorization: ['Bearer token-123', 'Bearer token-456'] as any,
          },
        };

        const result = await middleware.authenticate(request);

        expect(result.authenticated).toBe(true);
        expect(mockAuthService.authenticate).toHaveBeenCalledWith('token-123', { idpName: 'requestor-jwt' });
      });

      it('should handle empty authorization header array', async () => {
        const middleware = new MCPAuthMiddleware(mockAuthService);

        const request: FastMCPRequest = {
          headers: {
            authorization: [] as any,
          },
        };

        const result = await middleware.authenticate(request);

        expect(result.authenticated).toBe(false);
        expect(result.error).toContain('Missing Authorization header');
      });

      it('should handle Bearer with case variations', async () => {
        const middleware = new MCPAuthMiddleware(mockAuthService);

        const mockSession: UserSession = {
          _version: 1,
          userId: 'user123',
          username: 'testuser',
          role: 'user',
          rejected: false,
        };

        vi.mocked(mockAuthService.authenticate).mockResolvedValue({
          accepted: true,
          rejected: false,
          session: mockSession,
        });

        const request: FastMCPRequest = {
          headers: {
            authorization: 'bearer lowercase-token',
          },
        };

        const result = await middleware.authenticate(request);

        expect(result.authenticated).toBe(true);
        expect(mockAuthService.authenticate).toHaveBeenCalledWith('lowercase-token', { idpName: 'requestor-jwt' });
      });

      it('should reject empty Bearer token', async () => {
        const middleware = new MCPAuthMiddleware(mockAuthService);

        const request: FastMCPRequest = {
          headers: {
            authorization: 'Bearer ',
          },
        };

        const result = await middleware.authenticate(request);

        expect(result.authenticated).toBe(false);
        expect(result.error).toContain('Missing Authorization header');
      });

      it('should reject token without Bearer prefix', async () => {
        const middleware = new MCPAuthMiddleware(mockAuthService);

        const request: FastMCPRequest = {
          headers: {
            authorization: 'just-a-token-no-bearer',
          },
        };

        const result = await middleware.authenticate(request);

        expect(result.authenticated).toBe(false);
        expect(result.error).toContain('Missing Authorization header');
      });
    });

    describe('Error Response Handling', () => {
      it('should return 500 for generic Error', async () => {
        const middleware = new MCPAuthMiddleware(mockAuthService);

        vi.mocked(mockAuthService.authenticate).mockRejectedValue(new Error('Unexpected error'));

        const request: FastMCPRequest = {
          headers: {
            authorization: 'Bearer test-token',
          },
        };

        const result = await middleware.authenticate(request);

        expect(result.authenticated).toBe(false);
        expect(result.statusCode).toBe(500);
        expect(result.error).toBe('Unexpected error');
      });

      it('should return 500 for non-Error rejections', async () => {
        const middleware = new MCPAuthMiddleware(mockAuthService);

        vi.mocked(mockAuthService.authenticate).mockRejectedValue('string error');

        const request: FastMCPRequest = {
          headers: {
            authorization: 'Bearer test-token',
          },
        };

        const result = await middleware.authenticate(request);

        expect(result.authenticated).toBe(false);
        expect(result.statusCode).toBe(500);
        expect(result.error).toBe('Authentication failed');
      });
    });

    describe('Context Creation Edge Cases', () => {
      it('should throw with specific error message from auth result', () => {
        const middleware = new MCPAuthMiddleware(mockAuthService);

        const authResult = {
          authenticated: false,
          error: 'Token signature verification failed',
        };

        expect(() => middleware.createContext(authResult)).toThrow(
          'Token signature verification failed'
        );
      });

      it('should throw generic message if error is undefined', () => {
        const middleware = new MCPAuthMiddleware(mockAuthService);

        const authResult = {
          authenticated: false,
        };

        expect(() => middleware.createContext(authResult)).toThrow('Authentication required');
      });
    });
  });
});
