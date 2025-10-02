# FastMCP Authentication Fix - Patch Applied

**Date:** 2025-09-30
**Status:** Patch applied to local node_modules

## Problem

FastMCP's `stateless: true` mode only called the `authenticate()` callback on `initialize` requests, NOT on subsequent tool call requests. This caused all tool calls to fail with "No valid session ID provided" even when valid JWT Bearer tokens were present.

## Solution

Modified the FastMCP and mcp-proxy libraries in `node_modules` to:
1. Accept a `stateless` parameter in the start() options
2. Pass the `authenticate` callback through to the HTTP stream handler
3. Call `authenticate()` on EVERY request when `stateless: true`

## Files Modified

### Source Files (for reference)
1. **node_modules/mcp-proxy/src/startHTTPStreamServer.ts**
   - Added `authenticate` and `stateless` parameters
   - Added authentication check on every request before session lookup

2. **node_modules/fastmcp/src/FastMCP.ts**
   - Added `stateless` option to httpStream start configuration
   - Passed `authenticate` and `stateless` to startHTTPStreamServer

### Compiled Files (actually used)
3. **node_modules/mcp-proxy/dist/chunk-43AXMLZU.js**
   - Lines 153-163: Added `authenticate` and `stateless` parameters
   - Lines 192-224: Added per-request authentication logic

4. **node_modules/fastmcp/dist/FastMCP.js**
   - Lines 927-960: Added `authenticate` and `stateless` parameters to startHTTPStreamServer call

### Backup Files Created
- `node_modules/mcp-proxy/src/startHTTPStreamServer.ts.backup`
- `node_modules/fastmcp/src/FastMCP.ts.backup`
- `node_modules/mcp-proxy/dist/chunk-43AXMLZU.js.backup`
- `node_modules/fastmcp/dist/FastMCP.js.backup`

## Key Changes

### 1. mcp-proxy Authentication Logic (chunk-43AXMLZU.js:192-224)

```javascript
const body = await getBody(req);

// NEW: Authenticate every request in stateless mode
if (stateless && authenticate) {
  try {
    const authResult = await authenticate(req);
    if (!authResult) {
      res.setHeader("Content-Type", "application/json");
      res.writeHead(401).end(
        JSON.stringify({
          error: {
            code: -32000,
            message: "Unauthorized: Authentication failed"
          },
          id: body?.id || null,
          jsonrpc: "2.0"
        })
      );
      return;
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
        id: body?.id || null,
        jsonrpc: "2.0"
      })
    );
    return;
  }
}

// Existing session lookup continues here...
if (sessionId && activeTransports[sessionId]) {
  transport = activeTransports[sessionId].transport;
  server = activeTransports[sessionId].server;
```

### 2. FastMCP Integration (FastMCP.js:927-960)

```javascript
this.#httpStreamServer = await startHTTPStreamServer({
  authenticate: this.#authenticate,  // NEW: Pass authenticate callback
  createServer: async (request) => {
    let auth;
    if (this.#authenticate) {
      auth = await this.#authenticate(request);
    }
    return new FastMCPSession({
      auth,
      // ... other options
    });
  },
  endpoint: options.httpStream.endpoint,
  onClose: (session) => { /* ... */ },
  onConnect: async (session) => { /* ... */ },
  port: options.httpStream.port,
  stateless: options.stateless  // NEW: Pass stateless flag
});
```

## Usage

Now you can use `stateless: true` and authentication will work correctly:

```typescript
await server.start({
  transportType: 'httpStream',
  httpStream: {
    port: 3000,
    endpoint: '/mcp'
  },
  stateless: true  // Authentication now called on EVERY request
});
```

## Testing

To test the fix:

1. Start the server:
   ```bash
   npm run build
   start-mcp-test.bat
   ```

2. Use the web test harness:
   - Open `test-harness/web-test/index.html` in browser
   - Get token from Keycloak
   - Exchange token for mcp-oauth audience
   - Connect to MCP server
   - Call tools (user-info, health-check, etc.)

Expected behavior:
- Initialize: Authenticates ✓
- Tool calls: Authenticates ✓ (THIS IS THE FIX)

## Verification

Check server logs for authentication output on BOTH initialize and tool calls:

```
[AUTH DEBUG] ========== Authentication Request ==========
[AUTH DEBUG] Request method: POST
[AUTH DEBUG] Request URL: /mcp
[AUTH DEBUG] Authorization: present
[JWT VALIDATOR] ✓ Token decoded successfully
[AUTH DEBUG] ✓ Successfully authenticated user: greynolds
```

These logs should appear for:
- Initialize request (was working before)
- Tools/call request (NOW FIXED)

## Important Notes

1. **This is a patch to node_modules** - Changes will be lost if you run `npm install` or `npm update`
2. **Not committed to git** - node_modules is in .gitignore
3. **Temporary fix** - The proper fix should be submitted to the FastMCP repository as a PR

## Restoring Original Files

If you need to restore the original libraries:

```bash
# Restore from backups
cp node_modules/mcp-proxy/dist/chunk-43AXMLZU.js.backup node_modules/mcp-proxy/dist/chunk-43AXMLZU.js
cp node_modules/fastmcp/dist/FastMCP.js.backup node_modules/fastmcp/dist/FastMCP.js

# Or reinstall from npm
npm install fastmcp@1.27.7 --force
npm install mcp-proxy@2.14.3 --force
```

## Next Steps

1. ✅ Submit bug report to FastMCP repository (see GITHUB-ISSUE.md)
2. ⏳ Test the fix with web-test harness
3. ⏳ Submit PR to FastMCP with the fix
4. ⏳ Update to official version when fix is released

## Related Files

- [FASTMCP-AUTHENTICATION-BUG.md](FASTMCP-AUTHENTICATION-BUG.md) - Detailed bug report
- [GITHUB-ISSUE.md](GITHUB-ISSUE.md) - GitHub issue format for submission