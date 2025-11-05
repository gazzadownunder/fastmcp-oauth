# Extending node-kerberos for S4U2Self/S4U2Proxy Support

## Overview

This document outlines how to extend the `kerberos` npm package to support Windows Kerberos Constrained Delegation (S4U2Self and S4U2Proxy).

## Prerequisites

### Development Tools

**Windows:**
```powershell
# Install Visual Studio Build Tools
winget install Microsoft.VisualStudio.2022.BuildTools

# Install Python (required by node-gyp)
winget install Python.Python.3.11

# Install Node.js native module build tools
npm install -g node-gyp windows-build-tools
```

**Linux:**
```bash
# Ubuntu/Debian
sudo apt-get install build-essential python3 libkrb5-dev

# RHEL/CentOS
sudo yum install gcc-c++ python3 krb5-devel

# macOS
xcode-select --install
brew install krb5
```

### Kerberos Development Libraries

**Windows:**
- Windows SDK (includes SSPI headers)
- Already included with Visual Studio

**Linux:**
```bash
# Install MIT Kerberos development headers
sudo apt-get install libkrb5-dev libgssapi-krb5-2
```

## Step 1: Fork the Repository

```bash
# Fork mongodb-js/kerberos on GitHub
git clone https://github.com/yourusername/kerberos.git
cd kerberos
git checkout -b feature/s4u-support
```

## Step 2: Add Native Code (Linux/GSSAPI)

Create `lib/s4u.cc`:

```cpp
/**
 * S4U2Self and S4U2Proxy implementation using GSSAPI
 * Requires MIT Kerberos >= 1.8 with S4U support
 */

#include <node.h>
#include <node_buffer.h>
#include <gssapi/gssapi.h>
#include <gssapi/gssapi_krb5.h>
#include <gssapi/gssapi_ext.h>

namespace kerberos {

using v8::Context;
using v8::Function;
using v8::FunctionCallbackInfo;
using v8::Isolate;
using v8::Local;
using v8::Object;
using v8::String;
using v8::Value;
using v8::Exception;

// Helper: Convert GSS error to string
std::string GssErrorToString(OM_uint32 major, OM_uint32 minor) {
    OM_uint32 msg_ctx = 0;
    gss_buffer_desc status_string;
    std::string result;

    gss_display_status(&msg_ctx, major, GSS_C_GSS_CODE,
                      GSS_C_NO_OID, &msg_ctx, &status_string);
    result = std::string((char*)status_string.value, status_string.length);
    gss_release_buffer(&msg_ctx, &status_string);

    return result;
}

// Native function: performS4U2Self
void PerformS4U2Self(const FunctionCallbackInfo<Value>& args) {
    Isolate* isolate = args.GetIsolate();
    Local<Context> context = isolate->GetCurrentContext();

    // Validate arguments
    if (args.Length() < 3) {
        isolate->ThrowException(Exception::TypeError(
            String::NewFromUtf8(isolate,
                "Wrong number of arguments: performS4U2Self(userPrincipal, targetSPN, callback)")
                .ToLocalChecked()));
        return;
    }

    if (!args[0]->IsString() || !args[1]->IsString() || !args[2]->IsFunction()) {
        isolate->ThrowException(Exception::TypeError(
            String::NewFromUtf8(isolate,
                "Arguments must be: (string, string, function)")
                .ToLocalChecked()));
        return;
    }

    // Extract arguments
    String::Utf8Value userPrincipal(isolate, args[0]);
    String::Utf8Value targetSPN(isolate, args[1]);
    Local<Function> callback = Local<Function>::Cast(args[2]);

    // Convert principal names to GSS format
    OM_uint32 major_status, minor_status;
    gss_name_t user_name, target_name;
    gss_buffer_desc user_buffer, target_buffer;

    user_buffer.value = (void*)*userPrincipal;
    user_buffer.length = strlen(*userPrincipal);
    target_buffer.value = (void*)*targetSPN;
    target_buffer.length = strlen(*targetSPN);

    major_status = gss_import_name(&minor_status, &user_buffer,
                                   GSS_C_NT_USER_NAME, &user_name);
    if (major_status != GSS_S_COMPLETE) {
        std::string error = "Failed to import user principal: " +
                          GssErrorToString(major_status, minor_status);
        Local<Value> err = Exception::Error(
            String::NewFromUtf8(isolate, error.c_str()).ToLocalChecked());
        Local<Value> argv[] = { err };
        callback->Call(context, context->Global(), 1, argv).ToLocalChecked();
        return;
    }

    major_status = gss_import_name(&minor_status, &target_buffer,
                                   GSS_C_NT_HOSTBASED_SERVICE, &target_name);
    if (major_status != GSS_S_COMPLETE) {
        gss_release_name(&minor_status, &user_name);
        std::string error = "Failed to import target SPN: " +
                          GssErrorToString(major_status, minor_status);
        Local<Value> err = Exception::Error(
            String::NewFromUtf8(isolate, error.c_str()).ToLocalChecked());
        Local<Value> argv[] = { err };
        callback->Call(context, context->Global(), 1, argv).ToLocalChecked();
        return;
    }

    // Acquire service credentials (from keytab or default credential cache)
    gss_cred_id_t service_cred;
    major_status = gss_acquire_cred(&minor_status, GSS_C_NO_NAME, 0,
                                    GSS_C_NO_OID_SET, GSS_C_INITIATE,
                                    &service_cred, NULL, NULL);
    if (major_status != GSS_S_COMPLETE) {
        gss_release_name(&minor_status, &user_name);
        gss_release_name(&minor_status, &target_name);
        std::string error = "Failed to acquire service credentials: " +
                          GssErrorToString(major_status, minor_status);
        Local<Value> err = Exception::Error(
            String::NewFromUtf8(isolate, error.c_str()).ToLocalChecked());
        Local<Value> argv[] = { err };
        callback->Call(context, context->Global(), 1, argv).ToLocalChecked();
        return;
    }

    // Perform S4U2Self: Impersonate user
    // This requires MIT Kerberos >= 1.8 with gss_acquire_cred_impersonate_name
    gss_cred_id_t impersonate_cred;
    major_status = gss_acquire_cred_impersonate_name(&minor_status,
                                                     service_cred,
                                                     user_name,
                                                     0,
                                                     GSS_C_NO_OID_SET,
                                                     GSS_C_INITIATE,
                                                     &impersonate_cred,
                                                     NULL, NULL);

    gss_release_cred(&minor_status, &service_cred);

    if (major_status != GSS_S_COMPLETE) {
        gss_release_name(&minor_status, &user_name);
        gss_release_name(&minor_status, &target_name);
        std::string error = "S4U2Self failed: " +
                          GssErrorToString(major_status, minor_status);
        Local<Value> err = Exception::Error(
            String::NewFromUtf8(isolate, error.c_str()).ToLocalChecked());
        Local<Value> argv[] = { err };
        callback->Call(context, context->Global(), 1, argv).ToLocalChecked();
        return;
    }

    // Initialize security context to get ticket
    gss_ctx_id_t context_handle = GSS_C_NO_CONTEXT;
    gss_buffer_desc output_token = GSS_C_EMPTY_BUFFER;
    OM_uint32 ret_flags;

    major_status = gss_init_sec_context(&minor_status,
                                        impersonate_cred,
                                        &context_handle,
                                        target_name,
                                        GSS_C_NO_OID,
                                        GSS_C_MUTUAL_FLAG | GSS_C_DELEG_FLAG,
                                        0,
                                        GSS_C_NO_CHANNEL_BINDINGS,
                                        GSS_C_NO_BUFFER,
                                        NULL,
                                        &output_token,
                                        &ret_flags,
                                        NULL);

    gss_release_cred(&minor_status, &impersonate_cred);
    gss_release_name(&minor_status, &user_name);
    gss_release_name(&minor_status, &target_name);

    if (major_status != GSS_S_COMPLETE && major_status != GSS_S_CONTINUE_NEEDED) {
        if (context_handle != GSS_C_NO_CONTEXT) {
            gss_delete_sec_context(&minor_status, &context_handle, GSS_C_NO_BUFFER);
        }
        std::string error = "Failed to initialize security context: " +
                          GssErrorToString(major_status, minor_status);
        Local<Value> err = Exception::Error(
            String::NewFromUtf8(isolate, error.c_str()).ToLocalChecked());
        Local<Value> argv[] = { err };
        callback->Call(context, context->Global(), 1, argv).ToLocalChecked();
        return;
    }

    // Convert output token to Node.js Buffer
    Local<Object> token_buffer = node::Buffer::Copy(isolate,
        (char*)output_token.value,
        output_token.length).ToLocalChecked();

    gss_release_buffer(&minor_status, &output_token);
    gss_delete_sec_context(&minor_status, &context_handle, GSS_C_NO_BUFFER);

    // Success callback
    Local<Value> argv[] = {
        v8::Null(isolate),
        token_buffer
    };
    callback->Call(context, context->Global(), 2, argv).ToLocalChecked();
}

// Module initialization
void Initialize(Local<Object> exports) {
    NODE_SET_METHOD(exports, "performS4U2Self", PerformS4U2Self);
}

NODE_MODULE(s4u, Initialize)

} // namespace kerberos
```

## Step 3: Update binding.gyp

Add the new source file to the build configuration:

```python
{
  'targets': [{
    'target_name': 'kerberos',
    'sources': [
      'lib/kerberos.cc',
      'lib/s4u.cc'  # Add this line
    ],
    'conditions': [
      ['OS=="linux"', {
        'libraries': [
          '-lgssapi_krb5',
          '-lkrb5'
        ],
        'cflags': [
          '-std=c++11'
        ]
      }],
      ['OS=="win"', {
        'libraries': [
          '-lSecur32.lib',
          '-lCrypt32.lib'
        ]
      }]
    ]
  }]
}
```

## Step 4: Add JavaScript API

Update `index.js`:

```javascript
const binding = require('./build/Release/kerberos');

class KerberosClient {
  constructor(servicePrincipal, options) {
    this.servicePrincipal = servicePrincipal;
    this.options = options || {};
  }

  /**
   * Perform S4U2Self (Service for User to Self)
   *
   * @param {string} userPrincipal - User principal name (e.g., alice@W25AD.NET)
   * @param {string} targetSPN - Target service principal
   * @returns {Promise<Buffer>} Kerberos ticket
   */
  performS4U2Self(userPrincipal, targetSPN) {
    return new Promise((resolve, reject) => {
      binding.performS4U2Self(userPrincipal, targetSPN, (err, ticket) => {
        if (err) {
          reject(new Error(`S4U2Self failed: ${err.message}`));
        } else {
          resolve(ticket);
        }
      });
    });
  }

  /**
   * Perform S4U2Proxy (Service for User to Proxy)
   *
   * @param {Buffer} userTicket - User ticket from S4U2Self
   * @param {string} targetSPN - Backend service SPN
   * @returns {Promise<Buffer>} Proxy ticket
   */
  async performS4U2Proxy(userTicket, targetSPN) {
    // TODO: Implement S4U2Proxy
    throw new Error('S4U2Proxy not implemented yet');
  }
}

module.exports = {
  KerberosClient,
  // Preserve existing exports
  ...require('./lib/kerberos')
};
```

## Step 5: Build and Test

```bash
# Install dependencies
npm install

# Build native addon
npm run rebuild  # or: node-gyp rebuild

# Run tests
npm test
```

## Step 6: Create Test Suite

Create `test/s4u.test.js`:

```javascript
const { KerberosClient } = require('..');
const assert = require('assert');

describe('S4U2Self', () => {
  let client;

  before(async () => {
    // Ensure KRB5_KTNAME is set
    if (!process.env.KRB5_KTNAME) {
      throw new Error('KRB5_KTNAME environment variable not set');
    }

    client = new KerberosClient('HTTP/mcp-server@W25AD.NET');
  });

  it('should obtain ticket for user via S4U2Self', async function() {
    this.timeout(10000);

    const userPrincipal = 'alice@W25AD.NET';
    const targetSPN = 'HTTP/mcp-server@W25AD.NET';

    const ticket = await client.performS4U2Self(userPrincipal, targetSPN);

    assert(ticket instanceof Buffer, 'Ticket should be a Buffer');
    assert(ticket.length > 0, 'Ticket should not be empty');
  });

  it('should fail for invalid user principal', async () => {
    const userPrincipal = 'invalid-user@W25AD.NET';
    const targetSPN = 'HTTP/mcp-server@W25AD.NET';

    await assert.rejects(
      client.performS4U2Self(userPrincipal, targetSPN),
      /S4U2Self failed/
    );
  });
});
```

## Step 7: Integration with MCP-OAuth

Once you have a working extended library:

```bash
# Install your fork
npm install github:yourusername/kerberos#feature/s4u-support
```

Update `packages/kerberos-delegation/src/kerberos-client.ts`:

```typescript
import kerberos from 'kerberos';

export class KerberosClient {
  private kerberosClient: any;

  async performS4U2Self(userPrincipal: string): Promise<KerberosTicket> {
    console.log('[KERBEROS-CLIENT] performS4U2Self() - using REAL implementation');

    try {
      // Call extended library with REAL S4U2Self support
      const ticketBuffer = await this.kerberosClient.performS4U2Self(
        userPrincipal,
        `${this.config.servicePrincipalName}@${this.config.realm}`
      );

      return {
        principal: userPrincipal,
        service: `${this.config.servicePrincipalName}@${this.config.realm}`,
        expiresAt: new Date(Date.now() + 10 * 60 * 60 * 1000),
        ticketData: ticketBuffer.toString('base64'),
        flags: ['FORWARDABLE', 'PROXIABLE'],
      };
    } catch (error) {
      throw new Error(
        `S4U2Self failed for ${userPrincipal}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
```

## Debugging Tips

### Enable Kerberos Tracing

**Linux:**
```bash
export KRB5_TRACE=/dev/stdout
npm test
```

**Windows:**
```cmd
set KERB_DEBUG_LEVEL=0xFFFFFFFF
npm test
```

### Verify MIT Kerberos Version

```bash
krb5-config --version
# Should be >= 1.8 for S4U2Self support
# Should be >= 1.13 for full S4U2Proxy support
```

### Check for S4U Support

```bash
# Test if gss_acquire_cred_impersonate_name is available
gcc -o test_s4u test_s4u.c -lgssapi_krb5
```

```c
// test_s4u.c
#include <gssapi/gssapi_ext.h>
#include <stdio.h>

int main() {
    #ifdef gss_acquire_cred_impersonate_name
    printf("S4U2Self support: YES\n");
    #else
    printf("S4U2Self support: NO\n");
    #endif
    return 0;
}
```

## Windows-Specific Implementation

For Windows, replace GSSAPI calls with SSPI:

```cpp
// lib/s4u_win32.cc
#define SECURITY_WIN32
#include <windows.h>
#include <sspi.h>
#include <ntsecapi.h>

void PerformS4U2Self(const FunctionCallbackInfo<Value>& args) {
    // ... (parameter validation same as Linux)

    // Acquire service credentials
    CredHandle serviceCredHandle;
    TimeStamp lifetime;

    SECURITY_STATUS status = AcquireCredentialsHandleW(
        NULL,                    // Use default principal
        L"Kerberos",            // Package name
        SECPKG_CRED_INBOUND,    // Credential use
        NULL,                    // Logon ID
        NULL,                    // Auth data
        NULL, NULL,             // Get/Free functions
        &serviceCredHandle,     // Output
        &lifetime
    );

    if (status != SEC_E_OK) {
        // Handle error...
    }

    // Initialize context with ISC_REQ_DELEGATE for S4U2Self
    CtxtHandle contextHandle;
    SecBufferDesc outputDesc;
    SecBuffer outputBuffer;
    ULONG contextAttr;

    outputBuffer.BufferType = SECBUFFER_TOKEN;
    outputBuffer.cbBuffer = 0;
    outputBuffer.pvBuffer = NULL;
    outputDesc.ulVersion = SECBUFFER_VERSION;
    outputDesc.cBuffers = 1;
    outputDesc.pBuffers = &outputBuffer;

    status = InitializeSecurityContextW(
        &serviceCredHandle,
        NULL,                           // No previous context
        (LPWSTR)targetSPN,             // Target
        ISC_REQ_DELEGATE | ISC_REQ_NO_INTEGRITY, // S4U2Self flags
        0,                              // Reserved
        SECURITY_NETWORK_DREP,         // Data representation
        NULL,                           // No input buffer
        0,                              // Reserved
        &contextHandle,                 // Output context
        &outputDesc,                    // Output token
        &contextAttr,                   // Context attributes
        &lifetime                       // Lifetime
    );

    // ... (convert output to Buffer and callback)
}
```

## Performance Considerations

- **Caching:** Tickets should be cached (already implemented in ticket-cache.ts)
- **Connection pooling:** Reuse GSS contexts when possible
- **Async operations:** Use libuv for truly async native calls

## Security Checklist

- [ ] Validate all user inputs
- [ ] Zero-out sensitive memory after use
- [ ] Check return codes from all GSS/SSPI calls
- [ ] Implement proper error handling
- [ ] Add rate limiting for ticket requests
- [ ] Log all delegation attempts
- [ ] Verify ticket expiration
- [ ] Validate principal names against whitelist

## Publishing

```bash
# Update package.json
{
  "name": "@yourorg/kerberos-s4u",
  "version": "1.0.0",
  "description": "Kerberos library with S4U2Self/S4U2Proxy support"
}

# Publish to npm
npm publish --access public
```

## References

- [MIT Kerberos Documentation](https://web.mit.edu/kerberos/krb5-latest/doc/)
- [GSSAPI Programming Guide](https://docs.oracle.com/cd/E88353_01/html/E37853/gssapi-2.html)
- [Windows SSPI Documentation](https://learn.microsoft.com/en-us/windows/win32/secauthn/sspi)
- [Node.js Native Addons](https://nodejs.org/api/addons.html)
- [node-gyp Documentation](https://github.com/nodejs/node-gyp)
