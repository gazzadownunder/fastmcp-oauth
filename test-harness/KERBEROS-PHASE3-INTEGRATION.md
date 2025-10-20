# Kerberos Delegation - Phase 3 Integration Guide

**Status:** Ready for Testing
**Configuration:** [test-harness/config/phase3-test-config.json](config/phase3-test-config.json)
**Server Script:** [test-harness/start-phase3-server.bat](start-phase3-server.bat)

---

## Overview

The Phase 3 test server now supports **Kerberos Constrained Delegation** alongside PostgreSQL delegation. This enables testing of:

- **S4U2Self** - Obtain Kerberos tickets on behalf of users
- **S4U2Proxy** - Delegate to backend services (SQL Server, File Server, etc.)
- **Ticket Caching** - Performance optimization with session-scoped caching
- **Multi-Delegation** - PostgreSQL + Kerberos in the same server

---

## Quick Start

### 1. Configure Active Directory

Run the AD configuration script on your Windows Server 2025 (192.168.1.25):

```powershell
# On 192.168.1.25
cd "C:\Path\To\MCP-Oauth"
.\scripts\setup-ad-kerberos.ps1 -DomainController "192.168.1.25" -Realm "COMPANY.COM"
```

This creates:
- Service account: `svc-mcp-server@COMPANY.COM`
- Test users: `alice`, `bob`, `charlie`
- SPNs: `HTTP/mcp-server`, `HTTP/localhost`
- Constrained delegation enabled

### 2. Enable Kerberos in Phase 3 Configuration

Edit [test-harness/config/phase3-test-config.json](config/phase3-test-config.json):

```json
{
  "delegation": {
    "modules": {
      "kerberos": {
        "enabled": true,  // ← Change from false to true
        "domainController": "192.168.1.25",
        "servicePrincipalName": "HTTP/mcp-server",
        "realm": "COMPANY.COM",
        "serviceAccount": {
          "username": "svc-mcp-server",
          "password": "YourSecurePassword123!"
        }
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

### 3. Start Phase 3 Server

```cmd
cd test-harness
start-phase3-server.bat
```

**Expected Output:**
```
[3/3] Checking for delegation modules...
      Kerberos delegation module detected in config
      Initializing Kerberos connection to KDC...
      Domain Controller: 192.168.1.25
      Realm: COMPANY.COM
      Service Principal: HTTP/mcp-server
✓     Kerberos service ticket (TGT) obtained
      Allowed delegation targets:
        - MSSQLSvc/sql01.company.com:1433
        - HTTP/api.company.com
      Ticket cache enabled:
        TTL: 3600s
        Renewal threshold: 300s
✓     Kerberos delegation module registered

Available Tools:
  • health-check      - Check delegation service health
  • user-info         - Get current user session info
  • sql-delegate      - Execute SQL queries with positional params ($1, $2, etc.)
  • kerberos-delegate - Obtain Kerberos tickets (S4U2Self/S4U2Proxy)
```

---

## Testing Kerberos Delegation

### Test 1: User Info (Verify legacy_username Claim)

```powershell
# Get JWT from Keycloak
$token = (Invoke-RestMethod -Method Post `
  -Uri "http://localhost:8080/realms/mcp_security/protocol/openid-connect/token" `
  -Body @{
    grant_type = "password"
    client_id = "mcp-client"
    username = "alice"
    password = "password"
    scope = "openid profile"
  }).access_token

# Check user info
Invoke-RestMethod -Method Post -Uri "http://localhost:3010/mcp" `
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
```

**Expected Response:**
```json
{
  "result": {
    "userId": "alice@company.com",
    "legacyUsername": "ALICE",
    "roles": ["user", "authenticated"],
    "sessionId": "session-123"
  }
}
```

**✓ Verify `legacyUsername` is present** - This is required for Kerberos delegation.

### Test 2: S4U2Self (Obtain User Ticket)

```powershell
# Obtain Kerberos ticket for ALICE
Invoke-RestMethod -Method Post -Uri "http://localhost:3010/mcp" `
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
```

**Expected Response:**
```json
{
  "result": {
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
}
```

### Test 3: S4U2Proxy (Delegate to SQL Server)

```powershell
# Obtain proxy ticket for SQL Server
Invoke-RestMethod -Method Post -Uri "http://localhost:3010/mcp" `
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
        targetSPN = "MSSQLSvc/sql01.company.com:1433"
      }
    }
    id = 3
  } | ConvertTo-Json)
```

**Expected Response:**
```json
{
  "result": {
    "success": true,
    "action": "s4u2proxy",
    "userPrincipal": "ALICE@COMPANY.COM",
    "targetSPN": "MSSQLSvc/sql01.company.com:1433",
    "cached": true,
    "ticket": {
      "principal": "ALICE@COMPANY.COM",
      "service": "HTTP/mcp-server",
      "targetService": "MSSQLSvc/sql01.company.com:1433@COMPANY.COM",
      "delegatedFrom": "svc-mcp-server@COMPANY.COM",
      "expiresAt": "2025-01-21T12:00:00Z",
      "flags": ["FORWARDED"]
    }
  }
}
```

### Test 4: Ticket Caching (Performance)

Run the same S4U2Self request twice:

```powershell
# First request (cache miss - slow)
Measure-Command {
  Invoke-RestMethod -Method Post -Uri "http://localhost:3010/mcp" `
    -Headers @{ "Authorization" = "Bearer $token"; "Content-Type" = "application/json" } `
    -Body '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"kerberos-delegate","arguments":{"action":"s4u2self"}},"id":1}'
}

# Second request (cache hit - fast)
Measure-Command {
  Invoke-RestMethod -Method Post -Uri "http://localhost:3010/mcp" `
    -Headers @{ "Authorization" = "Bearer $token"; "Content-Type" = "application/json" } `
    -Body '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"kerberos-delegate","arguments":{"action":"s4u2self"}},"id":2}'
}
```

**Expected Performance:**
- First request: 100-200ms (Kerberos KDC round-trip)
- Second request: <2ms (cache hit)
- **Speedup: 100x faster** ⚡

---

## Configuration Options

### Kerberos Module Configuration

```json
{
  "delegation": {
    "modules": {
      "kerberos": {
        "enabled": true,
        "domainController": "192.168.1.25",
        "servicePrincipalName": "HTTP/mcp-server",
        "realm": "COMPANY.COM",
        "kdc": "192.168.1.25:88",
        "enableS4U2Self": true,
        "enableS4U2Proxy": true,
        "allowedDelegationTargets": [
          "MSSQLSvc/sql01.company.com:1433",
          "HTTP/api.company.com"
        ],
        "serviceAccount": {
          "username": "svc-mcp-server",
          "password": "YourSecurePassword123!",
          "_comment_keytabPath": "/etc/keytabs/mcp-server.keytab"
        },
        "ticketCache": {
          "enabled": true,
          "ttlSeconds": 3600,
          "renewThresholdSeconds": 300,
          "maxEntriesPerSession": 10,
          "sessionTimeoutMs": 900000
        }
      }
    }
  }
}
```

### MCP Tools Configuration

```json
{
  "mcp": {
    "enabledTools": {
      "kerberos-delegate": true
    }
  }
}
```

---

## Troubleshooting

### Issue 1: "Kerberos initialization failed"

**Symptoms:**
```
✗     Kerberos initialization failed
      Error: Failed to obtain service ticket: KDC_ERR_S_PRINCIPAL_UNKNOWN
```

**Causes:**
- Service account not created in Active Directory
- Service account SPN not registered
- Domain controller not reachable

**Fix:**
```powershell
# Verify service account exists
Get-ADUser -Identity svc-mcp-server

# Verify SPNs registered
setspn -L svc-mcp-server

# Test connectivity to KDC
Test-NetConnection -ComputerName 192.168.1.25 -Port 88
```

### Issue 2: "User session missing legacy_username claim"

**Symptoms:**
```json
{
  "error": {
    "message": "User session missing legacy_username claim for Kerberos delegation"
  }
}
```

**Cause:** Keycloak not configured to include `legacy_name` claim in JWT

**Fix:**
1. Login to Keycloak Admin Console
2. Navigate to: **Clients** → **mcp-client** → **Mappers** → **Create**
3. Configure:
   - Name: `legacy_username`
   - Mapper Type: `User Attribute`
   - User Attribute: `sAMAccountName`
   - Token Claim Name: `legacy_name`
   - Add to access token: **ON**
4. Set user attribute: **Users** → **alice** → **Attributes** → Add `sAMAccountName = ALICE`

### Issue 3: "Target SPN not in allowed delegation targets"

**Symptoms:**
```json
{
  "error": {
    "message": "Target SPN not in allowed delegation targets: HTTP/unauthorized.com"
  }
}
```

**Cause:** Trying to delegate to SPN not in configuration

**Fix:** Add SPN to `allowedDelegationTargets` in configuration:

```json
{
  "allowedDelegationTargets": [
    "MSSQLSvc/sql01.company.com:1433",
    "HTTP/api.company.com",
    "HTTP/unauthorized.com"  // ← Add this
  ]
}
```

---

## Multi-Delegation Architecture

Phase 3 server supports both PostgreSQL and Kerberos delegation simultaneously:

```
┌─────────────────────────────────────────────────────────────┐
│                    Phase 3 Test Server                       │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Delegation Registry                                    │ │
│  │  - PostgreSQL Module (token exchange + SET ROLE)       │ │
│  │  - Kerberos Module (S4U2Self + S4U2Proxy)              │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  MCP Tools                                              │ │
│  │  • sql-delegate      → PostgreSQL Module               │ │
│  │  • kerberos-delegate → Kerberos Module                 │ │
│  │  • health-check      → All Modules                     │ │
│  │  • user-info         → Core (no delegation)            │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**Example: Use both in same session**

```powershell
# Get JWT
$token = "..."

# Call PostgreSQL delegation
Invoke-RestMethod -Method Post -Uri "http://localhost:3010/mcp" `
  -Headers @{ "Authorization" = "Bearer $token" } `
  -Body '{"method":"tools/call","params":{"name":"sql-delegate","arguments":{"action":"query","sql":"SELECT current_user"}}}'

# Call Kerberos delegation
Invoke-RestMethod -Method Post -Uri "http://localhost:3010/mcp" `
  -Headers @{ "Authorization" = "Bearer $token" } `
  -Body '{"method":"tools/call","params":{"name":"kerberos-delegate","arguments":{"action":"s4u2self"}}}'
```

Both delegations work independently with their own caching and audit trails.

---

## Performance Metrics

Expected performance with Kerberos caching enabled:

| Metric | Cold (No Cache) | Warm (Cache Hit) | Improvement |
|--------|----------------|------------------|-------------|
| S4U2Self latency | 100-200ms | <2ms | 100x faster |
| S4U2Proxy latency | 150-300ms | <2ms | 150x faster |
| Cache hit rate | 0% | >85% | - |
| Memory usage (1K sessions) | <5MB | <10MB | Acceptable |

---

## Next Steps

1. **Configure Active Directory** - Run `setup-ad-kerberos.ps1`
2. **Configure Keycloak** - Add `legacy_username` mapper
3. **Enable Kerberos** - Update `phase3-test-config.json`
4. **Start Server** - Run `start-phase3-server.bat`
5. **Run Tests** - Execute PowerShell test commands above

For detailed implementation guide, see [docs/kerberos.md](../docs/kerberos.md).

For automated testing, see [test-harness/scripts/test-kerberos.ps1](scripts/test-kerberos.ps1).
