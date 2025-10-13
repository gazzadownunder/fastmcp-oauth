# WWW-Authenticate Header Implementation

## Summary

Added `WWW-Authenticate` header support to 401 Unauthorized responses per RFC 6750 and MCP OAuth specification.

## Changes Made

### 1. mcp-proxy Package Updates

#### `node_modules/mcp-proxy/src/authentication.ts`
- **Added** `realm`, `authorizationServer`, and `scope` to `AuthConfig` interface
- **Updated** `getUnauthorizedResponse()` to generate and include `WWW-Authenticate` header
- **Format**: `Bearer realm="MCP Server", authorization_server="https://auth.example.com", scope="mcp:read"`

#### `node_modules/mcp-proxy/src/startHTTPServer.ts`
- **Updated** stateless authentication error handling (lines 150-157)
- **Updated** authentication exception handling (lines 174-182)
- **Added** extraction of `wwwAuthenticate` from authentication results
- **Added** `WWW-Authenticate` header to all 401 responses

### 2. MCP OAuth Framework Updates

#### `src/mcp/middleware.ts`
- **Added** `wwwAuthenticate` field to `FastMCPAuthResult` interface
- **Added** `CoreContext` parameter to `MCPAuthMiddleware` constructor (optional)
- **Imported** `generateWWWAuthenticateHeader` from `oauth-metadata.js`
- **Updated** error handling to generate and include `WWW-Authenticate` header for 401 errors
- **Added** fallback to basic header if generation fails

## HTTP Response Format

### Before (Missing WWW-Authenticate)
```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json

{
  "error": {
    "code": -32000,
    "message": "Unauthorized: Authentication failed"
  },
  "id": null,
  "jsonrpc": "2.0"
}
```

### After (With WWW-Authenticate)
```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json
WWW-Authenticate: Bearer realm="MCP Server", authorization_server="https://auth.example.com"

{
  "error": {
    "code": -32000,
    "message": "Unauthorized: Authentication failed"
  },
  "id": null,
  "jsonrpc": "2.0"
}
```

## WWW-Authenticate Header Format

Per RFC 6750 Section 3 and MCP specification:

```
WWW-Authenticate: Bearer realm="<realm>", authorization_server="<issuer>", scope="<scopes>"
```

### Parameters

| Parameter | Required | Description | Example |
|-----------|----------|-------------|---------|
| `realm` | Yes | Protection space | `"MCP Server"` |
| `authorization_server` | Optional | IDP issuer URL | `"https://auth.example.com"` |
| `scope` | Optional | Required scopes | `"mcp:read mcp:write"` |

### Examples

**Minimal (realm only):**
```
WWW-Authenticate: Bearer realm="MCP Server"
```

**With authorization server:**
```
WWW-Authenticate: Bearer realm="MCP Server", authorization_server="http://localhost:8080/realms/mcp_security"
```

**With scopes:**
```
WWW-Authenticate: Bearer realm="MCP Server", authorization_server="https://auth.example.com", scope="mcp:read mcp:write"
```

## OAuth Discovery Flow

When a client receives a 401 with `WWW-Authenticate` header:

1. **Extract authorization_server** from header
2. **Discover OAuth endpoints:**
   ```
   GET <authorization_server>/.well-known/oauth-authorization-server
   ```
3. **Initiate OAuth flow** using discovered `authorization_endpoint`
4. **Exchange code for token** at `token_endpoint`
5. **Retry request** with `Authorization: Bearer <access_token>`

## Compliance

### RFC 6750 (OAuth 2.0 Bearer Token Usage)

✅ **Section 3 - WWW-Authenticate Response Header Field:**
> "If the protected resource request does not include authentication credentials or does not contain an access token that enables access to the protected resource, the resource server MUST include the HTTP "WWW-Authenticate" response header field"

### MCP OAuth Specification

✅ **Authorization Discovery:**
> "When a request fails authentication, the server must return a WWW-Authenticate header directing the client to the authorization server"

## Testing

### Test 401 Response

**Request:**
```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' \
  -i
```

**Expected Response:**
```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json
WWW-Authenticate: Bearer realm="MCP Server", authorization_server="http://localhost:8080/realms/mcp_security"

{
  "error": {
    "code": -32000,
    "message": "Unauthorized: Missing Authorization header with Bearer token"
  },
  "id": null,
  "jsonrpc": "2.0"
}
```

### Verify Header

**Using curl:**
```bash
curl -i http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' \
  | grep -i "www-authenticate"
```

**Expected Output:**
```
WWW-Authenticate: Bearer realm="MCP Server", authorization_server="http://localhost:8080/realms/mcp_security"
```

## Implementation Details

### mcp-proxy Authentication Flow

1. Client sends request without Bearer token
2. `authenticate()` callback returns `{ authenticated: false, wwwAuthenticate: "..." }`
3. mcp-proxy extracts `wwwAuthenticate` from result
4. mcp-proxy sets `WWW-Authenticate` header in 401 response
5. Client receives response with header

### MCPAuthMiddleware Integration

1. `MCPAuthMiddleware.authenticate()` catches authentication error
2. If error is 401 and `coreContext` provided:
   - Calls `generateWWWAuthenticateHeader(coreContext, realm, scope)`
   - Returns `{ authenticated: false, wwwAuthenticate: "...", statusCode: 401 }`
3. If header generation fails, uses fallback: `Bearer realm="MCP Server"`

### Backward Compatibility

- ✅ `wwwAuthenticate` field is **optional** in `FastMCPAuthResult`
- ✅ If not provided, mcp-proxy uses default: `Bearer realm="MCP Server"`
- ✅ Existing authentication flows continue to work

## Configuration

### Enable WWW-Authenticate Header

**Option 1: Pass CoreContext to Middleware (Recommended)**
```typescript
import { MCPAuthMiddleware } from './mcp/middleware.js';

const middleware = new MCPAuthMiddleware(
  authService,
  coreContext  // Enables WWW-Authenticate header generation
);
```

**Option 2: Manual Header in Error**
```typescript
throw {
  message: 'Unauthorized',
  statusCode: 401,
  wwwAuthenticate: 'Bearer realm="MCP Server", authorization_server="https://auth.example.com"'
};
```

## References

- [RFC 6750 - OAuth 2.0 Bearer Token Usage](https://datatracker.ietf.org/doc/html/rfc6750)
- [RFC 9728 - OAuth 2.0 Protected Resource Metadata](https://datatracker.ietf.org/doc/html/rfc9728)
- [MCP Authorization Specification](https://modelcontextprotocol.io/specification/draft/basic/authorization)

## Build Instructions

### Rebuild mcp-proxy
```bash
cd node_modules/mcp-proxy
npm install
npm run build
cd ../..
```

### Rebuild Main Project
```bash
npm run build
```

### Test Changes
```bash
# Start server
npm start

# Test 401 response
curl -i http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

## Status

✅ **Implementation Complete**
✅ **mcp-proxy Updated**
✅ **Framework Updated**
✅ **Built Successfully**
⏳ **Testing Required**
