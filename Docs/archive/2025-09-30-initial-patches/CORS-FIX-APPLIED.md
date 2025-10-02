# CORS Fix Applied - Authorization Header Now Allowed

**Date:** 2025-09-30
**Issue:** Browser blocking Authorization header in CORS preflight

## Problem

After applying the authentication fix, the browser was blocking requests with this error:

```
Access to fetch at 'http://localhost:3000/mcp' from origin 'http://localhost:8000'
has been blocked by CORS policy: Request header field authorization is not allowed
by Access-Control-Allow-Headers in preflight response.
```

## Root Cause

FastMCP's default CORS configuration uses:
```javascript
res.setHeader("Access-Control-Allow-Headers", "*");
```

**However**, according to the CORS specification, the wildcard `*` does NOT work for:
- `Authorization` header
- Custom headers
- When `Access-Control-Allow-Credentials: true` is set

This is a security restriction in browsers to prevent credential leakage.

## Solution

Changed the CORS header to explicitly list allowed headers:

```javascript
// Before (doesn't work):
res.setHeader("Access-Control-Allow-Headers", "*");

// After (works!):
res.setHeader("Access-Control-Allow-Headers",
  "Content-Type, Authorization, Accept, Mcp-Session-Id, Last-Event-Id");
```

## Files Modified

### Compiled Files (actually used)
1. **node_modules/mcp-proxy/dist/chunk-43AXMLZU.js**
   - Line 172: Updated CORS headers (startHTTPStreamServer)
   - Line 395: Updated CORS headers (startSSEServer)

### Source Files (for reference)
2. **node_modules/mcp-proxy/src/startHTTPStreamServer.ts**
   - Line 64: Updated CORS headers

## Headers Now Allowed

The explicit list includes all headers needed for MCP with JWT authentication:

| Header | Purpose |
|--------|---------|
| `Content-Type` | JSON-RPC request/response format |
| `Authorization` | **JWT Bearer token** (the critical one!) |
| `Accept` | Required by FastMCP for SSE negotiation |
| `Mcp-Session-Id` | Optional session identifier |
| `Last-Event-Id` | SSE reconnection support |

## Testing

### Before Fix
```bash
# Browser console
POST http://localhost:3000/mcp net::ERR_FAILED
Error: Request header field authorization is not allowed
```

### After Fix
```bash
# Browser console
POST http://localhost:3000/mcp 200 OK
[AUTH DEBUG] Authorization: present ✓
```

## Why This Wasn't Needed With Proxy

The proxy (`proxy-server-native.js`) worked around this by:
1. Running on same origin (localhost:3001)
2. Adding explicit CORS headers itself
3. Forwarding requests to the backend

But with direct connection, we need FastMCP's CORS to be correct.

## Restart Required

After making this change, you must restart the MCP server:

```bash
# Kill any running node processes
taskkill /F /IM node.exe

# Start server
start-mcp-test.bat
```

Or just close and reopen the command window running the server.

## Testing the Fix

1. **Start server** (after restart):
   ```bash
   start-mcp-test.bat
   ```

2. **Open web-test** harness:
   ```
   test-harness/web-test/index.html
   ```

3. **Connect with JWT**:
   - Get token from Keycloak
   - Exchange for mcp-oauth audience
   - Connect to `http://localhost:3000/mcp`
   - Call tools

4. **Expected behavior**:
   - No CORS errors ✓
   - Authorization header sent ✓
   - Authentication succeeds ✓
   - Tools execute ✓

## Complete Fix Stack

Both fixes are now in place:

1. ✅ **Authentication fix** - `authenticate()` called on every request
2. ✅ **CORS fix** - `Authorization` header explicitly allowed

## Related Standards

- **CORS Specification**: https://fetch.spec.whatwg.org/#http-cors-protocol
- **Authorization Header Restriction**: Wildcard `*` not allowed with credentials
- **RFC 6750**: OAuth 2.0 Bearer Token Usage

## Summary

The CORS wildcard `*` doesn't work for the `Authorization` header. We fixed it by explicitly listing all required headers, including `Authorization`. This allows JWT Bearer tokens to be sent directly from the browser to the MCP server without CORS errors.