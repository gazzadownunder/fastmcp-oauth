/**
 * SessionManager Tests (Role-Based Architecture)
 *
 * Tests for role-based session creation and management.
 * Note: Permissions system has been removed - framework now uses pure role-based authorization.
 *
 * @see src/core/session-manager.ts
 */

import { describe, it, expect } from 'vitest';
import { SessionManager } from '../../../src/core/session-manager.js';
import type { JWTPayload } from '../../../src/core/session-manager.js';
import {
  UNASSIGNED_ROLE,
  ROLE_ADMIN,
  ROLE_USER,
  ROLE_GUEST,
} from '../../../src/core/types.js';
import type { RoleMapperResult } from '../../../src/core/types.js';

describe('SessionManager', () => {
  describe('Session Creation', () => {
    it('should create session with admin role', () => {
      const manager = new SessionManager();

      const jwtPayload: JWTPayload = {
        sub: 'user123',
        preferred_username: 'john.doe',
        legacy_sam_account: 'DOMAIN\\jdoe',
        scopes: 'read write admin',
      };

      const roleResult: RoleMapperResult = {
        primaryRole: ROLE_ADMIN,
        customRoles: [],
        mappingFailed: false,
      };

      const session = manager.createSession(jwtPayload, roleResult);

      expect(session).toMatchObject({
        _version: 1,
        userId: 'user123',
        username: 'john.doe',
        legacyUsername: 'DOMAIN\\jdoe',
        role: ROLE_ADMIN,
        customRoles: [],
        rejected: false,
      });
      expect(session.scopes).toEqual(['read', 'write', 'admin']);
    });

    it('should create session with user role', () => {
      const manager = new SessionManager();

      const jwtPayload: JWTPayload = {
        sub: 'user456',
        username: 'jane.smith',
      };

      const roleResult: RoleMapperResult = {
        primaryRole: ROLE_USER,
        customRoles: [],
        mappingFailed: false,
      };

      const session = manager.createSession(jwtPayload, roleResult);

      expect(session.role).toBe(ROLE_USER);
      expect(session.rejected).toBe(false);
    });

    it('should create session with guest role', () => {
      const manager = new SessionManager();

      const jwtPayload: JWTPayload = {
        sub: 'guest789',
      };

      const roleResult: RoleMapperResult = {
        primaryRole: ROLE_GUEST,
        customRoles: [],
        mappingFailed: false,
      };

      const session = manager.createSession(jwtPayload, roleResult);

      expect(session.role).toBe(ROLE_GUEST);
      expect(session.rejected).toBe(false);
    });
  });

  describe('CRITICAL: UNASSIGNED_ROLE Policy', () => {
    it('should create UNASSIGNED_ROLE session when role mapping fails', () => {
      const manager = new SessionManager();

      const jwtPayload: JWTPayload = {
        sub: 'unmapped-user',
      };

      const roleResult: RoleMapperResult = {
        primaryRole: UNASSIGNED_ROLE,
        customRoles: [],
        mappingFailed: true,
      };

      const session = manager.createSession(jwtPayload, roleResult);

      expect(session.role).toBe(UNASSIGNED_ROLE);
      // UNASSIGNED_ROLE sessions are automatically rejected (line 110 of session-manager.ts)
      expect(session.rejected).toBe(true);
    });

    it('should not reject sessions with assigned roles', () => {
      const manager = new SessionManager();

      const jwtPayload: JWTPayload = {
        sub: 'valid-user',
      };

      const roleResult: RoleMapperResult = {
        primaryRole: ROLE_USER,
        customRoles: [],
        mappingFailed: false,
      };

      const session = manager.createSession(jwtPayload, roleResult);

      expect(session.role).toBe(ROLE_USER);
      expect(session.rejected).toBe(false);
    });
  });

  describe('Rejection Tracking', () => {
    it('should track rejected sessions separately', () => {
      const manager = new SessionManager();

      const jwtPayload: JWTPayload = { sub: 'rejected-user' };
      const roleResult: RoleMapperResult = {
        primaryRole: UNASSIGNED_ROLE,
        customRoles: [],
        mappingFailed: true,
        shouldReject: true,
      };

      const session = manager.createSession(jwtPayload, roleResult);

      expect(session.rejected).toBe(true);
      expect(session.role).toBe(UNASSIGNED_ROLE);
    });
  });

  describe('Session Versioning', () => {
    it('should create sessions with version 1', () => {
      const manager = new SessionManager();

      const jwtPayload: JWTPayload = { sub: 'user' };
      const roleResult: RoleMapperResult = {
        primaryRole: ROLE_USER,
        customRoles: [],
        mappingFailed: false,
      };

      const session = manager.createSession(jwtPayload, roleResult);

      expect(session._version).toBe(1);
    });
  });

  describe('Session Migration', () => {
    it('should migrate v0 sessions to v1', () => {
      const manager = new SessionManager();

      const v0Session = {
        userId: 'user123',
        username: 'testuser',
        role: ROLE_USER,
        claims: {},
        authenticated: true,
        rejected: false,
      };

      const migrated = manager.migrateSession(v0Session);

      expect(migrated._version).toBe(1);
      expect(migrated.userId).toBe('user123');
      expect(migrated.role).toBe(ROLE_USER);
      expect(migrated.rejected).toBe(false);
    });

    it('should remove legacy permissions field from v0 sessions', () => {
      const manager = new SessionManager();

      const v0SessionWithPermissions = {
        userId: 'user123',
        username: 'testuser',
        role: ROLE_USER,
        permissions: ['read', 'write'], // Legacy field
        claims: {},
        authenticated: true,
        rejected: false,
      };

      const migrated = manager.migrateSession(v0SessionWithPermissions);

      expect(migrated).not.toHaveProperty('permissions');
      expect(migrated._version).toBe(1);
    });

    it('should preserve v1 sessions as-is', () => {
      const manager = new SessionManager();

      const v1Session = {
        _version: 1,
        sessionId: 'existing-session',
        userId: 'user123',
        username: 'testuser',
        role: ROLE_ADMIN,
        customRoles: ['custom'],
        scopes: ['read'],
        customClaims: {},
        claims: {},
        rejected: false,
      };

      const result = manager.migrateSession(v1Session);

      expect(result).toEqual(v1Session);
    });
  });

  describe('Session Validation', () => {
    it('should validate sessions with assigned roles', () => {
      const manager = new SessionManager();

      const validSession = {
        _version: 1,
        sessionId: 'session-123',
        userId: 'user123',
        username: 'testuser',
        role: ROLE_USER,
        customRoles: [],
        scopes: [],
        customClaims: {},
        claims: {},
        rejected: false,
      };

      const result = manager.validateSession(validSession as any);

      expect(result).toBe(true);
    });

    it('should reject UNASSIGNED_ROLE sessions', () => {
      const manager = new SessionManager();

      const unassignedSession = {
        _version: 1,
        sessionId: 'session-123',
        userId: 'user123',
        username: 'testuser',
        role: UNASSIGNED_ROLE,
        customRoles: [],
        scopes: [],
        customClaims: {},
        claims: {},
        rejected: false,
      };

      const result = manager.validateSession(unassignedSession as any);

      expect(result).toBe(false);
    });
  });

  describe('Custom Roles', () => {
    it('should preserve custom roles from role mapper', () => {
      const manager = new SessionManager();

      const jwtPayload: JWTPayload = { sub: 'user' };
      const roleResult: RoleMapperResult = {
        primaryRole: ROLE_USER,
        customRoles: ['team-lead', 'reviewer'],
        mappingFailed: false,
      };

      const session = manager.createSession(jwtPayload, roleResult);

      expect(session.customRoles).toEqual(['team-lead', 'reviewer']);
    });
  });

  describe('Scopes Handling', () => {
    it('should parse space-separated scopes string', () => {
      const manager = new SessionManager();

      const jwtPayload: JWTPayload = {
        sub: 'user',
        scopes: 'read write admin',
      };

      const roleResult: RoleMapperResult = {
        primaryRole: ROLE_USER,
        customRoles: [],
        mappingFailed: false,
      };

      const session = manager.createSession(jwtPayload, roleResult);

      expect(session.scopes).toEqual(['read', 'write', 'admin']);
    });

    it('should handle scopes as array', () => {
      const manager = new SessionManager();

      const jwtPayload: JWTPayload = {
        sub: 'user',
        scopes: ['read', 'write'],
      };

      const roleResult: RoleMapperResult = {
        primaryRole: ROLE_USER,
        customRoles: [],
        mappingFailed: false,
      };

      const session = manager.createSession(jwtPayload, roleResult);

      expect(session.scopes).toEqual(['read', 'write']);
    });

    it('should default to empty array if no scopes provided', () => {
      const manager = new SessionManager();

      const jwtPayload: JWTPayload = {
        sub: 'user',
      };

      const roleResult: RoleMapperResult = {
        primaryRole: ROLE_USER,
        customRoles: [],
        mappingFailed: false,
      };

      const session = manager.createSession(jwtPayload, roleResult);

      expect(session.scopes).toEqual([]);
    });
  });

  describe('Username Fallbacks', () => {
    it('should use preferred_username if available', () => {
      const manager = new SessionManager();

      const jwtPayload: JWTPayload = {
        sub: 'user123',
        preferred_username: 'john.doe',
        username: 'jdoe',
      };

      const roleResult: RoleMapperResult = {
        primaryRole: ROLE_USER,
        customRoles: [],
        mappingFailed: false,
      };

      const session = manager.createSession(jwtPayload, roleResult);

      expect(session.username).toBe('john.doe');
    });

    it('should fall back to username claim', () => {
      const manager = new SessionManager();

      const jwtPayload: JWTPayload = {
        sub: 'user123',
        username: 'jdoe',
      };

      const roleResult: RoleMapperResult = {
        primaryRole: ROLE_USER,
        customRoles: [],
        mappingFailed: false,
      };

      const session = manager.createSession(jwtPayload, roleResult);

      expect(session.username).toBe('jdoe');
    });

    it('should use sub as last resort for username', () => {
      const manager = new SessionManager();

      const jwtPayload: JWTPayload = {
        sub: 'user123',
      };

      const roleResult: RoleMapperResult = {
        primaryRole: ROLE_USER,
        customRoles: [],
        mappingFailed: false,
      };

      const session = manager.createSession(jwtPayload, roleResult);

      expect(session.username).toBe('user123');
    });
  });

  describe('Claims Preservation', () => {
    it('should preserve full JWT claims', () => {
      const manager = new SessionManager();

      const jwtPayload: JWTPayload = {
        sub: 'user123',
        iss: 'https://auth.example.com',
        aud: 'my-app',
        exp: Date.now() + 3600,
        custom_claim: 'custom_value',
      };

      const roleResult: RoleMapperResult = {
        primaryRole: ROLE_USER,
        customRoles: [],
        mappingFailed: false,
      };

      const session = manager.createSession(jwtPayload, roleResult);

      expect(session.claims).toMatchObject({
        sub: 'user123',
        iss: 'https://auth.example.com',
        aud: 'my-app',
        custom_claim: 'custom_value',
      });
    });
  });

  describe('Session ID Generation', () => {
    it('should generate unique session IDs', () => {
      const manager = new SessionManager();

      const jwtPayload: JWTPayload = { sub: 'user' };
      const roleResult: RoleMapperResult = {
        primaryRole: ROLE_USER,
        customRoles: [],
        mappingFailed: false,
      };

      const session1 = manager.createSession(jwtPayload, roleResult);
      const session2 = manager.createSession(jwtPayload, roleResult);

      expect(session1.sessionId).toBeDefined();
      expect(session2.sessionId).toBeDefined();
      expect(session1.sessionId).not.toBe(session2.sessionId);
    });
  });
});
