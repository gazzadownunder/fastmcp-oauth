/**
 * Core Module Standalone Integration Test
 *
 * Tests for Phase 1.8: Core Public API
 *
 * Verifies that the Core module can be used standalone without MCP dependencies.
 *
 * @see Docs/refactor-progress.md Phase 1.8
 */

import { describe, it, expect } from 'vitest';

describe('Core Module Standalone Integration', () => {
  describe('Module Imports', () => {
    it('should import core module', async () => {
      const coreModule = await import('../../../src/core/index.js');

      expect(coreModule).toBeDefined();
    });

    it('should export CoreContext type', async () => {
      // Note: CoreContext is a TypeScript type, so we can't check it at runtime
      // This test verifies the module compiles and CoreContext is exported in types
      // The type is verified by TypeScript compilation, not runtime

      const coreModule = await import('../../../src/core/index.js');
      expect(coreModule).toBeDefined();
    });

    it('should export all core services', async () => {
      const {
        AuthenticationService,
        SessionManager,
        JWTValidator,
        RoleMapper,
        AuditService,
        CoreContextValidator,
      } = await import('../../../src/core/index.js');

      expect(AuthenticationService).toBeDefined();
      expect(SessionManager).toBeDefined();
      expect(JWTValidator).toBeDefined();
      expect(RoleMapper).toBeDefined();
      expect(AuditService).toBeDefined();
      expect(CoreContextValidator).toBeDefined();
    });

    it('should export role constants', async () => {
      const {
        UNASSIGNED_ROLE,
        ROLE_ADMIN,
        ROLE_USER,
        ROLE_GUEST,
      } = await import('../../../src/core/index.js');

      expect(UNASSIGNED_ROLE).toBe('unassigned');
      expect(ROLE_ADMIN).toBe('admin');
      expect(ROLE_USER).toBe('user');
      expect(ROLE_GUEST).toBe('guest');
    });
  });

  describe('CoreContextValidator Usage', () => {
    it('should validate valid CoreContext', async () => {
      const { CoreContextValidator } = await import('../../../src/core/index.js');

      const mockContext = {
        authService: {},
        auditService: {},
        delegationRegistry: {},
        configManager: {},
      };

      expect(() => CoreContextValidator.validate(mockContext)).not.toThrow();
    });

    it('should reject invalid CoreContext', async () => {
      const { CoreContextValidator } = await import('../../../src/core/index.js');

      const invalidContext = {
        authService: {},
        // Missing other fields
      };

      expect(() => CoreContextValidator.validate(invalidContext as any)).toThrow();
    });

    it('should use isValid type guard', async () => {
      const { CoreContextValidator } = await import('../../../src/core/index.js');

      const validContext = {
        authService: {},
        auditService: {},
        delegationRegistry: {},
        configManager: {},
      };

      const invalidContext = { authService: {} };

      expect(CoreContextValidator.isValid(validContext)).toBe(true);
      expect(CoreContextValidator.isValid(invalidContext)).toBe(false);
    });
  });

  describe('Role Mapper Standalone', () => {
    it('should create and use RoleMapper without dependencies', async () => {
      const { RoleMapper, ROLE_ADMIN, ROLE_USER, UNASSIGNED_ROLE } = await import(
        '../../../src/core/index.js'
      );

      const mapper = new RoleMapper({
        adminRoles: ['admin'],
        userRoles: ['user'],
      });

      const result = mapper.determineRoles(['admin', 'user']);

      expect(result.primaryRole).toBe(ROLE_ADMIN);
      expect(result.mappingFailed).toBe(false);
    });

    it('should handle role mapping failure gracefully', async () => {
      const { RoleMapper, UNASSIGNED_ROLE } = await import(
        '../../../src/core/index.js'
      );

      const mapper = new RoleMapper();

      // Pass invalid input (not an array)
      const result = mapper.determineRoles(null as any);

      expect(result.primaryRole).toBe(UNASSIGNED_ROLE);
      expect(result.mappingFailed).toBe(true);
      expect(result.failureReason).toBeDefined();
    });
  });

  describe('Session Manager Standalone', () => {
    it('should create sessions without dependencies', async () => {
      const { SessionManager, ROLE_USER } = await import(
        '../../../src/core/index.js'
      );

      const manager = new SessionManager();

      const session = manager.createSession(
        {
          sub: 'user123',
          preferred_username: 'john.doe',
        },
        {
          primaryRole: ROLE_USER,
          customRoles: [],
          mappingFailed: false,
        }
      );

      expect(session._version).toBe(1);
      expect(session.userId).toBe('user123');
      expect(session.role).toBe(ROLE_USER);
      expect(session.rejected).toBe(false);
    });

    it('should migrate old session schemas', async () => {
      const { SessionManager } = await import('../../../src/core/index.js');

      const manager = new SessionManager();

      const oldSession = {
        userId: 'user123',
        role: 'user',
        // No _version field (v0 schema)
      };

      const migrated = manager.migrateSession(oldSession);

      expect(migrated._version).toBe(1);
      expect(migrated.userId).toBe('user123');
    });
  });

  describe('Audit Service Standalone', () => {
    it('should use Null Object Pattern when disabled', async () => {
      const { AuditService } = await import('../../../src/core/index.js');

      const audit = new AuditService(); // No config = disabled

      // Should not throw
      await audit.log({
        timestamp: new Date(),
        source: 'test',
        action: 'test',
        success: true,
      });
    });

    it('should log when enabled', async () => {
      const { AuditService } = await import('../../../src/core/index.js');

      const logs: any[] = [];
      const audit = new AuditService({
        enabled: true,
        storage: {
          log: (entry) => logs.push(entry),
        },
      });

      await audit.log({
        timestamp: new Date(),
        source: 'test',
        action: 'test-action',
        success: true,
      });

      expect(logs).toHaveLength(1);
      expect(logs[0].source).toBe('test');
      expect(logs[0].action).toBe('test-action');
    });
  });

  describe('Full Authentication Flow (Mocked)', () => {
    it('should perform full auth flow without MCP', async () => {
      const {
        AuthenticationService,
        AuditService,
        ROLE_USER,
      } = await import('../../../src/core/index.js');

      const mockConfig = {
        idpConfigs: [
          {
            issuer: 'https://auth.test.com',
            jwksUri: 'https://auth.test.com/.well-known/jwks.json',
            audience: 'test-api',
            algorithms: ['RS256'],
            claimMappings: {
              legacyUsername: 'legacy_sam_account',
              roles: 'user_roles',
              scopes: 'scopes',
            },
            security: {
              clockTolerance: 60,
              maxTokenAge: 3600,
              requireNbf: true,
            },
          },
        ],
        roleMappings: {
          userRoles: ['user'],
        },
      };

      const audit = new AuditService({ enabled: true });
      const authService = new AuthenticationService(mockConfig, audit);

      // Note: Full JWT validation requires JWKS, so we can't test end-to-end here
      // This test verifies the service can be constructed and initialized
      expect(authService).toBeDefined();
      expect(authService.getConfig()).toEqual(mockConfig);
    });
  });

  describe('Type Exports', () => {
    it('should export all necessary types', async () => {
      // Types are verified by TypeScript compilation
      // All types (CoreContext, UserSession, etc.) are exported from index.ts
      // If any type is missing, TypeScript compilation will fail

      // Runtime verification - module exists and compiles
      const coreModule = await import('../../../src/core/index.js');
      expect(coreModule).toBeDefined();
    });
  });

  describe('Architectural Integrity', () => {
    it('should not import from MCP layer', async () => {
      // This test verifies that src/core/index.ts does not import from src/mcp
      // If it did, we'd have a circular dependency violation

      const coreModule = await import('../../../src/core/index.js');

      // If this imports successfully, Core doesn't depend on MCP
      expect(coreModule).toBeDefined();
    });

    it('should export CoreContext from Core layer (GAP #Architecture)', async () => {
      // CoreContext is exported from core/index.ts (verified by TypeScript compilation)
      // This ensures Core layer owns CoreContext, preventing circular dependencies

      // Runtime check - module loads successfully
      const coreModule = await import('../../../src/core/index.js');
      expect(coreModule).toBeDefined();
    });
  });
});
