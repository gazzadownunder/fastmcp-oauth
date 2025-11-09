/**
 * Testing Utilities for MCP OAuth Framework
 *
 * Provides factory functions and mocks for testing custom delegation modules.
 *
 * Usage:
 *   import { createMockUserSession, createMockCoreContext } from 'fastmcp-oauth-obo/testing';
 *
 *   const session = createMockUserSession({ role: 'admin' });
 *   const coreContext = createMockCoreContext();
 */

import type { UserSession, AuditEntry } from '../core/index.js';
import type { CoreContext } from '../core/types.js';
import type { DelegationModule, DelegationResult } from '../delegation/base.js';

/**
 * Mock UserSession Factory
 *
 * Creates a mock UserSession for testing.
 *
 * @example
 * const session = createMockUserSession({
 *   userId: 'test-user',
 *   role: 'admin',
 *   customRoles: ['sql-admin'],
 * });
 */
export function createMockUserSession(overrides: Partial<UserSession> = {}): UserSession {
  const defaultSession: UserSession = {
    _version: 1,
    sessionId: 'test-session-123',
    userId: 'test-user-123',
    username: 'testuser',
    role: 'user',
    customRoles: [],
    scopes: [],
    customClaims: {},
    claims: {
      iss: 'https://test-idp.example.com',
      sub: 'test-user-123',
      aud: ['test-audience'],
    },
    rejected: false,
  };

  return {
    ...defaultSession,
    ...overrides,
    claims: {
      ...defaultSession.claims,
      ...(overrides.claims || {}),
    },
    customClaims: {
      ...defaultSession.customClaims,
      ...(overrides.customClaims || {}),
    },
  };
}

/**
 * Mock JWT Token Generator
 *
 * Generates a mock JWT token string with custom claims.
 *
 * @example
 * const token = generateMockJWT({
 *   sub: 'user-123',
 *   roles: ['admin'],
 * });
 */
export function generateMockJWT(claims: Record<string, any> = {}): string {
  const now = Math.floor(Date.now() / 1000);

  const defaultClaims = {
    iss: 'https://test-idp.example.com',
    sub: 'test-user',
    aud: ['test-audience'],
    exp: now + 3600,
    iat: now,
    nbf: now,
    ...claims,
  };

  // Create a simple mock JWT (header.payload.signature)
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { ...defaultClaims };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mockSignature = 'mock-signature';

  return `${encodedHeader}.${encodedPayload}.${mockSignature}`;
}

/**
 * Mock CoreContext Factory
 *
 * Creates a mock CoreContext with stub implementations for testing.
 *
 * @example
 * const coreContext = createMockCoreContext({
 *   authService: customAuthService,
 * });
 */
export function createMockCoreContext(overrides: Partial<CoreContext> = {}): CoreContext {
  const mockAuditService = {
    log: async (entry: AuditEntry) => {
      console.log('[Mock Audit]', entry);
    },
    query: async () => [],
    clear: async () => {},
  };

  const mockAuthService = {
    authenticate: async (token: string) => {
      return createMockUserSession();
    },
    validateToken: async (token: string) => true,
  };

  const mockRoleMapper = {
    mapRole: (jwtRoles: string[]) => 'user',
  };

  const mockJWTValidator = {
    validateJWT: async (token: string) => {
      return {
        iss: 'https://test-idp.example.com',
        sub: 'test-user',
        aud: ['test-audience'],
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        rawPayload: token,
      };
    },
  };

  const mockDelegationRegistry = {
    modules: new Map<string, DelegationModule>(),
    register: (module: DelegationModule) => {
      mockDelegationRegistry.modules.set(module.name, module);
    },
    get: (name: string) => mockDelegationRegistry.modules.get(name),
    has: (name: string) => mockDelegationRegistry.modules.has(name),
    list: () => Array.from(mockDelegationRegistry.modules.keys()),
    unregister: (name: string) => mockDelegationRegistry.modules.delete(name),
  };

  const mockTokenExchangeService = {
    performExchange: async (params: any) => {
      // Return a mock exchanged token
      return generateMockJWT({
        aud: [params.audience],
        sub: 'exchanged-user',
      });
    },
    getCacheMetrics: () => ({
      cacheHits: 0,
      cacheMisses: 0,
      decryptionFailures: 0,
      requestorMismatch: 0,
      activeSessions: 0,
      totalEntries: 0,
      memoryUsageEstimate: 0,
    }),
  };

  return {
    auditService: mockAuditService,
    authService: mockAuthService as any,
    delegationRegistry: mockDelegationRegistry as any,
    configManager: {
      getAuthConfig: () => ({
        trustedIDPs: [
          {
            issuer: 'https://test-idp.example.com',
            jwksUri: 'https://test-idp.example.com/.well-known/jwks.json',
            audience: 'test-audience',
            algorithms: ['RS256'],
          },
        ],
      }),
    } as any,
    ...overrides,
  };
}

/**
 * Mock Delegation Module
 *
 * A simple mock implementation of DelegationModule for testing.
 *
 * @example
 * const mockModule = new MockDelegationModule('test-module', 'api');
 * mockModule.setMockResponse({ success: true, data: { result: 'ok' } });
 */
export class MockDelegationModule implements DelegationModule {
  readonly name: string;
  readonly type: string;

  private initialized = false;
  private mockResponse: DelegationResult<any> | null = null;
  private delegateCallLog: any[] = [];

  constructor(name: string, type: string = 'custom') {
    this.name = name;
    this.type = type;
  }

  async initialize(config: any): Promise<void> {
    this.initialized = true;
  }

  async delegate<T>(
    session: UserSession,
    action: string,
    params: any,
    context?: { sessionId?: string; coreContext?: CoreContext }
  ): Promise<DelegationResult<T>> {
    // Log the call for assertions
    this.delegateCallLog.push({ session, action, params, context });

    // Return mock response if set
    if (this.mockResponse) {
      return this.mockResponse as DelegationResult<T>;
    }

    // Default success response
    const auditEntry: AuditEntry = {
      timestamp: new Date(),
      source: `delegation:${this.name}`,
      userId: session.userId,
      action: `${this.name}:${action}`,
      success: true,
    };

    return {
      success: true,
      data: { mockData: true } as T,
      auditTrail: auditEntry,
    };
  }

  async healthCheck(): Promise<boolean> {
    return this.initialized;
  }

  async destroy(): Promise<void> {
    this.initialized = false;
  }

  async validateAccess(session: UserSession): Promise<boolean> {
    // Mock implementation - always allow access in tests
    return true;
  }

  // Testing utilities
  setMockResponse(response: DelegationResult<any>) {
    this.mockResponse = response;
  }

  getCallLog() {
    return this.delegateCallLog;
  }

  getLastCall() {
    return this.delegateCallLog[this.delegateCallLog.length - 1];
  }

  clearCallLog() {
    this.delegateCallLog = [];
  }

  wasCalledWith(action: string, params?: any): boolean {
    return this.delegateCallLog.some((call) => {
      const actionMatches = call.action === action;
      if (!params) return actionMatches;
      return actionMatches && JSON.stringify(call.params) === JSON.stringify(params);
    });
  }
}

/**
 * Create a spy function for tracking calls
 *
 * @example
 * const spy = createSpy();
 * spy('arg1', 'arg2');
 * expect(spy.calls.length).toBe(1);
 * expect(spy.calls[0]).toEqual(['arg1', 'arg2']);
 */
export function createSpy<T extends (...args: any[]) => any>(
  implementation?: T
): T & { calls: Parameters<T>[]; reset: () => void } {
  const calls: Parameters<T>[] = [];

  const spy = ((...args: Parameters<T>) => {
    calls.push(args);
    if (implementation) {
      return implementation(...args);
    }
  }) as T & { calls: Parameters<T>[]; reset: () => void };

  spy.calls = calls;
  spy.reset = () => {
    calls.length = 0;
  };

  return spy;
}

/**
 * Wait for a condition to be true (useful for async testing)
 *
 * @example
 * await waitFor(() => mockModule.wasCalledWith('test-action'), 1000);
 */
export async function waitFor(
  condition: () => boolean,
  timeoutMs: number = 5000,
  checkIntervalMs: number = 100
): Promise<void> {
  const startTime = Date.now();

  while (!condition()) {
    if (Date.now() - startTime > timeoutMs) {
      throw new Error(`Timeout waiting for condition after ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, checkIntervalMs));
  }
}

/**
 * Create a mock audit entry for testing
 *
 * @example
 * const audit = createMockAuditEntry({ action: 'test-action', success: true });
 */
export function createMockAuditEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    timestamp: new Date(),
    source: 'test',
    userId: 'test-user',
    action: 'test-action',
    success: true,
    ...overrides,
  };
}

/**
 * Assert that a delegation result is successful
 *
 * @example
 * const result = await module.delegate(session, 'action', {});
 * assertDelegationSuccess(result);
 */
export function assertDelegationSuccess<T>(
  result: DelegationResult<T>
): asserts result is DelegationResult<T> & { success: true; data: T } {
  if (!result.success) {
    throw new Error(`Expected delegation to succeed, but got error: ${result.error}`);
  }
  if (result.data === undefined) {
    throw new Error('Expected delegation result to contain data');
  }
}

/**
 * Assert that a delegation result is a failure
 *
 * @example
 * const result = await module.delegate(session, 'invalid-action', {});
 * assertDelegationFailure(result);
 */
export function assertDelegationFailure<T>(
  result: DelegationResult<T>
): asserts result is DelegationResult<T> & { success: false; error: string } {
  if (result.success) {
    throw new Error('Expected delegation to fail, but it succeeded');
  }
  if (!result.error) {
    throw new Error('Expected delegation failure to contain error message');
  }
}

// Re-export types for convenience
export type { UserSession, AuditEntry, CoreContext } from '../core/index.js';

export type { DelegationModule, DelegationResult } from '../delegation/base.js';
