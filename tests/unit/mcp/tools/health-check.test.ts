/**
 * Health Check Tool Tests
 *
 * Tests for the health-check tool implementation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createHealthCheckTool } from '../../../../src/mcp/tools/health-check.js';
import type { CoreContext } from '../../../../src/core/index.js';
import type { FastMCPContext, LLMResponse } from '../../../../src/mcp/types.js';
import type { DelegationModule } from '../../../../src/delegation/base.js';
import { DelegationRegistry } from '../../../../src/delegation/registry.js';
import { AuditService } from '../../../../src/core/audit-service.js';
import { UNASSIGNED_ROLE } from '../../../../src/core/types.js';

describe('health-check Tool', () => {
  let coreContext: CoreContext;
  let mockModule: DelegationModule;

  beforeEach(() => {
    // Create mock delegation module
    mockModule = {
      name: 'sql',
      type: 'database',
      initialize: async () => {},
      delegate: async () => ({
        success: true,
        data: {},
        auditTrail: {
          userId: 'test',
          username: 'test',
          action: 'test',
          resource: 'test',
          timestamp: new Date(),
          success: true,
          source: 'test',
        },
      }),
      validateAccess: async () => true,
      healthCheck: async () => true,
      destroy: async () => {},
    };

    // Create core context with delegation registry
    const delegationRegistry = new DelegationRegistry(new AuditService());
    delegationRegistry.register(mockModule);

    coreContext = {
      authService: {} as any,
      auditService: new AuditService(),
      delegationRegistry,
      configManager: {} as any,
    };
  });

  describe('Tool Metadata', () => {
    it('should have correct name', () => {
      const tool = createHealthCheckTool(coreContext);
      expect(tool.name).toBe('health-check');
    });

    it('should have description', () => {
      const tool = createHealthCheckTool(coreContext);
      expect(tool.description).toContain('Check delegation service health');
    });

    it('should have schema with service parameter', () => {
      const tool = createHealthCheckTool(coreContext);
      expect(tool.schema).toBeDefined();
    });
  });

  describe('canAccess (Visibility Filtering)', () => {
    it('should hide tool from unauthenticated users', () => {
      const tool = createHealthCheckTool(coreContext);
      const mcpContext: FastMCPContext = {
        session: null as any,
      };

      expect(tool.canAccess!(mcpContext)).toBe(false);
    });

    it('should hide tool from rejected sessions', () => {
      const tool = createHealthCheckTool(coreContext);
      const mcpContext: FastMCPContext = {
        session: {
          userId: 'user1',
          username: 'testuser',
          role: UNASSIGNED_ROLE,
          permissions: [],
          _version: 1,
          rejected: true,
          rejectionReason: 'No role assigned',
          claims: {},
        },
      };

      expect(tool.canAccess!(mcpContext)).toBe(false);
    });

    it('should show tool to admin users', () => {
      const tool = createHealthCheckTool(coreContext);
      const mcpContext: FastMCPContext = {
        session: {
          userId: 'admin1',
          username: 'admin',
          role: 'admin',
          permissions: ['*'],
          _version: 1,
          rejected: false,
          claims: {},
        },
      };

      expect(tool.canAccess!(mcpContext)).toBe(true);
    });

    it('should show tool to regular users', () => {
      const tool = createHealthCheckTool(coreContext);
      const mcpContext: FastMCPContext = {
        session: {
          userId: 'user1',
          username: 'user',
          role: 'user',
          permissions: ['sql:query'],
          _version: 1,
          rejected: false,
          claims: {},
        },
      };

      expect(tool.canAccess!(mcpContext)).toBe(true);
    });

    it('should hide tool from guest users', () => {
      const tool = createHealthCheckTool(coreContext);
      const mcpContext: FastMCPContext = {
        session: {
          userId: 'guest1',
          username: 'guest',
          role: 'guest',
          permissions: [],
          _version: 1,
          rejected: false,
          claims: {},
        },
      };

      expect(tool.canAccess!(mcpContext)).toBe(false);
    });
  });

  describe('Handler Execution', () => {
    const validSession = {
      userId: 'user1',
      username: 'testuser',
      role: 'user',
      permissions: ['sql:query'],
      _version: 1,
      rejected: false,
      claims: {},
    };

    it('should check all services when service=all', async () => {
      const tool = createHealthCheckTool(coreContext);
      const mcpContext: FastMCPContext = { session: validSession };

      const result = (await tool.handler({ service: 'all' }, mcpContext)) as LLMResponse;

      expect(result.status).toBe('success');
      expect(result.data).toHaveProperty('healthy', true);
      expect(result.data).toHaveProperty('modules');
      expect(result.data.modules).toHaveProperty('sql', true);
      expect(result.data).toHaveProperty('timestamp');
    });

    it('should check specific service', async () => {
      const tool = createHealthCheckTool(coreContext);
      const mcpContext: FastMCPContext = { session: validSession };

      const result = (await tool.handler({ service: 'sql' }, mcpContext)) as LLMResponse;

      expect(result.status).toBe('success');
      expect(result.data).toHaveProperty('healthy', true);
      expect(result.data).toHaveProperty('service', 'sql');
      expect(result.data).toHaveProperty('timestamp');
    });

    it('should return failure for non-existent service', async () => {
      const tool = createHealthCheckTool(coreContext);
      const mcpContext: FastMCPContext = { session: validSession };

      const result = (await tool.handler({ service: 'kerberos' }, mcpContext)) as LLMResponse;

      expect(result.status).toBe('failure');
      expect(result.code).toBe('MODULE_NOT_FOUND');
      expect(result.message).toContain('kerberos');
    });

    it('should return unhealthy when module healthCheck returns false', async () => {
      // Create unhealthy module
      const unhealthyModule = { ...mockModule, healthCheck: async () => false };

      // Create fresh core context with unhealthy module
      const freshDelegationRegistry = new DelegationRegistry(new AuditService());
      freshDelegationRegistry.register(unhealthyModule);

      const freshCoreContext = {
        ...coreContext,
        delegationRegistry: freshDelegationRegistry,
      };

      const tool = createHealthCheckTool(freshCoreContext);
      const mcpContext: FastMCPContext = { session: validSession };

      const result = (await tool.handler({ service: 'sql' }, mcpContext)) as LLMResponse;

      expect(result.status).toBe('success');
      expect(result.data).toHaveProperty('healthy', false);
    });

    it('should return overall unhealthy if any module is unhealthy', async () => {
      // Create fresh registry with both healthy and unhealthy modules
      const unhealthyModule = {
        ...mockModule,
        name: 'kerberos',
        healthCheck: async () => false,
      };

      const freshDelegationRegistry = new DelegationRegistry(new AuditService());
      freshDelegationRegistry.register(mockModule);
      freshDelegationRegistry.register(unhealthyModule);

      const freshCoreContext = {
        ...coreContext,
        delegationRegistry: freshDelegationRegistry,
      };

      const tool = createHealthCheckTool(freshCoreContext);
      const mcpContext: FastMCPContext = { session: validSession };

      const result = (await tool.handler({ service: 'all' }, mcpContext)) as LLMResponse;

      expect(result.status).toBe('success');
      expect(result.data).toHaveProperty('healthy', false);
      expect(result.data.modules.sql).toBe(true);
      expect(result.data.modules.kerberos).toBe(false);
    });

    it('should require authentication (hard check)', async () => {
      const tool = createHealthCheckTool(coreContext);
      const mcpContext: FastMCPContext = {
        session: {
          ...validSession,
          rejected: true,
          rejectionReason: 'Test rejection',
        },
      };

      const result = (await tool.handler({ service: 'all' }, mcpContext)) as LLMResponse;

      expect(result.status).toBe('failure');
      expect(result.code).toBe('UNAUTHENTICATED');
    });

    it('should use default service=all when not specified', async () => {
      const tool = createHealthCheckTool(coreContext);
      const mcpContext: FastMCPContext = { session: validSession };

      const result = (await tool.handler({}, mcpContext)) as LLMResponse;

      expect(result.status).toBe('success');
      expect(result.data).toHaveProperty('modules');
    });

    it('should handle errors gracefully', async () => {
      // Create module that throws
      const errorModule = {
        ...mockModule,
        healthCheck: async () => {
          throw new Error('Health check failed');
        },
      };

      const freshDelegationRegistry = new DelegationRegistry(new AuditService());
      freshDelegationRegistry.register(errorModule);

      const freshCoreContext = {
        ...coreContext,
        delegationRegistry: freshDelegationRegistry,
      };

      const tool = createHealthCheckTool(freshCoreContext);
      const mcpContext: FastMCPContext = { session: validSession };

      const result = (await tool.handler({ service: 'sql' }, mcpContext)) as LLMResponse;

      expect(result.status).toBe('failure');
      expect(result.code).toBe('SERVER_ERROR');
      expect(result.message).toContain('internal processing error');
    });

    it('should return LLMSuccessResponse on success (GAP #5)', async () => {
      const tool = createHealthCheckTool(coreContext);
      const mcpContext: FastMCPContext = { session: validSession };

      const result = (await tool.handler({ service: 'sql' }, mcpContext)) as LLMResponse;

      expect(result).toHaveProperty('status', 'success');
      expect(result).toHaveProperty('data');
      expect(result).not.toHaveProperty('code');
      expect(result).not.toHaveProperty('message');
    });

    it('should return LLMFailureResponse on error (GAP #4)', async () => {
      const tool = createHealthCheckTool(coreContext);
      const mcpContext: FastMCPContext = {
        session: {
          ...validSession,
          rejected: true,
        },
      };

      const result = (await tool.handler({ service: 'sql' }, mcpContext)) as LLMResponse;

      expect(result).toHaveProperty('status', 'failure');
      expect(result).toHaveProperty('code');
      expect(result).toHaveProperty('message');
      expect(result).not.toHaveProperty('data');
    });
  });
});
