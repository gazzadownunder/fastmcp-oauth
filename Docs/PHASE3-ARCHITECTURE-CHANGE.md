# Phase 3 Architecture Change: Token Exchange Before Session Creation

**Status:** ✅ IMPLEMENTED
**Date:** 2025-01-20
**Version:** v3.2

## Problem Statement

### Original Architecture (INCORRECT):
```
1. Validate requestor JWT → Create session with requestor JWT claims
2. User calls Kerberos tool
3. Kerberos module performs token exchange
4. TE-JWT may have different permissions than requestor JWT
5. **PROBLEM**: Session created with requestor JWT permissions, but TE-JWT has different permissions
```

**Issues:**
- TE-JWT may not have permissions to perform Kerberos operations
- No validation that TE-JWT has `legacy_name` claim before connections
- Authorization mismatch between requestor JWT and TE-JWT
- Token exchange happens too late (at delegation time, not auth time)

## New Architecture (CORRECT)

### Token Exchange Happens BEFORE Session Creation

```
┌─────────────────────────────────────────────────────────────┐
│              NEW AUTHENTICATION FLOW                         │
│                                                              │
│  1. Middleware extracts Bearer token (requestor JWT)        │
│                                                              │
│  2. AuthenticationService validates requestor JWT           │
│     - Verify signature, issuer, audience, expiration        │
│     - Extract claims (sub, roles, etc.)                     │
│                                                              │
│  3. AuthenticationService performs token exchange           │
│     - Call TokenExchangeService.performExchange()           │
│     - Exchange requestor JWT for TE-JWT                     │
│     - IDP returns TE-JWT with delegation-specific claims    │
│                                                              │
│  4. Validate TE-JWT has required claims                     │
│     - Check for legacy_name claim (Kerberos requirement)    │
│     - Check for required permissions/roles                  │
│     - FAIL FAST if validation fails (401 Unauthorized)      │
│                                                              │
│  5. Map roles from TE-JWT claims (NOT requestor JWT)        │
│     - Extract roles from TE-JWT                             │
│     - RoleMapper.determineRoles()                           │
│     - Use TE-JWT roles for authorization                    │
│                                                              │
│  6. Create session with TE-JWT claims                       │
│     - session.legacyUsername from TE-JWT.legacy_name        │
│     - session.delegationToken = TE-JWT                      │
│     - session.customClaims = TE-JWT claims                  │
│     - session.claims.access_token = requestor JWT           │
│                                                              │
│  7. Kerberos module uses pre-validated TE-JWT claims        │
│     - NO token exchange in delegate() method                │
│     - Use session.legacyUsername directly                   │
│     - Perform S4U2Self/S4U2Proxy with validated claims      │
└─────────────────────────────────────────────────────────────┘
```

### Key Principles

1. **Early Validation**: Token exchange and validation happen during authentication, not delegation
2. **Fail Fast**: Missing `legacy_name` or required claims cause 401 Unauthorized immediately
3. **Single Source of Truth**: Session contains pre-validated TE-JWT claims
4. **No Duplicate Work**: Kerberos module doesn't perform token exchange
5. **Authorization Correctness**: Roles and permissions from TE-JWT, not requestor JWT

## Code Changes

### 1. Core Layer: Type Updates

#### [`src/core/types.ts`](src/core/types.ts)

**Added to `UserSession` interface:**
```typescript
/** Session ID (for caching and tracking) */
sessionId: string;

/** Delegation token (TE-JWT) obtained via RFC 8693 token exchange */
/** This token has delegation-specific claims (legacy_name, permissions) */
delegationToken?: string;

/** Custom claims from TE-JWT (delegation-specific) */
/** e.g., { allowed_operations: ["read"], allowed_services: ["fileserver"] } */
customClaims?: Record<string, any>;
```

**Updated documentation:**
- `legacyUsername` now extracted from TE-JWT `legacy_name` claim
- `claims.access_token` stores requestor JWT for reference
- `delegationToken` stores TE-JWT for delegation modules
- `customClaims` stores TE-JWT claims for delegation-specific logic

### 2. Core Layer: SessionManager Updates

#### [`src/core/session-manager.ts`](src/core/session-manager.ts)

**Updated `createSession()` signature:**
```typescript
createSession(
  jwtPayload: JWTPayload,
  roleResult: RoleMapperResult,
  accessToken?: string,
  delegationToken?: string,          // NEW: TE-JWT
  delegationClaims?: Record<string, any>  // NEW: TE-JWT claims
): UserSession
```

**Key changes:**
- Generate unique `sessionId` using `randomUUID()`
- `legacyUsername` extracted from `delegationClaims.legacy_name` (priority over requestor JWT)
- Store `delegationToken` and `customClaims` in session
- Store requestor JWT in `claims.access_token`

### 3. Core Layer: AuthenticationService Updates

#### [`src/core/authentication-service.ts`](src/core/authentication-service.ts)

**Added interface for dependency injection:**
```typescript
export interface ITokenExchangeService {
  performExchange(params: {...}): Promise<TokenExchangeResult>;
  decodeTokenClaims(token: string): any | null;
}
```

**Updated constructor:**
```typescript
constructor(
  config: AuthConfig,
  auditService?: AuditService,
  tokenExchangeService?: ITokenExchangeService  // NEW: Injected dependency
)
```

**Updated `authenticate()` flow:**

1. **Validate requestor JWT** (no change)
   ```typescript
   const validationResult = await this.jwtValidator.validateJWT(token, context);
   ```

2. **Perform token exchange (NEW):**
   ```typescript
   if (this.config.tokenExchange && this.tokenExchangeService) {
     const exchangeResult = await this.tokenExchangeService.performExchange({
       subjectToken: token,
       audience: this.config.tokenExchange.audience,
       // ... other params
     });

     if (!exchangeResult.success) {
       throw new Error(`Token exchange failed: ${exchangeResult.error}`);
     }

     delegationToken = exchangeResult.accessToken;
     delegationClaims = this.tokenExchangeService.decodeTokenClaims(delegationToken);
   }
   ```

3. **Validate TE-JWT claims (NEW):**
   ```typescript
   if (this.config.tokenExchange.requiredClaim) {
     const requiredClaim = this.config.tokenExchange.requiredClaim;
     if (!delegationClaims || !delegationClaims[requiredClaim]) {
       throw new Error(`TE-JWT missing required claim: ${requiredClaim}`);
     }
   }
   ```

4. **Map roles from TE-JWT (NOT requestor JWT):**
   ```typescript
   const effectiveClaims = delegationClaims || validationResult.claims;
   const rolesFromClaims = effectiveClaims[rolesClaimPath];
   const roleResult = this.roleMapper.determineRoles(rolesInput);
   ```

5. **Create session with TE-JWT claims:**
   ```typescript
   const session = this.sessionManager.createSession(
     validationResult.payload,
     roleResult,
     token,              // Requestor JWT
     delegationToken,    // TE-JWT
     delegationClaims    // TE-JWT claims
   );
   ```

### 4. MCP Layer: ConfigOrchestrator Updates

#### [`src/mcp/orchestrator.ts`](src/mcp/orchestrator.ts)

**Added imports:**
```typescript
import type { ITokenExchangeService } from '../core/authentication-service.js';
import { TokenExchangeService } from '../delegation/token-exchange.js';
```

**Updated `createAuthenticationService()`:**

1. **Create TokenExchangeService if configured:**
   ```typescript
   let tokenExchangeService: ITokenExchangeService | undefined;
   if (config.delegation?.tokenExchange) {
     tokenExchangeService = new TokenExchangeService(
       config.delegation.tokenExchange,
       auditService
     );
   }
   ```

2. **Add tokenExchange to authConfig:**
   ```typescript
   const authConfig = {
     idpConfigs: config.auth.trustedIDPs,
     roleMappings: roleMappingConfig,
     tokenExchange: config.delegation?.tokenExchange ? {
       tokenEndpoint: config.delegation.tokenExchange.tokenEndpoint,
       clientId: config.delegation.tokenExchange.clientId,
       clientSecret: config.delegation.tokenExchange.clientSecret,
       audience: config.delegation.tokenExchange.audience,
       requiredClaim: 'legacy_name',  // Kerberos requirement
     } : undefined,
   };
   ```

3. **Inject TokenExchangeService:**
   ```typescript
   return new AuthenticationService(authConfig, auditService, tokenExchangeService);
   ```

### 5. Delegation Layer: Kerberos Module Cleanup

#### [`src/delegation/kerberos/kerberos-module.ts`](src/delegation/kerberos/kerberos-module.ts)

**Removed:**
- `setTokenExchangeService()` method
- `private tokenExchangeService` field
- `private tokenExchangeConfig` field
- Token exchange logic from `delegate()` method
- Import of `TokenExchangeService`

**Simplified `delegate()` method:**
```typescript
async delegate<T>(
  session: UserSession,
  action: string,
  params: KerberosParams
): Promise<DelegationResult<T>> {
  // Validate user has legacy_username claim (should be pre-validated by AuthenticationService)
  if (!session.legacyUsername) {
    return {
      success: false,
      error: 'User session missing legacy_username claim for Kerberos delegation',
      // ...
    };
  }

  // Use pre-validated legacy_username from session (populated by AuthenticationService)
  const effectiveLegacyUsername = session.legacyUsername;
  const userPrincipal = `${effectiveLegacyUsername}@${this.config!.realm}`;

  // Perform S4U2Self/S4U2Proxy with validated claims
  // ...
}
```

## Configuration Updates

### Required Configuration Changes

#### [`test-harness/config/phase3-test-config.json`](test-harness/config/phase3-test-config.json)

**Token exchange config** (already present):
```json
{
  "delegation": {
    "tokenExchange": {
      "tokenEndpoint": "http://localhost:8080/realms/mcp_security/protocol/openid-connect/token",
      "clientId": "mcp-server-client",
      "clientSecret": "sVJvwv0AllnSw64MUggSk9NS2ifteLQK",
      "audience": "mcp-server-client",
      "defaultScope": "legacy_name",
      "cache": {
        "enabled": true,
        "ttlSeconds": 60,
        "sessionTimeoutMs": 900000,
        "maxEntriesPerSession": 10,
        "maxTotalEntries": 1000
      }
    }
  }
}
```

**No changes needed** - Configuration already includes token exchange settings!

## Architecture Benefits

### 1. Security

- ✅ **Fail Fast**: Missing `legacy_name` causes 401 Unauthorized at auth time, not delegation time
- ✅ **Correct Authorization**: Roles/permissions from TE-JWT, ensuring consistency
- ✅ **Reduced Attack Surface**: Token exchange happens once, not on every delegation
- ✅ **Validated Claims**: `legacy_name` validated before any Kerberos operations

### 2. Performance

- ✅ **Single Token Exchange**: Happens once during authentication, not per delegation call
- ✅ **Cached TE-JWT**: Stored in session for reuse across multiple delegation operations
- ✅ **Reduced Latency**: No token exchange overhead during Kerberos delegation
- ✅ **Session Caching**: EncryptedTokenCache works seamlessly with sessionId

### 3. Correctness

- ✅ **Single Source of Truth**: Session contains authoritative TE-JWT claims
- ✅ **No Mismatch**: Authorization based on TE-JWT, not requestor JWT
- ✅ **Pre-Validation**: Claims validated before session creation
- ✅ **Consistent State**: Session always has validated delegation claims

### 4. Maintainability

- ✅ **Separation of Concerns**: Authentication handles token exchange, delegation uses claims
- ✅ **Layer Compliance**: Core → Delegation → MCP (one-way dependencies maintained)
- ✅ **Dependency Injection**: TokenExchangeService injected via interface
- ✅ **Simplified Kerberos Module**: No token exchange logic, just delegation

## Testing Plan

### 1. Unit Tests

**AuthenticationService:**
- ✅ Token exchange performed during authenticate()
- ✅ TE-JWT validated for required claims
- ✅ Roles mapped from TE-JWT, not requestor JWT
- ✅ Session created with TE-JWT claims

**SessionManager:**
- ✅ Session includes sessionId, delegationToken, customClaims
- ✅ legacyUsername extracted from TE-JWT.legacy_name

**KerberosDelegationModule:**
- ✅ Uses session.legacyUsername directly
- ✅ No token exchange performed
- ✅ Fails if session.legacyUsername missing

### 2. Integration Tests

**Phase 3 Test Harness:**
1. Start server with `test-harness/start-phase3-server.bat`
2. Authenticate with Keycloak (get requestor JWT)
3. Call `kerberos-list-directory` tool
4. Verify:
   - Token exchange happens during authentication
   - Session has `legacy_name` from TE-JWT
   - Kerberos delegation succeeds
   - File listing returned

**Expected Log Output:**
```
[AuthenticationService] Requestor JWT validated
[AuthenticationService] Token exchange configured - performing exchange BEFORE session creation
[AuthenticationService] Token exchange SUCCESS
[AuthenticationService] TE-JWT claims: { legacy_name: 'ALICE_ADMIN', roles: [...] }
[AuthenticationService] ✓ TE-JWT has required claim 'legacy_name': ALICE_ADMIN
[AuthenticationService] Session created: { sessionId: '...', legacyUsername: 'ALICE_ADMIN', hasDelegationToken: true }
[KERBEROS-MODULE] Using pre-validated legacy_username from session: ALICE_ADMIN
[KERBEROS-MODULE] ✓ Delegation successful
```

## Migration Guide

### For Existing Deployments

**No configuration changes required!** The new architecture uses existing `delegation.tokenExchange` config.

**Steps:**
1. Deploy new code version (v3.2)
2. Restart server
3. Verify logs show token exchange during authentication
4. Test Kerberos delegation tools

**Rollback Plan:**
- Revert to v3.1 if issues occur
- No data migration needed (stateless authentication)

## Conclusion

The new architecture solves critical security and correctness issues by performing token exchange BEFORE session creation. This ensures:

- ✅ TE-JWT claims validated early (fail fast)
- ✅ Authorization based on TE-JWT, not requestor JWT
- ✅ Kerberos delegation uses pre-validated claims
- ✅ Improved performance (single token exchange)
- ✅ Simplified delegation module code

**Next Steps:**
1. Test with phase3 configuration
2. Verify token exchange logs
3. Confirm Kerberos delegation works
4. Update documentation with new flow
