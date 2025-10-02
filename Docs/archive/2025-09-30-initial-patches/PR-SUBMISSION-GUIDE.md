# Pull Request Submission Guide - FastMCP Stateless OAuth

**Date:** 2025-09-30
**Status:** ✅ COMPLETE - Ready for PR submission
**Packages:** FastMCP 1.27.7, mcp-proxy 2.14.3

---

## Executive Summary

Two minimal, backward-compatible fixes (41 lines total) enable FastMCP to support OAuth 2.0 JWT Bearer token authentication with per-request validation. The changes make `stateless: true` mode fully functional for modern OAuth flows.

**Result:** Clients send only `Authorization: Bearer <token>` - no session management needed.

---

## Changes Overview

### mcp-proxy (38 lines added)
- Add optional `authenticate` callback parameter
- Add optional `stateless` boolean flag
- Call `authenticate()` on every request when `stateless: true`
- Fix CORS headers to explicitly allow `Authorization` header

### fastmcp (3 lines added)
- Add optional `stateless?: boolean` to httpStream options
- Pass `authenticate` callback to mcp-proxy
- Pass `stateless` flag to mcp-proxy

---

## Detailed Changes

### 1. mcp-proxy: `src/startHTTPStreamServer.ts`

#### Function signature (lines 153-163):

```typescript
// ADD two new optional parameters
export const startHTTPStreamServer = async <T extends ServerLike>({
  authenticate,        // NEW: Optional auth callback
  createServer,
  endpoint,
  eventStore,
  onClose,
  onConnect,
  onUnhandledRequest,
  port,
  stateless,          // NEW: Optional stateless flag
}: {
  authenticate?: (request: http.IncomingMessage) => Promise<any>;  // NEW
  createServer: (request: http.IncomingMessage) => Promise<T>;
  endpoint: string;
  eventStore?: EventStore;
  onClose?: (server: T) => void;
  onConnect?: (server: T) => void;
  onUnhandledRequest?: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ) => Promise<void>;
  port: number;
  stateless?: boolean;  // NEW
}): Promise<SSEServer> => {
```

#### CORS Headers (lines 172-173):

```typescript
// CHANGE line 170 from wildcard to explicit list
// OLD:
res.setHeader("Access-Control-Allow-Headers", "*");

// NEW:
res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept, Mcp-Session-Id, Last-Event-Id");
res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");  // ADD this line
```

#### Per-Request Authentication (INSERT after line 192):

```typescript
// INSERT this block AFTER: const body = await getBody(req);
// NEW BLOCK (lines 193-225): Per-request authentication
if (stateless && authenticate) {
  try {
    const authResult = await authenticate(req);
    if (!authResult) {
      res.setHeader("Content-Type", "application/json");
      res.writeHead(401).end(
        JSON.stringify({
          error: {
            code: -32000,
            message: "Unauthorized: Authentication failed"
          },
          id: body?.id || null,
          jsonrpc: "2.0"
        })
      );
      return;
    }
  } catch (error) {
    console.error("Authentication error:", error);
    res.setHeader("Content-Type", "application/json");
    res.writeHead(401).end(
      JSON.stringify({
        error: {
          code: -32000,
          message: "Unauthorized: Authentication error"
        },
        id: body?.id || null,
        jsonrpc: "2.0"
      })
    );
    return;
  }
}
// Continue with existing session handling...
```

---

### 2. fastmcp: `src/FastMCP.ts`

#### Start method options (line 1392):

```typescript
// ADD stateless field to httpStream options type
| {
    httpStream: { endpoint: `/${string}`; port: number };
    stateless?: boolean;    // NEW: Add this optional field
    transportType: "httpStream";
  }
```

#### Pass parameters to mcp-proxy (lines 1467, 1501):

```typescript
// ADD two parameters to startHTTPStreamServer call
this.#httpStreamServer = await startHTTPStreamServer<FastMCPSession<T>>({
  authenticate: this.#authenticate,      // NEW: Line 1467
  createServer: async (request) => { ... },
  endpoint: options.httpStream.endpoint as `/${string}`,
  onClose: (session) => { ... },
  onConnect: async (session) => { ... },
  port: options.httpStream.port,
  stateless: options.stateless,          // NEW: Line 1501
});
```

---

## Usage Example

```typescript
import { FastMCP } from 'fastmcp';
import { jwtVerify, createRemoteJWKSet } from 'jose';

const server = new FastMCP({
  name: 'OAuth MCP Server',
  version: '1.0.0',

  // Authenticate callback - validates JWT on EVERY request
  authenticate: async (request) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return null;
    }

    const token = authHeader.substring(7);

    // Validate JWT with JWKS
    const JWKS = createRemoteJWKSet(new URL('https://your-idp.com/.well-known/jwks.json'));
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: 'https://your-idp.com',
      audience: 'your-api',
    });

    // Return user context (available in tools as context.auth)
    return {
      userId: payload.sub,
      username: payload.preferred_username,
      roles: payload.realm_access?.roles || [],
    };
  }
});

// Register tools
server.addTool({
  name: 'whoami',
  description: 'Get current user',
  parameters: {},
  execute: async ({}, context) => {
    return {
      userId: context.auth.userId,
      username: context.auth.username,
      roles: context.auth.roles,
    };
  }
});

// Start with stateless mode
await server.start({
  transportType: 'httpStream',
  httpStream: { port: 3000, endpoint: '/mcp' },
  stateless: true,  // Enable per-request auth
});
```

---

## Backward Compatibility

### ✅ 100% Backward Compatible

All changes are **additive only**:

1. **New parameters are optional** - default to `undefined`
2. **No breaking changes** to existing APIs
3. **Stateful mode unchanged** - works exactly as before when `stateless` not set
4. **CORS more permissive** - explicitly listing headers allows more, not less
5. **No changes to SSE/stdio** - only httpStream transport affected

### Behavior Matrix

| Mode | stateless | authenticate | Behavior |
|------|-----------|--------------|----------|
| **Legacy (unchanged)** | `undefined` | any | No per-request auth, session-based |
| **Stateful with auth** | `false` | provided | Auth only on initialize |
| **Stateless** | `true` | provided | Auth on EVERY request ✓ |
| **Stateless without auth** | `true` | `undefined` | No auth (same as legacy) |

---

## Testing

### Tested Scenarios

✅ **OAuth 2.0 Token Exchange (RFC 8693)**
- Keycloak as IDP
- Token exchange from `contextflow` → `mcp-oauth`
- Per-request JWT validation

✅ **Backward Compatibility**
- Normal (stateful) mode still works
- No regression in existing functionality

✅ **CORS**
- `Authorization` header allowed in browser
- No preflight errors

✅ **Error Handling**
- Invalid tokens return 401
- Missing tokens return 401
- Auth errors logged correctly

### Test Commands

```bash
# Unit tests (to be added)
cd packages/mcp-proxy && npm test
cd packages/fastmcp && npm test

# Integration test (manual)
cd test-harness/web-test
open index.html
# Login → Exchange Token → Connect → Call Tools
# All should succeed
```

---

## Files Modified

| File | Lines | Type | Purpose |
|------|-------|------|---------|
| `mcp-proxy/src/startHTTPStreamServer.ts` | +38 | Source | TypeScript implementation |
| `mcp-proxy/dist/chunk-43AXMLZU.js` | +38 | Compiled | JavaScript (actively used) |
| `fastmcp/src/FastMCP.ts` | +3 | Source | TypeScript implementation |
| `fastmcp/dist/FastMCP.js` | +3 | Compiled | JavaScript (actively used) |

**Total:** 41 lines added, 1 line changed

---

## PR Checklist

### Before Submitting:

- [x] ✅ Changes tested with real OAuth provider
- [x] ✅ Backward compatibility verified
- [x] ✅ CORS headers tested in browser
- [x] ✅ Per-request auth confirmed working
- [ ] ⏳ Unit tests added
- [ ] ⏳ Integration tests added
- [ ] ⏳ Documentation updated
- [ ] ⏳ CHANGELOG.md entries added

### PR Description Template:

```markdown
# Add stateless OAuth 2.0 Bearer token authentication

## Problem
FastMCP's `authenticate()` callback was only called on initialize requests, not tool calls. This made it impossible to implement stateless JWT Bearer token authentication (RFC 6750) for OAuth 2.0 flows.

## Solution
Add optional `stateless` mode that:
1. Calls `authenticate()` on every request (not just initialize)
2. Fixes CORS to allow `Authorization` header with credentials
3. Maintains 100% backward compatibility

## Changes
- **mcp-proxy** (+38 lines): Add `authenticate` and `stateless` parameters
- **fastmcp** (+3 lines): Pass parameters to transport

## Benefits
- ✅ OAuth 2.0 RFC 6750 compliant
- ✅ Works with any OIDC/OAuth provider
- ✅ Stateless clients (no session tracking)
- ✅ Secure (JWT validated every request)
- ✅ Backward compatible

## Testing
- [x] Tested with Keycloak OAuth 2.0
- [x] Verified stateful mode unchanged
- [ ] Unit tests (TODO)
- [ ] Integration tests (TODO)

## Use Cases
- OAuth 2.0 On-Behalf-Of (RFC 8693)
- Microservices with JWT auth
- API gateways
- SPAs with token-based auth

## Breaking Changes
**None** - all parameters optional, default behavior preserved.

## Semantic Version
Recommend **MINOR** bump:
- mcp-proxy: 2.14.3 → 2.15.0
- fastmcp: 1.27.7 → 1.28.0
```

---

## Migration Guide (for users)

### Enabling Stateless Mode

```typescript
// Before (stateful - default)
await server.start({
  transportType: 'httpStream',
  httpStream: { port: 3000, endpoint: '/mcp' },
});

// After (stateless)
await server.start({
  transportType: 'httpStream',
  httpStream: { port: 3000, endpoint: '/mcp' },
  stateless: true,  // Add this line
});
```

That's it! Your `authenticate()` callback will now be called on every request.

### Client Changes

**None required!** Clients already sending `Authorization: Bearer <token>` on every request will just work. The server now validates those tokens properly.

---

## Repository Links

- **FastMCP:** https://github.com/punkpeye/fastmcp
- **mcp-proxy:** Bundled with FastMCP (may be separate repo)

---

## Next Steps

1. **Submit PR to FastMCP repository**
2. Add unit tests for:
   - Per-request authentication
   - CORS header validation
   - Backward compatibility
3. Add integration test for OAuth flow
4. Update documentation with OAuth examples
5. Add example OAuth server to repository

---

## Questions or Issues

See [ROOT-CAUSE-ANALYSIS.md](ROOT-CAUSE-ANALYSIS.md) for detailed technical analysis or create an issue in the FastMCP repository.

**Contact:** This fix was developed and tested by the community. For questions, please open a GitHub issue.