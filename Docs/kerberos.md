# Kerberos Constrained Delegation Implementation Guide

**Status:** Implementation in Progress
**Version:** 1.0.0
**Target Completion:** Phase 7
**Windows Server:** 192.168.1.25 (Windows Server 2025)

---

## Table of Contents

1. [Overview](#overview)
2. [Active Directory Configuration](#active-directory-configuration)
3. [Architecture](#architecture)
4. [Implementation Plan](#implementation-plan)
5. [Configuration](#configuration)
6. [Testing Strategy](#testing-strategy)
7. [Security Considerations](#security-considerations)
8. [Troubleshooting](#troubleshooting)

---

## Overview

### What is Kerberos Constrained Delegation?

Kerberos Constrained Delegation (KCD) enables a service to obtain Kerberos tickets on behalf of users to access downstream services. This is critical for legacy Windows environments where:

- **Legacy applications** require Windows Authentication (Kerberos/NTLM)
- **Service accounts** need to impersonate users to backend systems
- **Multi-tier applications** must maintain user identity across service boundaries

### MCP OAuth + Kerberos Integration

This framework combines **modern OAuth 2.1 authentication** with **legacy Kerberos delegation**:

```
┌──────────────────────────────────────────────────────────────────┐
│                   OAuth + Kerberos Flow                          │
│                                                                   │
│  1. User → Keycloak (OAuth IDP)                                 │
│     Modern authentication with JWT tokens                        │
│                                                                   │
│  2. MCP Client → MCP Server                                      │
│     Authorization: Bearer <jwt-token>                            │
│     JWT contains: legacy_username claim (e.g., "ALICE")          │
│                                                                   │
│  3. MCP Server → Token Exchange (optional)                       │
│     Exchange JWT for delegation token with TE-JWT claims         │
│                                                                   │
│  4. MCP Server → Kerberos KDC (Active Directory)                │
│     S4U2Self: Obtain ticket for legacy_username                  │
│     Principal: ALICE@COMPANY.COM                                 │
│                                                                   │
│  5. MCP Server → Backend Service                                │
│     S4U2Proxy: Act on behalf of ALICE                           │
│     Target: MSSQLSvc/sql01.company.com:1433                     │
│                                                                   │
│  6. Backend Service receives request as ALICE                    │
│     User context: ALICE (from Kerberos ticket)                   │
└──────────────────────────────────────────────────────────────────┘
```

### Use Cases

1. **SQL Server Windows Authentication**
   - MCP Server obtains Kerberos ticket for user
   - Connects to SQL Server with user's identity
   - SQL Server enforces user-specific permissions

2. **File Server Access**
   - User browses files through MCP tool
   - MCP Server accesses files as user via SMB/CIFS
   - User sees only files they have permissions for

3. **Legacy Application Integration**
   - Modern OAuth frontend
   - Legacy backend requiring Windows Authentication
   - Seamless identity translation

---

## Active Directory Configuration

### Prerequisites

- **Windows Server 2025** (192.168.1.25)
- **Active Directory Domain Services** installed
- **Domain Controller** role configured
- **Administrative access** to AD

### Step 1: Create Service Account for MCP Server

The MCP Server needs a service account with delegation privileges.

**PowerShell Commands (on Domain Controller):**

```powershell
# Import Active Directory module
Import-Module ActiveDirectory

# Create service account for MCP Server
New-ADUser -Name "svc-mcp-server" `
  -SamAccountName "svc-mcp-server" `
  -UserPrincipalName "svc-mcp-server@COMPANY.COM" `
  -AccountPassword (ConvertTo-SecureString "YourSecurePassword123!" -AsPlainText -Force) `
  -Enabled $true `
  -PasswordNeverExpires $true `
  -Description "MCP OAuth Server - Kerberos Delegation Service Account"

# Verify account created
Get-ADUser -Identity "svc-mcp-server"
```

**Expected Output:**
```
DistinguishedName : CN=svc-mcp-server,CN=Users,DC=company,DC=com
Enabled           : True
Name              : svc-mcp-server
SamAccountName    : svc-mcp-server
UserPrincipalName : svc-mcp-server@COMPANY.COM
```

### Step 2: Register Service Principal Names (SPNs)

The service account needs SPNs registered for the MCP Server.

**PowerShell Commands:**

```powershell
# Register HTTP SPN for MCP Server (change hostname to your MCP Server's FQDN)
setspn -S HTTP/mcp-server.company.com svc-mcp-server
setspn -S HTTP/mcp-server svc-mcp-server

# Verify SPNs registered
setspn -L svc-mcp-server
```

**Expected Output:**
```
Registered ServicePrincipalNames for CN=svc-mcp-server,CN=Users,DC=company,DC=com:
        HTTP/mcp-server.company.com
        HTTP/mcp-server
```

**Important:** Replace `mcp-server.company.com` with the actual hostname where the MCP Server runs. If running on localhost for testing, you can use:

```powershell
setspn -S HTTP/localhost svc-mcp-server
```

### Step 3: Enable Constrained Delegation (S4U2Self + S4U2Proxy)

Configure the service account to delegate credentials to backend services.

**Using Active Directory Users and Computers (GUI):**

1. Open **Active Directory Users and Computers** (dsa.msc)
2. Navigate to **Users** container
3. Right-click **svc-mcp-server** → **Properties**
4. Go to **Delegation** tab
5. Select: **"Trust this user for delegation to specified services only"**
6. Select: **"Use any authentication protocol"** (enables S4U2Self)
7. Click **Add** → **Users or Computers**
8. Add backend service accounts (e.g., SQL Server service account)

**Example: Delegate to SQL Server**

Assuming SQL Server runs under account `sqlservice`:

1. Click **Add** → **Users or Computers**
2. Enter: `sqlservice` → Click **OK**
3. Select services: `MSSQLSvc/sql01.company.com:1433`
4. Click **OK** → **Apply**

**Using PowerShell (Advanced):**

```powershell
# Get the service account
$mcpAccount = Get-ADUser -Identity "svc-mcp-server"

# Get the SQL Server service account (example)
$sqlService = Get-ADUser -Identity "sqlservice"

# Set constrained delegation with protocol transition (S4U2Self)
Set-ADUser -Identity $mcpAccount `
  -TrustedForDelegation $false `
  -TrustedToAuthForDelegation $true

# Add allowed delegation targets
$spn = "MSSQLSvc/sql01.company.com:1433"
Set-ADUser -Identity $mcpAccount `
  -Add @{'msDS-AllowedToDelegateTo' = $spn}

# Verify delegation settings
Get-ADUser -Identity "svc-mcp-server" -Properties msDS-AllowedToDelegateTo, TrustedToAuthForDelegation |
  Select-Object Name, TrustedToAuthForDelegation, msDS-AllowedToDelegateTo
```

**Expected Output:**
```
Name             : svc-mcp-server
TrustedToAuthForDelegation : True
msDS-AllowedToDelegateTo   : {MSSQLSvc/sql01.company.com:1433}
```

**Key Settings Explained:**

- **`TrustedToAuthForDelegation = $true`**: Enables S4U2Self (protocol transition)
- **`msDS-AllowedToDelegateTo`**: List of SPNs the service can delegate to (S4U2Proxy)
- **"Use any authentication protocol"**: Allows delegation even when user didn't authenticate with Kerberos originally

### Step 4: Create Test User Accounts

Create test users to validate delegation flow.

**PowerShell Commands:**

```powershell
# Create test user ALICE
New-ADUser -Name "Alice Admin" `
  -SamAccountName "alice" `
  -UserPrincipalName "alice@COMPANY.COM" `
  -AccountPassword (ConvertTo-SecureString "Password123!" -AsPlainText -Force) `
  -Enabled $true `
  -Description "Test user for Kerberos delegation"

# Create test user BOB
New-ADUser -Name "Bob User" `
  -SamAccountName "bob" `
  -UserPrincipalName "bob@COMPANY.COM" `
  -AccountPassword (ConvertTo-SecureString "Password123!" -AsPlainText -Force) `
  -Enabled $true `
  -Description "Test user for Kerberos delegation"

# Verify users created
Get-ADUser -Filter {SamAccountName -eq "alice" -or SamAccountName -eq "bob"} |
  Select-Object Name, SamAccountName, UserPrincipalName
```

### Step 5: Configure Keytab File (Optional - for Linux MCP Server)

If running MCP Server on Linux, generate a keytab file for the service account.

**PowerShell Commands (on Domain Controller):**

```powershell
# Generate keytab file
ktpass /princ HTTP/mcp-server.company.com@COMPANY.COM `
  /mapuser svc-mcp-server@COMPANY.COM `
  /pass YourSecurePassword123! `
  /out C:\keytabs\mcp-server.keytab `
  /crypto AES256-SHA1 `
  /ptype KRB5_NT_PRINCIPAL

# Verify keytab
klist -k C:\keytabs\mcp-server.keytab
```

**Transfer keytab to MCP Server:**

```bash
# On Linux MCP Server
sudo mkdir /etc/keytabs
sudo scp administrator@192.168.1.25:C:/keytabs/mcp-server.keytab /etc/keytabs/
sudo chmod 600 /etc/keytabs/mcp-server.keytab
sudo chown mcp-server:mcp-server /etc/keytabs/mcp-server.keytab
```

### Step 6: Configure DNS (if needed)

Ensure MCP Server has proper DNS records for SPN resolution.

**PowerShell Commands:**

```powershell
# Add DNS A record for MCP Server
Add-DnsServerResourceRecordA -Name "mcp-server" `
  -ZoneName "company.com" `
  -IPv4Address "192.168.1.50" `
  -ComputerName "dc.company.com"

# Verify DNS record
Resolve-DnsName mcp-server.company.com
```

### Step 7: Verification Checklist

Run these commands to verify AD configuration:

```powershell
# 1. Verify service account exists
Get-ADUser -Identity "svc-mcp-server" -Properties * |
  Select-Object Name, Enabled, TrustedToAuthForDelegation, ServicePrincipalNames, msDS-AllowedToDelegateTo

# 2. Verify SPNs registered
setspn -L svc-mcp-server

# 3. Verify test users exist
Get-ADUser -Filter {SamAccountName -eq "alice" -or SamAccountName -eq "bob"} |
  Select-Object Name, Enabled, UserPrincipalName

# 4. Verify delegation targets
Get-ADUser -Identity "svc-mcp-server" -Properties msDS-AllowedToDelegateTo |
  Select-Object -ExpandProperty msDS-AllowedToDelegateTo

# 5. Check domain functional level (should be Windows Server 2008+ for S4U2Self)
Get-ADDomain | Select-Object DomainMode
```

**Expected Output:**
```
Name                      : svc-mcp-server
Enabled                   : True
TrustedToAuthForDelegation: True
ServicePrincipalNames     : {HTTP/mcp-server.company.com, HTTP/mcp-server}
msDS-AllowedToDelegateTo  : {MSSQLSvc/sql01.company.com:1433}
```

---

## Architecture

### Kerberos Delegation Module Components

```
┌─────────────────────────────────────────────────────────────────┐
│                KerberosDelegationModule                          │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  KerberosClient (node-krb5)                             │   │
│  │  - Windows SSPI integration                             │   │
│  │  - Native Kerberos API calls                            │   │
│  │  - S4U2Self / S4U2Proxy implementation                  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  TicketCache                                             │   │
│  │  - Session-scoped ticket storage                        │   │
│  │  - Automatic renewal before expiration                  │   │
│  │  - Secure cleanup on session end                        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  DelegationValidator                                     │   │
│  │  - Verify user has legacy_username claim                │   │
│  │  - Validate SPN in allowed targets list                 │   │
│  │  - Check service account delegation permissions         │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Delegation Flow

**Step 1: User Authentication (OAuth)**

```
Client → Keycloak: username/password
Keycloak → Client: JWT token with claims:
  {
    "sub": "alice@company.com",
    "legacy_username": "ALICE",
    "roles": ["user", "admin"]
  }
```

**Step 2: MCP Tool Invocation**

```
Client → MCP Server:
  POST /mcp
  Authorization: Bearer <jwt-token>
  { "method": "tools/call", "params": { "name": "sql-delegate" } }
```

**Step 3: Token Exchange (Optional)**

```
MCP Server → Keycloak Token Endpoint:
  POST /token
  {
    "grant_type": "urn:ietf:params:oauth:grant-type:token-exchange",
    "subject_token": "<original-jwt>",
    "audience": "urn:sql:database"
  }

Keycloak → MCP Server: Delegation token (TE-JWT)
  {
    "sub": "alice@company.com",
    "legacy_username": "ALICE",
    "aud": "urn:sql:database",
    "permissions": ["sql:read", "sql:write"]
  }
```

**Step 4: Kerberos Delegation (S4U2Self)**

```
MCP Server → KDC (Active Directory):
  KRB_TGS_REQ (S4U2Self)
  - Service: svc-mcp-server@COMPANY.COM
  - Target User: ALICE@COMPANY.COM
  - Flags: FORWARDABLE

KDC → MCP Server: Service Ticket for ALICE
  - Principal: ALICE@COMPANY.COM
  - Service: svc-mcp-server@COMPANY.COM
  - Ticket valid for 10 hours
```

**Step 5: Kerberos Proxy Delegation (S4U2Proxy)**

```
MCP Server → KDC:
  KRB_TGS_REQ (S4U2Proxy)
  - Evidence Ticket: ALICE's ticket from S4U2Self
  - Target SPN: MSSQLSvc/sql01.company.com:1433

KDC → MCP Server: Proxy Ticket
  - Principal: ALICE@COMPANY.COM
  - Target Service: MSSQLSvc/sql01.company.com:1433
  - Delegated from: svc-mcp-server@COMPANY.COM
```

**Step 6: Backend Service Access**

```
MCP Server → SQL Server:
  TDS Connection with Kerberos ticket
  - User context: ALICE@COMPANY.COM
  - Authentication: Integrated Windows Auth
  - SQL Server sees connection from ALICE

SQL Server executes query as ALICE:
  - Applies ALICE's database permissions
  - Audit logs show ALICE as user
  - Row-level security based on ALICE's role
```

---

## Implementation Plan

### Phase 1: Dependencies and Setup

**1. Install Node.js Kerberos Library**

```bash
npm install kerberos --save
npm install @types/kerberos --save-dev
```

**2. Install Windows SSPI Support (Windows only)**

```bash
npm install node-sspi --save
```

**3. Verify Kerberos CLI Tools Available**

```bash
# Windows
klist  # List Kerberos tickets
kinit alice@COMPANY.COM  # Obtain ticket
kdestroy  # Destroy tickets

# Linux
klist -k /etc/keytabs/mcp-server.keytab  # List keytab entries
kinit -kt /etc/keytabs/mcp-server.keytab svc-mcp-server@COMPANY.COM
```

### Phase 2: Core Kerberos Module Implementation

**File: [src/delegation/kerberos/kerberos-client.ts](../../src/delegation/kerberos/kerberos-client.ts)**

Implement native Kerberos client wrapper:

- `obtainServiceTicket()` - Get TGT for service account
- `performS4U2Self(userPrincipal)` - Obtain ticket on behalf of user
- `performS4U2Proxy(userTicket, targetSPN)` - Delegate to backend service
- `validateTicket(ticket)` - Verify ticket validity
- `renewTicket(ticket)` - Renew expiring ticket

**File: [src/delegation/kerberos/ticket-cache.ts](../../src/delegation/kerberos/ticket-cache.ts)**

Session-scoped ticket caching:

- `set(sessionId, principal, ticket)` - Cache ticket
- `get(sessionId, principal)` - Retrieve cached ticket
- `delete(sessionId)` - Clear session tickets
- `cleanup()` - Remove expired tickets

**File: [src/delegation/kerberos/kerberos-module.ts](../../src/delegation/kerberos/kerberos-module.ts)**

Update placeholder implementation:

```typescript
import { KerberosClient } from './kerberos-client.js';
import { TicketCache } from './ticket-cache.js';
import type { DelegationModule, DelegationResult } from '../base.js';
import type { UserSession, AuditEntry } from '../../core/index.js';
import type { KerberosConfig, KerberosParams } from './types.js';

export class KerberosDelegationModule implements DelegationModule {
  public readonly name = 'kerberos';
  public readonly type = 'authentication';

  private config?: KerberosConfig;
  private client?: KerberosClient;
  private ticketCache?: TicketCache;

  async initialize(config: KerberosConfig): Promise<void> {
    this.config = config;
    this.client = new KerberosClient(config);
    this.ticketCache = new TicketCache();

    // Obtain service TGT
    await this.client.obtainServiceTicket();
  }

  async delegate<T>(
    session: UserSession,
    action: string,
    params: KerberosParams
  ): Promise<DelegationResult<T>> {
    // Validate user has legacy_username
    if (!session.legacyUsername) {
      return {
        success: false,
        error: 'User session missing legacy_username claim',
        auditTrail: {
          timestamp: new Date(),
          userId: session.userId,
          action: `kerberos:${action}`,
          success: false,
          reason: 'Missing legacy_username claim',
          source: 'delegation:kerberos'
        }
      };
    }

    // Check ticket cache
    const userPrincipal = `${session.legacyUsername}@${this.config!.realm}`;
    let ticket = await this.ticketCache!.get(session.sessionId, userPrincipal);

    // Obtain ticket if not cached
    if (!ticket) {
      ticket = await this.client!.performS4U2Self(userPrincipal);
      await this.ticketCache!.set(session.sessionId, userPrincipal, ticket);
    }

    // Perform delegation action
    let result: any;
    switch (action) {
      case 's4u2self':
        result = ticket;
        break;

      case 's4u2proxy':
        const targetSPN = params.targetSPN!;
        result = await this.client!.performS4U2Proxy(ticket, targetSPN);
        break;

      default:
        return {
          success: false,
          error: `Unsupported action: ${action}`,
          auditTrail: {
            timestamp: new Date(),
            userId: session.userId,
            action: `kerberos:${action}`,
            success: false,
            reason: 'Unsupported action',
            source: 'delegation:kerberos'
          }
        };
    }

    return {
      success: true,
      data: result as T,
      auditTrail: {
        timestamp: new Date(),
        userId: session.userId,
        action: `kerberos:${action}`,
        success: true,
        metadata: {
          userPrincipal,
          targetSPN: params.targetSPN
        },
        source: 'delegation:kerberos'
      }
    };
  }

  async validateAccess(session: UserSession): Promise<boolean> {
    return !!session.legacyUsername;
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Verify can communicate with KDC
      return await this.client!.healthCheck();
    } catch {
      return false;
    }
  }

  async destroy(): Promise<void> {
    await this.ticketCache?.cleanup();
    await this.client?.destroy();
    this.config = undefined;
  }
}
```

### Phase 3: Configuration Schema

**File: [src/config/schemas/kerberos.ts](../../src/config/schemas/kerberos.ts)**

```typescript
import { z } from 'zod';

export const kerberosConfigSchema = z.object({
  enabled: z.boolean().default(false),
  domainController: z.string().describe('Active Directory domain controller FQDN'),
  servicePrincipalName: z.string().describe('Service SPN (e.g., HTTP/mcp-server.company.com)'),
  realm: z.string().describe('Kerberos realm (e.g., COMPANY.COM)'),
  kdc: z.string().optional().describe('KDC address (defaults to domainController)'),
  enableS4U2Self: z.boolean().default(true),
  enableS4U2Proxy: z.boolean().default(true),
  allowedDelegationTargets: z.array(z.string()).default([]),
  serviceAccount: z.object({
    username: z.string().describe('Service account username'),
    password: z.string().optional().describe('Service account password (if not using keytab)'),
    keytabPath: z.string().optional().describe('Path to keytab file')
  }),
  ticketCache: z.object({
    enabled: z.boolean().default(true),
    ttlSeconds: z.number().default(3600),
    renewThresholdSeconds: z.number().default(300)
  }).optional()
});

export type KerberosConfigSchema = z.infer<typeof kerberosConfigSchema>;
```

### Phase 4: MCP Tool Integration

**File: [src/mcp/tools/kerberos-delegate.ts](../../src/mcp/tools/kerberos-delegate.ts)**

```typescript
import { z } from 'zod';
import type { CoreContext } from '../../core/types.js';
import { Authorization } from '../authorization.js';

const kerberosToolSchema = z.object({
  action: z.enum(['obtain-ticket', 's4u2self', 's4u2proxy']),
  targetSPN: z.string().optional(),
  resource: z.string().default('kerberos')
});

export function createKerberosTool(context: CoreContext) {
  const auth = new Authorization();

  return {
    name: 'kerberos-delegate',
    description: 'Obtain Kerberos tickets on behalf of users for legacy Windows authentication',
    parameters: kerberosToolSchema,
    execute: async (args: z.infer<typeof kerberosToolSchema>, mcpContext: any) => {
      // Require authentication
      auth.requireAuth(mcpContext);

      const session = mcpContext.userSession;

      // Validate user has legacy_username claim
      if (!session?.legacyUsername) {
        throw new Error('User session missing legacy_username claim for Kerberos delegation');
      }

      // Call delegation registry
      const result = await context.delegationRegistry.delegate(
        session,
        args.action,
        args
      );

      if (!result.success) {
        throw new Error(result.error || 'Kerberos delegation failed');
      }

      return {
        success: true,
        action: args.action,
        userPrincipal: `${session.legacyUsername}@${context.config?.kerberos?.realm}`,
        targetSPN: args.targetSPN,
        ticket: result.data
      };
    }
  };
}
```

### Phase 5: Testing Infrastructure

**File: [test-harness/config/kerberos-test-config.json](../../test-harness/config/kerberos-test-config.json)**

```json
{
  "auth": {
    "trustedIDPs": [{
      "issuer": "http://192.168.1.25:8080/realms/mcp-test",
      "jwksUri": "http://192.168.1.25:8080/realms/mcp-test/protocol/openid-connect/certs",
      "audience": "mcp-server-api",
      "algorithms": ["RS256"],
      "claimMappings": {
        "legacyUsername": "legacy_username",
        "roles": "realm_roles",
        "scopes": "scope"
      }
    }]
  },
  "roleMappings": {
    "admin": ["admin"],
    "user": ["user"],
    "defaultRole": "guest"
  },
  "kerberos": {
    "enabled": true,
    "domainController": "192.168.1.25",
    "servicePrincipalName": "HTTP/mcp-server",
    "realm": "COMPANY.COM",
    "enableS4U2Self": true,
    "enableS4U2Proxy": true,
    "allowedDelegationTargets": [
      "MSSQLSvc/sql01.company.com:1433",
      "HTTP/api.company.com"
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

**File: [test-harness/kerberos-client/README.md](../../test-harness/kerberos-client/README.md)**

Test client for Kerberos delegation:

```markdown
# Kerberos Delegation Test Client

## Setup

1. Ensure Active Directory configured per docs/kerberos.md
2. Start MCP Server with kerberos-test-config.json
3. Install dependencies: `npm install`
4. Run tests: `npm test`

## Test Scenarios

### Scenario 1: Obtain Ticket (S4U2Self)
- User: alice
- Action: Obtain Kerberos ticket on behalf of ALICE
- Expected: Service ticket for ALICE@COMPANY.COM

### Scenario 2: Delegate to SQL Server (S4U2Proxy)
- User: alice
- Action: Obtain proxy ticket for SQL Server
- Target: MSSQLSvc/sql01.company.com:1433
- Expected: Proxy ticket allowing SQL connection as ALICE

### Scenario 3: Unauthorized Delegation
- User: bob (not in delegation targets)
- Action: Attempt delegation to unauthorized SPN
- Expected: Delegation denied

### Scenario 4: Missing Legacy Username
- User: modern-user (no legacy_username claim)
- Action: Attempt Kerberos delegation
- Expected: Error - missing legacy_username claim
```

---

## Configuration

### Full Configuration Example

```json
{
  "auth": {
    "trustedIDPs": [{
      "issuer": "https://auth.company.com",
      "jwksUri": "https://auth.company.com/.well-known/jwks.json",
      "audience": "mcp-server-api",
      "algorithms": ["RS256"],
      "claimMappings": {
        "legacyUsername": "legacy_sam_account",
        "roles": "user_roles",
        "scopes": "authorized_scopes"
      }
    }],
    "tokenExchange": {
      "tokenEndpoint": "https://auth.company.com/token",
      "clientId": "mcp-server",
      "clientSecret": "SECRET"
    }
  },
  "kerberos": {
    "enabled": true,
    "domainController": "dc.company.com",
    "servicePrincipalName": "HTTP/mcp-server.company.com",
    "realm": "COMPANY.COM",
    "kdc": "dc.company.com:88",
    "enableS4U2Self": true,
    "enableS4U2Proxy": true,
    "allowedDelegationTargets": [
      "MSSQLSvc/sql01.company.com:1433",
      "MSSQLSvc/sql02.company.com:1433",
      "HTTP/api.company.com"
    ],
    "serviceAccount": {
      "username": "svc-mcp-server",
      "password": "${KERBEROS_SERVICE_PASSWORD}",
      "keytabPath": "/etc/keytabs/mcp-server.keytab"
    },
    "ticketCache": {
      "enabled": true,
      "ttlSeconds": 3600,
      "renewThresholdSeconds": 300,
      "maxEntriesPerSession": 10
    }
  }
}
```

### Environment Variables

```bash
# Service account credentials
export KERBEROS_SERVICE_USERNAME=svc-mcp-server
export KERBEROS_SERVICE_PASSWORD=YourSecurePassword123!

# Kerberos configuration
export KRB5_CONFIG=/etc/krb5.conf
export KRB5_KTNAME=/etc/keytabs/mcp-server.keytab

# Active Directory
export AD_DOMAIN_CONTROLLER=192.168.1.25
export AD_REALM=COMPANY.COM
```

### krb5.conf Example (Linux)

```ini
[libdefaults]
    default_realm = COMPANY.COM
    dns_lookup_realm = false
    dns_lookup_kdc = false
    ticket_lifetime = 24h
    renew_lifetime = 7d
    forwardable = true
    default_ccache_name = FILE:/tmp/krb5cc_%{uid}

[realms]
    COMPANY.COM = {
        kdc = 192.168.1.25:88
        admin_server = 192.168.1.25:749
        default_domain = company.com
    }

[domain_realm]
    .company.com = COMPANY.COM
    company.com = COMPANY.COM
```

---

## Testing Strategy

### Unit Tests

**File: [tests/unit/delegation/kerberos/kerberos-client.test.ts](../../tests/unit/delegation/kerberos/kerberos-client.test.ts)**

- Test S4U2Self ticket acquisition
- Test S4U2Proxy delegation
- Test ticket validation
- Test ticket renewal
- Test error handling

**File: [tests/unit/delegation/kerberos/ticket-cache.test.ts](../../tests/unit/delegation/kerberos/ticket-cache.test.ts)**

- Test ticket caching and retrieval
- Test cache expiration
- Test session cleanup
- Test cache metrics

### Integration Tests

**File: [tests/integration/delegation/kerberos-delegation.test.ts](../../tests/integration/delegation/kerberos-delegation.test.ts)**

- Test full OAuth → Kerberos delegation flow
- Test SQL Server connection with delegated ticket
- Test unauthorized delegation attempts
- Test missing legacy_username claim handling

### Manual Testing

**Test Script: [test-harness/scripts/test-kerberos.ps1](../../test-harness/scripts/test-kerberos.ps1)**

```powershell
# Test 1: Verify AD configuration
Write-Host "Test 1: Verify Active Directory Configuration" -ForegroundColor Cyan
Get-ADUser -Identity "svc-mcp-server" -Properties * |
  Select-Object Name, TrustedToAuthForDelegation, ServicePrincipalNames, msDS-AllowedToDelegateTo

# Test 2: Obtain OAuth token
Write-Host "`nTest 2: Obtain OAuth Token from Keycloak" -ForegroundColor Cyan
$tokenResponse = Invoke-RestMethod -Method Post -Uri "http://192.168.1.25:8080/realms/mcp-test/protocol/openid-connect/token" -Body @{
    grant_type = "password"
    client_id = "mcp-client"
    username = "alice"
    password = "password"
    scope = "openid profile"
}
$accessToken = $tokenResponse.access_token
Write-Host "Access Token obtained: $($accessToken.Substring(0, 50))..."

# Test 3: Call MCP Server with Kerberos delegation
Write-Host "`nTest 3: Call MCP Server - Kerberos Delegation" -ForegroundColor Cyan
$mcpResponse = Invoke-RestMethod -Method Post -Uri "http://localhost:3000/mcp" `
  -Headers @{
    "Authorization" = "Bearer $accessToken"
    "Content-Type" = "application/json"
  } `
  -Body (@{
    jsonrpc = "2.0"
    method = "tools/call"
    params = @{
      name = "kerberos-delegate"
      arguments = @{
        action = "s4u2self"
        resource = "kerberos"
      }
    }
    id = 1
  } | ConvertTo-Json -Depth 10)

Write-Host "Kerberos Ticket obtained for: $($mcpResponse.result.userPrincipal)" -ForegroundColor Green

# Test 4: Delegate to SQL Server
Write-Host "`nTest 4: Delegate to SQL Server (S4U2Proxy)" -ForegroundColor Cyan
$sqlDelegateResponse = Invoke-RestMethod -Method Post -Uri "http://localhost:3000/mcp" `
  -Headers @{
    "Authorization" = "Bearer $accessToken"
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
        resource = "kerberos"
      }
    }
    id = 2
  } | ConvertTo-Json -Depth 10)

Write-Host "SQL Server proxy ticket obtained!" -ForegroundColor Green
```

---

## Security Considerations

### Threat Model

| Threat | Mitigation |
|--------|-----------|
| **Ticket theft** | Tickets stored in encrypted session cache, cleared on logout |
| **Privilege escalation** | Delegation only to pre-approved SPNs in allowedDelegationTargets |
| **Service account compromise** | Rotate passwords, use keytabs with restricted permissions |
| **Replay attacks** | Kerberos timestamps prevent replay (5-minute window) |
| **Man-in-the-middle** | Require encrypted channel (TLS/HTTPS) for all communications |
| **Unauthorized delegation** | Validate legacy_username claim exists before delegation |

### Best Practices

1. **Least Privilege Delegation**
   - Only delegate to specific SPNs required for functionality
   - Regularly audit `msDS-AllowedToDelegateTo` list

2. **Service Account Security**
   - Use managed service accounts (MSAs) when possible
   - Rotate passwords every 90 days
   - Store keytabs with 600 permissions

3. **Ticket Lifecycle Management**
   - Renew tickets before expiration (300s threshold)
   - Clear tickets on session end
   - Monitor ticket cache size

4. **Audit Logging**
   - Log all delegation attempts (success and failure)
   - Log all ticket acquisitions
   - Alert on unauthorized delegation attempts

5. **Network Security**
   - Require HTTPS for MCP Server
   - Isolate KDC communication to internal network
   - Use IPsec for KDC traffic if possible

---

## Troubleshooting

### Common Issues

#### Issue 1: "Kerberos ticket request failed"

**Symptoms:**
```
Error: Kerberos ticket request failed: KDC_ERR_S_PRINCIPAL_UNKNOWN
```

**Causes:**
- Service account SPN not registered
- Service account doesn't exist in AD
- Incorrect realm configuration

**Resolution:**
```powershell
# Verify SPNs registered
setspn -L svc-mcp-server

# Re-register if missing
setspn -S HTTP/mcp-server.company.com svc-mcp-server

# Verify service account exists
Get-ADUser -Identity svc-mcp-server
```

#### Issue 2: "User not allowed to delegate credentials"

**Symptoms:**
```
Error: KDC_ERR_BADOPTION - User not allowed to delegate credentials
```

**Causes:**
- Service account not configured for delegation
- Missing `TrustedToAuthForDelegation` flag
- Target SPN not in `msDS-AllowedToDelegateTo`

**Resolution:**
```powershell
# Enable delegation with protocol transition
Set-ADUser -Identity svc-mcp-server -TrustedToAuthForDelegation $true

# Add delegation target
$spn = "MSSQLSvc/sql01.company.com:1433"
Set-ADUser -Identity svc-mcp-server -Add @{'msDS-AllowedToDelegateTo' = $spn}
```

#### Issue 3: "Clock skew too great"

**Symptoms:**
```
Error: KDC_ERR_SKEW - Clock skew too great
```

**Causes:**
- Time difference > 5 minutes between MCP Server and KDC

**Resolution:**
```powershell
# Windows: Sync time with domain controller
w32tm /resync /force

# Linux: Install and configure NTP
sudo ntpdate 192.168.1.25
```

#### Issue 4: "Missing legacy_username claim"

**Symptoms:**
```
Error: User session missing legacy_username claim for Kerberos delegation
```

**Causes:**
- JWT doesn't contain `legacy_username` claim
- Keycloak mapper not configured

**Resolution:**

Configure Keycloak mapper:
1. Go to Keycloak Admin Console
2. Navigate to Client → mcp-client → Mappers
3. Create new mapper:
   - **Name:** legacy_username
   - **Mapper Type:** User Attribute
   - **User Attribute:** sAMAccountName
   - **Token Claim Name:** legacy_username
   - **Add to ID token:** ON
   - **Add to access token:** ON

### Debugging Commands

**Check Kerberos Tickets (Windows):**
```powershell
# List all tickets for current user
klist

# List tickets for specific user
klist -li 0x3e7  # SYSTEM account

# Purge all tickets
klist purge
```

**Check Kerberos Tickets (Linux):**
```bash
# List tickets
klist

# List keytab entries
klist -k /etc/keytabs/mcp-server.keytab

# Obtain ticket manually
kinit -kt /etc/keytabs/mcp-server.keytab svc-mcp-server@COMPANY.COM

# Destroy tickets
kdestroy
```

**Enable Kerberos Debug Logging (Windows):**
```powershell
# Enable Kerberos event logging
reg add "HKLM\SYSTEM\CurrentControlSet\Control\Lsa\Kerberos\Parameters" /v LogLevel /t REG_DWORD /d 1 /f

# View Kerberos events
Get-WinEvent -LogName Security | Where-Object { $_.Id -eq 4768 -or $_.Id -eq 4769 }
```

**Test SPN Resolution:**
```powershell
# Verify SPN exists
setspn -Q HTTP/mcp-server.company.com

# List all SPNs for account
setspn -L svc-mcp-server
```

### Performance Monitoring

**Metrics to Track:**

- **Ticket acquisition latency** (should be < 100ms)
- **Ticket cache hit rate** (target > 85%)
- **Delegation success rate** (target > 99%)
- **Ticket renewal failures** (alert on any failures)
- **KDC connection failures** (alert on sustained failures)

**Monitoring Query (Audit Logs):**
```typescript
// Get Kerberos delegation metrics
const metrics = await auditService.query({
  source: 'delegation:kerberos',
  startDate: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
  groupBy: 'action'
});

console.log('Kerberos Delegation Metrics (24h):');
console.log(`  S4U2Self Success: ${metrics.s4u2self.success}`);
console.log(`  S4U2Self Failures: ${metrics.s4u2self.failures}`);
console.log(`  S4U2Proxy Success: ${metrics.s4u2proxy.success}`);
console.log(`  S4U2Proxy Failures: ${metrics.s4u2proxy.failures}`);
```

---

## Progress Tracking

### Implementation Status

**Phase 1: Planning & Documentation** ✅ COMPLETE (2025-01-20)

- [x] **Documentation**
  - [x] AD configuration guide (this document)
  - [x] Active Directory setup PowerShell script
  - [x] Test client README
  - [x] Test harness configuration
  - [x] PowerShell test script

**Phase 2: Active Directory Configuration** ⏳ READY TO START

- [ ] **Active Directory Configuration** (Run on 192.168.1.25)
  - [ ] Service account created (svc-mcp-server)
  - [ ] SPNs registered (HTTP/mcp-server)
  - [ ] Constrained delegation configured (S4U2Self + S4U2Proxy)
  - [ ] Test users created (alice, bob, charlie)
  - [ ] Delegation targets configured (SQL Server SPN)
  - [ ] Keytab generated (optional, for Linux)
  - [ ] DNS records verified

**Commands to run:**
```powershell
# On 192.168.1.25 (Windows Server 2025)
cd "C:\Path\To\MCP-Oauth"
.\scripts\setup-ad-kerberos.ps1 -DomainController "192.168.1.25" -Realm "COMPANY.COM"
```

**Phase 3: Keycloak Configuration** ⏳ READY TO START

- [ ] **Keycloak User Attribute Mapper**
  - [ ] Create mapper for legacy_username claim
  - [ ] Map to sAMAccountName user attribute
  - [ ] Add to access token, ID token, userinfo
  - [ ] Configure for all test users (alice → ALICE, bob → BOB)

**Phase 4: Core Implementation** 🚧 NOT STARTED

- [ ] **Dependencies**
  - [ ] Install kerberos npm package
  - [ ] Install node-sspi (Windows only)
  - [ ] Install @types/kerberos

- [ ] **Core Implementation**
  - [ ] KerberosClient implementation (src/delegation/kerberos/kerberos-client.ts)
    - [ ] obtainServiceTicket()
    - [ ] performS4U2Self()
    - [ ] performS4U2Proxy()
    - [ ] validateTicket()
    - [ ] renewTicket()
  - [ ] TicketCache implementation (src/delegation/kerberos/ticket-cache.ts)
    - [ ] Session-scoped caching
    - [ ] TTL management
    - [ ] Automatic renewal
    - [ ] Secure cleanup
  - [ ] KerberosDelegationModule update (src/delegation/kerberos/kerberos-module.ts)
    - [ ] Replace placeholder with real implementation
    - [ ] Integrate KerberosClient
    - [ ] Integrate TicketCache
    - [ ] Validation logic
  - [ ] Configuration schema (src/config/schemas/kerberos.ts)
  - [ ] MCP tool integration (src/mcp/tools/kerberos-delegate.ts)

**Phase 5: Testing** 🚧 NOT STARTED

- [ ] **Unit Tests**
  - [ ] tests/unit/delegation/kerberos/kerberos-client.test.ts
  - [ ] tests/unit/delegation/kerberos/ticket-cache.test.ts
  - [ ] tests/unit/delegation/kerberos/kerberos-module.test.ts

- [ ] **Integration Tests**
  - [ ] tests/integration/delegation/kerberos-delegation.test.ts
  - [ ] Test OAuth → Kerberos flow
  - [ ] Test SQL Server delegation
  - [ ] Test unauthorized delegation
  - [ ] Test missing claims

- [ ] **Manual Testing**
  - [ ] Run PowerShell test script (test-harness/scripts/test-kerberos.ps1)
  - [ ] Verify all scenarios pass
  - [ ] Check audit logs
  - [ ] Measure performance

**Phase 6: Production Hardening** 🚧 NOT STARTED

- [ ] **Security**
  - [ ] Use keytab files instead of passwords
  - [ ] Enable ticket encryption
  - [ ] Configure ticket renewal policies
  - [ ] Add rate limiting for delegation requests
  - [ ] Implement delegation request monitoring

- [ ] **Performance**
  - [ ] Benchmark ticket acquisition latency
  - [ ] Optimize cache hit rates
  - [ ] Monitor KDC connection pool
  - [ ] Add Prometheus metrics

---

## Next Steps

1. **Configure Active Directory (192.168.1.25)**
   - Run PowerShell scripts to create service account
   - Register SPNs
   - Enable constrained delegation
   - Create test users

2. **Implement Kerberos Client**
   - Install dependencies (kerberos, node-sspi)
   - Implement S4U2Self/S4U2Proxy wrappers
   - Create ticket cache

3. **Update Kerberos Module**
   - Replace placeholder with real implementation
   - Add configuration validation
   - Integrate with delegation registry

4. **Build Test Harness**
   - Create test configuration
   - Build sample client
   - Write integration tests

5. **End-to-End Testing**
   - Test OAuth → Kerberos → SQL Server flow
   - Validate audit logging
   - Performance benchmarking

---

## References

- [Microsoft Kerberos Constrained Delegation](https://learn.microsoft.com/en-us/windows-server/security/kerberos/kerberos-constrained-delegation-overview)
- [S4U2Self and S4U2Proxy](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-sfu/3bff5864-8135-400e-bdd9-33b552051d94)
- [RFC 4120 - Kerberos V5](https://www.rfc-editor.org/rfc/rfc4120)
- [node-kerberos Documentation](https://www.npmjs.com/package/kerberos)
- [Windows SSPI Documentation](https://learn.microsoft.com/en-us/windows/win32/rpc/security-support-provider-interface-sspi-)
