# WWW-Authenticate Header Requirement

## RFC 6750 Requirement

**RFC 6750 Section 3**: When a protected resource receives a request with missing or invalid authentication credentials, it **MUST** include the `WWW-Authenticate` header in the 401 response:

```
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="example",
                         error="invalid_token",
                         error_description="The access token expired"
```

## MCP OAuth 2.1 Requirement

Per the MCP specification and RFC 9728 (OAuth Protected Resource Metadata), the `WWW-Authenticate` header should point to the resource metadata endpoint:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource"
Content-Type: application/json

{
  "error": {
    "code": -32000,
    "message": "Unauthorized: Missing Authorization header with Bearer token"
  },
  "id": 1,
  "jsonrpc": "2.0"
}
```

## Current Implementation Gap

### What We Have Now

**mcp-proxy's 401 response** (from `stdio-CFEtr3zF.js`):
```javascript
res.setHeader("Content-Type", "application/json");
res.writeHead(401).end(JSON.stringify({
  error: {
    code: -32000,
    message: errorMessage
  },
  id: body?.id ?? null,
  jsonrpc: "2.0"
}));
```

**Missing:** `WWW-Authenticate` header ❌

### What RFC 6750 Requires

```javascript
res.setHeader("Content-Type", "application/json");
res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${resourceMetadataUrl}"`);
res.writeHead(401).end(JSON.stringify({
  error: {
    code: -32000,
    message: errorMessage
  },
  id: body?.id ?? null,
  jsonrpc: "2.0"
}));
```

## Problem Analysis

### Where 401 Responses Are Generated

1. **mcp-proxy (stateless auth check)**
   - Location: `handleStreamRequest` in `stdio-CFEtr3zF.js`
   - Sets: `Content-Type: application/json` ✅
   - Missing: `WWW-Authenticate` header ❌

2. **mcp-proxy (createServer error catch)**
   - Location: `handleStreamRequest` try-catch block
   - Sets: `Content-Type: application/json` ✅
   - Missing: `WWW-Authenticate` header ❌

### Who Controls the Response

- ❌ **MCPAuthMiddleware**: Returns auth result object, doesn't control HTTP response
- ❌ **FastMCP**: Throws Error, doesn't control HTTP response
- ✅ **mcp-proxy**: Controls HTTP response, but doesn't set WWW-Authenticate header

## Solutions

### Option 1: Modify mcp-proxy (Upstream Fix)

**Create a fork/PR to add WWW-Authenticate header support to mcp-proxy:**

```javascript
// In handleStreamRequest, when returning 401:
const resourceMetadataUrl = `${getFullUrl(req)}/.well-known/oauth-protected-resource`;

res.setHeader("Content-Type", "application/json");
res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${resourceMetadataUrl}"`);
res.writeHead(401).end(JSON.stringify({...}));
```

**Pros:**
- ✅ RFC 6750 compliant
- ✅ Benefits all mcp-proxy users
- ✅ Proper OAuth implementation

**Cons:**
- ❌ Requires upstream change
- ❌ May take time to merge
- ❌ Need to maintain fork until merged

### Option 2: Use Custom HTTP Handler (Workaround)

**Create a custom HTTP middleware that wraps mcp-proxy's handler:**

```typescript
import { createServer } from 'http';
import { startHTTPServer } from 'mcp-proxy';

const server = createServer(async (req, res) => {
  // Intercept 401 responses and add WWW-Authenticate header
  const originalWriteHead = res.writeHead.bind(res);

  res.writeHead = function(statusCode: number, ...args: any[]) {
    if (statusCode === 401) {
      const resourceUrl = `http://${req.headers.host || 'localhost:3000'}`;
      const metadataUrl = `${resourceUrl}/.well-known/oauth-protected-resource`;

      res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${metadataUrl}"`);
    }

    return originalWriteHead(statusCode, ...args);
  };

  // Let mcp-proxy handle the request
  await mcpProxyHandler(req, res);
});

server.listen(3000);
```

**Pros:**
- ✅ Works immediately
- ✅ No upstream dependency
- ✅ RFC 6750 compliant

**Cons:**
- ❌ Hacky workaround
- ❌ May break if mcp-proxy internals change
- ❌ Requires monkey-patching

### Option 3: Document as Known Limitation (Current State)

**Document that the implementation is non-compliant with RFC 6750:**

> **Known Limitation:** The current implementation does not include the `WWW-Authenticate` header in 401 responses as required by RFC 6750. Clients must discover the OAuth metadata endpoints via the `.well-known` URLs instead of the WWW-Authenticate header.

**Pros:**
- ✅ No code changes needed
- ✅ Works with current setup

**Cons:**
- ❌ Not RFC 6750 compliant
- ❌ Clients may not know where to get tokens
- ❌ Poor developer experience

### Option 4: Contribute to @gazzadownunder/mcp-proxy

**Since you're using `@gazzadownunder/mcp-proxy`, this appears to be a custom fork:**

1. Add WWW-Authenticate header support to this fork
2. Configure it to use the OAuth metadata URL from FastMCP's OAuth config
3. Publish updated version

**Implementation:**

```javascript
// In @gazzadownunder/mcp-proxy/src/httpstream.ts (or equivalent)

// Get OAuth config from FastMCP (passed during initialization)
const oauthConfig = options.oauth;

// When returning 401:
if (statusCode === 401 && oauthConfig?.protectedResource?.resource) {
  const metadataUrl = `${oauthConfig.protectedResource.resource}/.well-known/oauth-protected-resource`;
  res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${metadataUrl}"`);
}
```

**Pros:**
- ✅ RFC 6750 compliant
- ✅ You control the fork
- ✅ Can publish immediately
- ✅ Clean integration with FastMCP OAuth config

**Cons:**
- ❌ Requires library modification
- ❌ Need to maintain the change

## Recommended Approach

**Option 4: Modify @gazzadownunder/mcp-proxy**

Since the mcp-proxy is already a custom fork (`@gazzadownunder/mcp-proxy`), the cleanest solution is to:

1. **Add WWW-Authenticate header support** to the fork
2. **Use FastMCP's OAuth config** to get the resource metadata URL
3. **Update the 401 response** in both auth check locations

### Implementation Steps

1. **Locate the 401 response code** in `@gazzadownunder/mcp-proxy/src/httpstream.ts` (or `dist/stdio-CFEtr3zF.js`)

2. **Pass OAuth config to mcp-proxy** from FastMCP:
   ```typescript
   startHTTPServer({
     authenticate: this.#authenticate,
     createServer: ...,
     oauth: this.#options.oauth,  // ← Add this
     // ...
   });
   ```

3. **Add WWW-Authenticate header** in 401 responses:
   ```typescript
   if (statusCode === 401) {
     const resourceUrl = oauth?.protectedResource?.resource || getFullUrl(req);
     const metadataUrl = `${resourceUrl}/.well-known/oauth-protected-resource`;
     res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${metadataUrl}"`);
   }
   ```

4. **Rebuild and test**

## Current Workaround

Until the header is implemented, clients can:

1. **Discover metadata via OPTIONS request:**
   ```bash
   OPTIONS http://localhost:3000/mcp
   ```

2. **Fetch metadata directly:**
   ```bash
   GET http://localhost:3000/.well-known/oauth-protected-resource
   ```

3. **Use error message** to determine authentication is required:
   - Error message contains "Unauthorized" keyword
   - HTTP 401 status indicates auth required
   - Client can then fetch metadata

## Testing

Once implemented, verify with:

```bash
curl -v -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

**Expected response:**
```
< HTTP/1.1 401 Unauthorized
< WWW-Authenticate: Bearer resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource"
< Content-Type: application/json
<
{
  "error": {
    "code": -32000,
    "message": "Unauthorized: Missing Authorization header with Bearer token"
  },
  "id": 1,
  "jsonrpc": "2.0"
}
```

## References

- **RFC 6750**: The OAuth 2.0 Authorization Framework: Bearer Token Usage
  - Section 3: The WWW-Authenticate Response Header Field
- **RFC 9728**: OAuth 2.0 Protected Resource Metadata
- **MCP OAuth 2.1 Specification**: Resource Server Requirements
