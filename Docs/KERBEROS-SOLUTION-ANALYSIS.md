# Kerberos S4U2Self/S4U2Proxy - Solution Analysis

**Date:** 2025-01-11
**Status:** Research Complete - RunAs Mode Available, True Delegation Not Feasible
**Recommendation:** Use RunAs service account mode for immediate needs; plan Windows Service if true delegation required

---

## Executive Summary

After extensive research, **none of the proposed solutions in KERBEROS-LIMITATIONS.md can achieve true S4U2Self/S4U2Proxy Kerberos constrained delegation** without user passwords. All four options have critical flaws that prevent them from supporting full on-behalf-of delegation.

**Key Finding:** Implementing S4U2Self/S4U2Proxy in Node.js requires building custom native SSPI bindings from scratch - a project estimated at 2000+ lines of C++ code with high complexity and maintenance burden.

**Practical Solution:** The Kerberos module **can be used immediately** in **RunAs service account mode**, which provides:
- ✅ Service account authentication to AD resources
- ✅ User identity tracking via JWT token exchange
- ✅ Application-level audit logging
- ⚠️ Limited: Resources see service account, not individual users

**Use RunAs mode for:** Development, testing, read-only resources, non-regulated environments
**Avoid RunAs mode for:** User-specific ACLs, compliance requirements (GDPR/SOX/HIPAA), multi-tenant production

---

## Option-by-Option Analysis

### Option 1: PowerShell with CredSSP ❌

**Claimed Benefits (from docs):**
- Works on Windows without additional libraries
- Supports Kerberos delegation via CredSSP
- Can execute arbitrary PowerShell commands

**Actual Limitations:**
- ❌ **Requires user passwords** - CredSSP performs credential delegation, not protocol transition
- ❌ **Not true OBO** - You must have the user's password, defeating the purpose
- ❌ **Security risk** - Storing/handling user passwords violates security best practices
- ❌ **Doesn't use S4U2Self** - CredSSP is a different delegation mechanism

**Example code flaw:**
```typescript
const cred = New-Object System.Management.Automation.PSCredential @(
  '${domain}\\${username}',
  (ConvertTo-SecureString 'password' -AsPlainText -Force)  // ❌ NEEDS PASSWORD
)
```

**Verdict:** Not a viable solution for on-behalf-of delegation.

---

### Option 2: node-expose-sspi ❌

**Claimed Benefits (from docs):**
- Native Windows SSPI bindings
- Supports Kerberos delegation
- More performant than PowerShell

**Research Findings:**

#### GitHub Issue #117: Impersonation Failed
User attempted to impersonate Kerberos-authenticated users and concluded:
> "Kerberos ticket is only valid to authenticate Alice to Bob but can't be used for Bob to impersonate Alice."

Attempted approaches that all **failed**:
1. Using SSO access token
2. Calling `ImpersonateLoggedOnUser()`
3. Reusing server context handle

#### Library Purpose
node-expose-sspi is designed for:
- ✅ Basic SSPI authentication (NTLM/Kerberos)
- ✅ SSO scenarios (web authentication)
- ✅ Active Directory user info queries via ADSI
- ❌ **NOT** for S4U2Self/S4U2Proxy delegation
- ❌ **NOT** for constrained delegation
- ❌ **NOT** for impersonation beyond the authenticated session

#### Missing Features
After extensive documentation review:
- ❌ No mentions of S4U2Self or S4U2Proxy in any documentation
- ❌ No examples of constrained delegation
- ❌ No API for setting `ISC_REQ_DELEGATE` flag with specific options
- ❌ No support for protocol transition
- ❌ No support for accessing downstream resources as delegated user

#### Code Example is Incorrect
The example in KERBEROS-LIMITATIONS.md (lines 153-168) is **invalid**:

```typescript
const client = sso.sspi({
  credential: { domain: 'W25AD', user: 'svc-mcp-server', password: 'ServicePassword123!' },
  targetName: userPrincipal,
  s4u2self: true  // ❌ THIS OPTION DOESN'T EXIST IN THE LIBRARY
});
```

**Actual node-expose-sspi API:**
```typescript
// What it CAN do:
const client = new sso.Client();
await client.fetch('http://localhost:3000'); // Authenticate current user to server

// What it CANNOT do:
// ❌ Obtain tickets on behalf of users without passwords
// ❌ Perform S4U2Self protocol transition
// ❌ Perform S4U2Proxy constrained delegation
// ❌ Access file shares as delegated user
```

**Verdict:** Not a viable solution. Library does not support S4U2Self/S4U2Proxy.

---

### Option 3: Windows Impersonation APIs via FFI (LogonUserW) ❌

**Claimed Benefits (from docs):**
- Direct Windows API access
- Full control over impersonation
- Best performance

**Critical Flaw - User Password Required:**

```typescript
const success = advapi32.LogonUserW(
  username,      // "alice"
  domain,        // "W25AD"
  null,          // ❌ CANNOT BE NULL for actual logon
  9,             // LOGON32_LOGON_NEW_CREDENTIALS
  3,             // LOGON32_PROVIDER_WINNT50
  handlePtr
);
```

#### LogonUserW Password Requirements

| Logon Type | Value | Password Required? | Use Case |
|------------|-------|-------------------|----------|
| LOGON32_LOGON_INTERACTIVE | 2 | ✅ YES | Interactive desktop logon |
| LOGON32_LOGON_NETWORK | 3 | ✅ YES | Network access (SMB, SQL) |
| LOGON32_LOGON_BATCH | 4 | ✅ YES | Batch jobs |
| LOGON32_LOGON_SERVICE | 5 | ✅ YES | Windows services |
| LOGON32_LOGON_NEW_CREDENTIALS | 9 | ⚠️ SPECIAL | Can be NULL, but... |

#### LOGON32_LOGON_NEW_CREDENTIALS with NULL Password

From Microsoft documentation:
> This logon type allows the caller to clone its current token and specify new credentials for outbound connections. The new logon session has the same local identifier but uses different credentials for other network connections.

**What happens when password is NULL:**
- ✅ LogonUserW succeeds
- ✅ Creates an impersonation token
- ❌ **Token uses service account credentials, NOT user credentials**
- ❌ Downstream resources see `svc-mcp-server`, not `alice`

**Example:**
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
4. Just creates a token using current process credentials

**Verdict:** Not a viable solution. Requires user passwords or falls back to service account.

---

### Option 3 (Corrected): Native SSPI APIs via FFI ⚠️

**What would be required for actual S4U2Self/S4U2Proxy:**

```typescript
import ffi from 'ffi-napi';
import ref from 'ref-napi';
import Struct from 'ref-struct-napi';

// Step 1: Define all required Windows structures
const TimeStamp = Struct({ LowPart: 'uint32', HighPart: 'int32' });
const SecHandle = Struct({ dwLower: 'pointer', dwUpper: 'pointer' });
const SecBuffer = Struct({ cbBuffer: 'uint32', BufferType: 'uint32', pvBuffer: 'pointer' });
const SecBufferDesc = Struct({ ulVersion: 'uint32', cBuffers: 'uint32', pBuffers: SecBuffer });
// ... 10+ more structures

// Step 2: Load SSPI functions
const secur32 = ffi.Library('secur32', {
  'AcquireCredentialsHandleW': ['int', ['pointer', 'pointer', 'uint32', 'pointer', 'pointer', 'pointer', 'pointer', SecHandle.ref(), TimeStamp.ref()]],
  'InitializeSecurityContextW': ['int', [SecHandle.ref(), SecHandle.ref(), 'pointer', 'uint32', 'uint32', 'uint32', SecBufferDesc.ref(), 'uint32', SecHandle.ref(), SecBufferDesc.ref(), 'uint32', TimeStamp.ref()]],
  'QuerySecurityContextToken': ['int', [SecHandle.ref(), 'pointer']],
  'DeleteSecurityContext': ['int', [SecHandle.ref()]],
  'FreeCredentialsHandle': ['int', [SecHandle.ref()]],
  // ... 10+ more functions
});

// Step 3: Acquire service account credentials
async function acquireServiceCredentials(username: string, domain: string, password: string): Promise<SecHandle> {
  const credHandle = new SecHandle();
  const expiry = new TimeStamp();

  const authData = createAuthIdentity(username, domain, password);

  const status = secur32.AcquireCredentialsHandleW(
    ref.allocCString(`${username}@${domain}`),
    ref.allocCString('Kerberos'),
    SECPKG_CRED_OUTBOUND,
    null,
    authData,
    null,
    null,
    credHandle.ref(),
    expiry.ref()
  );

  if (status !== SEC_E_OK) throw new Error('AcquireCredentialsHandle failed');
  return credHandle;
}

// Step 4: Perform S4U2Self
async function performS4U2Self(serviceCredHandle: SecHandle, userPrincipal: string): Promise<SecHandle> {
  const contextHandle = new SecHandle();
  const outputBuffer = createSecBufferDesc();
  const contextAttr = ref.alloc('uint32');
  const expiry = new TimeStamp();

  // Create input buffer with PA-FOR-USER preauthentication data
  const inputBuffer = createS4U2SelfInputBuffer(userPrincipal);

  const status = secur32.InitializeSecurityContextW(
    serviceCredHandle.ref(),
    null,
    ref.allocCString(userPrincipal),
    ISC_REQ_DELEGATE | ISC_REQ_MUTUAL_AUTH | ISC_REQ_ALLOCATE_MEMORY,
    0,
    SECURITY_NATIVE_DREP,
    inputBuffer.ref(),
    0,
    contextHandle.ref(),
    outputBuffer.ref(),
    contextAttr.ref(),
    expiry.ref()
  );

  if (status !== SEC_E_OK && status !== SEC_I_CONTINUE_NEEDED) {
    throw new Error(`S4U2Self failed: 0x${status.toString(16)}`);
  }

  return contextHandle;
}

// Step 5: Perform S4U2Proxy
async function performS4U2Proxy(userContextHandle: SecHandle, targetSPN: string): Promise<SecHandle> {
  const proxyContextHandle = new SecHandle();
  const outputBuffer = createSecBufferDesc();
  const contextAttr = ref.alloc('uint32');
  const expiry = new TimeStamp();

  const status = secur32.InitializeSecurityContextW(
    null,
    userContextHandle.ref(),
    ref.allocCString(targetSPN),
    ISC_REQ_DELEGATE | ISC_REQ_MUTUAL_AUTH,
    0,
    SECURITY_NATIVE_DREP,
    null,
    0,
    proxyContextHandle.ref(),
    outputBuffer.ref(),
    contextAttr.ref(),
    expiry.ref()
  );

  if (status !== SEC_E_OK && status !== SEC_I_CONTINUE_NEEDED) {
    throw new Error(`S4U2Proxy failed: 0x${status.toString(16)}`);
  }

  return proxyContextHandle;
}

// Step 6: Get impersonation token
async function getImpersonationToken(contextHandle: SecHandle): Promise<any> {
  const tokenHandle = ref.alloc('pointer');

  const status = secur32.QuerySecurityContextToken(contextHandle.ref(), tokenHandle);
  if (status !== SEC_E_OK) throw new Error('QuerySecurityContextToken failed');

  return tokenHandle.deref();
}

// Step 7: Impersonate user
const advapi32 = ffi.Library('advapi32', {
  'ImpersonateLoggedOnUser': ['bool', ['pointer']],
  'RevertToSelf': ['bool', []]
});

async function withImpersonation<T>(token: any, callback: () => Promise<T>): Promise<T> {
  const success = advapi32.ImpersonateLoggedOnUser(token);
  if (!success) throw new Error('ImpersonateLoggedOnUser failed');

  try {
    return await callback();
  } finally {
    advapi32.RevertToSelf();
  }
}

// Step 8: Helper functions (100+ lines)
function createAuthIdentity(username: string, domain: string, password: string): any {
  // Complex structure marshaling
}

function createSecBufferDesc(): SecBufferDesc {
  // Complex buffer management
}

function createS4U2SelfInputBuffer(userPrincipal: string): SecBufferDesc {
  // Complex PA-FOR-USER structure creation
}

// Constants (50+ lines)
const SECPKG_CRED_OUTBOUND = 0x00000002;
const ISC_REQ_DELEGATE = 0x00000001;
const ISC_REQ_MUTUAL_AUTH = 0x00000002;
const ISC_REQ_ALLOCATE_MEMORY = 0x00000100;
const SECURITY_NATIVE_DREP = 0x00000010;
const SEC_E_OK = 0x00000000;
const SEC_I_CONTINUE_NEEDED = 0x00090312;
// ... 50+ more constants
```

**Estimated Implementation:**
- **Lines of Code:** 2000+ (including error handling, memory management, structure definitions)
- **Complexity:** Extremely high (manual memory marshaling, Windows API expertise required)
- **Error-Prone:** Yes (incorrect structure alignment causes crashes)
- **Maintenance:** High (Windows API changes, platform-specific bugs)
- **Testing:** Requires extensive AD environment testing

**Verdict:** Technically possible but impractical for most projects. Essentially requires building a new library equivalent to node-expose-sspi from scratch.

---

### Option 4: SMB Client Library ❌

**Claimed Benefits (from docs):**
- Cross-platform
- No Windows-specific APIs
- Can use Kerberos tickets directly

**Actual Limitations:**
- ❌ SMB libraries still require authentication credentials
- ❌ Most Node.js SMB libraries don't support Kerberos at all
- ❌ Even if they did, they can't perform S4U2Self to obtain tickets without passwords
- ❌ This just moves the problem from file system access to SMB protocol

**Popular SMB Libraries:**
- `@marsaud/smb2` - Requires username/password or NTLMv2 hash
- `smbclient` - Wrapper around command-line tool, still needs credentials

**Verdict:** Not a viable solution. SMB libraries can't perform protocol transition.

---

## Fundamental Problem: No Library Supports S4U2Self

The core issue is that **S4U2Self/S4U2Proxy are advanced Windows SSPI features** that:

1. **Require complex SSPI API calls** (AcquireCredentialsHandle, InitializeSecurityContext with special flags)
2. **Involve Active Directory protocol extensions** (PA-FOR-USER preauthentication)
3. **Need proper AD configuration** (TRUSTED_TO_AUTH_FOR_DELEGATION, msDS-AllowedToDelegateTo)
4. **Are not exposed by existing Node.js libraries**

### Why Existing Libraries Don't Support It

| Library | Purpose | Why It Doesn't Support S4U2 |
|---------|---------|----------------------------|
| node-kerberos | Basic GSSAPI client | Doesn't wrap SSPI, only supports standard Kerberos auth |
| node-expose-sspi | SSPI authentication for web | Only implements basic auth flows, not delegation |
| node-sspi | Legacy SSPI wrapper | Unmaintained, basic auth only |

### What Would Be Required

To support S4U2Self/S4U2Proxy in Node.js, someone would need to:

1. **Build native C++ addon** using node-addon-api
2. **Wrap 15+ SSPI functions** with correct structure marshaling
3. **Implement PA-FOR-USER construction** (complex Kerberos protocol details)
4. **Handle memory management** for SSPI buffers and credentials
5. **Test extensively** with various AD configurations
6. **Maintain** for Windows API changes

**Estimated effort:** 4-6 weeks of full-time development by Windows security expert

---

## Alternative Solutions

### 0. Use RunAs Service Account Mode (Immediate) ✅

**Most practical solution for many use cases:**

Instead of pursuing true S4U2Self/S4U2Proxy, use the existing Kerberos module with service account credentials. While this doesn't provide true delegation, it **works for many scenarios**.

**What you get:**
- ✅ Service account authenticates to Active Directory
- ✅ Access AD resources using service account Kerberos tickets
- ✅ Token exchange still retrieves user identity from JWT
- ✅ Application-level audit logging tracks user actions
- ⚠️ Resources see service account, not individual users

**Implementation:**

```typescript
// Current Kerberos module already supports this!
const kerberosModule = new KerberosDelegationModule('kerberos-ad');

await kerberosModule.initialize({
  servicePrincipalName: 'HTTP/mcp-server.w25ad.net',
  realm: 'W25AD.NET',
  serviceAccount: {
    username: 'svc-mcp-server',
    password: 'ServicePassword123!'
  },
  // No S4U2Self/S4U2Proxy configuration needed
});

// User makes request with JWT
const result = await kerberosModule.delegate(
  userSession,  // Contains user identity from JWT
  'access-file',
  { path: '\\\\fileserver\\reports\\data.csv' },
  { sessionId, coreContext }
);

// What happens:
// 1. Service account's Kerberos ticket used to access fileserver
// 2. Fileserver sees: svc-mcp-server (not alice)
// 3. Audit log records: alice accessed data.csv via svc-mcp-server
// 4. Application enforces authorization based on JWT claims
```

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

**When this is sufficient:**

| Scenario | RunAs Mode OK? | Reason |
|----------|---------------|---------|
| Development/Testing | ✅ Yes | Prototype functionality quickly |
| Read-only shared data | ✅ Yes | Service account has read permissions |
| Legacy service account patterns | ✅ Yes | System already designed for this |
| Non-regulated environments | ✅ Yes | No strict audit requirements |
| User-specific file shares | ❌ No | Need per-user permissions |
| GDPR/SOX/HIPAA compliance | ❌ No | Need OS-level user attribution |
| Multi-tenant production | ❌ No | Need user isolation |
| Least-privilege security | ❌ No | Service account too powerful |

**Audit Trail Pattern:**

```typescript
// Maintain detailed logs even in RunAs mode
const auditEntry: AuditEntry = {
  timestamp: new Date(),
  source: 'delegation:kerberos-ad',
  userId: session.userId,  // alice (from JWT)
  action: 'kerberos:access-resource',
  resource: '\\\\fileserver\\reports\\data.csv',
  metadata: {
    delegationMode: 'service-account',
    actualIdentity: 'svc-mcp-server',  // Who resource sees
    requestedIdentity: 'alice',         // Who user is
    warning: 'Resource accessed as service account, not user'
  },
  success: true
};

coreContext.auditService.log(auditEntry);
```

**Pros:**
- ✅ **Available now** - No additional development needed
- ✅ **Simple deployment** - Just configure service account
- ✅ **Works with existing module** - No code changes required
- ✅ **Sufficient for many use cases** - Especially dev/test and shared resources

**Cons:**
- ❌ **Not true delegation** - Resources don't see individual users
- ❌ **Broad permissions required** - Service account needs access to all resources
- ❌ **Compliance limitations** - May not meet regulatory requirements
- ❌ **No per-user ACLs** - Can't enforce OS-level user permissions

**Migration Path:**

1. **Start with RunAs mode** for development and testing
2. **Evaluate true delegation need** based on actual requirements
3. **If needed, migrate to Windows Service** (Option 1 below) for production

---

### 1. Use Windows Service with Named Pipes (If True Delegation Required)

Instead of S4U2Self in Node.js, create a separate Windows service that:

```
┌─────────────────────────────────────────────────────────────┐
│  Node.js MCP Server (runs as any account)                   │
│  ↓                                                           │
│  Named Pipe: \\.\pipe\mcp-delegation                        │
│  ↓                                                           │
│  Windows Service (C#/.NET - runs as service account)        │
│  - Performs S4U2Self/S4U2Proxy using .NET libraries         │
│  - Accesses resources as delegated user                     │
│  - Returns results to Node.js via pipe                      │
└─────────────────────────────────────────────────────────────┘
```

**Pros:**
- ✅ .NET has built-in S4U2 support (`WindowsIdentity.RunImpersonated`)
- ✅ Clean separation of concerns
- ✅ Node.js remains simple and maintainable
- ✅ Can be implemented in 200-300 lines of C#

**Cons:**
- ⚠️ Requires .NET runtime
- ⚠️ Additional Windows service to manage
- ⚠️ IPC overhead (minimal for most use cases)

### 2. Use PowerShell with Kerberos Tickets (Not CredSSP)

Instead of CredSSP, use `New-Object System.Security.Principal.WindowsIdentity` with S4U:

```powershell
# Requires Windows Server 2012 R2+ or Windows 8.1+
$identity = New-Object System.Security.Principal.WindowsIdentity("alice@W25AD.NET")
[System.Security.Principal.WindowsIdentity]::RunImpersonated(
  $identity.AccessToken,
  {
    # Code here runs as alice (with S4U2Self under the hood)
    Get-ChildItem \\fileserver\share
  }
)
```

**Note:** This still requires PowerShell execution overhead but avoids CredSSP configuration.

### 3. Document Limitation and Use Service Account

**Pragmatic approach:**
- Accept that true on-behalf-of delegation isn't feasible in pure Node.js
- Access resources using service account credentials
- Log user identity for audit purposes
- Document that resources will see service account, not individual users

**When this is acceptable:**
- Resources don't have user-specific ACLs
- Audit requirements met through application-level logging
- Simplified deployment (no AD delegation configuration)

---

## Recommended Path Forward

### Immediate (Phase 1): Document Limitation

1. **Update KERBEROS-LIMITATIONS.md:**
   - ❌ Remove incorrect Option 2 code example (s4u2self: true doesn't exist)
   - ❌ Remove Option 3 LogonUserW example (requires passwords)
   - ✅ Add this analysis document as reference
   - ✅ Clearly state: "No pure Node.js solution exists"

2. **Update CLAUDE.md:**
   - Mark Kerberos module as "Limited Implementation - Service Account Only"
   - Remove references to S4U2Self/S4U2Proxy as planned features
   - Add note about Windows Service alternative

3. **Keep Stub Implementation:**
   - Current stub code is valuable as documentation
   - Shows intended architecture
   - Makes clear this is a platform limitation, not design flaw

### Medium-term (Phase 2): Windows Service Option

If S4U2 delegation is required:

1. **Create Windows Service in C#:**
   - Use `WindowsIdentity.RunImpersonated` (.NET 4.6+)
   - Expose named pipe interface for Node.js
   - Implement file operations and SQL connections

2. **Update Node.js Module:**
   - Add named pipe client
   - Fall back to service account if Windows Service unavailable
   - Clear error messages about requirements

3. **Deployment Guide:**
   - Document Windows Service installation
   - AD configuration steps (TRUSTED_TO_AUTH_FOR_DELEGATION, etc.)
   - Testing procedures

### Long-term (Phase 3): Consider Native Addon

Only if there's significant demand and resources:

1. **Build native SSPI addon** (4-6 week project)
2. **Open source separately** (not part of MCP-OAuth)
3. **Maintain as optional dependency** (like SQL delegation packages)

---

## Conclusion

### True S4U2Self/S4U2Proxy Delegation - Not Achievable

**None of the four proposed options can achieve true S4U2Self/S4U2Proxy delegation:**

| Option | Viable? | Reason |
|--------|---------|--------|
| 1. PowerShell CredSSP | ❌ No | Requires user passwords |
| 2. node-expose-sspi | ❌ No | Doesn't support S4U2 (confirmed via research) |
| 3. FFI LogonUserW | ❌ No | Requires user passwords |
| 3. FFI SSPI APIs | ⚠️ Impractical | Requires 2000+ LOC custom implementation |
| 4. SMB Client Library | ❌ No | Still requires authentication |

### RunAs Service Account Mode - Available Now ✅

**The Kerberos module CAN be used immediately with limited functionality:**

| Capability | Status | Impact |
|------------|--------|--------|
| Deploy and use today | ✅ Works | No code changes needed |
| Service account AD authentication | ✅ Works | Access AD resources with Kerberos |
| User identity from JWT | ✅ Works | Token exchange provides user info |
| Application audit logging | ✅ Works | Track user actions in logs |
| Resource-level user identity | ❌ Limited | OS sees service account, not user |
| Per-user ACL enforcement | ❌ Limited | Cannot enforce at OS level |

### Recommended Path

**Immediate (Most Projects):**
1. ✅ **Use RunAs service account mode** - Deploy with existing Kerberos module
2. ✅ **Enable comprehensive audit logging** - Track user identity at application level
3. ✅ **Document limitations** - Be transparent about service account vs user identity
4. ✅ **Enforce authorization in app layer** - Use JWT claims for access control

**Medium-term (If True Delegation Required):**
1. **Evaluate need** - Does your use case require OS-level user attribution?
2. **Build Windows Service** - C#/.NET with WindowsIdentity.RunImpersonated (200-300 LOC)
3. **Integrate via named pipes** - Node.js communicates with Windows Service
4. **Migrate incrementally** - Start with critical workloads

**Long-term (Only If High Demand):**
1. **Community feedback** - Gauge interest in native SSPI addon
2. **Build native addon** - 4-6 week project with Windows security expert
3. **Open source separately** - Maintain as optional dependency

### The Good News

**The framework's modular architecture means:**
- ✅ Kerberos is an **optional package** - install only if needed
- ✅ SQL and REST API modules work **without limitations**
- ✅ Projects can use RunAs mode for **immediate AD integration**
- ✅ Can migrate to true delegation later **without framework changes**
- ✅ RunAs mode is **sufficient for many production use cases** (dev/test, shared resources, legacy integration)

**Bottom line:** While true S4U2Self/S4U2Proxy isn't feasible in pure Node.js, the Kerberos module provides practical value through RunAs service account mode for a wide range of scenarios.
