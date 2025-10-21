/**
 * Authorization Tests (Role-Based)
 *
 * Tests for role-based authorization helpers.
 * Note: Permission-based tests have been removed - framework now uses pure role-based authorization.
 */

import { describe, it, expect } from 'vitest';
import { Authorization, requireAuth, requireRole } from '../authorization.js';
import type { MCPContext } from '../types.js';
import type { UserSession } from '../../core/types.js';

describe('Authorization', () => {
  const auth = new Authorization();

  // Helper to create mock context
  const createContext = (session?: Partial<UserSession>): MCPContext => ({
    session: session ? ({
      _version: 1,
      sessionId: 'test-session',
      userId: 'test-user',
      username: 'testuser',
      role: 'user',
      customRoles: [],
      scopes: [],
      customClaims: {},
      claims: {},
      rejected: false,
      ...session,
    } as UserSession) : undefined,
  });

  // =========================================================================
  // Soft Checks (Return Boolean)
  // =========================================================================

  describe('isAuthenticated()', () => {
    it('should return true when session exists and is not rejected', () => {
      const context = createContext({ role: 'user' });
      expect(auth.isAuthenticated(context)).toBe(true);
    });

    it('should return false when session is missing', () => {
      const context: MCPContext = { session: undefined };
      expect(auth.isAuthenticated(context)).toBe(false);
    });

    it('should return false when session is rejected', () => {
      const context = createContext({ rejected: true });
      expect(auth.isAuthenticated(context)).toBe(false);
    });
  });

  describe('hasRole()', () => {
    it('should return true when user has the role', () => {
      const context = createContext({ role: 'admin' });
      expect(auth.hasRole(context, 'admin')).toBe(true);
    });

    it('should return false when user has different role', () => {
      const context = createContext({ role: 'user' });
      expect(auth.hasRole(context, 'admin')).toBe(false);
    });

    it('should return false when session is not authenticated', () => {
      const context: MCPContext = { session: undefined };
      expect(auth.hasRole(context, 'admin')).toBe(false);
    });

    it('should return false when session is rejected', () => {
      const context = createContext({ role: 'admin', rejected: true });
      expect(auth.hasRole(context, 'admin')).toBe(false);
    });
  });

  describe('hasAnyRole()', () => {
    it('should return true when user has one of the roles', () => {
      const context = createContext({ role: 'user' });
      expect(auth.hasAnyRole(context, ['admin', 'user', 'guest'])).toBe(true);
    });

    it('should return false when user has none of the roles', () => {
      const context = createContext({ role: 'guest' });
      expect(auth.hasAnyRole(context, ['admin', 'moderator'])).toBe(false);
    });

    it('should return false when session is not authenticated', () => {
      const context: MCPContext = { session: undefined };
      expect(auth.hasAnyRole(context, ['admin', 'user'])).toBe(false);
    });

    it('should work with single role in array', () => {
      const context = createContext({ role: 'admin' });
      expect(auth.hasAnyRole(context, ['admin'])).toBe(true);
    });
  });

  describe('hasAllRoles()', () => {
    it('should return true when user has all roles (primary + custom)', () => {
      const context = createContext({
        role: 'admin',
        customRoles: ['auditor', 'reviewer']
      });
      expect(auth.hasAllRoles(context, ['admin', 'auditor'])).toBe(true);
    });

    it('should return false when user is missing one role', () => {
      const context = createContext({
        role: 'admin',
        customRoles: ['reviewer']
      });
      expect(auth.hasAllRoles(context, ['admin', 'auditor'])).toBe(false);
    });

    it('should return true when checking single role', () => {
      const context = createContext({ role: 'admin' });
      expect(auth.hasAllRoles(context, ['admin'])).toBe(true);
    });

    it('should return false when session is not authenticated', () => {
      const context: MCPContext = { session: undefined };
      expect(auth.hasAllRoles(context, ['admin'])).toBe(false);
    });

    it('should work with only custom roles', () => {
      const context = createContext({
        role: 'user',
        customRoles: ['auditor', 'reviewer']
      });
      expect(auth.hasAllRoles(context, ['auditor', 'reviewer'])).toBe(true);
    });
  });

  // =========================================================================
  // Hard Checks (Throw on Failure)
  // =========================================================================

  describe('requireAuth()', () => {
    it('should not throw when session is authenticated', () => {
      const context = createContext({ role: 'user' });
      expect(() => auth.requireAuth(context)).not.toThrow();
    });

    it('should throw 401 when session is missing', () => {
      const context: MCPContext = { session: undefined };
      expect(() => auth.requireAuth(context)).toThrow();

      try {
        auth.requireAuth(context);
      } catch (error: any) {
        expect(error.statusCode).toBe(401);
        expect(error.code).toBe('UNAUTHENTICATED');
      }
    });

    it('should throw 401 when session is rejected', () => {
      const context = createContext({ rejected: true });
      expect(() => auth.requireAuth(context)).toThrow();

      try {
        auth.requireAuth(context);
      } catch (error: any) {
        expect(error.statusCode).toBe(401);
      }
    });
  });

  describe('requireRole()', () => {
    it('should not throw when user has the role', () => {
      const context = createContext({ role: 'admin' });
      expect(() => auth.requireRole(context, 'admin')).not.toThrow();
    });

    it('should throw 403 when user has different role', () => {
      const context = createContext({ role: 'user' });
      expect(() => auth.requireRole(context, 'admin')).toThrow();

      try {
        auth.requireRole(context, 'admin');
      } catch (error: any) {
        expect(error.statusCode).toBe(403);
        expect(error.code).toBe('INSUFFICIENT_PERMISSIONS');
        expect(error.message).toContain('admin');
      }
    });

    it('should throw 401 when session is not authenticated', () => {
      const context: MCPContext = { session: undefined };
      expect(() => auth.requireRole(context, 'admin')).toThrow();

      try {
        auth.requireRole(context, 'admin');
      } catch (error: any) {
        expect(error.statusCode).toBe(401);
      }
    });
  });

  describe('requireAnyRole()', () => {
    it('should not throw when user has one of the roles', () => {
      const context = createContext({ role: 'user' });
      expect(() => auth.requireAnyRole(context, ['admin', 'user'])).not.toThrow();
    });

    it('should throw 403 when user has none of the roles', () => {
      const context = createContext({ role: 'guest' });
      expect(() => auth.requireAnyRole(context, ['admin', 'moderator'])).toThrow();

      try {
        auth.requireAnyRole(context, ['admin', 'moderator']);
      } catch (error: any) {
        expect(error.statusCode).toBe(403);
        expect(error.code).toBe('INSUFFICIENT_PERMISSIONS');
      }
    });

    it('should throw 401 when session is not authenticated', () => {
      const context: MCPContext = { session: undefined };
      expect(() => auth.requireAnyRole(context, ['admin'])).toThrow();

      try {
        auth.requireAnyRole(context, ['admin']);
      } catch (error: any) {
        expect(error.statusCode).toBe(401);
      }
    });
  });

  describe('requireAllRoles()', () => {
    it('should not throw when user has all roles', () => {
      const context = createContext({
        role: 'admin',
        customRoles: ['auditor']
      });
      expect(() => auth.requireAllRoles(context, ['admin', 'auditor'])).not.toThrow();
    });

    it('should throw 403 when user is missing one role', () => {
      const context = createContext({
        role: 'admin',
        customRoles: []
      });
      expect(() => auth.requireAllRoles(context, ['admin', 'auditor'])).toThrow();

      try {
        auth.requireAllRoles(context, ['admin', 'auditor']);
      } catch (error: any) {
        expect(error.statusCode).toBe(403);
        expect(error.code).toBe('INSUFFICIENT_PERMISSIONS');
      }
    });

    it('should throw 401 when session is not authenticated', () => {
      const context: MCPContext = { session: undefined };
      expect(() => auth.requireAllRoles(context, ['admin'])).toThrow();

      try {
        auth.requireAllRoles(context, ['admin']);
      } catch (error: any) {
        expect(error.statusCode).toBe(401);
      }
    });
  });

  // =========================================================================
  // Standalone Helper Functions (Backward Compatibility)
  // =========================================================================

  describe('requireAuth() standalone function', () => {
    it('should work as standalone function', () => {
      const context = createContext({ role: 'user' });
      expect(() => requireAuth(context)).not.toThrow();
    });

    it('should throw when not authenticated', () => {
      const context: MCPContext = { session: undefined };
      expect(() => requireAuth(context)).toThrow();
    });
  });

  describe('requireRole() standalone function', () => {
    it('should work as standalone function', () => {
      const context = createContext({ role: 'admin' });
      expect(() => requireRole(context, 'admin')).not.toThrow();
    });

    it('should throw when role mismatch', () => {
      const context = createContext({ role: 'user' });
      expect(() => requireRole(context, 'admin')).toThrow();
    });
  });
});
