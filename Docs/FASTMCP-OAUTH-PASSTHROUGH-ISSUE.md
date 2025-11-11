# FastMCP OAuth Config Passthrough Issue

## Issue Summary

FastMCP collects OAuth configuration via the constructor but **does not pass it to mcp-proxy's `startHTTPServer()`**. This prevents mcp-proxy from generating RFC 6750 compliant `WWW-Authenticate` headers in 401 Unauthorized responses, breaking the MCP OAuth 2.1 discovery flow.

## Impact

**Severity:** High - Breaks OAuth discovery specification compliance

**Affected Versions:**
- FastMCP: v3.22.0 and earlier
- MCP-Proxy: All versions (code is ready, just needs config)

**User Impact:**
- MCP clients cannot discover OAuth authorization server from 401 responses
- Non-compliant with RFC 6750 §3 (Bearer Token WWW-Authenticate requirement)
- Non-compliant with MCP OAuth 2.1 Specification (2025-03-26)
- OAuth discovery flow fails at first step

## Root Cause Analysis

### Background

**mcp-proxy PRs #40 and #41** (merged Oct 12, 2025) added support for generating `WWW-Authenticate` headers in 401 responses when an `oauth` configuration is provided to `startHTTPServer()`.

**FastMCP PR #184** (merged Oct 2, 2025) added stateless OAuth support with `authenticate` callback, but did not include oauth config passthrough.

### The Missing Link

**File:** `fastmcp/src/FastMCP.ts`

**Lines:** 2375-2419 (stateless mode), 2421-2467 (regular mode)

**Current Code (Stateless Mode):**
```typescript
this.#httpStreamServer = await startHTTPServer<FastMCPSession<T>>({
  ...(this.#authenticate ? { authenticate: this.#authenticate } : {}),
  createServer: async (request) => { ... },
  enableJsonResponse: httpConfig.enableJsonResponse,
  eventStore: httpConfig.eventStore,
  host: httpConfig.host,
  onClose: async () => { ... },
  onConnect: async () => { ... },
  onUnhandledRequest: async (req, res) => {
    await this.#handleUnhandledRequest(req, res, true, httpConfig.host);
  },
  port: httpConfig.port,
  stateless: true,
  streamEndpoint: httpConfig.endpoint,
  // ❌ MISSING: oauth parameter
});
```

**Current Code (Regular Mode):**
```typescript
this.#httpStreamServer = await startHTTPServer<FastMCPSession<T>>({
  ...(this.#authenticate ? { authenticate: this.#authenticate } : {}),
  createServer: async (request) => { ... },
  enableJsonResponse: httpConfig.enableJsonResponse,
  eventStore: httpConfig.eventStore,
  host: httpConfig.host,
  onClose: async (session) => { ... },
  onConnect: async (session) => { ... },
  onUnhandledRequest: async (req, res) => {
    await this.#handleUnhandledRequest(req, res, false, httpConfig.host);
  },
  port: httpConfig.port,
  stateless: httpConfig.stateless,
  streamEndpoint: httpConfig.endpoint,
  // ❌ MISSING: oauth parameter
});
```

### Why This is a Problem

1. **FastMCP HAS the oauth config**: Available as `this.#options.oauth`
2. **FastMCP USES the oauth config**: Serves `/.well-known/oauth-protected-resource` metadata in `#handleUnhandledRequest`
3. **mcp-proxy SUPPORTS oauth parameter**: Added in PRs #40 and #41
4. **mcp-proxy GENERATES WWW-Authenticate headers**: When oauth config is provided
5. **FastMCP DOESN'T PASS oauth to mcp-proxy**: Missing parameter in both startHTTPServer calls

**Result:** mcp-proxy never receives oauth config, so it cannot generate WWW-Authenticate headers.

## Proposed Solution

### Code Changes Required

**File:** `fastmcp/src/FastMCP.ts`

**Change 1 - Stateless Mode (Line ~2415):**
```typescript
// BEFORE
  port: httpConfig.port,
  stateless: true,
  streamEndpoint: httpConfig.endpoint,
});

// AFTER
  port: httpConfig.port,
  stateless: true,
  streamEndpoint: httpConfig.endpoint,
  ...(this.#options.oauth?.enabled ? { oauth: this.#options.oauth } : {}),
});
```

**Change 2 - Regular Mode (Line ~2461):**
```typescript
// BEFORE
  port: httpConfig.port,
  stateless: httpConfig.stateless,
  streamEndpoint: httpConfig.endpoint,
});

// AFTER
  port: httpConfig.port,
  stateless: httpConfig.stateless,
  streamEndpoint: httpConfig.endpoint,
  ...(this.#options.oauth?.enabled ? { oauth: this.#options.oauth } : {}),
});
```

### Why Use Conditional Spread?

```typescript
...(this.#options.oauth?.enabled ? { oauth: this.#options.oauth } : {})
```

**Rationale:**
1. **Backward Compatibility**: Servers without OAuth config won't break
2. **Explicit Opt-In**: Only passes oauth when explicitly enabled
3. **Type Safety**: Avoids passing undefined to mcp-proxy
4. **Consistent Pattern**: Matches existing `authenticate` parameter pattern

## Expected Behavior After Fix

### Before Fix

**Request:**
```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test-client","version":"1.0"}},"id":1}' \
  -i
```

**Response:**
```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json

{"error":{"code":-32000,"message":"Unauthorized: Authentication failed"},"id":1,"jsonrpc":"2.0"}
```

❌ **Missing:** `WWW-Authenticate` header

### After Fix

**Request:** Same as above

**Response:**
```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json
WWW-Authenticate: Bearer resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource"

{"error":{"code":-32000,"message":"Unauthorized: Authentication failed"},"id":1,"jsonrpc":"2.0"}
```

✅ **Present:** `WWW-Authenticate` header with metadata URL

### MCP OAuth Discovery Flow (After Fix)

**Step 1:** Client attempts unauthenticated request
```javascript
const response = await fetch('http://localhost:3000/mcp', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', ... })
});
```

**Step 2:** Server returns 401 with WWW-Authenticate header
```http
WWW-Authenticate: Bearer resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource"
```

**Step 3:** Client parses header to discover metadata URL
```javascript
const wwwAuth = response.headers.get('WWW-Authenticate');
// wwwAuth = 'Bearer resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource"'
```

**Step 4:** Client fetches protected resource metadata
```javascript
const metadata = await fetch('http://localhost:3000/.well-known/oauth-protected-resource');
// Returns: { resource: "...", authorizationServers: [...], ... }
```

**Step 5:** Client fetches authorization server metadata
```javascript
const authServer = metadata.authorizationServers[0];
const authMetadata = await fetch(`${authServer}/.well-known/oauth-authorization-server`);
// Returns: { issuer: "...", authorization_endpoint: "...", token_endpoint: "...", ... }
```

**Step 6:** Client performs OAuth authorization code flow with PKCE

**Step 7:** Client retries MCP request with obtained access token
```javascript
const response = await fetch('http://localhost:3000/mcp', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`
  },
  body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', ... })
});
// Returns: 200 OK with MCP capabilities
```

## Testing Plan

### Prerequisites

1. **Fork FastMCP repository** (already done per user)
2. **Install dependencies**: `npm install`
3. **Make code changes** as described in "Proposed Solution"
4. **Build FastMCP**: `npm run build`
5. **Link locally**: `npm link` in fastmcp directory

### Test Setup

**In your MCP-OAuth project:**

```bash
# Link to your local FastMCP build
npm uninstall fastmcp
npm link fastmcp

# Rebuild your project
npm run build

# Start test server
node dist/test-harness/v2-test-server.js
```

### Test Case 1: Verify WWW-Authenticate Header

**Test Command:**
```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test-client","version":"1.0"}},"id":1}' \
  -i
```

**Expected Output:**
```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json
WWW-Authenticate: Bearer resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource"
Date: ...
Connection: keep-alive
Transfer-Encoding: chunked

{"error":{"code":-32000,"message":"Unauthorized: Missing Authorization header with Bearer token"},"id":1,"jsonrpc":"2.0"}
```

**Success Criteria:**
- ✅ HTTP status is 401
- ✅ `WWW-Authenticate` header is present
- ✅ Header value contains `Bearer resource_metadata="`
- ✅ Metadata URL points to `/.well-known/oauth-protected-resource`

### Test Case 2: Verify OAuth Metadata Endpoints Still Work

**Test Command 1 - Protected Resource Metadata:**
```bash
curl -X GET http://localhost:3000/.well-known/oauth-protected-resource
```

**Expected Output:**
```json
{
  "resource": "http://localhost:3000",
  "authorization_servers": ["http://localhost:8080/realms/mcp_security"],
  "scopes_supported": ["mcp:read", "mcp:write", "mcp:admin"],
  "bearer_methods_supported": ["header"],
  "resource_signing_alg_values_supported": ["RS256"],
  "resource_documentation": "http://localhost:3000/docs",
  "accept_types_supported": ["application/json", "text/event-stream"]
}
```

**Test Command 2 - Authorization Server Metadata:**
```bash
curl -X GET http://localhost:3000/.well-known/oauth-authorization-server
```

**Expected Output:**
```json
{
  "issuer": "http://localhost:8080/realms/mcp_security",
  "authorization_endpoint": "http://localhost:8080/realms/mcp_security/protocol/openid-connect/auth",
  "token_endpoint": "http://localhost:8080/realms/mcp_security/protocol/openid-connect/token",
  "jwks_uri": "http://localhost:8080/realms/mcp_security/protocol/openid-connect/certs",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "code_challenge_methods_supported": ["S256"],
  "scopes_supported": ["openid", "profile", "email"],
  "token_endpoint_auth_methods_supported": ["client_secret_basic", "client_secret_post"]
}
```

**Success Criteria:**
- ✅ Both endpoints return 200 OK
- ✅ JSON structure is correct
- ✅ No regression in metadata serving

### Test Case 3: MCP OAuth Discovery Flow (End-to-End)

**Use the test client:**

```bash
# Open browser to test client
start http://localhost:3000/test-harness/mcp-client/index.html
```

**Steps:**
1. Click "MCP OAuth Discovery" button
2. Observe browser console logs
3. Verify discovery flow completes:
   - ✅ Initial request returns 401 with WWW-Authenticate header
   - ✅ Client parses header and fetches metadata
   - ✅ Client discovers authorization endpoint
   - ✅ Client redirects to Keycloak for authentication
   - ✅ After login, client exchanges code for token
   - ✅ Client retries MCP request with token
   - ✅ MCP session initialized successfully

### Test Case 4: Backward Compatibility (No OAuth Config)

**Create minimal server without OAuth:**

```javascript
import { FastMCP } from 'fastmcp';

const server = new FastMCP({
  name: 'Test Server',
  version: '1.0.0',
  // No oauth config
});

await server.start({
  transportType: 'httpStream',
  httpStream: { port: 3001 }
});
```

**Test Command:**
```bash
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":1}' \
  -i
```

**Expected Output:**
```http
HTTP/1.1 200 OK
Content-Type: application/json

{"jsonrpc":"2.0","result":{...},"id":1}
```

**Success Criteria:**
- ✅ Server starts without errors
- ✅ No `WWW-Authenticate` header (oauth not configured)
- ✅ Server responds normally (no authentication required)
- ✅ No console errors or warnings

## Dependencies

### Upstream PRs (Already Merged)

1. **mcp-proxy PR #40**: "Fix: Missing WWW-Authenticate Header"
   - Status: ✅ Merged Oct 12, 2025
   - Added: `getWWWAuthenticateHeader()` function
   - Added: `oauth` parameter to `startHTTPServer()`
   - Added: WWW-Authenticate header in 401 responses

2. **mcp-proxy PR #41**: "Fix: www-authenticate fix"
   - Status: ✅ Merged Oct 12, 2025
   - Refined WWW-Authenticate header generation

3. **FastMCP PR #184**: "FastMCP Stateless OAuth"
   - Status: ✅ Merged Oct 2, 2025
   - Added: `authenticate` callback support
   - Added: Stateless mode for per-request authentication

4. **FastMCP PR #188**: "Fix: createSession always creates session"
   - Status: ✅ Merged Oct 15, 2025
   - Fixed: Session creation for failed authentication

### This Fix Completes the Integration

**Timeline:**
- Oct 2: FastMCP gains stateless OAuth (PR #184)
- Oct 12: mcp-proxy gains WWW-Authenticate support (PRs #40, #41)
- Oct 15: FastMCP fixes session creation (PR #188)
- **[PENDING]**: FastMCP passes oauth config to mcp-proxy (PR #189)

## RFC Compliance

### RFC 6750 §3 - The WWW-Authenticate Response Header Field

**Requirement:**
> If the protected resource request does not include authentication
> credentials or does not contain an access token that enables access
> to the protected resource, the resource server MUST include the HTTP
> "WWW-Authenticate" response header field; it MAY include it in
> response to other conditions as well.

**Current Status:** ❌ Non-compliant (header missing)

**After Fix:** ✅ Compliant

### MCP OAuth 2.1 Specification (2025-03-26)

**Section:** Authorization Server Location

**Requirement:**
> When a client attempts to access a protected MCP server without
> authentication, the server MUST respond with HTTP 401 and include
> a WWW-Authenticate header indicating the authorization server location.

**Current Status:** ❌ Non-compliant

**After Fix:** ✅ Compliant

## Related Files

### In FastMCP Repository

- `src/FastMCP.ts` - Main FastMCP class (REQUIRES CHANGES)
- Lines 2375-2419 - Stateless mode startHTTPServer call
- Lines 2421-2467 - Regular mode startHTTPServer call

### In MCP-OAuth Repository

- `src/mcp/middleware.ts` - Middleware that generates WWW-Authenticate header (✅ Working)
- `src/mcp/oauth-metadata.ts` - OAuth metadata generation (✅ Working)
- `test-harness/mcp-client/discovery-auth.js` - MCP OAuth discovery implementation (✅ Ready to test)
- `Docs/WWW-AUTHENTICATE-HEADER-ISSUE.md` - Original issue documentation

### In mcp-proxy Repository

- `src/startHTTPServer.ts` - HTTP server with WWW-Authenticate support (✅ Working)
- `src/authentication.ts` - Authentication middleware (✅ Working)

## Pull Request Checklist

Before submitting PR #189 to FastMCP:

- [ ] Fork FastMCP repository (✅ Already done)
- [ ] Create feature branch: `git checkout -b feat/oauth-config-passthrough`
- [ ] Make code changes to `src/FastMCP.ts` (both stateless and regular mode)
- [ ] Test all 4 test cases above
- [ ] Verify WWW-Authenticate header is present in 401 responses
- [ ] Verify backward compatibility (servers without oauth config)
- [ ] Verify OAuth discovery flow works end-to-end
- [ ] Run existing FastMCP tests: `npm test`
- [ ] Update CHANGELOG.md (if FastMCP uses one)
- [ ] Commit changes with clear message
- [ ] Push to your fork
- [ ] Create PR with descriptive title and body (template below)

## PR Template

**Title:**
```
feat: Pass OAuth config to mcp-proxy for WWW-Authenticate headers
```

**Description:**
```markdown
## Problem

FastMCP collects OAuth configuration via the constructor but does not pass it to mcp-proxy's `startHTTPServer()`. This prevents mcp-proxy from generating RFC 6750 compliant `WWW-Authenticate` headers in 401 Unauthorized responses.

## Impact

- Breaks MCP OAuth 2.1 discovery flow (clients cannot discover authorization server)
- Non-compliant with RFC 6750 §3 (Bearer Token WWW-Authenticate requirement)
- mcp-proxy has WWW-Authenticate support (PRs #40, #41), but cannot use it without oauth config

## Solution

Pass `this.#options.oauth` to `startHTTPServer()` in both stateless and regular HTTP Stream modes.

### Changes

**File:** `src/FastMCP.ts`

**Stateless Mode (Line ~2415):**
```typescript
  port: httpConfig.port,
  stateless: true,
  streamEndpoint: httpConfig.endpoint,
+ ...(this.#options.oauth?.enabled ? { oauth: this.#options.oauth } : {}),
});
```

**Regular Mode (Line ~2461):**
```typescript
  port: httpConfig.port,
  stateless: httpConfig.stateless,
  streamEndpoint: httpConfig.endpoint,
+ ...(this.#options.oauth?.enabled ? { oauth: this.#options.oauth } : {}),
});
```

## Testing

### Test Case 1: WWW-Authenticate Header Present

**Before:**
```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json

{"error":{"code":-32000,"message":"Unauthorized"},"id":1,"jsonrpc":"2.0"}
```

**After:**
```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json
WWW-Authenticate: Bearer resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource"

{"error":{"code":-32000,"message":"Unauthorized"},"id":1,"jsonrpc":"2.0"}
```

### Test Case 2: Backward Compatibility

Servers without OAuth config continue to work normally (no header, no errors).

### Test Case 3: OAuth Discovery Flow

Tested end-to-end with MCP OAuth discovery client - flow completes successfully.

## Dependencies

Requires:
- mcp-proxy PR #40 (✅ Merged Oct 12, 2025)
- mcp-proxy PR #41 (✅ Merged Oct 12, 2025)

Completes integration chain:
- FastMCP PR #184 (stateless OAuth) ✅ Merged Oct 2, 2025
- FastMCP PR #188 (session creation fix) ✅ Merged Oct 15, 2025
- **This PR** (oauth config passthrough) ⏳ Pending

## RFC Compliance

- ✅ RFC 6750 §3 - WWW-Authenticate header in 401 responses
- ✅ RFC 9728 - OAuth 2.0 Protected Resource Metadata
- ✅ MCP OAuth 2.1 Specification (2025-03-26)

## Breaking Changes

None - change is backward compatible.

## Related Issues

Closes: [Issue #XXX] (if applicable)
```

## Notes for Testing

1. **Use your local FastMCP fork** - You already have it
2. **Test with real Keycloak** - Use existing test-harness setup
3. **Check browser console** - Discovery flow logs are helpful
4. **Verify header with curl** - Easier to see raw HTTP headers
5. **Test both modes** - Stateless and regular (though you use stateless)

## Success Metrics

**Before PR:**
- ❌ WWW-Authenticate header missing from 401 responses
- ❌ MCP OAuth discovery flow fails at step 1
- ❌ Non-compliant with RFC 6750 and MCP spec

**After PR:**
- ✅ WWW-Authenticate header present in 401 responses
- ✅ MCP OAuth discovery flow completes end-to-end
- ✅ Fully compliant with RFC 6750 and MCP spec
- ✅ Backward compatible (no breaking changes)

## Timeline

1. **Test locally** - Verify all test cases pass
2. **Create PR #189** - Submit to FastMCP repository
3. **Wait for review** - FastMCP maintainers review and merge
4. **New FastMCP version published** - npm version bump
5. **Update MCP-OAuth** - Upgrade to new FastMCP version
6. **Remove workarounds** - Clean up any temporary fixes
7. **Celebrate** - MCP OAuth discovery flow working! 🎉
