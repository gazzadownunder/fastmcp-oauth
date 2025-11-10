# Configuration Reference Guide

Complete reference for `config.json` configuration options in the MCP OAuth framework.

## Table of Contents

- [Overview](#overview)
- [Critical Requirements](#critical-requirements)
- [Configuration Structure](#configuration-structure)
- [Auth Section](#auth-section)
- [Delegation Section](#delegation-section)
- [MCP Section](#mcp-section)
- [Complete Examples](#complete-examples)
- [Validation](#validation)

---

## Overview

The framework uses a unified JSON configuration file that defines:
1. **Authentication** - IDP trust relationships and JWT validation
2. **Delegation** - Downstream resource connections (SQL, APIs, etc.)
3. **MCP Server** - Server metadata and tool configuration

**Location:** Typically `config/unified-config.json` or specified via `MCPOAuthServer(configPath)`

---

## Critical Requirements

### ⚠️ Required IDP Name: "requestor-jwt"

**CRITICAL:** The IDP used to validate incoming bearer tokens **MUST** be named `"requestor-jwt"`.

```json
{
  "auth": {
    "trustedIDPs": [{
      "name": "requestor-jwt",  // ⚠️ REQUIRED - Cannot be changed!
      "issuer": "https://auth.example.com",
      // ... rest of config
    }]
  }
}
```

**Why?** The `MCPAuthMiddleware` is hardcoded to use `"requestor-jwt"` when validating incoming requests ([src/mcp/middleware.ts:113](../src/mcp/middleware.ts#L113)):

```typescript
const authResult = await this.authService.authenticate(token, {
  idpName: 'requestor-jwt',
});
```

**Common Error:** If you use a different name (e.g., `"main-idp"`), you'll see:
```
❌ Authentication error (statusCode: 401): No IDP configuration found with name: requestor-jwt
```

**Solution:** Always name your requestor IDP `"requestor-jwt"` in the configuration.

---

## Configuration Structure

### Top-Level Structure

```json
{
  "auth": { /* Authentication configuration */ },
  "delegation": { /* Delegation module configuration */ },
  "mcp": { /* MCP server configuration */ }
}
```

---

## How Components Link Together

Understanding how configuration elements connect is crucial for proper setup. This section explains the linkage between IDPs, claims, roles, and token exchange.

### 1. Trusted IDP Identification (name → issuer → audience)

The framework identifies which IDP configuration to use through a **two-level matching process**:

```
Level 1: FILTER by NAME (get all IDPs with matching name)
         ↓
Level 2: MATCH by ISSUER + AUDIENCE (find the specific IDP)
```

**Code Reference:** [src/core/jwt-validator.ts:209-243](../src/core/jwt-validator.ts#L209-L243)

```typescript
private findIDPByName(idpName: string, issuer: string, audiences: string[]): IDPConfig {
  // Level 1: Filter ALL IDPs with matching name (may return multiple)
  const namedIDPs = this.idpConfigs.filter((idp) => idp.name === idpName);

  // Level 2: Match issuer AND audience to find THE ONE
  const config = namedIDPs.find(
    (idp) => idp.issuer === issuer && audiences.includes(idp.audience)
  );

  return config;
}
```

**Key Insight:** You can have **MULTIPLE IDP configurations with the SAME name**. This allows supporting multiple issuers or audiences under a single IDP name.

#### Example 1: Single IDP

```json
{
  "auth": {
    "trustedIDPs": [
      {
        "name": "requestor-jwt",
        "issuer": "https://auth.company.com",
        "audience": "mcp-oauth",
        "jwksUri": "https://auth.company.com/.well-known/jwks.json"
      }
    ]
  }
}
```

**Validation Flow:**
1. Middleware calls: `authenticate(token, { idpName: 'requestor-jwt' })`
2. JWTValidator decodes JWT: `iss = "https://auth.company.com"`, `aud = ["mcp-oauth"]`
3. **Level 1 filter:** `name === "requestor-jwt"` → Returns `[trustedIDPs[0]]` (1 match)
4. **Level 2 match:** `issuer === iss` AND `aud includes audience` → Returns `trustedIDPs[0]`
5. Use that IDP config for JWT validation

#### Example 2: Multiple IDPs with SAME Name (Multi-Tenant)

```json
{
  "auth": {
    "trustedIDPs": [
      {
        "name": "requestor-jwt",                      // ← SAME NAME
        "issuer": "https://auth.company.com",
        "audience": "mcp-oauth",                      // Internal clients
        "jwksUri": "https://auth.company.com/.well-known/jwks.json",
        "claimMappings": { "roles": "internal_roles" }
      },
      {
        "name": "requestor-jwt",                      // ← SAME NAME
        "issuer": "https://auth.company.com",
        "audience": "mcp-oauth-public",               // Public clients
        "jwksUri": "https://auth.company.com/.well-known/jwks.json",
        "claimMappings": { "roles": "public_roles" }
      },
      {
        "name": "requestor-jwt",                      // ← SAME NAME
        "issuer": "https://partner-auth.example.com", // Partner IDP
        "audience": "mcp-oauth",
        "jwksUri": "https://partner-auth.example.com/.well-known/jwks.json",
        "claimMappings": { "roles": "partner_roles" }
      }
    ]
  }
}
```

**Validation Flow:**
1. Middleware calls: `authenticate(token, { idpName: 'requestor-jwt' })`
2. JWTValidator decodes JWT: `iss = "https://partner-auth.example.com"`, `aud = ["mcp-oauth"]`
3. **Level 1 filter:** `name === "requestor-jwt"` → Returns `[trustedIDPs[0], trustedIDPs[1], trustedIDPs[2]]` (3 matches)
4. **Level 2 match:** `issuer === iss` AND `aud includes audience` → Returns `trustedIDPs[2]` (partner IDP)
5. Use partner IDP config with `partner_roles` claim mapping

**Use Cases for Multiple IDPs with Same Name:**

| Scenario | Differentiation | Example |
|----------|----------------|---------|
| **Multi-tenant** | Different audiences | `mcp-tenant1`, `mcp-tenant2` |
| **Internal vs External** | Different audiences | `mcp-oauth` (internal), `mcp-oauth-public` (external) |
| **Partner integrations** | Different issuers | Company IDP vs Partner IDP |
| **Development vs Production** | Different issuers | `https://dev-auth.com` vs `https://auth.com` |
| **Different claim mappings** | Same issuer/audience | Different role claim paths per IDP |
| **Different tool access** | Different issuers/audiences | Single server exposes different tools based on IDP/claims - internal users get admin tools, partners get read-only tools |

#### Example 3: Different Tool Access Based on IDP

A single MCP server can expose different tools to different user groups based on which IDP configuration matches:

```json
{
  "auth": {
    "trustedIDPs": [
      {
        "name": "requestor-jwt",
        "issuer": "https://auth.company.com",
        "audience": "mcp-internal",                    // Internal employees
        "jwksUri": "https://auth.company.com/.well-known/jwks.json",
        "claimMappings": {
          "roles": "employee_roles",
          "scopes": "scopes"
        },
        "roleMappings": {                              // ← PER-IDP role mappings
          "admin": ["admin", "employee_admin"],
          "user": ["user", "employee"],
          "guest": [],
          "defaultRole": "user"
        }
      },
      {
        "name": "requestor-jwt",                       // SAME NAME
        "issuer": "https://partner-auth.example.com",  // Partner IDP
        "audience": "mcp-partner",
        "jwksUri": "https://partner-auth.example.com/.well-known/jwks.json",
        "claimMappings": {
          "roles": "partner_roles",
          "scopes": "partner_scopes"
        },
        "roleMappings": {                              // ← DIFFERENT role mappings for partners
          "admin": [],                                 // Partners never get admin
          "user": ["partner_user"],
          "guest": ["partner_readonly"],
          "defaultRole": "guest"
        }
      }
    ]
  }
}
```

**Tool Access Control:**

Tools use `canAccess` to filter visibility based on session properties:

```typescript
// Admin-only tool - only visible to internal employees
const adminTool = {
  name: 'admin-console',
  canAccess: (context) => {
    return context.session?.role === 'admin';  // Only employee_admin role
  }
};

// Read-only tool - visible to both internal and partners
const queryTool = {
  name: 'sql-query',
  canAccess: (context) => {
    return context.session?.permissions?.includes('sql:read');
  }
};

// Partner-restricted tool - only visible to partners
const partnerReportTool = {
  name: 'partner-report',
  canAccess: (context) => {
    // Check if token came from partner IDP (via custom claim or role)
    return context.session?.customRoles?.includes('partner_user');
  }
};
```

**Result:**
- **Internal employee** JWT (from `auth.company.com`, audience `mcp-internal`) → Sees: `admin-console`, `sql-query`
- **Partner** JWT (from `partner-auth.example.com`, audience `mcp-partner`) → Sees: `sql-query`, `partner-report`

**Common Errors:**

```
❌ Error: No IDP configuration found with name: requestor-jwt
   Fix: Add at least one IDP with name: "requestor-jwt" to trustedIDPs array

❌ Error: IDP "requestor-jwt" found but issuer/audience mismatch
   Fix: Ensure at least one IDP with name "requestor-jwt" has matching issuer AND audience
   Available: iss=[https://auth1.com, https://auth2.com], aud=[mcp-oauth, mcp-public]
```

### 2. Claims to Session Mapping (JWT claims → UserSession)

The framework extracts JWT claims and maps them to a `UserSession` object using `claimMappings`:

```
JWT Token Claims
    ↓
claimMappings (config)
    ↓
UserSession Properties
    ↓
Tool Authorization
```

**Configuration:**

```json
{
  "auth": {
    "trustedIDPs": [{
      "name": "requestor-jwt",
      "claimMappings": {
        "legacyUsername": "legacy_sam_account",    // JWT claim name
        "roles": "user_roles",                     // JWT claim name
        "scopes": "authorized_scopes",             // JWT claim name
        "userId": "sub",                           // Optional (defaults to "sub")
        "username": "preferred_username"           // Optional (defaults to "preferred_username")
      }
    }]
  }
}
```

**Mapping Process:**

| JWT Claim | claimMappings Config | UserSession Property | Usage |
|-----------|---------------------|---------------------|-------|
| `{ "sub": "user123" }` | `userId: "sub"` | `session.userId = "user123"` | User identification |
| `{ "preferred_username": "alice" }` | `username: "preferred_username"` | `session.username = "alice"` | Display name |
| `{ "legacy_sam_account": "DOMAIN\\alice" }` | `legacyUsername: "legacy_sam_account"` | `session.legacyUsername = "DOMAIN\\alice"` | SQL delegation |
| `{ "user_roles": ["admin", "user"] }` | `roles: "user_roles"` | `session.customRoles = ["admin", "user"]` | Authorization |
| `{ "authorized_scopes": "sql:read sql:write" }` | `scopes: "authorized_scopes"` | `session.permissions = ["sql:read", "sql:write"]` | Permission checks |

**Nested Claim Support:**

Keycloak example with nested roles:

```json
{
  "claimMappings": {
    "roles": "realm_access.roles"    // Accesses JWT: { realm_access: { roles: ["admin"] } }
  }
}
```

### 3. Role Mapping (JWT roles → Framework roles - PER-IDP)

The framework maps custom JWT role values to standardized roles using **per-IDP `roleMappings`**:

```
JWT Roles (from claims)
    ↓
IDP-specific roleMappings (config)
    ↓
Framework Role (admin/user/guest)
    ↓
Tool Access Control
```

**Key Insight:** `roleMappings` is **inside each IDP configuration**, not global. This allows different IDPs to have different role translation rules.

**Configuration:**

```json
{
  "auth": {
    "trustedIDPs": [
      {
        "name": "requestor-jwt",
        "issuer": "https://auth.company.com",
        "audience": "mcp-oauth",
        "claimMappings": {
          "roles": "user_roles"        // Extract roles from this JWT claim
        },
        "roleMappings": {                // ← PER-IDP role mappings
          "admin": ["admin", "administrator", "superuser"],
          "user": ["user", "member", "employee"],
          "guest": ["guest", "anonymous"],
          "defaultRole": "guest",
          "rejectUnmappedRoles": false
        }
      }
    ]
  }
}
```

**Mapping Examples:**

| JWT Roles | Mapped Framework Role | Tool Access |
|-----------|----------------------|-------------|
| `["admin"]` | `admin` | ✅ All tools (sql-delegate, health-check, user-info) |
| `["superuser"]` | `admin` | ✅ All tools (mapped via roleMappings.admin) |
| `["developer"]` | `guest` | ⚠️ Limited (defaultRole, not in roleMappings) |
| `["guest"]` | `guest` | ⚠️ Limited access |
| `[]` (no roles) | `guest` | ⚠️ defaultRole assigned |

**Per-IDP Role Mapping Example:**

Different IDPs can have different role mappings:

```json
{
  "auth": {
    "trustedIDPs": [
      {
        "name": "requestor-jwt",
        "issuer": "https://internal-auth.com",
        "audience": "mcp-internal",
        "roleMappings": {
          "admin": ["employee_admin"],     // Internal role names
          "user": ["employee"],
          "defaultRole": "user"
        }
      },
      {
        "name": "requestor-jwt",
        "issuer": "https://partner-auth.com",
        "audience": "mcp-partner",
        "roleMappings": {
          "admin": [],                     // Partners never get admin!
          "user": ["partner_user"],        // Partner role names
          "guest": ["partner_readonly"],
          "defaultRole": "guest"
        }
      }
    ]
  }
}
```

**Reject Unmapped Roles:**

```json
{
  "trustedIDPs": [{
    "roleMappings": {
      "admin": ["admin"],
      "user": ["user"],
      "rejectUnmappedRoles": true    // Reject JWTs with unmapped roles
    }
  }]
}
```

If JWT has `"roles": ["developer"]` and `rejectUnmappedRoles: true`:
- **Result:** Authentication rejected (HTTP 401)
- **Reason:** "developer" not in any role mapping array for this IDP

### 4. Token Exchange Linkage (idpName → tokenExchange → delegation)

Token exchange connects requestor JWTs to delegation tokens using IDP name references:

```
Requestor JWT (from client)
    ↓
Middleware: idpName="requestor-jwt"
    ↓
Tool Handler: Requires delegation
    ↓
tokenExchange: idpName="primary-db-idp"
    ↓
Token Exchange Service
    ↓
Delegation Token (TE-JWT)
    ↓
Downstream Resource (SQL, API)
```

**Configuration Linkage:**

```json
{
  "auth": {
    "trustedIDPs": [
      {
        "name": "requestor-jwt",              // ← Middleware uses this
        "issuer": "https://auth.company.com",
        "audience": "mcp-oauth",
        "jwksUri": "https://auth.company.com/.well-known/jwks.json"
      },
      {
        "name": "primary-db-idp",             // ← Token exchange references this
        "issuer": "https://auth.company.com",
        "audience": "primary-db",             // ← TE-JWT will have this audience
        "jwksUri": "https://auth.company.com/.well-known/jwks.json"
      }
    ]
  },
  "delegation": {
    "modules": {
      "postgresql": {
        "host": "db.company.com",
        "database": "app_db",
        "tokenExchange": {
          "idpName": "primary-db-idp",        // ← Links to trustedIDPs[1]
          "tokenEndpoint": "https://auth.company.com/token",
          "clientId": "mcp-server",
          "clientSecret": "SECRET",
          "audience": "primary-db",           // ← Requested audience for TE-JWT
          "scope": "sql:read sql:write"       // ← Requested scopes for TE-JWT
        }
      }
    }
  }
}
```

**Token Exchange Flow:**

1. **Client sends requestor JWT** with `aud: ["mcp-oauth"]`
2. **Middleware validates** using `idpName: "requestor-jwt"` config
3. **Tool handler** calls `DelegationRegistry.delegate('postgresql', ...)`
4. **PostgreSQL module** reads `tokenExchange.idpName: "primary-db-idp"`
5. **TokenExchangeService** exchanges requestor JWT for TE-JWT with `aud: ["primary-db"]`
6. **JWTValidator validates TE-JWT** using `idpName: "primary-db-idp"` config
7. **PostgreSQL module** uses TE-JWT claims for delegation

**Why Multiple IDPs?**

Different tokens need different validation configs:

| IDP Name | Purpose | Issuer | Audience | Used By |
|----------|---------|--------|----------|---------|
| `requestor-jwt` | Validate client JWTs | `auth.company.com` | `mcp-oauth` | Middleware |
| `primary-db-idp` | Validate TE-JWTs for primary DB | `auth.company.com` | `primary-db` | PostgreSQL module |
| `analytics-db-idp` | Validate TE-JWTs for analytics DB | `analytics.company.com` | `analytics-db` | Analytics module |

### 5. Complete End-to-End Flow Example

**Scenario:** User accesses `sql-delegate` tool with token exchange enabled.

**Configuration:**

```json
{
  "auth": {
    "trustedIDPs": [
      {
        "name": "requestor-jwt",
        "issuer": "https://auth.company.com",
        "audience": "mcp-oauth",
        "jwksUri": "https://auth.company.com/.well-known/jwks.json",
        "claimMappings": {
          "roles": "user_roles",
          "scopes": "scopes"
        },
        "roleMappings": {
          "admin": ["admin"],
          "user": ["user"],
          "defaultRole": "guest"
        }
      },
      {
        "name": "primary-db-idp",
        "issuer": "https://auth.company.com",
        "audience": "primary-db",
        "jwksUri": "https://auth.company.com/.well-known/jwks.json",
        "claimMappings": {
          "legacyUsername": "legacy_name",
          "roles": "db_roles"
        },
        "roleMappings": {
          "admin": ["db_admin"],
          "user": ["db_user"],
          "defaultRole": "guest"
        }
      }
    ]
  },
  "delegation": {
    "modules": {
      "postgresql": {
        "host": "db.company.com",
        "database": "app_db",
        "tokenExchange": {
          "idpName": "primary-db-idp",
          "tokenEndpoint": "https://auth.company.com/token",
          "clientId": "mcp-server",
          "clientSecret": "SECRET",
          "audience": "primary-db",
          "scope": "sql:read sql:write"
        }
      }
    }
  }
}
```

**Request Flow:**

```
1. Client Request
   POST /mcp
   Authorization: Bearer <requestor-jwt>
   Body: { method: "tools/call", params: { name: "sql-delegate", ... } }

2. Middleware Authentication (using "requestor-jwt" IDP)
   → Extract token from Authorization header
   → Call: authenticate(token, { idpName: 'requestor-jwt' })
   → JWTValidator:
      - Decode JWT: iss="https://auth.company.com", aud=["mcp-oauth"]
      - findIDPByName('requestor-jwt', iss, aud)
      - Filter: name === 'requestor-jwt' → trustedIDPs[0]
      - Match: issuer === iss AND aud includes audience → ✅
      - Validate JWT signature using trustedIDPs[0].jwksUri
   → Extract claims using claimMappings:
      - user_roles: ["user"] → session.customRoles = ["user"]
      - scopes: "mcp:read mcp:write" → session.permissions = ["mcp:read", "mcp:write"]
   → Map role: ["user"] → roleMappings.user → session.role = "user"
   → Return: { authenticated: true, session: {...} }

3. Tool Handler Execution
   → Check permission: hasPermission(session, 'sql:query') → ✅
   → Call: DelegationRegistry.delegate('postgresql', session, 'query', { sql, params })

4. Token Exchange (in PostgreSQLDelegationModule)
   → Read: tokenExchange.idpName = "primary-db-idp"
   → Call: TokenExchangeService.performExchange({
        requestorJWT: <original-jwt>,
        idpName: "primary-db-idp",
        audience: "primary-db",
        scope: "sql:read sql:write"
      })
   → POST https://auth.company.com/token
      grant_type=urn:ietf:params:oauth:grant-type:token-exchange
      subject_token=<requestor-jwt>
      audience=primary-db
      scope=sql:read sql:write
   → IDP returns: { access_token: <te-jwt> }

5. TE-JWT Validation (using "primary-db-idp" IDP)
   → JWTValidator validates TE-JWT:
      - Decode: iss="https://auth.company.com", aud=["primary-db"]
      - findIDPByName('primary-db-idp', iss, aud)
      - Filter: name === 'primary-db-idp' → trustedIDPs[1]
      - Match: issuer === iss AND aud includes audience → ✅
      - Validate signature using trustedIDPs[1].jwksUri
   → Extract claims using trustedIDPs[1].claimMappings:
      - legacy_name: "ALICE_ADMIN" → legacyUsername
      - db_roles: ["admin"] → customRoles

6. SQL Delegation
   → EXECUTE AS USER 'ALICE_ADMIN'
   → Execute query with user's privileges
   → REVERT
   → Return results

7. Response to Client
   ← HTTP 200
   ← Body: { result: [...], success: true }
```

**Key Linkages Summary:**

1. **Middleware → requestor-jwt:** Name reference in `authenticate(token, { idpName: 'requestor-jwt' })`
2. **requestor-jwt → JWT validation:** Issuer + audience match in trustedIDPs[0]
3. **JWT claims → Session:** claimMappings extraction (roles, scopes)
4. **Session roles → Framework role:** roleMappings translation (["user"] → "user")
5. **postgresql module → primary-db-idp:** Name reference in `tokenExchange.idpName`
6. **primary-db-idp → TE-JWT validation:** Issuer + audience match in trustedIDPs[1]
7. **TE-JWT claims → Delegation:** legacyUsername extracted for SQL delegation

---

## Auth Section

### Complete Auth Schema

```json
{
  "auth": {
    "trustedIDPs": [
      {
        "name": "requestor-jwt",              // Required for requestor IDP
        "issuer": "string",                    // Required: IDP issuer URL
        "discoveryUrl": "string",              // Optional: OIDC discovery endpoint
        "jwksUri": "string",                   // Required: JWKS endpoint URL
        "audience": "string",                  // Required: Expected audience claim
        "algorithms": ["RS256", "ES256"],      // Optional: Allowed algorithms
        "claimMappings": {
          "legacyUsername": "string",          // Optional: JWT claim for legacy username
          "roles": "string",                   // Optional: JWT claim for roles
          "scopes": "string"                   // Optional: JWT claim for scopes
        },
        "roleMappings": {                      // Optional: PER-IDP role mappings
          "admin": ["admin", "administrator"], // JWT role values → admin role
          "user": ["user", "member"],          // JWT role values → user role
          "guest": ["guest"],                  // JWT role values → guest role
          "defaultRole": "guest",              // Fallback role for unmapped values
          "rejectUnmappedRoles": false         // Reject if no role match (default: false)
        },
        "security": {
          "clockTolerance": 60,                // Optional: Clock skew tolerance (seconds)
          "maxTokenAge": 3600,                 // Optional: Max token lifetime (seconds)
          "requireNbf": true                   // Optional: Require "not before" claim
        }
      }
    ],
    "audit": {
      "enabled": true,                         // Optional: Enable audit logging
      "logAllAttempts": true,                  // Optional: Log all auth attempts
      "retentionDays": 90,                     // Optional: Log retention period
      "maxEntries": 10000                      // Optional: Max entries before overflow
    }
  }
}
```

### Auth Field Descriptions

#### trustedIDPs

Array of identity providers trusted by the framework.

**Field: name** (string, required for requestor IDP)
- **Purpose:** Identifier for this IDP configuration
- **Requestor IDP:** MUST be `"requestor-jwt"` (framework requirement)
- **Delegation IDPs:** Can be any name (e.g., `"sql-db-idp"`, `"analytics-idp"`)
- **Example:** `"name": "requestor-jwt"`

**Field: issuer** (string, required)
- **Purpose:** IDP issuer URL (must match `iss` claim in JWT)
- **Format:** HTTPS URL
- **Example:** `"issuer": "https://auth.company.com"`

**Field: discoveryUrl** (string, optional)
- **Purpose:** OIDC discovery endpoint for automatic configuration
- **Format:** HTTPS URL ending in `.well-known/openid-configuration`
- **Example:** `"discoveryUrl": "https://auth.company.com/.well-known/openid-configuration"`

**Field: jwksUri** (string, required)
- **Purpose:** JWKS endpoint for public key retrieval
- **Format:** HTTPS URL
- **Example:** `"jwksUri": "https://auth.company.com/.well-known/jwks.json"`

**Field: audience** (string, required)
- **Purpose:** Expected audience claim in JWT
- **Validation:** JWT's `aud` claim must match this value
- **Example:** `"audience": "mcp-server"`

**Field: algorithms** (string[], optional)
- **Purpose:** Allowed JWT signing algorithms
- **Allowed Values:** `["RS256", "ES256"]` only (RFC 8725 compliance)
- **Default:** `["RS256", "ES256"]`
- **Example:** `"algorithms": ["RS256"]`

**Field: claimMappings** (object, optional)
- **Purpose:** Map JWT claims to session properties
- **Subfields:**
  - `legacyUsername` (string): JWT claim containing legacy username (e.g., "DOMAIN\\user")
  - `roles` (string): JWT claim containing user roles (supports nested paths like "realm_access.roles")
  - `scopes` (string): JWT claim containing OAuth scopes
- **Example:**
  ```json
  "claimMappings": {
    "legacyUsername": "legacy_sam_account",
    "roles": "user_roles",
    "scopes": "scopes"
  }
  ```

**Field: security** (object, optional)
- **Purpose:** JWT validation security settings
- **Subfields:**
  - `clockTolerance` (number): Allowed clock skew in seconds (default: 60)
  - `maxTokenAge` (number): Maximum token lifetime in seconds (default: 3600)
  - `requireNbf` (boolean): Require "not before" claim (default: true)
- **Example:**
  ```json
  "security": {
    "clockTolerance": 60,
    "maxTokenAge": 3600,
    "requireNbf": true
  }
  ```

**Field: roleMappings** (object, optional - PER-IDP)
- **Purpose:** Maps JWT role values to framework roles (admin/user/guest) **for this specific IDP**
- **Location:** Inside each `trustedIDPs[]` object (NOT at global auth level)
- **Why per-IDP:** Different IDPs may use different role naming conventions or require different access levels
- **Subfields:**
  - `admin` (string[]): JWT role values that map to admin role (default: `["admin", "administrator"]`)
  - `user` (string[]): JWT role values that map to user role (default: `["user"]`)
  - `guest` (string[]): JWT role values that map to guest role (default: `[]`)
  - `defaultRole` (string): Fallback role for unmapped values - "admin", "user", or "guest" (default: `"guest"`)
  - `rejectUnmappedRoles` (boolean): Reject authentication if JWT roles don't match any mapping (default: `false`)
- **Example:**
  ```json
  "roleMappings": {
    "admin": ["admin", "employee_admin"],
    "user": ["user", "employee"],
    "guest": [],
    "defaultRole": "user",
    "rejectUnmappedRoles": false
  }
  ```

**Field: tokenExchange** (DEPRECATED - DO NOT USE)
- **Status:** ⚠️ **DEPRECATED** in favor of per-module token exchange
- **Reason:** Global token exchange was removed. Use per-module configuration instead.
- **Migration:** Move `tokenExchange` from `auth.trustedIDPs[]` to `delegation.modules.{moduleName}.tokenExchange`
- **Example:** See [Token Exchange Section](#token-exchange-configuration) below

#### audit

Audit logging configuration.

**Field: enabled** (boolean, optional)
- **Purpose:** Enable/disable audit logging
- **Default:** `true`
- **Example:** `"enabled": true`

**Field: logAllAttempts** (boolean, optional)
- **Purpose:** Log all authentication attempts (success + failure)
- **Default:** `true`
- **Example:** `"logAllAttempts": true`

**Field: retentionDays** (number, optional)
- **Purpose:** Log retention period in days
- **Default:** `90`
- **Example:** `"retentionDays": 30`

**Field: maxEntries** (number, optional)
- **Purpose:** Maximum audit log entries before overflow
- **Default:** `10000`
- **Example:** `"maxEntries": 5000`

---

## Delegation Section

### Complete Delegation Schema

```json
{
  "delegation": {
    "modules": {
      "postgresql": {                        // Module name (used for createSQLToolsForModule)
        "type": "postgresql",                // Optional: Database type
        "host": "string",                    // Required: Database host
        "port": 5432,                        // Optional: Database port
        "database": "string",                // Required: Database name
        "user": "string",                    // Optional: Database username
        "password": "string",                // Optional: Database password
        "options": {
          "trustedConnection": false,        // Optional: Use Windows auth (MSSQL only)
          "encrypt": true,                   // Optional: Require TLS
          "trustServerCertificate": false    // Optional: Trust self-signed certs
        },
        "tokenExchange": {                   // Optional: Per-database token exchange
          "idpName": "string",               // Required: IDP name from trustedIDPs
          "tokenEndpoint": "string",         // Required: Token endpoint URL
          "clientId": "string",              // Required: Client ID
          "clientSecret": "string",          // Required: Client secret
          "audience": "string",              // Optional: Target audience
          "scope": "string"                  // Optional: Requested scopes
        }
      }
    }
  }
}
```

### Delegation Field Descriptions

#### modules

Object containing delegation module configurations. Keys are module names used by `DelegationRegistry.delegate(moduleName, ...)`.

**Module Name Convention:**
- Single database: `"sql"` or `"postgresql"` or `"mssql"`
- Multiple databases: `"postgresql1"`, `"postgresql2"` or `"hr-db"`, `"sales-db"`
- Use descriptive names for tool prefix generation

**SQL Module Fields:**

**Field: type** (string, optional)
- **Purpose:** Database type identifier
- **Allowed Values:** `"postgresql"`, `"mssql"`, `"mysql"`
- **Example:** `"type": "postgresql"`

**Field: host** (string, required)
- **Purpose:** Database server hostname or IP
- **Example:** `"host": "db.company.com"`

**Field: port** (number, optional)
- **Purpose:** Database server port
- **Default:** `5432` (PostgreSQL), `1433` (MSSQL)
- **Example:** `"port": 5432`

**Field: database** (string, required)
- **Purpose:** Database name to connect to
- **Example:** `"database": "app_database"`

**Field: user** (string, optional)
- **Purpose:** Database username for authentication
- **When to use:** When not using trusted connection
- **Example:** `"user": "mcp_service_account"`

**Field: password** (string, optional)
- **Purpose:** Database password for authentication
- **Security:** Store in environment variables or secret manager
- **Example:** `"password": "${DB_PASSWORD}"` (use env var)

**Field: options** (object, optional)
- **Purpose:** Database-specific connection options
- **Subfields:**
  - `trustedConnection` (boolean): Use Windows authentication (MSSQL only)
  - `encrypt` (boolean): Require TLS encryption (default: true)
  - `trustServerCertificate` (boolean): Trust self-signed certificates (default: false)
  - `connectionTimeout` (number): Connection timeout in milliseconds
- **Example:**
  ```json
  "options": {
    "trustedConnection": true,
    "encrypt": true,
    "trustServerCertificate": false
  }
  ```

**Field: tokenExchange** (object, optional)
- **Purpose:** Per-database token exchange configuration
- **When to use:** When different databases use different IDPs or scopes
- **See:** [Token Exchange Configuration](#token-exchange-configuration) below

---

## MCP Section

### Complete MCP Schema

```json
{
  "mcp": {
    "serverName": "string",                  // Required: Server display name
    "version": "string",                     // Required: Server version
    "transport": "httpStream",               // Optional: Transport type
    "port": 3000,                            // Optional: HTTP server port
    "endpoint": "/mcp",                      // Optional: HTTP endpoint path
    "stateless": true,                       // Optional: Stateless mode
    "enabledTools": {                        // Optional: Tool enable/disable map
      "sql-delegate": true,
      "health-check": true,
      "user-info": true
    }
  }
}
```

### MCP Field Descriptions

**Field: serverName** (string, required)
- **Purpose:** Server display name shown to MCP clients
- **Example:** `"serverName": "HR Database MCP Server"`

**Field: version** (string, required)
- **Purpose:** Server version (semantic versioning)
- **Example:** `"version": "1.0.0"`

**Field: transport** (string, optional)
- **Purpose:** MCP transport protocol
- **Allowed Values:** `"stdio"`, `"sse"`, `"httpStream"`
- **Default:** `"httpStream"`
- **Example:** `"transport": "httpStream"`

**Field: port** (number, optional)
- **Purpose:** HTTP server port (httpStream transport only)
- **Default:** `3000`
- **Example:** `"port": 8080`

**Field: endpoint** (string, optional)
- **Purpose:** HTTP endpoint path (httpStream transport only)
- **Default:** `"/mcp"`
- **Example:** `"endpoint": "/api/mcp"`

**Field: stateless** (boolean, optional)
- **Purpose:** Enable stateless mode (JWT validation on every request)
- **Default:** `true`
- **Example:** `"stateless": true`

**Field: enabledTools** (object, optional)
- **Purpose:** Enable/disable specific tools
- **Format:** `{ "tool-name": boolean }`
- **Example:**
  ```json
  "enabledTools": {
    "sql-delegate": true,
    "sql-schema": true,
    "health-check": true,
    "user-info": false
  }
  ```

---

## Complete Examples

### Example 1: Single Database with Basic Auth

```json
{
  "auth": {
    "trustedIDPs": [{
      "name": "requestor-jwt",
      "issuer": "https://auth.company.com",
      "jwksUri": "https://auth.company.com/.well-known/jwks.json",
      "audience": "mcp-server",
      "algorithms": ["RS256"],
      "claimMappings": {
        "legacyUsername": "legacy_sam_account",
        "roles": "user_roles"
      }
    }]
  },
  "delegation": {
    "modules": {
      "postgresql": {
        "host": "db.company.com",
        "database": "app_db",
        "user": "mcp_service",
        "password": "${DB_PASSWORD}",
        "options": {
          "encrypt": true
        }
      }
    }
  },
  "mcp": {
    "serverName": "Company Database Server",
    "version": "1.0.0",
    "port": 3000
  }
}
```

### Example 2: Multi-Database with Token Exchange

```json
{
  "auth": {
    "trustedIDPs": [
      {
        "name": "requestor-jwt",
        "issuer": "https://auth.company.com",
        "jwksUri": "https://auth.company.com/.well-known/jwks.json",
        "audience": "mcp-oauth"
      },
      {
        "name": "primary-db-idp",
        "issuer": "https://auth.company.com",
        "audience": "primary-db"
      },
      {
        "name": "analytics-db-idp",
        "issuer": "https://analytics-auth.company.com",
        "audience": "analytics-db"
      }
    ]
  },
  "delegation": {
    "modules": {
      "postgresql1": {
        "host": "primary.company.com",
        "database": "app_db",
        "tokenExchange": {
          "idpName": "primary-db-idp",
          "tokenEndpoint": "https://auth.company.com/token",
          "clientId": "mcp-server-client",
          "clientSecret": "${PRIMARY_DB_SECRET}",
          "audience": "primary-db",
          "scope": "openid profile sql:read sql:write sql:admin"
        }
      },
      "postgresql2": {
        "host": "analytics.company.com",
        "database": "analytics_db",
        "tokenExchange": {
          "idpName": "analytics-db-idp",
          "tokenEndpoint": "https://analytics-auth.company.com/token",
          "clientId": "analytics-client",
          "clientSecret": "${ANALYTICS_DB_SECRET}",
          "audience": "analytics-db",
          "scope": "openid profile analytics:read"
        }
      }
    }
  },
  "mcp": {
    "serverName": "Multi-Database MCP Server",
    "version": "2.0.0",
    "enabledTools": {
      "sql1-delegate": true,
      "sql1-schema": true,
      "sql2-delegate": true,
      "sql2-schema": true,
      "health-check": true,
      "user-info": true
    }
  }
}
```

**Key Features:**
- ✅ Three IDPs: requestor + two delegation IDPs
- ✅ Per-database token exchange with different scopes
- ✅ Environment variables for secrets
- ✅ Prefixed SQL tools (`sql1-delegate`, `sql2-delegate`)

---

## Token Exchange Configuration

⚠️ **IMPORTANT:** Global token exchange configuration (in `auth.trustedIDPs[].tokenExchange`) has been **DEPRECATED**. Use per-module configuration instead.

### When to Use Token Exchange

Use token exchange when:
1. **Different privileges needed** - User has read-only access to MCP but full access to database
2. **Claim transformation required** - Requestor JWT lacks `legacy_name` but delegation JWT has it
3. **Separate IDPs** - Database uses different IDP than MCP server
4. **Fine-grained scopes** - Different databases require different OAuth scopes

### Per-Module Token Exchange (Current Approach)

Token exchange configuration is specified **per delegation module** in `delegation.modules.{moduleName}.tokenExchange`:

```json
{
  "delegation": {
    "modules": {
      "postgresql": {
        "host": "db.company.com",
        "database": "app_db",
        "user": "mcp_service",
        "password": "${DB_PASSWORD}",
        "tokenExchange": {
          "idpName": "primary-db-idp",         // IDP name from auth.trustedIDPs
          "tokenEndpoint": "https://auth.company.com/token",
          "clientId": "mcp-server",
          "clientSecret": "SECRET",
          "audience": "primary-db",
          "scope": "openid profile sql:read sql:write",
          "cache": {
            "enabled": true,                   // Enable encrypted token cache
            "ttlSeconds": 60,                  // Cache entry TTL (default: 60)
            "sessionTimeoutMs": 900000,        // Session timeout 15 min (default: 900000)
            "maxEntriesPerSession": 10,        // Max entries per session (default: 10)
            "maxTotalEntries": 1000            // Global entry limit (default: 1000)
          }
        }
      }
    }
  }
}
```

**Why per-module?**
- Different databases may use different IDPs
- Different scopes needed for different resources
- Allows fine-grained control over token exchange behavior

**Security Features:**
- ✅ AES-256-GCM encryption with AAD binding to requestor JWT
- ✅ Session-specific encryption keys (perfect forward secrecy)
- ✅ Automatic invalidation on JWT refresh
- ✅ 81% latency reduction (3300ms → 620ms for 20 delegation calls)

**When to Enable Cache:**
- High throughput scenarios (>100 delegation calls/min)
- Token exchange latency is bottleneck (>150ms per exchange)
- Security review completed and risk accepted
- Monitoring in place for cache metrics

---

## Validation

### Configuration Validation

The framework validates configuration at startup using Zod schemas ([src/config/schemas/](../src/config/schemas/)).

**Common Validation Errors:**

**Error:** `"name" is required for requestor IDP`
```
✅ Fix: Add "name": "requestor-jwt" to your IDP configuration
```

**Error:** `Invalid URL format for jwksUri`
```
✅ Fix: Ensure jwksUri is HTTPS URL (not HTTP)
```

**Error:** `Unsupported algorithm: HS256`
```
✅ Fix: Use only RS256 or ES256 (RFC 8725 compliance)
```

**Error:** `Missing required field: issuer`
```
✅ Fix: Add "issuer" field to IDP configuration
```

### Manual Validation

Use `ConfigManager.validateConfig()` to validate configuration before starting server:

```typescript
import { ConfigManager } from 'fastmcp-oauth-obo';

const configManager = new ConfigManager();
try {
  await configManager.loadConfig('./config.json');
  console.log('✅ Configuration valid');
} catch (error) {
  console.error('❌ Configuration invalid:', error.message);
}
```

---

## See Also

- **[MULTI-SERVER.md](MULTI-SERVER.md)** - Multi-server deployment patterns
- **[TOOL-FACTORIES.md](TOOL-FACTORIES.md)** - Tool creation and prefixing
- **[EXTENDING.md](EXTENDING.md)** - Custom delegation modules
- **[README.md](../README.md)** - Framework overview

---

**Questions?** Open an issue at https://github.com/your-org/mcp-oauth-framework/issues
