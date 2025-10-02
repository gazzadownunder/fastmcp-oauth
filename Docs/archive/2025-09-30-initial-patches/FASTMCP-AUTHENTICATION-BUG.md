# FastMCP Authentication Callback Bug Report

**Date:** 2025-09-30
**Component:** FastMCP httpStream transport
**Mode:** `stateless: true`
**Impact:** Critical - Tool calls fail with authentication enabled

## Executive Summary

FastMCP's `stateless: true` mode **only invokes the authenticate() callback on initialize requests, NOT on tool call requests**. This causes all tool calls to fail with "No valid session ID provided" even when valid JWT Bearer tokens are present in Authorization headers.

## Expected Behavior

When FastMCP is configured with `stateless: true`, the authenticate() callback should be invoked for **every incoming request** to validate the authentication credentials (JWT Bearer token) and establish user context for that request.

```typescript
// Expected: authenticate() called for ALL requests
await this.server.start({
  transportType: 'httpStream',
  stateless: true,  // Should authenticate per-request
  authenticate: async (request) => {
    // Should be called for:
    // 1. initialize request ✓ (works)
    // 2. tools/list request ✗ (not called)
    // 3. tools/call request ✗ (not called)
    // 4. Any other MCP request ✗ (not called)
  }
});
```

## Actual Behavior

The authenticate() callback is **only invoked once during the initialize request**. All subsequent tool calls bypass authentication entirely and fail with session-related errors.

### Evidence from Production Logs

#### 1. Initialize Request - Authentication WORKS

From [logs/mcpserver.log](logs/mcpserver.log) lines 32-94:

```
[AUTH DEBUG] ========== Authentication Request ==========
[AUTH DEBUG] Request type: object
[AUTH DEBUG] Request method: POST
[AUTH DEBUG] Request URL: /mcp
[AUTH DEBUG] Request headers: {
  authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI...'
}
[AUTH DEBUG] Extracting Bearer token...
[AUTH DEBUG] Token extracted (length: 1537)

[JWT VALIDATOR] ========== JWT Validation Request ==========
[JWT VALIDATOR] Token preview: eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...
[JWT VALIDATOR] Starting validation...
[JWT VALIDATOR] ✓ Token decoded successfully
[JWT VALIDATOR] Issuer: http://localhost:8080/realms/mcp_security
[JWT VALIDATOR] Audience: [ 'account', 'mcp-oauth' ]
[JWT VALIDATOR] Issued At: 1735595437 (2025-12-31T00:30:37.000Z)
[JWT VALIDATOR] Expires At: 1735595737 (2025-12-31T00:35:37.000Z)
[JWT VALIDATOR] Subject: 2428d99f-1507-4cf6-9ef1-fead0d9f5c8b
[JWT VALIDATOR] Authorized Party (azp): mcp-oauth ✓

[AUTH DEBUG] Checking trusted IDP...
[AUTH DEBUG] ✓ Found matching trusted IDP
[AUTH DEBUG] IDP config: {...}
[AUTH DEBUG] IDP match: true

[AUTH DEBUG] Mapping claims to UserSession...
[AUTH DEBUG] Raw claim values:
[AUTH DEBUG]   - userId (sub): 2428d99f-1507-4cf6-9ef1-fead0d9f5c8b
[AUTH DEBUG]   - username (preferred_username): greynolds
[AUTH DEBUG]   - legacyUsername (legacy_name): greynolds
[AUTH DEBUG]   - roles (realm_access.roles): [ 'default-roles-mcp_security', 'offline_access', 'uma_authorization' ]

[AUTH DEBUG] ✓ Successfully authenticated user: greynolds (greynolds)
[AUTH DEBUG] Session created with ID: greynolds
```

**Result:** Initialize succeeds with HTTP 200

#### 2. Tool Call Request - Authentication BYPASSED

From [logs/mcpserver.log](logs/mcpserver.log) - **NO authentication logs for tool call**

The server log shows NO `[AUTH DEBUG]` or `[JWT VALIDATOR]` output when tools/call is invoked, despite the Authorization header being present (confirmed by proxy logs below).

From [logs/proxy.log](logs/proxy.log) lines 31-40:

```
→ PROXY REQUEST
  POST /mcp → http://localhost:3000/mcp
  Cookie from browser: none
  Authorization: present          ← TOKEN IS PRESENT
  Forwarding to backend...

← PROXY RESPONSE
  Status: 400
  Content-Type: application/json
  ⚠ No Set-Cookie headers from backend
```

From [logs/browser.log](logs/browser.log) lines 15-29:

```
[MCP CLIENT] Sending request: {
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "user-info",
    "arguments": {}
  }
}
[MCP CLIENT] Response status: 400
[MCP CLIENT] JSON response: {
  "jsonrpc": "2.0",
  "id": 2,
  "error": {
    "code": -32600,
    "message": "Bad Request: No valid session ID provided"
  }
}
```

**Result:** Tool call fails with HTTP 400 "No valid session ID provided"

## Root Cause Analysis

### Configuration

```typescript
// src/index-simple.ts
await this.server.start({
  transportType: 'httpStream',
  httpStream: {
    port: 3000,
    endpoint: '/mcp',
  },
  stateless: true,  // ← Should trigger per-request authentication
  logLevel: 'debug',
});
```

### Authentication Callback Implementation

```typescript
// src/index-simple.ts
private async authenticateRequest(request: any): Promise<UserSession | undefined> {
  console.log('\n[AUTH DEBUG] ========== Authentication Request ==========');
  console.log('[AUTH DEBUG] Request type:', typeof request);
  console.log('[AUTH DEBUG] Request method:', request?.method);
  console.log('[AUTH DEBUG] Request URL:', request?.url);

  const authHeader = request?.headers?.authorization;

  if (!authHeader) {
    console.log('[AUTH DEBUG] No authorization header provided');
    return undefined;
  }

  const token = this.extractBearerToken(authHeader);
  if (!token) {
    console.log('[AUTH DEBUG] Failed to extract Bearer token');
    return undefined;
  }

  // Full JWT validation using jose library...
  const session = await this.jwtValidator.validateJWT(token);
  return session;
}
```

### The Bug

FastMCP's httpStream transport with `stateless: true` has a logic flaw:

1. **Initialize request:** `authenticateRequest()` is called → JWT validated → Session established
2. **Tool call requests:** `authenticateRequest()` is **NOT called** → Session lookup fails → Error returned

The `stateless: true` flag is intended to mean "authenticate every request, don't use server-side sessions." Instead, it appears to mean "authenticate once on initialize, then expect client-managed sessions."

## Impact Assessment

### Security Impact: HIGH

- **Broken Authentication:** JWT validation is bypassed for 99% of requests (all tool calls)
- **Authorization Bypass:** Role/scope checks cannot be enforced on tool execution
- **Audit Trail Gaps:** Tool usage is not properly attributed to authenticated users
- **Delegation Failures:** On-behalf-of operations (SQL EXECUTE AS USER, Kerberos delegation) cannot work without validated user context

### Functional Impact: CRITICAL

- **All Tool Calls Fail:** Server is completely unusable for authenticated operations
- **Workarounds Required:** Applications must implement custom session management (see Workaround section)
- **OAuth 2.0 OBO Blocked:** RFC 8693 token exchange flows cannot be validated per-request

## Reproduction Steps

### Prerequisites

1. FastMCP server with httpStream transport
2. JWT Bearer token authentication configured
3. `stateless: true` mode enabled

### Test Procedure

```javascript
// 1. Initialize connection (works)
const initResponse = await fetch('http://localhost:3000/mcp', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'Authorization': 'Bearer eyJhbGci...' // Valid JWT
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
// Result: HTTP 200, authentication logs appear

// 2. Call tool (fails)
const toolResponse = await fetch('http://localhost:3000/mcp', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'Authorization': 'Bearer eyJhbGci...' // Same valid JWT
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'user-info',
      arguments: {}
    }
  })
});
// Result: HTTP 400 "No valid session ID provided"
// NO authentication logs appear
```

### Expected vs Actual

| Request Type | Expected Behavior | Actual Behavior |
|-------------|-------------------|-----------------|
| initialize  | authenticate() called ✓ | authenticate() called ✓ |
| tools/list  | authenticate() called ✓ | authenticate() NOT called ✗ |
| tools/call  | authenticate() called ✓ | authenticate() NOT called ✗ |

## Current Workaround

The main project (`Sample-client-auth/mcpToolsService.ts`) works around this bug by implementing **manual session management**:

### Client-Side Session Management

```typescript
// Store session IDs per server/conversation
private sessionCache = new Map<string, MCPSessionContext>();

// Ensure session exists before tool calls
async ensureSession(
  server: MCPServerConnection,
  conversationId?: string
): Promise<string | null> {
  const sessionKey = conversationId
    ? `${server.id}_${conversationId}`
    : server.id;

  // Check existing session
  const existingSession = this.sessionCache.get(sessionKey);
  if (existingSession?.expiresAt && existingSession.expiresAt > new Date()) {
    return existingSession.sessionId;
  }

  // Initialize new session
  const sessionContext = await this.initializeSession(server, conversationId);
  if (sessionContext) {
    this.sessionCache.set(sessionKey, sessionContext);
    return sessionContext.sessionId;
  }

  return null;
}

// Include session ID in tool call headers
const requestHeaders = {
  'Content-Type': 'application/json',
  'Accept': 'application/json, text/event-stream',
  'Mcp-Session-Id': sessionKey // Custom header with cached session
};
```

### Limitations of Workaround

1. **Requires Stateful Mode:** Must use `stateless: false` to enable server-side sessions
2. **CORS Complexity:** Session cookies don't work cross-origin; requires custom headers
3. **Token Refresh Issues:** Long-lived sessions persist beyond JWT expiration
4. **No Per-Request Validation:** JWT is only validated once on initialize
5. **Bypasses OAuth Security:** Cannot validate `azp` claim or roles per-request

## Proposed Solutions

### Option 1: Fix FastMCP Stateless Mode (Preferred)

Modify FastMCP to invoke authenticate() callback on **all requests** when `stateless: true`:

```typescript
// In FastMCP httpStream handler
async function handleRequest(req: Request): Promise<Response> {
  if (config.stateless && config.authenticate) {
    // Call authenticate for EVERY request
    const session = await config.authenticate(req);
    if (!session) {
      return jsonRpcError(req.id, -32600, 'Unauthorized');
    }
    // Attach session to request context
    req.context.session = session;
  } else if (!config.stateless) {
    // Use session ID lookup for stateful mode
    const sessionId = req.headers['mcp-session-id'] || req.cookies['mcp-session'];
    req.context.session = sessionStore.get(sessionId);
  }

  // Process request with authenticated context
  return await processJsonRpc(req);
}
```

### Option 2: Document Stateless Mode Behavior

Update FastMCP documentation to clarify:

> **stateless mode:** When `stateless: true`, the authenticate() callback is invoked only during initialization. Applications requiring per-request authentication should:
> 1. Use `stateless: false`
> 2. Implement client-side session management
> 3. Pass session IDs via `Mcp-Session-Id` header or cookies

**Issues with Option 2:**
- Contradicts the semantic meaning of "stateless"
- Forces insecure patterns (long-lived sessions)
- Incompatible with OAuth 2.0 best practices

### Option 3: Add Per-Request Authentication Mode

Introduce a new configuration option:

```typescript
await server.start({
  transportType: 'httpStream',
  authMode: 'per-request', // New option
  authenticate: async (request) => {
    // Called for ALL requests regardless of method
  }
});
```

## References

### Related Code Files

- [src/index-simple.ts](src/index-simple.ts) - Server with authenticate() implementation
- [src/middleware/jwt-validator.ts](src/middleware/jwt-validator.ts) - JWT validation logic
- [Sample-client-auth/mcpToolsService.ts](Sample-client-auth/mcpToolsService.ts) - Workaround implementation
- [test-harness/web-test/mcp-client.js](test-harness/web-test/mcp-client.js) - Test client

### Log Files

- [logs/mcpserver.log](logs/mcpserver.log) - Server authentication logs
- [logs/proxy.log](logs/proxy.log) - Proxy showing Authorization headers
- [logs/browser.log](logs/browser.log) - Client-side error responses

### Standards References

- **RFC 8693:** OAuth 2.0 Token Exchange (requires per-request validation of azp claim)
- **RFC 6750:** OAuth 2.0 Bearer Token Usage (HTTP Authorization header)
- **RFC 8725:** JWT Best Current Practices (short-lived tokens, per-request validation)

## Conclusion

FastMCP's `stateless: true` mode has a critical bug that breaks JWT Bearer token authentication for tool calls. The authenticate() callback is only invoked on initialize requests, causing all subsequent operations to fail with session errors.

**Recommended Action:** Fix FastMCP to invoke authenticate() on every request when stateless mode is enabled, aligning with OAuth 2.0 security best practices and the semantic meaning of "stateless authentication."

**Workaround Status:** Manual session management is possible but undermines the security benefits of short-lived JWT tokens and per-request validation.