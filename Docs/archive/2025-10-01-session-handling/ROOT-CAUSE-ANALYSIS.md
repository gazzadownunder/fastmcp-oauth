# Root Cause Analysis: Session ID Not Being Captured

## Problem
Browser client cannot capture the `Mcp-Session-Id` header from server responses, resulting in "No valid session ID provided" errors on tool calls.

## Root Cause
The `StreamableHTTPServerTransport` in mcp-proxy automatically sets the `Mcp-Session-Id` response header during its `handleRequest()` method. However, there are two issues:

1. **CORS Blocking**: The header `Access-Control-Expose-Headers` is not set, so browsers cannot read the `Mcp-Session-Id` header even though it's sent by the server.

2. **Header Case Sensitivity**: The working client code uses **lowercase** `mcp-session-id`:
   ```typescript
   const sessionId = response.headers.get('mcp-session-id');  // lowercase!
   ```

## Verification from Working Client
Looking at `Sample-client-auth/mcpToolsService.ts`:
- Line 1127: Uses **lowercase** `mcp-session-id`
- Line 373: Reads `sessionId` property directly from SDK transport
- Line 902: Sends session ID as `Mcp-Session-Id` header (title case)

## The Fix
Only TWO changes needed to mcp-proxy:

### 1. CORS Headers (Line 170-173)
**Change:**
```javascript
res.setHeader("Access-Control-Allow-Headers", "*");
```

**To:**
```javascript
res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept, Mcp-Session-Id, Last-Event-Id");
res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
```

**Reason**: Wildcard `*` doesn't work with `Access-Control-Allow-Credentials: true`. Must explicitly list headers. The `Access-Control-Expose-Headers` allows browser JavaScript to read the session ID header.

### 2. Per-Request Authentication (Optional, for stateless mode)
Add authentication callback support to validate JWT on every request when `stateless: true`.

## What NOT to Do
- ❌ Don't manually set `Mcp-Session-Id` header - StreamableHTTPServerTransport does this automatically
- ❌ Don't create custom stateless session logic - breaks normal session handling
- ❌ Don't modify session initialization flow - it works correctly out of the box

## Testing
After applying CORS fix:
1. Browser should see `Mcp-Session-Id` in response headers
2. Client should capture it: `response.headers.get('mcp-session-id')` (lowercase)
3. Subsequent requests should include it: `Mcp-Session-Id: <captured-value>` (title case)
4. Tool calls should succeed

## Header Name Notes
- **Sent by server**: `Mcp-Session-Id` (title case, set by StreamableHTTPServerTransport)
- **Read by browser**: `mcp-session-id` (lowercase, HTTP/2 normalizes to lowercase)
- **Sent by client**: `Mcp-Session-Id` (title case, matches MCP protocol spec)