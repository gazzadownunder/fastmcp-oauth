# Design Fix: Roles-Based Authorization (Remove Static Permissions)

**Created:** 2025-01-10
**Status:** 🔴 Critical Design Fix Required
**Severity:** High - Architectural drift from original design

---

## Problem Statement

The current implementation has **drifted from the original design** by introducing a static `permissions` configuration that maps roles to permissions. This violates the core principle that **authorization should be based on JWT claims (roles), not static server-side configuration**.

### Current INCORRECT Implementation

```typescript
// ❌ WRONG: Static permissions config
{
  "auth": {
    "permissions": {
      "adminPermissions": ["read", "write", "sql:query", "sql:procedure"],
      "userPermissions": ["read", "sql:query"],
      "guestPermissions": ["read"]
    }
  }
}

// ❌ WRONG: Tools check static permissions
canAccess: (context) => {
  return context.session.permissions.some(p => p.startsWith('sql:'));
}
```

**Problems:**
1. **Authorization is server-side**, not claim-based (violates OAuth principles)
2. **Cannot support privilege elevation/reduction** (TE-JWT with different permissions than requestor JWT)
3. **Requires server restart** to change permissions
4. **Duplicates authorization logic** (JWT has roles, server has permissions)

### Correct Design (Original Architecture)

```typescript
// ✅ CORRECT: JWT contains roles claim
{
  "sub": "alice@test.local",
  "roles": ["user", "sql-user"],  // From JWT claim
  "aud": ["mcp-oauth"]
}

// ✅ CORRECT: claimMappings defines which JWT claim contains roles
{
  "trustedIDPs": [{
    "claimMappings": {
      "roles": "user_roles"  // JWT claim name → framework field
    },
    "roleMappings": {
      "user": ["user", "authenticated"],  // JWT role → framework role
      "admin": ["admin", "administrator"]
    }
  }]
}

// ✅ CORRECT: Tools check roles (from JWT)
canAccess: (context) => {
  return auth.hasAnyRole(context, ['user', 'admin']);
}

// ✅ CORRECT: Or check custom roles directly from JWT
canAccess: (context) => {
  return context.session.customRoles.includes('sql-user');
}
```

**Benefits:**
1. **Authorization is claim-based** (OAuth 2.1 compliant)
2. **Supports privilege elevation/reduction** (different roles in requestor JWT vs TE-JWT)
3. **No server restart needed** (roles come from IDP)
4. **Single source of truth** (IDP controls authorization)

---

## Root Cause Analysis

### How Did This Happen?

1. **SessionManager** was designed with `PermissionConfig` to assign permissions based on roles
2. **ConfigOrchestrator** added `permissions` section to configuration
3. **Tools** started checking `permissions` instead of `roles`
4. **Bug:** ConfigOrchestrator wasn't passing permissions → tests failed → we "fixed" it by adding permissions config

**The "fix" was WRONG** - we should have **removed the permissions concept entirely**.

---

## Proposed Solution: Dual-JWT Support

### Architecture

Support **two types of JWTs** with separate IDP configurations:

```json
{
  "trustedIDPs": [
    {
      "name": "requestor-jwt",
      "issuer": "http://localhost:8080/realms/mcp_security",
      "audience": "mcp-oauth",
      "claimMappings": {
        "roles": "user_roles",
        "userId": "sub",
        "username": "preferred_username"
      },
      "roleMappings": {
        "admin": ["admin"],
        "user": ["user"],
        "guest": ["guest"],
        "defaultRole": "guest"
      }
    },
    {
      "name": "te-jwt",
      "issuer": "http://localhost:8080/realms/mcp_security",
      "audience": "mcp-server-client",
      "claimMappings": {
        "roles": "roles",
        "legacyUsername": "legacy_name",
        "userId": "sub"
      },
      "roleMappings": {
        "admin": ["admin", "sql-admin"],
        "user": ["user", "sql-user"],
        "defaultRole": "guest"
      },
      "tokenExchange": {
        "tokenEndpoint": "http://localhost:8080/realms/mcp_security/protocol/openid-connect/token",
        "clientId": "mcp-server-client",
        "clientSecret": "SECRET"
      }
    }
  ]
}
```

### JWT Matching Logic

**JWTValidator** matches JWT to IDP config by:
1. Extract `iss` and `aud` from JWT
2. Find IDP config where `issuer === iss` AND `audience` in `aud` array
3. Use that IDP's `claimMappings` and `roleMappings`

**Example:**
```typescript
// Requestor JWT
{
  "iss": "http://localhost:8080/realms/mcp_security",
  "aud": ["mcp-oauth"],
  "user_roles": ["user"]
}
// Matches: trustedIDPs[0] (requestor-jwt config)

// TE-JWT
{
  "iss": "http://localhost:8080/realms/mcp_security",
  "aud": ["mcp-server-client"],
  "roles": ["admin", "sql-admin"],
  "legacy_name": "ALICE_ADMIN"
}
// Matches: trustedIDPs[1] (te-jwt config)
```

### Benefits

1. **Flexible authorization**: Requestor JWT can have different roles than TE-JWT
2. **Privilege elevation**: User role in MCP → Admin role in TE-JWT
3. **Privilege reduction**: Admin role in MCP → Read-only role in TE-JWT
4. **Multiple delegation targets**: Different TE-JWT configs for SQL, API, Salesforce
5. **Backward compatible**: Single IDP config still works

---

## Implementation Plan

### Phase 1: Remove Static Permissions ✅ CRITICAL

**Changes Required:**

1. **Remove `PermissionConfig` from SessionManager**
   ```typescript
   // ❌ REMOVE THIS
   export interface PermissionConfig {
     adminPermissions?: string[];
     userPermissions?: string[];
     guestPermissions?: string[];
     customPermissions?: Record<string, string[]>;
   }

   // ✅ SessionManager no longer needs permissions config
   constructor() {
     // No permission config parameter
   }
   ```

2. **Remove `permissions` field from UserSession**
   ```typescript
   // ❌ REMOVE THIS
   export interface UserSession {
     permissions: string[];  // REMOVE
     // ...
   }

   // ✅ Keep only roles
   export interface UserSession {
     role: string;           // Mapped framework role (admin/user/guest)
     customRoles: string[];  // Direct JWT roles (unmapped)
     // ...
   }
   ```

3. **Update tools to check roles, not permissions**
   ```typescript
   // ❌ OLD (WRONG)
   canAccess: (context) => {
     return context.session.permissions.some(p => p.startsWith('sql:'));
   }

   // ✅ NEW (CORRECT) - Option 1: Check framework role
   canAccess: (context) => {
     return auth.hasAnyRole(context, ['user', 'admin']);
   }

   // ✅ NEW (CORRECT) - Option 2: Check JWT custom role
   canAccess: (context) => {
     return context.session.customRoles.includes('sql-user');
   }
   ```

4. **Remove `permissions` from configuration schema**
   ```typescript
   // ❌ REMOVE from CoreAuthConfigSchema
   permissions: PermissionConfigSchema.optional()

   // ✅ Only keep role mappings
   roleMappings: RoleMappingConfigSchema.optional()
   ```

5. **Remove permissions from AuthConfig**
   ```typescript
   // ❌ REMOVE
   export interface AuthConfig {
     permissions?: PermissionConfig;  // REMOVE THIS
   }

   // ✅ Keep only role mappings
   export interface AuthConfig {
     roleMappings?: RoleMappingConfig;
   }
   ```

### Phase 2: Support Dual-JWT Configs 🎯 ENHANCEMENT

**Changes Required:**

1. **Add `name` field to IDP config (optional, for debugging)**
   ```typescript
   export interface IDPConfig {
     name?: string;  // Optional: "requestor-jwt", "te-jwt", etc.
     issuer: string;
     audience: string;  // Primary audience
     // ...
   }
   ```

2. **Update JWTValidator matching logic**
   ```typescript
   // Find IDP config by iss + aud
   private findIDPConfig(jwtPayload: JWTPayload): IDPConfig | null {
     const { iss, aud } = jwtPayload;

     // aud can be string or array
     const audiences = Array.isArray(aud) ? aud : [aud];

     // Find config where issuer matches AND audience is in aud array
     return this.idpConfigs.find(config =>
       config.issuer === iss && audiences.includes(config.audience)
     );
   }
   ```

3. **Use matched IDP config for claim mapping**
   ```typescript
   validateJWT(token: string, validationContext?: ValidationContext): JWTPayload {
     // 1. Decode JWT (without verification)
     const payload = this.decodeJWT(token);

     // 2. Find matching IDP config
     const idpConfig = this.findIDPConfig(payload);
     if (!idpConfig) {
       throw new Error(`No IDP config found for iss=${payload.iss}, aud=${payload.aud}`);
     }

     // 3. Verify JWT with matched IDP's JWKS
     await this.verifyJWT(token, idpConfig);

     // 4. Map claims using matched IDP's claimMappings
     return this.mapClaims(payload, idpConfig.claimMappings);
   }
   ```

4. **Update SQLDelegationModule to use TE-JWT roles**
   ```typescript
   async delegate(operation: DelegationOperation): Promise<DelegationResult> {
     // 1. Perform token exchange (requestor JWT → TE-JWT)
     const teJWT = await this.tokenExchangeService.performExchange({
       subjectToken: operation.context.session.claims.rawToken,
       audience: 'mcp-server-client'
     });

     // 2. Validate TE-JWT (will match te-jwt IDP config)
     const teSession = await this.authService.authenticate(teJWT.access_token);

     // 3. Use TE-JWT roles for authorization (NOT requestor JWT roles!)
     if (!teSession.customRoles.includes('sql-admin')) {
       throw new SecurityError('Insufficient privileges for SQL operation');
     }

     // 4. Execute with TE-JWT legacy_name
     return await this.executeSQLWithDelegation(
       teSession.legacyUsername,
       operation.sql
     );
   }
   ```

---

## Migration Path

### Step 1: Remove Static Permissions (Breaking Change)

**Impact:** Existing configurations with `permissions` section will need updates

**Migration:**
```json
// ❌ OLD CONFIG (INVALID AFTER MIGRATION)
{
  "auth": {
    "permissions": {
      "userPermissions": ["sql:query"]
    }
  }
}

// ✅ NEW CONFIG (Use JWT roles instead)
{
  "trustedIDPs": [{
    "claimMappings": {
      "roles": "user_roles"
    },
    "roleMappings": {
      "user": ["user", "authenticated"]
    }
  }]
}

// ✅ JWT MUST contain roles claim
{
  "user_roles": ["user", "sql-user"]  // Assigned by IDP
}
```

**Tool Updates:**
```typescript
// ❌ OLD TOOL
canAccess: (context) => {
  return context.session.permissions.includes('sql:query');
}

// ✅ NEW TOOL - Option 1: Framework role
canAccess: (context) => {
  return auth.hasRole(context, 'user');
}

// ✅ NEW TOOL - Option 2: JWT custom role
canAccess: (context) => {
  return context.session.customRoles.includes('sql-user');
}
```

### Step 2: Add Dual-JWT Support (Non-Breaking)

**Impact:** Existing single-IDP configs continue to work

**Enhancement:**
```json
{
  "trustedIDPs": [
    {
      "name": "requestor-jwt",
      "audience": "mcp-oauth",
      "roleMappings": { "user": ["user"] }
    },
    {
      "name": "te-jwt",
      "audience": "mcp-server-client",
      "roleMappings": { "admin": ["sql-admin"] },
      "tokenExchange": { ... }
    }
  ]
}
```

---

## Testing Plan

### Unit Tests

1. **SessionManager without permissions**
   - ✅ Create session with only role (no permissions field)
   - ✅ Verify `permissions` field does not exist on UserSession

2. **JWTValidator multi-IDP matching**
   - ✅ Match requestor JWT by iss + aud[0]
   - ✅ Match TE-JWT by iss + aud[1]
   - ✅ Fail if no IDP config matches

3. **Authorization helpers with roles**
   - ✅ `hasRole()` checks framework role
   - ✅ `hasAnyRole()` checks custom roles array
   - ✅ NO `hasPermission()` methods (removed)

### Integration Tests

1. **Two-stage authorization with dual JWTs**
   - ✅ Requestor JWT (aud: mcp-oauth) → MCP tool access
   - ✅ TE-JWT (aud: mcp-server-client) → SQL delegation
   - ✅ Different roles in each JWT

2. **Privilege elevation**
   - ✅ Requestor JWT: role=user, customRoles=["user"]
   - ✅ TE-JWT: role=admin, customRoles=["admin", "sql-admin"]
   - ✅ SQL operation succeeds with TE-JWT admin role

3. **Privilege reduction**
   - ✅ Requestor JWT: role=admin
   - ✅ TE-JWT: customRoles=["read-only"]
   - ✅ SQL write operation fails with TE-JWT read-only role

---

## Rollout Plan

### Week 1: Remove Static Permissions

1. Remove `PermissionConfig` from codebase
2. Remove `permissions` field from UserSession
3. Update all tools to check roles
4. Update tests
5. Update documentation

### Week 2: Add Dual-JWT Support

1. Add JWT matching by iss + aud
2. Support multiple IDP configs
3. Update SQLDelegationModule to use TE-JWT roles
4. Integration tests with dual JWTs

### Week 3: Documentation Update

1. Update CLAUDE.md with roles-based authorization
2. Update configuration examples
3. Create migration guide
4. Update test harness documentation

---

## Open Questions

1. **Should we support permissions from JWT claims?**
   - Answer: YES, if JWT has `permissions` claim, map it to `customPermissions` array
   - But NO static server-side permissions config

2. **How to handle tools that need fine-grained permissions?**
   - Answer: Check JWT custom roles (e.g., `sql-read`, `sql-write`, `sql-execute`)
   - Or check JWT custom permissions claim if IDP provides it

3. **Backward compatibility for existing deployments?**
   - Answer: BREAKING CHANGE - requires config migration
   - Provide migration script and documentation

---

## Success Criteria

- ✅ No static `permissions` configuration in schema
- ✅ UserSession has NO `permissions` field
- ✅ All authorization checks use roles (framework or custom)
- ✅ Dual-JWT support works (requestor + TE-JWT)
- ✅ Tests pass with role-based authorization
- ✅ Documentation updated with correct design
- ✅ Migration guide available

---

**Status:** 🔴 Critical Fix Required
**Priority:** P0 (Blocking for production readiness)
**Owner:** TBD
**Target Completion:** Week 1 (Phase 1), Week 2 (Phase 2)
