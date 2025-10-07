# GitHub Issues - Authentication Fix Documentation

**Date**: 2025-10-06
**Status**: Ready to submit
**Tested**: ✅ Fixes proven to work in node_modules

---

## Issue 1: FastMCP - Session Created Despite Authentication Failure

**Repository**: https://github.com/modelcontextprotocol/fastmcp
**Severity**: High - Security vulnerability
**Affects**: HTTP Stream transport with OAuth/JWT authentication

### Problem Statement

FastMCP's `#createSession` method **always creates a session** even when the authentication callback returns `{ authenticated: false }`. This allows unauthenticated clients to establish sessions and potentially access protected resources.

### Current Behavior (Bug)

**File**: `dist/FastMCP.js` (line ~1227)

```javascript
#createSession(auth) {
  const allowedTools = auth ? this.#tools.filter(
    (tool) => tool.canAccess ? tool.canAccess(auth) : true
  ) : this.#tools;
  return new FastMCPSession({
    auth,
    // ... session options
  });
}
```

**Problem**: The method creates a `FastMCPSession` regardless of `auth.authenticated` status.

### Expected Behavior

When the authenticate callback returns `{ authenticated: false, error: "..." }`, FastMCP should **reject the request** instead of creating a session.

### Steps to Reproduce

1. Configure FastMCP with HTTP Stream transport and stateless authentication:
```typescript
const server = new FastMCP({
  name: 'Test Server',
  version: '1.0.0',
  authenticate: async (req) => {
    // Simulate authentication failure
    return {
      authenticated: false,
      error: 'Invalid JWT token'
    };
  }
});

await server.start({
  transportType: 'httpStream',
  httpStream: { port: 3000, endpoint: '/mcp' },
  stateless: true,
});
```

2. Send initialization request with invalid JWT:
```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer invalid.jwt.token" \
  -d '{
    "jsonrpc":"2.0",
    "method":"initialize",
    "params":{
      "protocolVersion":"2024-11-05",
      "capabilities":{},
      "clientInfo":{"name":"test","version":"1.0"}
    },
    "id":1
  }'
```

3. **Actual Result**: HTTP 200 OK, session established
4. **Expected Result**: HTTP 401 Unauthorized, no session

### The Fix

**File**: `dist/FastMCP.js` (line ~1227)

```javascript
#createSession(auth) {
  // FIX: Check if authentication failed
  if (auth && typeof auth === 'object' && 'authenticated' in auth && !auth.authenticated) {
    const errorMessage = auth.error || 'Authentication failed';
    throw new Error(errorMessage);
  }

  const allowedTools = auth ? this.#tools.filter(
    (tool) => tool.canAccess ? tool.canAccess(auth) : true
  ) : this.#tools;
  return new FastMCPSession({
    auth,
    instructions: this.#options.instructions,
    logger: this.#logger,
    name: this.#options.name,
    ping: this.#options.ping,
    prompts: this.#prompts,
    resources: this.#resources,
    resourcesTemplates: this.#resourcesTemplates,
    roots: this.#options.roots,
    tools: allowedTools,
    transportType: "httpStream",
    utils: this.#options.utils,
    version: this.#options.version
  });
}
```

### Key Changes

1. **Check `authenticated` property**: Validates `auth.authenticated === false`
2. **Extract error message**: Uses `auth.error` if available
3. **Throw error**: Prevents session creation by throwing
4. **Propagate to transport**: mcp-proxy can catch and return proper HTTP 401

### Security Impact

**Before Fix**:
- ❌ Unauthenticated clients can establish sessions
- ❌ Authentication errors silently ignored
- ❌ Potential unauthorized access to tools/resources

**After Fix**:
- ✅ Authentication failures properly rejected
- ✅ Error messages propagated to client
- ✅ No session creation for failed authentication

### Test Results

**Tested with**: `fastmcp@3.19.0`, `mcp-proxy@5.8.0`

**Before fix**:
```bash
# Response: HTTP 200 OK
{"result":{"protocolVersion":"2024-11-05",...},"jsonrpc":"2.0","id":1}
```

**After fix**:
```bash
# Response: HTTP 401 Unauthorized
{"error":{"code":-32000,"message":"Invalid JWT token"},"id":1,"jsonrpc":"2.0"}
```

### Related Issues

This fix works in conjunction with mcp-proxy authentication handling (see companion issue).

### TypeScript Source Location

If this code originates from TypeScript source files, the fix should be applied to the source `.ts` file in the same location where `#createSession` is defined.

**Likely source file**: `src/FastMCP.ts` or similar

**Method signature** to locate:
```typescript
#createSession(auth: unknown): FastMCPSession
```

### Suggested Unit Test

```typescript
describe('FastMCP #createSession', () => {
  it('should throw error when auth.authenticated is false', () => {
    const fastmcp = new FastMCP({ name: 'test', version: '1.0' });
    const authResult = { authenticated: false, error: 'Test error' };

    expect(() => {
      fastmcp['#createSession'](authResult);
    }).toThrow('Test error');
  });

  it('should create session when auth.authenticated is true', () => {
    const fastmcp = new FastMCP({ name: 'test', version: '1.0' });
    const authResult = { authenticated: true, session: { userId: '123' } };

    const session = fastmcp['#createSession'](authResult);
    expect(session).toBeInstanceOf(FastMCPSession);
  });

  it('should create session when auth is null/undefined (anonymous)', () => {
    const fastmcp = new FastMCP({ name: 'test', version: '1.0' });

    const session = fastmcp['#createSession'](null);
    expect(session).toBeInstanceOf(FastMCPSession);
  });
});

---

## Issue 2: mcp-proxy - Ignores `{ authenticated: false }` from FastMCP

**Repository**: https://github.com/punkpeye/mcp-proxy
**Severity**: High - Security vulnerability
**Affects**: HTTP Stream transport with stateless authentication

### Problem Statement

mcp-proxy has **two authentication bugs**:

1. The stateless authentication check only validates **falsy** values (`if (!authResult)`), missing FastMCP's `{ authenticated: false }` pattern
2. The `createServer` catch block returns HTTP 500 for authentication errors instead of HTTP 401

This causes authentication failures to be ignored or mishandled, allowing unauthenticated clients to connect.

### Current Behavior (Bug #1)

**File**: `src/startHTTPServer.ts` (lines ~137-163)

```typescript
// Per-request authentication in stateless mode
if (stateless && authenticate) {
  try {
    const authResult = await authenticate(req);

    // ❌ BUG: Only checks falsy values
    if (!authResult) {
      res.setHeader("Content-Type", "application/json");
      res.writeHead(401).end(
        JSON.stringify({
          error: { code: -32000, message: "Unauthorized: Authentication failed" },
          id: (body as { id?: unknown })?.id ?? null,
          jsonrpc: "2.0"
        })
      );
      return true;
    }
  } catch (error) {
    // ... error handling
  }
}
```

**Problem**: FastMCP returns `{ authenticated: false, error: "..." }` which is a **truthy object**, so the check `if (!authResult)` evaluates to false and authentication proceeds.

### Current Behavior (Bug #2)

**File**: `src/startHTTPServer.ts` (lines ~200-210)

```typescript
try {
  server = await createServer(req);
} catch (error) {
  if (handleResponseError(error, res)) return true;
  // ❌ BUG: Returns HTTP 500 for ALL errors
  res.writeHead(500).end("Error creating server");
  return true;
}
```

**Problem**: When FastMCP throws authentication errors, they're caught here and returned as HTTP 500 instead of HTTP 401.

### The Fix - Part 1: Stateless Authentication Check

**File**: `src/startHTTPServer.ts` (lines ~137-163)

```typescript
// Per-request authentication in stateless mode
if (stateless && authenticate) {
  try {
    const authResult = await authenticate(req);

    // ✅ FIX: Check for both falsy AND { authenticated: false } pattern
    if (!authResult || (typeof authResult === 'object' && 'authenticated' in authResult && !authResult.authenticated)) {
      // Extract error message if available
      const errorMessage =
        authResult && typeof authResult === 'object' && 'error' in authResult && typeof authResult.error === 'string'
          ? authResult.error
          : "Unauthorized: Authentication failed";

      res.setHeader("Content-Type", "application/json");
      res.writeHead(401).end(
        JSON.stringify({
          error: {
            code: -32000,
            message: errorMessage  // ✅ Use actual error message
          },
          id: (body as { id?: unknown })?.id ?? null,
          jsonrpc: "2.0"
        })
      );
      return true;
    }
  } catch (error) {
    // Extract error details from thrown errors
    const errorMessage = error instanceof Error ? error.message : "Unauthorized: Authentication error";
    console.error("Authentication error:", error);
    res.setHeader("Content-Type", "application/json");
    res.writeHead(401).end(
      JSON.stringify({
        error: {
          code: -32000,
          message: errorMessage  // ✅ Use actual error message
        },
        id: (body as { id?: unknown })?.id ?? null,
        jsonrpc: "2.0"
      })
    );
    return true;
  }
}
```

### The Fix - Part 2: createServer Catch Block

**File**: `src/startHTTPServer.ts` (lines ~200-210)

```typescript
try {
  server = await createServer(req);
} catch (error) {
  // ✅ FIX: Detect authentication errors and return HTTP 401
  const errorMessage = error instanceof Error ? error.message : String(error);
  const isAuthError = errorMessage.includes('Authentication') ||
                     errorMessage.includes('Invalid JWT') ||
                     errorMessage.includes('Token') ||
                     errorMessage.includes('Unauthorized');

  if (isAuthError) {
    res.setHeader("Content-Type", "application/json");
    res.writeHead(401).end(JSON.stringify({
      error: {
        code: -32000,
        message: errorMessage
      },
      id: (body as { id?: unknown })?.id ?? null,
      jsonrpc: "2.0"
    }));
    return true;
  }

  if (handleResponseError(error, res)) return true;
  res.writeHead(500).end("Error creating server");
  return true;
}
```

### Key Changes

**Fix #1 - Stateless Auth Check**:
1. Check for `authResult.authenticated === false` (not just falsy)
2. Extract and return actual error message from `authResult.error`
3. Properly handle both soft failures and thrown errors

**Fix #2 - createServer Catch**:
1. Detect authentication-related errors by message content
2. Return HTTP 401 for auth errors (not 500)
3. Include actual error message in response

### Steps to Reproduce

1. Use mcp-proxy with FastMCP and stateless authentication:
```typescript
import { createServer } from 'mcp-proxy';

await createServer({
  authenticate: async (req) => {
    return { authenticated: false, error: 'Invalid JWT' };
  },
  stateless: true,
  // ... other options
});
```

2. Send request with invalid authentication
3. **Actual Result**: Session established or HTTP 500
4. **Expected Result**: HTTP 401 with error message

### Security Impact

**Before Fix**:
- ❌ Authentication failures ignored (truthy object bypass)
- ❌ Auth errors returned as HTTP 500 (misleading)
- ❌ No error message propagation to client
- ❌ Unauthenticated sessions established

**After Fix**:
- ✅ All authentication failures detected
- ✅ Proper HTTP 401 responses
- ✅ Error messages propagated to client
- ✅ No session creation for failed auth

### Test Results

**Tested with**: `mcp-proxy@5.8.0`, `fastmcp@3.19.0`

**Before fixes**:
```bash
# Response: HTTP 200 OK (session established)
event: message
data: {"result":{...},"jsonrpc":"2.0","id":1}
```

**After fixes**:
```bash
# Response: HTTP 401 Unauthorized
{"error":{"code":-32000,"message":"Invalid JWT payload"},"id":1,"jsonrpc":"2.0"}
```

### Type Safety Improvement (Optional)

The authenticate callback type should be updated to make the contract explicit:

**Current**:
```typescript
authenticate?: (request: http.IncomingMessage) => Promise<unknown>;
```

**Suggested**:
```typescript
interface AuthResult {
  authenticated: boolean;
  session?: unknown;
  error?: string;
}

authenticate?: (request: http.IncomingMessage) => Promise<unknown | AuthResult>;
```

### Related Issues

This fix works in conjunction with FastMCP's `#createSession` authentication check (see companion issue).

---

## Testing Both Fixes Together

### Test Setup

1. Install packages:
```bash
npm install fastmcp@^3.19.0 mcp-proxy@^5.8.0
```

2. Create test server with OAuth:
```typescript
import { FastMCP } from 'fastmcp';

const server = new FastMCP({
  name: 'Test Server',
  version: '1.0.0',
  authenticate: async (req) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || authHeader !== 'Bearer valid-token') {
      return {
        authenticated: false,
        error: 'Invalid or missing token'
      };
    }
    return {
      authenticated: true,
      session: { userId: 'test-user' }
    };
  }
});

await server.start({
  transportType: 'httpStream',
  httpStream: { port: 3000, endpoint: '/mcp' },
  stateless: true,
});
```

3. Test invalid authentication:
```bash
# Test 1: Invalid token
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer invalid-token" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":1}'

# Expected: HTTP 401 {"error":{"code":-32000,"message":"Invalid or missing token"},...}
```

4. Test valid authentication:
```bash
# Test 2: Valid token
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer valid-token" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":1}'

# Expected: HTTP 200 {"result":{"protocolVersion":"2024-11-05",...},...}
```

### Test Results

| Test Case | Before Fixes | After Fixes |
|-----------|-------------|-------------|
| Invalid token | ❌ HTTP 200 (session created) | ✅ HTTP 401 (rejected) |
| Missing token | ❌ HTTP 200 (session created) | ✅ HTTP 401 (rejected) |
| Valid token | ✅ HTTP 200 (session created) | ✅ HTTP 200 (session created) |
| Error message | ❌ Not propagated | ✅ Propagated to client |

---

## Implementation Notes

### For FastMCP Maintainers

- Fix location: `#createSession` method (likely in `src/FastMCP.ts`)
- Add authentication check before creating session
- Throw error for `authenticated: false` results
- Preserve existing behavior for truthy auth results
- Consider adding unit tests for authentication edge cases

### For mcp-proxy Maintainers

- Fix location #1: `handleStreamRequest` stateless auth check (likely in `src/startHTTPServer.ts`)
- Fix location #2: `createServer` catch block (same file)
- Update authentication result validation logic
- Distinguish auth errors (401) from server errors (500)
- Extract and propagate error messages
- Consider adding TypeScript types for AuthResult
- Consider adding unit tests for authentication flows

**File to modify**: `src/startHTTPServer.ts`

**Function to locate**: `handleStreamRequest` (async function, ~line 137-210)

**Search for**:
```typescript
if (stateless && authenticate) {
  try {
    const authResult = await authenticate(req);
```

### Suggested Unit Tests

```typescript
describe('mcp-proxy authentication', () => {
  describe('stateless auth check', () => {
    it('should return 401 when authResult.authenticated is false', async () => {
      const authenticate = async () => ({ authenticated: false, error: 'Invalid token' });
      const req = { method: 'POST', url: '/mcp', headers: {} };
      const res = { writeHead: jest.fn(), end: jest.fn(), setHeader: jest.fn() };

      await handleStreamRequest({ stateless: true, authenticate, req, res, ... });

      expect(res.writeHead).toHaveBeenCalledWith(401);
      expect(res.end).toHaveBeenCalledWith(
        expect.stringContaining('Invalid token')
      );
    });

    it('should return 401 when authResult is null', async () => {
      const authenticate = async () => null;
      // ... similar test
    });

    it('should proceed when authResult.authenticated is true', async () => {
      const authenticate = async () => ({ authenticated: true, session: {} });
      // ... should NOT return 401
    });
  });

  describe('createServer catch block', () => {
    it('should return 401 for authentication errors', async () => {
      const createServer = async () => { throw new Error('Authentication failed'); };
      const req = { method: 'POST', url: '/mcp' };
      const res = { writeHead: jest.fn(), end: jest.fn(), setHeader: jest.fn() };

      await handleStreamRequest({ createServer, req, res, ... });

      expect(res.writeHead).toHaveBeenCalledWith(401);
    });

    it('should return 500 for non-auth errors', async () => {
      const createServer = async () => { throw new Error('Database connection failed'); };
      // ... should return 500
    });
  });
});

---

## Version Information

**Tested Environment**:
- `fastmcp`: v3.19.0
- `mcp-proxy`: v5.8.0
- `node`: v22.14.0
- Transport: HTTP Stream
- Mode: Stateless

**Compatibility**: These fixes are backward compatible and don't change behavior for successful authentication cases.

---

## Migration Guide for Users

### Current Workarounds

If users have implemented workarounds for this issue, they should be aware:

**Common Workaround #1**: Re-throwing errors in authenticate callback
```typescript
// Workaround (can be removed after fix)
authenticate: async (req) => {
  try {
    const result = await validateToken(req);
    if (!result.valid) {
      throw new Error('Invalid token'); // ← Workaround: throwing instead of returning
    }
    return { authenticated: true, session: result.session };
  } catch (error) {
    throw error; // ← Workaround: re-throw
  }
}
```

**After Fix**: Can use proper API
```typescript
// Proper API (after fix)
authenticate: async (req) => {
  const result = await validateToken(req);
  if (!result.valid) {
    return { authenticated: false, error: 'Invalid token' }; // ✅ Proper soft failure
  }
  return { authenticated: true, session: result.session };
}
```

### Breaking Changes

**None** - These fixes only affect **failed authentication** paths. Successful authentication behavior is unchanged.

### Rollout Recommendation

1. **FastMCP fix** should be released first (or simultaneously)
2. **mcp-proxy fix** depends on FastMCP throwing errors for `authenticated: false`
3. Both fixes are safe to deploy independently (defense in depth)
4. Recommend releasing both as **patch versions** (security fix)

---

## Summary

Both fixes are **required** for proper OAuth/JWT authentication:

1. **FastMCP**: Must check `authenticated: false` and reject session creation
2. **mcp-proxy**: Must detect both soft failures and thrown auth errors, returning HTTP 401

Without both fixes, unauthenticated clients can bypass authentication and establish sessions, creating a security vulnerability in production systems using OAuth 2.1 / JWT authentication with FastMCP.

---

**Submitted by**: MCP-OAuth Framework Team
**Contact**: [Your contact information]
**Related Project**: https://github.com/[your-repo]/mcp-oauth
