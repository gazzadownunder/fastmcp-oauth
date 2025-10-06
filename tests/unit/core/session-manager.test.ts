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
      // SECURITY: Must provide explicit permissions (zero-default policy)
      const manager = new SessionManager({
        adminPermissions: ['admin', 'read', 'write'],
        userPermissions: ['read', 'write'],
        guestPermissions: ['read'],
      });

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
      // SECURITY: Must provide explicit permissions (zero-default policy)
      const manager = new SessionManager({
        adminPermissions: ['admin'],
        userPermissions: ['read', 'write'],
        guestPermissions: ['read'],
      });

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
      // SECURITY: Must provide explicit permissions (zero-default policy)
      const manager = new SessionManager({
        adminPermissions: ['admin'],
        userPermissions: ['read', 'write'],
        guestPermissions: ['read'],
      });

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

    it('should NOT throw even if config has UNASSIGNED_ROLE with permissions (SEC-2 defense-in-depth)', () => {
      // SECURITY (SEC-2): This test validates the early-return defense
      // Even if configuration is malformed (should be rejected by schema),
      // getPermissions() early-returns [] for UNASSIGNED_ROLE, preventing runtime errors
      const manager = new SessionManager({
        customPermissions: {
          [UNASSIGNED_ROLE]: ['read'], // ❌ Invalid config (schema should reject)
        },
      });

      const jwtPayload: JWTPayload = {
        sub: 'user123',
      };

      const roleResult: RoleMapperResult = {
        primaryRole: UNASSIGNED_ROLE,
        customRoles: [],
        mappingFailed: true,
      };

      // SEC-2: Should NOT throw - early return ensures [] permissions
      const session = manager.createSession(jwtPayload, roleResult);

      expect(session.permissions).toEqual([]);
      expect(session.rejected).toBe(true);
      // No exception thrown - fail-safe behavior
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

    it('should add configured permissions for v0 sessions missing permissions', () => {
      // SECURITY: Must provide explicit permissions (zero-default policy)
      const manager = new SessionManager({
        adminPermissions: ['admin'],
        userPermissions: ['read', 'write'],
        guestPermissions: ['read'],
      });

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

  // ============================================================================
  // SECURITY (SEC-2): UNASSIGNED_ROLE Configuration Guard Tests
  // ============================================================================

  describe('UNASSIGNED_ROLE Configuration Guard (SEC-2)', () => {
    describe('Early return protection', () => {
      it('should return empty permissions for UNASSIGNED_ROLE without checking config', () => {
        // Even with a config that has customPermissions, UNASSIGNED_ROLE gets []
        const manager = new SessionManager({
          adminPermissions: ['admin'],
          userPermissions: ['read', 'write'],
          customPermissions: {
            'custom-role': ['custom-perm'],
          },
        });

        const jwtPayload: JWTPayload = { sub: 'user123' };
        const roleResult: RoleMapperResult = {
          primaryRole: UNASSIGNED_ROLE,
          customRoles: [],
          mappingFailed: true,
        };

        const session = manager.createSession(jwtPayload, roleResult);

        expect(session.permissions).toEqual([]);
        expect(session.role).toBe(UNASSIGNED_ROLE);
        expect(session.rejected).toBe(true);
      });

      it('should not throw even if config theoretically had customPermissions.unassigned (defensive)', () => {
        // This test validates defense-in-depth: even if schema validation failed
        // and config has "unassigned" key, getPermissions() early-returns safely
        const malformedConfig = {
          adminPermissions: ['admin'],
          userPermissions: ['read'],
          customPermissions: {
            'unassigned': ['some-permission'], // ❌ Invalid (schema should reject this)
          },
        };

        const manager = new SessionManager(malformedConfig);

        const jwtPayload: JWTPayload = { sub: 'user123' };
        const roleResult: RoleMapperResult = {
          primaryRole: UNASSIGNED_ROLE,
          customRoles: [],
          mappingFailed: true,
        };

        // Should NOT throw - early return bypasses config lookup
        const session = manager.createSession(jwtPayload, roleResult);

        expect(session.permissions).toEqual([]);
        expect(session.role).toBe(UNASSIGNED_ROLE);
      });

      it('should return empty permissions even if UNASSIGNED_ROLE somehow in customPermissions', () => {
        // This validates the fail-safe behavior
        const manager = new SessionManager({
          adminPermissions: [],
          userPermissions: [],
          customPermissions: {
            'unassigned': ['bad-permission'], // Should be ignored
          },
        });

        const jwtPayload: JWTPayload = { sub: 'user123' };
        const roleResult: RoleMapperResult = {
          primaryRole: UNASSIGNED_ROLE,
          customRoles: [],
          mappingFailed: true,
        };

        const session = manager.createSession(jwtPayload, roleResult);

        // Early return ensures [] regardless of config
        expect(session.permissions).toEqual([]);
      });
    });

    describe('Standard role behavior', () => {
      it('should still return admin permissions for ROLE_ADMIN', () => {
        const manager = new SessionManager({
          adminPermissions: ['admin', 'superuser'],
          userPermissions: ['read'],
        });

        const jwtPayload: JWTPayload = { sub: 'admin123' };
        const roleResult: RoleMapperResult = {
          primaryRole: ROLE_ADMIN,
          customRoles: [],
          mappingFailed: false,
        };

        const session = manager.createSession(jwtPayload, roleResult);

        expect(session.permissions).toEqual(['admin', 'superuser']);
      });

      it('should still return user permissions for ROLE_USER', () => {
        const manager = new SessionManager({
          adminPermissions: [],
          userPermissions: ['read', 'write'],
        });

        const jwtPayload: JWTPayload = { sub: 'user123' };
        const roleResult: RoleMapperResult = {
          primaryRole: ROLE_USER,
          customRoles: [],
          mappingFailed: false,
        };

        const session = manager.createSession(jwtPayload, roleResult);

        expect(session.permissions).toEqual(['read', 'write']);
      });

      it('should still return guest permissions for ROLE_GUEST', () => {
        const manager = new SessionManager({
          adminPermissions: [],
          userPermissions: [],
          guestPermissions: ['read-public'],
        });

        const jwtPayload: JWTPayload = { sub: 'guest123' };
        const roleResult: RoleMapperResult = {
          primaryRole: ROLE_GUEST,
          customRoles: [],
          mappingFailed: false,
        };

        const session = manager.createSession(jwtPayload, roleResult);

        expect(session.permissions).toEqual(['read-public']);
      });
    });

    describe('Custom role behavior', () => {
      it('should still return custom role permissions for valid custom roles', () => {
        const manager = new SessionManager({
          adminPermissions: [],
          userPermissions: [],
          customPermissions: {
            'developer': ['code', 'deploy'],
            'analyst': ['read-reports'],
          },
        });

        const jwtPayload: JWTPayload = { sub: 'dev123' };
        const roleResult: RoleMapperResult = {
          primaryRole: 'developer',
          customRoles: [],
          mappingFailed: false,
        };

        const session = manager.createSession(jwtPayload, roleResult);

        expect(session.permissions).toEqual(['code', 'deploy']);
      });

      it('should return empty permissions for unknown custom role', () => {
        const manager = new SessionManager({
          adminPermissions: [],
          userPermissions: [],
          customPermissions: {
            'known-role': ['permission1'],
          },
        });

        const jwtPayload: JWTPayload = { sub: 'user123' };
        const roleResult: RoleMapperResult = {
          primaryRole: 'unknown-role', // Not in config
          customRoles: [],
          mappingFailed: false,
        };

        const session = manager.createSession(jwtPayload, roleResult);

        expect(session.permissions).toEqual([]);
      });
    });
  });
});
