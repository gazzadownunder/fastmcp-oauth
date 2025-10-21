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

- **Windows Server** with Active Directory
- **Node.js** 18.0.0 or higher
- **Kerberos** configured service account with delegation rights

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

## Troubleshooting

### Common Issues

**Issue: "Kerberos client initialization failed"**
- Verify service account has SPN configured
- Check KDC server is reachable
- Ensure Windows SSPI is available

**Issue: "S4U2Self failed: KDC_ERR_BADOPTION"**
- Service account missing `TrustedToAuthForDelegation` flag
- Protocol transition not enabled in AD

**Issue: "S4U2Proxy failed: KDC_ERR_BADOPTION"**
- Target service not in `msDS-AllowedToDelegateTo` list
- Constrained delegation not configured

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
