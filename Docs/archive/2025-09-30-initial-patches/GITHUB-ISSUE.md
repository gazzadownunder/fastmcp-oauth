# Bug: `stateless: true` mode only authenticates on initialize, not on tool calls

## Environment

- **FastMCP Version:** 1.0.0
- **Node Version:** 18.0.0+
- **Transport:** httpStream
- **Authentication:** JWT Bearer tokens (RFC 6750)

## Summary

FastMCP's `stateless: true` mode **only invokes the `authenticate()` callback on `initialize` requests, NOT on subsequent tool call requests** (`tools/list`, `tools/call`, etc.). This causes all tool calls to fail with "No valid session ID provided" even when valid JWT Bearer tokens are present in Authorization headers.

## Expected Behavior

When FastMCP is configured with `stateless: true`, the `authenticate()` callback should be invoked for **every incoming request** to validate authentication credentials and establish user context per-request (true stateless authentication).

```typescript
await server.start({
  transportType: 'httpStream',
  stateless: true,  // Should authenticate EVERY request
  authenticate: async (request) => {
    // Should be called for:
    // ✓ initialize request
    // ✗ tools/list request (currently NOT called)
    // ✗ tools/call request (currently NOT called)
    // ✗ resources/* requests (currently NOT called)
  }
});
```

## Actual Behavior

The `authenticate()` callback is **only invoked once during the `initialize` request**. All subsequent requests bypass authentication entirely and fail with session-related errors.

| Request Type | Expected | Actual |
|-------------|----------|--------|
| `initialize` | authenticate() called ✓ | authenticate() called ✓ |
| `tools/list` | authenticate() called ✓ | authenticate() NOT called ✗ |
| `tools/call` | authenticate() called ✓ | authenticate() NOT called ✗ |

## Reproduction

### Setup

```typescript
import { FastMCP } from 'fastmcp';

class AuthServer {
  private server: FastMCP;

  constructor() {
    this.server = new FastMCP({ name: 'Auth Test', version: '1.0.0' });

    this.server.addTool({
      name: 'user-info',
      description: 'Get current user info',
      parameters: z.object({}),
      execute: async (args, context) => {
        console.log('[TOOL] user-info called');
        console.log('[TOOL] Context:', context);
        return JSON.stringify({ user: context.session });
      }
    });
  }

  private async authenticateRequest(request: any): Promise<any> {
    console.log('[AUTH] ========== Authentication Called ==========');
    console.log('[AUTH] Method:', request?.method);
    console.log('[AUTH] URL:', request?.url);
    console.log('[AUTH] Authorization:', request?.headers?.authorization ? 'present' : 'missing');

    const authHeader = request?.headers?.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return undefined;
    }

    const token = authHeader.substring(7);
    // Validate JWT token here...

    return {
      userId: 'test-user',
      username: 'testuser'
    };
  }

  async start() {
    await this.server.start({
      transportType: 'httpStream',
      httpStream: { port: 3000, endpoint: '/mcp' },
      stateless: true,
      authenticate: this.authenticateRequest.bind(this)
    });
    console.log('Server started on http://localhost:3000/mcp');
  }
}

new AuthServer().start();
```

### Test Client

```javascript
const token = 'eyJhbGci...'; // Valid JWT

// 1. Initialize (works - authenticate() is called)
const initResponse = await fetch('http://localhost:3000/mcp', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'Test', version: '1.0.0' }
    }
  })
});
// Result: HTTP 200
// Server logs: "[AUTH] ========== Authentication Called =========="

// 2. Call tool (fails - authenticate() is NOT called)
const toolResponse = await fetch('http://localhost:3000/mcp', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'Authorization': `Bearer ${token}` // Same valid token
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'user-info', arguments: {} }
  })
});
// Result: HTTP 400 "No valid session ID provided"
// Server logs: NO "[AUTH]" logs - authenticate() was NOT called
```

## Evidence from Real Logs

### Initialize Request - Authentication Works

Server logs show full authentication:

```
[AUTH] ========== Authentication Called ==========
[AUTH] Method: POST
[AUTH] URL: /mcp
[AUTH] Authorization: present
[JWT VALIDATOR] Token decoded successfully
[JWT VALIDATOR] Issuer: http://localhost:8080/realms/mcp_security
[JWT VALIDATOR] Audience: [ 'account', 'mcp-oauth' ]
[AUTH] ✓ Successfully authenticated user: greynolds
```

**Result:** HTTP 200

### Tool Call Request - Authentication Bypassed

Server logs show **NO authentication logs** despite Authorization header being present:

```
(no [AUTH] logs appear)
```

Client receives:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "error": {
    "code": -32600,
    "message": "Bad Request: No valid session ID provided"
  }
}
```

**Result:** HTTP 400

Proxy logs confirm Authorization header was sent:

```
→ PROXY REQUEST
  POST /mcp → http://localhost:3000/mcp
  Authorization: present ← TOKEN IS PRESENT

← PROXY RESPONSE
  Status: 400
  ⚠ No Set-Cookie headers from backend
```

## Impact

### Security Impact: **HIGH**

- **Broken Authentication:** JWT validation is bypassed for 99% of requests (all tool calls)
- **Authorization Bypass:** Role/scope checks cannot be enforced on tool execution
- **Audit Trail Gaps:** Tool usage is not properly attributed to authenticated users
- **Cannot implement OAuth 2.0 On-Behalf-Of flows:** RFC 8693 requires per-request validation of `azp` claim

### Functional Impact: **CRITICAL**

- **All Tool Calls Fail:** Server is completely unusable for authenticated operations
- **Workarounds Required:** Applications must implement custom session management
- **Contradicts "Stateless" Semantics:** `stateless: true` should mean "no server-side sessions, authenticate per-request"

## Root Cause

FastMCP's httpStream transport with `stateless: true` appears to:

1. Call `authenticate()` during `initialize` → establish session in server-side store
2. Expect subsequent requests to include session ID (cookie or header)
3. Skip `authenticate()` callback for non-initialize requests

This behavior contradicts the semantic meaning of "stateless authentication," which should validate credentials on **every request** without server-side session state.

## Workaround

The only current workaround is to:

1. Use `stateless: false` (enable server-side sessions)
2. Manually cache session IDs after `initialize`
3. Include `Mcp-Session-Id` header in all subsequent requests

**Limitations:**
- Long-lived sessions persist beyond JWT expiration
- Cannot validate per-request claims (roles, scopes)
- Bypasses OAuth 2.0 security best practices
- Incompatible with distributed systems (session affinity required)

## Proposed Solution

Modify FastMCP's httpStream handler to invoke `authenticate()` on **all requests** when `stateless: true`:

```typescript
// In FastMCP httpStream handler
async function handleRequest(req: Request): Promise<Response> {
  if (config.stateless && config.authenticate) {
    // Call authenticate for EVERY request (not just initialize)
    const session = await config.authenticate(req);
    if (!session) {
      return jsonRpcError(req.id, -32600, 'Unauthorized');
    }
    req.context.session = session;
  } else if (!config.stateless) {
    // Use session ID lookup for stateful mode
    const sessionId = req.headers['mcp-session-id'] || req.cookies['mcp-session'];
    req.context.session = sessionStore.get(sessionId);
  }

  return await processJsonRpc(req);
}
```

## Alternative Solution

If the current behavior is intentional, introduce a new configuration option:

```typescript
await server.start({
  transportType: 'httpStream',
  authMode: 'per-request', // New option: 'per-request' | 'session-based'
  authenticate: async (request) => {
    // Called for ALL requests when authMode: 'per-request'
  }
});
```

## Related Standards

- **RFC 6750:** OAuth 2.0 Bearer Token Usage (HTTP Authorization header)
- **RFC 8693:** OAuth 2.0 Token Exchange (requires per-request validation)
- **RFC 8725:** JWT Best Current Practices (short-lived tokens, per-request validation)

## Additional Context

This issue blocks implementation of enterprise authentication patterns including:
- OAuth 2.0 On-Behalf-Of (OBO) delegation
- JWT Bearer token authentication with short-lived tokens
- Kerberos Constrained Delegation (S4U2Self/S4U2Proxy)
- SQL Server `EXECUTE AS USER` with validated identity

Complete reproduction case and logs available upon request.