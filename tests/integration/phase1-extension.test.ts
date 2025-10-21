/**
 * Phase 1 Integration Test: Extension API
 *
 * Tests the new delegation tool factory and tool registration APIs
 * introduced in Framework Enhancement Phase 1.
 *
 * @see Docs/Framework-update.md Phase 1
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { z } from 'zod';
import { MCPOAuthServer } from '../../src/mcp/server.js';
import { createDelegationTool, createDelegationTools } from '../../src/mcp/tools/delegation-tool-factory.js';
import type { DelegationModule, DelegationResult } from '../../src/delegation/base.js';
import type { UserSession } from '../../src/core/types.js';
import type { CoreContext } from '../../src/core/index.js';

// ============================================================================
// Test Delegation Module
// ============================================================================

/**
 * Mock delegation module for testing
 *
 * Simulates a custom legacy system delegation module.
 */
class TestDelegationModule implements DelegationModule {
  readonly name = 'testmodule';
  readonly type = 'test-legacy';
  private initialized = false;
  private calls: Array<{ action: string; params: any }> = [];

  async initialize(config: any): Promise<void> {
    this.initialized = true;
  }

  async delegate<T = any>(
    session: UserSession,
    action: string,
    params: any
  ): Promise<DelegationResult<T>> {
    // Record call for testing
    this.calls.push({ action, params });

    // Simulate different actions
    switch (action) {
      case 'echo':
        return {
          success: true,
          data: {
            echoed: params.message,
            user: session.userId,
            legacyUser: session.legacyUsername,
          } as T,
          auditTrail: {
            timestamp: new Date(),
            userId: session.userId,
            action: `testmodule:${action}`,
            resource: params.resource || 'test-resource',
            success: true,
            source: 'delegation:testmodule',
          },
        };

      case 'calculate':
        return {
          success: true,
          data: {
            result: (params.a || 0) + (params.b || 0),
          } as T,
          auditTrail: {
            timestamp: new Date(),
            userId: session.userId,
            action: `testmodule:${action}`,
            resource: params.resource || 'test-resource',
            success: true,
            source: 'delegation:testmodule',
          },
        };

      case 'fail':
        return {
          success: false,
          error: 'Simulated failure',
          auditTrail: {
            timestamp: new Date(),
            userId: session.userId,
            action: `testmodule:${action}`,
            resource: params.resource || 'test-resource',
            success: false,
            source: 'delegation:testmodule',
            errorMessage: 'Simulated failure',
          },
        };

      default:
        return {
          success: false,
          error: `Unknown action: ${action}`,
          auditTrail: {
            timestamp: new Date(),
            userId: session.userId,
            action: `testmodule:${action}`,
            resource: params.resource || 'test-resource',
            success: false,
            source: 'delegation:testmodule',
            errorMessage: `Unknown action: ${action}`,
          },
        };
    }
  }

  async validateAccess(session: UserSession): Promise<boolean> {
    return session.role === 'user' || session.role === 'admin';
  }

  async healthCheck(): Promise<boolean> {
    return this.initialized;
  }

  // Test helper methods
  getCalls() {
    return [...this.calls];
  }

  clearCalls() {
    this.calls = [];
  }

  async destroy(): Promise<void> {
    this.initialized = false;
    this.calls = [];
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('Phase 1: Extension API Integration Tests', () => {
  let server: MCPOAuthServer;
  let testModule: TestDelegationModule;
  let coreContext: CoreContext;

  beforeAll(async () => {
    // Create server with test configuration
    server = new MCPOAuthServer('./test-harness/config/v2-keycloak-oauth-only.json');

    // Start server to initialize CoreContext
    await server.start({
      transportType: 'stdio', // Use stdio to avoid port conflicts
    });

    // Get CoreContext for tool creation
    coreContext = server.getCoreContext();

    // Create and register test delegation module
    testModule = new TestDelegationModule();
    await testModule.initialize({});
    await server.registerDelegationModule('testmodule', testModule);
  });

  afterAll(async () => {
    await server.stop();
  });

  describe('createDelegationTool()', () => {
    it('should create a tool with minimal boilerplate', () => {
      const tool = createDelegationTool(
        'testmodule',
        {
          name: 'test-echo',
          description: 'Echo a message',
          requiredRoles: ['user'],
          action: 'echo',
          parameters: z.object({
            message: z.string(),
          }),
        },
        coreContext
      );

      expect(tool.name).toBe('test-echo');
      expect(tool.description).toBe('Echo a message');
      expect(tool.schema).toBeDefined();
      expect(tool.handler).toBeInstanceOf(Function);
      expect(tool.canAccess).toBeInstanceOf(Function);
    });

    it('should handle tool with role requirements', () => {
      const tool = createDelegationTool(
        'testmodule',
        {
          name: 'test-admin-only',
          description: 'Admin only tool',
          requiredRoles: ['admin'],
          action: 'echo',
          parameters: z.object({
            message: z.string(),
          }),
        },
        coreContext
      );

      expect(tool.name).toBe('test-admin-only');
    });

    it('should handle tool with parameter transformation', () => {
      const tool = createDelegationTool(
        'testmodule',
        {
          name: 'test-transform',
          description: 'Tool with parameter transformation',
          requiredRoles: ['user'],
          action: 'echo',
          parameters: z.object({
            message: z.string(),
          }),
          transformParams: (params, session) => ({
            ...params,
            enriched: true,
            userId: session.userId,
          }),
        },
        coreContext
      );

      expect(tool.name).toBe('test-transform');
    });

    it('should handle tool with result transformation', () => {
      const tool = createDelegationTool(
        'testmodule',
        {
          name: 'test-result-transform',
          description: 'Tool with result transformation',
          requiredRoles: ['user'],
          action: 'echo',
          parameters: z.object({
            message: z.string(),
          }),
          transformResult: (result) => ({
            ...result,
            transformed: true,
          }),
        },
        coreContext
      );

      expect(tool.name).toBe('test-result-transform');
    });
  });

  describe('createDelegationTools()', () => {
    it('should create multiple tools at once', () => {
      const tools = createDelegationTools(
        'testmodule',
        [
          {
            name: 'test-tool-1',
            description: 'First tool',
            requiredRoles: ['user'],
            action: 'echo',
            parameters: z.object({ message: z.string() }),
          },
          {
            name: 'test-tool-2',
            description: 'Second tool',
            requiredRoles: ['user'],
            action: 'calculate',
            parameters: z.object({ a: z.number(), b: z.number() }),
          },
        ],
        coreContext
      );

      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe('test-tool-1');
      expect(tools[1].name).toBe('test-tool-2');
    });
  });

  describe('MCPOAuthServer.registerTool()', () => {
    it('should register a single custom tool', () => {
      const tool = createDelegationTool(
        'testmodule',
        {
          name: 'test-single-register',
          description: 'Test single registration',
          requiredRoles: ['user'],
          action: 'echo',
          parameters: z.object({ message: z.string() }),
        },
        coreContext
      );

      // Should not throw
      expect(() => server.registerTool(tool)).not.toThrow();
    });

    it('should throw if server not initialized', () => {
      const uninitializedServer = new MCPOAuthServer(
        './test-harness/config/v2-keycloak-oauth-only.json'
      );

      const tool = createDelegationTool(
        'testmodule',
        {
          name: 'test-uninit',
          description: 'Test',
          requiredRoles: ['user'],
          action: 'echo',
          parameters: z.object({ message: z.string() }),
        },
        coreContext
      );

      expect(() => uninitializedServer.registerTool(tool)).toThrow(
        /Cannot register tool before server/
      );
    });
  });

  describe('MCPOAuthServer.registerTools()', () => {
    it('should register multiple tools at once', () => {
      const tools = createDelegationTools(
        'testmodule',
        [
          {
            name: 'test-batch-1',
            description: 'Batch tool 1',
            requiredRoles: ['user'],
            action: 'echo',
            parameters: z.object({ message: z.string() }),
          },
          {
            name: 'test-batch-2',
            description: 'Batch tool 2',
            requiredRoles: ['user'],
            action: 'calculate',
            parameters: z.object({ a: z.number(), b: z.number() }),
          },
        ],
        coreContext
      );

      // Should not throw
      expect(() => server.registerTools(tools)).not.toThrow();
    });
  });

  describe('Tool Handler Execution (OAuth Boilerplate)', () => {
    it('should handle OAuth session extraction automatically', async () => {
      const tool = createDelegationTool(
        'testmodule',
        {
          name: 'test-session-extract',
          description: 'Test session extraction',
          requiredRoles: ['user'],
          action: 'echo',
          parameters: z.object({ message: z.string() }),
        },
        coreContext
      );

      // Mock session
      const mockSession: UserSession = {
        _version: 1,
        sessionId: 'test-session',
        userId: 'test@example.com',
        username: 'test@example.com',
        legacyUsername: 'TEST_USER',
        role: 'user',
        customRoles: [],
        scopes: ['openid'],
        customClaims: {},
        rejected: false,
        claims: {
          iss: 'https://auth.example.com',
          sub: 'test@example.com',
          aud: 'mcp-server',
          exp: Date.now() + 3600000,
          iat: Date.now(),
          nbf: Date.now(),
        },
      };

      const result = await tool.handler({ message: 'Hello' }, { session: mockSession });

      expect(result.status).toBe('success');
      if ('data' in result) {
        expect(result.data).toHaveProperty('echoed', 'Hello');
        expect(result.data).toHaveProperty('user', 'test@example.com');
      }
    });

    it('should enforce role requirements automatically', async () => {
      const tool = createDelegationTool(
        'testmodule',
        {
          name: 'test-role-check',
          description: 'Test role enforcement',
          requiredRoles: ['admin'],
          action: 'echo',
          parameters: z.object({ message: z.string() }),
        },
        coreContext
      );

      // Session without required role
      const mockSession: UserSession = {
        _version: 1,
        sessionId: 'test-session',
        userId: 'test@example.com',
        username: 'test@example.com',
        legacyUsername: 'TEST_USER',
        role: 'user', // Not admin
        customRoles: [],
        scopes: ['openid'],
        customClaims: {},
        rejected: false,
        claims: {
          iss: 'https://auth.example.com',
          sub: 'test@example.com',
          aud: 'mcp-server',
          exp: Date.now() + 3600000,
          iat: Date.now(),
          nbf: Date.now(),
        },
      };

      const result = await tool.handler({ message: 'Hello' }, { session: mockSession });

      expect(result.status).toBe('failure');
      if ('code' in result) {
        expect(result.code).toBe('INSUFFICIENT_PERMISSIONS');
      }
    });

    it('should handle delegation failures gracefully', async () => {
      const tool = createDelegationTool(
        'testmodule',
        {
          name: 'test-delegation-fail',
          description: 'Test delegation failure handling',
          requiredRoles: ['user'],
          action: 'fail', // Module will return success: false
          parameters: z.object({ message: z.string() }),
        },
        coreContext
      );

      const mockSession: UserSession = {
        _version: 1,
        sessionId: 'test-session',
        userId: 'test@example.com',
        username: 'test@example.com',
        legacyUsername: 'TEST_USER',
        role: 'user',
        customRoles: [],
        scopes: ['openid'],
        customClaims: {},
        rejected: false,
        claims: {
          iss: 'https://auth.example.com',
          sub: 'test@example.com',
          aud: 'mcp-server',
          exp: Date.now() + 3600000,
          iat: Date.now(),
          nbf: Date.now(),
        },
      };

      const result = await tool.handler({ message: 'Hello' }, { session: mockSession });

      expect(result.status).toBe('failure');
      if ('code' in result) {
        expect(result.code).toBe('DELEGATION_FAILED');
      }
    });
  });

  describe('End-to-End: Custom Module Extension', () => {
    it('should support full custom delegation workflow', async () => {
      // Clear previous calls from testModule
      testModule.clearCalls();

      // 1. Create custom delegation tool
      const echoTool = createDelegationTool(
        'testmodule',
        {
          name: 'custom-echo',
          description: 'Custom echo tool',
          requiredRoles: ['user'],
          action: 'echo',
          parameters: z.object({ message: z.string() }),
        },
        coreContext
      );

      // 2. Register tool with server
      server.registerTool(echoTool);

      // 3. Simulate tool execution
      const mockSession: UserSession = {
        _version: 1,
        sessionId: 'test-session',
        userId: 'developer@example.com',
        username: 'developer@example.com',
        legacyUsername: 'DEV_USER',
        role: 'user',
        customRoles: ['developer'],
        scopes: ['openid', 'profile'],
        customClaims: {},
        rejected: false,
        claims: {
          iss: 'https://auth.example.com',
          sub: 'developer@example.com',
          aud: 'mcp-server',
          exp: Date.now() + 3600000,
          iat: Date.now(),
          nbf: Date.now(),
        },
      };

      const result = await echoTool.handler(
        { message: 'Hello from custom module!' },
        { session: mockSession }
      );

      // 4. Verify successful delegation
      expect(result.status).toBe('success');
      if ('data' in result) {
        expect(result.data).toHaveProperty('echoed', 'Hello from custom module!');
        expect(result.data).toHaveProperty('user', 'developer@example.com');
        expect(result.data).toHaveProperty('legacyUser', 'DEV_USER');
      }

      // 5. Verify delegation module was called
      const calls = testModule.getCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].action).toBe('echo');
      expect(calls[0].params.message).toBe('Hello from custom module!');
    });
  });
});
