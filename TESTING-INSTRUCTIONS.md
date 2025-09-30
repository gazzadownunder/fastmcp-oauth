# Testing Instructions - FastMCP Authentication Fix

## Summary of Fixes Applied

1. ✅ **Per-request authentication** - `authenticate()` now called on EVERY request (not just initialize)
2. ✅ **CORS headers fixed** - `Authorization` header explicitly allowed (no more CORS errors)
3. ✅ **Direct connection** - No proxy needed, connect directly to MCP server

## Quick Test

### 1. Restart the MCP Server

The server needs to be restarted to load the CORS fix:

**Option A: Close existing window and start fresh**
```bash
# Find the command window running the server and close it
# Then open new command window and run:
cd "C:\Users\gazza\Local Documents\GitHub\MCP Services\MCP-Oauth"
start-mcp-test.bat
```

**Option B: Kill and restart**
```bash
# Kill all node processes
taskkill /F /IM node.exe

# Start server
cd "C:\Users\gazza\Local Documents\GitHub\MCP Services\MCP-Oauth"
start-mcp-test.bat
```

You should see:
```
Starting MCP OAuth Server with TEST configuration...
[FastMCP info] server is running on HTTP Stream at http://localhost:3000/mcp
```

### 2. Open Web Test Harness

Open in browser:
```
file:///C:/Users/gazza/Local%20Documents/GitHub/MCP%20Services/MCP-Oauth/test-harness/web-test/index.html
```

Or navigate to:
```
test-harness/web-test/index.html
```

### 3. Test Flow

#### Step 1: Get Keycloak Token
1. Click **"Login with Keycloak"**
2. Should see: `✓ User is authenticated`
3. Subject token should appear in the text box

#### Step 2: Exchange Token
1. Click **"Exchange Token"**
2. Should see: `✓ Token exchange successful`
3. Exchanged token should appear with audience: `mcp-oauth`

#### Step 3: Connect to MCP
1. Exchanged token automatically used for connection
2. Should see:
   ```
   ✓ MCP Connected
   Protocol Version: 2024-11-05
   ```
3. **NO CORS errors** in browser console ✓

#### Step 4: Call Tools
Click any tool button:
- **Get User Info** - Returns current user session
- **Check Health** - Returns service health status
- **Execute Query** - Tests SQL delegation (requires SQL config)

Expected result for each:
```
✓ Tool execution successful
[Result displayed as JSON]
```

### 4. Verify Server Logs

Check the command window running the server. You should see authentication logs for **BOTH** initialize and tool calls:

**Initialize Request:**
```
[AUTH DEBUG] ========== Authentication Request ==========
[AUTH DEBUG] Request method: POST
[AUTH DEBUG] Request URL: /mcp
[AUTH DEBUG] Authorization: present
[JWT VALIDATOR] ✓ Token decoded successfully
[AUTH DEBUG] ✓ Successfully authenticated user: greynolds
```

**Tool Call Request:** (THIS IS THE FIX!)
```
[AUTH DEBUG] ========== Authentication Request ==========
[AUTH DEBUG] Request method: POST
[AUTH DEBUG] Request URL: /mcp
[AUTH DEBUG] Authorization: present
[JWT VALIDATOR] ✓ Token decoded successfully
[AUTH DEBUG] ✓ Successfully authenticated user: greynolds
[TOOL] user-info called
```

## Expected Behavior

### ✅ What Should Work

| Action | Expected Result |
|--------|----------------|
| Login with Keycloak | User authenticated, token received |
| Exchange token | New token with `aud: mcp-oauth` |
| Connect to MCP | 200 OK, no CORS errors |
| Call tools/list | Returns available tools |
| Call tools (user-info) | Returns user session |
| Call tools (health-check) | Returns health status |

### ❌ Common Issues

#### CORS Error Still Appearing
```
Access to fetch blocked by CORS policy: authorization not allowed
```
**Solution**: Server not restarted. Kill node.exe and restart.

#### 401 Unauthorized
```
Error: Unauthorized: Authentication failed
```
**Solution**:
- Check token is exchanged (must have `aud: mcp-oauth`)
- Check Keycloak is running (http://localhost:8080)
- Check token not expired

#### Connection Refused
```
TypeError: Failed to fetch
```
**Solution**: Server not running. Run `start-mcp-test.bat`

#### No Authentication Logs on Tool Calls
```
Only [AUTH DEBUG] on initialize, not on tools/call
```
**Solution**: Patch not applied correctly. Re-apply from PATCH-APPLIED.md

## Detailed Verification

### Check Browser Network Tab

1. Open Developer Tools (F12)
2. Go to Network tab
3. Click "Exchange Token" then "Connect to MCP"

**Initialize Request:**
```
Request URL: http://localhost:3000/mcp
Method: POST
Status: 200 OK

Request Headers:
  Authorization: Bearer eyJhbGci...
  Content-Type: application/json
  Accept: application/json, text/event-stream

Response Headers:
  Access-Control-Allow-Origin: http://localhost:8000
  Access-Control-Allow-Credentials: true
  Access-Control-Allow-Headers: Content-Type, Authorization, Accept, Mcp-Session-Id, Last-Event-Id
```

**Tool Call Request:**
```
Request URL: http://localhost:3000/mcp
Method: POST
Status: 200 OK

Request Headers:
  Authorization: Bearer eyJhbGci...  ← Same token
  Content-Type: application/json

Response Headers:
  [Same CORS headers]
```

### Check Server Logs

Authentication should appear for EVERY request:

```
[AUTH DEBUG] ========== Authentication Request ========== (initialize)
[JWT VALIDATOR] ✓ Token decoded successfully
[AUTH DEBUG] ✓ Successfully authenticated user: greynolds

[AUTH DEBUG] ========== Authentication Request ========== (tools/list)
[JWT VALIDATOR] ✓ Token decoded successfully
[AUTH DEBUG] ✓ Successfully authenticated user: greynolds

[AUTH DEBUG] ========== Authentication Request ========== (tools/call)
[JWT VALIDATOR] ✓ Token decoded successfully
[AUTH DEBUG] ✓ Successfully authenticated user: greynolds
[TOOL] user-info called
```

## Success Criteria

✅ All of these must be true:

1. No CORS errors in browser console
2. MCP connection succeeds (HTTP 200)
3. Tool calls return results (not 400/401 errors)
4. Server logs show `[AUTH DEBUG]` for ALL requests (not just initialize)
5. JWT validated on every request (check logs for `[JWT VALIDATOR]`)

## Troubleshooting

### Reset Everything

If nothing works, reset and start over:

```bash
# 1. Kill all node processes
taskkill /F /IM node.exe

# 2. Verify patches applied (should see .backup files)
dir node_modules\mcp-proxy\dist\*.backup
dir node_modules\fastmcp\dist\*.backup

# 3. Restart Keycloak if needed
# (Check http://localhost:8080)

# 4. Start MCP server
cd "C:\Users\gazza\Local Documents\GitHub\MCP Services\MCP-Oauth"
start-mcp-test.bat

# 5. Open web test in FRESH browser window (Ctrl+Shift+N for incognito)
# This avoids cached CORS errors

# 6. Go through test flow from step 1
```

### Verify Patches

Check that backup files exist:
```bash
dir node_modules\mcp-proxy\dist\chunk-43AXMLZU.js.backup
dir node_modules\fastmcp\dist\FastMCP.js.backup
```

If backups don't exist, patches weren't applied. See PATCH-APPLIED.md.

## What Changed vs Original Code

### Before Fixes
```
Initialize:  authenticate() called ✓
Tool calls:  authenticate() NOT called ✗
Result:      400 "No valid session ID provided"
CORS:        Authorization header blocked by wildcard *
```

### After Fixes
```
Initialize:  authenticate() called ✓
Tool calls:  authenticate() called ✓ (FIXED!)
Result:      200 Success
CORS:        Authorization header explicitly allowed ✓
```

## Documentation Files

- [PATCH-APPLIED.md](PATCH-APPLIED.md) - Complete technical details of authentication fix
- [CORS-FIX-APPLIED.md](CORS-FIX-APPLIED.md) - CORS wildcard issue and solution
- [PROXY-NO-LONGER-NEEDED.md](PROXY-NO-LONGER-NEEDED.md) - Why proxy is obsolete
- [GITHUB-ISSUE.md](GITHUB-ISSUE.md) - Bug report for FastMCP repository
- [FASTMCP-AUTHENTICATION-BUG.md](FASTMCP-AUTHENTICATION-BUG.md) - Detailed bug analysis

## Next Steps

Once testing confirms everything works:

1. ✅ Document results
2. ⏳ Submit bug report to FastMCP (using GITHUB-ISSUE.md)
3. ⏳ Consider submitting PR with the fix
4. ⏳ Archive/remove proxy files (no longer needed)

## Questions?

If you encounter issues not covered here, check:
1. Server logs in command window
2. Browser console (F12)
3. Browser Network tab (F12 → Network)
4. PATCH-APPLIED.md for technical details