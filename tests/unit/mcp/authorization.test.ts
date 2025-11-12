/**
 * Unit Tests for Authorization Helpers
 *
 * Tests role-based and scope-based authorization checks.
 * Covers both soft (boolean) and hard (throwing) checks.
 */

import { describe, it, expect } from 'vitest';
import { Authorization, requireAuth, requireRole } from '../../../src/mcp/authorization.js';
import type { MCPContext } from '../../../src/mcp/types.js';
import type { UserSession } from '../../../src/core/types.js';

describe('Authorization', () => {
  const createMockContext = (session?: Partial<UserSession>): MCPContext => {
    return {
      session: session
        ? ({
            userId: 'user123',
            username: 'testuser',
            role: 'user',
            scopes: [],
            rejected: false,
            claims: {},
            ...session,
          } as UserSession)
        : undefined,
    } as MCPContext;
  };

  const auth = new Authorization();

  // ==========================================================================
  // Soft Checks (Return Boolean)
  // ==========================================================================

  describe('isAuthenticated()', () => {
    it('should return true for valid session', () => {
      const context = createMockContext({ role: 'user' });
      expect(auth.isAuthenticated(context)).toBe(true);
    });

    it('should return false for missing session', () => {
      const context = createMockContext();
      expect(auth.isAuthenticated(context)).toBe(false);
    });

    it('should return false for rejected session', () => {
      const context = createMockContext({ role: 'user', rejected: true });
      expect(auth.isAuthenticated(context)).toBe(false);
    });

    it('should return true for session with rejected=false', () => {
      const context = createMockContext({ role: 'user', rejected: false });
      expect(auth.isAuthenticated(context)).toBe(true);
    });
  });

  describe('hasRole()', () => {
    it('should return true when user has the required role', () => {
      const context = createMockContext({ role: 'admin' });
      expect(auth.hasRole(context, 'admin')).toBe(true);
    });

    it('should return false when user has different role', () => {
      const context = createMockContext({ role: 'user' });
      expect(auth.hasRole(context, 'admin')).toBe(false);
    });

    it('should return false when not authenticated', () => {
      const context = createMockContext();
      expect(auth.hasRole(context, 'admin')).toBe(false);
    });

    it('should be case-sensitive', () => {
      const context = createMockContext({ role: 'Admin' });
      expect(auth.hasRole(context, 'admin')).toBe(false);
    });
  });

  describe('hasAnyRole()', () => {
    it('should return true when user has one of the required roles', () => {
      const context = createMockContext({ role: 'user' });
      expect(auth.hasAnyRole(context, ['admin', 'user', 'guest'])).toBe(true);
    });

    it('should return false when user has none of the required roles', () => {
      const context = createMockContext({ role: 'guest' });
      expect(auth.hasAnyRole(context, ['admin', 'user'])).toBe(false);
    });

    it('should return false when not authenticated', () => {
      const context = createMockContext();
      expect(auth.hasAnyRole(context, ['admin', 'user'])).toBe(false);
    });

    it('should work with single role array', () => {
      const context = createMockContext({ role: 'admin' });
      expect(auth.hasAnyRole(context, ['admin'])).toBe(true);
    });

    it('should work with empty array (returns false)', () => {
      const context = createMockContext({ role: 'admin' });
      expect(auth.hasAnyRole(context, [])).toBe(false);
    });
  });

  describe('hasAllRoles()', () => {
    it('should return true when user has all required roles', () => {
      const context = createMockContext({
        role: 'admin',
        customRoles: ['auditor', 'moderator'],
      });
      expect(auth.hasAllRoles(context, ['admin', 'auditor'])).toBe(true);
    });

    it('should return false when user is missing some roles', () => {
      const context = createMockContext({ role: 'user', customRoles: [] });
      expect(auth.hasAllRoles(context, ['admin', 'auditor'])).toBe(false);
    });

    it('should return false when not authenticated', () => {
      const context = createMockContext();
      expect(auth.hasAllRoles(context, ['admin'])).toBe(false);
    });

    it('should work with just primary role', () => {
      const context = createMockContext({ role: 'admin' });
      expect(auth.hasAllRoles(context, ['admin'])).toBe(true);
    });

    it('should handle undefined customRoles', () => {
      const context = createMockContext({ role: 'admin', customRoles: undefined });
      expect(auth.hasAllRoles(context, ['admin'])).toBe(true);
    });

    it('should work with empty array (always true)', () => {
      const context = createMockContext({ role: 'admin' });
      expect(auth.hasAllRoles(context, [])).toBe(true);
    });
  });

  describe('hasScope()', () => {
    it('should return true when user has the required scope', () => {
      const context = createMockContext({ scopes: ['sql:query', 'api:read'] });
      expect(auth.hasScope(context, 'sql:query')).toBe(true);
    });

    it('should return false when user lacks the scope', () => {
      const context = createMockContext({ scopes: ['sql:query'] });
      expect(auth.hasScope(context, 'api:read')).toBe(false);
    });

    it('should return false when not authenticated', () => {
      const context = createMockContext();
      expect(auth.hasScope(context, 'sql:query')).toBe(false);
    });

    it('should return false when scopes is undefined', () => {
      const context = createMockContext({ scopes: undefined });
      expect(auth.hasScope(context, 'sql:query')).toBe(false);
    });

    it('should return false when scopes is empty', () => {
      const context = createMockContext({ scopes: [] });
      expect(auth.hasScope(context, 'sql:query')).toBe(false);
    });

    it('should be case-sensitive', () => {
      const context = createMockContext({ scopes: ['SQL:QUERY'] });
      expect(auth.hasScope(context, 'sql:query')).toBe(false);
    });
  });

  describe('hasAnyScope()', () => {
    it('should return true when user has one of the required scopes', () => {
      const context = createMockContext({ scopes: ['api:read'] });
      expect(auth.hasAnyScope(context, ['api:read', 'api:write'])).toBe(true);
    });

    it('should return false when user has none of the required scopes', () => {
      const context = createMockContext({ scopes: ['api:delete'] });
      expect(auth.hasAnyScope(context, ['api:read', 'api:write'])).toBe(false);
    });

    it('should return false when not authenticated', () => {
      const context = createMockContext();
      expect(auth.hasAnyScope(context, ['api:read'])).toBe(false);
    });

    it('should return false when scopes is undefined', () => {
      const context = createMockContext({ scopes: undefined });
      expect(auth.hasAnyScope(context, ['api:read'])).toBe(false);
    });

    it('should work with empty scope array (returns false)', () => {
      const context = createMockContext({ scopes: ['api:read'] });
      expect(auth.hasAnyScope(context, [])).toBe(false);
    });
  });

  describe('hasAllScopes()', () => {
    it('should return true when user has all required scopes', () => {
      const context = createMockContext({ scopes: ['api:read', 'api:write', 'api:delete'] });
      expect(auth.hasAllScopes(context, ['api:read', 'api:write'])).toBe(true);
    });

    it('should return false when user is missing some scopes', () => {
      const context = createMockContext({ scopes: ['api:read'] });
      expect(auth.hasAllScopes(context, ['api:read', 'api:write'])).toBe(false);
    });

    it('should return false when not authenticated', () => {
      const context = createMockContext();
      expect(auth.hasAllScopes(context, ['api:read'])).toBe(false);
    });

    it('should return false when scopes is undefined', () => {
      const context = createMockContext({ scopes: undefined });
      expect(auth.hasAllScopes(context, ['api:read'])).toBe(false);
    });

    it('should work with empty scope array (always true)', () => {
      const context = createMockContext({ scopes: ['api:read'] });
      expect(auth.hasAllScopes(context, [])).toBe(true);
    });
  });

  // ==========================================================================
  // Hard Checks (Throw on Failure)
  // ==========================================================================

  describe('requireAuth()', () => {
    it('should not throw for valid session', () => {
      const context = createMockContext({ role: 'user' });
      expect(() => auth.requireAuth(context)).not.toThrow();
    });

    it('should throw 401 for missing session', () => {
      const context = createMockContext();
      expect(() => auth.requireAuth(context)).toThrow('Authentication required');
    });

    it('should throw 401 for rejected session', () => {
      const context = createMockContext({ role: 'user', rejected: true });
      expect(() => auth.requireAuth(context)).toThrow('Authentication required');
    });

    it('should throw with UNAUTHENTICATED code', () => {
      const context = createMockContext();
      try {
        auth.requireAuth(context);
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.code).toBe('UNAUTHENTICATED');
        expect(error.statusCode).toBe(401);
      }
    });
  });

  describe('requireRole()', () => {
    it('should not throw when user has required role', () => {
      const context = createMockContext({ role: 'admin' });
      expect(() => auth.requireRole(context, 'admin')).not.toThrow();
    });

    it('should throw 403 when user has different role', () => {
      const context = createMockContext({ role: 'user' });
      expect(() => auth.requireRole(context, 'admin')).toThrow(
        "This tool requires the 'admin' role. Your role: user"
      );
    });

    it('should throw 401 when not authenticated', () => {
      const context = createMockContext();
      expect(() => auth.requireRole(context, 'admin')).toThrow('Authentication required');
    });

    it('should throw with INSUFFICIENT_PERMISSIONS code', () => {
      const context = createMockContext({ role: 'user' });
      try {
        auth.requireRole(context, 'admin');
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.code).toBe('INSUFFICIENT_PERMISSIONS');
        expect(error.statusCode).toBe(403);
      }
    });

    it('should include requiredScopes in error details for WWW-Authenticate header', () => {
      const context = createMockContext({ role: 'user' });
      try {
        auth.requireRole(context, 'admin');
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.details).toBeDefined();
        expect(error.details.requiredScopes).toEqual(['admin']);
      }
    });
  });

  describe('requireAnyRole()', () => {
    it('should not throw when user has one of required roles', () => {
      const context = createMockContext({ role: 'user' });
      expect(() => auth.requireAnyRole(context, ['admin', 'user'])).not.toThrow();
    });

    it('should throw 403 when user has none of required roles', () => {
      const context = createMockContext({ role: 'guest' });
      expect(() => auth.requireAnyRole(context, ['admin', 'user'])).toThrow(
        'This tool requires one of these roles: admin, user. Your role: guest'
      );
    });

    it('should throw 401 when not authenticated', () => {
      const context = createMockContext();
      expect(() => auth.requireAnyRole(context, ['admin'])).toThrow('Authentication required');
    });

    it('should include requiredScopes in error details', () => {
      const context = createMockContext({ role: 'guest' });
      try {
        auth.requireAnyRole(context, ['admin', 'user']);
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.details).toBeDefined();
        expect(error.details.requiredScopes).toEqual(['admin', 'user']);
      }
    });
  });

  describe('requireAllRoles()', () => {
    it('should not throw when user has all required roles', () => {
      const context = createMockContext({ role: 'admin', customRoles: ['auditor'] });
      expect(() => auth.requireAllRoles(context, ['admin', 'auditor'])).not.toThrow();
    });

    it('should throw 403 when user is missing some roles', () => {
      const context = createMockContext({ role: 'user', customRoles: [] });
      expect(() => auth.requireAllRoles(context, ['admin', 'auditor'])).toThrow(
        'This tool requires all of these roles: admin, auditor. Your roles: user'
      );
    });

    it('should throw 401 when not authenticated', () => {
      const context = createMockContext();
      expect(() => auth.requireAllRoles(context, ['admin'])).toThrow('Authentication required');
    });
  });

  describe('requireScope()', () => {
    it('should not throw when user has required scope', () => {
      const context = createMockContext({ scopes: ['sql:query'] });
      expect(() => auth.requireScope(context, 'sql:query')).not.toThrow();
    });

    it('should throw 403 when user lacks required scope', () => {
      const context = createMockContext({ scopes: ['api:read'] });
      expect(() => auth.requireScope(context, 'sql:query')).toThrow(
        "This tool requires the 'sql:query' scope. Your scopes: api:read"
      );
    });

    it('should throw 401 when not authenticated', () => {
      const context = createMockContext();
      expect(() => auth.requireScope(context, 'sql:query')).toThrow('Authentication required');
    });

    it('should show "none" when user has no scopes', () => {
      const context = createMockContext({ scopes: [] });
      expect(() => auth.requireScope(context, 'sql:query')).toThrow(
        "This tool requires the 'sql:query' scope. Your scopes: none"
      );
    });

    it('should include requiredScopes in error details', () => {
      const context = createMockContext({ scopes: ['api:read'] });
      try {
        auth.requireScope(context, 'sql:query');
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.details).toBeDefined();
        expect(error.details.requiredScopes).toEqual(['sql:query']);
      }
    });
  });

  describe('requireAnyScope()', () => {
    it('should not throw when user has one of required scopes', () => {
      const context = createMockContext({ scopes: ['api:read'] });
      expect(() => auth.requireAnyScope(context, ['api:read', 'api:write'])).not.toThrow();
    });

    it('should throw 403 when user has none of required scopes', () => {
      const context = createMockContext({ scopes: ['api:delete'] });
      expect(() => auth.requireAnyScope(context, ['api:read', 'api:write'])).toThrow(
        'This tool requires one of these scopes: api:read, api:write. Your scopes: api:delete'
      );
    });

    it('should throw 401 when not authenticated', () => {
      const context = createMockContext();
      expect(() => auth.requireAnyScope(context, ['api:read'])).toThrow('Authentication required');
    });
  });

  describe('requireAllScopes()', () => {
    it('should not throw when user has all required scopes', () => {
      const context = createMockContext({ scopes: ['api:read', 'api:write', 'api:delete'] });
      expect(() => auth.requireAllScopes(context, ['api:read', 'api:write'])).not.toThrow();
    });

    it('should throw 403 when user is missing some scopes', () => {
      const context = createMockContext({ scopes: ['api:read'] });
      expect(() => auth.requireAllScopes(context, ['api:read', 'api:write'])).toThrow(
        'This tool requires all of these scopes: api:read, api:write. Your scopes: api:read'
      );
    });

    it('should throw 401 when not authenticated', () => {
      const context = createMockContext();
      expect(() => auth.requireAllScopes(context, ['api:read'])).toThrow('Authentication required');
    });
  });

  // ==========================================================================
  // Backward Compatibility Functions
  // ==========================================================================

  describe('requireAuth() standalone function', () => {
    it('should work same as class method', () => {
      const context = createMockContext({ role: 'user' });
      expect(() => requireAuth(context)).not.toThrow();
    });

    it('should throw for missing session', () => {
      const context = createMockContext();
      expect(() => requireAuth(context)).toThrow('Authentication required');
    });
  });

  describe('requireRole() standalone function', () => {
    it('should work same as class method', () => {
      const context = createMockContext({ role: 'admin' });
      expect(() => requireRole(context, 'admin')).not.toThrow();
    });

    it('should throw for wrong role', () => {
      const context = createMockContext({ role: 'user' });
      expect(() => requireRole(context, 'admin')).toThrow();
    });
  });
});
