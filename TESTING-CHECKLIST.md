# Testing Checklist - Complete Flow

## Current Status

✅ **Authentication fix applied** - JWT validated on every request
✅ **CORS fix applied** - Authorization and session headers allowed
✅ **Client updated** - Captures session ID, sends on requests
✅ **Logging added** - Debug output in client

❌ **Server not running** - Need to start manually

## Step-by-Step Testing

### Step 1: Start the Server

**Open a NEW command prompt window:**

```bash
cd "C:\Users\gazza\Local Documents\GitHub\MCP Services\MCP-Oauth"
set NODE_ENV=development
set CONFIG_PATH=config/oauth-obo-test.json
set SERVER_PORT=3000
set MCP_ENDPOINT=/mcp
node dist/start-server.js
```

**Expected output:**
```
[FastMCP info] server is running on HTTP Stream at http://localhost:3000/mcp
✓ Server is ready!
```

**Keep this window open!** The server logs will appear here.

### Step 2: Verify Server Is Running

In another command prompt:

```bash
curl -X OPTIONS http://localhost:3000/mcp -H "Origin: http://localhost:8000" -v
```

**Expected:** Should return 204 with CORS headers

Or check with:
```bash
netstat -ano | findstr :3000
```

Should show `LISTENING`

### Step 3: Open Web Test Harness

Open in browser (Chrome recommended):
```
C:\Users\gazza\Local Documents\GitHub\MCP Services\MCP-Oauth\test-harness\web-test\index.html
```

Or navigate to:
```
file:///C:/Users/gazza/Local%20Documents/GitHub/MCP%20Services/MCP-Oauth/test-harness/web-test/index.html
```

### Step 4: Open Browser Console

Press `F12` to open Developer Tools, go to **Console** tab.

You'll see all the debug logging here.

### Step 5: Login with Keycloak

1. Click **"Login with Keycloak"** button
2. Should redirect to Keycloak (http://localhost:8080)
3. Login if needed (username: your-user, password: your-password)
4. Should redirect back to test harness

**Expected in console:**
```
User is authenticated
```

### Step 6: Exchange Token

1. Click **"Exchange Token"** button
2. Watch console output

**Expected in console:**
```
Token exchange endpoint: http://localhost:8080/realms/mcp_security/protocol/openid-connect/token
Exchange parameters: {grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange', ...}
✓ Token exchange successful
```

**Check exchanged token:**
- Should have `aud: ["mcp-oauth"]`
- Should have `azp: "mcp-oauth"`

### Step 7: Connect to MCP

This happens automatically after token exchange, or click **"Connect to MCP"**.

**Expected in browser console:**
```
[MCP CLIENT] Connecting to http://localhost:3000/mcp
[MCP CLIENT] Using dummy session ID: stateless-session
[MCP CLIENT] Request headers: {Content-Type: 'application/json', ...}
[MCP CLIENT] Sending request: {jsonrpc: '2.0', id: 1, method: 'initialize', ...}
[MCP CLIENT] Response status: 200
[MCP CLIENT] Captured session ID from header: <some-id>
[MCP CLIENT] Connected with session: <some-id>
✓ MCP Connected
```

**Expected in server window:**
```
[AUTH DEBUG] ========== Authentication Request ==========
[AUTH DEBUG] Request method: POST
[AUTH DEBUG] Request URL: /mcp
[AUTH DEBUG] Authorization: present
[JWT VALIDATOR] ✓ Token decoded successfully
[JWT VALIDATOR] Issuer: http://localhost:8080/realms/mcp_security
[JWT VALIDATOR] Audience: [ 'account', 'mcp-oauth' ]
[JWT VALIDATOR] Authorized Party (azp): mcp-oauth ✓
[AUTH DEBUG] ✓ Successfully authenticated user: greynolds
```

### Step 8: Call a Tool

Click any tool button:
- **"Get User Info"**
- **"Check Health"**

**Expected in browser console:**
```
[MCP CLIENT] Using existing session ID: <some-id>
[MCP CLIENT] Sending request: {jsonrpc: '2.0', id: 2, method: 'tools/call', ...}
[MCP CLIENT] Response status: 200
Tool response: {...}
```

**Expected in server window:**
```
[AUTH DEBUG] ========== Authentication Request ========== (again!)
[AUTH DEBUG] Request method: POST
[JWT VALIDATOR] ✓ Token decoded successfully
[AUTH DEBUG] ✓ Successfully authenticated user: greynolds
[TOOL] user-info called
```

## What Could Go Wrong

### Issue 1: Server Not Running

**Symptom:** Browser console shows:
```
POST http://localhost:3000/mcp net::ERR_CONNECTION_REFUSED
```

**Fix:** Start the server (Step 1)

### Issue 2: Wrong Config File

**Symptom:** Server window shows:
```
Failed to load configuration: ENOENT: no such file or directory
```

**Fix:** Check CONFIG_PATH is set to `config/oauth-obo-test.json`

### Issue 3: CORS Errors

**Symptom:** Browser console shows:
```
Access to fetch blocked by CORS policy
```

**Fix:**
1. Server must be restarted to load CORS fix
2. Check server is running on port 3000
3. Check browser is accessing `http://localhost:8000` (via Live Server or similar)

### Issue 4: 401 Unauthorized

**Symptom:** Response status 401

**Fix:**
1. Check token is exchanged (must have `aud: mcp-oauth`)
2. Check Keycloak is running
3. Check token not expired

### Issue 5: 400 Bad Request - No Session ID

**Symptom:**
```
Bad Request: No valid session ID provided
```

**Fix:**
1. Refresh browser to load updated mcp-client.js
2. Check browser console for "[MCP CLIENT] Using dummy session ID"
3. If not showing, hard refresh (Ctrl+Shift+R)

### Issue 6: Authentication Not Called on Tool Calls

**Symptom:** Server logs show `[AUTH DEBUG]` only for initialize, not for tools/call

**Fix:** The authentication fix wasn't applied correctly. Check:
```bash
grep "stateless && authenticate" "node_modules/mcp-proxy/dist/chunk-43AXMLZU.js"
```

Should find the authentication logic we added.

## Success Criteria

All of these must be true:

✅ Server starts without errors
✅ Browser connects to MCP (initialize succeeds)
✅ Session ID captured from response header
✅ Tool calls succeed (200 OK)
✅ Server logs show `[AUTH DEBUG]` for BOTH initialize AND tool calls
✅ JWT validated on every request (check logs)
✅ No CORS errors in browser console

## Key Log Messages

### Client (Browser Console)

```
[MCP CLIENT] Using dummy session ID: stateless-session     ← First request
[MCP CLIENT] Captured session ID from header: abc-123      ← After initialize
[MCP CLIENT] Using existing session ID: abc-123            ← Tool calls
```

### Server (Command Window)

```
[AUTH DEBUG] ========== Authentication Request ==========   ← Every request!
[JWT VALIDATOR] ✓ Token decoded successfully                ← Every request!
[AUTH DEBUG] ✓ Successfully authenticated user: greynolds   ← Every request!
```

## Files to Check

If things aren't working, verify these files have the changes:

1. **test-harness/web-test/mcp-client.js**
   - Line ~74: `headers['Mcp-Session-Id'] = 'stateless-session';`
   - Line ~86: `const sessionIdFromHeader = response.headers.get('Mcp-Session-Id');`

2. **node_modules/mcp-proxy/dist/chunk-43AXMLZU.js**
   - Line ~172: `res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");`
   - Line ~192: `if (stateless && authenticate) {`

3. **node_modules/fastmcp/dist/FastMCP.js**
   - Line ~928: `authenticate: this.#authenticate,`
   - Line ~959: `stateless: options.stateless`

## Documentation

- [PROPER-SESSION-HANDLING.md](PROPER-SESSION-HANDLING.md) - How session ID capture works
- [START-SERVER-INSTRUCTIONS.md](START-SERVER-INSTRUCTIONS.md) - Detailed server startup guide
- [PATCH-APPLIED.md](PATCH-APPLIED.md) - Authentication fix details
- [CORS-FIX-APPLIED.md](CORS-FIX-APPLIED.md) - CORS headers fix

## Next Steps After Success

Once everything works:

1. Document the working configuration
2. Submit bug report to FastMCP (use [GITHUB-ISSUE.md](GITHUB-ISSUE.md))
3. Consider whether to keep the proxy files (probably remove them)
4. Test with real SQL delegation queries