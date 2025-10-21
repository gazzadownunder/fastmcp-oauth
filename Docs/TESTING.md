# Testing Guide for MCP OAuth Framework

This guide explains how to test custom delegation modules using the framework's testing utilities.

## Table of Contents

- [Testing Utilities Overview](#testing-utilities-overview)
- [Writing Unit Tests](#writing-unit-tests)
- [Testing Custom Delegation Modules](#testing-custom-delegation-modules)
- [Mock Factories](#mock-factories)
- [Integration Testing](#integration-testing)
- [Best Practices](#best-practices)

---

## Testing Utilities Overview

The framework provides comprehensive testing utilities in `src/testing/index.ts`:

```typescript
import {
  createMockUserSession,
  createMockCoreContext,
  generateMockJWT,
  MockDelegationModule,
  createSpy,
  waitFor,
  assertDelegationSuccess,
  assertDelegationFailure,
} from 'fastmcp-oauth-obo/testing';
```

### Available Utilities

| Utility | Purpose |
|---------|---------|
| `createMockUserSession()` | Create mock user sessions with custom claims |
| `createMockCoreContext()` | Create mock CoreContext for dependency injection |
| `generateMockJWT()` | Generate mock JWT tokens |
| `MockDelegationModule` | Full mock implementation of DelegationModule |
| `createSpy()` | Track function calls for assertions |
| `waitFor()` | Wait for async conditions |
| `assertDelegationSuccess()` | Assert successful delegation |
| `assertDelegationFailure()` | Assert failed delegation |

---

## Writing Unit Tests

### Basic Test Structure

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { MyDelegationModule } from '../src/delegation/mymodule/index.js';
import { createMockUserSession, createMockCoreContext } from '../src/testing/index.js';

describe('MyDelegationModule', () => {
  let module: MyDelegationModule;
  let mockSession: UserSession;
  let mockCoreContext: CoreContext;

  beforeEach(async () => {
    module = new MyDelegationModule();
    mockSession = createMockUserSession({ role: 'user' });
    mockCoreContext = createMockCoreContext();

    await module.initialize({
      // Your module config
    });
  });

  it('should successfully delegate action', async () => {
    const result = await module.delegate(
      mockSession,
      'test-action',
      { param1: 'value1' },
      { sessionId: 'test-session', coreContext: mockCoreContext }
    );

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });
});
```

---

## Testing Custom Delegation Modules

### Example: Testing a REST API Delegation Module

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RestAPIDelegationModule } from '../src/delegation/rest-api/index.js';
import { createMockUserSession, createMockCoreContext, assertDelegationSuccess } from '../src/testing/index.js';

describe('RestAPIDelegationModule', () => {
  let module: RestAPIDelegationModule;
  let mockSession: UserSession;
  let mockCoreContext: CoreContext;

  beforeEach(async () => {
    module = new RestAPIDelegationModule();

    mockSession = createMockUserSession({
      userId: 'test-user',
      role: 'user',
      permissions: ['api:read', 'api:write'],
      customClaims: {
        legacy_name: 'TEST_USER',
      },
    });

    mockCoreContext = createMockCoreContext();

    await module.initialize({
      baseUrl: 'https://test-api.example.com',
      timeout: 5000,
    });
  });

  describe('delegation', () => {
    it('should successfully call API endpoint', async () => {
      // Mock fetch for this test
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: 'test-response' }),
      });

      const result = await module.delegate(
        mockSession,
        'get',
        { endpoint: '/users/123' },
        { sessionId: 'test-session', coreContext: mockCoreContext }
      );

      // Use assertion helper
      assertDelegationSuccess(result);

      expect(result.data).toEqual({ data: 'test-response' });
      expect(global.fetch).toHaveBeenCalledWith(
        'https://test-api.example.com/users/123',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': expect.stringContaining('Bearer'),
          }),
        })
      );
    });

    it('should handle API errors gracefully', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const result = await module.delegate(
        mockSession,
        'get',
        { endpoint: '/users/999' }
      );

      assertDelegationFailure(result);
      expect(result.error).toContain('404');
    });

    it('should include audit trail', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      const result = await module.delegate(
        mockSession,
        'get',
        { endpoint: '/test' }
      );

      expect(result.auditTrail).toBeDefined();
      expect(result.auditTrail.userId).toBe('test-user');
      expect(result.auditTrail.action).toContain('rest-api:get');
      expect(result.auditTrail.success).toBe(true);
    });
  });

  describe('health check', () => {
    it('should return true when initialized', async () => {
      const healthy = await module.healthCheck();
      expect(healthy).toBe(true);
    });

    it('should return false when not initialized', async () => {
      const uninitializedModule = new RestAPIDelegationModule();
      const healthy = await uninitializedModule.healthCheck();
      expect(healthy).toBe(false);
    });
  });
});
```

---

## Mock Factories

### Creating Mock User Sessions

```typescript
import { createMockUserSession } from 'fastmcp-oauth-obo/testing';

// Basic user
const basicUser = createMockUserSession();

// Admin user with permissions
const adminUser = createMockUserSession({
  userId: 'admin-123',
  role: 'admin',
  permissions: ['sql:read', 'sql:write', 'admin:*'],
  customClaims: {
    department: 'IT',
    legacy_name: 'ADMIN_USER',
  },
});

// Expired session
const expiredSession = createMockUserSession({
  claims: {
    exp: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
  },
});

// Rejected session
const rejectedSession = createMockUserSession({
  authenticated: false,
  rejected: true,
});
```

### Creating Mock CoreContext

```typescript
import { createMockCoreContext } from 'fastmcp-oauth-obo/testing';

// Basic mock context
const coreContext = createMockCoreContext();

// Context with custom token exchange
const contextWithTokenExchange = createMockCoreContext({
  tokenExchangeService: {
    performExchange: async (params) => {
      // Custom token exchange logic
      return 'custom-exchanged-token';
    },
    getCacheMetrics: () => ({
      cacheHits: 10,
      cacheMisses: 2,
      // ... other metrics
    }),
  },
});

// Context with custom audit service
const contextWithAudit = createMockCoreContext({
  auditService: {
    log: async (entry) => {
      console.log('Audit:', entry);
      // Store in test array for assertions
    },
    query: async (filter) => {
      // Return test audit entries
      return [];
    },
  },
});
```

### Generating Mock JWT Tokens

```typescript
import { generateMockJWT } from 'fastmcp-oauth-obo/testing';

// Basic token
const token = generateMockJWT();

// Token with custom claims
const adminToken = generateMockJWT({
  sub: 'admin-user',
  roles: ['admin'],
  permissions: ['*'],
  legacy_name: 'ADMIN',
});

// Token for specific audience
const apiToken = generateMockJWT({
  aud: ['api-service'],
  scope: 'api:read api:write',
});
```

---

## Integration Testing

### Testing Module Registration

```typescript
import { describe, it, expect } from 'vitest';
import { createMockCoreContext } from '../src/testing/index.js';
import { MyDelegationModule } from '../src/delegation/mymodule/index.js';

describe('Module Registration', () => {
  it('should register module with delegation registry', async () => {
    const coreContext = createMockCoreContext();
    const module = new MyDelegationModule();

    await module.initialize({ /* config */ });
    coreContext.delegationRegistry.register(module);

    expect(coreContext.delegationRegistry.has('mymodule')).toBe(true);
    expect(coreContext.delegationRegistry.get('mymodule')).toBe(module);
  });

  it('should list all registered modules', () => {
    const coreContext = createMockCoreContext();

    const module1 = new MyDelegationModule();
    const module2 = new MyDelegationModule();
    module2.name = 'module2'; // Normally set in constructor

    coreContext.delegationRegistry.register(module1);
    coreContext.delegationRegistry.register(module2);

    const moduleNames = coreContext.delegationRegistry.list();
    expect(moduleNames).toContain('mymodule');
    expect(moduleNames).toContain('module2');
  });
});
```

### Testing with Token Exchange

```typescript
import { describe, it, expect } from 'vitest';
import { createMockUserSession, createMockCoreContext } from '../src/testing/index.js';

describe('Token Exchange Integration', () => {
  it('should exchange token before delegation', async () => {
    const mockSession = createMockUserSession();
    const exchangedTokens: string[] = [];

    const mockCoreContext = createMockCoreContext({
      tokenExchangeService: {
        performExchange: async (params) => {
          const exchangedToken = `exchanged-${params.audience}`;
          exchangedTokens.push(exchangedToken);
          return exchangedToken;
        },
        getCacheMetrics: () => ({}),
      },
    });

    const module = new MyDelegationModule();
    await module.initialize({ audience: 'my-api' });

    await module.delegate(
      mockSession,
      'test-action',
      {},
      { sessionId: 'test', coreContext: mockCoreContext }
    );

    expect(exchangedTokens.length).toBe(1);
    expect(exchangedTokens[0]).toBe('exchanged-my-api');
  });
});
```

---

## Best Practices

### 1. Test Initialization

Always test that your module initializes correctly:

```typescript
describe('initialization', () => {
  it('should initialize with valid config', async () => {
    const module = new MyDelegationModule();
    await expect(module.initialize(validConfig)).resolves.not.toThrow();
  });

  it('should reject invalid config', async () => {
    const module = new MyDelegationModule();
    await expect(module.initialize({})).rejects.toThrow();
  });
});
```

### 2. Test Error Handling

Test that errors are handled gracefully:

```typescript
it('should handle network errors', async () => {
  global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

  const result = await module.delegate(mockSession, 'action', {});

  assertDelegationFailure(result);
  expect(result.error).toContain('Network error');
  expect(result.auditTrail.success).toBe(false);
});
```

### 3. Test Audit Logging

Ensure all operations are logged:

```typescript
it('should log successful operations', async () => {
  const result = await module.delegate(mockSession, 'action', {});

  expect(result.auditTrail).toBeDefined();
  expect(result.auditTrail.success).toBe(true);
  expect(result.auditTrail.userId).toBe(mockSession.userId);
  expect(result.auditTrail.timestamp).toBeInstanceOf(Date);
});

it('should log failed operations', async () => {
  const result = await module.delegate(mockSession, 'invalid-action', {});

  expect(result.auditTrail.success).toBe(false);
  expect(result.auditTrail.error).toBeDefined();
});
```

### 4. Test Permission Enforcement

```typescript
it('should enforce permissions', async () => {
  const unauthorizedSession = createMockUserSession({
    permissions: [], // No permissions
  });

  const result = await module.delegate(
    unauthorizedSession,
    'restricted-action',
    {}
  );

  assertDelegationFailure(result);
  expect(result.error).toContain('permission');
});
```

### 5. Use Spies for Call Tracking

```typescript
import { createSpy } from 'fastmcp-oauth-obo/testing';

it('should call external service with correct params', async () => {
  const apiSpy = createSpy(async (endpoint, options) => {
    return { ok: true, json: async () => ({}) };
  });

  global.fetch = apiSpy as any;

  await module.delegate(mockSession, 'action', { id: '123' });

  expect(apiSpy.calls.length).toBe(1);
  expect(apiSpy.calls[0][0]).toContain('/api/endpoint');
});
```

### 6. Test Cleanup

```typescript
describe('cleanup', () => {
  it('should cleanup resources on destroy', async () => {
    await module.initialize(validConfig);
    await module.destroy();

    const healthy = await module.healthCheck();
    expect(healthy).toBe(false);
  });
});
```

---

## Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test mymodule.test.ts

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm test -- --watch

# Run tests matching pattern
npm test -- --grep "delegation"
```

---

## Example: Complete Test Suite

See [tests/unit/delegation/sql/sql-module.test.ts](../tests/unit/delegation/sql/sql-module.test.ts) for a complete example of testing a delegation module with:

- Initialization tests
- Delegation success/failure tests
- Error handling tests
- Audit logging tests
- Permission enforcement tests
- Health check tests
- Cleanup tests

---

## Additional Resources

- [Vitest Documentation](https://vitest.dev/)
- [Testing Framework Extensions](./EXTENDING.md#testing-your-module)
- [Example Test Files](../tests/unit/delegation/)
- [Mock Factories Source](../src/testing/index.ts)

---

## Troubleshooting

### Issue: Tests timeout

**Solution:** Increase timeout or use `waitFor()` utility:

```typescript
import { waitFor } from 'fastmcp-oauth-obo/testing';

await waitFor(() => condition === true, 10000); // 10 second timeout
```

### Issue: Mock functions not being called

**Solution:** Ensure you're using the spy correctly:

```typescript
const spy = createSpy();
module.someMethod = spy;

// Call the method
await module.someMethod('arg');

// Check calls
console.log('Calls:', spy.calls);
expect(spy.calls.length).toBeGreaterThan(0);
```

### Issue: Type errors with mocks

**Solution:** Use type assertions:

```typescript
const mockContext = createMockCoreContext() as CoreContext;
```

---

## Contributing

When adding new testing utilities:

1. Add to `src/testing/index.ts`
2. Export from main testing module
3. Document in this guide
4. Add examples to [examples/](../examples/)
5. Write tests in [tests/unit/testing/](../tests/unit/testing/)

---

**Last Updated:** 2025-10-21
**Version:** 2.0.0
