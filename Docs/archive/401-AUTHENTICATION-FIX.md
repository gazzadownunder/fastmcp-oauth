# 401 Authentication Error Fix

## Problem

MCP server was returning **HTTP 500** instead of **HTTP 401** when authentication failed.

From user's error log:
```
[MCPAuthMiddleware] Authenticating request: { method: 'POST', path: undefined, hasAuthHeader: false }
[MCPAuthMiddleware] ❌ No Bearer token found
[MCPAuthMiddleware] ❌ Authentication error (statusCode: 401): Missing Authorization header with Bearer token
```

Network trace showed:
- `402 POST /mcp HTTP/1.1, JSON (application/json)`
- `843 HTTP/1.1 500 Internal Server Error` ❌

## Root Cause

### mcp-proxy Error Detection Logic

From `node_modules/@gazzadownunder/mcp-proxy/dist/stdio-CFEtr3zF.js`:

```javascript
// When createServer throws an error during stateless requests
try {
    server = await createServer(req);
} catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // CHECK: Does error message contain auth keywords?
    if (errorMessage.includes("Authentication") ||
        errorMessage.includes("Invalid JWT") ||
        errorMessage.includes("Token") ||
        errorMessage.includes("Unauthorized")) {
        // Return 401
        res.setHeader("Content-Type", "application/json");
        res.writeHead(401).end(JSON.stringify({
            error: {
                code: -32000,
                message: errorMessage
            },
            id: body?.id ?? null,
            jsonrpc: "2.0"
        }));
        return true;
    }

    // Otherwise return 500
    res.writeHead(500).end("Error creating server");
    return true;
}
```

**mcp-proxy detects authentication errors by checking if the error message contains:**
- "Authentication"
- "Invalid JWT"
- "Token"
- "Unauthorized"

### Current Error Message

Our middleware throws:
```
"Missing Authorization header with Bearer token"
```

✅ Contains "Token" → **Should trigger 401!**

### Why It Returns 500

The issue is **WHERE the error is being checked**. mcp-proxy has TWO authentication check points:

1. **Early check (in stateless mode)**: Calls `authenticate(req)` and checks result
   - If `{ authenticated: false }` → Returns 401 immediately
   - Our middleware DOES return this, but...

2. **Late check (during createServer)**: FastMCP's `#createSession` throws Error
   - Error message: "Missing Authorization header with Bearer token"
   - mcp-proxy should catch this and return 401
   - But it's returning 500 instead

## Investigation Needed

The error message **does contain "Token"**, so mcp-proxy **should** be returning 401. The fact that it's still returning 500 suggests:

1. **Option A**: FastMCP is wrapping the error in a different error that loses the message
2. **Option B**: The error is being thrown from a different code path that doesn't have the keyword check
3. **Option C**: There's a bug in how FastMCP integrates with mcp-proxy's error handling

## Solution Implemented

Modified [src/mcp/middleware.ts](../src/mcp/middleware.ts) to:

### 1. Add `statusCode` to FastMCPAuthResult

```typescript
export interface FastMCPAuthResult {
  authenticated: boolean;
  session?: UserSession;
  error?: string;
  statusCode?: number; // HTTP status code for error responses
}
```

### 2. Preserve statusCode when returning auth failures

```typescript
catch (error) {
  // Convert to FastMCP auth result with statusCode preserved
  if (error instanceof OAuthSecurityError) {
    console.log('[MCPAuthMiddleware] ❌ Authentication error (statusCode: ' + error.statusCode + '):', error.message);
    return {
      authenticated: false,
      error: error.message,
      statusCode: error.statusCode, // Preserve HTTP status code
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

### 3. Ensure error messages contain keywords

All authentication errors now include one of mcp-proxy's detection keywords:

- `"Missing Authorization header with Bearer token"` → Contains "**Token**"
- `"Unauthorized: User has no valid roles assigned"` → Contains "**Unauthorized**"
- `"Invalid JWT format"` → Contains "**Invalid JWT**"
- `"Token has expired"` → Contains "**Token**"

## Testing Needed

Since there's a server already running on port 3000 (based on error logs), you should:

1. **Test current running server**:
   ```bash
   # Test without Authorization header
   curl -v -X POST http://localhost:3000/mcp \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
   ```

2. **Check response**:
   - Expected: `HTTP/1.1 401 Unauthorized`
   - Actual: Check what you're getting now

3. **If still getting 500**: We need to investigate why mcp-proxy's keyword detection isn't working, possibly by adding debug logging to FastMCP's error handling

## Next Steps

If 401 is still not working after rebuilding:

1. Add debug logging to see EXACTLY what error is being thrown to mcp-proxy
2. Check if FastMCP is wrapping our error in a different Error object
3. Consider modifying FastMCP to preserve the original error or check if there's a configuration option we're missing

## Files Modified

- [src/mcp/middleware.ts](../src/mcp/middleware.ts:37-42,153-179) - Added statusCode to auth result
- [src/utils/errors.ts](../src/utils/errors.ts) - OAuthSecurityError with statusCode (no changes needed)
