# @mcp-oauth/kerberos-delegation

Kerberos delegation module for the MCP OAuth framework - provides Windows Kerberos Constrained Delegation support.

## Overview

This package is a **reference implementation** demonstrating how to build delegation modules for the MCP OAuth framework. It provides Kerberos-based authentication and delegation using:

- **S4U2Self**: Service for User to Self (obtain ticket on behalf of user)
- **S4U2Proxy**: Service for User to Proxy (delegate to backend services)

## Installation

```bash
npm install @mcp-oauth/kerberos-delegation
```

This package is an **optional** dependency of `mcp-oauth-framework`. The core framework works without Kerberos support.

## Platform Requirements

### Windows (Domain-Joined)
- **Windows Server** with Active Directory
- **Node.js** 18.0.0 or higher
- **Kerberos** configured service account with delegation rights
- Uses **Windows SSPI** (Security Support Provider Interface)

### Linux
- **Node.js** 18.0.0 or higher
- **MIT Kerberos** (`krb5-user` package)
- **Keytab file** for service account
- Network access to Active Directory KDC

### Windows (Non-Domain-Joined)
See [Non-Domain-Joined Windows Setup](#non-domain-joined-windows-setup) below

## Features

### Security

- ✅ Windows SSPI integration via node-kerberos
- ✅ Kerberos Constrained Delegation (S4U2Self/S4U2Proxy)
- ✅ Ticket caching for performance
- ✅ Automatic ticket renewal
- ✅ Audit logging for all delegation operations

### Kerberos Operations

- **S4U2Self**: Obtain Kerberos ticket on behalf of user
- **S4U2Proxy**: Act on behalf of user to backend services
- **Ticket Cache**: Cache Kerberos tickets with TTL

## Usage

### Basic Kerberos Delegation

```typescript
import { KerberosDelegationModule } from '@mcp-oauth/kerberos-delegation';
import { DelegationRegistry } from 'mcp-oauth-framework/delegation';

const kerberosModule = new KerberosDelegationModule();

await kerberosModule.initialize({
  servicePrincipalName: 'HTTP/mcp-server.company.com',
  realm: 'COMPANY.COM',
  kdcServer: 'dc01.company.com',
  ticketCache: {
    enabled: true,
    ttlSeconds: 3600,
    maxEntries: 1000
  }
});

// Register with framework
const registry = new DelegationRegistry();
registry.register(kerberosModule);

// Perform S4U2Self delegation
const result = await registry.delegate(
  'kerberos',
  session,
  's4u2self',
  {
    action: 's4u2self',
    userPrincipalName: 'ALICE@COMPANY.COM'
  }
);
```

### S4U2Proxy Delegation

```typescript
// Delegate to backend service
const result = await registry.delegate(
  'kerberos',
  session,
  's4u2proxy',
  {
    action: 's4u2proxy',
    userPrincipalName: 'ALICE@COMPANY.COM',
    targetService: 'HTTP/backend.company.com'
  }
);
```

## API

### KerberosDelegationModule

#### Actions

- **`s4u2self`** - Obtain Kerberos ticket on behalf of user
  ```typescript
  {
    action: 's4u2self',
    userPrincipalName: 'ALICE@COMPANY.COM'
  }
  ```

- **`s4u2proxy`** - Act on behalf of user to backend service
  ```typescript
  {
    action: 's4u2proxy',
    userPrincipalName: 'ALICE@COMPANY.COM',
    targetService: 'HTTP/backend.company.com'
  }
  ```

- **`ticket-cache-stats`** - Get ticket cache statistics
  ```typescript
  {
    action: 'ticket-cache-stats'
  }
  ```

## Configuration

### Kerberos Configuration

```typescript
{
  servicePrincipalName: string;  // SPN of MCP server
  realm: string;                 // Kerberos realm (e.g., COMPANY.COM)
  kdcServer: string;            // Key Distribution Center hostname
  ticketCache?: {
    enabled: boolean;           // Enable ticket caching
    ttlSeconds: number;         // Ticket TTL (default: 3600)
    maxEntries: number;         // Max cached tickets (default: 1000)
  };
}
```

## Active Directory Setup

### Service Account Configuration

1. Create service account for MCP server:
   ```powershell
   New-ADUser -Name "mcp-service" -UserPrincipalName "mcp-service@COMPANY.COM"
   ```

2. Set Service Principal Name (SPN):
   ```powershell
   setspn -A HTTP/mcp-server.company.com COMPANY\mcp-service
   ```

3. Enable delegation rights:
   ```powershell
   # Enable constrained delegation
   Set-ADUser -Identity "mcp-service" -Add @{'msDS-AllowedToDelegateTo'=@('HTTP/backend.company.com')}
   ```

4. Enable protocol transition (for S4U2Self):
   ```powershell
   Set-ADAccountControl -Identity "mcp-service" -TrustedToAuthForDelegation $true
   ```

## Security Considerations

### Delegation Rights

Kerberos Constrained Delegation requires:
- Service account with `TrustedToAuthForDelegation` flag
- Specific services listed in `msDS-AllowedToDelegateTo` attribute
- Active Directory domain functional level 2003+

### Ticket Security

- Tickets are cached in memory only (not persisted to disk)
- Ticket cache supports automatic expiration and renewal
- All delegation operations are audit logged

## Platform-Specific Configuration

### Linux Setup with Keytab

On Linux, the recommended approach is to use a **keytab file** for authentication:

#### 1. Generate Keytab on Active Directory

```powershell
# On Windows AD Domain Controller
ktpass -princ HTTP/mcp-server@COMPANY.COM -mapuser svc-mcp-server `
       -pass YourSecurePassword123! -out mcp-server.keytab `
       -ptype KRB5_NT_PRINCIPAL
```

#### 2. Copy Keytab to Linux Server

```bash
# Copy keytab to Linux server
scp mcp-server.keytab linux-server:/etc/keytabs/
chmod 600 /etc/keytabs/mcp-server.keytab
chown node-app-user:node-app-user /etc/keytabs/mcp-server.keytab
```

#### 3. Install MIT Kerberos

```bash
# Ubuntu/Debian
sudo apt-get install krb5-user

# RHEL/CentOS
sudo yum install krb5-workstation
```

#### 4. Configure Kerberos (`/etc/krb5.conf`)

```ini
[libdefaults]
    default_realm = COMPANY.COM
    dns_lookup_kdc = true
    dns_lookup_realm = false
    ticket_lifetime = 24h
    renew_lifetime = 7d
    forwardable = true

[realms]
    COMPANY.COM = {
        kdc = dc01.company.com:88
        admin_server = dc01.company.com:749
        default_domain = company.com
    }

[domain_realm]
    .company.com = COMPANY.COM
    company.com = COMPANY.COM
```

#### 5. Update Configuration to Use Keytab

```json
{
  "delegation": {
    "modules": {
      "kerberos": {
        "enabled": true,
        "domainController": "dc01.company.com",
        "servicePrincipalName": "HTTP/mcp-server",
        "realm": "COMPANY.COM",
        "kdc": "dc01.company.com:88",
        "serviceAccount": {
          "username": "svc-mcp-server",
          "keytabPath": "/etc/keytabs/mcp-server.keytab"
        }
      }
    }
  }
}
```

#### 6. Test Keytab

```bash
# Obtain ticket using keytab
kinit -kt /etc/keytabs/mcp-server.keytab svc-mcp-server@COMPANY.COM

# Verify ticket
klist

# Expected output:
# Ticket cache: FILE:/tmp/krb5cc_1000
# Default principal: svc-mcp-server@COMPANY.COM
```

### Non-Domain-Joined Windows Setup

For **non-domain-joined Windows machines**, you have several options:

#### Option 1: MIT Kerberos for Windows (Recommended)

Install MIT Kerberos for Windows to get the same capabilities as Linux:

**Step 1: Install MIT Kerberos**
```powershell
# Download from: https://web.mit.edu/kerberos/dist/
# Or use Chocolatey:
choco install kerberos-for-windows
```

**Step 2: Configure Kerberos (`C:\ProgramData\MIT\Kerberos5\krb5.ini`)**
```ini
[libdefaults]
    default_realm = COMPANY.COM
    dns_lookup_kdc = true
    dns_lookup_realm = false
    ticket_lifetime = 24h
    renew_lifetime = 7d
    forwardable = true

[realms]
    COMPANY.COM = {
        kdc = dc01.company.com:88
        admin_server = dc01.company.com:749
        default_domain = company.com
    }

[domain_realm]
    .company.com = COMPANY.COM
    company.com = COMPANY.COM
```

**Step 3: Obtain Kerberos Ticket**
```powershell
# Using password
kinit svc-mcp-server@COMPANY.COM

# Or using keytab (recommended)
kinit -kt C:\keytabs\mcp-server.keytab svc-mcp-server@COMPANY.COM

# Verify ticket
klist
```

**Step 4: Run MCP Server**

The `kerberos` npm package will automatically detect MIT Kerberos and use it instead of SSPI.

#### Option 2: Windows Credential Manager (SSPI)

Cache credentials using Windows built-in tools:

```powershell
# Add credentials to Windows Credential Manager
cmdkey /generic:TERMSRV/dc01.company.com /user:COMPANY\svc-mcp-server /pass:YourPassword123!

# Verify
cmdkey /list

# Start a new session with domain credentials
runas /netonly /user:COMPANY\svc-mcp-server "powershell.exe"

# In the new PowerShell window, run the server
cd "C:\path\to\mcp-oauth"
npm start
```

#### Option 3: ksetup Configuration

Configure the non-domain-joined machine to trust the domain:

```powershell
# Run as Administrator
ksetup /setdomain COMPANY.COM
ksetup /addkdc COMPANY.COM dc01.company.com

# Map realm to domain
ksetup /addhosttorealmmap dc01.company.com COMPANY.COM

# Reboot required
shutdown /r /t 0
```

After reboot, use `runas /netonly` as shown in Option 2.

#### Option 4: WSL2 with MIT Kerberos

Run the MCP server in WSL2 (Ubuntu) where MIT Kerberos works natively:

```bash
# In WSL2 Ubuntu
sudo apt-get install krb5-user

# Configure /etc/krb5.conf (same as Linux setup above)
sudo nano /etc/krb5.conf

# Use keytab
kinit -kt /etc/keytabs/mcp-server.keytab svc-mcp-server@COMPANY.COM

# Run server
npm start
```

### Platform Comparison

| Feature | Windows (Domain-Joined) | Linux | Windows (Non-Domain) |
|---------|------------------------|-------|---------------------|
| **Kerberos Library** | Windows SSPI | MIT Kerberos | MIT Kerberos (recommended) |
| **Password Auth** | ❌ Not supported | ✅ Supported | ✅ With MIT Kerberos |
| **Keytab Auth** | ❌ Not supported by SSPI | ✅ **Recommended** | ✅ With MIT Kerberos |
| **Current User Credentials** | ✅ Default | ⚠️ Requires `kinit` | ⚠️ Requires `kinit` |
| **Setup Complexity** | Low (automatic) | Medium (keytab setup) | High (MIT Kerberos install) |
| **Production Ready** | ✅ Yes | ✅ Yes | ⚠️ Yes (with MIT Kerberos) |

## Troubleshooting

### Common Issues

**Issue: "Kerberos client initialization failed"**
- Verify service account has SPN configured
- Check KDC server is reachable
- Ensure Windows SSPI is available (or MIT Kerberos on Linux)

**Issue: "No credentials are available in the security package" (Windows SSPI)**
- **Cause**: Windows SSPI doesn't support password authentication; it requires cached credentials
- **Solution 1**: Install MIT Kerberos for Windows (see [Option 1](#option-1-mit-kerberos-for-windows-recommended))
- **Solution 2**: Run server with `runas /netonly` (see [Option 2](#option-2-windows-credential-manager-sspi))
- **Solution 3**: Use domain-joined machine where credentials are automatically cached

**Issue: "S4U2Self failed: KDC_ERR_BADOPTION"**
- Service account missing `TrustedToAuthForDelegation` flag
- Protocol transition not enabled in AD

**Issue: "S4U2Proxy failed: KDC_ERR_BADOPTION"**
- Target service not in `msDS-AllowedToDelegateTo` list
- Constrained delegation not configured

**Issue: "Keytab contains no suitable keys" (Linux)**
- Keytab file doesn't match the service principal name
- Regenerate keytab with correct SPN using `ktpass`

### Debug Mode

Enable debug logging:
```typescript
const kerberosModule = new KerberosDelegationModule();
kerberosModule.setDebugMode(true);
```

## License

MIT

## See Also

- [MCP OAuth Framework](https://github.com/yourorg/mcp-oauth)
- [Framework Extension Guide](../../Docs/EXTENDING.md)
- [Kerberos Constrained Delegation (Microsoft Docs)](https://docs.microsoft.com/en-us/windows-server/security/kerberos/kerberos-constrained-delegation-overview)
