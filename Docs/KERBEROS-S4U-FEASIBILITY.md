# S4U2Self/S4U2Proxy Feasibility Assessment for mongodb-js/kerberos

**Date:** 2025-01-08
**Library:** https://github.com/mongodb-js/kerberos
**Assessment For:** MCP-OAuth Framework Kerberos Delegation Module

---

## Executive Summary

**Feasibility Rating: ⚠️ MODERATE - Requires Significant C++ Development**

Adding S4U2Self/S4U2Proxy support to the mongodb-js/kerberos library is **technically feasible** but requires:

1. **C++ Native Extension Development** - Modify low-level SSPI (Windows) and GSSAPI (Linux) code
2. **Platform-Specific Implementation** - Separate code paths for Windows and Linux
3. **Breaking API Changes** - New methods and credential handling patterns
4. **Extensive Testing** - Active Directory setup, cross-platform validation
5. **Upstream Contribution** - MongoDB team approval and maintenance commitment

**Recommendation:** For MCP-OAuth project timeline, **use alternative approaches** (see Section 9).

---

## 1. Current Library Capabilities

### 1.1 Architecture

```
┌─────────────────────────────────────────────────────────┐
│              Node.js JavaScript API                      │
│  (src/kerberos.cc - N-API bindings)                     │
└──────────────────┬──────────────────────────────────────┘
                   │
         ┌─────────┴─────────┐
         │                   │
┌────────▼────────┐  ┌──────▼──────────┐
│ GSSAPI (Unix)   │  │  SSPI (Windows) │
│ src/unix/       │  │  src/win32/     │
│ kerberos_gss.cc │  │  kerberos_sspi.cc│
└─────────────────┘  └─────────────────┘
```

### 1.2 Current Features

**Supported:**
- ✅ Client-side authentication (gss_init_sec_context / InitializeSecurityContext)
- ✅ Server-side authentication (gss_accept_sec_context / AcceptSecurityContext)
- ✅ Basic credential delegation (GSS_C_DELEG_FLAG / ISC_REQ_DELEGATE)
- ✅ Credential forwarding to remote hosts
- ✅ Cross-platform (Linux, macOS, Windows)

**NOT Supported:**
- ❌ S4U2Self (Protocol Transition)
- ❌ S4U2Proxy (Constrained Delegation)
- ❌ Service-for-User (S4U) credential acquisition
- ❌ Impersonation without user password

### 1.3 Current GSSAPI Functions (Linux)

```c
// Existing functions in src/unix/kerberos_gss.cc
gss_import_name()              // Import principal name
gss_acquire_cred()             // Acquire credentials (NORMAL)
gss_init_sec_context()         // Initialize client context
gss_accept_sec_context()       // Accept server context
gss_display_name()             // Display principal name
gss_wrap() / gss_unwrap()      // Message protection
gss_delete_sec_context()       // Cleanup
gss_release_*()                // Resource cleanup
gss_display_status()           // Error handling
gss_inquire_context()          // Query context attributes
```

**Missing for S4U:**
```c
// Required additions for S4U2Self/S4U2Proxy
gss_acquire_cred_impersonate_name()  // S4U2Self credential acquisition
gss_add_cred_impersonate_name()      // Add impersonation credentials
```

### 1.4 Current SSPI Functions (Windows)

```c
// Existing functions in src/win32/kerberos_sspi.cc
AcquireCredentialsHandleW()    // Acquire credentials (NORMAL)
InitializeSecurityContextW()   // Initialize client context
QueryContextAttributesW()      // Query context attributes
DecryptMessage()               // Message protection
EncryptMessage()               // Message protection
FreeCredentialsHandle()        // Cleanup
DeleteSecurityContext()        // Cleanup
```

**Missing for S4U:**
```c
// Required additions for S4U2Self/S4U2Proxy
AcquireCredentialsHandleW() with KERB_S4U_LOGON  // S4U2Self
InitializeSecurityContextW() with ISC_REQ_USE_SESSION_KEY  // S4U2Proxy
QuerySecurityContextToken()    // Extract user token
ImpersonateSecurityContext()   // Impersonate user
```

---

## 2. S4U2Self/S4U2Proxy Requirements

### 2.1 Windows SSPI Implementation

**S4U2Self (Protocol Transition):**

```c
// Step 1: Acquire service credentials with S4U2Self support
SEC_WINNT_AUTH_IDENTITY authData;
authData.User = L"svc-mcp-server";
authData.Domain = L"W25AD.NET";
authData.Password = L"ServicePassword123!";
authData.Flags = SEC_WINNT_AUTH_IDENTITY_UNICODE;

CredHandle serviceCredHandle;
SECURITY_STATUS status = AcquireCredentialsHandleW(
    L"HTTP/mcp-server.w25ad.net",  // Service SPN
    MICROSOFT_KERBEROS_NAME,
    SECPKG_CRED_BOTH,              // Inbound + Outbound
    NULL,
    &authData,                     // Service credentials
    NULL,
    NULL,
    &serviceCredHandle,
    &expiry
);

// Step 2: Construct S4U2Self request for user impersonation
KERB_S4U_LOGON s4uLogon = {0};
s4uLogon.MessageType = KerbS4ULogon;
s4uLogon.Flags = 0;
s4uLogon.ClientUpn = {
    .Length = wcslen(L"alice@W25AD.NET") * sizeof(WCHAR),
    .MaximumLength = wcslen(L"alice@W25AD.NET") * sizeof(WCHAR),
    .Buffer = L"alice@W25AD.NET"
};
s4uLogon.ClientRealm = { /* ... */ };

// Step 3: Obtain user's TGT via S4U2Self
CtxtHandle s4uContext;
status = InitializeSecurityContextW(
    &serviceCredHandle,            // Service credentials
    NULL,                          // No previous context
    L"alice@W25AD.NET",            // User to impersonate
    ISC_REQ_DELEGATE | ISC_REQ_ALLOCATE_MEMORY,
    0,
    SECURITY_NATIVE_DREP,
    &s4uLogon,                     // S4U2Self input
    0,
    &s4uContext,
    &outputBuffer,
    &contextAttr,
    &expiry
);

// Step 4: Extract user's delegated credentials
SecHandle userCredHandle;
status = QuerySecurityContextToken(&s4uContext, &userCredHandle);
```

**S4U2Proxy (Constrained Delegation):**

```c
// Step 5: Use delegated credentials for proxy request
CtxtHandle proxyContext;
status = InitializeSecurityContextW(
    &userCredHandle,               // User's delegated credentials (from S4U2Self)
    NULL,
    L"cifs/fileserver.w25ad.net",  // Target SPN
    ISC_REQ_DELEGATE | ISC_REQ_USE_SESSION_KEY | ISC_REQ_ALLOCATE_MEMORY,
    0,
    SECURITY_NATIVE_DREP,
    NULL,                          // No input token
    0,
    &proxyContext,
    &outputBuffer,
    &contextAttr,
    &expiry
);

// Now proxyContext can access fileserver as alice!
```

### 2.2 Linux GSSAPI Implementation

**S4U2Self (Protocol Transition):**

```c
// Step 1: Acquire service credentials
gss_cred_id_t service_cred = GSS_C_NO_CREDENTIAL;
gss_name_t service_name;
OM_uint32 major, minor;

// Import service principal name
major = gss_import_name(&minor, &service_name_buf,
                        GSS_C_NT_USER_NAME, &service_name);

// Acquire service credentials (using keytab)
major = gss_acquire_cred(&minor, service_name, 0,
                         GSS_C_NO_OID_SET, GSS_C_BOTH,
                         &service_cred, NULL, NULL);

// Step 2: Import user principal to impersonate
gss_name_t user_name;
major = gss_import_name(&minor, &user_name_buf,
                        GSS_C_NT_USER_NAME, &user_name);

// Step 3: Acquire impersonated credentials (S4U2Self)
gss_cred_id_t impersonated_cred = GSS_C_NO_CREDENTIAL;
major = gss_acquire_cred_impersonate_name(
    &minor,
    service_cred,         // Service credentials
    user_name,            // User to impersonate
    0,                    // Lifetime
    GSS_C_NO_OID_SET,     // Desired mechs
    GSS_C_INITIATE,       // Cred usage
    &impersonated_cred,   // Output: user's credentials
    NULL,
    NULL
);
```

**S4U2Proxy (Constrained Delegation):**

```c
// Step 4: Import target service name
gss_name_t target_name;
major = gss_import_name(&minor, &target_name_buf,
                        GSS_C_NT_HOSTBASED_SERVICE, &target_name);

// Step 5: Initialize security context with impersonated credentials
gss_ctx_id_t proxy_context = GSS_C_NO_CONTEXT;
gss_buffer_desc output_token = GSS_C_EMPTY_BUFFER;

major = gss_init_sec_context(
    &minor,
    impersonated_cred,    // User's credentials (from S4U2Self)
    &proxy_context,
    target_name,          // Target SPN (e.g., nfs/fileserver)
    GSS_C_NO_OID,
    GSS_C_DELEG_FLAG | GSS_C_MUTUAL_FLAG,
    0,
    GSS_C_NO_CHANNEL_BINDINGS,
    GSS_C_NO_BUFFER,
    NULL,
    &output_token,
    NULL,
    NULL
);

// Now proxy_context can access target service as user!
```

---

## 3. Required Code Changes

### 3.1 JavaScript API (src/kerberos.cc)

**New Methods Required:**

```javascript
// S4U2Self - Acquire credentials for user impersonation
const impersonatedCred = await kerberos.acquireCredImpersonate({
  servicePrincipal: 'HTTP/mcp-server@W25AD.NET',
  serviceUsername: 'svc-mcp-server',
  servicePassword: 'ServicePassword123!',  // Windows
  // OR
  serviceKeytab: '/etc/keytabs/svc-mcp-server.keytab',  // Linux
  targetUser: 'alice@W25AD.NET',
  realm: 'W25AD.NET'
});

// S4U2Proxy - Use impersonated credentials to access target
const proxyContext = await kerberos.initializeProxyContext({
  impersonatedCred: impersonatedCred,
  targetSPN: 'cifs/fileserver.w25ad.net'
});

// Extract service ticket
const ticket = await kerberos.getServiceTicket(proxyContext);
```

### 3.2 GSSAPI Extension (src/unix/kerberos_gss.cc)

**New Functions:**

```c
// Wrapper for gss_acquire_cred_impersonate_name
Napi::Value AcquireCredImpersonate(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    // Extract parameters from JavaScript
    std::string servicePrincipal = info[0].As<Napi::String>();
    std::string targetUser = info[1].As<Napi::String>();
    std::string keytabPath = info[2].As<Napi::String>();

    // Set KRB5_KTNAME environment variable
    setenv("KRB5_KTNAME", keytabPath.c_str(), 1);

    // Import service principal name
    gss_name_t service_name;
    gss_buffer_desc service_buf;
    service_buf.value = (void*)servicePrincipal.c_str();
    service_buf.length = servicePrincipal.length();

    OM_uint32 major, minor;
    major = gss_import_name(&minor, &service_buf,
                           GSS_C_NT_USER_NAME, &service_name);
    if (GSS_ERROR(major)) {
        return ThrowGSSError(env, major, minor);
    }

    // Acquire service credentials
    gss_cred_id_t service_cred;
    major = gss_acquire_cred(&minor, service_name, 0,
                            GSS_C_NO_OID_SET, GSS_C_BOTH,
                            &service_cred, NULL, NULL);
    if (GSS_ERROR(major)) {
        return ThrowGSSError(env, major, minor);
    }

    // Import target user name
    gss_name_t user_name;
    gss_buffer_desc user_buf;
    user_buf.value = (void*)targetUser.c_str();
    user_buf.length = targetUser.length();

    major = gss_import_name(&minor, &user_buf,
                           GSS_C_NT_USER_NAME, &user_name);
    if (GSS_ERROR(major)) {
        return ThrowGSSError(env, major, minor);
    }

    // Acquire impersonated credentials (S4U2Self)
    gss_cred_id_t impersonated_cred;
    major = gss_acquire_cred_impersonate_name(
        &minor,
        service_cred,
        user_name,
        0,
        GSS_C_NO_OID_SET,
        GSS_C_INITIATE,
        &impersonated_cred,
        NULL,
        NULL
    );

    if (GSS_ERROR(major)) {
        gss_release_name(&minor, &service_name);
        gss_release_name(&minor, &user_name);
        gss_release_cred(&minor, &service_cred);
        return ThrowGSSError(env, major, minor);
    }

    // Cleanup
    gss_release_name(&minor, &service_name);
    gss_release_name(&minor, &user_name);
    gss_release_cred(&minor, &service_cred);

    // Return opaque handle to JavaScript
    return WrapCredHandle(env, impersonated_cred);
}

// Initialize proxy context with impersonated credentials
Napi::Value InitializeProxyContext(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    gss_cred_id_t impersonated_cred = UnwrapCredHandle(info[0]);
    std::string targetSPN = info[1].As<Napi::String>();

    gss_name_t target_name;
    gss_buffer_desc target_buf;
    target_buf.value = (void*)targetSPN.c_str();
    target_buf.length = targetSPN.length();

    OM_uint32 major, minor;
    major = gss_import_name(&minor, &target_buf,
                           GSS_C_NT_HOSTBASED_SERVICE, &target_name);
    if (GSS_ERROR(major)) {
        return ThrowGSSError(env, major, minor);
    }

    gss_ctx_id_t proxy_context = GSS_C_NO_CONTEXT;
    gss_buffer_desc output_token = GSS_C_EMPTY_BUFFER;

    major = gss_init_sec_context(
        &minor,
        impersonated_cred,
        &proxy_context,
        target_name,
        GSS_C_NO_OID,
        GSS_C_DELEG_FLAG | GSS_C_MUTUAL_FLAG,
        0,
        GSS_C_NO_CHANNEL_BINDINGS,
        GSS_C_NO_BUFFER,
        NULL,
        &output_token,
        NULL,
        NULL
    );

    if (GSS_ERROR(major)) {
        gss_release_name(&minor, &target_name);
        return ThrowGSSError(env, major, minor);
    }

    gss_release_name(&minor, &target_name);
    gss_release_buffer(&minor, &output_token);

    return WrapContextHandle(env, proxy_context);
}
```

### 3.3 SSPI Extension (src/win32/kerberos_sspi.cc)

**New Functions:**

```c
// Wrapper for S4U2Self credential acquisition
Napi::Value AcquireCredImpersonate(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    // Extract parameters
    std::wstring servicePrincipal = ToWideString(info[0].As<Napi::String>());
    std::wstring serviceUsername = ToWideString(info[1].As<Napi::String>());
    std::wstring servicePassword = ToWideString(info[2].As<Napi::String>());
    std::wstring targetUser = ToWideString(info[3].As<Napi::String>());
    std::wstring realm = ToWideString(info[4].As<Napi::String>());

    // Acquire service credentials
    SEC_WINNT_AUTH_IDENTITY_W authData = {0};
    authData.User = (unsigned short*)serviceUsername.c_str();
    authData.UserLength = serviceUsername.length();
    authData.Domain = (unsigned short*)realm.c_str();
    authData.DomainLength = realm.length();
    authData.Password = (unsigned short*)servicePassword.c_str();
    authData.PasswordLength = servicePassword.length();
    authData.Flags = SEC_WINNT_AUTH_IDENTITY_UNICODE;

    CredHandle serviceCredHandle;
    TimeStamp expiry;

    SECURITY_STATUS status = AcquireCredentialsHandleW(
        (SEC_WCHAR*)servicePrincipal.c_str(),
        MICROSOFT_KERBEROS_NAME,
        SECPKG_CRED_BOTH,
        NULL,
        &authData,
        NULL,
        NULL,
        &serviceCredHandle,
        &expiry
    );

    if (status != SEC_E_OK) {
        return ThrowSSPIError(env, status);
    }

    // Construct S4U2Self logon structure
    KERB_S4U_LOGON s4uLogon = {0};
    s4uLogon.MessageType = KerbS4ULogon;
    s4uLogon.Flags = 0;

    UNICODE_STRING clientUpn;
    clientUpn.Length = targetUser.length() * sizeof(WCHAR);
    clientUpn.MaximumLength = clientUpn.Length;
    clientUpn.Buffer = (PWSTR)targetUser.c_str();
    s4uLogon.ClientUpn = clientUpn;

    UNICODE_STRING clientRealm;
    clientRealm.Length = realm.length() * sizeof(WCHAR);
    clientRealm.MaximumLength = clientRealm.Length;
    clientRealm.Buffer = (PWSTR)realm.c_str();
    s4uLogon.ClientRealm = clientRealm;

    // Initialize S4U2Self context
    SecBufferDesc inputDesc = {0};
    SecBuffer inputBuffer = {0};
    inputBuffer.BufferType = SECBUFFER_TOKEN;
    inputBuffer.cbBuffer = sizeof(s4uLogon);
    inputBuffer.pvBuffer = &s4uLogon;
    inputDesc.ulVersion = SECBUFFER_VERSION;
    inputDesc.cBuffers = 1;
    inputDesc.pBuffers = &inputBuffer;

    CtxtHandle s4uContext;
    SecBufferDesc outputDesc = {0};
    SecBuffer outputBuffer = {0};
    outputDesc.ulVersion = SECBUFFER_VERSION;
    outputDesc.cBuffers = 1;
    outputDesc.pBuffers = &outputBuffer;

    ULONG contextAttr;
    status = InitializeSecurityContextW(
        &serviceCredHandle,
        NULL,
        (SEC_WCHAR*)targetUser.c_str(),
        ISC_REQ_DELEGATE | ISC_REQ_ALLOCATE_MEMORY,
        0,
        SECURITY_NATIVE_DREP,
        &inputDesc,
        0,
        &s4uContext,
        &outputDesc,
        &contextAttr,
        &expiry
    );

    if (status != SEC_E_OK && status != SEC_I_CONTINUE_NEEDED) {
        FreeCredentialsHandle(&serviceCredHandle);
        return ThrowSSPIError(env, status);
    }

    // Extract user's delegated credentials
    HANDLE userToken;
    status = QuerySecurityContextToken(&s4uContext, &userToken);
    if (status != SEC_E_OK) {
        DeleteSecurityContext(&s4uContext);
        FreeCredentialsHandle(&serviceCredHandle);
        return ThrowSSPIError(env, status);
    }

    // Convert token to credential handle
    CredHandle userCredHandle;
    status = AcquireCredentialsHandleW(
        NULL,
        MICROSOFT_KERBEROS_NAME,
        SECPKG_CRED_OUTBOUND,
        NULL,
        userToken,  // Use impersonated token
        NULL,
        NULL,
        &userCredHandle,
        &expiry
    );

    CloseHandle(userToken);
    DeleteSecurityContext(&s4uContext);
    FreeCredentialsHandle(&serviceCredHandle);

    if (status != SEC_E_OK) {
        return ThrowSSPIError(env, status);
    }

    // Return opaque handle to JavaScript
    return WrapCredHandle(env, userCredHandle);
}

// Initialize proxy context (similar to GSSAPI version)
Napi::Value InitializeProxyContext(const Napi::CallbackInfo& info) {
    // Similar implementation using InitializeSecurityContextW
    // with ISC_REQ_USE_SESSION_KEY flag for S4U2Proxy
    // ...
}
```

---

## 4. Active Directory Prerequisites

### 4.1 Service Account Configuration

**Required AD Permissions:**

1. **Enable Protocol Transition (S4U2Self):**
   ```powershell
   # PowerShell command
   Set-ADUser -Identity "svc-mcp-server" `
     -TrustedToAuthForDelegation $true
   ```

   **GUI:** Active Directory Users and Computers → Account tab → "Account is trusted for delegation"

2. **Enable Constrained Delegation (S4U2Proxy):**
   ```powershell
   # Add target SPNs to allowed delegation list
   Set-ADUser -Identity "svc-mcp-server" `
     -Add @{'msDS-AllowedToDelegateTo' = @(
       'cifs/fileserver.w25ad.net',
       'http/webapp.w25ad.net',
       'ldap/dc.w25ad.net'
     )}
   ```

   **GUI:** Active Directory Users and Computers → Delegation tab → "Trust this user for delegation to specified services only"

3. **Register Service Principal:**
   ```powershell
   setspn -S HTTP/mcp-server.w25ad.net svc-mcp-server
   ```

### 4.2 Domain Functional Level

**Minimum Requirements:**
- Windows Server 2003 domain functional level (for S4U2Self)
- Windows Server 2008 recommended (improved S4U2Proxy support)

---

## 5. Testing Requirements

### 5.1 Test Environment Setup

**Windows:**
```powershell
# Install Active Directory Domain Services
Install-WindowsFeature -Name AD-Domain-Services -IncludeManagementTools

# Create test domain
Install-ADDSForest -DomainName "test.local"

# Create service account
New-ADUser -Name "svc-mcp-server" -AccountPassword (ConvertTo-SecureString "P@ssw0rd!" -AsPlainText -Force) -Enabled $true

# Configure delegation
Set-ADUser -Identity "svc-mcp-server" -TrustedToAuthForDelegation $true
Set-ADUser -Identity "svc-mcp-server" -Add @{'msDS-AllowedToDelegateTo' = 'cifs/fileserver.test.local'}

# Create test users
New-ADUser -Name "alice" -AccountPassword (ConvertTo-SecureString "AlicePass123!" -AsPlainText -Force) -Enabled $true
New-ADUser -Name "bob" -AccountPassword (ConvertTo-SecureString "BobPass123!" -AsPlainText -Force) -Enabled $true
```

**Linux (MIT Kerberos):**
```bash
# Install Kerberos development libraries
sudo apt-get install libkrb5-dev krb5-user

# Create keytab for service account
ktutil
addent -password -p svc-mcp-server@TEST.LOCAL -k 1 -e aes256-cts-hmac-sha1-96
wkt /etc/keytabs/svc-mcp-server.keytab
quit

# Test S4U2Self support
kvno -U alice@TEST.LOCAL -k /etc/keytabs/svc-mcp-server.keytab HTTP/mcp-server.test.local
```

### 5.2 Unit Tests

**Required Test Cases:**

```javascript
describe('S4U2Self (Protocol Transition)', () => {
  it('should acquire impersonated credentials for valid user', async () => {
    const cred = await kerberos.acquireCredImpersonate({
      servicePrincipal: 'HTTP/mcp-server@TEST.LOCAL',
      serviceUsername: 'svc-mcp-server',
      servicePassword: 'P@ssw0rd!',
      targetUser: 'alice@TEST.LOCAL',
      realm: 'TEST.LOCAL'
    });
    expect(cred).toBeDefined();
  });

  it('should fail for non-existent user', async () => {
    await expect(kerberos.acquireCredImpersonate({
      servicePrincipal: 'HTTP/mcp-server@TEST.LOCAL',
      serviceUsername: 'svc-mcp-server',
      servicePassword: 'P@ssw0rd!',
      targetUser: 'nonexistent@TEST.LOCAL',
      realm: 'TEST.LOCAL'
    })).rejects.toThrow();
  });

  it('should fail if service account lacks TrustedToAuthForDelegation', async () => {
    // Test with non-privileged service account
    await expect(kerberos.acquireCredImpersonate({
      servicePrincipal: 'HTTP/unprivileged@TEST.LOCAL',
      serviceUsername: 'svc-unprivileged',
      servicePassword: 'P@ssw0rd!',
      targetUser: 'alice@TEST.LOCAL',
      realm: 'TEST.LOCAL'
    })).rejects.toThrow(/KDC_ERR_BADOPTION/);
  });
});

describe('S4U2Proxy (Constrained Delegation)', () => {
  it('should initialize proxy context for allowed target', async () => {
    const impersonatedCred = await kerberos.acquireCredImpersonate({
      servicePrincipal: 'HTTP/mcp-server@TEST.LOCAL',
      serviceUsername: 'svc-mcp-server',
      servicePassword: 'P@ssw0rd!',
      targetUser: 'alice@TEST.LOCAL',
      realm: 'TEST.LOCAL'
    });

    const proxyContext = await kerberos.initializeProxyContext({
      impersonatedCred: impersonatedCred,
      targetSPN: 'cifs/fileserver.test.local'
    });

    expect(proxyContext).toBeDefined();
  });

  it('should fail for disallowed target SPN', async () => {
    const impersonatedCred = await kerberos.acquireCredImpersonate({
      servicePrincipal: 'HTTP/mcp-server@TEST.LOCAL',
      serviceUsername: 'svc-mcp-server',
      servicePassword: 'P@ssw0rd!',
      targetUser: 'alice@TEST.LOCAL',
      realm: 'TEST.LOCAL'
    });

    // Target SPN not in msDS-AllowedToDelegateTo
    await expect(kerberos.initializeProxyContext({
      impersonatedCred: impersonatedCred,
      targetSPN: 'http/unauthorized.test.local'
    })).rejects.toThrow(/KDC_ERR_BADOPTION/);
  });
});
```

### 5.3 Integration Tests

**File Share Access Test:**

```javascript
const fs = require('fs');
const kerberos = require('kerberos');

async function testS4UFileAccess() {
  // Acquire impersonated credentials for alice
  const impersonatedCred = await kerberos.acquireCredImpersonate({
    servicePrincipal: 'HTTP/mcp-server@TEST.LOCAL',
    serviceUsername: 'svc-mcp-server',
    servicePassword: 'P@ssw0rd!',
    targetUser: 'alice@TEST.LOCAL',
    realm: 'TEST.LOCAL'
  });

  // Initialize proxy context for file server
  const proxyContext = await kerberos.initializeProxyContext({
    impersonatedCred: impersonatedCred,
    targetSPN: 'cifs/fileserver.test.local'
  });

  // Access file share as alice (requires native SMB client integration)
  const files = fs.readdirSync('\\\\fileserver.test.local\\alice-home');
  console.log(`Files accessible as alice: ${files.length}`);
}
```

---

## 6. Compatibility Considerations

### 6.1 Platform Support

| Platform | S4U2Self Support | S4U2Proxy Support | Required Libraries |
|----------|------------------|-------------------|-------------------|
| Windows | ✅ SSPI built-in | ✅ SSPI built-in | Windows SDK |
| Linux (MIT Kerberos) | ✅ v1.8+ (gss_acquire_cred_impersonate_name) | ✅ v1.8+ | libkrb5-dev, libgssapi-krb5-2 |
| macOS (Heimdal) | ⚠️ Limited support | ⚠️ Limited support | Heimdal Kerberos |
| Linux (Heimdal) | ✅ Supported | ✅ Supported | heimdal-dev |

**Note:** MIT Kerberos is recommended for Linux due to widespread support and documentation.

### 6.2 Kerberos Library Versions

**Minimum Versions:**
- **MIT Kerberos:** v1.8+ (released 2009) - First version with `gss_acquire_cred_impersonate_name`
- **Heimdal Kerberos:** v1.3+ (released 2009) - Similar S4U support
- **Windows SSPI:** Windows Server 2003+ (S4U2Self), Windows Server 2008+ (S4U2Proxy recommended)

**Detection at Build Time:**

```c
// In src/unix/kerberos_gss.cc
#ifdef HAVE_GSS_ACQUIRE_CRED_IMPERSONATE_NAME
// S4U2Self implementation
#else
// Fallback or error
#error "S4U2Self requires MIT Kerberos 1.8 or Heimdal 1.3"
#endif
```

**Runtime Detection:**

```javascript
// Check if S4U features are available
const kerberos = require('kerberos');

if (kerberos.hasS4USupport) {
  console.log('S4U2Self/S4U2Proxy available');
} else {
  console.log('Platform does not support S4U extensions');
}
```

### 6.3 Breaking API Changes

**Concern:** Adding S4U methods may break existing users of mongodb-js/kerberos

**Mitigation:**
1. **Semver Major Version Bump:** Release as v3.0.0 to signal breaking changes
2. **Feature Detection:** Provide `kerberos.hasS4USupport` flag for graceful degradation
3. **Optional Peer Dependencies:** Don't require S4U in core package
4. **Separate Package Option:** Consider `@mongodb-js/kerberos-s4u` addon package

---

## 7. Development Effort Estimate

### 7.1 Implementation Tasks

| Task | Estimated Hours | Complexity |
|------|----------------|------------|
| **GSSAPI Extension (Linux)** | 40 hours | High |
| - Add `gss_acquire_cred_impersonate_name` wrapper | 8h | Medium |
| - Add proxy context initialization | 8h | Medium |
| - Handle keytab configuration | 4h | Low |
| - Error handling and cleanup | 8h | Medium |
| - N-API binding updates | 8h | Medium |
| - Memory management and lifecycle | 4h | Medium |
| **SSPI Extension (Windows)** | 60 hours | Very High |
| - Add S4U2Self credential acquisition | 16h | High |
| - Add S4U2Proxy context initialization | 16h | High |
| - Handle `KERB_S4U_LOGON` structure | 8h | High |
| - Query security context token | 4h | Medium |
| - Error handling (SSPI error codes) | 8h | Medium |
| - N-API binding updates | 8h | Medium |
| **JavaScript API** | 16 hours | Medium |
| - Design new method signatures | 4h | Medium |
| - Add TypeScript definitions | 4h | Low |
| - Parameter validation | 4h | Low |
| - Documentation | 4h | Low |
| **Testing** | 80 hours | Very High |
| - Set up Active Directory test environment | 16h | High |
| - Set up MIT Kerberos test environment | 8h | Medium |
| - Write unit tests (GSSAPI) | 16h | Medium |
| - Write unit tests (SSPI) | 16h | Medium |
| - Write integration tests | 16h | High |
| - CI/CD pipeline updates | 8h | Medium |
| **Documentation** | 16 hours | Medium |
| - API reference documentation | 4h | Low |
| - S4U2Self/S4U2Proxy guide | 4h | Low |
| - Active Directory setup guide | 4h | Low |
| - Troubleshooting guide | 4h | Low |
| **Total** | **212 hours** (~5.3 weeks) | **Very High** |

### 7.2 Risks and Challenges

**Technical Risks:**
1. **Platform-Specific Bugs** - SSPI and GSSAPI behave differently (especially error codes)
2. **Active Directory Configuration** - Delegation setup is complex and error-prone
3. **Memory Management** - N-API credential handles require careful lifecycle management
4. **Keytab Handling** - Linux keytab file permissions and KRB5_KTNAME environment variable
5. **Cross-Platform Testing** - Requires Windows AD and Linux Kerberos KDC

**Project Risks:**
1. **MongoDB Approval** - Upstream maintainers may reject S4U feature
2. **Breaking Changes** - May require major version bump and migration guide
3. **Maintenance Burden** - Adds complexity to build system and CI/CD
4. **Limited Use Case** - S4U is Windows-centric, may not align with MongoDB's priorities

---

## 8. Upstream Contribution Strategy

### 8.1 Engagement Plan

**Step 1: Open Issue for Discussion**
```markdown
# Issue Title: Feature Request - S4U2Self/S4U2Proxy Support for Windows Constrained Delegation

## Problem Statement
Enterprise applications need to access backend resources (file shares, databases,
APIs) on behalf of authenticated users without requiring their passwords. Windows
Constrained Delegation (S4U2Self/S4U2Proxy) and MIT Kerberos
gss_acquire_cred_impersonate_name enable this pattern.

## Use Cases
1. **Web Applications**: Delegate to file shares on behalf of authenticated users
2. **API Gateways**: Access backend APIs with user identity context
3. **Service Mesh**: Propagate user identity across microservices

## Proposed API
(Include JavaScript API examples from Section 3.1)

## Implementation Plan
- GSSAPI: gss_acquire_cred_impersonate_name wrapper
- SSPI: KERB_S4U_LOGON credential acquisition
- Cross-platform testing with AD and MIT Kerberos

## Open Questions
- Breaking API changes acceptable?
- Preferred versioning strategy?
- CI/CD requirements for S4U testing?
```

**Step 2: Wait for Maintainer Feedback**
- MongoDB team may have concerns about:
  - Scope creep (S4U is enterprise-focused, not MongoDB-core)
  - Maintenance burden (Windows AD testing infrastructure)
  - Breaking changes (may require v3.0.0)

**Step 3: Fork if Necessary**
- If upstream declines, create fork: `@mcp-oauth/kerberos`
- Maintain compatibility with original API
- Publish to npm independently

### 8.2 Alternative: Separate Package

**Option:** Create `@mcp-oauth/kerberos-s4u` as standalone package

**Pros:**
- No breaking changes to upstream
- Faster iteration without MongoDB approval
- Focused on MCP-OAuth use case

**Cons:**
- Duplicates C++ code from mongodb-js/kerberos
- Need to keep up with upstream changes
- Smaller community (less testing coverage)

---

## 9. Alternative Approaches (RECOMMENDED)

Given the **212-hour development effort** and **upstream approval uncertainty**, consider these alternatives:

### 9.1 Platform-Specific Native Modules

**Approach:** Use platform-specific Node.js modules for S4U operations

**Windows (node-sspi):**
```javascript
const sspi = require('node-sspi');

// S4U2Self credential acquisition
const impersonatedCred = sspi.acquireCredentialsHandleW({
  principal: 'HTTP/mcp-server@W25AD.NET',
  username: 'svc-mcp-server',
  password: 'ServicePassword123!',
  credUsage: 'BOTH',
  authData: {
    user: 'alice@W25AD.NET',
    logonType: 'S4U'
  }
});

// S4U2Proxy context initialization
const proxyContext = sspi.initializeSecurityContextW({
  credential: impersonatedCred,
  targetName: 'cifs/fileserver.w25ad.net',
  contextReq: ['DELEGATE', 'USE_SESSION_KEY']
});
```

**Linux (node-gssapi or custom binding):**
```javascript
const gssapi = require('node-gssapi');

// S4U2Self via gss_acquire_cred_impersonate_name
const impersonatedCred = gssapi.acquireCredImpersonate({
  serviceKeytab: '/etc/keytabs/svc-mcp-server.keytab',
  servicePrincipal: 'HTTP/mcp-server@TEST.LOCAL',
  targetUser: 'alice@TEST.LOCAL'
});

// S4U2Proxy via gss_init_sec_context
const proxyContext = gssapi.initSecContext({
  credential: impersonatedCred,
  targetName: 'nfs@fileserver.test.local',
  flags: ['GSS_C_DELEG_FLAG', 'GSS_C_MUTUAL_FLAG']
});
```

**Pros:**
- Platform-optimized implementations
- No dependency on mongodb-js/kerberos upstream
- Can use existing packages (node-sspi exists)

**Cons:**
- Separate Windows and Linux codebases
- Need to find or create Linux GSSAPI binding

### 9.2 Hybrid Approach (RECOMMENDED FOR MCP-OAUTH)

**Strategy:** Use existing native tools + Node.js orchestration

**Windows (PowerShell + SSPI):**
```javascript
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

async function acquireS4UTicket(serviceUser, servicePass, targetUser, targetSPN) {
  // Use PowerShell to invoke S4U2Self/S4U2Proxy
  const script = `
    Add-Type -AssemblyName System.DirectoryServices.AccountManagement
    $cred = New-Object System.Net.NetworkCredential("${serviceUser}", "${servicePass}")
    # ... PowerShell S4U logic ...
  `;

  const { stdout } = await execPromise(`powershell -Command "${script}"`);
  return stdout.trim();
}
```

**Linux (kinit + GSSAPI):**
```javascript
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

async function acquireS4UTicket(keytabPath, servicePrincipal, targetUser, targetSPN) {
  // Use kinit with keytab to acquire service TGT
  process.env.KRB5_KTNAME = keytabPath;
  await execPromise(`kinit -k ${servicePrincipal}`);

  // Use kvno to perform S4U2Self
  await execPromise(`kvno -U ${targetUser} ${targetSPN}`);

  // Service ticket now in credential cache
  return process.env.KRB5CCNAME || '/tmp/krb5cc_' + process.getuid();
}
```

**Pros:**
- ✅ No C++ development required
- ✅ Uses battle-tested system tools (kinit, kvno, PowerShell)
- ✅ Faster implementation (~40 hours vs 212 hours)
- ✅ Easier to debug (standard Kerberos tools)

**Cons:**
- ⚠️ Shell execution overhead (~50-100ms per delegation)
- ⚠️ Requires system Kerberos tools installed
- ⚠️ Credential cache file management

### 9.3 Token Exchange with IDP (CURRENT APPROACH)

**Strategy:** Delegate authentication to external IDP that handles S4U internally

**Architecture:**
```
┌─────────────────────────────────────────────────────────┐
│              MCP-OAuth Current Approach                  │
│                                                          │
│  1. Client sends JWT (alice@W25AD.NET)                  │
│  2. MCP server validates JWT                            │
│  3. MCP server calls IDP /token endpoint:               │
│     grant_type=urn:ietf:params:oauth:grant-type:token-exchange│
│     subject_token=<requestor-jwt>                        │
│     audience=urn:sql:database                           │
│  4. IDP performs S4U2Self internally (transparent)      │
│  5. IDP returns TE-JWT with legacy_name="ALICE_ADMIN"  │
│  6. MCP server uses legacy_name for SQL EXECUTE AS     │
└─────────────────────────────────────────────────────────┘
```

**Pros:**
- ✅ Already implemented (Phase 1-2 complete)
- ✅ No Kerberos dependency in MCP server
- ✅ IDP handles S4U complexity
- ✅ Works with any IDP (Keycloak, Azure AD, Okta)

**Cons:**
- ⚠️ Requires IDP to support S4U2Self (Keycloak with AD integration)
- ⚠️ Network latency for token exchange (mitigated by Phase 2 caching)

---

## 10. Recommendations

### 10.1 For MCP-OAuth Project (SHORT TERM)

**DO NOT** invest in mongodb-js/kerberos S4U extension for the following reasons:

1. **High Development Cost:** 212 hours (~5.3 weeks) for C++ native extension
2. **Upstream Uncertainty:** MongoDB team may reject feature or delay review
3. **Limited Use Case:** S4U is only needed for Kerberos delegation module (1 of N modules)
4. **Alternative Exists:** Token exchange with IDP (already implemented) provides equivalent functionality

**RECOMMENDED APPROACH:**

**Phase 1 (CURRENT):** Continue using Token Exchange pattern
- IDP performs S4U2Self internally (e.g., Keycloak with AD integration)
- MCP server receives TE-JWT with `legacy_name` claim
- No Kerberos dependency in MCP server

**Phase 2 (IF NEEDED):** Implement Hybrid Approach (Section 9.2)
- Use PowerShell (Windows) or kinit/kvno (Linux) for S4U operations
- Development effort: ~40 hours (vs 212 hours for C++ extension)
- Easier to debug and maintain

**Phase 3 (FUTURE):** Contribute to upstream if demand increases
- Open feature request issue on mongodb-js/kerberos
- Wait for community feedback and maintainer approval
- If approved, implement S4U extension (212-hour effort)

### 10.2 For mongodb-js/kerberos Library (LONG TERM)

**IF** S4U feature is desired for wider community:

1. **Open Issue First:** Gauge maintainer interest before writing code
2. **Start with Linux:** GSSAPI implementation is simpler than SSPI (40 hours vs 60 hours)
3. **Feature Flag:** Add `kerberos.hasS4USupport` for runtime detection
4. **Separate Package:** Consider `@mongodb-js/kerberos-s4u` addon to avoid breaking changes
5. **Comprehensive Testing:** Active Directory setup is critical (see Section 5)

---

## 11. Conclusion

**Feasibility Assessment: ⚠️ MODERATE**

Adding S4U2Self/S4U2Proxy support to mongodb-js/kerberos is **technically feasible** but requires:
- **212 hours of development** (5.3 weeks full-time)
- **Platform-specific C++ expertise** (GSSAPI and SSPI)
- **Active Directory testing infrastructure**
- **Upstream maintainer approval**

**For MCP-OAuth framework:**
- ✅ **RECOMMENDED:** Continue with Token Exchange pattern (already implemented)
- ⚠️ **IF NEEDED:** Use Hybrid Approach (shell commands) for direct S4U support
- ❌ **NOT RECOMMENDED:** Invest in mongodb-js/kerberos C++ extension at this time

**Decision Criteria:**

| Scenario | Recommended Approach |
|----------|---------------------|
| Need S4U for SQL Server delegation | Token Exchange with IDP (Phase 1) |
| IDP doesn't support S4U | Hybrid Approach (PowerShell/kinit) |
| Need Kerberos tickets for file shares | Hybrid Approach (kvno) |
| Building general-purpose Kerberos library | Contribute to mongodb-js/kerberos upstream |

---

## References

- [RFC 4120 - Kerberos V5](https://www.rfc-editor.org/rfc/rfc4120)
- [MS-SFU - Kerberos Protocol Extensions: Service for User and Constrained Delegation](https://docs.microsoft.com/en-us/openspecs/windows_protocols/ms-sfu/)
- [MIT Kerberos Documentation - S4U Extensions](https://web.mit.edu/kerberos/krb5-latest/doc/admin/admin_commands/kadmin_local.html)
- [mongodb-js/kerberos GitHub Repository](https://github.com/mongodb-js/kerberos)
- [GSSAPI Programming Guide](https://docs.oracle.com/cd/E19683-01/816-1331/6m7vc7qgk/index.html)
- [Windows SSPI Documentation](https://docs.microsoft.com/en-us/windows/win32/secauthn/sspi)
- [MCP-OAuth Phase 1 - Token Exchange](./test-harness/PHASE1-TOKEN-EXCHANGE-TEST.md)
- [MCP-OAuth Phase 2 - Encrypted Token Cache](./src/delegation/encrypted-token-cache.ts)

---

**Last Updated:** 2025-01-08
**Author:** Claude Code (Anthropic)
**Status:** ✅ Final Assessment
