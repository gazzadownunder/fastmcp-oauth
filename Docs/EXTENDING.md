# Extending the MCP OAuth Framework

This guide shows developers how to extend the MCP OAuth Framework with custom delegation modules and tools.

## ⚠️ Before You Extend: Consider Built-in Tools

**IMPORTANT:** The framework includes production-ready SQL delegation tools that work out-of-the-box. Before creating custom tools, check if the built-in tools meet your needs.

### Quick Check: Do You Need Custom Tools?

**Use built-in tools if:**
- ✅ You need PostgreSQL or MSSQL delegation
- ✅ Standard SQL queries, procedures, and functions are sufficient
- ✅ Role-based authorization is adequate
- ✅ You want zero maintenance burden

**Use custom tools if:**
- ⚠️ You need custom tool names or parameter schemas
- ⚠️ You're integrating with non-SQL systems (REST API, GraphQL, LDAP)
- ⚠️ You need parameter/result transformation
- ⚠️ You require custom authorization logic beyond roles

**See [TOOL-FACTORIES.md](TOOL-FACTORIES.md) for detailed comparison and decision guide.**

### Built-in Tools Example (10 lines)

```typescript
import { getAllToolFactories } from 'fastmcp-oauth-obo';

// Register all built-in tools (sql-delegate, health-check, user-info)
const toolFactories = getAllToolFactories();
for (const factory of toolFactories) {
  const tool = factory(coreContext);
  server.addTool({
    name: tool.name,
    description: tool.schema.description || tool.name,
    parameters: tool.schema,
    execute: tool.handler,
    canAccess: tool.canAccess
  });
}
```

**Benefits:**
- ✅ 97% less code (10 lines vs 300+ lines for custom tools)
- ✅ Production-tested security and error handling
- ✅ Token exchange and audit logging included
- ✅ Framework updates without code changes

**If built-in tools don't fit your needs, continue with this guide to create custom tools using the factory pattern or custom delegation modules.**

---

## Table of Contents

- [Quick Start: Custom Delegation Module](#quick-start-custom-delegation-module)
- [Tool Creation with createDelegationTool()](#tool-creation-with-createdelegationtool)
- [Using Token Exchange in Custom Modules](#using-token-exchange-in-custom-modules)
- [Advanced: Manual Tool Registration](#advanced-manual-tool-registration)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

---

## Quick Start: Custom Delegation Module

**Goal:** Create a custom delegation module to integrate with a REST API backend in under 30 minutes.

### Step 1: Create Module Class

Create a new file `src/delegation/my-api/my-api-module.ts`:

```typescript
import type { DelegationModule, DelegationResult } from '../base.js';
import type { UserSession, AuditEntry } from '../../core/index.js';

export class MyAPIDelegationModule implements DelegationModule {
  readonly name = 'my-api';
  readonly type = 'api';

  private apiBaseUrl: string = '';
  private apiKey: string = '';

  /**
   * Initialize module with configuration
   */
  async initialize(config: { baseUrl: string; apiKey: string }): Promise<void> {
    this.apiBaseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    console.log(`[MyAPI] Module initialized: ${this.apiBaseUrl}`);
  }

  /**
   * Delegate action to external API
   *
   * Phase 2: Now accepts optional context parameter with CoreContext
   */
  async delegate<T = unknown>(
    session: UserSession,
    action: string,
    params: any,
    context?: {
      sessionId?: string;
      coreContext?: any;
    }
  ): Promise<DelegationResult<T>> {
    const auditEntry: AuditEntry = {
      timestamp: new Date(),
      source: 'delegation:my-api',
      userId: session.userId,
      action: `my-api:${action}`,
      success: false,
    };

    try {
      // Perform API call
      const response = await fetch(`${this.apiBaseUrl}/${action}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'X-User-ID': session.userId,
        },
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      auditEntry.success = true;
      return {
        success: true,
        data: data as T,
        auditTrail: auditEntry,
      };
    } catch (error) {
      auditEntry.error = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: auditEntry.error,
        auditTrail: auditEntry,
      };
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiBaseUrl}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Cleanup
   */
  async destroy(): Promise<void> {
    console.log('[MyAPI] Module destroyed');
  }
}
```

### Step 2: Register Module

In your server initialization code:

```typescript
import { FastMCPOAuthServer } from 'fastmcp-oauth';
import { MyAPIDelegationModule } from './delegation/my-api/my-api-module.js';

const server = new FastMCPOAuthServer({
  configPath: './config.json',
});

// Register custom module BEFORE starting server
const myApiModule = new MyAPIDelegationModule();
await myApiModule.initialize({
  baseUrl: 'https://api.myservice.com',
  apiKey: process.env.MY_API_KEY!,
});

// Start server (this automatically initializes AuthenticationService)
await server.start();

// Get CoreContext and register module AFTER starting
const coreContext = server.getCoreContext();
coreContext.delegationRegistry.register(myApiModule);
```

⚠️ **IMPORTANT:** If you're using manual wiring instead of `FastMCPOAuthServer`, you MUST call:
```typescript
await coreContext.authService.initialize();
```
after `buildCoreContext()` to download JWKS keys. See [Manual Initialization](#manual-initialization) section below.

### Step 3: Create Tool Using Factory

Use the `createDelegationTool()` factory to create a tool with minimal code:

```typescript
import { createDelegationTool } from 'fastmcp-oauth';
import { z } from 'zod';

// Define parameters schema
const myApiParamsSchema = z.object({
  endpoint: z.string().describe('API endpoint to call'),
  data: z.record(z.any()).describe('Data to send to API'),
});

// Create tool (5 lines instead of 50!)
const myApiTool = createDelegationTool(
  'my-api',
  {
    name: 'my-api-call',
    description: 'Call My API service',
    parameters: myApiParamsSchema,
    action: 'call',
    requiredRoles: ['user', 'admin'], // At least one role required
  },
  coreContext
);

// Register tool
server.registerTool(myApiTool);
```

**That's it!** You now have a fully functional custom delegation module with OAuth authentication, authorization, audit logging, and error handling.

---

## Tool Creation with createDelegationTool()

The `createDelegationTool()` factory is the **recommended way** to create MCP tools. It handles all the boilerplate automatically.

### Basic Usage

```typescript
import { createDelegationTool } from 'fastmcp-oauth';
import { z } from 'zod';

const tool = createDelegationTool(
  'module-name',           // Delegation module name
  {
    name: 'tool-name',      // Tool name (shown to LLM)
    description: 'Tool description',
    parameters: z.object({  // Zod schema for parameters
      param1: z.string(),
    }),
    action: 'action-name',  // Action to pass to module
    requiredRoles: ['user'], // Required roles from JWT (at least one)
  },
  coreContext              // CoreContext from server
);
```

### What the Factory Does For You

1. **Authentication:** Automatically checks if user is authenticated
2. **Authorization:** Validates required roles from JWT claims
3. **Visibility Control:** Implements `canAccess()` for tool filtering
4. **Session Management:** Extracts and validates user session
5. **Delegation:** Calls the delegation module via DelegationRegistry
6. **Error Handling:** Catches and sanitizes all errors (prevents info leaks)
7. **Audit Logging:** Logs all attempts (success and failure)
8. **Type Safety:** Full TypeScript type inference from Zod schema

### Parameter Transformation

Transform parameters before passing to the delegation module:

```typescript
const tool = createDelegationTool('sql', {
  name: 'sql-query',
  description: 'Execute SQL query',
  parameters: z.object({
    table: z.string(),
    filter: z.record(z.any()),
  }),
  action: 'query',
  requiredRoles: ['user', 'admin'], // At least one role required

  // Transform parameters before delegation
  transformParams: (params, session) => ({
    sql: `SELECT * FROM ${params.table} WHERE id = $1`,
    params: [params.filter.id],
    legacyUsername: session.legacyUsername,
  }),
}, coreContext);
```

### Result Transformation

Transform delegation results before returning to LLM:

```typescript
const tool = createDelegationTool('my-api', {
  name: 'get-user-profile',
  description: 'Get user profile from API',
  parameters: z.object({
    userId: z.string(),
  }),
  action: 'getUserProfile',
  requiredRoles: ['user'], // At least 'user' role required

  // Transform result before returning to LLM
  transformResult: (apiResult) => ({
    displayName: apiResult.fullName,
    email: apiResult.email,
    roles: apiResult.roles,
    // Hide sensitive fields like SSN, address
  }),
}, coreContext);
```

### Custom Visibility Logic

Control when tool is visible to LLM (beyond standard role checks):

```typescript
const tool = createDelegationTool('admin-api', {
  name: 'delete-user',
  description: 'Delete user account (admin only)',
  parameters: z.object({
    userId: z.string(),
  }),
  action: 'deleteUser',
  requiredRoles: ['admin'], // Must have 'admin' role

  // Custom visibility check
  canAccess: (mcpContext) => {
    // Only show tool if user is admin AND has verified MFA
    return mcpContext.session?.role === 'admin' &&
           mcpContext.session?.customClaims?.mfaVerified === true;
  },
}, coreContext);
```

### Batch Tool Creation

Create multiple related tools at once:

```typescript
import { createDelegationTools } from 'fastmcp-oauth';

const sqlTools = createDelegationTools('sql', [
  {
    name: 'sql-read',
    description: 'Read data from database',
    parameters: sqlReadSchema,
    action: 'query',
    requiredRoles: ['user', 'admin'], // At least one role required
  },
  {
    name: 'sql-write',
    description: 'Write data to database',
    parameters: sqlWriteSchema,
    action: 'execute',
    requiredRoles: ['admin'], // Write requires admin role
  },
], coreContext);

// Register all tools at once
server.registerTools(sqlTools);
```

---

## Using Token Exchange in Custom Modules

**Phase 2 Enhancement:** Custom modules can now access the framework's `TokenExchangeService` to exchange the requestor's JWT for delegation tokens with different privileges.

### When to Use Token Exchange

Use token exchange when:
- Your backend API requires different JWT claims than the requestor's token
- You need to perform privilege elevation (user → admin for specific resource)
- You need to perform privilege reduction (admin → read-only for audit purposes)
- Your backend uses a different audience or issuer than the MCP server

### Accessing TokenExchangeService

In your custom delegation module, access the service via the `context` parameter:

```typescript
export class MyAPIDelegationModule implements DelegationModule {
  async delegate<T>(
    session: UserSession,
    action: string,
    params: any,
    context?: {
      sessionId?: string;
      coreContext?: any; // Contains tokenExchangeService
    }
  ): Promise<DelegationResult<T>> {

    // Step 1: Check if token exchange is available
    const tokenExchangeService = context?.coreContext?.tokenExchangeService;
    if (!tokenExchangeService) {
      // Fallback: Use requestor's JWT claims directly
      return this.delegateWithoutTokenExchange(session, action, params);
    }

    // Step 2: Perform token exchange
    try {
      const delegationToken = await tokenExchangeService.performExchange({
        requestorJWT: session.claims?.access_token as string,
        audience: 'urn:api:myservice', // API-specific audience
        scope: 'api:read api:write',   // Requested scopes
        sessionId: context?.sessionId, // For token caching
      });

      // Step 3: Use exchanged token for API call
      const response = await fetch(`${this.apiBaseUrl}/${action}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${delegationToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
      });

      return {
        success: true,
        data: await response.json() as T,
        auditTrail: {
          timestamp: new Date(),
          source: 'delegation:my-api',
          userId: session.userId,
          action: `my-api:${action}`,
          success: true,
          metadata: { usedTokenExchange: true },
        },
      };
    } catch (error) {
      // Handle errors...
    }
  }
}
```

### Token Exchange Configuration

Configure token exchange in your server config:

```json
{
  "auth": {
    "trustedIDPs": [{
      "issuer": "https://auth.company.com",
      "jwksUri": "https://auth.company.com/.well-known/jwks.json",
      "audience": "mcp-server-api"
    }]
  },
  "delegation": {
    "tokenExchange": {
      "tokenEndpoint": "https://auth.company.com/oauth/token",
      "clientId": "mcp-server",
      "clientSecret": "SECRET_VALUE",
      "audience": "urn:api:myservice",
      "cache": {
        "enabled": true,
        "ttlSeconds": 60
      }
    }
  }
}
```

### Token Caching (Optional)

The framework provides encrypted token caching to reduce IDP load:

```typescript
// Token exchange with caching
const delegationToken = await tokenExchangeService.performExchange({
  requestorJWT: session.claims?.access_token as string,
  audience: 'urn:api:myservice',
  sessionId: context?.sessionId, // CRITICAL: Pass sessionId for caching
});

// First call: Token exchanged with IDP (150-300ms latency)
// Subsequent calls: Token retrieved from cache (<2ms latency)
```

**Security:** Cached tokens are:
- Encrypted with AES-256-GCM
- Bound to requestor's JWT via AAD (automatic invalidation on token refresh)
- Scoped to session (separate encryption key per session)
- Automatically cleaned up on session timeout

---

## Advanced: Manual Tool Registration

For maximum control, you can create tools manually without the factory.

### Manual Tool Structure

```typescript
import type { ToolRegistration, FastMCPContext, LLMResponse } from 'fastmcp-oauth';
import { Authorization } from 'fastmcp-oauth';
import { z } from 'zod';

const auth = new Authorization();

const myTool: ToolRegistration = {
  name: 'my-custom-tool',
  description: 'My custom tool',
  schema: z.object({
    param1: z.string(),
  }),

  // Visibility filtering (soft check)
  canAccess: (mcpContext: FastMCPContext) => {
    if (!auth.isAuthenticated(mcpContext)) {
      return false;
    }
    return auth.hasAnyRole(mcpContext, ['user', 'admin']);
  },

  // Tool handler (hard check)
  handler: async (params, mcpContext: FastMCPContext): Promise<LLMResponse> => {
    try {
      // Hard check: Throw on missing auth
      auth.requireAuth(mcpContext);

      // Hard check: Throw on missing role
      auth.requireAnyRole(mcpContext, ['user', 'admin']);

      // Perform operation
      const result = await doSomething(params.param1);

      // Return success response
      return {
        status: 'success',
        data: result,
      };
    } catch (error) {
      // Handle errors
      if (error instanceof OAuthSecurityError) {
        return {
          status: 'failure',
          code: error.code,
          message: error.message,
        };
      }

      // Sanitize unexpected errors
      return {
        status: 'failure',
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      };
    }
  },
};

// Register manually
server.registerTool(myTool);
```

### When to Use Manual Registration

Use manual registration when:
- Tool doesn't use delegation pattern (e.g., health checks, metadata queries)
- You need custom error handling beyond framework defaults
- You need to orchestrate multiple delegation calls
- You're migrating existing tools to the framework

---

## Best Practices

### 1. Use Factory When Possible

```typescript
// ✅ GOOD: Use factory for delegation tools
const tool = createDelegationTool('my-api', config, coreContext);

// ❌ AVOID: Manual registration for delegation tools (too much boilerplate)
const tool: ToolRegistration = {
  name: 'my-api-call',
  handler: async (params, mcpContext) => {
    // 50+ lines of auth, validation, delegation, error handling...
  }
};
```

### 2. Always Validate Parameters

```typescript
// ✅ GOOD: Use Zod for parameter validation
const paramsSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  age: z.number().int().min(0).max(120),
});

// ❌ BAD: No validation
const params: any = ...; // User can inject any data
```

### 3. Handle Errors Gracefully

```typescript
// ✅ GOOD: Return LLM-friendly error responses
return {
  status: 'failure',
  code: 'USER_NOT_FOUND',
  message: 'User with ID "abc123" does not exist',
};

// ❌ BAD: Throw unhandled errors (breaks LLM conversation)
throw new Error('Database query failed: connection timeout');
```

### 4. Never Leak Sensitive Info in Errors

```typescript
// ✅ GOOD: Sanitize errors
return {
  status: 'failure',
  code: 'DATABASE_ERROR',
  message: 'Failed to query database',
};

// ❌ BAD: Leak connection strings, credentials
return {
  status: 'failure',
  message: `DB error: connection to postgres://admin:pass123@db.internal.com failed`,
};
```

### 5. Use Audit Logging

```typescript
// ✅ GOOD: Return audit trail
return {
  success: true,
  data: result,
  auditTrail: {
    timestamp: new Date(),
    source: 'delegation:my-api',
    userId: session.userId,
    action: 'my-api:call',
    success: true,
    metadata: { endpoint: params.endpoint },
  },
};

// Audit service automatically logs this via DelegationRegistry
```

### 6. Implement Health Checks

```typescript
// ✅ GOOD: Implement health check
async healthCheck(): Promise<boolean> {
  try {
    const response = await fetch(`${this.apiBaseUrl}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

// This enables the 'health-check' tool to monitor your module
```

### 7. Clean Up Resources

```typescript
// ✅ GOOD: Clean up in destroy()
async destroy(): Promise<void> {
  await this.apiClient?.close();
  await this.cache?.clear();
  console.log('[MyAPI] Module destroyed');
}

// Framework calls this on server shutdown
```

---

## Troubleshooting

### Tool Not Visible to LLM

**Symptom:** Tool exists but LLM doesn't see it in tools list.

**Causes:**
1. `canAccess()` returns false (user lacks required role)
2. Tool not registered (`server.registerTool()` not called)
3. Server not started (`await server.start()` missing)

**Solution:**
```typescript
// Debug visibility
const auth = new Authorization();
const tool = createDelegationTool('my-api', {
  // ...
  canAccess: (mcpContext) => {
    console.log('[DEBUG] canAccess check:', {
      authenticated: !!mcpContext.session,
      userRole: mcpContext.session?.role,
      customRoles: mcpContext.session?.customRoles,
      requiredRoles: ['user', 'admin'],
    });
    return auth.hasAnyRole(mcpContext, ['user', 'admin']);
  },
}, coreContext);
```

### Tool Call Fails with 401 Unauthorized

**Symptom:** Tool is visible but execution fails with 401.

**Causes:**
1. JWT expired (check `exp` claim)
2. JWT signature invalid (wrong JWKS key)
3. Audience mismatch (JWT audience doesn't include MCP server)

**Solution:**
```bash
# Check JWT claims
echo "$JWT" | jwt decode -

# Verify audience includes MCP server
{
  "aud": ["mcp-server-api", "other-service"]
}
```

### Tool Call Fails with 403 Forbidden

**Symptom:** Tool executes but fails role check.

**Causes:**
1. User lacks required role from JWT
2. Role mapping configuration incorrect
3. Custom `canAccess()` logic rejects user

**Solution:**
```typescript
// Check user session
console.log('User session:', {
  userId: session.userId,
  role: session.role,
  customRoles: session.customRoles,
  requiredRoles: ['user', 'admin'],
});
```

### Delegation Module Not Found

**Symptom:** `Module not found: my-api`

**Causes:**
1. Module not registered with DelegationRegistry
2. Module registered with wrong name
3. Module registration failed during initialization

**Solution:**
```typescript
// Verify module registration
const coreContext = server.getCoreContext();
console.log('Registered modules:', coreContext.delegationRegistry.list().map(m => m.name));

// Should include: ['sql', 'kerberos', 'my-api']
```

### Token Exchange Fails

**Symptom:** `performExchange()` throws error.

**Causes:**
1. Token exchange not configured in server config
2. IDP token endpoint unreachable
3. Invalid client credentials
4. Requestor JWT missing in session claims

**Solution:**
```typescript
// Check configuration
const config = coreContext.configManager.getConfig();
console.log('Token exchange config:', config.delegation?.tokenExchange);

// Check session has access_token
console.log('Session claims:', {
  hasAccessToken: !!session.claims?.access_token,
  claimKeys: Object.keys(session.claims || {}),
});
```

### Type Errors with Zod Schemas

**Symptom:** TypeScript errors when using `createDelegationTool()`.

**Causes:**
1. Zod schema too complex (nested objects)
2. Generic type inference failing

**Solution:**
```typescript
// Explicitly type the schema
const paramsSchema = z.object({
  param1: z.string(),
}) satisfies z.ZodType;

const tool = createDelegationTool<typeof paramsSchema>('my-api', {
  parameters: paramsSchema,
  // ...
}, coreContext);
```

---

## Manual Initialization

If you're using **manual wiring** instead of the `FastMCPOAuthServer` wrapper, you must explicitly initialize the `AuthenticationService` after building the `CoreContext`.

### Problem: "JWT validator not initialized" Error

When you see this error:
```
[FastMCPAuthMiddleware] ❌ Authentication error (statusCode: 500):
JWT validator not initialized. Call initialize() first.
```

It means the `AuthenticationService` hasn't downloaded JWKS keys from your identity provider.

### Solution: Call initialize()

```typescript
import {
  ConfigManager,
  ConfigOrchestrator,
  FastMCPAuthMiddleware
} from 'fastmcp-oauth-obo';
import { FastMCP } from 'fastmcp';

async function main() {
  // 1. Load configuration
  const configManager = new ConfigManager();
  await configManager.loadConfig('./config/unified-config.json');

  // 2. Build CoreContext
  const orchestrator = new ConfigOrchestrator({
    configManager,
    enableAudit: true
  });

  const coreContext = await orchestrator.buildCoreContext();

  // ⚠️ CRITICAL: Initialize AuthenticationService
  await coreContext.authService.initialize();

  // 3. Create middleware (now ready to validate JWTs)
  const middleware = new FastMCPAuthMiddleware(coreContext.authService);

  const server = new FastMCP({
    name: 'My MCP Server',
    version: '1.0.0',
    authenticate: middleware.authenticate.bind(middleware)
  });

  // 4. Register tools and start server
  await server.start({ /* ... */ });
}
```

### What Does initialize() Do?

The `initialize()` method:

1. **Downloads JWKS keys** from your IDP's `.well-known/jwks.json` endpoint
2. **Caches public keys** for RS256/ES256 JWT signature verification
3. **Validates IDP configuration** (HTTPS endpoints, trusted issuers)
4. **Prepares rate limiting** for JWKS refresh operations

Without initialization, the JWT validator cannot verify token signatures, causing all authentication attempts to fail.

### When is Initialization Automatic?

**Automatic initialization occurs when:**
- Using `FastMCPOAuthServer` wrapper → Calls `initialize()` during `start()`
- Using `examples/simple-server.ts` → Handled by wrapper

**Manual initialization required when:**
- Using `ConfigOrchestrator.buildCoreContext()` directly
- Using `examples/full-mcp-server.ts` pattern
- Creating custom server architectures
- Testing delegation modules in isolation

### Debugging Initialization Issues

If initialization fails, check:

1. **IDP JWKS endpoint is reachable:**
   ```bash
   curl https://auth.example.com/.well-known/jwks.json
   ```

2. **Configuration has valid JWKS URI:**
   ```json
   {
     "auth": {
       "trustedIDPs": [{
         "issuer": "https://auth.example.com",
         "jwksUri": "https://auth.example.com/.well-known/jwks.json"
       }]
     }
   }
   ```

3. **HTTPS is used (not HTTP):**
   ```typescript
   // ✅ Good: HTTPS endpoint
   jwksUri: "https://auth.example.com/.well-known/jwks.json"

   // ❌ Bad: HTTP endpoint (insecure, rejected by framework)
   jwksUri: "http://auth.example.com/.well-known/jwks.json"
   ```

4. **Network connectivity:**
   - Check firewall rules
   - Verify DNS resolution
   - Test from server's network context (not your workstation)

---

## Next Steps

- **[API Reference](API-REFERENCE.md)** - Complete API documentation
- **[Examples](../examples/)** - Working code examples
- **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)** - Detailed debugging guide

**Questions?** Open an issue at https://github.com/your-repo/fastmcp-oauth/issues
