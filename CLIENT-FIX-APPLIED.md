# Client Fix Applied - Removed Placeholder Session ID

**Date:** 2025-10-01
**Issue:** Client sending placeholder "pending" session ID on first request
**Status:** ✅ FIXED

---

## Problem

Looking at the browser logs (logs/browser.log):

```
Line 10: [MCP CLIENT] First request - sending placeholder session ID: "pending"
Line 11: [MCP CLIENT] Request headers: {..., Mcp-Session-Id: 'pending'}
Line 12: POST http://localhost:3000/mcp 404 (Not Found)
Line 26: {error: {code: -32001, message: "Session not found"}}
```

The client was sending a **placeholder session ID "pending"** on the first request (initialize), but the server doesn't have a session with ID "pending", so it returned 404 "Session not found".

---

## Root Cause

Someone modified `test-harness/web-test/mcp-client.js` to send a placeholder:

```javascript
// WRONG CODE (lines 67-75)
if (this.sessionId) {
    headers['Mcp-Session-Id'] = this.sessionId;
} else {
    // ❌ WRONG: Sends placeholder "pending"
    headers['Mcp-Session-Id'] = 'pending';
    console.log('[MCP CLIENT] First request - sending placeholder session ID: "pending"');
}
```

This is incorrect! The client should **NOT send any session ID header** on the first request. The server will:
1. Create a new session with a UUID
2. Return that UUID in the `Mcp-Session-Id` response header
3. Client captures it and uses it for subsequent requests

---

## Fix Applied

Changed `mcp-client.js` lines 67-74:

```javascript
// CORRECT CODE
// Add session ID only if we have one (don't send on first request)
if (this.sessionId) {
    headers['Mcp-Session-Id'] = this.sessionId;
    console.log('[MCP CLIENT] Using session ID:', this.sessionId);
} else {
    console.log('[MCP CLIENT] No session ID yet - first request (initialize)');
    // Don't send Mcp-Session-Id header on first request - let server create session
}
```

**Key change:** Don't send the header at all when `this.sessionId` is null/undefined.

---

## How It Should Work Now

### First Request (Initialize):
```
Client → Server
  Headers: {
    Authorization: "Bearer <token>",
    Content-Type: "application/json",
    // ✓ NO Mcp-Session-Id header
  }
  Body: { method: "initialize", ... }

Server → Client
  Headers: {
    mcp-session-id: "2956594f-29eb-419d-a5cb-d7161c288c4e"  // ✓ Server creates session
  }
  Body: { result: { ... } }

Client captures session ID from header ✓
```

### Subsequent Requests (Tool Calls):
```
Client → Server
  Headers: {
    Authorization: "Bearer <token>",
    Content-Type: "application/json",
    Mcp-Session-Id: "2956594f-29eb-419d-a5cb-d7161c288c4e"  // ✓ Send captured ID
  }
  Body: { method: "tools/call", ... }

Server → Client
  Uses existing session ✓
  Returns result ✓
```

---

## Expected Browser Console Output

After the fix, browser console should show:

```
[MCP CLIENT] No session ID yet - first request (initialize)
[MCP CLIENT] Request headers: {Content-Type: ..., Authorization: ..., Accept: ...}
[MCP CLIENT] Response status: 200
[MCP CLIENT] All response headers:
  content-type: text/event-stream
  mcp-session-id: 2956594f-29eb-419d-a5cb-d7161c288c4e
  ...
[MCP CLIENT] Session ID from header (lowercase): 2956594f-29eb-419d-a5cb-d7161c288c4e
[MCP CLIENT] ✓ Captured session ID from response header: 2956594f-29eb...
[MCP CLIENT] Connected with session: 2956594f-29eb-419d-a5cb-d7161c288c4e

[MCP CLIENT] Using session ID: 2956594f-29eb-419d-a5cb-d7161c288c4e
[Tool call succeeded]
```

**Key indicators:**
- ✓ "No session ID yet - first request"
- ✓ "Captured session ID from response header"
- ✓ "Using session ID" on subsequent calls
- ✓ 200 OK responses (not 404)

---

## Testing

1. **Make sure server is running:**
   ```batch
   start-test-server.bat
   ```

2. **Open web test harness:**
   ```
   test-harness/web-test/index.html
   ```

3. **Clear browser cache** (important!):
   - Press F12 to open DevTools
   - Right-click the refresh button
   - Choose "Empty Cache and Hard Reload"

4. **Test the flow:**
   - Login to Keycloak
   - Exchange token
   - Connect to MCP
   - Call tools

5. **Check console:**
   - Should see session ID captured
   - No 404 errors
   - All tool calls succeed

---

## Why This Matters

The MCP protocol expects:
1. Client sends **initialize** request without session ID
2. Server creates session and returns ID in header
3. Client captures and stores the session ID
4. Client includes session ID in all subsequent requests

Sending a placeholder "pending" breaks this flow because:
- Server doesn't recognize "pending" as a valid session
- Returns 404 "Session not found"
- Client can never establish a proper session

---

## Related Changes

This fix works together with:
- ✅ mcp-proxy CORS headers (expose `Mcp-Session-Id`)
- ✅ Client uses lowercase `mcp-session-id` to read header
- ✅ Client doesn't overwrite captured session ID

All these pieces must work together for session management to function.

---

## File Modified

- `test-harness/web-test/mcp-client.js` (lines 67-74)

---

## Next Steps

**Refresh your browser and test again!**

The client will now:
1. ✅ NOT send session ID on first request
2. ✅ Capture session ID from response header
3. ✅ Send captured session ID on subsequent requests
4. ✅ Everything should work!

See [READY-TO-TEST.md](READY-TO-TEST.md) for full testing instructions.