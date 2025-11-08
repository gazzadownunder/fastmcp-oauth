# Kerberos Delegation - Current Limitations and Roadmap

**Last Updated:** 2025-01-11
**Status:** No viable pure Node.js solution for S4U2Self/S4U2Proxy delegation

---

## Executive Summary

After extensive research and analysis, **none of the proposed solutions can achieve true S4U2Self/S4U2Proxy Kerberos constrained delegation** in pure Node.js without user passwords.

### True Delegation (S4U2Self/S4U2Proxy) - Not Supported

| Solution | Status | Reason |
|----------|--------|--------|
| Option 1: PowerShell CredSSP | ❌ Not Viable | Requires user passwords |
| Option 2: node-expose-sspi | ❌ Not Viable | Doesn't support S4U2 (confirmed via research) |
| Option 3a: FFI LogonUserW | ❌ Not Viable | Requires passwords or uses service account |
| Option 3b: FFI SSPI APIs | ⚠️ Impractical | 2000+ LOC custom implementation needed |
| Option 4: SMB Client Library | ❌ Not Viable | Still requires authentication |

### Practical Alternative: RunAs Service Account Mode ✅

**The Kerberos module CAN be used with limited functionality:**

| Feature | Status | Notes |
|---------|--------|-------|
| Service Account Authentication | ✅ Works | Authenticate to AD with service account credentials |
| Resource Access | ✅ Works | Access resources as service account |
| User Identity Claims | ✅ Works | Token exchange provides user info from JWT |
| Application Audit Logging | ✅ Works | Track which user made each request |
| OS-Level User Attribution | ❌ Limited | Resources see service account, not individual users |
| User-Specific ACLs | ❌ Limited | Cannot enforce per-user permissions at OS level |

**Use Cases:**
- ✅ Development/Testing environments
- ✅ Read-only shared resources
- ✅ Non-regulated environments
- ✅ Legacy systems with service account patterns
- ❌ User-specific file shares with ACLs
- ❌ Regulated environments (GDPR/SOX/HIPAA)
- ❌ Multi-tenant production systems

**See sections below for:**
- [Practical Alternative: RunAs Service Account](#practical-alternative-runas-service-account-) - Configuration and usage
- [KERBEROS-SOLUTION-ANALYSIS.md](KERBEROS-SOLUTION-ANALYSIS.md) - Detailed technical analysis

---

## Current Status

The Kerberos delegation module has **stub implementations** of S4U2Self and S4U2Proxy. This is because **no existing Node.js library supports Windows Kerberos Constrained Delegation features**.

### What Works ✅

- Kerberos client initialization
- Service ticket (TGT) acquisition
- Token exchange to obtain `legacy_username` claim
- Ticket caching and renewal logic
- Configuration validation

### What Doesn't Work ❌

- **S4U2Self (Protocol Transition)** - Stub implementation only
- **S4U2Proxy (Constrained Delegation)** - Stub implementation only
- **File share access with delegation** - Uses current process credentials, not delegated user
- **SMB authentication as delegated user** - Node.js `fs` module doesn't use Kerberos tickets

## Root Cause

### node-kerberos Library Limitations

The `kerberos` npm package (v2.2.2) only supports:
- Basic GSSAPI/SPNEGO authentication
- Client-side Kerberos authentication
- Simple ticket acquisition

It does **NOT** support:
- S4U2Self protocol extensions
- S4U2Proxy protocol extensions
- Advanced Windows SSPI features
- Protocol transition
- Constrained delegation

### Code Evidence

From `packages/kerberos-delegation/src/kerberos-client.ts`:

```typescript
// OLD CODE (doesn't work):
const ticket = await this.kerberosClient.step('', {
  s4u2self: {
    userPrincipal,
    targetSPN,
  },
});
// Error: Invalid type for parameter `callback`, expected `function` but found `object`
```

The library expects a callback function as the second parameter, not an options object. Even if we fix this, the library doesn't implement S4U2Self logic internally.

## Technical Background

### Windows Kerberos Constrained Delegation

Windows S4U2Self/S4U2Proxy require:

1. **Active Directory Configuration:**
   - Service account has `TRUSTED_TO_AUTH_FOR_DELEGATION` flag
   - Service account has `msDS-AllowedToDelegateTo` attribute set
   - Target SPNs registered in AD

2. **SSPI API Calls:**
   - `AcquireCredentialsHandle()` - Obtain service credentials
   - `InitializeSecurityContext()` with `ISC_REQ_DELEGATE` flag
   - Special protocol extensions for S4U2Self/S4U2Proxy
   - TGS-REQ with PA-FOR-USER preauthentication data

3. **Ticket Usage:**
   - Tickets must be applied to the security context
   - Network access must use the security context
   - Node.js `fs` module doesn't support security context impersonation

### Why fs.readdir() Doesn't Work

```typescript
// This code uses the CURRENT PROCESS's credentials (e.g., "Administrator")
// It does NOT use the Kerberos ticket for alice_admin
const uncPath = '\\\\192.168.1.25\\temp';
const entries = await fs.readdir(uncPath);
```

When Node.js calls Windows file APIs, it uses the security context of the process (the logged-in user). The Kerberos ticket we obtained is NOT automatically applied to this context.

## Solution Options

### Option 1: PowerShell with CredSSP (Short-term)

**Pros:**
- Works on Windows without additional libraries
- Supports Kerberos delegation via CredSSP
- Can execute arbitrary PowerShell commands

**Cons:**
- Requires CredSSP configuration on both server and client
- Performance overhead (spawning PowerShell process)
- Security considerations (CredSSP enables delegation)

**Implementation:**

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function listDirectoryWithDelegation(
  uncPath: string,
  username: string,
  domain: string
): Promise<string[]> {
  const script = `
    $cred = New-Object System.Management.Automation.PSCredential @(
      '${domain}\\${username}',
      (ConvertTo-SecureString 'password' -AsPlainText -Force)
    )
    Invoke-Command -ComputerName localhost -Credential $cred -ScriptBlock {
      Get-ChildItem '${uncPath}' | Select-Object Name
    }
  `;

  const { stdout } = await execAsync(`powershell -Command "${script}"`);
  return stdout.split('\n').filter(line => line.trim());
}
```

**Requirements:**
- Enable CredSSP: `Enable-WSManCredSSP -Role Server`
- Configure delegation policy in GPO

### Option 2: node-expose-sspi ❌ NOT VIABLE

**Research Conclusion (2025-01-11):**
After extensive investigation, `node-expose-sspi` **does NOT support S4U2Self/S4U2Proxy delegation**.

**What it actually supports:**
- ✅ Basic SSPI authentication (NTLM/Kerberos)
- ✅ SSO scenarios (web authentication)
- ✅ Active Directory user queries
- ❌ **NOT** S4U2Self/S4U2Proxy
- ❌ **NOT** Constrained delegation
- ❌ **NOT** Impersonation for downstream resource access

**Evidence:**
- GitHub Issue #117: User confirmed "Kerberos ticket is only valid to authenticate Alice to Bob but can't be used for Bob to impersonate Alice"
- No documentation mentions S4U2 protocol extensions
- No API for constrained delegation
- Library designed for web SSO, not delegation

**Original code example was incorrect:**

```typescript
// ❌ THIS CODE DOESN'T WORK - s4u2self option doesn't exist
const client = sso.sspi({
  credential: { domain: 'W25AD', user: 'svc-mcp-server', password: 'ServicePassword123!' },
  targetName: userPrincipal,
  s4u2self: true  // This option doesn't exist in the library
});
```

**What the library actually does:**

```typescript
import { sso } from 'node-expose-sspi';

// Can authenticate current user to web server
const client = new sso.Client();
await client.fetch('http://localhost:3000');

// Cannot perform S4U2Self/S4U2Proxy
// Cannot access resources as delegated user
```

**Verdict:** Not a viable solution for on-behalf-of delegation.

### Option 3a: Windows Impersonation APIs via FFI (LogonUserW) ❌ NOT VIABLE

**Critical Flaw: User Password Required**

The original example uses `LogonUserW` with NULL password, which **does not work** for true delegation.

**Original code was incorrect:**

```typescript
const success = advapi32.LogonUserW(
  username,
  domain,
  null, // ❌ INCORRECT - Cannot be NULL for actual user logon
  9, // LOGON32_LOGON_NEW_CREDENTIALS
  3, // LOGON32_PROVIDER_WINNT50
  handlePtr
);
```

**What actually happens:**

| Logon Type | Password NULL? | Result |
|------------|---------------|--------|
| LOGON32_LOGON_INTERACTIVE (2) | ❌ Fails | Requires password |
| LOGON32_LOGON_NETWORK (3) | ❌ Fails | Requires password |
| LOGON32_LOGON_NEW_CREDENTIALS (9) | ⚠️ Succeeds | Uses **service account credentials**, not user |

**LOGON32_LOGON_NEW_CREDENTIALS with NULL password:**
- ✅ LogonUserW succeeds
- ✅ Creates impersonation token
- ❌ **Token uses service account credentials** (svc-mcp-server)
- ❌ Downstream resources see service account, NOT the target user (alice)
- ❌ This is the "RunAs" approach - not delegation

**Example behavior:**
```typescript
// Service account: svc-mcp-server
// Target user: alice

LogonUserW("alice", "W25AD", null, 9, 3, &hToken);
ImpersonateLoggedOnUser(hToken);

// Access \\fileserver\share
// Result: Server sees "svc-mcp-server", NOT "alice" ❌
```

**Why this fails:**
1. Does NOT perform S4U2Self protocol
2. Does NOT request tickets from AD on behalf of user
3. Does NOT validate delegation rights
4. Just creates token using current process credentials

**Verdict:** Not viable for on-behalf-of delegation. Requires user passwords or falls back to service account access.

---

### Option 3b: Native SSPI APIs via FFI ⚠️ EXTREMELY COMPLEX

**To actually implement S4U2Self/S4U2Proxy, you would need:**

```typescript
// This is a SIMPLIFIED outline - actual implementation is 2000+ lines

import ffi from 'ffi-napi';

const secur32 = ffi.Library('secur32', {
  'AcquireCredentialsHandleW': [...],      // Obtain service credentials
  'InitializeSecurityContextW': [...],      // Perform S4U2Self/S4U2Proxy
  'QuerySecurityContextToken': [...],       // Extract impersonation token
  'DeleteSecurityContext': [...],           // Cleanup
  'FreeCredentialsHandle': [...],           // Cleanup
  // ... 10+ more SSPI functions
});

// Step 1: Acquire service account credentials
async function acquireServiceCredentials() {
  // Complex credential structure marshaling
  // Error handling for various failure modes
}

// Step 2: Perform S4U2Self (Protocol Transition)
async function performS4U2Self(userPrincipal: string) {
  // Call InitializeSecurityContextW with ISC_REQ_DELEGATE
  // Construct PA-FOR-USER preauthentication data
  // Handle multi-step token exchange
}

// Step 3: Perform S4U2Proxy (Constrained Delegation)
async function performS4U2Proxy(targetSPN: string) {
  // Call InitializeSecurityContextW with user context
  // Validate msDS-AllowedToDelegateTo configuration
}

// Step 4: Extract and use impersonation token
async function impersonateUser(contextHandle) {
  // QuerySecurityContextToken
  // ImpersonateLoggedOnUser
  // Access resources
  // RevertToSelf
}
```

**Implementation Requirements:**
- **Lines of Code:** 2000+ (including structures, error handling, memory management)
- **Complexity:** Extremely high
  - Manual memory marshaling for 15+ Windows structures
  - Correct structure alignment (crashes if wrong)
  - PA-FOR-USER preauthentication data construction
  - Multi-step token exchange handling
- **Error-Prone:** Very high
  - Windows API expertise required
  - Debugging native crashes is difficult
  - Platform-specific edge cases
- **Maintenance:** High burden
  - Windows API changes over time
  - Security updates
  - Cross-version compatibility

**Estimated Effort:** 4-6 weeks full-time development by Windows security expert

**Verdict:** Technically possible but impractical for most projects. Essentially requires building a new native library from scratch.

### Option 4: SMB Client Library (Alternative)

**Pros:**
- Cross-platform
- No Windows-specific APIs
- Can use Kerberos tickets directly

**Cons:**
- Requires reimplementing SMB protocol
- May not support all Windows features
- Additional dependency

**Libraries:**
- `@marsaud/smb2` - SMB2 client for Node.js
- `smbclient` - Wrapper around smbclient command-line tool

## Recommendation

**Updated (2025-01-11) after extensive research:**

### Immediate: Use RunAs Service Account Mode ✅

**For development, testing, and limited production use:**

1. **Deploy with service account credentials** - Use existing Kerberos module
2. **Enable comprehensive audit logging** - Track user identity at application level
3. **Document limitations clearly** - Warn users that resources see service account
4. **Enforce authorization in application layer** - Use JWT claims for access control

**Configuration:**
```json
{
  "kerberos": {
    "servicePrincipalName": "HTTP/mcp-server.w25ad.net",
    "realm": "W25AD.NET",
    "serviceAccount": {
      "username": "svc-mcp-server",
      "password": "ServicePassword123!"
    },
    "delegation": {
      "mode": "service-account",
      "warnOnAccess": true,
      "auditUserContext": true
    }
  }
}
```

**See [Practical Alternative: RunAs Service Account](#practical-alternative-runas-service-account-) section for full details.**

### Medium-term: Windows Service Approach (If S4U2 Required)

**Build separate Windows Service in C#/.NET:**

```
┌────────────────────────────────────────────────────────┐
│  Node.js MCP Server                                    │
│  ↓                                                      │
│  Named Pipe: \\.\pipe\mcp-delegation                  │
│  ↓                                                      │
│  Windows Service (C#)                                  │
│  - WindowsIdentity.RunImpersonated (built-in S4U2)    │
│  - Access resources as delegated user                  │
│  - Return results via pipe                             │
└────────────────────────────────────────────────────────┘
```

**Pros:**
- ✅ .NET has built-in S4U2 support
- ✅ 200-300 lines of C# code
- ✅ Clean separation of concerns
- ✅ Node.js remains maintainable

**See [KERBEROS-SOLUTION-ANALYSIS.md](KERBEROS-SOLUTION-ANALYSIS.md) Section "Alternative Solutions" for implementation details.**

### Long-term: Native Addon (Only if High Demand)

- Build native SSPI addon (4-6 week project)
- Open source as separate package
- Make optional dependency (like SQL/Kerberos packages)
- **Not recommended** unless significant community demand

## Implementation Steps

### Phase 1: Document Current State ✅

- [x] Document library limitations
- [x] Implement stub S4U2Self/S4U2Proxy
- [x] Add detailed error messages
- [x] Create this documentation

### Phase 2: PowerShell Integration (Short-term)

1. Create `WindowsFileSystemClient` class
2. Implement SMB operations via PowerShell:
   - `listDirectory(uncPath, credentials)`
   - `readFile(uncPath, credentials)`
   - `getFileInfo(uncPath, credentials)`
3. Update kerberos-file-browse tools to use PowerShell client
4. Add CredSSP configuration documentation

### Phase 3: node-expose-sspi Integration (Medium-term)

1. Add `node-expose-sspi` dependency
2. Replace stub S4U2Self/S4U2Proxy with real implementations
3. Implement security context management
4. Update file operation tools to use SSPI client

### Phase 4: Testing and Validation

1. Test with real Active Directory environment
2. Verify delegation with Wireshark (KRB-TGS-REP packets)
3. Load testing (concurrent delegations)
4. Security audit (privilege escalation tests)

## Configuration Changes Required

### Current Configuration (Stub)

```json
{
  "kerberos": {
    "servicePrincipalName": "HTTP/mcp-server",
    "realm": "W25AD.NET",
    "serviceAccount": {
      "username": "svc-mcp-server",
      "password": "ServicePassword123!"
    }
  }
}
```

### Future Configuration (PowerShell)

```json
{
  "kerberos": {
    "servicePrincipalName": "HTTP/mcp-server",
    "realm": "W25AD.NET",
    "serviceAccount": {
      "username": "svc-mcp-server",
      "password": "ServicePassword123!"
    },
    "delegation": {
      "method": "powershell-credssp",
      "credsspEndpoint": "http://localhost:5985/wsman"
    }
  }
}
```

### Future Configuration (SSPI)

```json
{
  "kerberos": {
    "servicePrincipalName": "HTTP/mcp-server",
    "realm": "W25AD.NET",
    "serviceAccount": {
      "username": "svc-mcp-server",
      "password": "ServicePassword123!"
    },
    "delegation": {
      "method": "native-sspi",
      "allowedTargets": [
        "cifs/192.168.1.25",
        "MSSQLSvc/sql01.w25ad.net:1433"
      ]
    }
  }
}
```

## Security Considerations

### Current Security Posture

- ✅ Token exchange validates JWT signatures
- ✅ Legacy username validation
- ✅ Audit logging of delegation attempts
- ❌ No actual delegation occurs (stub implementation)
- ❌ File access uses server process credentials

### Future Security Requirements

1. **CredSSP Configuration (Option 1):**
   - Restrict CredSSP to specific hosts
   - Use Group Policy to control delegation
   - Monitor CredSSP usage in event logs

2. **SSPI Implementation (Option 2):**
   - Validate `msDS-AllowedToDelegateTo` configuration
   - Enforce constrained delegation targets
   - Log all S4U2Self/S4U2Proxy requests

3. **Impersonation (Option 3):**
   - Minimize impersonation duration
   - Always call `RevertToSelf()` in finally blocks
   - Audit impersonation failures

## Testing Strategy

### Unit Tests

```typescript
describe('KerberosClient with PowerShell', () => {
  it('should list directory as delegated user', async () => {
    const client = new PowerShellKerberosClient(config);
    const files = await client.listDirectory(
      '\\\\192.168.1.25\\temp',
      'alice_admin'
    );
    expect(files).toContain('test.txt');
  });
});
```

### Integration Tests

1. **Active Directory Setup:**
   - Configure service account with delegation
   - Create test users (alice_admin, bob_user)
   - Create test file shares with permissions

2. **Test Scenarios:**
   - List files as alice_admin (should see admin-only files)
   - List files as bob_user (should see public files only)
   - Attempt unauthorized access (should fail with 403)

3. **Negative Tests:**
   - Invalid user principal
   - Expired tickets
   - Disallowed delegation targets

## Practical Alternative: RunAs Service Account ✅

While true S4U2Self/S4U2Proxy delegation is not currently supported, the Kerberos module **can still be used** with **limited functionality** by running as a service account.

### What This Provides

**Service Account Access Mode:**
- ✅ Service account authenticates to Active Directory
- ✅ Access resources using service account credentials
- ✅ Token exchange still provides user identity claims
- ✅ Application-level audit logging of user actions
- ⚠️ Resources see service account, NOT individual users

### Use Cases Where This Works

**1. Resources Without User-Specific ACLs:**
```typescript
// Scenario: File share accessible to service account
// All users can access through MCP server
// Audit logs track which user made each request

const kerberosModule = new KerberosDelegationModule();
await kerberosModule.initialize(config);

// User "alice" makes request
// Service account accesses \\fileserver\public
// Resource sees: svc-mcp-server
// Audit log records: alice accessed file.txt
```

**2. Read-Only Operations:**
```typescript
// Service account has read permissions
// Users can query data without individual AD accounts
// Application enforces authorization based on JWT claims

const result = await kerberosModule.delegate(
  session, // User session from JWT
  'read-file',
  { path: '\\\\fileserver\\reports\\daily.csv' },
  context
);
```

**3. Centralized Service Account Pattern:**
```typescript
// Common in legacy systems:
// - Service account has broad read access
// - Application layer enforces user permissions
// - Audit trail maintained in application database

// Configuration
{
  "kerberos": {
    "servicePrincipalName": "HTTP/mcp-server",
    "realm": "W25AD.NET",
    "serviceAccount": {
      "username": "svc-mcp-reader",
      "password": "ServicePassword123!"
    },
    "mode": "service-account",  // Explicit mode
    "auditWarning": true  // Log that resources see service account
  }
}
```

### Limitations of RunAs Mode

❌ **Cannot provide user-specific access control at resource level**
- File share sees `svc-mcp-server`, not `alice`
- Cannot enforce user-specific NTFS ACLs
- Cannot implement least-privilege access patterns

❌ **Compliance issues for regulated environments**
- Audit logs show service account, not actual user
- May not meet GDPR/SOX/HIPAA requirements for user attribution
- Cannot prove which user accessed which resource at OS level

❌ **Security concerns**
- Service account needs broad permissions (violates least privilege)
- Compromise of service account affects all users
- Cannot implement defense-in-depth with OS-level controls

### When to Use RunAs Mode

**Acceptable scenarios:**
1. **Development/Testing** - Prototype functionality before implementing full delegation
2. **Read-Only Resources** - Service account has read-only access to shared data
3. **Non-Regulated Environments** - No compliance requirements for OS-level audit trails
4. **Legacy System Integration** - Existing systems already use service account pattern
5. **Transition Period** - Temporary solution while planning Windows Service implementation

**Not acceptable:**
1. **User-specific file shares** - Different users need different permissions
2. **Regulated environments** - GDPR/SOX/HIPAA require user attribution
3. **Production security** - Least-privilege principle must be enforced
4. **Multi-tenant systems** - User isolation required

### Configuration Example

```json
{
  "kerberos": {
    "servicePrincipalName": "HTTP/mcp-server.w25ad.net",
    "realm": "W25AD.NET",
    "serviceAccount": {
      "username": "svc-mcp-server",
      "password": "ServicePassword123!"
    },
    "delegation": {
      "mode": "service-account",
      "warnOnAccess": true,
      "auditUserContext": true
    },
    "ticketCache": {
      "enabled": true,
      "ttlSeconds": 3600
    }
  },
  "audit": {
    "logAllAttempts": true,
    "includeUserContext": true,
    "warnServiceAccountMode": true
  }
}
```

### Audit Trail Pattern

```typescript
// Even in RunAs mode, maintain detailed audit logs

const auditEntry = {
  timestamp: new Date(),
  source: 'delegation:kerberos',
  userId: session.userId,  // From JWT (alice)
  action: 'kerberos:access-file',
  resource: '\\\\fileserver\\reports\\daily.csv',
  delegationMode: 'service-account',  // Important!
  actualIdentity: 'svc-mcp-server',   // Who resource sees
  requestedIdentity: 'alice',          // Who user is
  success: true,
  warning: 'Resource accessed as service account, not user'
};
```

### Migration Path

**Phase 1: Use RunAs Mode (Current)**
- Deploy with service account access
- Implement comprehensive audit logging
- Document limitations in user-facing documentation

**Phase 2: Plan True Delegation**
- Evaluate Windows Service approach (C#/.NET)
- Assess native SSPI addon feasibility
- Budget development time and resources

**Phase 3: Implement True Delegation**
- Build Windows Service with WindowsIdentity.RunImpersonated
- Integrate via named pipes
- Migrate production workloads

## Known Issues

1. **node-kerberos doesn't support S4U2Self/S4U2Proxy**
   - Current: Stub implementation documents intended architecture
   - Workaround: RunAs service account mode (limited functionality)
   - Long-term: Windows Service in C#/.NET or native SSPI addon

2. **node-expose-sspi doesn't support delegation**
   - Research confirmed: Library designed for web SSO, not S4U2 protocols
   - No API for protocol transition or constrained delegation
   - Cannot be used as solution (contrary to original documentation)

3. **LogonUserW requires user passwords**
   - NULL password uses service account credentials (RunAs mode)
   - True S4U2Self requires SSPI APIs, not LogonUserW
   - FFI approach would need 2000+ LOC custom implementation

4. **fs module doesn't use security context**
   - Node.js file operations use process credentials
   - Even with valid Kerberos ticket, fs.readdir() doesn't apply it
   - Requires Windows impersonation APIs or separate process

5. **Cross-platform support**
   - Current: Windows-only (SSPI required for S4U2Self)
   - RunAs mode: Works on Windows with service account
   - Future: Linux support would require different approach (MIT Kerberos S4U extensions)

## References

- [MS-SFU]: Service for User and Constrained Delegation Protocol
  https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-sfu/

- [RFC 4120]: The Kerberos Network Authentication Service (V5)
  https://www.rfc-editor.org/rfc/rfc4120

- [node-expose-sspi Documentation]
  https://github.com/jlguenego/node-expose-sspi

- [Kerberos Delegation Explained]
  https://medium.com/@robert.broeckelmann/kerberos-and-windows-security-delegation-7b5a3f31d779
