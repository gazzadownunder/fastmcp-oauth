# Kerberos Delegation - Quick Start Guide

**Use Case:** File Server Access with Kerberos Delegation
**Target:** Windows File Shares on 192.168.1.25 via SMB/CIFS

---

## Overview

This guide walks you through setting up and testing Kerberos Constrained Delegation for **file server access**. The MCP Server will obtain Kerberos tickets on behalf of users to access Windows file shares with the user's permissions.

```
User (alice) → OAuth JWT → MCP Server → Kerberos Delegation → File Server
                                              (S4U2Self + S4U2Proxy)
                                                      ↓
                             File Server sees connection from ALICE
                             ALICE's file permissions applied
```

---

## Step 1: Configure Active Directory (One-time setup)

Run this on your Windows Server 2025 domain controller (192.168.1.25):

```powershell
# On 192.168.1.25 as Administrator
cd "C:\Path\To\MCP-Oauth"
.\scripts\setup-ad-kerberos.ps1 -DomainController "192.168.1.25" -Realm "COMPANY.COM"
```

**This creates:**
- ✅ Service account: `svc-mcp-server@COMPANY.COM`
- ✅ SPNs: `HTTP/mcp-server`, `HTTP/localhost`
- ✅ Constrained delegation to file server SPNs:
  - `cifs/192.168.1.25` (SMB file shares)
  - `HOST/192.168.1.25` (generic host services)
  - `cifs/fileserver.company.com`
  - `HOST/fileserver.company.com`
- ✅ Test users: `alice`, `bob`, `charlie`

**Verify delegation configuration:**
```powershell
Get-ADUser -Identity svc-mcp-server -Properties msDS-AllowedToDelegateTo |
  Select-Object -ExpandProperty msDS-AllowedToDelegateTo
```

**Expected output:**
```
cifs/192.168.1.25
HOST/192.168.1.25
cifs/fileserver.company.com
HOST/fileserver.company.com
```

---

## Step 2: Configure Keycloak (One-time setup)

### A. Create `legacy_name` User Attribute Mapper

1. Login to Keycloak Admin Console: http://localhost:8080
2. Navigate to: **Clients** → **mcp-client** (or your client ID)
3. Go to **Mappers** tab → Click **Create**
4. Configure:
   - **Name:** `legacy_username`
   - **Mapper Type:** `User Attribute`
   - **User Attribute:** `sAMAccountName`
   - **Token Claim Name:** `legacy_name`
   - **Claim JSON Type:** `String`
   - **Add to ID token:** ✅ ON
   - **Add to access token:** ✅ ON
   - **Add to userinfo:** ✅ ON
5. Click **Save**

### B. Set User Attributes

For each test user, add the `sAMAccountName` attribute:

1. Navigate to: **Users** → Select user (e.g., `alice`)
2. Go to **Attributes** tab
3. Add attribute:
   - **Key:** `sAMAccountName`
   - **Value:** `ALICE` (uppercase, matching AD username)
4. Click **Save**

Repeat for:
- `alice` → `ALICE`
- `bob` → `BOB`
- `charlie` → `CHARLIE`

---

## Step 3: Start Kerberos-Enabled Server

### Option A: Using Dedicated Kerberos Configuration (Recommended)

```cmd
cd test-harness
start-kerberos-server.bat
```

This uses [config/phase3-kerberos-enabled.json](config/phase3-kerberos-enabled.json) with Kerberos already enabled.

### Option B: Enable Kerberos in Phase 3 Config

Edit [config/phase3-test-config.json](config/phase3-test-config.json):

```json
{
  "delegation": {
    "modules": {
      "kerberos": {
        "enabled": true  // ← Change from false to true
      }
    }
  },
  "mcp": {
    "enabledTools": {
      "kerberos-delegate": true  // ← Change from false to true
    }
  }
}
```

Then start:
```cmd
cd test-harness
start-phase3-server.bat
```

---

## Step 4: Verify Server Startup

**Expected output when Kerberos is enabled:**

```
[3/3] Checking for delegation modules...
      Kerberos delegation module detected in config
      Initializing Kerberos connection to KDC...
      Domain Controller: 192.168.1.25
      Realm: COMPANY.COM
      Service Principal: HTTP/mcp-server
✓     Kerberos service ticket (TGT) obtained
      Allowed delegation targets:
        - cifs/192.168.1.25
        - HOST/192.168.1.25
        - cifs/fileserver.company.com
        - HOST/fileserver.company.com
      Ticket cache enabled:
        TTL: 3600s
        Renewal threshold: 300s
✓     Kerberos delegation module registered

Available Tools:
  • health-check      - Check delegation service health
  • user-info         - Get current user session info
  • kerberos-delegate - Obtain Kerberos tickets (S4U2Self/S4U2Proxy)
```

**If you see an error:**
```
✗     Kerberos initialization failed
      Error: Failed to obtain service ticket: ...

      Common issues:
        • KDC (Active Directory) not reachable at configured address
        • Service account credentials invalid
        • Service account not configured for delegation (run setup-ad-kerberos.ps1)
        • Kerberos library not installed (npm install kerberos)

      Continuing without Kerberos support...
```

→ Check Active Directory configuration and network connectivity to 192.168.1.25:88

---

## Step 5: Test Kerberos Delegation

### Test 1: Verify `legacy_name` Claim

```powershell
# Get JWT token from Keycloak
$tokenResponse = Invoke-RestMethod -Method Post `
  -Uri "http://localhost:8080/realms/mcp_security/protocol/openid-connect/token" `
  -Body @{
    grant_type = "password"
    client_id = "mcp-client"
    username = "alice"
    password = "password"
    scope = "openid profile"
  }

$token = $tokenResponse.access_token

# Check user info
$userInfo = Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3010/mcp" `
  -Headers @{
    "Authorization" = "Bearer $token"
    "Content-Type" = "application/json"
  } `
  -Body (@{
    jsonrpc = "2.0"
    method = "tools/call"
    params = @{
      name = "user-info"
      arguments = @{}
    }
    id = 1
  } | ConvertTo-Json)

$userInfo.result
```

**Expected output:**
```
userId          : alice@mcp_security
legacyUsername  : ALICE
roles           : {user, authenticated}
sessionId       : session-abc123
```

✅ **Verify `legacyUsername` is "ALICE"** - This is required for Kerberos delegation!

### Test 2: S4U2Self - Obtain User Ticket

```powershell
# Obtain Kerberos ticket for ALICE
$s4u2selfResult = Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3010/mcp" `
  -Headers @{
    "Authorization" = "Bearer $token"
    "Content-Type" = "application/json"
  } `
  -Body (@{
    jsonrpc = "2.0"
    method = "tools/call"
    params = @{
      name = "kerberos-delegate"
      arguments = @{
        action = "s4u2self"
      }
    }
    id = 2
  } | ConvertTo-Json)

$s4u2selfResult.result
```

**Expected output:**
```json
{
  "success": true,
  "action": "s4u2self",
  "userPrincipal": "ALICE@COMPANY.COM",
  "cached": false,
  "ticket": {
    "principal": "ALICE@COMPANY.COM",
    "service": "HTTP/mcp-server@COMPANY.COM",
    "expiresAt": "2025-01-21T12:00:00Z",
    "flags": ["FORWARDABLE", "PROXIABLE"]
  }
}
```

### Test 3: S4U2Proxy - Delegate to File Server

```powershell
# Obtain proxy ticket for file server access
$s4u2proxyResult = Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3010/mcp" `
  -Headers @{
    "Authorization" = "Bearer $token"
    "Content-Type" = "application/json"
  } `
  -Body (@{
    jsonrpc = "2.0"
    method = "tools/call"
    params = @{
      name = "kerberos-delegate"
      arguments = @{
        action = "s4u2proxy"
        targetSPN = "cifs/192.168.1.25"
      }
    }
    id = 3
  } | ConvertTo-Json)

$s4u2proxyResult.result
```

**Expected output:**
```json
{
  "success": true,
  "action": "s4u2proxy",
  "userPrincipal": "ALICE@COMPANY.COM",
  "targetSPN": "cifs/192.168.1.25",
  "cached": true,
  "ticket": {
    "principal": "ALICE@COMPANY.COM",
    "service": "HTTP/mcp-server",
    "targetService": "cifs/192.168.1.25@COMPANY.COM",
    "delegatedFrom": "svc-mcp-server@COMPANY.COM",
    "expiresAt": "2025-01-21T12:00:00Z",
    "flags": ["FORWARDED"]
  }
}
```

✅ **You now have a Kerberos ticket to access the file server as ALICE!**

### Test 4: Performance - Ticket Caching

Run S4U2Self twice to see caching in action:

```powershell
# First request (cold - hits KDC)
Measure-Command {
  Invoke-RestMethod -Method Post -Uri "http://localhost:3010/mcp" `
    -Headers @{ "Authorization" = "Bearer $token"; "Content-Type" = "application/json" } `
    -Body '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"kerberos-delegate","arguments":{"action":"s4u2self"}},"id":1}'
} | Select-Object TotalMilliseconds

# Second request (warm - cache hit)
Measure-Command {
  Invoke-RestMethod -Method Post -Uri "http://localhost:3010/mcp" `
    -Headers @{ "Authorization" = "Bearer $token"; "Content-Type" = "application/json" } `
    -Body '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"kerberos-delegate","arguments":{"action":"s4u2self"}},"id":2}'
} | Select-Object TotalMilliseconds
```

**Expected performance:**
- First request: 100-200ms (Kerberos round-trip)
- Second request: <2ms (cache hit)
- **Speedup: 100x faster!** ⚡

---

## Troubleshooting

### Issue 1: "Kerberos initialization failed: KDC_ERR_S_PRINCIPAL_UNKNOWN"

**Cause:** Service account SPN not registered in Active Directory

**Fix:**
```powershell
# On 192.168.1.25
setspn -S HTTP/mcp-server svc-mcp-server
setspn -L svc-mcp-server  # Verify
```

### Issue 2: "User session missing legacy_username claim"

**Cause:** Keycloak not configured to include `legacy_name` in JWT

**Fix:** Follow Step 2 above to configure Keycloak mapper

### Issue 3: "Target SPN not in allowed delegation targets"

**Cause:** Trying to delegate to SPN not configured in AD

**Fix:**
```powershell
# On 192.168.1.25
Set-ADUser -Identity svc-mcp-server -Add @{'msDS-AllowedToDelegateTo' = 'cifs/192.168.1.25'}
```

### Issue 4: "Clock skew too great"

**Cause:** Time difference > 5 minutes between MCP Server and KDC

**Fix:**
```powershell
# Sync time with domain controller
w32tm /resync /force
```

---

## File Access Patterns

Once you have the Kerberos ticket, you can use it to access Windows file shares:

### Example: List Files on Share

```javascript
// Pseudo-code for file access tool (to be implemented)
const ticket = await kerberosDelegate({ action: 's4u2proxy', targetSPN: 'cifs/192.168.1.25' });

// Use ticket to authenticate SMB connection
const files = await listFilesWithKerberos('\\\\192.168.1.25\\SharedFolder', ticket);
// Files are accessed with ALICE's permissions
```

### Example: Read File Contents

```javascript
const ticket = await kerberosDelegate({ action: 's4u2proxy', targetSPN: 'cifs/192.168.1.25' });
const content = await readFileWithKerberos('\\\\192.168.1.25\\SharedFolder\\document.txt', ticket);
// File permissions checked as ALICE
```

---

## Configuration Files

- **Kerberos-Only:** [config/phase3-kerberos-enabled.json](config/phase3-kerberos-enabled.json)
- **Phase 3 (Kerberos disabled by default):** [config/phase3-test-config.json](config/phase3-test-config.json)
- **AD Setup Script:** [../scripts/setup-ad-kerberos.ps1](../scripts/setup-ad-kerberos.ps1)

---

## Next Steps

1. ✅ Configure Active Directory (Step 1)
2. ✅ Configure Keycloak (Step 2)
3. ✅ Start server with Kerberos enabled (Step 3)
4. ✅ Test delegation (Steps 5)
5. 🚧 Implement file access MCP tool using delegated tickets
6. 🚧 Add file browser UI component

For detailed implementation guide, see [../docs/kerberos.md](../docs/kerberos.md)

For Phase 3 integration details, see [KERBEROS-PHASE3-INTEGRATION.md](KERBEROS-PHASE3-INTEGRATION.md)
