/**
 * DelegationRegistry Tests
 *
 * Tests for Phase 2.2: Delegation Registry with AuditService
 *
 * @see Docs/refactor-progress.md Phase 2.2
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DelegationRegistry } from '../../../src/delegation/registry.js';
import { AuditService } from '../../../src/core/index.js';
import type { DelegationModule, DelegationResult } from '../../../src/delegation/base.js';
import type { UserSession, AuditEntry } from '../../../src/core/index.js';

describe('DelegationRegistry', () => {
  // Mock module for testing
  const createMockModule = (name: string, type: string = 'test'): DelegationModule => ({
    name,
    type,
    initialize: vi.fn().mockResolvedValue(undefined),
    delegate: vi.fn().mockResolvedValue({
      success: true,
      data: { result: 'mock' },
      auditTrail: {
        timestamp: new Date(),
        source: `delegation:${name}`,
        action: 'delegate',
        success: true,
      },
    }),
    validateAccess: vi.fn().mockResolvedValue(true),
    healthCheck: vi.fn().mockResolvedValue(true),
    destroy: vi.fn().mockResolvedValue(undefined),
  });

  const createMockSession = (): UserSession => ({
    _version: 1,
    userId: 'user123',
    username: 'test.user',
    role: 'user',
    permissions: ['read', 'write'],
    rejected: false,
  });

  describe('Module Registration', () => {
    it('should register a module', () => {
      const registry = new DelegationRegistry();
      const module = createMockModule('test-module');

      registry.register(module);

      expect(registry.has('test-module')).toBe(true);
      expect(registry.get('test-module')).toBe(module);
    });

    it('should throw if module already registered', () => {
      const registry = new DelegationRegistry();
      const module = createMockModule('test-module');

      registry.register(module);

      expect(() => registry.register(module)).toThrow(
        'Delegation module already registered: test-module'
      );
    });

    it('should log registration event to audit service', () => {
      const auditService = new AuditService({ enabled: true });
      const auditSpy = vi.spyOn(auditService, 'log');
      const registry = new DelegationRegistry(auditService);
      const module = createMockModule('test-module', 'database');

      registry.register(module);

      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'delegation:registry',
          action: 'delegation_module_registered',
          success: true,
          metadata: { moduleName: 'test-module', moduleType: 'database' },
        })
      );
    });
  });

  describe('Module Unregistration', () => {
    it('should unregister a module', () => {
      const registry = new DelegationRegistry();
      const module = createMockModule('test-module');

      registry.register(module);
      const removed = registry.unregister('test-module');

      expect(removed).toBe(true);
      expect(registry.has('test-module')).toBe(false);
    });

    it('should return false when unregistering non-existent module', () => {
      const registry = new DelegationRegistry();

      const removed = registry.unregister('non-existent');

      expect(removed).toBe(false);
    });

    it('should log unregistration event', () => {
      const auditService = new AuditService({ enabled: true });
      const auditSpy = vi.spyOn(auditService, 'log');
      const registry = new DelegationRegistry(auditService);
      const module = createMockModule('test-module');

      registry.register(module);
      auditSpy.mockClear(); // Clear registration event

      registry.unregister('test-module');

      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'delegation:registry',
          action: 'delegation_module_unregistered',
          success: true,
          metadata: { moduleName: 'test-module' },
        })
      );
    });
  });

  describe('Module Listing', () => {
    it('should list all registered modules', () => {
      const registry = new DelegationRegistry();
      const module1 = createMockModule('module1');
      const module2 = createMockModule('module2');

      registry.register(module1);
      registry.register(module2);

      const modules = registry.list();

      expect(modules).toHaveLength(2);
      expect(modules).toContain(module1);
      expect(modules).toContain(module2);
    });

    it('should return empty array when no modules registered', () => {
      const registry = new DelegationRegistry();

      expect(registry.list()).toEqual([]);
    });
  });

  describe('Delegation Routing', () => {
    it('should delegate to correct module', async () => {
      const registry = new DelegationRegistry();
      const module = createMockModule('sql');
      const session = createMockSession();

      registry.register(module);

      const result = await registry.delegate('sql', session, 'query', { sql: 'SELECT 1' });

      expect(module.delegate).toHaveBeenCalledWith(session, 'query', { sql: 'SELECT 1' });
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ result: 'mock' });
    });

    it('should return error for non-existent module', async () => {
      const registry = new DelegationRegistry();
      const session = createMockSession();

      const result = await registry.delegate('non-existent', session, 'test', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Module not found: non-existent');
    });

    it('should log module not found to audit service', async () => {
      const auditService = new AuditService({ enabled: true });
      const auditSpy = vi.spyOn(auditService, 'log');
      const registry = new DelegationRegistry(auditService);
      const session = createMockSession();

      await registry.delegate('non-existent', session, 'test', {});

      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'delegation:registry',
          userId: 'user123',
          action: 'delegation_failed',
          success: false,
          reason: 'Module not found: non-existent',
        })
      );
    });
  });

  describe('CRITICAL: Audit Source Field (GAP #3)', () => {
    it('should add source field if module did not provide it', async () => {
      const auditService = new AuditService({ enabled: true });
      const auditSpy = vi.spyOn(auditService, 'log');
      const registry = new DelegationRegistry(auditService);
      const session = createMockSession();

      // Create module that returns auditTrail WITHOUT source field
      const module: DelegationModule = {
        name: 'bad-module',
        type: 'test',
        initialize: vi.fn().mockResolvedValue(undefined),
        delegate: vi.fn().mockResolvedValue({
          success: true,
          data: {},
          auditTrail: {
            timestamp: new Date(),
            // Missing source field!
            action: 'test',
            success: true,
          } as AuditEntry, // Type assertion to bypass compile error
        }),
        validateAccess: vi.fn().mockResolvedValue(true),
        healthCheck: vi.fn().mockResolvedValue(true),
        destroy: vi.fn().mockResolvedValue(undefined),
      };

      registry.register(module);
      await registry.delegate('bad-module', session, 'test', {});

      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'delegation:bad-module', // Registry added source field
        })
      );
    });

    it('should preserve source field from module if provided', async () => {
      const auditService = new AuditService({ enabled: true });
      const auditSpy = vi.spyOn(auditService, 'log');
      const registry = new DelegationRegistry(auditService);
      const session = createMockSession();

      const module = createMockModule('good-module');

      registry.register(module);
      await registry.delegate('good-module', session, 'test', {});

      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'delegation:good-module', // Module's source preserved
        })
      );
    });

    it('should log all delegation attempts with source field', async () => {
      const auditService = new AuditService({ enabled: true });
      const auditSpy = vi.spyOn(auditService, 'log');
      const registry = new DelegationRegistry(auditService);
      const module = createMockModule('test-module');
      const session = createMockSession();

      registry.register(module);
      auditSpy.mockClear(); // Clear registration event

      await registry.delegate('test-module', session, 'action', {});

      // Should have logged the delegation audit trail
      expect(auditSpy).toHaveBeenCalledTimes(1);
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          source: expect.stringContaining('delegation:'),
        })
      );
    });
  });

  describe('Module Initialization', () => {
    it('should initialize all modules with configs', async () => {
      const registry = new DelegationRegistry();
      const module1 = createMockModule('sql');
      const module2 = createMockModule('kerberos');

      registry.register(module1);
      registry.register(module2);

      const configs = {
        sql: { server: 'localhost' },
        kerberos: { realm: 'DOMAIN.COM' },
      };

      await registry.initializeAll(configs);

      expect(module1.initialize).toHaveBeenCalledWith({ server: 'localhost' });
      expect(module2.initialize).toHaveBeenCalledWith({ realm: 'DOMAIN.COM' });
    });

    it('should throw if module config missing', async () => {
      const registry = new DelegationRegistry();
      const module = createMockModule('sql');

      registry.register(module);

      await expect(registry.initializeAll({})).rejects.toThrow(
        'No configuration found for module: sql'
      );
    });

    it('should throw if any module initialization fails', async () => {
      const registry = new DelegationRegistry();
      const module = createMockModule('sql');
      (module.initialize as any).mockRejectedValue(new Error('Connection failed'));

      registry.register(module);

      await expect(
        registry.initializeAll({ sql: { server: 'localhost' } })
      ).rejects.toThrow('Module initialization failed');
    });
  });

  describe('Module Destruction', () => {
    it('should destroy all modules', async () => {
      const registry = new DelegationRegistry();
      const module1 = createMockModule('module1');
      const module2 = createMockModule('module2');

      registry.register(module1);
      registry.register(module2);

      await registry.destroyAll();

      expect(module1.destroy).toHaveBeenCalled();
      expect(module2.destroy).toHaveBeenCalled();
      expect(registry.list()).toEqual([]);
    });

    it('should continue destroying even if one module fails', async () => {
      const registry = new DelegationRegistry();
      const module1 = createMockModule('module1');
      const module2 = createMockModule('module2');
      (module1.destroy as any).mockRejectedValue(new Error('Destroy failed'));

      registry.register(module1);
      registry.register(module2);

      await registry.destroyAll();

      expect(module1.destroy).toHaveBeenCalled();
      expect(module2.destroy).toHaveBeenCalled();
    });
  });

  describe('Health Checks', () => {
    it('should check health of all modules', async () => {
      const registry = new DelegationRegistry();
      const module1 = createMockModule('module1');
      const module2 = createMockModule('module2');

      registry.register(module1);
      registry.register(module2);

      const health = await registry.healthCheckAll();

      expect(health.get('module1')).toBe(true);
      expect(health.get('module2')).toBe(true);
    });

    it('should return false for unhealthy module', async () => {
      const registry = new DelegationRegistry();
      const module = createMockModule('unhealthy');
      (module.healthCheck as any).mockResolvedValue(false);

      registry.register(module);

      const health = await registry.healthCheckAll();

      expect(health.get('unhealthy')).toBe(false);
    });

    it('should return false if health check throws', async () => {
      const registry = new DelegationRegistry();
      const module = createMockModule('broken');
      (module.healthCheck as any).mockRejectedValue(new Error('Health check failed'));

      registry.register(module);

      const health = await registry.healthCheckAll();

      expect(health.get('broken')).toBe(false);
    });
  });

  describe('Null Object Pattern', () => {
    it('should work without audit service', async () => {
      const registry = new DelegationRegistry(); // No audit service
      const module = createMockModule('test');
      const session = createMockSession();

      registry.register(module);

      // Should not throw
      await registry.delegate('test', session, 'action', {});
    });
  });

  // ============================================================================
  // SECURITY (SEC-1): Trust Boundary Enforcement Tests
  // ============================================================================

  describe('Trust Boundary Enforcement (SEC-1)', () => {
    describe('Trust verification fields', () => {
      it('should inject registryVerifiedSuccess field', async () => {
        const auditService = new AuditService({ enabled: true });
        const auditSpy = vi.spyOn(auditService, 'log');
        const registry = new DelegationRegistry(auditService);
        const module = createMockModule('test');
        const session = createMockSession();

        registry.register(module);
        await registry.delegate('test', session, 'query', {});

        // Find the delegation audit log (not registration)
        const delegationLog = auditSpy.mock.calls.find(
          call => call[0].action === 'delegate'
        );
        expect(delegationLog).toBeDefined();
        expect(delegationLog![0]).toHaveProperty('registryVerifiedSuccess', true);
      });

      it('should inject registryTimestamp field', async () => {
        const auditService = new AuditService({ enabled: true });
        const auditSpy = vi.spyOn(auditService, 'log');
        const registry = new DelegationRegistry(auditService);
        const module = createMockModule('test');
        const session = createMockSession();

        registry.register(module);
        const before = new Date();
        await registry.delegate('test', session, 'query', {});
        const after = new Date();

        const delegationLog = auditSpy.mock.calls.find(
          call => call[0].action === 'delegate'
        );
        expect(delegationLog).toBeDefined();
        expect(delegationLog![0]).toHaveProperty('registryTimestamp');
        const timestamp = delegationLog![0].registryTimestamp as Date;
        expect(timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
        expect(timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
      });

      it('should inject userId if module omits it', async () => {
        const auditService = new AuditService({ enabled: true });
        const auditSpy = vi.spyOn(auditService, 'log');
        const registry = new DelegationRegistry(auditService);

        // Module that doesn't include userId in audit trail
        const badModule: DelegationModule = {
          name: 'bad-module',
          type: 'test',
          initialize: vi.fn().mockResolvedValue(undefined),
          delegate: vi.fn().mockResolvedValue({
            success: true,
            data: { result: 'test' },
            auditTrail: {
              timestamp: new Date(),
              source: 'delegation:bad-module',
              action: 'delegate',
              success: true,
              // userId deliberately omitted
            },
          }),
          validateAccess: vi.fn().mockResolvedValue(true),
          healthCheck: vi.fn().mockResolvedValue(true),
          destroy: vi.fn().mockResolvedValue(undefined),
        };

        const session = createMockSession();
        registry.register(badModule);
        await registry.delegate('bad-module', session, 'query', {});

        const delegationLog = auditSpy.mock.calls.find(
          call => call[0].action === 'delegate'
        );
        expect(delegationLog).toBeDefined();
        expect(delegationLog![0].userId).toBe('user123');
      });

      it('should record moduleReportedSuccess from module audit trail', async () => {
        const auditService = new AuditService({ enabled: true });
        const auditSpy = vi.spyOn(auditService, 'log');
        const registry = new DelegationRegistry(auditService);
        const module = createMockModule('test');
        const session = createMockSession();

        registry.register(module);
        await registry.delegate('test', session, 'query', {});

        const delegationLog = auditSpy.mock.calls.find(
          call => call[0].action === 'delegate'
        );
        expect(delegationLog).toBeDefined();
        expect(delegationLog![0]).toHaveProperty('moduleReportedSuccess', true);
      });
    });

    describe('Trust boundary violations', () => {
      it('should detect when module reports success=true but result.success=false', async () => {
        const auditService = new AuditService({ enabled: true });
        const auditSpy = vi.spyOn(auditService, 'log');
        const registry = new DelegationRegistry(auditService);

        // Malicious module: reports success in audit but returns failure
        const maliciousModule: DelegationModule = {
          name: 'malicious',
          type: 'test',
          initialize: vi.fn().mockResolvedValue(undefined),
          delegate: vi.fn().mockResolvedValue({
            success: false, // Registry sees failure
            error: 'Operation failed',
            auditTrail: {
              timestamp: new Date(),
              source: 'delegation:malicious',
              action: 'query',
              success: true, // But module claims success!
            },
          }),
          validateAccess: vi.fn().mockResolvedValue(true),
          healthCheck: vi.fn().mockResolvedValue(true),
          destroy: vi.fn().mockResolvedValue(undefined),
        };

        const session = createMockSession();
        registry.register(maliciousModule);
        await registry.delegate('malicious', session, 'query', {});

        // Should log trust_boundary_violation
        const violationLog = auditSpy.mock.calls.find(
          call => call[0].action === 'trust_boundary_violation'
        );
        expect(violationLog).toBeDefined();
        expect(violationLog![0].success).toBe(false);
        expect(violationLog![0].source).toBe('delegation:registry:security');
      });

      it('should detect when module reports success=false but result.success=true', async () => {
        const auditService = new AuditService({ enabled: true });
        const auditSpy = vi.spyOn(auditService, 'log');
        const registry = new DelegationRegistry(auditService);

        // Malicious module: reports failure in audit but returns success
        const maliciousModule: DelegationModule = {
          name: 'malicious',
          type: 'test',
          initialize: vi.fn().mockResolvedValue(undefined),
          delegate: vi.fn().mockResolvedValue({
            success: true, // Registry sees success
            data: { result: 'hidden' },
            auditTrail: {
              timestamp: new Date(),
              source: 'delegation:malicious',
              action: 'query',
              success: false, // But module hides it!
            },
          }),
          validateAccess: vi.fn().mockResolvedValue(true),
          healthCheck: vi.fn().mockResolvedValue(true),
          destroy: vi.fn().mockResolvedValue(undefined),
        };

        const session = createMockSession();
        registry.register(maliciousModule);
        await registry.delegate('malicious', session, 'query', {});

        // Should log trust_boundary_violation
        const violationLog = auditSpy.mock.calls.find(
          call => call[0].action === 'trust_boundary_violation'
        );
        expect(violationLog).toBeDefined();
      });

      it('should log trust_boundary_violation event when discrepancy detected', async () => {
        const auditService = new AuditService({ enabled: true });
        const auditSpy = vi.spyOn(auditService, 'log');
        const registry = new DelegationRegistry(auditService);

        const maliciousModule: DelegationModule = {
          name: 'malicious',
          type: 'database',
          initialize: vi.fn().mockResolvedValue(undefined),
          delegate: vi.fn().mockResolvedValue({
            success: true,
            data: { result: 'data' },
            auditTrail: {
              timestamp: new Date(),
              source: 'delegation:malicious',
              action: 'query',
              success: false, // Discrepancy
            },
          }),
          validateAccess: vi.fn().mockResolvedValue(true),
          healthCheck: vi.fn().mockResolvedValue(true),
          destroy: vi.fn().mockResolvedValue(undefined),
        };

        const session = createMockSession();
        registry.register(maliciousModule);
        await registry.delegate('malicious', session, 'query', {});

        const violationLog = auditSpy.mock.calls.find(
          call => call[0].action === 'trust_boundary_violation'
        );
        expect(violationLog).toBeDefined();
        expect(violationLog![0]).toMatchObject({
          source: 'delegation:registry:security',
          action: 'trust_boundary_violation',
          success: false,
          userId: 'user123',
        });
        expect(violationLog![0].reason).toContain('malicious');
        expect(violationLog![0].reason).toContain('reported success=false');
        expect(violationLog![0].reason).toContain('observed success=true');
      });

      it('should include module name in violation metadata', async () => {
        const auditService = new AuditService({ enabled: true });
        const auditSpy = vi.spyOn(auditService, 'log');
        const registry = new DelegationRegistry(auditService);

        const maliciousModule: DelegationModule = {
          name: 'evil-module',
          type: 'database',
          initialize: vi.fn().mockResolvedValue(undefined),
          delegate: vi.fn().mockResolvedValue({
            success: true,
            auditTrail: {
              timestamp: new Date(),
              source: 'delegation:evil-module',
              action: 'query',
              success: false,
            },
          }),
          validateAccess: vi.fn().mockResolvedValue(true),
          healthCheck: vi.fn().mockResolvedValue(true),
          destroy: vi.fn().mockResolvedValue(undefined),
        };

        const session = createMockSession();
        registry.register(maliciousModule);
        await registry.delegate('evil-module', session, 'query', {});

        const violationLog = auditSpy.mock.calls.find(
          call => call[0].action === 'trust_boundary_violation'
        );
        expect(violationLog).toBeDefined();
        expect(violationLog![0].metadata).toMatchObject({
          moduleName: 'evil-module',
          moduleType: 'database',
          delegationAction: 'query',
        });
      });

      it('should include both success values in violation metadata', async () => {
        const auditService = new AuditService({ enabled: true });
        const auditSpy = vi.spyOn(auditService, 'log');
        const registry = new DelegationRegistry(auditService);

        const maliciousModule: DelegationModule = {
          name: 'malicious',
          type: 'test',
          initialize: vi.fn().mockResolvedValue(undefined),
          delegate: vi.fn().mockResolvedValue({
            success: false,
            error: 'failed',
            auditTrail: {
              timestamp: new Date(),
              source: 'delegation:malicious',
              action: 'query',
              success: true,
            },
          }),
          validateAccess: vi.fn().mockResolvedValue(true),
          healthCheck: vi.fn().mockResolvedValue(true),
          destroy: vi.fn().mockResolvedValue(undefined),
        };

        const session = createMockSession();
        registry.register(maliciousModule);
        await registry.delegate('malicious', session, 'query', {});

        const violationLog = auditSpy.mock.calls.find(
          call => call[0].action === 'trust_boundary_violation'
        );
        expect(violationLog).toBeDefined();
        expect(violationLog![0].metadata).toMatchObject({
          moduleReportedSuccess: true,
          registryVerifiedSuccess: false,
        });
      });
    });

    describe('Honest module behavior', () => {
      it('should not log violation when module and registry agree on success=true', async () => {
        const auditService = new AuditService({ enabled: true });
        const auditSpy = vi.spyOn(auditService, 'log');
        const registry = new DelegationRegistry(auditService);

        const honestModule: DelegationModule = {
          name: 'honest',
          type: 'test',
          initialize: vi.fn().mockResolvedValue(undefined),
          delegate: vi.fn().mockResolvedValue({
            success: true,
            data: { result: 'data' },
            auditTrail: {
              timestamp: new Date(),
              source: 'delegation:honest',
              action: 'query',
              success: true, // Matches result.success
            },
          }),
          validateAccess: vi.fn().mockResolvedValue(true),
          healthCheck: vi.fn().mockResolvedValue(true),
          destroy: vi.fn().mockResolvedValue(undefined),
        };

        const session = createMockSession();
        registry.register(honestModule);
        await registry.delegate('honest', session, 'query', {});

        // Should NOT log trust_boundary_violation
        const violationLog = auditSpy.mock.calls.find(
          call => call[0].action === 'trust_boundary_violation'
        );
        expect(violationLog).toBeUndefined();
      });

      it('should not log violation when module and registry agree on success=false', async () => {
        const auditService = new AuditService({ enabled: true });
        const auditSpy = vi.spyOn(auditService, 'log');
        const registry = new DelegationRegistry(auditService);

        const honestModule: DelegationModule = {
          name: 'honest',
          type: 'test',
          initialize: vi.fn().mockResolvedValue(undefined),
          delegate: vi.fn().mockResolvedValue({
            success: false,
            error: 'Legitimate error',
            auditTrail: {
              timestamp: new Date(),
              source: 'delegation:honest',
              action: 'query',
              success: false, // Matches result.success
            },
          }),
          validateAccess: vi.fn().mockResolvedValue(true),
          healthCheck: vi.fn().mockResolvedValue(true),
          destroy: vi.fn().mockResolvedValue(undefined),
        };

        const session = createMockSession();
        registry.register(honestModule);
        await registry.delegate('honest', session, 'query', {});

        // Should NOT log trust_boundary_violation
        const violationLog = auditSpy.mock.calls.find(
          call => call[0].action === 'trust_boundary_violation'
        );
        expect(violationLog).toBeUndefined();
      });
    });

    describe('Audit trail enhancement', () => {
      it('should preserve all original audit trail fields', async () => {
        const auditService = new AuditService({ enabled: true });
        const auditSpy = vi.spyOn(auditService, 'log');
        const registry = new DelegationRegistry(auditService);

        const module: DelegationModule = {
          name: 'test',
          type: 'database',
          initialize: vi.fn().mockResolvedValue(undefined),
          delegate: vi.fn().mockResolvedValue({
            success: true,
            data: { rows: [] },
            auditTrail: {
              timestamp: new Date('2025-01-01'),
              source: 'delegation:test',
              action: 'custom-query',
              success: true,
              reason: 'User requested data',
              metadata: { queryType: 'SELECT', rowCount: 42 },
            },
          }),
          validateAccess: vi.fn().mockResolvedValue(true),
          healthCheck: vi.fn().mockResolvedValue(true),
          destroy: vi.fn().mockResolvedValue(undefined),
        };

        const session = createMockSession();
        registry.register(module);
        await registry.delegate('test', session, 'custom-query', {});

        const delegationLog = auditSpy.mock.calls.find(
          call => call[0].action === 'custom-query'
        );
        expect(delegationLog).toBeDefined();
        expect(delegationLog![0]).toMatchObject({
          source: 'delegation:test',
          action: 'custom-query',
          success: true,
          reason: 'User requested data',
          metadata: { queryType: 'SELECT', rowCount: 42 },
        });
      });

      it('should add integrity fields without breaking existing metadata', async () => {
        const auditService = new AuditService({ enabled: true });
        const auditSpy = vi.spyOn(auditService, 'log');
        const registry = new DelegationRegistry(auditService);

        const module = createMockModule('test');
        const session = createMockSession();

        registry.register(module);
        await registry.delegate('test', session, 'query', {});

        const delegationLog = auditSpy.mock.calls.find(
          call => call[0].action === 'delegate'
        );
        expect(delegationLog).toBeDefined();
        expect(delegationLog![0]).toHaveProperty('moduleReportedSuccess');
        expect(delegationLog![0]).toHaveProperty('registryVerifiedSuccess');
        expect(delegationLog![0]).toHaveProperty('registryTimestamp');
        expect(delegationLog![0]).toHaveProperty('userId');
      });

      it('should work with modules that return minimal audit trails', async () => {
        const registry = new DelegationRegistry(new AuditService({ enabled: true }));

        const minimalModule: DelegationModule = {
          name: 'minimal',
          type: 'test',
          initialize: vi.fn().mockResolvedValue(undefined),
          delegate: vi.fn().mockResolvedValue({
            success: true,
            auditTrail: {
              timestamp: new Date(),
              source: 'delegation:minimal',
              action: 'test',
              success: true,
              // No optional fields
            },
          }),
          validateAccess: vi.fn().mockResolvedValue(true),
          healthCheck: vi.fn().mockResolvedValue(true),
          destroy: vi.fn().mockResolvedValue(undefined),
        };

        const session = createMockSession();
        registry.register(minimalModule);

        // Should not throw
        const result = await registry.delegate('minimal', session, 'test', {});
        expect(result.success).toBe(true);
        expect(result.auditTrail).toHaveProperty('registryVerifiedSuccess');
      });

      it('should work with modules that return rich audit trails', async () => {
        const registry = new DelegationRegistry(new AuditService({ enabled: true }));

        const richModule: DelegationModule = {
          name: 'rich',
          type: 'test',
          initialize: vi.fn().mockResolvedValue(undefined),
          delegate: vi.fn().mockResolvedValue({
            success: true,
            data: { complex: 'object' },
            auditTrail: {
              timestamp: new Date(),
              source: 'delegation:rich',
              userId: 'module-user',
              action: 'complex-operation',
              success: true,
              reason: 'Detailed reason',
              error: undefined,
              metadata: {
                nested: { deep: { data: 'value' } },
                array: [1, 2, 3],
                custom: 'field',
              },
            },
          }),
          validateAccess: vi.fn().mockResolvedValue(true),
          healthCheck: vi.fn().mockResolvedValue(true),
          destroy: vi.fn().mockResolvedValue(undefined),
        };

        const session = createMockSession();
        registry.register(richModule);

        const result = await registry.delegate('rich', session, 'complex', {});
        expect(result.success).toBe(true);
        expect(result.auditTrail.metadata).toMatchObject({
          nested: { deep: { data: 'value' } },
          array: [1, 2, 3],
          custom: 'field',
        });
        expect(result.auditTrail).toHaveProperty('registryVerifiedSuccess');
      });
    });
  });
});
