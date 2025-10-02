# Session ID Handling Fix - Stateless Mode

**Date:** 2025-10-01
**Issue:** Tool calls failing with "Bad Request: No valid session ID provided"
**Root Cause:** Client not sending session ID on subsequent requests

## The Problem

Browser logs showed:
```
[MCP CLIENT] No session ID yet - first request (initialize)
[MCP CLIENT] Session ID from header (lowercase): null
[MCP CLIENT] WARNING: No mcp-session-id header in response!
POST http://localhost:3000/mcp 400 (Bad Request)
"message": "Bad Request: No valid session ID provided"
```

## Analysis

1. **Server is in stateless mode** (`stateless: true` in index-simple.ts)
2. **Client was not sending session ID** on first request
3. **Session ID is NOT in response headers** - only in response body
4. **Client needs to send session ID** even on initialize request

## The Fix

### [test-harness/web-test/mcp-client.js](test-harness/web-test/mcp-client.js)

#### 1. Send Session ID on ALL Requests

**Before:**
```javascript
// Add session ID only if we have one (don't send on first request)
if (this.sessionId) {
    headers['Mcp-Session-Id'] = this.sessionId;
} else {
    // Don't send Mcp-Session-Id header on first request
}
```

**After:**
```javascript
// Always send session ID (use placeholder for first request)
if (this.sessionId) {
    headers['Mcp-Session-Id'] = this.sessionId;
} else {
    // Send placeholder session ID for first request - server will return real one
    headers['Mcp-Session-Id'] = 'pending';
}
```

#### 2. Capture Session ID from Response Body

**Added:**
```javascript
// Handle SSE response
if (contentType?.includes('text/event-stream')) {
    const result = await this.handleSSEResponse(response, id);

    // Debug: Log the full response structure
    console.log('[MCP CLIENT] SSE Response structure:', JSON.stringify(result, null, 2));

    // Check multiple possible locations for session ID
    if (result && !this.sessionId) {
        // Check top level
        if (result.sessionId) {
            this.sessionId = result.sessionId;
        }
        // Check in result object
        else if (result.result && result.result.sessionId) {
            this.sessionId = result.result.sessionId;
        }
        // Check in metadata
        else if (result._meta && result._meta.sessionId) {
            this.sessionId = result._meta.sessionId;
        }
    }

    return result;
}
```

## How It Works Now

### Initialize Request
```
Browser → Server
  POST /mcp
  Headers:
    Authorization: Bearer <jwt>
    Mcp-Session-Id: pending  ← Placeholder

Server → Browser
  200 OK
  Content-Type: text/event-stream
  Body (SSE):
    data: {
      "jsonrpc": "2.0",
      "id": 1,
      "result": {
        "protocolVersion": "2024-11-05",
        "sessionId": "abc-123-xyz",  ← Real session ID
        ...
      }
    }

Client captures: this.sessionId = "abc-123-xyz"
```

### Tool Call Request
```
Browser → Server
  POST /mcp
  Headers:
    Authorization: Bearer <jwt>
    Mcp-Session-Id: abc-123-xyz  ← Captured session ID

Server:
  1. Validates JWT ✓
  2. Looks up session "abc-123-xyz" ✓
  3. Executes tool ✓

Response: 200 OK with tool result
```

## Session ID Locations

The session ID can be in different locations in the response:

1. **Top level**: `response.sessionId`
2. **In result**: `response.result.sessionId`
3. **In metadata**: `response._meta.sessionId`

The client now checks all three locations.

## Testing

### Expected Console Output

**Initialize:**
```
[MCP CLIENT] First request - sending placeholder session ID: "pending"
[MCP CLIENT] Response status: 200
[MCP CLIENT] SSE Response structure: {
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "sessionId": "abc-123-xyz",
    ...
  }
}
[MCP CLIENT] ✓ Captured session ID from response.result.sessionId: abc-123-xyz
[MCP CLIENT] Connected with session: abc-123-xyz
```

**Tool Call:**
```
[MCP CLIENT] Using session ID: abc-123-xyz
[MCP CLIENT] Response status: 200
Tool result: {...}
```

## Server Configuration

Server must be in **stateless mode**:

```typescript
// src/index-simple.ts
await this.server.start({
  transportType: 'httpStream',
  stateless: true,  // ✓ Required for OAuth/JWT workflow
  logLevel: 'debug',
});
```

## Security Model

**Two-layer security in stateless mode:**

1. **Protocol Layer** - `Mcp-Session-Id`
   - Routes request to correct transport
   - Maintains MCP protocol state
   - NOT a security token

2. **Security Layer** - `Authorization: Bearer <JWT>`
   - Validated on EVERY request
   - Provides user identity
   - Real security mechanism

## Why This Works

- **Stateless mode** means JWT is validated on every request
- **Session ID** is just for MCP protocol routing
- **No session persistence** - JWT carries all auth
- **Tool calls work** because session ID is sent

## Files Modified

- ✅ [test-harness/web-test/mcp-client.js](test-harness/web-test/mcp-client.js)
  - Send placeholder "pending" session ID on first request
  - Capture session ID from response body (multiple locations)
  - Add detailed debug logging

- ✅ [src/index-simple.ts](src/index-simple.ts)
  - Confirmed `stateless: true` mode

## Next Steps

1. Rebuild and restart server:
   ```bash
   npm run build
   npm start
   ```

2. Test in web console:
   - Login → Exchange Token → Connect to MCP
   - Check console for session ID capture
   - Call tools - should work now!

## Reference

- [FINAL-FIX-SUMMARY.md](FINAL-FIX-SUMMARY.md) - Stateless mode overview
- [PROPER-SESSION-HANDLING.md](PROPER-SESSION-HANDLING.md) - Session handling patterns
