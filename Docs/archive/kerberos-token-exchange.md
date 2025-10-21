# Kerberos Token Exchange Implementation

**Status:** Implementation Complete | **Date:** 2025-01-20

## Overview

This document describes the token exchange implementation for the Kerberos delegation module, following the exact pattern used by the SQL delegation module.

## Problem Statement

The Kerberos delegation module requires a `legacy_name` claim (Windows username like "ALICE") to construct the Kerberos user principal (e.g., `ALICE@W25AD.NET`). However, the requestor JWT may not contain this claim.

## Solution: RFC 8693 Token Exchange

The Kerberos module now performs **token exchange** to obtain a delegation JWT (TE-JWT) containing the `legacy_name` claim.

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                  Kerberos Token Exchange Flow                    │
│                                                                   │
│  1. Client → MCP Server                                          │
│     Authorization: Bearer <requestor_jwt>                        │
│     Tool: kerberos-list-directory                                │
│                                                                   │
│  2. KerberosDelegationModule.delegate()                          │
│     - Check if tokenExchangeService configured                   │
│     - Extract requestor JWT from session.claims.access_token     │
│                                                                   │
│  3. TokenExchangeService.performExchange()                       │
│     POST https://auth.company.com/token                          │
│     grant_type: urn:ietf:params:oauth:grant-type:token-exchange │
│     subject_token: <requestor_jwt>                               │
│     subject_token_type: urn:ietf:params:oauth:token-type:access_token │
│     audience: kerberos-delegation                                │
│                                                                   │
│  4. IDP → MCP Server                                             │
│     { access_token: <delegation_jwt>, ... }                      │
│                                                                   │
│  5. KerberosDelegationModule                                     │
│     - Decode delegation JWT                                      │
│     - Extract legacy_name claim (e.g., "ALICE")                 │
│     - Build user principal: ALICE@W25AD.NET                      │
│                                                                   │
│  6. KerberosClient                                               │
│     - Perform S4U2Self (obtain ticket for user)                  │
│     - Perform S4U2Proxy (delegate to file server)                │
│     - Return Kerberos ticket                                     │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Details

### 1. KerberosDelegationModule Changes

**File:** [src/delegation/kerberos/kerberos-module.ts](../src/delegation/kerberos/kerberos-module.ts)

**Added Properties:**
```typescript
private tokenExchangeService: TokenExchangeService | null = null;
private tokenExchangeConfig: {
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string;
  audience?: string;
} | null = null;
```

**Added Method:**
```typescript
setTokenExchangeService(
  service: TokenExchangeService,
  config: {
    tokenEndpoint: string;
    clientId: string;
    clientSecret: string;
    audience?: string;
  }
): void {
  console.log('[KERBEROS-MODULE] Setting token exchange service:', {
    tokenEndpoint: config.tokenEndpoint,
    clientId: config.clientId,
    audience: config.audience || 'kerberos-delegation',
  });
  this.tokenExchangeService = service;
  this.tokenExchangeConfig = config;
}
```

**Updated delegate() Method:**

The `delegate()` method now:
1. Checks if `tokenExchangeService` is configured
2. If yes, performs token exchange to get delegation JWT
3. Decodes delegation JWT to extract `legacy_name` claim
4. Uses `legacy_name` from delegation JWT (not requestor JWT)
5. Falls back to `session.legacyUsername` if token exchange not configured

**Code Flow:**
```typescript
// PHASE 1: Token Exchange (if configured)
let effectiveLegacyUsername = session.legacyUsername;

if (this.tokenExchangeService) {
  // Extract requestor JWT from session claims
  const subjectToken = session.claims?.access_token as string | undefined;

  // Perform token exchange
  const exchangeResult = await this.tokenExchangeService.performExchange({
    subjectToken,
    subjectTokenType: 'urn:ietf:params:oauth:token-type:access_token',
    audience: this.tokenExchangeConfig.audience || 'kerberos-delegation',
    tokenEndpoint: this.tokenExchangeConfig.tokenEndpoint,
    clientId: this.tokenExchangeConfig.clientId,
    clientSecret: this.tokenExchangeConfig.clientSecret,
  });

  // Decode delegation JWT
  const teClaims = this.tokenExchangeService.decodeTokenClaims(exchangeResult.accessToken);

  // Extract legacy_name from delegation JWT
  effectiveLegacyUsername = teClaims.legacy_name;
}

// Build user principal using legacy_name from delegation JWT
const userPrincipal = `${effectiveLegacyUsername}@${this.config!.realm}`;
```

### 2. Test Harness Integration

**File:** [test-harness/v2-test-server.ts](../test-harness/v2-test-server.ts)

**Added Token Exchange Configuration:**
```typescript
// Check if token exchange is configured for Kerberos
if (delegationConfig?.tokenExchange) {
  console.log('      Token exchange detected for Kerberos delegation');
  console.log(`      Token endpoint: ${delegationConfig.tokenExchange.tokenEndpoint}`);
  console.log(`      Client ID: ${delegationConfig.tokenExchange.clientId}`);
  console.log(`      Audience: ${delegationConfig.tokenExchange.audience || 'kerberos-delegation'}`);

  // Create TokenExchangeService
  const tokenExchangeService = new TokenExchangeService(
    delegationConfig.tokenExchange,
    coreContext.auditService
  );

  // Inject into Kerberos module
  kerberosModule.setTokenExchangeService(tokenExchangeService, {
    tokenEndpoint: delegationConfig.tokenExchange.tokenEndpoint,
    clientId: delegationConfig.tokenExchange.clientId,
    clientSecret: delegationConfig.tokenExchange.clientSecret,
    audience: delegationConfig.tokenExchange.audience,
  });

  console.log('✓     Token exchange service configured for Kerberos');
}
```

### 3. Configuration

**File:** [test-harness/config/phase3-test-config.json](../test-harness/config/phase3-test-config.json)

The configuration already includes token exchange settings in the `delegation.tokenExchange` section:

```json
{
  "delegation": {
    "tokenExchange": {
      "tokenEndpoint": "https://auth.company.com/token",
      "clientId": "mcp-server",
      "clientSecret": "SECRET",
      "audience": "kerberos-delegation"
    },
    "modules": {
      "kerberos": {
        "enabled": true,
        "domainController": "w25-dc.w25ad.net",
        "realm": "W25AD.NET",
        "servicePrincipalName": "HTTP/mcp-server@W25AD.NET"
      }
    }
  }
}
```

## Debug Logging

The implementation includes comprehensive debug logging:

**Token Exchange Check:**
```
[KERBEROS-MODULE] Token Exchange Check: {
  hasTokenExchangeService: true,
  hasTokenExchangeConfig: true,
  sessionLegacyUsername: undefined
}
```

**Token Exchange Execution:**
```
[KERBEROS-MODULE] Token exchange service is configured - attempting token exchange
[KERBEROS-MODULE] Extracting subject token from session.claims.access_token: {
  hasSubjectToken: true,
  subjectTokenLength: 1234,
  availableClaimKeys: ['access_token', 'iss', 'sub', ...]
}
[KERBEROS-MODULE] Performing token exchange with IDP: {
  tokenEndpoint: 'https://auth.company.com/token',
  clientId: 'mcp-server',
  audience: 'kerberos-delegation'
}
```

**Token Exchange Result:**
```
[KERBEROS-MODULE] Token exchange result: {
  success: true,
  hasAccessToken: true,
  error: undefined,
  errorDescription: undefined
}
[KERBEROS-MODULE] Decoding delegation token (TE-JWT) to extract claims...
[KERBEROS-MODULE] Delegation token claims: {
  sub: 'alice',
  legacy_name: 'ALICE',
  roles: ['user'],
  aud: 'kerberos-delegation'
}
[KERBEROS-MODULE] Using legacy_name from TE-JWT: ALICE
```

**User Principal:**
```
[KERBEROS-MODULE] User principal: ALICE@W25AD.NET
```

## Error Handling

The implementation includes robust error handling:

### Missing Access Token
```typescript
if (!subjectToken) {
  return {
    success: false,
    error: 'Session missing access_token in claims (required for token exchange)',
    auditTrail: { /* ... */ },
  };
}
```

### Token Exchange Failure
```typescript
if (!exchangeResult.success || !exchangeResult.accessToken) {
  return {
    success: false,
    error: `Token exchange failed: ${exchangeResult.errorDescription || exchangeResult.error}`,
    auditTrail: { /* ... */ },
  };
}
```

### Missing legacy_name Claim
```typescript
if (!teClaims || !teClaims.legacy_name) {
  return {
    success: false,
    error: 'TE-JWT missing legacy_name claim (required for Kerberos delegation)',
    auditTrail: { /* ... */ },
  };
}
```

### General Token Exchange Error
```typescript
catch (error) {
  return {
    success: false,
    error: `Token exchange failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    auditTrail: { /* ... */ },
  };
}
```

## Testing

### Test Steps

1. **Start Test Server:**
   ```bash
   cd test-harness
   start-phase3-server.bat
   ```

2. **Verify Token Exchange Configuration:**
   Look for this in server startup logs:
   ```
   Token exchange detected for Kerberos delegation
   Token endpoint: https://auth.company.com/token
   Client ID: mcp-server
   Audience: kerberos-delegation
   ✓ Token exchange service configured for Kerberos
   ```

3. **Test kerberos-delegate Tool:**
   ```bash
   curl -X POST http://localhost:3010/mcp \
     -H "Authorization: Bearer $REQUESTOR_JWT" \
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

4. **Test kerberos-list-directory Tool:**
   ```bash
   curl -X POST http://localhost:3010/mcp \
     -H "Authorization: Bearer $REQUESTOR_JWT" \
     -H "Content-Type: application/json" \
     -d '{
       "jsonrpc": "2.0",
       "method": "tools/call",
       "params": {
         "name": "kerberos-list-directory",
         "arguments": {
           "path": "//fileserver/share/path"
         }
       },
       "id": 1
     }'
   ```

### Expected Debug Output

When a Kerberos tool is called, you should see:

1. **Token Exchange Check:**
   ```
   [KERBEROS-MODULE] Token Exchange Check:
     hasTokenExchangeService: true
   ```

2. **Token Exchange Execution:**
   ```
   [KERBEROS-MODULE] Token exchange service is configured - attempting token exchange
   [KERBEROS-MODULE] Performing token exchange with IDP
   ```

3. **Success:**
   ```
   [KERBEROS-MODULE] Token exchange result: success: true
   [KERBEROS-MODULE] Delegation token claims:
     legacy_name: ALICE
   [KERBEROS-MODULE] Using legacy_name from TE-JWT: ALICE
   [KERBEROS-MODULE] User principal: ALICE@W25AD.NET
   ```

## Comparison with SQL Module

The Kerberos token exchange implementation follows the **exact same pattern** as the SQL module:

| Aspect | SQL Module | Kerberos Module |
|--------|-----------|-----------------|
| **Service Property** | `tokenExchangeService: TokenExchangeService \| null` | ✅ Same |
| **Config Property** | `tokenExchangeConfig: { tokenEndpoint, clientId, ... }` | ✅ Same |
| **Setter Method** | `setTokenExchangeService(service, config)` | ✅ Same |
| **Token Exchange Call** | `performExchange({ subjectToken, audience, ... })` | ✅ Same |
| **Claim Extraction** | `decodeTokenClaims(accessToken)` | ✅ Same |
| **Claim Used** | `teClaims.legacy_name` for SET ROLE | ✅ Same (for user principal) |
| **Debug Logging** | `[PostgreSQL]` prefix | `[KERBEROS-MODULE]` prefix |
| **Error Handling** | Comprehensive with audit trail | ✅ Same |
| **Fallback Behavior** | Uses `session.legacyUsername` if no TE | ✅ Same |

## Security Considerations

1. **Access Token Extraction:**
   - Requestor JWT extracted from `session.claims.access_token`
   - This is populated by `MCPAuthMiddleware.authenticateRequest()`

2. **Token Exchange Security:**
   - HTTPS required for token endpoint (enforced by TokenExchangeService)
   - Client credentials (`clientId`, `clientSecret`) securely configured
   - Audience binding ensures delegation JWT scoped to Kerberos

3. **Claim Validation:**
   - Delegation JWT must contain `legacy_name` claim
   - Returns error if claim missing (prevents execution with undefined username)

4. **Audit Logging:**
   - All token exchange attempts logged (success and failure)
   - Full error details captured for investigation
   - Token exchange errors sanitized in client responses

## Differences from Direct JWT Claim

**Option 1 (Implemented): Token Exchange**
- ✅ Requestor JWT authorizes MCP tool access
- ✅ Delegation JWT authorizes Kerberos operations
- ✅ Separation of concerns (two-stage authorization)
- ✅ IDP controls both access and delegation privileges
- ✅ Supports privilege elevation/reduction
- ✅ Claim transformation (modern → legacy username)

**Option 2 (Rejected): Direct JWT Claim**
- ❌ Requestor JWT contains `legacy_name` directly
- ❌ Single-stage authorization only
- ❌ No privilege transformation
- ❌ Requires modifying IDP configuration to add custom claim

## Next Steps

1. **Keycloak Configuration:**
   - Configure token exchange mapper to add `legacy_name` claim to delegation JWT
   - See [test-harness/KEYCLOAK-TOKEN-EXCHANGE-SETUP.md](../test-harness/KEYCLOAK-TOKEN-EXCHANGE-SETUP.md)

2. **Active Directory Integration:**
   - Ensure service account has delegation rights
   - Configure SPNs for file servers
   - See [test-harness/KERBEROS-PHASE3-INTEGRATION.md](../test-harness/KERBEROS-PHASE3-INTEGRATION.md)

3. **Testing:**
   - Test with real Keycloak IDP
   - Verify delegation JWT contains `legacy_name` claim
   - Test file browsing with actual Windows file shares

## Files Modified

1. [src/delegation/kerberos/kerberos-module.ts](../src/delegation/kerberos/kerberos-module.ts) - Added token exchange support
2. [test-harness/v2-test-server.ts](../test-harness/v2-test-server.ts) - Configure token exchange for Kerberos
3. [Docs/kerberos-token-exchange.md](../Docs/kerberos-token-exchange.md) - This document

## References

- [RFC 8693 - OAuth 2.0 Token Exchange](https://www.rfc-editor.org/rfc/rfc8693.html)
- [CLAUDE.md](../CLAUDE.md) - Architecture documentation
- [Docs/oauth2 implementation.md](../Docs/oauth2 implementation.md) - OAuth delegation flow
- [src/delegation/token-exchange.ts](../src/delegation/token-exchange.ts) - TokenExchangeService implementation
