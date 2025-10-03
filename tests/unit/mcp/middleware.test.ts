/**
 * MCP Middleware Tests
 *
 * Tests for Phase 3.3: MCP Authentication Middleware
 *
 * @see Docs/refactor-progress.md Phase 3.3
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPAuthMiddleware, requireAuth, requireRole, requirePermission } from '../../../src/mcp/middleware.js';
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
          userId: 'user123',
          username: 'testuser',
          legacyUsername: 'DOMAIN\\testuser',
          role: 'user',
          permissions: ['sql:query'],
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
            authorization: 'Bearer test-token-123',
          },
        };

        const result = await middleware.authenticate(request);

        expect(result.authenticated).toBe(true);
        expect(result.session).toEqual(mockSession);
        expect(mockAuthService.authenticate).toHaveBeenCalledWith('test-token-123');
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
        expect(mockAuthService.authenticate).toHaveBeenCalledWith('test-token-456');
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
        expect(result.error).toContain('Authentication rejected');
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
      userId: 'user123',
      username: 'testuser',
      legacyUsername: 'DOMAIN\\testuser',
      role: 'user',
      permissions: ['sql:query', 'sql:procedure'],
      rejected: false,
      _version: 1,
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

    describe('requirePermission', () => {
      it('should pass for granted permission', () => {
        const context = { session: mockSession };
        expect(() => requirePermission(context, 'sql:query')).not.toThrow();
      });

      it('should throw for missing permission', () => {
        const context = { session: mockSession };
        expect(() => requirePermission(context, 'sql:admin')).toThrow('sql:admin');
      });

      it('should throw for rejected session', () => {
        const context = { session: rejectedSession };
        expect(() => requirePermission(context, 'sql:query')).toThrow();
      });
    });
  });
});
