/**
 * Authorization Helper Tests
 *
 * Tests both soft (boolean) and hard (throwing) authorization checks.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Authorization } from '../authorization.js';
import type { MCPContext } from '../types.js';
import type { UserSession } from '../../core/types.js';

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockSession(overrides: Partial<UserSession> = {}): UserSession {
  return {
    _version: 1,
    userId: 'test-user-123',
    username: 'testuser',
    legacyUsername: 'DOMAIN\\testuser',
    role: 'user',
    customRoles: [],
    permissions: ['sql:query'],
    scopes: ['read'],
    claims: {},
    rejected: false,
    ...overrides,
  };
}

function createMockContext(session?: UserSession | null): MCPContext {
  if (session === undefined) {
    // Default: create authenticated session
    return {
      session: createMockSession(),
    };
  }

  if (session === null) {
    // Explicitly no session
    return {
      session: undefined,
    };
  }

  // Use provided session
  return {
    session,
  };
}

// ============================================================================
// Authorization Tests
// ============================================================================

describe('Authorization', () => {
  let auth: Authorization;

  beforeEach(() => {
    auth = new Authorization();
  });

  // ==========================================================================
  // Soft Checks (Return Boolean)
  // ==========================================================================

  describe('isAuthenticated()', () => {
    it('should return true for authenticated session', () => {
      const ctx = createMockContext();
      expect(auth.isAuthenticated(ctx)).toBe(true);
    });

    it('should return false for missing session', () => {
      const ctx = createMockContext(null);
      expect(auth.isAuthenticated(ctx)).toBe(false);
    });

    it('should return false for rejected session', () => {
      const ctx = createMockContext(createMockSession({ rejected: true }));
      expect(auth.isAuthenticated(ctx)).toBe(false);
    });
  });

  describe('hasRole()', () => {
    it('should return true when user has exact role', () => {
      const ctx = createMockContext(createMockSession({ role: 'admin' }));
      expect(auth.hasRole(ctx, 'admin')).toBe(true);
    });

    it('should return false when user has different role', () => {
      const ctx = createMockContext(createMockSession({ role: 'user' }));
      expect(auth.hasRole(ctx, 'admin')).toBe(false);
    });

    it('should return false when session is not authenticated', () => {
      const ctx = createMockContext(null);
      expect(auth.hasRole(ctx, 'admin')).toBe(false);
    });

    it('should return false when session is rejected', () => {
      const ctx = createMockContext(createMockSession({ role: 'admin', rejected: true }));
      expect(auth.hasRole(ctx, 'admin')).toBe(false);
    });
  });

  describe('hasAnyRole()', () => {
    it('should return true when user has one of the roles', () => {
      const ctx = createMockContext(createMockSession({ role: 'user' }));
      expect(auth.hasAnyRole(ctx, ['admin', 'user', 'guest'])).toBe(true);
    });

    it('should return false when user has none of the roles', () => {
      const ctx = createMockContext(createMockSession({ role: 'guest' }));
      expect(auth.hasAnyRole(ctx, ['admin', 'moderator'])).toBe(false);
    });

    it('should return false when session is not authenticated', () => {
      const ctx = createMockContext(null);
      expect(auth.hasAnyRole(ctx, ['admin', 'user'])).toBe(false);
    });

    it('should work with single role in array', () => {
      const ctx = createMockContext(createMockSession({ role: 'admin' }));
      expect(auth.hasAnyRole(ctx, ['admin'])).toBe(true);
    });
  });

  describe('hasAllRoles()', () => {
    it('should return true when user has all roles (primary + custom)', () => {
      const ctx = createMockContext(createMockSession({
        role: 'admin',
        customRoles: ['auditor', 'moderator']
      }));
      expect(auth.hasAllRoles(ctx, ['admin', 'auditor'])).toBe(true);
    });

    it('should return false when user is missing one role', () => {
      const ctx = createMockContext(createMockSession({
        role: 'admin',
        customRoles: ['auditor']
      }));
      expect(auth.hasAllRoles(ctx, ['admin', 'moderator'])).toBe(false);
    });

    it('should return true when only checking primary role', () => {
      const ctx = createMockContext(createMockSession({ role: 'admin' }));
      expect(auth.hasAllRoles(ctx, ['admin'])).toBe(true);
    });

    it('should return false when session is not authenticated', () => {
      const ctx = createMockContext(null);
      expect(auth.hasAllRoles(ctx, ['admin'])).toBe(false);
    });

    it('should handle empty customRoles', () => {
      const ctx = createMockContext(createMockSession({
        role: 'admin',
        customRoles: undefined
      }));
      expect(auth.hasAllRoles(ctx, ['admin'])).toBe(true);
    });
  });

  describe('hasPermission()', () => {
    it('should return true when user has permission', () => {
      const ctx = createMockContext(createMockSession({
        permissions: ['sql:query', 'sql:execute']
      }));
      expect(auth.hasPermission(ctx, 'sql:query')).toBe(true);
    });

    it('should return false when user lacks permission', () => {
      const ctx = createMockContext(createMockSession({
        permissions: ['sql:query']
      }));
      expect(auth.hasPermission(ctx, 'sql:execute')).toBe(false);
    });

    it('should return false when session is not authenticated', () => {
      const ctx = createMockContext(null);
      expect(auth.hasPermission(ctx, 'sql:query')).toBe(false);
    });

    it('should return false when session is rejected', () => {
      const ctx = createMockContext(createMockSession({
        permissions: ['sql:query'],
        rejected: true
      }));
      expect(auth.hasPermission(ctx, 'sql:query')).toBe(false);
    });
  });

  describe('hasAnyPermission()', () => {
    it('should return true when user has one of the permissions', () => {
      const ctx = createMockContext(createMockSession({
        permissions: ['sql:query']
      }));
      expect(auth.hasAnyPermission(ctx, ['sql:query', 'sql:execute', 'sql:admin'])).toBe(true);
    });

    it('should return false when user has none of the permissions', () => {
      const ctx = createMockContext(createMockSession({
        permissions: ['sql:query']
      }));
      expect(auth.hasAnyPermission(ctx, ['sql:execute', 'sql:admin'])).toBe(false);
    });

    it('should return false when session is not authenticated', () => {
      const ctx = createMockContext(null);
      expect(auth.hasAnyPermission(ctx, ['sql:query'])).toBe(false);
    });

    it('should work with single permission in array', () => {
      const ctx = createMockContext(createMockSession({
        permissions: ['sql:query']
      }));
      expect(auth.hasAnyPermission(ctx, ['sql:query'])).toBe(true);
    });
  });

  describe('hasAllPermissions()', () => {
    it('should return true when user has all permissions', () => {
      const ctx = createMockContext(createMockSession({
        permissions: ['sql:query', 'sql:execute', 'sql:admin']
      }));
      expect(auth.hasAllPermissions(ctx, ['sql:query', 'sql:execute'])).toBe(true);
    });

    it('should return false when user is missing one permission', () => {
      const ctx = createMockContext(createMockSession({
        permissions: ['sql:query']
      }));
      expect(auth.hasAllPermissions(ctx, ['sql:query', 'sql:execute'])).toBe(false);
    });

    it('should return true when checking single permission', () => {
      const ctx = createMockContext(createMockSession({
        permissions: ['sql:query']
      }));
      expect(auth.hasAllPermissions(ctx, ['sql:query'])).toBe(true);
    });

    it('should return false when session is not authenticated', () => {
      const ctx = createMockContext(null);
      expect(auth.hasAllPermissions(ctx, ['sql:query'])).toBe(false);
    });
  });

  // ==========================================================================
  // Hard Checks (Throw on Failure)
  // ==========================================================================

  describe('requireAuth()', () => {
    it('should not throw for authenticated session', () => {
      const ctx = createMockContext();
      expect(() => auth.requireAuth(ctx)).not.toThrow();
    });

    it('should throw 401 for missing session', () => {
      const ctx = createMockContext(null);
      expect(() => auth.requireAuth(ctx)).toThrow('Authentication required');
    });

    it('should throw 401 for rejected session', () => {
      const ctx = createMockContext(createMockSession({ rejected: true }));
      expect(() => auth.requireAuth(ctx)).toThrow('Authentication required');
    });

    it('should throw error with statusCode 401', () => {
      const ctx = createMockContext(null);
      try {
        auth.requireAuth(ctx);
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.statusCode).toBe(401);
        expect(error.code).toBe('UNAUTHENTICATED');
      }
    });
  });

  describe('requireRole()', () => {
    it('should not throw when user has required role', () => {
      const ctx = createMockContext(createMockSession({ role: 'admin' }));
      expect(() => auth.requireRole(ctx, 'admin')).not.toThrow();
    });

    it('should throw 403 when user has different role', () => {
      const ctx = createMockContext(createMockSession({ role: 'user' }));
      expect(() => auth.requireRole(ctx, 'admin')).toThrow("requires the 'admin' role");
    });

    it('should throw 401 when session is not authenticated', () => {
      const ctx = createMockContext(null);
      expect(() => auth.requireRole(ctx, 'admin')).toThrow('Authentication required');
    });

    it('should throw error with statusCode 403 for insufficient role', () => {
      const ctx = createMockContext(createMockSession({ role: 'user' }));
      try {
        auth.requireRole(ctx, 'admin');
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.statusCode).toBe(403);
        expect(error.code).toBe('INSUFFICIENT_PERMISSIONS');
      }
    });
  });

  describe('requireAnyRole()', () => {
    it('should not throw when user has one of the roles', () => {
      const ctx = createMockContext(createMockSession({ role: 'user' }));
      expect(() => auth.requireAnyRole(ctx, ['admin', 'user', 'guest'])).not.toThrow();
    });

    it('should throw 403 when user has none of the roles', () => {
      const ctx = createMockContext(createMockSession({ role: 'guest' }));
      expect(() => auth.requireAnyRole(ctx, ['admin', 'moderator'])).toThrow('requires one of these roles');
    });

    it('should throw 401 when session is not authenticated', () => {
      const ctx = createMockContext(null);
      expect(() => auth.requireAnyRole(ctx, ['admin', 'user'])).toThrow('Authentication required');
    });

    it('should include current role in error message', () => {
      const ctx = createMockContext(createMockSession({ role: 'guest' }));
      expect(() => auth.requireAnyRole(ctx, ['admin', 'moderator']))
        .toThrow('Your role: guest');
    });
  });

  describe('requireAllRoles()', () => {
    it('should not throw when user has all roles', () => {
      const ctx = createMockContext(createMockSession({
        role: 'admin',
        customRoles: ['auditor']
      }));
      expect(() => auth.requireAllRoles(ctx, ['admin', 'auditor'])).not.toThrow();
    });

    it('should throw 403 when user is missing one role', () => {
      const ctx = createMockContext(createMockSession({
        role: 'admin',
        customRoles: ['auditor']
      }));
      expect(() => auth.requireAllRoles(ctx, ['admin', 'moderator']))
        .toThrow('requires all of these roles');
    });

    it('should throw 401 when session is not authenticated', () => {
      const ctx = createMockContext(null);
      expect(() => auth.requireAllRoles(ctx, ['admin'])).toThrow('Authentication required');
    });

    it('should include user roles in error message', () => {
      const ctx = createMockContext(createMockSession({
        role: 'user',
        customRoles: ['viewer']
      }));
      expect(() => auth.requireAllRoles(ctx, ['admin', 'moderator']))
        .toThrow('Your roles: user, viewer');
    });
  });

  describe('requirePermission()', () => {
    it('should not throw when user has permission', () => {
      const ctx = createMockContext(createMockSession({
        permissions: ['sql:query']
      }));
      expect(() => auth.requirePermission(ctx, 'sql:query')).not.toThrow();
    });

    it('should throw 403 when user lacks permission', () => {
      const ctx = createMockContext(createMockSession({
        permissions: ['sql:query']
      }));
      expect(() => auth.requirePermission(ctx, 'sql:execute'))
        .toThrow("requires the 'sql:execute' permission");
    });

    it('should throw 401 when session is not authenticated', () => {
      const ctx = createMockContext(null);
      expect(() => auth.requirePermission(ctx, 'sql:query'))
        .toThrow('Authentication required');
    });

    it('should throw error with statusCode 403 for insufficient permission', () => {
      const ctx = createMockContext(createMockSession({
        permissions: ['sql:query']
      }));
      try {
        auth.requirePermission(ctx, 'sql:admin');
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.statusCode).toBe(403);
        expect(error.code).toBe('INSUFFICIENT_PERMISSIONS');
      }
    });
  });

  describe('requireAnyPermission()', () => {
    it('should not throw when user has one of the permissions', () => {
      const ctx = createMockContext(createMockSession({
        permissions: ['sql:query']
      }));
      expect(() => auth.requireAnyPermission(ctx, ['sql:query', 'sql:execute']))
        .not.toThrow();
    });

    it('should throw 403 when user has none of the permissions', () => {
      const ctx = createMockContext(createMockSession({
        permissions: ['sql:query']
      }));
      expect(() => auth.requireAnyPermission(ctx, ['sql:execute', 'sql:admin']))
        .toThrow('requires one of these permissions');
    });

    it('should throw 401 when session is not authenticated', () => {
      const ctx = createMockContext(null);
      expect(() => auth.requireAnyPermission(ctx, ['sql:query']))
        .toThrow('Authentication required');
    });

    it('should include user permissions in error message', () => {
      const ctx = createMockContext(createMockSession({
        permissions: ['sql:query']
      }));
      expect(() => auth.requireAnyPermission(ctx, ['sql:execute', 'sql:admin']))
        .toThrow('Your permissions: sql:query');
    });
  });

  describe('requireAllPermissions()', () => {
    it('should not throw when user has all permissions', () => {
      const ctx = createMockContext(createMockSession({
        permissions: ['sql:query', 'sql:execute', 'sql:admin']
      }));
      expect(() => auth.requireAllPermissions(ctx, ['sql:query', 'sql:execute']))
        .not.toThrow();
    });

    it('should throw 403 when user is missing one permission', () => {
      const ctx = createMockContext(createMockSession({
        permissions: ['sql:query']
      }));
      expect(() => auth.requireAllPermissions(ctx, ['sql:query', 'sql:execute']))
        .toThrow('requires all of these permissions');
    });

    it('should throw 401 when session is not authenticated', () => {
      const ctx = createMockContext(null);
      expect(() => auth.requireAllPermissions(ctx, ['sql:query']))
        .toThrow('Authentication required');
    });

    it('should include user permissions in error message', () => {
      const ctx = createMockContext(createMockSession({
        permissions: ['sql:query']
      }));
      expect(() => auth.requireAllPermissions(ctx, ['sql:query', 'sql:execute']))
        .toThrow('Your permissions: sql:query');
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle empty permissions array', () => {
      const ctx = createMockContext(createMockSession({
        permissions: []
      }));
      expect(auth.hasPermission(ctx, 'sql:query')).toBe(false);
      expect(auth.hasAnyPermission(ctx, ['sql:query'])).toBe(false);
      expect(auth.hasAllPermissions(ctx, [])).toBe(true); // No permissions required
    });

    it('should handle empty roles array in hasAnyRole', () => {
      const ctx = createMockContext(createMockSession({ role: 'admin' }));
      expect(auth.hasAnyRole(ctx, [])).toBe(false); // No roles to match
    });

    it('should handle empty roles array in hasAllRoles', () => {
      const ctx = createMockContext(createMockSession({ role: 'admin' }));
      expect(auth.hasAllRoles(ctx, [])).toBe(true); // No roles required
    });

    it('should handle undefined customRoles', () => {
      const ctx = createMockContext(createMockSession({
        role: 'admin',
        customRoles: undefined
      }));
      expect(auth.hasAllRoles(ctx, ['admin'])).toBe(true);
    });

    it('should handle multiple custom roles', () => {
      const ctx = createMockContext(createMockSession({
        role: 'user',
        customRoles: ['auditor', 'moderator', 'reviewer']
      }));
      expect(auth.hasAllRoles(ctx, ['user', 'auditor', 'moderator'])).toBe(true);
      expect(auth.hasAllRoles(ctx, ['user', 'admin'])).toBe(false);
    });
  });
});
