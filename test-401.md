# Testing 401 Response

## Changes Made

Modified [src/mcp/middleware.ts](src/mcp/middleware.ts:37-42) to include `statusCode` in FastMCPAuthResult:

```typescript
export interface FastMCPAuthResult {
  authenticated: boolean;
  session?: UserSession;
  error?: string;
  statusCode?: number; // HTTP status code for error responses
}
```

Updated error handling to preserve statusCode when returning authentication failures:

```typescript
catch (error) {
  // Convert to FastMCP auth result with statusCode preserved
  if (error instanceof OAuthSecurityError) {
    console.log('[MCPAuthMiddleware] ❌ Authentication error (statusCode: ' + error.statusCode + '):', error.message);
    return {
      authenticated: false,
      error: error.message,
      statusCode: error.statusCode, // Preserve HTTP status code for mcp-proxy
    };
  }

  // For unknown errors, default to 500
  return {
    authenticated: false,
    error: error.message || 'Authentication failed',
    statusCode: 500,
  };
}
```

## How It Works

1. **Middleware throws OAuthSecurityError** with `statusCode: 401`
2. **Middleware catches it** and returns `{ authenticated: false, error: "message", statusCode: 401 }`
3. **mcp-proxy checks auth result** and sees `authenticated: false`
4. **mcp-proxy returns 401** using the error message from the auth result

## mcp-proxy Code (Verified)

From `node_modules/@gazzadownunder/mcp-proxy/dist/stdio-CFEtr3zF.js`:

```javascript
if (!authResult || typeof authResult === "object" && "authenticated" in authResult && !authResult.authenticated) {
    const errorMessage = authResult && typeof authResult === "object" && "error" in authResult && typeof authResult.error === "string"
        ? authResult.error
        : "Unauthorized: Authentication failed";
    res.setHeader("Content-Type", "application/json");
    res.writeHead(401).end(JSON.stringify({
        error: {
            code: -32e3,
            message: errorMessage
        },
        id: body?.id ?? null,
        jsonrpc: "2.0"
    }));
    return true;
}
```

## Test Commands

```bash
# Start server
set CONFIG_PATH=./test-harness/config/v2-keycloak-oauth-only.json
set NODE_ENV=development
node dist/test-harness/v2-test-server.js

# Test without Authorization header (should return 401)
curl -v -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

# Test with invalid token (should return 401)
curl -v -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer invalid.jwt.token" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

## Expected Result

Both requests should return:
- **HTTP 401 Unauthorized**
- JSON-RPC error response with code `-32000`
- Error message: "Missing Authorization header with Bearer token" or "Invalid token"

## Status

✅ Code changes complete
⏳ Awaiting test with server running on unoccupied port
