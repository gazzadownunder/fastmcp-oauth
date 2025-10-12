# 401 Unauthorized Response - Final Solution

## Problem Summary

MCP server was returning **HTTP 500** instead of **HTTP 401** when authentication failed, despite error messages containing detection keywords.

## Root Cause

### The Complete Authentication Flow

```
1. Client → POST /mcp (no Authorization header)
2. mcp-proxy → Calls authenticate(req)
3. MCPAuthMiddleware → Returns { authenticated: false, error: "...", statusCode: 401 }
4. mcp-proxy → Checks if authenticated === false → Should return 401
5. BUT ALSO: mcp-proxy → Calls createServer(req)
6. FastMCP.createServer → Calls authenticate AGAIN
7. FastMCP.#createSession → Throws new Error(error.message)
8. mcp-proxy → Catches error, checks if message contains keywords
9. mcp-proxy → Returns 401 OR 500 depending on keyword detection
```

### The Issue

**mcp-proxy's keyword detection** looks for these EXACT strings in the error message:
- "Authentication"
- "Invalid JWT"
- "Token"
- "Unauthorized"

**Our original error messages:**
- ❌ `"Missing Authorization header with Bearer token"` - "Token" at the END
- ❌ `"Invalid JWT format"` - Could be truncated
- ❌ `"Token has expired"` - "Token" at the START but might be missed

**The Problem:** If error message transformation, truncation, or wrapping occurs, the keyword might not be detected, resulting in 500 instead of 401.

## The Solution

**Prefix ALL 401 authentication error messages with a detection keyword:**

### Changes Made

#### 1. Middleware Errors ([src/mcp/middleware.ts](../src/mcp/middleware.ts))

```typescript
// BEFORE:
throw createSecurityError(
  'MISSING_TOKEN',
  'Missing Authorization header with Bearer token',
  401
);

// AFTER:
throw createSecurityError(
  'MISSING_TOKEN',
  'Unauthorized: Missing Authorization header with Bearer token',
  401
);
```

#### 2. JWT Validator Errors ([src/core/jwt-validator.ts](../src/core/jwt-validator.ts))

```typescript
// Invalid JWT Format (Line 204)
// BEFORE: 'Invalid JWT format'
// AFTER:  'Invalid JWT: Token format is invalid'

// Token Not Yet Valid (Line 335)
// BEFORE: 'Token not yet valid'
// AFTER:  'Unauthorized: Token not yet valid'

// Token Too Old (Line 340)
// BEFORE: 'Token exceeds maximum age'
// AFTER:  'Unauthorized: Token exceeds maximum age'

// Token Expired (Line 345)
// BEFORE: 'Token has expired'
// AFTER:  'Unauthorized: Token has expired'
```

### Error Message Pattern

**All 401 errors now follow this pattern:**

| Error Scenario | Error Message | Keyword | Position |
|---------------|---------------|---------|----------|
| No Authorization header | `Unauthorized: Missing Authorization header with Bearer token` | **Unauthorized** | START |
| Invalid JWT format | `Invalid JWT: Token format is invalid` | **Invalid JWT** | START |
| Token not yet valid | `Unauthorized: Token not yet valid` | **Unauthorized** | START |
| Token exceeds max age | `Unauthorized: Token exceeds maximum age` | **Unauthorized** | START |
| Token expired | `Unauthorized: Token has expired` | **Unauthorized** | START |
| User has no valid roles | `Unauthorized: User has no valid roles assigned` | **Unauthorized** | START |

## Why This Works

### mcp-proxy's Error Detection Logic

From `node_modules/@gazzadownunder/mcp-proxy/dist/stdio-CFEtr3zF.js`:

```javascript
try {
  server = await createServer(req);
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : String(error);

  // Keyword Detection
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

  // Return 500 (fallback)
  res.writeHead(500).end("Error creating server");
  return true;
}
```

**By starting the error message with a keyword**, we ensure:
1. ✅ Keyword is detected even if string is truncated
2. ✅ Keyword is detected even if error is wrapped
3. ✅ Keyword is detected immediately (no scanning required)
4. ✅ Multiple keywords provide fallback detection

## Testing

### Test 401 Response (No Authorization Header)

```bash
curl -v -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

**Expected Response:**
```
HTTP/1.1 401 Unauthorized
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

### Test 401 Response (Invalid Token)

```bash
curl -v -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer invalid.token.here" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

**Expected Response:**
```
HTTP/1.1 401 Unauthorized
Content-Type: application/json

{
  "error": {
    "code": -32000,
    "message": "Invalid JWT: Token format is invalid"
  },
  "id": 1,
  "jsonrpc": "2.0"
}
```

## Files Modified

| File | Changes |
|------|---------|
| [src/mcp/middleware.ts](../src/mcp/middleware.ts#L97) | Prefixed "Unauthorized:" to missing token error |
| [src/core/jwt-validator.ts](../src/core/jwt-validator.ts#L204) | Prefixed "Invalid JWT:" to format error |
| [src/core/jwt-validator.ts](../src/core/jwt-validator.ts#L335) | Prefixed "Unauthorized:" to not-yet-valid error |
| [src/core/jwt-validator.ts](../src/core/jwt-validator.ts#L340) | Prefixed "Unauthorized:" to token-too-old error |
| [src/core/jwt-validator.ts](../src/core/jwt-validator.ts#L345) | Prefixed "Unauthorized:" to expired token error |

## Build and Deploy

```bash
# Rebuild with changes
npm run build

# Restart server
# The new error messages will now trigger 401 responses
```

## Verification

After restarting the server with the updated code:

1. **Check logs for keyword prefix:**
   ```
   [MCPAuthMiddleware] ❌ No Bearer token found
   [MCPAuthMiddleware] ❌ Authentication error (statusCode: 401): Unauthorized: Missing Authorization header with Bearer token
   ```

2. **Verify HTTP response code:**
   - Previous: `HTTP/1.1 500 Internal Server Error` ❌
   - Current: `HTTP/1.1 401 Unauthorized` ✅

3. **Verify error message in response:**
   ```json
   {
     "error": {
       "code": -32000,
       "message": "Unauthorized: Missing Authorization header with Bearer token"
     }
   }
   ```

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    Client Request                        │
│  POST /mcp (no Authorization header)                    │
└────────────────────┬────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│                    mcp-proxy                             │
│  1. Calls authenticate(req)                             │
│  2. Checks authenticated === false → Could return 401   │
│  3. Calls createServer(req)                             │
└────────────────────┬────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│                    FastMCP                               │
│  1. Calls authenticate(req) AGAIN                       │
│  2. #createSession checks authenticated === false       │
│  3. Throws new Error("Unauthorized: ...")              │
└────────────────────┬────────────────────────────────────┘
                     ↓ Error with keyword
┌─────────────────────────────────────────────────────────┐
│                mcp-proxy Error Handler                   │
│  if (error.message.includes("Unauthorized")) {         │
│    res.writeHead(401).end(...)  ✅                      │
│    return true                                          │
│  }                                                      │
└─────────────────────────────────────────────────────────┘
```

## Key Takeaway

**Always prefix authentication error messages with mcp-proxy's detection keywords** ("Unauthorized", "Invalid JWT", "Authentication", "Token") to ensure proper HTTP status code mapping when errors pass through multiple layers of the stack.
