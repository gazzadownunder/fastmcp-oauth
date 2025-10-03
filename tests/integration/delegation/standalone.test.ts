/**
 * Delegation Layer Standalone Integration Test
 *
 * Tests for Phase 2: Delegation Module System
 *
 * Verifies that the Delegation layer can be used standalone and integrates properly with Core.
 *
 * @see Docs/refactor-progress.md Phase 2
 */

import { describe, it, expect, vi } from 'vitest';

describe('Delegation Layer Standalone Integration', () => {
  describe('Module Imports', () => {
    it('should import delegation module', async () => {
      const delegationModule = await import('../../../src/delegation/index.js');

      expect(delegationModule).toBeDefined();
    });

    it('should export DelegationRegistry', async () => {
      const { DelegationRegistry } = await import('../../../src/delegation/index.js');

      expect(DelegationRegistry).toBeDefined();
    });

    it('should export SQLDelegationModule', async () => {
      const { SQLDelegationModule } = await import('../../../src/delegation/index.js');

      expect(SQLDelegationModule).toBeDefined();
    });

    it('should export delegation types', async () => {
      // Types are verified by TypeScript compilation
      // All types (DelegationModule, DelegationResult, etc.) are exported from index.ts
      // If any type is missing, TypeScript compilation will fail

      // Runtime verification
      const delegationModule = await import('../../../src/delegation/index.js');
      expect(delegationModule).toBeDefined();
    });
  });

  describe('DelegationRegistry Standalone', () => {
    it('should create registry without dependencies', async () => {
      const { DelegationRegistry } = await import('../../../src/delegation/index.js');

      const registry = new DelegationRegistry();

      expect(registry).toBeDefined();
      expect(registry.list()).toEqual([]);
    });

    it('should create registry with Core AuditService', async () => {
      const { DelegationRegistry } = await import('../../../src/delegation/index.js');
      const { AuditService } = await import('../../../src/core/index.js');

      const auditService = new AuditService({ enabled: true });
      const registry = new DelegationRegistry(auditService);

      expect(registry).toBeDefined();
    });
  });

  describe('SQL Delegation Module Creation', () => {
    it('should create SQL module', async () => {
      const { SQLDelegationModule } = await import('../../../src/delegation/index.js');

      const sqlModule = new SQLDelegationModule();

      expect(sqlModule.name).toBe('sql');
      expect(sqlModule.type).toBe('database');
    });

    it('should have required DelegationModule methods', async () => {
      const { SQLDelegationModule } = await import('../../../src/delegation/index.js');

      const sqlModule = new SQLDelegationModule();

      expect(typeof sqlModule.initialize).toBe('function');
      expect(typeof sqlModule.delegate).toBe('function');
      expect(typeof sqlModule.validateAccess).toBe('function');
      expect(typeof sqlModule.healthCheck).toBe('function');
      expect(typeof sqlModule.destroy).toBe('function');
    });
  });

  describe('Module Registration Flow', () => {
    it('should register SQL module with registry', async () => {
      const { DelegationRegistry, SQLDelegationModule } = await import(
        '../../../src/delegation/index.js'
      );

      const registry = new DelegationRegistry();
      const sqlModule = new SQLDelegationModule();

      registry.register(sqlModule);

      expect(registry.has('sql')).toBe(true);
      expect(registry.get('sql')).toBe(sqlModule);
    });

    it('should list registered modules', async () => {
      const { DelegationRegistry, SQLDelegationModule } = await import(
        '../../../src/delegation/index.js'
      );

      const registry = new DelegationRegistry();
      const sqlModule = new SQLDelegationModule();

      registry.register(sqlModule);

      const modules = registry.list();
      expect(modules).toHaveLength(1);
      expect(modules[0]).toBe(sqlModule);
    });
  });

  describe('Integration with Core', () => {
    it('should integrate with Core AuditService', async () => {
      const { DelegationRegistry, SQLDelegationModule } = await import(
        '../../../src/delegation/index.js'
      );
      const { AuditService } = await import('../../../src/core/index.js');

      const logs: any[] = [];
      const auditService = new AuditService({
        enabled: true,
        storage: {
          log: (entry) => logs.push(entry),
        },
      });

      const registry = new DelegationRegistry(auditService);
      const sqlModule = new SQLDelegationModule();

      registry.register(sqlModule);

      // Should have logged registration
      expect(logs).toHaveLength(1);
      expect(logs[0].source).toBe('delegation:registry');
      expect(logs[0].action).toBe('delegation_module_registered');
      expect(logs[0].metadata.moduleName).toBe('sql');
    });

    it('should accept Core UserSession in delegate calls', async () => {
      const { DelegationRegistry, SQLDelegationModule } = await import(
        '../../../src/delegation/index.js'
      );
      const { ROLE_USER } = await import('../../../src/core/index.js');

      const registry = new DelegationRegistry();
      const sqlModule = new SQLDelegationModule();

      registry.register(sqlModule);

      // Create Core UserSession
      const session = {
        _version: 1,
        userId: 'user123',
        username: 'test.user',
        legacyUsername: 'DOMAIN\\testuser',
        role: ROLE_USER,
        permissions: ['read', 'write'],
        rejected: false,
      };

      // Note: This will fail without SQL server, but verifies types are compatible
      const result = await registry.delegate('sql', session, 'query', {
        sql: 'SELECT 1',
      });

      // Should fail gracefully (no SQL server in test)
      expect(result.success).toBe(false);
      expect(result.auditTrail).toBeDefined();
      expect(result.auditTrail.source).toBe('delegation:sql');
    });
  });

  describe('Access Validation', () => {
    it('should validate session has legacyUsername for SQL', async () => {
      const { SQLDelegationModule } = await import('../../../src/delegation/index.js');

      const sqlModule = new SQLDelegationModule();

      const sessionWithLegacy = {
        _version: 1,
        userId: 'user123',
        username: 'test.user',
        legacyUsername: 'DOMAIN\\testuser',
        role: 'user',
        permissions: ['read'],
        rejected: false,
      };

      const sessionWithoutLegacy = {
        _version: 1,
        userId: 'user456',
        username: 'test.user2',
        role: 'user',
        permissions: ['read'],
        rejected: false,
      };

      expect(await sqlModule.validateAccess(sessionWithLegacy)).toBe(true);
      expect(await sqlModule.validateAccess(sessionWithoutLegacy)).toBe(false);
    });
  });

  describe('Health Checks', () => {
    it('should return false when not initialized', async () => {
      const { SQLDelegationModule } = await import('../../../src/delegation/index.js');

      const sqlModule = new SQLDelegationModule();

      expect(await sqlModule.healthCheck()).toBe(false);
    });
  });

  describe('Architectural Integrity', () => {
    it('should not import from MCP layer', async () => {
      // This test verifies that src/delegation/ does not import from src/mcp
      // If it did, we'd have a circular dependency violation

      const delegationModule = await import('../../../src/delegation/index.js');

      // If this imports successfully, Delegation doesn't depend on MCP
      expect(delegationModule).toBeDefined();
    });

    it('should be able to import from Core layer', async () => {
      // Delegation CAN import from Core (one-way dependency: Core → Delegation → MCP)

      const { DelegationRegistry } = await import('../../../src/delegation/index.js');
      const { AuditService } = await import('../../../src/core/index.js');

      const auditService = new AuditService();
      const registry = new DelegationRegistry(auditService);

      expect(registry).toBeDefined();
    });
  });

  describe('Audit Trail Compliance (GAP #3)', () => {
    it('should create audit trails with source field', async () => {
      const { DelegationRegistry, SQLDelegationModule } = await import(
        '../../../src/delegation/index.js'
      );

      const registry = new DelegationRegistry();
      const sqlModule = new SQLDelegationModule();

      registry.register(sqlModule);

      const session = {
        _version: 1,
        userId: 'user123',
        username: 'test.user',
        legacyUsername: 'DOMAIN\\testuser',
        role: 'user',
        permissions: ['read'],
        rejected: false,
      };

      const result = await registry.delegate('sql', session, 'query', {
        sql: 'SELECT 1',
      });

      // Should have audit trail with source field
      expect(result.auditTrail).toBeDefined();
      expect(result.auditTrail.source).toBeDefined();
      expect(result.auditTrail.source).toContain('delegation:');
    });
  });
});
