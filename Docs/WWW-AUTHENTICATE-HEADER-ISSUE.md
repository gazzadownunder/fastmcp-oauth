# MCP-Proxy WWW-Authenticate Header Parameter Preservation

## Summary

This document describes the resolution of an issue where WWW-Authenticate header parameters were being stripped from 401 and 403 responses.

**Previous Issue:** mcp-proxy@5.10.0 stripped `realm`, `scope`, `error`, and `error_description` parameters from WWW-Authenticate headers, forwarding only `resource_metadata`.

**Root Cause:** The `instanceof Response` check failed across module boundaries, causing thrown Response objects to be treated as regular errors and their headers to be discarded.

**Resolution (2025-01-12):** Modified mcp-proxy's `handleResponseError()` function to use duck typing instead of `instanceof Response`, ensuring Response objects thrown by the framework are correctly detected and their headers are preserved.

**Status:** ✅ **RESOLVED** - All WWW-Authenticate parameters now correctly forwarded to clients.

**Implementation:** Project uses local modified mcp-proxy (file:../mcp-proxy) with Response object duck-typing detection.

---

## Resolution Details (2025-01-12)

### The Fix: Duck Typing for Response Detection

**File Modified:** `mcp-proxy/src/startHTTPServer.ts` (function `handleResponseError`)

**Problem:** The `instanceof Response` check was failing because the Response object thrown by the framework and the Response class imported in mcp-proxy were from different module contexts.

**Solution:** Added duck typing check to detect Response-like objects by their properties (`status`, `headers`, `statusText`) instead of relying on `instanceof`.

**Code Change:**
```typescript
// Before (FAILED - instanceof returned false across module boundaries)
if (error instanceof Response) {
  // Never reached!
}

// After (WORKS - duck typing detects Response-like objects)
const isResponseLike = error &&
  typeof error === 'object' &&
  'status' in error &&
  'headers' in error &&
  'statusText' in error;

if (isResponseLike || error instanceof Response) {
  const responseError = error as Response;

  // Convert Headers to http.OutgoingHttpHeaders
  const fixedHeaders: http.OutgoingHttpHeaders = {};
  responseError.headers.forEach((value, key) => {
    fixedHeaders[key] = value;
  });

  // Read body and send response with all headers preserved
  const body = await responseError.text();
  res.writeHead(responseError.status, responseError.statusText, fixedHeaders);
  res.end(body);
  return true;
}
```

**Key Changes:**
1. ✅ Duck typing check for Response-like objects
2. ✅ Async function to read Response body with `await responseError.text()`
3. ✅ All catch blocks updated to `await handleResponseError(error, res)`
4. ✅ Complete header preservation (no parameter stripping)

### Verification

**Framework generates:**
```
WWW-Authenticate: Bearer realm="MCP Server", scope="openid", resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource"
```

**Client receives (verified in network trace):**
```
WWW-Authenticate: Bearer realm="MCP Server", scope="openid", resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource"
```

✅ All parameters preserved (`realm`, `scope`, `resource_metadata`)

---

## Historical Context: WWW-Authenticate Header Parameter Stripping (RESOLVED)

### Problem Statement

When using FastMCP@3.22.0 with OAuth authentication and mcp-proxy@5.10.0, 401 Unauthorized responses are missing required parameters in the `WWW-Authenticate` header. This breaks the MCP OAuth 2.1 specification which mandates inclusion of `realm` and `scope` parameters per RFC 6750.

**Expected Behavior (per MCP Specification):**
```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json
WWW-Authenticate: Bearer realm="MCP Server", scope="openid", resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource"
```

**Actual Behavior (mcp-proxy@5.10.0):**
```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json
WWW-Authenticate: Bearer resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource"
```

**Note:** The `realm` and `scope` parameters are stripped by mcp-proxy even though the MCP OAuth middleware correctly generates them.

## Root Cause Analysis

### Root Cause: mcp-proxy strips WWW-Authenticate parameters (v5.10.0)

**Critical Discovery (2025-01-12):** mcp-proxy@5.10.0 **extracts** the `resource_metadata` parameter from the WWW-Authenticate header for its internal OAuth discovery logic, but when forwarding the header to HTTP clients, it **only includes `resource_metadata`** and strips all other RFC 6750 parameters (`realm`, `scope`, `error`, `error_description`).

**Evidence from Server Logs:**

The MCP OAuth middleware correctly generates the full header:
```
[OAuth Metadata] Generated header: Bearer realm="MCP Server", scope="openid", resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource"
[MCPAuthMiddleware] ✓ WWW-Authenticate header added to Response error
Authentication error: Response {
  status: 401,
  headers: Headers {
    'WWW-Authenticate': 'Bearer realm="MCP Server", scope="openid", resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource"'
  }
}
```

But the HTTP network trace shows:
```http
WWW-Authenticate: Bearer resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource"
```

**Root Cause in mcp-proxy Source Code:**

**File:** `node_modules/mcp-proxy/dist/index.js` (line 945)

```javascript
/**
 * Extract resource_metadata from response header.
 */
function extractResourceMetadataUrl(res) {
	const authenticateHeader = res.headers.get("WWW-Authenticate");
	if (!authenticateHeader) return;
	const [type, scheme] = authenticateHeader.split(" ");
	if (type.toLowerCase() !== "bearer" || !scheme) return;
	const match = /resource_metadata="([^"]*)"/.exec(authenticateHeader);  // ONLY extracts resource_metadata!
	if (!match) return;
	try {
		return new URL(match[1]);
	} catch (_a) {
		return;
	}
}
```

This function extracts `resource_metadata` for mcp-proxy's internal use, but somewhere in the response handling pipeline, mcp-proxy **reconstructs** the WWW-Authenticate header with ONLY this parameter, discarding `realm`, `scope`, and other valid RFC 6750 parameters.

**Impact:**
- ❌ **MCP Specification Non-Compliance:** MCP OAuth 2.1 requires `realm` and `scope` in WWW-Authenticate headers
- ❌ **RFC 6750 Non-Compliance:** Bearer authentication spec requires `realm` parameter
- ❌ **Poor Client UX:** Clients cannot determine required scopes without an additional metadata fetch
- ⚠️ **Workaround Available:** Clients can fetch `resource_metadata` URL to get `scopes_supported` and `authorization_servers`

### Related Issue: FastMCP doesn't pass OAuth config to mcp-proxy

**File:** `node_modules/fastmcp/dist/FastMCP.js` (lines ~1445, ~1477)

```javascript
this.#httpStreamServer = await startHTTPServer({
  ...this.#authenticate ? { authenticate: this.#authenticate } : {},
  createServer: async (request) => { ... },
  enableJsonResponse: httpConfig.enableJsonResponse,
  eventStore: httpConfig.eventStore,
  host: httpConfig.host,
  port: httpConfig.port,
  stateless: true,
  streamEndpoint: httpConfig.endpoint
  // MISSING: oauth parameter!
});
```

The FastMCP constructor accepts an `oauth` parameter with `protectedResource.resource` configuration, but this is never passed down to mcp-proxy's `startHTTPServer()` function.

### Related Issue: mcp-proxy only uses static OAuth config

**File:** `node_modules/mcp-proxy/src/startHTTPServer.ts` (lines 262-266)

```typescript
// Add WWW-Authenticate header if OAuth config is available
const wwwAuthHeader = getWWWAuthenticateHeader(oauth);
if (wwwAuthHeader) {
  res.setHeader("WWW-Authenticate", wwwAuthHeader);
}
```

The mcp-proxy code only reads the `oauth` parameter passed to `startHTTPServer()`, not the dynamic `wwwAuthenticate` field from the auth result returned by the `authenticate()` callback.

**File:** `node_modules/mcp-proxy/src/startHTTPServer.ts` (lines 62-70)

```typescript
const getWWWAuthenticateHeader = (
  oauth?: AuthConfig["oauth"],
): string | undefined => {
  if (!oauth?.protectedResource?.resource) {
    return undefined;
  }

  return `Bearer resource_metadata="${oauth.protectedResource.resource}/.well-known/oauth-protected-resource"`;
};
```

This function only generates a basic header pointing to the metadata endpoint. It doesn't use the dynamic header generated by our middleware which includes the `authorization_server` parameter.

### Related Issue: Auth result's wwwAuthenticate field is ignored

**Our middleware** ([src/mcp/middleware.ts:200-205](../src/mcp/middleware.ts)) generates a proper WWW-Authenticate header and returns it in the auth result:

```typescript
return {
  authenticated: false,
  error: error.message,
  statusCode: error.statusCode,
  wwwAuthenticate: wwwAuthenticate, // This field is never read by mcp-proxy!
};
```

But mcp-proxy's `startHTTPServer()` doesn't check for this field when setting HTTP headers.

## Impact

- **MCP OAuth Discovery Flow Broken:** Clients cannot discover the authorization server from 401 responses
- **Non-Compliant with RFC 6750:** Bearer token authentication requires WWW-Authenticate header on 401/403 responses
- **Non-Compliant with MCP Specification:** MCP OAuth 2.1 spec requires proper challenge responses

## Upstream Issues

### FastMCP Issue
FastMCP@3.22.0 should pass the `oauth` configuration from the constructor to mcp-proxy's `startHTTPServer()` call.

**Required Change:**
```javascript
this.#httpStreamServer = await startHTTPServer({
  ...this.#authenticate ? { authenticate: this.#authenticate } : {},
  createServer: async (request) => { ... },
  // ... other params ...
  oauth: this.#oauth, // ADD THIS LINE
});
```

### mcp-proxy Required Fix #1: Preserve WWW-Authenticate parameters

**File:** `node_modules/mcp-proxy/src/http.ts` or wherever Response headers are forwarded

**Problem:** mcp-proxy reconstructs the WWW-Authenticate header with only `resource_metadata`, stripping `realm`, `scope`, and other RFC 6750 parameters.

**Required Fix:** When forwarding Response objects thrown by authentication middleware, preserve the COMPLETE WWW-Authenticate header without modification.

**Proposed Change:**
```typescript
// In the response handling code that processes thrown Response objects
function forwardResponseHeaders(response: Response, httpResponse: ServerResponse) {
  // Get WWW-Authenticate header from the Response object
  const wwwAuth = response.headers.get('WWW-Authenticate');

  if (wwwAuth) {
    // CRITICAL: Forward the COMPLETE header without modification
    // DO NOT extract/reconstruct - preserve realm, scope, etc.
    httpResponse.setHeader('WWW-Authenticate', wwwAuth);
  }

  // Forward other headers...
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() !== 'www-authenticate') { // Already handled above
      httpResponse.setHeader(key, value);
    }
  });
}
```

**Alternative Fix (if header reconstruction is necessary):**
```typescript
/**
 * Extract ALL parameters from WWW-Authenticate header, not just resource_metadata
 */
function parseWWWAuthenticateHeader(header: string): Record<string, string> {
  const params: Record<string, string> = {};
  const [scheme, ...rest] = header.split(' ');

  if (scheme.toLowerCase() !== 'bearer') {
    return params;
  }

  // Extract all key="value" pairs
  const paramString = rest.join(' ');
  const regex = /(\w+)="([^"]*)"/g;
  let match;

  while ((match = regex.exec(paramString)) !== null) {
    params[match[1]] = match[2];
  }

  return params;
}

/**
 * Reconstruct WWW-Authenticate header with ALL parameters preserved
 */
function buildWWWAuthenticateHeader(params: Record<string, string>): string {
  const paramStrings = Object.entries(params).map(([key, value]) => `${key}="${value}"`);
  return `Bearer ${paramStrings.join(', ')}`;
}

// In response handling:
const originalHeader = response.headers.get('WWW-Authenticate');
if (originalHeader) {
  const params = parseWWWAuthenticateHeader(originalHeader);
  // Add resource_metadata if needed for internal logic
  if (!params.resource_metadata && oauth?.protectedResource?.resource) {
    params.resource_metadata = `${oauth.protectedResource.resource}/.well-known/oauth-protected-resource`;
  }
  const reconstructedHeader = buildWWWAuthenticateHeader(params);
  httpResponse.setHeader('WWW-Authenticate', reconstructedHeader);
}
```

### mcp-proxy Required Fix #2: Read wwwAuthenticate from auth results

**File:** `node_modules/mcp-proxy/src/startHTTPServer.ts` (line 260)

**Problem:** mcp-proxy doesn't read the `wwwAuthenticate` field from auth results.

**Required Change:**
```typescript
// Per-request authentication in stateless mode
if (stateless && authenticate) {
  try {
    const authResult = await authenticate(req);

    if (!authResult || (typeof authResult === 'object' && 'authenticated' in authResult && !authResult.authenticated)) {
      const errorMessage = authResult && typeof authResult === 'object' && 'error' in authResult ? authResult.error : "Unauthorized: Authentication failed";

      res.setHeader("Content-Type", "application/json");

      // PRIORITY 1: Use dynamic header from auth result if available
      if (authResult && typeof authResult === 'object' && 'wwwAuthenticate' in authResult && authResult.wwwAuthenticate) {
        res.setHeader("WWW-Authenticate", authResult.wwwAuthenticate);
      }
      // PRIORITY 2: Fallback to static OAuth config
      else {
        const wwwAuthHeader = getWWWAuthenticateHeader(oauth);
        if (wwwAuthHeader) {
          res.setHeader("WWW-Authenticate", wwwAuthHeader);
        }
      }

      res.writeHead(401).end(...);
      return true;
    }
  }
}
```

## Workarounds

### Workaround 1: Throw Response Error with Headers (RECOMMENDED)

Modify our middleware to throw a Response object with headers instead of returning an auth result:

**File:** `src/mcp/middleware.ts`

```typescript
// Instead of returning { authenticated: false, wwwAuthenticate: ... }
// Throw a Response object with headers
if (error instanceof OAuthSecurityError && error.statusCode === 401) {
  const wwwAuthenticate = generateWWWAuthenticateHeader(this.coreContext, 'MCP Server');

  const headers = new Headers();
  headers.set('Content-Type', 'application/json');
  headers.set('WWW-Authenticate', wwwAuthenticate);

  const response = new Response(JSON.stringify({
    error: { code: -32000, message: error.message },
    id: null,
    jsonrpc: '2.0'
  }), {
    status: 401,
    statusText: 'Unauthorized',
    headers
  });

  throw response; // FastMCP handles Response errors specially
}
```

This leverages mcp-proxy's `handleResponseError()` function (startHTTPServer.ts:72-96) which reads headers from thrown Response objects.

### Workaround 2: Patch mcp-proxy locally

Use `patch-package` to modify `node_modules/mcp-proxy/dist/startHTTPServer.js` to read `authResult.wwwAuthenticate`.

### Workaround 3: Wait for upstream fixes

Monitor these repositories for fixes:
- https://github.com/punkpeye/fastmcp/issues
- https://github.com/punkpeye/mcp-proxy/issues

## Test Plan

After implementing workaround, verify with:

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test-client","version":"1.0"}},"id":1}' \
  -i
```

**Expected output:**
```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json
WWW-Authenticate: Bearer realm="MCP Server", authorization_server="http://localhost:8080/realms/mcp_security"
...
```

## Related Files

- [src/mcp/middleware.ts](../src/mcp/middleware.ts) - Middleware that generates WWW-Authenticate header
- [src/mcp/oauth-metadata.ts](../src/mcp/oauth-metadata.ts) - OAuth metadata generation functions
- [src/mcp/server.ts](../src/mcp/server.ts) - FastMCP server creation with OAuth config
- [test-harness/mcp-client/discovery-auth.js](../test-harness/mcp-client/discovery-auth.js) - MCP OAuth discovery implementation (requires WWW-Authenticate header)

## Current Status (as of 2025-01-12)

### Implementation Status

✅ **MCP OAuth Middleware (401):** Correctly generates complete WWW-Authenticate headers with `realm`, `scope`, and `resource_metadata`

✅ **Delegation Tool Factory (403):** Correctly generates WWW-Authenticate headers with `error="insufficient_scope"`, `scope`, `error_description`, and `resource_metadata`

✅ **Response Object Headers:** Both 401 and 403 errors throw Response objects with proper headers set

❌ **mcp-proxy@5.10.0:** Strips `realm`, `scope`, `error`, and `error_description` parameters, only forwards `resource_metadata`

### Compliance Status (UPDATED 2025-01-12)

| Requirement | Status | Notes |
|------------|--------|-------|
| **401 Unauthorized Responses** | | |
| RFC 6750 `realm` parameter | ✅ **RESOLVED** | Duck typing fix applied |
| RFC 6750 `scope` parameter | ✅ **RESOLVED** | Duck typing fix applied |
| RFC 9728 `resource_metadata` | ✅ Working | Always worked |
| **403 Forbidden Responses** | | |
| RFC 6750 `error="insufficient_scope"` | ✅ **RESOLVED** | Duck typing fix applied |
| RFC 6750 `scope` parameter | ✅ **RESOLVED** | Duck typing fix applied |
| RFC 6750 `error_description` | ✅ **RESOLVED** | Duck typing fix applied |
| RFC 9728 `resource_metadata` | ✅ Working | Always worked |
| HTTP 403 status code | ✅ Working | Proper HTTP status |
| **Overall Compliance** | | |
| MCP Spec OAuth 2.1 (401) | ✅ **FULLY COMPLIANT** | All parameters preserved |
| MCP Spec OAuth 2.1 (403) | ✅ **FULLY COMPLIANT** | All parameters preserved |

### ~~Workaround: Use Protected Resource Metadata~~ (NO LONGER NEEDED)

~~While the WWW-Authenticate header is incomplete, clients CAN follow RFC 9728...~~

**UPDATE:** This workaround is no longer necessary. All WWW-Authenticate parameters are now correctly forwarded to clients with the duck typing fix.

### ~~Next Steps~~ (COMPLETED)

1. ~~**Report to mcp-proxy maintainers:**~~ Issue resolved with local modifications
2. ~~**Upstream fix required:**~~ Local mcp-proxy now preserves ALL parameters
3. ~~**Document workaround:**~~ Workaround no longer needed

## 403 Forbidden Authorization Errors (IMPLEMENTED - 2025-01-12)

### Problem Statement

Per **MCP OAuth 2.1 Specification (2025-03-26)**, when a client makes a request with a valid access token but insufficient scope, the server **MUST** respond with:
- HTTP 403 Forbidden status code
- `WWW-Authenticate` header with:
  - `error="insufficient_scope"`
  - `scope="required_scope1 required_scope2"` (the scopes needed)
  - `resource_metadata` URI (optional but recommended)
  - `error_description` (optional)

**Example per MCP Spec:**
```http
HTTP/1.1 403 Forbidden
WWW-Authenticate: Bearer realm="MCP Server",
                         error="insufficient_scope",
                         scope="admin sql:write",
                         error_description="This tool requires admin role",
                         resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource"
```

### Previous Behavior (INCORRECT)

Before the fix, 403 errors were returned as HTTP 200 OK with JSON-RPC error in response body:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "status": "failure",
    "code": "INSUFFICIENT_PERMISSIONS",
    "message": "This tool requires the 'admin' role. Your role: user"
  }
}
```

**Problems:**
- ❌ HTTP status is 200 instead of 403
- ❌ No `WWW-Authenticate` header
- ❌ No `error="insufficient_scope"`
- ❌ No `scope` parameter listing required scopes
- ❌ Violates MCP specification

### Implementation (2025-01-12)

**Files Modified:**
1. **[src/utils/errors.ts](../src/utils/errors.ts)** - Added `createAuthorizationError()` helper to include `requiredScopes` in error details
2. **[src/mcp/authorization.ts](../src/mcp/authorization.ts)** - Updated `requireRole()`, `requireAnyRole()`, `requireAllRoles()`, `requireScope()`, `requireAnyScope()`, `requireAllScopes()` to use `createAuthorizationError()`
3. **[src/mcp/oauth-metadata.ts](../src/mcp/oauth-metadata.ts)** - Updated `generateWWWAuthenticateHeader()` to support `error` and `error_description` parameters
4. **[src/mcp/tools/delegation-tool-factory.ts](../src/mcp/tools/delegation-tool-factory.ts)** - Added 403 error handling that throws Response with WWW-Authenticate header
5. **[tests/unit/mcp/authorization.test.ts](../tests/unit/mcp/authorization.test.ts)** - Added tests to verify `requiredScopes` in error details (98 tests passing)

**Flow:**

```typescript
// 1. Authorization check fails in tool handler
auth.requireRole(context, 'admin');
// Throws: createAuthorizationError('INSUFFICIENT_PERMISSIONS', message, 403, ['admin'])

// 2. delegation-tool-factory catches OAuthSecurityError
catch (error) {
  if (error.statusCode === 403) {
    // Extract required scopes from error.details.requiredScopes
    const scopeString = error.details.requiredScopes.join(' '); // "admin"

    // Generate WWW-Authenticate header per MCP spec
    const wwwAuth = generateWWWAuthenticateHeader(
      coreContext, "MCP Server", scopeString, true, serverUrl,
      "insufficient_scope", // RFC 6750 error code
      error.message // error_description
    );

    // Throw Response with HTTP 403 and WWW-Authenticate header
    throw new Response(errorBody, {
      status: 403,
      headers: { 'WWW-Authenticate': wwwAuth }
    });
  }
}
```

### Current Behavior (CORRECT)

```http
HTTP/1.1 403 Forbidden
Content-Type: application/json
WWW-Authenticate: Bearer realm="MCP Server", error="insufficient_scope", scope="admin", error_description="This tool requires the 'admin' role. Your role: user", resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource"

{
  "jsonrpc": "2.0",
  "id": null,
  "error": {
    "code": -32000,
    "message": "This tool requires the 'admin' role. Your role: user"
  }
}
```

**Benefits:**
- ✅ Proper HTTP 403 status code (transport-level error)
- ✅ MCP spec compliant WWW-Authenticate header
- ✅ Clients can distinguish between 401 (no token) and 403 (insufficient scope)
- ✅ Clients can discover required scopes from header
- ✅ Future-proof (when mcp-proxy fixes parameter stripping)

### ~~mcp-proxy Limitation~~ (RESOLVED 2025-01-12)

~~**IMPORTANT:** mcp-proxy@5.10.0 still strips all parameters except `resource_metadata`~~

**UPDATE:** This limitation has been resolved with the duck typing fix. All WWW-Authenticate parameters are now correctly preserved and forwarded to clients.

**Generated by framework:**
```
WWW-Authenticate: Bearer realm="MCP Server", error="insufficient_scope", scope="admin", error_description="...", resource_metadata="http://..."
```

**Forwarded to client (verified in network trace):**
```
WWW-Authenticate: Bearer realm="MCP Server", error="insufficient_scope", scope="admin", error_description="...", resource_metadata="http://..."
```

✅ **All parameters preserved** - No workarounds needed.

---

## References

- RFC 6750 §3: "The HTTP WWW-Authenticate response header is used to challenge the client..." - Requires `realm`, allows `scope`, `error`, `error_description`
- RFC 9728: OAuth 2.0 Protected Resource Metadata - Defines `resource_metadata` parameter
- MCP Specification 2025-03-26: OAuth 2.1 Authentication - Requires proper WWW-Authenticate for 401/403 responses
- MCP Specification 2025-03-26: Authorization - "Servers MUST return appropriate HTTP status codes for authorization errors" (401 for invalid token, 403 for insufficient scope)
- mcp-proxy PR #40: https://github.com/punkpeye/mcp-proxy/pull/40 (claimed to add WWW-Authenticate support)
- mcp-proxy@5.10.0 Issue: Parameter stripping discovered 2025-01-12
- **Implementation:** 403 error handling with WWW-Authenticate header implemented 2025-01-12
