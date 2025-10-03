/**
 * SessionManager Tests
 *
 * Tests for Phase 1.6: Session Manager with Migration Support
 *
 * @see Docs/refactor-progress.md Phase 1.6
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
    it('should create session with admin role and permissions', () => {
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
      expect(session.permissions).toContain('admin');
      expect(session.scopes).toEqual(['read', 'write', 'admin']);
    });

    it('should create session with user role and permissions', () => {
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
      expect(session.permissions).toEqual(['read', 'write']);
      expect(session.rejected).toBe(false);
    });

    it('should create session with guest role and permissions', () => {
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
      expect(session.permissions).toEqual(['read']);
      expect(session.rejected).toBe(false);
    });
  });

  describe('CRITICAL: UNASSIGNED_ROLE Policy (GAP #2)', () => {
    it('should create UNASSIGNED_ROLE session with empty permissions', () => {
      const manager = new SessionManager();

      const jwtPayload: JWTPayload = {
        sub: 'unknown',
      };

      const roleResult: RoleMapperResult = {
        primaryRole: UNASSIGNED_ROLE,
        customRoles: [],
        mappingFailed: true,
        failureReason: 'No matching roles',
      };

      const session = manager.createSession(jwtPayload, roleResult);

      expect(session.role).toBe(UNASSIGNED_ROLE);
      expect(session.permissions).toEqual([]); // MUST be empty
      expect(session.rejected).toBe(true); // MUST be rejected
    });

    it('should throw if UNASSIGNED_ROLE has non-empty permissions (safety check)', () => {
      // This test simulates a configuration bug where UNASSIGNED_ROLE is mapped to permissions
      const manager = new SessionManager({
        customPermissions: {
          [UNASSIGNED_ROLE]: ['read'], // BUG: UNASSIGNED with permissions
        },
      });

      const jwtPayload: JWTPayload = {
        sub: 'hacker',
      };

      const roleResult: RoleMapperResult = {
        primaryRole: UNASSIGNED_ROLE,
        customRoles: [],
        mappingFailed: true,
      };

      expect(() => manager.createSession(jwtPayload, roleResult)).toThrow(
        'CRITICAL: UNASSIGNED_ROLE must have empty permissions array'
      );
    });
  });

  describe('Rejection Tracking (GAP #1)', () => {
    it('should set rejected=true for UNASSIGNED_ROLE', () => {
      const manager = new SessionManager();

      const jwtPayload: JWTPayload = { sub: 'user' };
      const roleResult: RoleMapperResult = {
        primaryRole: UNASSIGNED_ROLE,
        customRoles: [],
        mappingFailed: true,
      };

      const session = manager.createSession(jwtPayload, roleResult);

      expect(session.rejected).toBe(true);
    });

    it('should set rejected=false for valid roles', () => {
      const manager = new SessionManager();

      const jwtPayload: JWTPayload = { sub: 'user' };
      const roleResult: RoleMapperResult = {
        primaryRole: ROLE_USER,
        customRoles: [],
        mappingFailed: false,
      };

      const session = manager.createSession(jwtPayload, roleResult);

      expect(session.rejected).toBe(false);
    });
  });

  describe('Session Versioning (GAP #6)', () => {
    it('should add _version field to new sessions', () => {
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

    it('should return current version number', () => {
      const manager = new SessionManager();

      expect(manager.getSessionVersion()).toBe(1);
    });
  });

  describe('Session Migration (GAP #6)', () => {
    it('should migrate v0 session to v1 (add _version field)', () => {
      const manager = new SessionManager();

      const v0Session = {
        userId: 'user123',
        username: 'john.doe',
        role: ROLE_USER,
        permissions: ['read', 'write'],
      };

      const migrated = manager.migrateSession(v0Session);

      expect(migrated._version).toBe(1);
      expect(migrated.userId).toBe('user123');
      expect(migrated.role).toBe(ROLE_USER);
    });

    it('should add rejected=true for v0 UNASSIGNED_ROLE sessions', () => {
      const manager = new SessionManager();

      const v0Session = {
        userId: 'unknown',
        role: UNASSIGNED_ROLE,
        // No rejected field in v0
      };

      const migrated = manager.migrateSession(v0Session);

      expect(migrated._version).toBe(1);
      expect(migrated.rejected).toBe(true);
    });

    it('should ensure UNASSIGNED_ROLE has empty permissions after migration', () => {
      const manager = new SessionManager();

      const v0Session = {
        userId: 'unknown',
        role: UNASSIGNED_ROLE,
        // No permissions field in v0
      };

      const migrated = manager.migrateSession(v0Session);

      expect(migrated.permissions).toEqual([]);
    });

    it('should add default permissions for v0 sessions missing permissions', () => {
      const manager = new SessionManager();

      const v0Session = {
        userId: 'user',
        role: ROLE_USER,
        // No permissions field
      };

      const migrated = manager.migrateSession(v0Session);

      expect(migrated.permissions).toEqual(['read', 'write']);
    });

    it('should not modify already migrated sessions (v1)', () => {
      const manager = new SessionManager();

      const v1Session = {
        _version: 1,
        userId: 'user123',
        role: ROLE_ADMIN,
        permissions: ['read', 'write', 'admin'],
        rejected: false,
      };

      const migrated = manager.migrateSession(v1Session);

      expect(migrated).toEqual(v1Session);
    });
  });

  describe('Session Validation', () => {
    it('should validate non-UNASSIGNED sessions as valid', () => {
      const manager = new SessionManager();

      const jwtPayload: JWTPayload = { sub: 'user' };
      const roleResult: RoleMapperResult = {
        primaryRole: ROLE_USER,
        customRoles: [],
        mappingFailed: false,
      };

      const session = manager.createSession(jwtPayload, roleResult);

      expect(manager.validateSession(session)).toBe(true);
    });

    it('should validate UNASSIGNED sessions as invalid', () => {
      const manager = new SessionManager();

      const jwtPayload: JWTPayload = { sub: 'user' };
      const roleResult: RoleMapperResult = {
        primaryRole: UNASSIGNED_ROLE,
        customRoles: [],
        mappingFailed: true,
      };

      const session = manager.createSession(jwtPayload, roleResult);

      expect(manager.validateSession(session)).toBe(false);
    });
  });

  describe('Custom Permissions', () => {
    it('should support custom role permissions', () => {
      const manager = new SessionManager({
        customPermissions: {
          analyst: ['read', 'analyze', 'report'],
        },
      });

      const jwtPayload: JWTPayload = { sub: 'user' };
      const roleResult: RoleMapperResult = {
        primaryRole: 'analyst',
        customRoles: [],
        mappingFailed: false,
      };

      const session = manager.createSession(jwtPayload, roleResult);

      expect(session.role).toBe('analyst');
      expect(session.permissions).toEqual(['read', 'analyze', 'report']);
    });

    it('should return empty permissions for unknown custom roles', () => {
      const manager = new SessionManager();

      const jwtPayload: JWTPayload = { sub: 'user' };
      const roleResult: RoleMapperResult = {
        primaryRole: 'unknown-custom-role',
        customRoles: [],
        mappingFailed: false,
      };

      const session = manager.createSession(jwtPayload, roleResult);

      expect(session.permissions).toEqual([]);
      expect(session.rejected).toBe(false); // Not rejected, just no permissions
    });
  });

  describe('Custom Roles', () => {
    it('should include custom roles in session', () => {
      const manager = new SessionManager();

      const jwtPayload: JWTPayload = { sub: 'user' };
      const roleResult: RoleMapperResult = {
        primaryRole: ROLE_USER,
        customRoles: ['analyst', 'developer'],
        mappingFailed: false,
      };

      const session = manager.createSession(jwtPayload, roleResult);

      expect(session.customRoles).toEqual(['analyst', 'developer']);
    });
  });

  describe('Scopes Handling', () => {
    it('should convert space-separated scopes to array', () => {
      const manager = new SessionManager();

      const jwtPayload: JWTPayload = {
        sub: 'user',
        scopes: 'read write admin',
      };

      const roleResult: RoleMapperResult = {
        primaryRole: ROLE_ADMIN,
        customRoles: [],
        mappingFailed: false,
      };

      const session = manager.createSession(jwtPayload, roleResult);

      expect(session.scopes).toEqual(['read', 'write', 'admin']);
    });

    it('should handle scopes already as array', () => {
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

    it('should handle missing scopes', () => {
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
    it('should prefer preferred_username over username', () => {
      const manager = new SessionManager();

      const jwtPayload: JWTPayload = {
        sub: 'user123',
        username: 'old.name',
        preferred_username: 'new.name',
      };

      const roleResult: RoleMapperResult = {
        primaryRole: ROLE_USER,
        customRoles: [],
        mappingFailed: false,
      };

      const session = manager.createSession(jwtPayload, roleResult);

      expect(session.username).toBe('new.name');
    });

    it('should fall back to username if preferred_username missing', () => {
      const manager = new SessionManager();

      const jwtPayload: JWTPayload = {
        sub: 'user123',
        username: 'john.doe',
      };

      const roleResult: RoleMapperResult = {
        primaryRole: ROLE_USER,
        customRoles: [],
        mappingFailed: false,
      };

      const session = manager.createSession(jwtPayload, roleResult);

      expect(session.username).toBe('john.doe');
    });

    it('should fall back to sub if no username fields present', () => {
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

  describe('Configuration Updates', () => {
    it('should allow updating permission configuration', () => {
      const manager = new SessionManager();

      manager.updateConfig({
        userPermissions: ['read', 'write', 'execute'],
      });

      const config = manager.getConfig();
      expect(config.userPermissions).toEqual(['read', 'write', 'execute']);
    });

    it('should merge configuration updates', () => {
      const manager = new SessionManager({
        adminPermissions: ['admin'],
      });

      manager.updateConfig({
        userPermissions: ['user'],
      });

      const config = manager.getConfig();
      expect(config.adminPermissions).toEqual(['admin']);
      expect(config.userPermissions).toEqual(['user']);
    });
  });

  describe('Claims Preservation', () => {
    it('should preserve all JWT claims in session', () => {
      const manager = new SessionManager();

      const jwtPayload: JWTPayload = {
        sub: 'user123',
        email: 'user@example.com',
        custom_claim: 'custom_value',
      };

      const roleResult: RoleMapperResult = {
        primaryRole: ROLE_USER,
        customRoles: [],
        mappingFailed: false,
      };

      const session = manager.createSession(jwtPayload, roleResult);

      expect(session.claims).toEqual(jwtPayload);
      expect(session.claims?.email).toBe('user@example.com');
      expect(session.claims?.custom_claim).toBe('custom_value');
    });
  });
});
