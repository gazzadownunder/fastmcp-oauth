# Authentication Fix - FastMCP & mcp-proxy

**Date**: 2025-10-06
**Issue**: Both FastMCP and mcp-proxy have authentication bugs preventing proper OAuth/JWT rejection
**Status**: ✅ Fixes tested and proven in node_modules - ready for upstream submission

## Executive Summary

**Root Cause**: Authentication failures are bypassed due to bugs in **both** libraries:
1. **FastMCP**: Creates sessions even when `authenticate()` returns `{authenticated: false}`
2. **mcp-proxy**: Doesn't detect `{authenticated: false}` objects (only checks falsy values)

**Impact**: Unauthenticated clients can establish sessions and access protected resources

**Solution**: Both libraries need fixes (detailed below with proven implementations)

---

## Problem Statement

Two authentication bugs work together to bypass OAuth/JWT security:

### Bug #1: FastMCP - Session Created Despite Auth Failure

FastMCP's `#createSession` method **always creates a session** regardless of authentication result.

### Bug #2: mcp-proxy - Ignores `{authenticated: false}` Pattern

The `mcp-proxy` HTTP stream transport only checks for **falsy** authentication results or **thrown errors**, missing FastMCP's `{ authenticated: boolean, session?, error? }` pattern.

### Current Behavior (Bug)

**File**: `node_modules/mcp-proxy/src/startHTTPServer.ts`

```typescript
const authResult = await authenticate(req);
if (!authResult) {  // ❌ WRONG: Checks if authResult is falsy
  // Return 401 error
}
```

**Problem**: When FastMCP returns `{ authenticated: false, error: "..." }`, the result is a **truthy object**, so the check `if (!authResult)` fails and the code proceeds as if authentication succeeded.

### What Happens

1. ✅ FastMCP middleware detects invalid JWT (e.g., `AZP_MISMATCH`)
2. ✅ Returns: `{ authenticated: false, error: "Token azp mismatch..." }`
3. ❌ mcp-proxy checks: `if (!authResult)` → FALSE (object is truthy)
4. ❌ mcp-proxy proceeds with session establishment
5. ❌ Client sees successful connection despite authentication failure

## The Fix

### Required Change

**File**: `node_modules/mcp-proxy/src/startHTTPServer.ts` (lines ~170-195)

**BEFORE** (current buggy code):
```typescript
if (stateless && authenticate) {
  try {
    const authResult = await authenticate(req);
    if (!authResult) {  // ❌ Only catches null/undefined/false
      res.setHeader("Content-Type", "application/json");
      res.writeHead(401).end(
        JSON.stringify({
          error: {
            code: -32000,
            message: "Unauthorized: Authentication failed"
          },
          id: (body as { id?: unknown })?.id ?? null,
          jsonrpc: "2.0"
        })
      );
      return true;
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
        id: (body as { id?: unknown })?.id ?? null,
        jsonrpc: "2.0"
      })
    );
    return true;
  }
}
```

**AFTER** (fixed code):
```typescript
if (stateless && authenticate) {
  try {
    const authResult = await authenticate(req);

    // ✅ Check for both falsy AND { authenticated: false } pattern
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
    // Extract error details if available
    const errorMessage = error instanceof Error ? error.message : "Authentication error";
    const errorCode = (error as any).code || -32000;

    console.error("Authentication error:", error);
    res.setHeader("Content-Type", "application/json");
    res.writeHead(401).end(
      JSON.stringify({
        error: {
          code: errorCode,  // ✅ Use actual error code
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

### Key Improvements

1. **Checks `authenticated` property**: `!authResult.authenticated` catches `{ authenticated: false }`
2. **Extracts error message**: Uses the actual error message from `authResult.error`
3. **Better error handling**: Extracts error details from thrown exceptions
4. **Preserves error codes**: Uses error code from OAuthSecurityError if available

## Current Workaround

**File**: `src/mcp/middleware.ts` (lines 141-163)

Instead of returning `{ authenticated: false, error }`, we **re-throw** the error:

```typescript
catch (error) {
  // WORKAROUND: Re-throw to force HTTP error response
  // TODO: Remove when mcp-proxy is fixed
  throw error;
}
```

**Impact**:
- ✅ Client receives HTTP 401/403 error
- ✅ Error message is propagated (though not prettified)
- ⚠️ Deviates from FastMCP's documented API
- ⚠️ Should be reverted when mcp-proxy is fixed

## Testing the Fix

### Before Fix
```bash
# Start server with invalid JWT (azp='contextflow' instead of 'mcp-oauth')
# Result: Session establishes, no error shown to client
```

### After Fix
```bash
# Start server with invalid JWT
# Result: HTTP 401 response with error message:
{
  "error": {
    "code": -32000,
    "message": "Token authorized party 'contextflow' does not match expected audience 'mcp-oauth'"
  },
  "jsonrpc": "2.0"
}
```

## Type Safety Improvement

The authenticate callback type should also be updated:

**BEFORE**:
```typescript
authenticate?: (request: http.IncomingMessage) => Promise<unknown>;
```

**AFTER**:
```typescript
interface AuthResult {
  authenticated: boolean;
  session?: unknown;
  error?: string;
}

authenticate?: (request: http.IncomingMessage) => Promise<unknown | AuthResult>;
```

This makes the contract explicit.

## Upstream Action Required

1. **Report issue** to mcp-proxy GitHub repository
2. **Submit PR** with the fix above
3. **Wait for release** of fixed version
4. **Update dependency** and remove workaround from our code

## Related Issues

- FastMCP assumes authenticate can return `{ authenticated: false }`
- mcp-proxy only checks for falsy values
- This breaks the OAuth authentication pattern where errors should be gracefully communicated

## Impact on Our Codebase

### Files Affected by Workaround
- `src/mcp/middleware.ts` - Re-throws instead of returning soft failure

### Files to Update After Fix
Once mcp-proxy is fixed, revert to proper API:

```typescript
// src/mcp/middleware.ts (lines 141-163)
catch (error) {
  // Proper FastMCP API (restore after mcp-proxy fix)
  if (error instanceof Error) {
    return {
      authenticated: false,
      error: error.message,
    };
  }

  return {
    authenticated: false,
    error: 'Authentication failed',
  };
}
```

## Summary

**Root Cause**: mcp-proxy uses `if (!authResult)` which doesn't detect `{ authenticated: false }` objects

**Required Fix**: Check `authResult.authenticated === false` AND extract error message

**Our Workaround**: Re-throw errors instead of returning soft failures

**Action Items**:
1. ✅ Proven both fixes work in node_modules testing
2. Submit issues to both FastMCP and mcp-proxy repositories (see [github-issues-authentication-fix.md](./github-issues-authentication-fix.md))
3. Wait for upstream releases with fixes
4. Update dependencies and remove node_modules patches

---

## Test Results Summary

**Implementation**: Both fixes applied to node_modules and tested

**Test Environment**:
- `fastmcp@3.19.0` (patched)
- `mcp-proxy@5.8.0` (patched)
- Test: Invalid JWT with initialize request

**Before Fixes**:
```bash
# Response: HTTP 200 OK - Session established ❌
event: message
data: {"result":{"protocolVersion":"2024-11-05",...},"jsonrpc":"2.0","id":1}
```

**After Fixes**:
```bash
# Response: HTTP 401 Unauthorized - Session rejected ✅
{"error":{"code":-32000,"message":"Invalid JWT payload"},"id":1,"jsonrpc":"2.0"}
```

**Conclusion**: ✅ Both fixes are required and work together to properly reject unauthenticated requests.

---

## Next Steps

1. **Submit GitHub Issues**: Use the documentation in [github-issues-authentication-fix.md](./github-issues-authentication-fix.md) to create issues on both repositories
2. **Monitor Responses**: Track upstream issue discussions and provide additional details if needed
3. **Test Releases**: When fixes are released, test against official packages
4. **Update Project**: Remove node_modules patches and update to fixed versions

**Related Documentation**:
- [github-issues-authentication-fix.md](./github-issues-authentication-fix.md) - Complete issue templates for both libraries
- [Security-review.md](./Security-review.md) - Original security gap analysis
- [refactor.md](./refactor.md) - Framework architecture documentation
