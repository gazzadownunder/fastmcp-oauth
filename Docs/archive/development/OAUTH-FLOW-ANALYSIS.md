# OAuth Authentication Flow - Complete Analysis

## Problem Statement

MCP server is returning **HTTP 500** instead of **HTTP 401** when authentication fails.

## Complete Request Flow

```
Client Request
    ↓
mcp-proxy (HTTP Handler)
    ↓
FastMCP (createServer)
    ↓
MCPAuthMiddleware.authenticate()
    ↓
(Error thrown or result returned)
    ↓
FastMCP (#createSession)
    ↓
mcp-proxy (Error Handler)
    ↓
HTTP Response (500 or 401?)
```

## Layer-by-Layer Analysis

### 1. Client Request
```bash
POST /mcp HTTP/1.1
Content-Type: application/json

{"jsonrpc":"2.0","method":"tools/list","id":1}
# Note: No Authorization header!
```

### 2. mcp-proxy (Entry Point)

**File:** `node_modules/@gazzadownunder/mcp-proxy/dist/stdio-CFEtr3zF.js`

```javascript
const handleStreamRequest = async ({
  activeTransports,
  authenticate,      // ← Our MCPAuthMiddleware.authenticate
  createServer,      // ← FastMCP's server factory
  stateless,
  req,
  res
}) => {
  const body = await getBody(req);

  // STATELESS MODE: Call authenticate FIRST
  if (stateless && authenticate) {
    try {
      const authResult = await authenticate(req);

      // CHECK 1: Does authResult indicate failure?
      if (!authResult ||
          (typeof authResult === "object" &&
           "authenticated" in authResult &&
           !authResult.authenticated)) {

        // ✅ RETURN 401 HERE!
        const errorMessage = authResult?.error || "Unauthorized: Authentication failed";
        res.setHeader("Content-Type", "application/json");
        res.writeHead(401).end(JSON.stringify({
          error: { code: -32000, message: errorMessage },
          id: body?.id ?? null,
          jsonrpc: "2.0"
        }));
        return true;  // ← EXIT HERE, never reach createServer!
      }
    } catch (error) {
      // ✅ CATCH BLOCK ALSO RETURNS 401!
      const errorMessage = error instanceof Error ? error.message : "Unauthorized: Authentication error";
      res.writeHead(401).end(JSON.stringify({...}));
      return true;
    }
  }

  // ONLY REACH HERE IF AUTH SUCCEEDED!
  // Now create server...
  try {
    server = await createServer(req);  // ← FastMCP.createServer
  } catch (error) {
    // CHECK 2: Does error message contain auth keywords?
    if (errorMessage.includes("Authentication") ||
        errorMessage.includes("Token") ||
        errorMessage.includes("Unauthorized")) {
      res.writeHead(401).end(...);
      return true;
    }
    // ❌ RETURN 500 HERE!
    res.writeHead(500).end("Error creating server");
    return true;
  }
}
```

**Key Insight:** mcp-proxy has **TWO opportunities** to return 401:
1. **Early check (stateless mode)**: If `authenticate()` returns `{ authenticated: false }` → Returns 401 ✅
2. **Late check (during createServer)**: If `createServer()` throws error with keywords → Returns 401 ✅

### 3. Our MCPAuthMiddleware.authenticate()

**File:** [src/mcp/middleware.ts](../src/mcp/middleware.ts)

**Current Implementation:**
```typescript
async authenticate(request: FastMCPRequest): Promise<FastMCPAuthResult> {
  try {
    const token = this.extractToken(request);

    if (!token) {
      throw createSecurityError(
        'MISSING_TOKEN',
        'Missing Authorization header with Bearer token',
        401
      );
    }

    const authResult = await this.authService.authenticate(token);

    if (authResult.rejected) {
      throw createSecurityError('UNAUTHORIZED', 'Unauthorized: ...', 403);
    }

    return {
      authenticated: true,
      session: authResult.session,
    };
  } catch (error) {
    if (error instanceof OAuthSecurityError) {
      return {
        authenticated: false,
        error: error.message,
        statusCode: error.statusCode,  // 401 or 403
      };
    }

    return {
      authenticated: false,
      error: 'Authentication failed',
      statusCode: 500,
    };
  }
}
```

**What happens:**
1. No token found → Throws `OAuthSecurityError(401)`
2. Catch block catches it → Returns `{ authenticated: false, error: "...", statusCode: 401 }`
3. **Result returned to mcp-proxy** ✅

**Expected:** mcp-proxy's early check sees `authenticated: false` → Returns 401

### 4. FastMCP.createServer

**File:** `node_modules/@gazzadownunder/fastmcp/dist/FastMCP.js`

**WAIT! This is the problem!**

Looking at the flow, if we're using **stateless mode**, mcp-proxy calls:

```javascript
if (stateless && authenticate) {
  const authResult = await authenticate(req);  // ← MCPAuthMiddleware.authenticate

  if (!authResult.authenticated) {
    // Return 401 HERE
    return;
  }
}

// If we reach here, auth succeeded
server = await createServer(req);
```

**But FastMCP ALSO calls authenticate internally!**

Let me check FastMCP's stateless flow...

### 5. The Real Problem: Double Authentication

**FastMCP in Stateless Mode:**

```javascript
// In httpStream transport
if (this.#authenticate && this.#options.stateless) {
  auth = await this.#authenticate(request);
}

// Then in #createSession:
if (auth && !auth.authenticated) {
  const errorMessage = auth.error || "Authentication failed";
  throw new Error(errorMessage);  // ← THROWS ERROR!
}
```

**The Issue:**
1. mcp-proxy calls `authenticate()` → Gets `{ authenticated: false, error: "..." }`
2. mcp-proxy checks and should return 401
3. **BUT** mcp-proxy ALSO passes this same `authenticate` function to `createServer`
4. FastMCP calls it AGAIN inside `createServer`
5. FastMCP throws `new Error(errorMessage)` ← This loses the statusCode!
6. mcp-proxy catches this error and checks for keywords
7. **If keywords not found → Returns 500!**

## Root Cause Identified

The problem is **FastMCP's authenticate integration, NOT our middleware!**

When FastMCP is created with `stateless: true`, the authenticate function is called in TWO places:

1. **mcp-proxy**: Calls authenticate, checks result, should return 401 ✅
2. **FastMCP**: Also calls authenticate internally, throws generic Error ❌

The second call happens inside `createServer`, and the thrown Error doesn't preserve statusCode.

## The Fix

We have two options:

### Option A: Ensure Error Messages Contain Keywords

Make sure ALL error messages contain mcp-proxy's detection keywords:
- "Authentication"
- "Invalid JWT"
- "Token"
- "Unauthorized"

**Current error message:** `"Missing Authorization header with Bearer token"` ✅ Contains "Token"

**This should work!** But it's not... Let me check if FastMCP is wrapping the error...

### Option B: Prevent Double Authentication

Configure FastMCP to NOT call authenticate internally when mcp-proxy already handles it.

**Problem:** FastMCP requires authenticate to be passed to createServer for stateless mode.

## Investigation Needed

The error message "Missing Authorization header with Bearer token" **DOES** contain "Token", so mcp-proxy **SHOULD** return 401.

**Next Steps:**
1. Check what error message is actually being thrown by FastMCP
2. Verify mcp-proxy's stateless mode configuration
3. Add debug logging to see exactly what error mcp-proxy receives

## Hypothesis

**FastMCP might be throwing a DIFFERENT error** before our authenticate function runs, or the error message is being transformed.

Let me check FastMCP's actual stateless implementation...
