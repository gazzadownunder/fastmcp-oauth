# Multi-Delegation Architecture: Multiple TE-JWTs with Claim-Based Authorization

**Created:** 2025-01-10
**Status:** 🎯 Architectural Design
**Type:** Enhancement + Critical Bug Fix

---

## Executive Summary

This document defines the **correct architecture** for the MCP OAuth framework:

1. **NO static server-side permissions** - Authorization is claim-based (from JWT)
2. **Multiple TrustedIDPs** - Support requestor JWT + multiple delegation TE-JWTs
3. **Two-tier authorization**:
   - **Primary:** Downstream system (via `legacy_name` or OAuth token)
   - **Secondary (optional):** TE-JWT claims provide constraint layer

---

## Problem: Current Design Drift

### What's Wrong

```typescript
// ❌ WRONG: Static server-side permissions
{
  "auth": {
    "permissions": {
      "userPermissions": ["sql:query", "sql:write"]  // WRONG!
    }
  }
}
```

**Issues:**
1. Authorization is server-side, not claim-based
2. Cannot support multiple delegations (SQL, Kerberos, APIs)
3. Cannot support privilege reduction (TE-JWT constrains downstream permissions)
4. Violates OAuth 2.1 principles

---

## Correct Architecture

### Multi-Delegation Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                  1. Requestor JWT (MCP Tool Access)              │
│                                                                   │
│  Client: mcp-oauth                                               │
│  Audience: "mcp-oauth"                                           │
│  Roles: ["user"]                                                 │
│  → Controls: Which MCP tools user can ACCESS                     │
└────────────────────────────┬──────────────────────────────────────┘
                             │
                             │ Token Exchange (RFC 8693)
                             │
        ┌────────────────────┼────────────────────┬─────────────────────┐
        │                    │                    │                     │
        ↓                    ↓                    ↓                     ↓
┌─────────────────┐  ┌──────────────────┐  ┌──────────────┐  ┌──────────────────┐
│  SQL TE-JWT     │  │ Kerberos TE-JWT  │  │ OAuth API TE │  │ Salesforce TE    │
├─────────────────┤  ├──────────────────┤  ├──────────────┤  ├──────────────────┤
│ Client: sql-    │  │ Client: krb-     │  │ Client: api- │  │ Client: sf-      │
│ delegation      │  │ delegation       │  │ delegation   │  │ delegation       │
│                 │  │                  │  │              │  │                  │
│ Aud: urn:sql:db │  │ Aud: urn:krb:leg │  │ Aud: api.co  │  │ Aud: sf.com      │
│                 │  │                  │  │              │  │                  │
│ legacy_name:    │  │ legacy_name:     │  │ scopes:      │  │ scopes:          │
│  "ALICE_ADMIN"  │  │  "ALICE_KRB"     │  │  ["read","w" │  │  ["api","chatter"│
│                 │  │                  │  │              │  │                  │
│ roles: [        │  │ roles: [         │  │ roles: [     │  │ roles: [         │
│  "admin"        │  │  "user"          │  │  "api-user"  │  │  "sf-admin"      │
│ ]               │  │ ]                │  │ ]            │  │ ]                │
│                 │  │                  │  │              │  │                  │
│ allowed_ops: [  │  │ allowed_svc: [   │  │              │  │                  │
│  "read",        │  │  "fileserver"    │  │              │  │                  │
│  "write"        │  │ ]                │  │              │  │                  │
│ ]               │  │                  │  │              │  │                  │
│                 │  │                  │  │              │  │                  │
│ ↓ CONSTRAINT    │  │ ↓ CONSTRAINT     │  │ ↓ DIRECT     │  │ ↓ DIRECT         │
└────────┬────────┘  └────────┬─────────┘  └──────┬───────┘  └────────┬─────────┘
         │                    │                   │                   │
         ↓                    ↓                   ↓                   ↓
┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐  ┌──────────────────┐
│ SQL Server       │  │ Windows AD/KRB   │  │ REST API     │  │ Salesforce       │
│ EXECUTE AS USER  │  │ S4U2Self/Proxy   │  │ Bearer Token │  │ OAuth Token      │
│ 'ALICE_ADMIN'    │  │ 'ALICE_KRB'      │  │ TE-JWT       │  │ TE-JWT           │
│                  │  │                  │  │              │  │                  │
│ PRIMARY AUTH:    │  │ PRIMARY AUTH:    │  │ PRIMARY AUTH:│  │ PRIMARY AUTH:    │
│ ALICE_ADMIN has  │  │ ALICE_KRB has    │  │ API checks   │  │ SF checks scopes │
│ admin rights     │  │ user rights      │  │ scopes       │  │                  │
│                  │  │                  │  │              │  │                  │
│ SECONDARY AUTH:  │  │ SECONDARY AUTH:  │  │ SECONDARY:   │  │ SECONDARY:       │
│ TE-JWT limits to │  │ TE-JWT limits to │  │ NONE - Uses  │  │ NONE - Uses      │
│ read+write only  │  │ fileserver only  │  │ scopes only  │  │ scopes only      │
│ (no execute/drop)│  │ (no printserver) │  │              │  │                  │
└──────────────────┘  └──────────────────┘  └──────────────┘  └──────────────────┘
```

### Key Principles

1. **Requestor JWT** controls MCP tool access (which tools user can call)
2. **TE-JWT per delegation** - Different TE-JWT for SQL, Kerberos, APIs
3. **Primary authorization** from downstream system (via legacy_name or OAuth scopes)
4. **Secondary authorization (optional)** from TE-JWT claims constrains downstream permissions

---

## Configuration Schema

### Example: Multiple Delegations

```json
{
  "trustedIDPs": [
    {
      "name": "requestor-jwt",
      "description": "User authentication token for MCP tool access",
      "issuer": "http://localhost:8080/realms/mcp_security",
      "audience": "mcp-oauth",
      "claimMappings": {
        "roles": "user_roles",
        "userId": "sub",
        "username": "preferred_username"
      },
      "roleMappings": {
        "admin": ["admin"],
        "user": ["user", "authenticated"],
        "guest": ["guest"],
        "defaultRole": "guest"
      }
    },
    {
      "name": "sql-delegation-te-jwt",
      "description": "Token for SQL Server delegation (EXECUTE AS USER)",
      "issuer": "http://localhost:8080/realms/mcp_security",
      "audience": "urn:sql:database",
      "claimMappings": {
        "roles": "roles",
        "legacyUsername": "legacy_name",
        "userId": "sub",
        "allowedOperations": "allowed_operations"
      },
      "roleMappings": {
        "admin": ["admin", "sql-admin"],
        "user": ["user", "sql-user"],
        "defaultRole": "guest"
      },
      "tokenExchange": {
        "tokenEndpoint": "http://localhost:8080/realms/mcp_security/protocol/openid-connect/token",
        "clientId": "sql-delegation-client",
        "clientSecret": "SQL_SECRET",
        "audience": "urn:sql:database"
      }
    },
    {
      "name": "kerberos-delegation-te-jwt",
      "description": "Token for Kerberos constrained delegation (S4U2Proxy)",
      "issuer": "http://localhost:8080/realms/mcp_security",
      "audience": "urn:kerberos:legacy",
      "claimMappings": {
        "legacyUsername": "legacy_name",
        "userId": "sub",
        "allowedServices": "allowed_services"
      },
      "roleMappings": {
        "user": ["kerberos-user"],
        "defaultRole": "guest"
      },
      "tokenExchange": {
        "tokenEndpoint": "http://localhost:8080/realms/mcp_security/protocol/openid-connect/token",
        "clientId": "kerberos-delegation-client",
        "clientSecret": "KRB_SECRET",
        "audience": "urn:kerberos:legacy"
      }
    },
    {
      "name": "oauth-api-te-jwt",
      "description": "Token for downstream OAuth 2.0 API",
      "issuer": "http://localhost:8080/realms/mcp_security",
      "audience": "https://api.company.com",
      "claimMappings": {
        "roles": "roles",
        "userId": "sub",
        "scopes": "scope"
      },
      "tokenExchange": {
        "tokenEndpoint": "http://localhost:8080/realms/mcp_security/protocol/openid-connect/token",
        "clientId": "api-delegation-client",
        "clientSecret": "API_SECRET",
        "audience": "https://api.company.com"
      }
    },
    {
      "name": "salesforce-te-jwt",
      "description": "Token for Salesforce API delegation",
      "issuer": "http://localhost:8080/realms/mcp_security",
      "audience": "https://login.salesforce.com",
      "claimMappings": {
        "roles": "roles",
        "userId": "sub",
        "scopes": "scope"
      },
      "tokenExchange": {
        "tokenEndpoint": "http://localhost:8080/realms/mcp_security/protocol/openid-connect/token",
        "clientId": "salesforce-delegation-client",
        "clientSecret": "SF_SECRET",
        "audience": "https://login.salesforce.com"
      }
    }
  ]
}
```

### JWT Matching Logic

**JWTValidator** finds the correct IDP config by matching `iss` + `aud`:

```typescript
/**
 * Find IDP configuration by JWT issuer and audience
 *
 * CRITICAL: Supports multiple IDPs for different delegation targets
 *
 * @param jwtPayload - Decoded JWT payload
 * @returns Matching IDP config or throws error
 */
private findIDPConfig(jwtPayload: JWTPayload): IDPConfig {
  const { iss, aud } = jwtPayload;

  // aud can be string or array
  const audiences = Array.isArray(aud) ? aud : [aud];

  // Find config where issuer matches AND audience is in aud array
  const config = this.idpConfigs.find(idp =>
    idp.issuer === iss && audiences.includes(idp.audience)
  );

  if (!config) {
    throw new Error(
      `No trusted IDP found for iss="${iss}", aud="${audiences.join(', ')}"`
    );
  }

  console.log(`[JWTValidator] Matched IDP config: ${config.name} (aud: ${config.audience})`);
  return config;
}
```

**Examples:**

```typescript
// Requestor JWT
{
  "iss": "http://localhost:8080/realms/mcp_security",
  "aud": ["mcp-oauth"],
  "user_roles": ["user"]
}
// Matches: trustedIDPs[0] (requestor-jwt)
// Uses claimMappings: { roles: "user_roles" }

// SQL TE-JWT
{
  "iss": "http://localhost:8080/realms/mcp_security",
  "aud": ["urn:sql:database"],
  "roles": ["admin"],
  "legacy_name": "ALICE_ADMIN",
  "allowed_operations": ["read", "write"]
}
// Matches: trustedIDPs[1] (sql-delegation-te-jwt)
// Uses claimMappings: { roles: "roles", legacyUsername: "legacy_name" }

// Kerberos TE-JWT
{
  "iss": "http://localhost:8080/realms/mcp_security",
  "aud": ["urn:kerberos:legacy"],
  "legacy_name": "ALICE_KRB",
  "allowed_services": ["fileserver"]
}
// Matches: trustedIDPs[2] (kerberos-delegation-te-jwt)
```

---

## Two-Tier Authorization Model

### Tier 1: Primary Authorization (Downstream System)

**SQL Server Example:**
```sql
-- MCP server executes:
EXECUTE AS USER 'ALICE_ADMIN';
SELECT * FROM sensitive_table;
REVERT;

-- SQL Server checks:
-- 1. Does ALICE_ADMIN exist? (✅ from AD/local user)
-- 2. Does ALICE_ADMIN have SELECT on sensitive_table? (✅ from SQL permissions)
-- 3. Allow query
```

**Kerberos Example:**
```
MCP server performs S4U2Proxy delegation as 'ALICE_KRB'
Windows AD checks:
  1. Does ALICE_KRB exist? (✅ from AD)
  2. Can ALICE_KRB access \\fileserver\share? (✅ from AD permissions)
  3. Grant access
```

**OAuth API Example:**
```
MCP server sends TE-JWT as Bearer token to API
API validates:
  1. JWT signature valid? (✅ from JWKS)
  2. JWT has required scopes? (✅ from "scope" claim)
  3. Allow API call
```

### Tier 2: Secondary Authorization (TE-JWT Constraints) - OPTIONAL

**SQL Server with Constraints:**
```typescript
// TE-JWT claims
{
  "legacy_name": "ALICE_ADMIN",           // Has admin rights in SQL
  "allowed_operations": ["read", "write"]  // TE-JWT LIMITS to read+write only
}

// MCP delegation module checks TE-JWT BEFORE executing
async delegate(operation: SQLOperation): Promise<Result> {
  // Secondary authorization: Check TE-JWT constraints
  const teJWT = await this.performTokenExchange();
  const allowedOps = teJWT.claims.allowed_operations || [];

  if (operation.type === 'execute' && !allowedOps.includes('execute')) {
    throw new Error('TE-JWT does not allow execute operations');
  }

  if (operation.type === 'drop' && !allowedOps.includes('admin')) {
    throw new Error('TE-JWT does not allow admin operations');
  }

  // Primary authorization: SQL Server checks ALICE_ADMIN permissions
  return await this.executeSQLWithDelegation(
    teJWT.claims.legacy_name,
    operation.sql
  );
}
```

**Result:** Even though `ALICE_ADMIN` has full admin rights in SQL Server, the TE-JWT **limits** operations to read+write only.

**Kerberos with Constraints:**
```typescript
// TE-JWT claims
{
  "legacy_name": "ALICE_KRB",
  "allowed_services": ["fileserver"]  // Limit to fileserver only
}

// Kerberos delegation module checks TE-JWT
async delegate(service: string): Promise<Result> {
  const teJWT = await this.performTokenExchange();
  const allowedServices = teJWT.claims.allowed_services || [];

  if (!allowedServices.includes(service)) {
    throw new Error(`TE-JWT does not allow access to ${service}`);
  }

  // Perform delegation (AD checks actual ALICE_KRB permissions)
  return await this.performKerberosDelegation(
    teJWT.claims.legacy_name,
    service
  );
}
```

**Result:** Even though `ALICE_KRB` might have access to printserver in AD, the TE-JWT **limits** to fileserver only.

---

## UserSession Schema (Corrected)

### Remove Static Permissions

```typescript
// ❌ OLD (WRONG)
export interface UserSession {
  userId: string;
  username: string;
  role: string;                  // Mapped framework role
  permissions: string[];         // ❌ REMOVE THIS - Static permissions
  customRoles: string[];         // JWT roles (unmapped)
  scopes: string[];
  claims: JWTPayload;
}

// ✅ NEW (CORRECT)
export interface UserSession {
  _version: number;              // Schema version for migrations
  userId: string;
  username: string;
  legacyUsername?: string;       // From JWT claim (for delegation)
  role: string;                  // Mapped framework role (admin/user/guest)
  customRoles: string[];         // Direct JWT roles (unmapped)
  scopes: string[];              // JWT scopes claim
  claims: JWTPayload;            // Full JWT claims
  rejected: boolean;             // Whether role mapping failed

  // Custom claims from TE-JWT (optional, delegation-specific)
  customClaims?: Record<string, any>;  // e.g., { allowed_operations: ["read"] }
}
```

### Accessing Custom TE-JWT Claims

```typescript
// SQL delegation module
const teJWT = await tokenExchange.performExchange({ audience: 'urn:sql:database' });
const teSession = await authService.authenticate(teJWT.access_token);

// Access TE-JWT specific claims
const allowedOperations = teSession.customClaims?.allowed_operations || [];
const legacyName = teSession.legacyUsername;

// Check constraint
if (!allowedOperations.includes('write')) {
  throw new Error('TE-JWT does not permit write operations');
}

// Execute with primary authorization (SQL Server checks legacyName permissions)
await executeSQLAsUser(legacyName, query);
```

---

## Tool Authorization (Role-Based)

### Correct Pattern

```typescript
// ✅ CORRECT: Check roles from JWT, not static permissions

// Option 1: Check mapped framework role
canAccess: (context) => {
  const auth = new Authorization();
  return auth.hasAnyRole(context, ['user', 'admin']);
}

// Option 2: Check JWT custom roles directly
canAccess: (context) => {
  return context.session.customRoles.includes('sql-user');
}

// Option 3: Check both framework + custom roles
canAccess: (context) => {
  const auth = new Authorization();
  return auth.hasRole(context, 'user') ||
         context.session.customRoles.includes('sql-user');
}

// ❌ WRONG: Check static permissions (DO NOT DO THIS)
canAccess: (context) => {
  return context.session.permissions.includes('sql:query');  // WRONG!
}
```

### SQL Tool Example

```typescript
export const createSqlDelegateTool: ToolFactory = (context: CoreContext) => ({
  name: 'sql-delegate',
  description: 'Execute SQL operations with delegation',
  schema: sqlDelegateSchema,

  // Check requestor JWT roles (MCP tool access)
  canAccess: (mcpContext: MCPContext) => {
    const auth = new Authorization();

    // User must have 'user' or 'admin' role in requestor JWT
    return auth.hasAnyRole(mcpContext, ['user', 'admin']);
  },

  handler: async (params, mcpContext) => {
    // Step 1: Exchange requestor JWT for SQL TE-JWT
    const teJWT = await context.delegationRegistry.performExchange(
      'sql',
      {
        subjectToken: mcpContext.session.claims.rawToken,
        audience: 'urn:sql:database'
      }
    );

    // Step 2: Validate TE-JWT (will match sql-delegation-te-jwt IDP config)
    const teSession = await context.authService.authenticate(teJWT.access_token);

    // Step 3: Secondary authorization - Check TE-JWT constraints
    const allowedOps = teSession.customClaims?.allowed_operations || [];
    if (params.action === 'execute' && !allowedOps.includes('execute')) {
      throw new Error('TE-JWT does not allow execute operations');
    }

    // Step 4: Primary authorization - Execute with TE-JWT legacy_name
    // SQL Server will check if teSession.legacyUsername has actual permissions
    const result = await executeSQLAsUser(
      teSession.legacyUsername,
      params.sql
    );

    return { status: 'success', data: result };
  }
});
```

---

## Migration Plan

### Phase 1: Remove Static Permissions ⚠️ BREAKING

1. **Remove from TypeScript:**
   - ❌ Delete `PermissionConfig` interface
   - ❌ Delete `permissions` field from `UserSession`
   - ❌ Remove `permissions` parameter from `SessionManager` constructor
   - ❌ Remove `getPermissions()` method from `SessionManager`

2. **Remove from Configuration Schema:**
   ```typescript
   // ❌ REMOVE THIS
   export const CoreAuthConfigSchema = z.object({
     permissions: PermissionConfigSchema.optional()  // DELETE
   });
   ```

3. **Update Tools:**
   - Change all `hasPermission()` checks to `hasRole()` or `customRoles.includes()`

4. **Update Tests:**
   - Remove all permission-based test assertions
   - Add role-based test assertions

### Phase 2: Support Multiple TE-JWTs ✅ NON-BREAKING

1. **Add JWT matching by iss + aud:**
   - `JWTValidator.findIDPConfig()` method

2. **Support multiple `tokenExchange` configs:**
   - Each delegation target has its own TE-JWT IDP config

3. **Add `customClaims` to UserSession:**
   - Store delegation-specific claims (e.g., `allowed_operations`)

4. **Update delegation modules:**
   - Perform token exchange with specific audience
   - Check TE-JWT custom claims for constraints
   - Execute with TE-JWT `legacy_name` or OAuth scopes

---

## Success Criteria

- ✅ NO static `permissions` config in schema
- ✅ UserSession has NO `permissions` field
- ✅ All tools check **roles** (framework or custom), not permissions
- ✅ Multiple TrustedIDPs supported (requestor + N delegations)
- ✅ Each delegation has unique audience
- ✅ TE-JWT constraints work (secondary authorization)
- ✅ Downstream systems provide primary authorization
- ✅ Tests pass with role-based authorization

---

**Status:** 🎯 Ready for Implementation
**Priority:** P0 (Critical - Blocking Production)
**Estimated Effort:** 3-5 days
