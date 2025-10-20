# Kerberos Delegation Test Client

Test harness for validating Kerberos Constrained Delegation (S4U2Self/S4U2Proxy) with MCP OAuth Server.

## Overview

This test client demonstrates the complete OAuth + Kerberos delegation flow:

1. **OAuth Authentication** - Obtain JWT from Keycloak
2. **Token Exchange** (Optional) - Exchange JWT for delegation token
3. **Kerberos Delegation** - Obtain Kerberos ticket on behalf of user
4. **Backend Access** - Use delegated ticket to access SQL Server/File Server

## Prerequisites

### Active Directory Configuration

Run the AD setup script on the Windows Server 2025 domain controller (192.168.1.25):

```powershell
# On 192.168.1.25
cd "C:\Path\To\MCP-Oauth"
.\scripts\setup-ad-kerberos.ps1 -DomainController "192.168.1.25" -Realm "COMPANY.COM"
```

This creates:
- Service account: `svc-mcp-server@COMPANY.COM`
- Test users: `alice`, `bob`, `charlie`
- SPNs: `HTTP/mcp-server`, `HTTP/mcp-server.company.com`
- Constrained delegation to SQL Server

### Keycloak Configuration

1. **Create User Attribute Mapper** (legacy_username claim)

   - Login to Keycloak Admin Console: http://192.168.1.25:8080
   - Navigate to: **Clients** → **mcp-client** → **Mappers** → **Create**
   - Configure mapper:
     - **Name:** `legacy_username`
     - **Mapper Type:** `User Attribute`
     - **User Attribute:** `sAMAccountName`
     - **Token Claim Name:** `legacy_username`
     - **Claim JSON Type:** `String`
     - **Add to ID token:** `ON`
     - **Add to access token:** `ON`
     - **Add to userinfo:** `ON`

2. **Configure Test Users with Legacy Username**

   - Navigate to: **Users** → Select user (e.g., `alice`)
   - Go to **Attributes** tab
   - Add attribute:
     - **Key:** `sAMAccountName`
     - **Value:** `ALICE` (uppercase, matching AD username)
   - Click **Save**

   Repeat for all test users:
   - `alice` → `ALICE`
   - `bob` → `BOB`
   - `charlie` → `CHARLIE`

3. **Configure Token Exchange (Optional)**

   - Navigate to: **Clients** → **mcp-server** (create if doesn't exist)
   - **Settings:**
     - **Client ID:** `mcp-server`
     - **Client Protocol:** `openid-connect`
     - **Access Type:** `confidential`
     - **Service Accounts Enabled:** `ON`
     - **Authorization Enabled:** `ON`
   - **Credentials Tab:**
     - Copy **Secret** and update [kerberos-test-config.json](../config/kerberos-test-config.json)
   - **Permissions Tab:**
     - Enable **token-exchange** permission

### MCP Server Configuration

1. **Install dependencies:**

   ```bash
   npm install kerberos --save
   npm install node-sspi --save  # Windows only
   ```

2. **Update configuration:**

   Edit [test-harness/config/kerberos-test-config.json](../config/kerberos-test-config.json):

   ```json
   {
     "kerberos": {
       "enabled": true,
       "domainController": "192.168.1.25",
       "servicePrincipalName": "HTTP/mcp-server",
       "realm": "COMPANY.COM",
       "serviceAccount": {
         "username": "svc-mcp-server",
         "password": "YourSecurePassword123!"
       }
     }
   }
   ```

3. **Start MCP Server:**

   ```bash
   npm run build
   set CONFIG_PATH=./test-harness/config/kerberos-test-config.json
   npm start
   ```

## Test Scenarios

### Scenario 1: Obtain Kerberos Ticket (S4U2Self)

**Purpose:** Verify MCP Server can obtain Kerberos ticket on behalf of user.

**Test User:** `alice` (ALICE@COMPANY.COM)

**Expected Flow:**
```
1. Client obtains JWT from Keycloak (legacy_username: "ALICE")
2. Client calls MCP tool: kerberos-delegate (action: s4u2self)
3. MCP Server validates JWT and extracts legacy_username
4. MCP Server performs S4U2Self to KDC (192.168.1.25)
5. KDC returns service ticket for ALICE@COMPANY.COM
6. MCP Server returns ticket to client
```

**Run Test:**

```bash
npm test -- scenario-1-s4u2self
```

**Expected Output:**
```json
{
  "success": true,
  "action": "s4u2self",
  "userPrincipal": "ALICE@COMPANY.COM",
  "ticket": {
    "principal": "ALICE@COMPANY.COM",
    "service": "svc-mcp-server@COMPANY.COM",
    "expiresAt": "2025-01-21T12:00:00Z"
  }
}
```

### Scenario 2: Delegate to SQL Server (S4U2Proxy)

**Purpose:** Verify MCP Server can obtain proxy ticket for SQL Server.

**Test User:** `alice`

**Target SPN:** `MSSQLSvc/sql01.company.com:1433`

**Expected Flow:**
```
1. Client obtains JWT from Keycloak
2. Client calls MCP tool: kerberos-delegate (action: s4u2proxy, targetSPN: MSSQLSvc/...)
3. MCP Server performs S4U2Self to get ALICE's ticket
4. MCP Server performs S4U2Proxy to get proxy ticket for SQL Server
5. KDC validates delegation target in svc-mcp-server's allowed list
6. KDC returns proxy ticket for ALICE → SQL Server
7. MCP Server can now connect to SQL Server as ALICE
```

**Run Test:**

```bash
npm test -- scenario-2-s4u2proxy
```

**Expected Output:**
```json
{
  "success": true,
  "action": "s4u2proxy",
  "userPrincipal": "ALICE@COMPANY.COM",
  "targetSPN": "MSSQLSvc/sql01.company.com:1433",
  "ticket": {
    "principal": "ALICE@COMPANY.COM",
    "targetService": "MSSQLSvc/sql01.company.com:1433",
    "delegatedFrom": "svc-mcp-server@COMPANY.COM",
    "expiresAt": "2025-01-21T12:00:00Z"
  }
}
```

### Scenario 3: Unauthorized Delegation (Negative Test)

**Purpose:** Verify delegation is rejected for unauthorized SPNs.

**Test User:** `alice`

**Target SPN:** `HTTP/unauthorized.company.com` (not in allowed list)

**Expected Flow:**
```
1. Client requests delegation to unauthorized SPN
2. MCP Server validates targetSPN against allowedDelegationTargets
3. Validation fails - SPN not in allowed list
4. MCP Server returns error without contacting KDC
```

**Run Test:**

```bash
npm test -- scenario-3-unauthorized
```

**Expected Output:**
```json
{
  "success": false,
  "error": "Target SPN not in allowed delegation targets: HTTP/unauthorized.company.com",
  "allowedTargets": [
    "MSSQLSvc/sql01.company.com:1433",
    "HTTP/api.company.com"
  ]
}
```

### Scenario 4: Missing Legacy Username (Negative Test)

**Purpose:** Verify delegation fails when JWT lacks `legacy_username` claim.

**Test User:** `modern-user` (no legacy_username attribute in Keycloak)

**Expected Flow:**
```
1. Client obtains JWT without legacy_username claim
2. Client calls kerberos-delegate tool
3. MCP Server validates session has legacyUsername
4. Validation fails - claim missing
5. MCP Server returns error with clear message
```

**Run Test:**

```bash
npm test -- scenario-4-missing-claim
```

**Expected Output:**
```json
{
  "success": false,
  "error": "User session missing legacy_username claim for Kerberos delegation",
  "requiredClaim": "legacy_username",
  "availableClaims": ["sub", "email", "roles"]
}
```

### Scenario 5: Ticket Caching

**Purpose:** Verify ticket cache improves performance.

**Test User:** `alice`

**Expected Flow:**
```
1. First request: Obtain ticket from KDC (slow: ~100-200ms)
2. Ticket cached in session-scoped cache
3. Second request (within TTL): Return cached ticket (fast: <1ms)
4. Wait for expiration: Automatic renewal before expiration
5. Verify renewed ticket returned
```

**Run Test:**

```bash
npm test -- scenario-5-caching
```

**Expected Metrics:**
```
First request latency: 150ms
Cached request latency: <1ms
Cache hit rate: 100%
Tickets renewed: 0
```

### Scenario 6: SQL Server Integration

**Purpose:** End-to-end test with real SQL Server connection.

**Prerequisites:**
- SQL Server running with Windows Authentication
- SQL Server SPN registered: `MSSQLSvc/sql01.company.com:1433`
- User `ALICE` has database permissions

**Expected Flow:**
```
1. Client requests SQL query via sql-delegate tool
2. MCP Server performs S4U2Self for ALICE
3. MCP Server performs S4U2Proxy for SQL Server
4. MCP Server connects to SQL Server using Kerberos ticket
5. SQL Server authenticates connection as ALICE@COMPANY.COM
6. Query executes with ALICE's permissions
7. Results returned to client
```

**Run Test:**

```bash
npm test -- scenario-6-sql-integration
```

**Expected Output:**
```json
{
  "success": true,
  "query": "SELECT SUSER_SNAME() AS CurrentUser",
  "result": [{
    "CurrentUser": "COMPANY\\ALICE"
  }],
  "delegation": {
    "userPrincipal": "ALICE@COMPANY.COM",
    "targetSPN": "MSSQLSvc/sql01.company.com:1433",
    "authMethod": "Kerberos"
  }
}
```

## Running All Tests

```bash
# Run all Kerberos delegation tests
npm test

# Run with verbose output
npm test -- --verbose

# Run specific test file
npm test -- kerberos-delegation.test.ts

# Run in watch mode
npm test -- --watch
```

## Manual Testing with PowerShell

Use the provided PowerShell script for interactive testing:

```powershell
cd test-harness\scripts
.\test-kerberos.ps1
```

**Script steps:**
1. Verify AD configuration
2. Obtain OAuth token from Keycloak
3. Call MCP Server with Kerberos delegation
4. Display results and verify ticket

## Manual Testing with curl

**Step 1: Obtain OAuth Token**

```bash
curl -X POST http://192.168.1.25:8080/realms/mcp-test/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password" \
  -d "client_id=mcp-client" \
  -d "username=alice" \
  -d "password=password" \
  -d "scope=openid profile"
```

**Step 2: Call MCP Server (S4U2Self)**

```bash
export ACCESS_TOKEN="<token-from-step-1>"

curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "kerberos-delegate",
      "arguments": {
        "action": "s4u2self",
        "resource": "kerberos"
      }
    },
    "id": 1
  }'
```

**Step 3: Call MCP Server (S4U2Proxy)**

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "kerberos-delegate",
      "arguments": {
        "action": "s4u2proxy",
        "targetSPN": "MSSQLSvc/sql01.company.com:1433",
        "resource": "kerberos"
      }
    },
    "id": 2
  }'
```

## Debugging

### Enable Kerberos Debug Logging

**Windows (MCP Server):**

```powershell
# Enable Kerberos event logging
reg add "HKLM\SYSTEM\CurrentControlSet\Control\Lsa\Kerberos\Parameters" /v LogLevel /t REG_DWORD /d 1 /f

# View Kerberos events
Get-WinEvent -LogName Security | Where-Object { $_.Id -eq 4768 -or $_.Id -eq 4769 } | Select-Object -First 10
```

**View current tickets:**

```powershell
# List all Kerberos tickets
klist

# Purge all tickets
klist purge
```

### Common Issues

#### Issue 1: "Kerberos ticket request failed: KDC_ERR_S_PRINCIPAL_UNKNOWN"

**Cause:** Service account SPN not registered

**Fix:**
```powershell
setspn -S HTTP/mcp-server svc-mcp-server
```

#### Issue 2: "User not allowed to delegate credentials"

**Cause:** Service account not configured for delegation

**Fix:**
```powershell
Set-ADUser -Identity svc-mcp-server -TrustedToAuthForDelegation $true
```

#### Issue 3: "Missing legacy_username claim"

**Cause:** Keycloak mapper not configured

**Fix:**
1. Configure Keycloak user attribute mapper (see prerequisites)
2. Add `sAMAccountName` attribute to user in Keycloak

#### Issue 4: "Clock skew too great"

**Cause:** Time difference > 5 minutes between MCP Server and KDC

**Fix:**
```powershell
# Windows
w32tm /resync /force

# Linux
sudo ntpdate 192.168.1.25
```

### Audit Logs

View Kerberos delegation audit logs:

```bash
# View all Kerberos delegation events
curl http://localhost:3000/mcp \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "audit-log",
      "arguments": {
        "limit": 50,
        "action": "kerberos:s4u2self"
      }
    },
    "id": 3
  }'
```

## Performance Metrics

Expected performance characteristics:

| Operation | Latency (p50) | Latency (p99) | Cache Hit |
|-----------|---------------|---------------|-----------|
| S4U2Self (cold) | 100ms | 200ms | N/A |
| S4U2Self (cached) | <1ms | 2ms | >85% |
| S4U2Proxy (cold) | 150ms | 300ms | N/A |
| S4U2Proxy (cached) | <1ms | 2ms | >85% |
| SQL Connection | 50ms | 100ms | N/A |

## Next Steps

After verifying Kerberos delegation:

1. **Integrate with SQL Server delegation tool**
   - Update sql-delegate to use Kerberos tickets
   - Test Windows Authentication flow

2. **Add file server delegation**
   - Implement file-delegate tool
   - Test SMB/CIFS access with delegated credentials

3. **Production hardening**
   - Use keytab files instead of passwords
   - Enable ticket encryption
   - Configure ticket renewal policies

## References

- [Kerberos Implementation Guide](../../docs/kerberos.md)
- [Active Directory Setup Script](../../scripts/setup-ad-kerberos.ps1)
- [MCP Server Configuration](../config/kerberos-test-config.json)
- [Microsoft Kerberos Constrained Delegation](https://learn.microsoft.com/en-us/windows-server/security/kerberos/kerberos-constrained-delegation-overview)
