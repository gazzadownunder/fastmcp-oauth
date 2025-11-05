# Kerberos Delegation - Current Limitations and Roadmap

## Current Status

The Kerberos delegation module has **stub implementations** of S4U2Self and S4U2Proxy. This is because the underlying `node-kerberos` library (v2.2.2) does NOT support Windows Kerberos Constrained Delegation features.

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

### Option 2: node-expose-sspi (Medium-term)

**Pros:**
- Native Windows SSPI bindings
- Supports Kerberos delegation
- More performant than PowerShell

**Cons:**
- Requires native addon compilation
- Windows-only
- More complex integration

**Implementation:**

```bash
npm install node-expose-sspi
```

```typescript
import { sso } from 'node-expose-sspi';

async function performS4U2Self(userPrincipal: string): Promise<Buffer> {
  const client = sso.sspi({
    credential: {
      domain: 'W25AD',
      user: 'svc-mcp-server',
      password: 'ServicePassword123!'
    },
    targetName: userPrincipal,
    s4u2self: true
  });

  const token = await client.clientSecurityContext.initialize();
  return token;
}
```

### Option 3: Windows Impersonation APIs via FFI (Long-term)

**Pros:**
- Direct Windows API access
- Full control over impersonation
- Best performance

**Cons:**
- Requires node-ffi-napi
- Complex native API integration
- Error-prone (manual memory management)

**Implementation:**

```typescript
import ffi from 'ffi-napi';
import ref from 'ref-napi';

const advapi32 = ffi.Library('advapi32', {
  'LogonUserW': ['bool', ['string', 'string', 'string', 'int', 'int', ref.refType('pointer')]],
  'ImpersonateLoggedOnUser': ['bool', ['pointer']],
  'RevertToSelf': ['bool', []]
});

async function withImpersonation<T>(
  username: string,
  domain: string,
  callback: () => Promise<T>
): Promise<T> {
  const handlePtr = ref.alloc('pointer');

  const success = advapi32.LogonUserW(
    username,
    domain,
    null, // Use Kerberos ticket instead of password
    9, // LOGON32_LOGON_NEW_CREDENTIALS
    3, // LOGON32_PROVIDER_WINNT50
    handlePtr
  );

  if (!success) throw new Error('LogonUser failed');

  advapi32.ImpersonateLoggedOnUser(handlePtr.deref());

  try {
    return await callback();
  } finally {
    advapi32.RevertToSelf();
  }
}
```

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

**For immediate use:** Implement **Option 1 (PowerShell with CredSSP)**

Reasons:
1. Works with existing infrastructure
2. No new dependencies required
3. Leverages Windows built-in delegation
4. Can be implemented in < 100 LOC

**For production use:** Implement **Option 2 (node-expose-sspi)**

Reasons:
1. Native Windows SSPI support
2. Better performance than PowerShell
3. Proper Kerberos ticket handling
4. Active maintenance

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

## Known Issues

1. **node-kerberos doesn't support S4U2Self/S4U2Proxy**
   - Workaround: Stub implementation + PowerShell delegation
   - Long-term fix: Replace with node-expose-sspi

2. **fs module doesn't use security context**
   - Workaround: PowerShell Invoke-Command with CredSSP
   - Long-term fix: Windows impersonation APIs

3. **Cross-platform support**
   - Current: Windows-only (SSPI required)
   - Future: Linux support via MIT Kerberos + GSS-API

## References

- [MS-SFU]: Service for User and Constrained Delegation Protocol
  https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-sfu/

- [RFC 4120]: The Kerberos Network Authentication Service (V5)
  https://www.rfc-editor.org/rfc/rfc4120

- [node-expose-sspi Documentation]
  https://github.com/jlguenego/node-expose-sspi

- [Kerberos Delegation Explained]
  https://medium.com/@robert.broeckelmann/kerberos-and-windows-security-delegation-7b5a3f31d779
