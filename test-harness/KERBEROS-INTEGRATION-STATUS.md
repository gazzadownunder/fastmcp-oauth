# Kerberos Integration Status

**Date:** 2025-01-20
**Status:** ✅ ENABLED (Configuration Complete, Ready for AD Setup)

## Current State

Kerberos Constrained Delegation is now **fully integrated** into the Phase 3 test server and **enabled by default** in the configuration.

### What's Working

1. ✅ **Core Implementation Complete**
   - [src/delegation/kerberos/kerberos-client.ts](../src/delegation/kerberos/kerberos-client.ts) - Native Kerberos client
   - [src/delegation/kerberos/ticket-cache.ts](../src/delegation/kerberos/ticket-cache.ts) - Session-scoped ticket caching
   - [src/delegation/kerberos/kerberos-module.ts](../src/delegation/kerberos/kerberos-module.ts) - DelegationModule implementation

2. ✅ **Configuration Schema**
   - [src/config/schemas/kerberos.ts](../src/config/schemas/kerberos.ts) - Zod validation for Kerberos config

3. ✅ **MCP Tools**
   - [src/mcp/tools/kerberos-delegate.ts](../src/mcp/tools/kerberos-delegate.ts) - Kerberos ticket management
   - [src/mcp/tools/kerberos-file-browse.ts](../src/mcp/tools/kerberos-file-browse.ts) - File browsing with Kerberos auth
     - kerberos-list-directory - List files/folders in SMB shares
     - kerberos-read-file - Read file contents from SMB shares
     - kerberos-file-info - Get detailed file/folder information

4. ✅ **Test Server Integration**
   - [test-harness/v2-test-server.ts](v2-test-server.ts) - KerberosDelegationModule initialization (lines 143-189)
   - [test-harness/config/phase3-test-config.json](config/phase3-test-config.json) - **Kerberos enabled: true** (line 104)
   - [test-harness/start-phase3-server.bat](start-phase3-server.bat) - Updated with Kerberos prerequisites info

5. ✅ **Documentation**
   - [Docs/kerberos.md](../Docs/kerberos.md) - Complete implementation guide (1,300+ lines)
   - [test-harness/KERBEROS-QUICKSTART.md](KERBEROS-QUICKSTART.md) - Quick start guide
   - [test-harness/KERBEROS-PHASE3-INTEGRATION.md](KERBEROS-PHASE3-INTEGRATION.md) - Integration guide

6. ✅ **Build Status**
   - All TypeScript files compile successfully
   - No build errors

## Configuration Details

### Phase 3 Test Configuration

**File:** [test-harness/config/phase3-test-config.json](config/phase3-test-config.json)

**Kerberos Module (lines 103-131):**
```json
{
  "kerberos": {
    "enabled": true,
    "domainController": "w25-dc.w25ad.net",
    "servicePrincipalName": "HTTP/mcp-server",
    "realm": "w25ad.net",
    "kdc": "w25-dc.w25ad.net:88",
    "enableS4U2Self": true,
    "enableS4U2Proxy": true,
    "allowedDelegationTargets": [
      "cifs/fileserver.w25ad.net",
      "cifs/192.168.1.25",
      "HOST/fileserver.w25ad.net",
      "HOST/192.168.1.25"
    ],
    "serviceAccount": {
      "username": "svc-mcp-server",
      "password": "YourSecurePassword123!"
    },
    "ticketCache": {
      "enabled": true,
      "ttlSeconds": 3600,
      "renewThresholdSeconds": 300
    }
  }
}
```

**MCP Tools (lines 139-149):**
```json
{
  "enabledTools": {
    "kerberos-delegate": true,
    "kerberos-list-directory": true,
    "kerberos-read-file": true,
    "kerberos-file-info": true
  }
}
```

**Note:** All Kerberos tools use the same IDP configuration (`sql-delegation-te-jwt`) for token exchange. The JWT must contain a `legacy_name` claim mapping to the Active Directory `sAMAccountName`.

### Active Directory Requirements

**Domain Controller:** w25-dc.w25ad.net (192.168.1.25)
**Domain:** w25ad.net
**Service Account:** svc-mcp-server@w25ad.net

**Required SPNs:**
- HTTP/mcp-server (MCP server service principal)

**Delegation Targets:**
- cifs/fileserver.w25ad.net (Windows file share access)
- cifs/192.168.1.25 (IP-based access)
- HOST/fileserver.w25ad.net (Generic host services)
- HOST/192.168.1.25 (IP-based host services)

## Next Steps (User Action Required)

### 1. Configure Active Directory

Run the PowerShell script on the domain controller (w25-dc.w25ad.net):

```powershell
# On w25-dc.w25ad.net
cd \\path\to\project
.\scripts\setup-ad-kerberos.ps1 `
  -ServiceAccountName "svc-mcp-server" `
  -ServiceAccountPassword "YourSecurePassword123!" `
  -ServicePrincipalName "HTTP/mcp-server" `
  -FileServerSPN "cifs/192.168.1.25" `
  -FileServerHostSPN "HOST/192.168.1.25"
```

**What this script does:**
1. Creates service account `svc-mcp-server@w25ad.net`
2. Registers SPN `HTTP/mcp-server`
3. Enables Kerberos Constrained Delegation
4. Sets delegation targets (cifs/*, HOST/*)
5. Enables protocol transition (S4U2Self)

**Script Location:** [scripts/setup-ad-kerberos.ps1](../scripts/setup-ad-kerberos.ps1)

### 2. Configure Keycloak (JWT Claims)

The MCP server requires `legacy_username` claim in JWT tokens for Kerberos delegation.

**Add claim mapper to Keycloak client:**
1. Open Keycloak Admin Console
2. Navigate to: Clients → `mcp-oauth` → Client Scopes → Mappers
3. Create new mapper:
   - **Name:** `legacy_username`
   - **Mapper Type:** User Attribute
   - **User Attribute:** `sAMAccountName` (from Active Directory)
   - **Token Claim Name:** `legacy_name`
   - **Claim JSON Type:** String
   - **Add to access token:** Yes

**Example JWT Payload:**
```json
{
  "sub": "alice@company.com",
  "preferred_username": "alice",
  "legacy_name": "ALICE",  // ← Required for Kerberos
  "roles": ["user"],
  "aud": ["mcp-oauth"],
  "iss": "http://localhost:8080/realms/mcp_security"
}
```

### 3. Test Kerberos Integration

#### Option A: Use Phase 3 Server (PostgreSQL + Kerberos)

```batch
cd test-harness
start-phase3-server.bat
```

**Expected Output:**
```
Kerberos delegation module detected in config
Initializing Kerberos connection to KDC...
Domain Controller: w25-dc.w25ad.net
Realm: w25ad.net
Service Principal: HTTP/mcp-server
✓ Kerberos service ticket (TGT) obtained
✓ Kerberos delegation module registered
```

#### Option B: Use Kerberos-Only Server

```batch
cd test-harness
start-kerberos-server.bat
```

**Uses:** [test-harness/config/phase3-kerberos-enabled.json](config/phase3-kerberos-enabled.json) (Kerberos only, no PostgreSQL)

### 4. Call kerberos-delegate Tool

**Get Kerberos Ticket (S4U2Self):**
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
        "principal": "ALICE@w25ad.net",
        "expiresAt": "2025-01-20T15:00:00.000Z",
        "cached": false
      }
    }]
  },
  "id": 1
}
```

**Obtain Proxy Ticket (S4U2Proxy):**
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
    "id": 1
  }'
```

### 5. Browse Files with Kerberos Authentication

The file browsing tools automatically handle Kerberos delegation (S4U2Proxy) to access Windows file shares.

#### List Directory Contents

**List files in a share:**
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
        "path": "//192.168.1.25/shared/documents"
      }
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
        "path": "//192.168.1.25/shared/documents",
        "server": "192.168.1.25",
        "share": "shared",
        "itemCount": 5,
        "items": [
          {
            "name": "report.docx",
            "type": "file",
            "size": 45678,
            "modified": "2025-01-20T10:30:00.000Z",
            "hidden": false
          },
          {
            "name": "data",
            "type": "directory",
            "size": 0,
            "modified": "2025-01-19T14:20:00.000Z",
            "hidden": false
          }
        ],
        "authenticatedAs": "ALICE"
      }
    }]
  },
  "id": 1
}
```

#### Read File Contents

**Read a text file:**
```bash
curl -X POST http://localhost:3010/mcp \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "kerberos-read-file",
      "arguments": {
        "path": "//192.168.1.25/shared/config.txt",
        "encoding": "utf8",
        "maxBytes": 1048576
      }
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
        "path": "//192.168.1.25/shared/config.txt",
        "server": "192.168.1.25",
        "share": "shared",
        "size": 245,
        "encoding": "utf8",
        "modified": "2025-01-20T09:15:00.000Z",
        "contents": "# Configuration file\nserver=production\nport=8080",
        "authenticatedAs": "ALICE"
      }
    }]
  },
  "id": 1
}
```

#### Get File Information

**Get detailed file metadata:**
```bash
curl -X POST http://localhost:3010/mcp \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "kerberos-file-info",
      "arguments": {
        "path": "//192.168.1.25/shared/report.docx"
      }
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
        "path": "//192.168.1.25/shared/report.docx",
        "server": "192.168.1.25",
        "share": "shared",
        "name": "report.docx",
        "type": "file",
        "size": 45678,
        "created": "2025-01-15T08:00:00.000Z",
        "modified": "2025-01-20T10:30:00.000Z",
        "accessed": "2025-01-20T11:45:00.000Z",
        "isReadOnly": false,
        "isHidden": false,
        "permissions": {
          "user": { "read": true, "write": true, "execute": false },
          "group": { "read": true, "write": false, "execute": false },
          "others": { "read": false, "write": false, "execute": false }
        },
        "authenticatedAs": "ALICE"
      }
    }]
  },
  "id": 1
}
```

**How It Works:**
1. Extract JWT from Authorization header
2. Validate JWT and extract `legacy_name` claim (e.g., "ALICE")
3. Parse SMB path to extract server and target SPN (e.g., `cifs/192.168.1.25`)
4. Call Kerberos delegation module to obtain S4U2Proxy ticket for target SPN
5. Access file share using Windows UNC path with Kerberos authentication
6. Return results with audit logging

## Graceful Failure Handling

If Active Directory is **not configured** or **not reachable**, the server will:

1. **Log error during startup:**
   ```
   ✗ Kerberos initialization failed
     Error: Failed to connect to KDC at w25-dc.w25ad.net:88
     Continuing without Kerberos support...
   ```

2. **Continue starting with PostgreSQL delegation only**
3. **kerberos-delegate tool will return error:**
   ```json
   {
     "error": "Module not found: kerberos"
   }
   ```

**This is by design** - Kerberos is optional, and the server will work without it.

## Architecture

### Multi-Delegation Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                  MCP Client (Web UI / CLI)                        │
│  1. Authenticate with Keycloak                                   │
│  2. Receive JWT with legacy_name claim                           │
│  3. Call MCP tools with JWT as Bearer token                      │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ↓ Authorization: Bearer <JWT>
┌──────────────────────────────────────────────────────────────────┐
│                  MCP OAuth Server (Node.js)                       │
│  - Validate JWT (issuer, audience, signature)                    │
│  - Extract legacy_username from legacy_name claim                │
│  - Route to delegation module based on tool                      │
└──────────────┬─────────────────────────┬─────────────────────────┘
               │                         │
               ↓                         ↓
┌──────────────────────────┐  ┌──────────────────────────┐
│  PostgreSQL Delegation   │  │  Kerberos Delegation     │
│  - Token Exchange        │  │  - S4U2Self (user ticket)│
│  - SET ROLE <legacy_name>│  │  - S4U2Proxy (delegation)│
└────────┬─────────────────┘  └────────┬─────────────────┘
         │                              │
         ↓                              ↓
┌──────────────────────────┐  ┌──────────────────────────┐
│  PostgreSQL Database     │  │  Windows File Servers    │
│  - Row-level security    │  │  - SMB/CIFS access       │
│  - alice_table, bob_table│  │  - Windows auth          │
└──────────────────────────┘  └──────────────────────────┘
```

### Kerberos Delegation Flow

```
1. JWT Validation
   └→ Extract legacy_name claim: "ALICE"

2. Build User Principal
   └→ "ALICE@w25ad.net"

3. Check Ticket Cache
   └→ Cache miss → Obtain from KDC

4. S4U2Self (Protocol Transition)
   └→ Service account obtains ticket on behalf of ALICE
   └→ Returns: KerberosTicket (user ticket)

5. S4U2Proxy (Delegation)
   └→ Service account delegates to backend (cifs/192.168.1.25)
   └→ Validates target SPN is in allowedDelegationTargets
   └→ Returns: KerberosTicket (proxy ticket)

6. Cache Ticket
   └→ TTL: 3600 seconds
   └→ Renewal threshold: 300 seconds (5 minutes before expiry)

7. Return Ticket to Caller
   └→ Caller uses ticket for Windows file access
```

## Testing Checklist

- [ ] Active Directory configured (run setup-ad-kerberos.ps1)
- [ ] Keycloak claim mapper configured (legacy_name)
- [ ] Phase 3 server starts successfully
- [ ] Kerberos module initializes (TGT obtained)
- [ ] kerberos-delegate tool returns ticket (s4u2self)
- [ ] kerberos-delegate tool returns proxy ticket (s4u2proxy)
- [ ] Ticket cache working (second call returns cached=true)
- [ ] Invalid target SPN rejected (not in allowedDelegationTargets)
- [ ] Missing legacy_name claim rejected (401 error)

## Troubleshooting

### Kerberos initialization fails

**Error:** `Failed to connect to KDC at w25-dc.w25ad.net:88`

**Fixes:**
1. Check network connectivity to domain controller
2. Verify domain controller is running (w25-dc.w25ad.net)
3. Verify KDC service is running on port 88
4. Check firewall rules (allow port 88/UDP)

### Service account authentication fails

**Error:** `KDC_ERR_PREAUTH_FAILED`

**Fixes:**
1. Verify service account password in phase3-test-config.json
2. Check service account is not locked or disabled
3. Verify service account has "Trust for delegation" enabled

### S4U2Self fails

**Error:** `KDC_ERR_S_PRINCIPAL_UNKNOWN`

**Fixes:**
1. Verify SPN is registered (HTTP/mcp-server)
2. Check service account has delegation enabled
3. Run: `setspn -L svc-mcp-server` on domain controller

### S4U2Proxy fails

**Error:** `Target SPN not in allowed delegation targets`

**Fixes:**
1. Verify target SPN is in allowedDelegationTargets config
2. Check delegation is configured in Active Directory
3. Verify target service is registered in AD

### Missing legacy_name claim

**Error:** `User session missing legacy_username claim for Kerberos delegation`

**Fixes:**
1. Configure Keycloak claim mapper (see step 2 above)
2. Verify JWT token contains `legacy_name` claim
3. Check claim mapping in phase3-test-config.json (line 12)

## Files Modified/Created

**Core Implementation:**
- [src/delegation/kerberos/kerberos-client.ts](../src/delegation/kerberos/kerberos-client.ts) (NEW)
- [src/delegation/kerberos/ticket-cache.ts](../src/delegation/kerberos/ticket-cache.ts) (NEW)
- [src/delegation/kerberos/kerberos-module.ts](../src/delegation/kerberos/kerberos-module.ts) (UPDATED)
- [src/config/schemas/kerberos.ts](../src/config/schemas/kerberos.ts) (NEW)
- [src/mcp/tools/kerberos-delegate.ts](../src/mcp/tools/kerberos-delegate.ts) (NEW)

**Test Harness:**
- [test-harness/config/phase3-test-config.json](config/phase3-test-config.json) (UPDATED - enabled: true)
- [test-harness/config/phase3-kerberos-enabled.json](config/phase3-kerberos-enabled.json) (NEW)
- [test-harness/v2-test-server.ts](v2-test-server.ts) (UPDATED - lines 143-189)
- [test-harness/start-phase3-server.bat](start-phase3-server.bat) (UPDATED - Kerberos prerequisites)
- [test-harness/start-kerberos-server.bat](start-kerberos-server.bat) (NEW)

**Documentation:**
- [Docs/kerberos.md](../Docs/kerberos.md) (NEW)
- [test-harness/KERBEROS-QUICKSTART.md](KERBEROS-QUICKSTART.md) (NEW)
- [test-harness/KERBEROS-PHASE3-INTEGRATION.md](KERBEROS-PHASE3-INTEGRATION.md) (NEW)
- [test-harness/KERBEROS-INTEGRATION-STATUS.md](KERBEROS-INTEGRATION-STATUS.md) (THIS FILE)

**Active Directory Setup:**
- [scripts/setup-ad-kerberos.ps1](../scripts/setup-ad-kerberos.ps1) (UPDATED - file server targets)

## Summary

✅ **Kerberos Constrained Delegation is now fully integrated and enabled** in the Phase 3 test server.

**Next steps are entirely in Active Directory and Keycloak configuration** - the code is ready to test once the infrastructure is configured.

See [KERBEROS-QUICKSTART.md](KERBEROS-QUICKSTART.md) for step-by-step testing instructions.
