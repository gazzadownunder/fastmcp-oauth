# Kerberos Testing Guide - Debug Edition

**Date:** 2025-01-20
**Status:** Ready for Testing with Enhanced Debug Logging

## Prerequisites

Before testing Kerberos tools, ensure:

1. ✅ **Server is running** with `test-harness\start-phase3-server.bat`
2. ✅ **Valid JWT token** with `legacy_name` claim from Keycloak
3. ⚠️ **Active Directory configured** (see below) - **NOT REQUIRED** for initial testing

## Tool Testing Order

### Step 1: Verify Server is Running

Start the server:
```batch
cd test-harness
start-phase3-server.bat
```

**Expected Output:**
```
[KERBEROS-MODULE] Initializing Kerberos delegation module
[KERBEROS-MODULE] Configuration: {...}
[KERBEROS-CLIENT] obtainServiceTicket() called
```

**If AD is NOT configured** (expected for initial testing):
```
✗ Kerberos initialization failed
  Error: Failed to connect to KDC at w25-dc.w25ad.net:88
  Continuing without Kerberos support...
```
This is **NORMAL** - the server continues with other modules.

### Step 2: Test Basic Authentication (No Kerberos)

**Tool:** `user-info`
**Purpose:** Verify JWT authentication works
**Requirements:** Valid JWT only

```bash
curl -X POST http://localhost:3010/mcp \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "user-info",
      "arguments": {}
    },
    "id": 1
  }'
```

**Expected Response:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "content": [{
      "type": "text",
      "text": {
        "userId": "alice@company.com",
        "legacyUsername": "ALICE",
        "roles": ["user"],
        "authenticated": true
      }
    }]
  },
  "id": 1
}
```

**✅ SUCCESS CRITERIA:** Response contains `legacyUsername` field
**❌ FAILURE:** Missing `legacyUsername` → JWT missing `legacy_name` claim (configure Keycloak mapper)

### Step 3: List Available Tools

**Tool:** MCP `tools/list`
**Purpose:** See which tools are available

```bash
curl -X POST http://localhost:3010/mcp \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/list",
    "id": 2
  }'
```

**Expected Tools (Kerberos-related):**
- `kerberos-delegate` - Get Kerberos tickets (visible if `legacyUsername` present)
- `kerberos-list-directory` - List files in SMB shares
- `kerberos-read-file` - Read files from SMB shares
- `kerberos-file-info` - Get file/folder metadata

**❌ If tools are missing:**
- Check `test-harness/config/phase3-test-config.json` line 145-147 (`"kerberos-*": true`)
- Check JWT has `legacy_name` claim

### Step 4: Test Kerberos Delegate Tool (Requires AD)

**Tool:** `kerberos-delegate`
**Purpose:** Obtain Kerberos tickets
**Requirements:** Active Directory configured + JWT with `legacy_name`

#### 4a. Get User Ticket (S4U2Self)

```bash
curl -X POST http://localhost:3010/mcp \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "kerberos-delegate",
      "arguments": {
        "action": "s4u2self"
      }
    },
    "id": 3
  }'
```

**Debug Output (Server Console):**
```
[KERBEROS-DELEGATE] Tool called
[KERBEROS-DELEGATE] Parameters: { "action": "s4u2self" }
[KERBEROS-DELEGATE] Session: { userId: "...", legacyUsername: "ALICE" }
[KERBEROS-MODULE] delegate() called
[KERBEROS-MODULE] User principal: ALICE@w25ad.net
[KERBEROS-CLIENT] performS4U2Self() called
```

**Expected Response (Success):**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "status": "success",
    "data": {
      "success": true,
      "action": "s4u2self",
      "userPrincipal": "ALICE@w25ad.net",
      "legacyUsername": "ALICE",
      "realm": "w25ad.net",
      "cached": false,
      "ticket": {
        "principal": "ALICE@w25ad.net",
        "service": "HTTP/mcp-server",
        "expiresAt": "2025-01-20T15:00:00.000Z"
      }
    }
  },
  "id": 3
}
```

**Expected Error (AD Not Configured):**
```json
{
  "result": {
    "status": "failure",
    "code": "MODULE_NOT_FOUND",
    "message": "Kerberos delegation module not available. Ensure kerberos.enabled=true in configuration and module initialized successfully."
  }
}
```

#### 4b. Get Proxy Ticket (S4U2Proxy)

```bash
curl -X POST http://localhost:3010/mcp \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "kerberos-delegate",
      "arguments": {
        "action": "s4u2proxy",
        "targetSPN": "cifs/192.168.1.25"
      }
    },
    "id": 4
  }'
```

### Step 5: Test File Browsing Tools (Requires AD + File Server)

**Tool:** `kerberos-list-directory`
**Purpose:** List files in Windows file share
**Requirements:** Active Directory + SMB file server + JWT with `legacy_name`

```bash
curl -X POST http://localhost:3010/mcp \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "kerberos-list-directory",
      "arguments": {
        "path": "//192.168.1.25/shared"
      }
    },
    "id": 5
  }'
```

**Debug Output:**
```
[KERBEROS-DELEGATE] Tool called (from kerberos-list-directory)
[KERBEROS-MODULE] Executing action: s4u2proxy
[KERBEROS-MODULE] Target SPN: cifs/192.168.1.25
```

**Expected Error (AD Not Configured):**
```json
{
  "result": {
    "content": [{
      "type": "text",
      "text": "{\"error\":\"SERVER_ERROR\",\"message\":\"An internal processing error occurred...\"}"
    }],
    "isError": true
  }
}
```

**Server Console Shows:**
```
[ERROR-HANDLER] Tool execution error in kerberos-list-directory
[ERROR-HANDLER] Error: [Actual error details]
[ERROR-HANDLER] Error type: [Error type]
[ERROR-HANDLER] Message: [Detailed message]
[ERROR-HANDLER] Stack: [Full stack trace]
```

## Understanding Debug Output

### Module Initialization (Server Startup)

**Success:**
```
[KERBEROS-MODULE] Initializing Kerberos delegation module
[KERBEROS-CLIENT] obtainServiceTicket() called
[KERBEROS-CLIENT] ✓ TGT obtained
[KERBEROS-MODULE] ✓ Service ticket obtained successfully
```

**Failure (Expected without AD):**
```
[KERBEROS-CLIENT] ✗ Failed to obtain service ticket:
[KERBEROS-CLIENT] Error details: {message: "...", stack: "..."}
```

### Tool Execution (Per Request)

**Step 1 - Tool Entry:**
```
[KERBEROS-DELEGATE] Tool called
[KERBEROS-DELEGATE] Parameters: {...}
[KERBEROS-DELEGATE] Session: {...}
```

**Step 2 - Module Delegation:**
```
[KERBEROS-MODULE] delegate() called
[KERBEROS-MODULE] Action: s4u2self
[KERBEROS-MODULE] User principal: ALICE@w25ad.net
```

**Step 3 - Kerberos Client:**
```
[KERBEROS-CLIENT] performS4U2Self() called
[KERBEROS-CLIENT] User principal: ALICE@w25ad.net
[KERBEROS-CLIENT] Username: ALICE
```

**Step 4 - Result:**
```
[KERBEROS-MODULE] ✓ Delegation successful
[KERBEROS-DELEGATE] Success - returning response
```

### Error Handling

**If error occurs:**
```
[ERROR-HANDLER] Tool execution error in kerberos-list-directory
[ERROR-HANDLER] Error: [Full error object]
[ERROR-HANDLER] Message: [Error message]
[ERROR-HANDLER] Stack: [Stack trace]
[ERROR-HANDLER] Params: {...}
[ERROR-HANDLER] User: alice@company.com
```

## Common Error Patterns

### Error 1: "Tool 'kerberos-delegate' execution failed: Required"

**Cause:** Tool receiving undefined parameters
**Debug:** Look for `[KERBEROS-DELEGATE] Parameters: undefined`
**Solution:** Check tool registration and schema validation

### Error 2: "MODULE_NOT_FOUND"

**Cause:** Kerberos module not registered or failed initialization
**Debug:**
```
[KERBEROS-DELEGATE] Kerberos module not registered
```
**Solution:** Check server startup logs for Kerberos initialization failure

### Error 3: "Missing legacy_username claim"

**Cause:** JWT doesn't have `legacy_name` claim
**Debug:**
```
[KERBEROS-DELEGATE] Session: { legacyUsername: undefined }
[KERBEROS-DELEGATE] Missing legacy_username claim
```
**Solution:** Configure Keycloak claim mapper:
- Mapper Type: User Attribute
- User Attribute: `sAMAccountName`
- Token Claim Name: `legacy_name`

### Error 4: SERVER_ERROR with No Details

**Cause:** Exception caught by handleToolError
**Debug:** Check server console for:
```
[ERROR-HANDLER] Tool execution error in [tool-name]
[ERROR-HANDLER] Error: [Actual error]
```
**Solution:** Read the detailed error in server console

## Active Directory Setup (For Full Testing)

### On Domain Controller (w25-dc.w25ad.net)

```powershell
# Run AD setup script
cd \\path\to\project
.\scripts\setup-ad-kerberos.ps1 `
  -ServiceAccountName "svc-mcp-server" `
  -ServiceAccountPassword "YourSecurePassword123!" `
  -ServicePrincipalName "HTTP/mcp-server" `
  -FileServerSPN "cifs/192.168.1.25" `
  -FileServerHostSPN "HOST/192.168.1.25"
```

### Verify AD Configuration

```powershell
# Check service account
Get-ADUser svc-mcp-server -Properties *

# Check SPNs
setspn -L svc-mcp-server

# Check delegation
Get-ADUser svc-mcp-server -Properties msDS-AllowedToDelegateTo | `
  Select -ExpandProperty msDS-AllowedToDelegateTo
```

## Keycloak Configuration

### Add legacy_name Claim Mapper

1. Open Keycloak Admin Console
2. Navigate to: Clients → `mcp-oauth` → Client Scopes → Mappers
3. Click "Create"
4. Configure:
   - **Name:** `legacy_username`
   - **Mapper Type:** User Attribute
   - **User Attribute:** `sAMAccountName`
   - **Token Claim Name:** `legacy_name`
   - **Claim JSON Type:** String
   - **Add to access token:** ✅ Yes

5. Test JWT:
```bash
# Decode JWT at jwt.io
# Should contain:
{
  "sub": "alice@company.com",
  "legacy_name": "ALICE",  // ← Required!
  "roles": ["user"]
}
```

## Testing Without Active Directory

You can test the **tool framework** without Active Directory:

### ✅ Works Without AD:
- `user-info` - Check JWT claims
- `tools/list` - List available tools
- Visibility of `kerberos-*` tools (if `legacy_name` in JWT)

### ❌ Requires AD:
- `kerberos-delegate` - Actual ticket acquisition
- `kerberos-list-directory` - File browsing
- `kerberos-read-file` - File reading
- `kerberos-file-info` - File metadata

**Expected behavior without AD:**
- Tools are **visible** in `tools/list` (if JWT has `legacy_name`)
- Tools return `MODULE_NOT_FOUND` error when called
- Server console shows detailed error from `[ERROR-HANDLER]`

## Troubleshooting Tips

1. **Always check server console** for debug output (not just API response)
2. **Look for ERROR-HANDLER logs** when you see SERVER_ERROR
3. **Verify JWT claims** with user-info tool first
4. **Check module initialization** in server startup logs
5. **Read full error messages** in ERROR-HANDLER output

## Quick Test Commands

```bash
# Set JWT token (replace with your actual token)
export JWT_TOKEN="eyJhbGci..."

# Test 1: Verify authentication
curl -X POST http://localhost:3010/mcp \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{"method":"tools/call","params":{"name":"user-info","arguments":{}}}' | jq

# Test 2: List tools
curl -X POST http://localhost:3010/mcp \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{"method":"tools/list"}' | jq '.result.tools[].name'

# Test 3: Try kerberos-delegate
curl -X POST http://localhost:3010/mcp \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{"method":"tools/call","params":{"name":"kerberos-delegate","arguments":{"action":"s4u2self"}}}' | jq
```

## Summary

**Correct Testing Order:**
1. ✅ Start server → Check console for initialization logs
2. ✅ Test `user-info` → Verify `legacyUsername` present
3. ✅ Test `tools/list` → Verify `kerberos-*` tools visible
4. ⚠️ Test `kerberos-delegate` → Requires AD (expect MODULE_NOT_FOUND without AD)
5. ⚠️ Test `kerberos-list-directory` → Requires AD + file server

**Key Point:** You'll see detailed errors in the **server console**, not just in the API response!
