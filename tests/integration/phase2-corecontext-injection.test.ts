/**
 * Phase 2 Integration Test: CoreContext Injection
 *
 * Tests that custom delegation modules can access framework services
 * via CoreContext injection (Phase 2 enhancement).
 *
 * Test Coverage:
 * - DelegationRegistry passes CoreContext to modules
 * - Custom modules receive context parameter
 * - Modules can access TokenExchangeService
 * - sessionId is passed for token caching
 * - Backward compatibility (modules work without context)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DelegationModule, DelegationResult } from '../../src/delegation/base.js';
import type { UserSession, AuditEntry, CoreContext } from '../../src/core/index.js';
import { DelegationRegistry } from '../../src/delegation/registry.js';
import { AuditService } from '../../src/core/index.js';

// ============================================================================
// Mock Delegation Module (Phase 2 Compatible)
// ============================================================================

class MockPhase2Module implements DelegationModule {
  readonly name = 'phase2-test-module';
  readonly type = 'test';

  // Track what was received in delegate() call
  public lastContextReceived: any = null;
  public lastSessionIdReceived: string | undefined = undefined;

  async initialize(config: any): Promise<void> {
    // No-op for tests
  }

  async delegate<T>(
    session: UserSession,
    action: string,
    params: any,
    context?: {
      sessionId?: string;
      coreContext?: any;
    }
  ): Promise<DelegationResult<T>> {
    // Capture what we received
    this.lastContextReceived = context?.coreContext;
    this.lastSessionIdReceived = context?.sessionId;

    const auditEntry: AuditEntry = {
      timestamp: new Date(),
      source: 'delegation:phase2-test-module',
      userId: session.userId,
      action: `phase2-test:${action}`,
      success: true,
      metadata: {
        hasContext: !!context,
        hasCoreContext: !!context?.coreContext,
        hasSessionId: !!context?.sessionId,
        hasTokenExchangeService: !!context?.coreContext?.tokenExchangeService,
      },
    };

    return {
      success: true,
      data: {
        receivedContext: !!context,
        receivedCoreContext: !!context?.coreContext,
        receivedSessionId: context?.sessionId,
        // Test that we can access TokenExchangeService
        canAccessTokenExchange: !!context?.coreContext?.tokenExchangeService,
      } as T,
      auditTrail: auditEntry,
    };
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async destroy(): Promise<void> {
    // No-op
  }
}

// ============================================================================
// Legacy Module (No Context Parameter)
// ============================================================================

class LegacyModuleWithoutContext implements DelegationModule {
  readonly name = 'legacy-module';
  readonly type = 'test';

  async initialize(config: any): Promise<void> {
    // No-op
  }

  // OLD signature - no context parameter
  async delegate<T>(
    session: UserSession,
    action: string,
    params: any
  ): Promise<DelegationResult<T>> {
    const auditEntry: AuditEntry = {
      timestamp: new Date(),
      source: 'delegation:legacy-module',
      userId: session.userId,
      action: `legacy:${action}`,
      success: true,
    };

    return {
      success: true,
      data: { legacy: true } as T,
      auditTrail: auditEntry,
    };
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async destroy(): Promise<void> {
    // No-op
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function createMockSession(): UserSession {
  return {
    userId: 'test-user-123',
    username: 'test.user',
    role: 'user',
    permissions: ['test:read', 'test:write'],
    rejected: false,
    _version: 1,
    claims: {
      access_token: 'mock.jwt.token',
    },
  };
}

function createMockCoreContext(): CoreContext {
  const auditService = new AuditService({ enabled: true });
  const delegationRegistry = new DelegationRegistry(auditService);

  const mockCoreContext: CoreContext = {
    auditService,
    delegationRegistry,
    configManager: {} as any,
    authService: {} as any,
  };

  // Inject CoreContext into registry (Phase 2 enhancement)
  delegationRegistry.setCoreContext(mockCoreContext);

  return mockCoreContext;
}

// ============================================================================
// Integration Tests
// ============================================================================

describe('Phase 2: CoreContext Injection Integration Tests', () => {
  describe('DelegationRegistry CoreContext Injection', () => {
    it('should pass CoreContext to delegation modules', async () => {
      const coreContext = createMockCoreContext();
      const module = new MockPhase2Module();
      const session = createMockSession();

      coreContext.delegationRegistry.register(module);

      const result = await coreContext.delegationRegistry.delegate(
        'phase2-test-module',
        session,
        'test-action',
        { test: 'data' }
      );

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        receivedContext: true,
        receivedCoreContext: true,
      });

      // Verify module actually received CoreContext
      expect(module.lastContextReceived).toBeDefined();
      expect(module.lastContextReceived).toBe(coreContext);
    });

    it('should pass sessionId to delegation modules', async () => {
      const coreContext = createMockCoreContext();
      const module = new MockPhase2Module();
      const session = createMockSession();
      const testSessionId = 'test-session-123';

      coreContext.delegationRegistry.register(module);

      const result = await coreContext.delegationRegistry.delegate(
        'phase2-test-module',
        session,
        'test-action',
        { test: 'data' },
        testSessionId // Pass sessionId
      );

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        receivedSessionId: testSessionId,
      });

      // Verify module received sessionId
      expect(module.lastSessionIdReceived).toBe(testSessionId);
    });

    it('should work without sessionId (optional parameter)', async () => {
      const coreContext = createMockCoreContext();
      const module = new MockPhase2Module();
      const session = createMockSession();

      coreContext.delegationRegistry.register(module);

      const result = await coreContext.delegationRegistry.delegate(
        'phase2-test-module',
        session,
        'test-action',
        { test: 'data' }
        // No sessionId provided
      );

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        receivedContext: true,
        receivedCoreContext: true,
        receivedSessionId: undefined,
      });
    });
  });

  describe('TokenExchangeService Access', () => {
    it('should allow modules to access TokenExchangeService from CoreContext', async () => {
      const coreContext = createMockCoreContext();

      // Add mock TokenExchangeService to CoreContext
      (coreContext as any).tokenExchangeService = {
        performExchange: async (params: any) => 'mock.exchanged.token',
        getCacheMetrics: () => ({ cacheHits: 0, cacheMisses: 0 }),
      };

      const module = new MockPhase2Module();
      const session = createMockSession();

      coreContext.delegationRegistry.register(module);

      const result = await coreContext.delegationRegistry.delegate(
        'phase2-test-module',
        session,
        'test-action',
        { test: 'data' }
      );

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        canAccessTokenExchange: true,
      });

      // Verify module can access TokenExchangeService
      expect(module.lastContextReceived.tokenExchangeService).toBeDefined();
      expect(typeof module.lastContextReceived.tokenExchangeService.performExchange).toBe('function');
    });

    it('should work if TokenExchangeService is not configured', async () => {
      const coreContext = createMockCoreContext();
      // No TokenExchangeService added

      const module = new MockPhase2Module();
      const session = createMockSession();

      coreContext.delegationRegistry.register(module);

      const result = await coreContext.delegationRegistry.delegate(
        'phase2-test-module',
        session,
        'test-action',
        { test: 'data' }
      );

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        canAccessTokenExchange: false,
      });
    });
  });

  describe('Backward Compatibility', () => {
    it('should work with legacy modules that do not accept context parameter', async () => {
      const coreContext = createMockCoreContext();
      const legacyModule = new LegacyModuleWithoutContext();
      const session = createMockSession();

      coreContext.delegationRegistry.register(legacyModule);

      // Should not throw even though module doesn't accept context
      const result = await coreContext.delegationRegistry.delegate(
        'legacy-module',
        session,
        'test-action',
        { test: 'data' }
      );

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        legacy: true,
      });
    });

    it('should work when CoreContext is not set on registry', async () => {
      const auditService = new AuditService({ enabled: true });
      const registry = new DelegationRegistry(auditService);
      // Note: NOT calling setCoreContext()

      const module = new MockPhase2Module();
      const session = createMockSession();

      registry.register(module);

      const result = await registry.delegate(
        'phase2-test-module',
        session,
        'test-action',
        { test: 'data' }
      );

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        receivedContext: true,
        receivedCoreContext: false, // CoreContext not set
      });

      // Verify module received context but no coreContext
      expect(module.lastContextReceived).toBeUndefined();
    });
  });

  describe('End-to-End: Custom Module Using TokenExchangeService', () => {
    it('should demonstrate full Phase 2 workflow', async () => {
      // Step 1: Create CoreContext with TokenExchangeService
      const coreContext = createMockCoreContext();

      let exchangeCalled = false;
      let exchangeParams: any = null;

      (coreContext as any).tokenExchangeService = {
        performExchange: async (params: any) => {
          exchangeCalled = true;
          exchangeParams = params;
          return 'api-specific.jwt.token';
        },
        getCacheMetrics: () => ({ cacheHits: 0, cacheMisses: 0 }),
      };

      // Step 2: Create custom module that uses TokenExchangeService
      class CustomAPIModule implements DelegationModule {
        readonly name = 'custom-api';
        readonly type = 'api';

        async initialize(config: any) {}

        async delegate<T>(
          session: UserSession,
          action: string,
          params: any,
          context?: { sessionId?: string; coreContext?: any }
        ): Promise<DelegationResult<T>> {
          // Access TokenExchangeService via CoreContext
          const tokenExchangeService = context?.coreContext?.tokenExchangeService;

          if (!tokenExchangeService) {
            throw new Error('TokenExchangeService not available');
          }

          // Perform token exchange
          const apiToken = await tokenExchangeService.performExchange({
            requestorJWT: session.claims?.access_token,
            audience: 'urn:api:myservice',
            sessionId: context?.sessionId,
          });

          const auditEntry: AuditEntry = {
            timestamp: new Date(),
            source: 'delegation:custom-api',
            userId: session.userId,
            action: `api:${action}`,
            success: true,
            metadata: { usedTokenExchange: true },
          };

          return {
            success: true,
            data: {
              apiToken,
              action,
              sessionId: context?.sessionId,
            } as T,
            auditTrail: auditEntry,
          };
        }

        async healthCheck() { return true; }
        async destroy() {}
      }

      // Step 3: Register and use the module
      const apiModule = new CustomAPIModule();
      const session = createMockSession();
      const sessionId = 'session-456';

      coreContext.delegationRegistry.register(apiModule);

      const result = await coreContext.delegationRegistry.delegate(
        'custom-api',
        session,
        'getData',
        {},
        sessionId
      );

      // Step 4: Verify results
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        apiToken: 'api-specific.jwt.token',
        action: 'getData',
        sessionId: 'session-456',
      });

      // Verify TokenExchangeService was called
      expect(exchangeCalled).toBe(true);
      expect(exchangeParams).toMatchObject({
        requestorJWT: 'mock.jwt.token',
        audience: 'urn:api:myservice',
        sessionId: 'session-456',
      });
    });
  });
});
