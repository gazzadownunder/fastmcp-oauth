# Configuration Reference Guide

Complete reference for `config.json` configuration options in the MCP OAuth framework.

## Table of Contents

- [Overview](#overview)
- [Critical Requirements](#critical-requirements)
- [Authorization Methods](#authorization-methods)
- [Secret Management (v3.2+)](#secret-management-v32)
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

**Location:** Typically `config/unified-config.json` or specified via `FastMCPOAuthServer(configPath)`

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

**Why?** The `FastMCPAuthMiddleware` is hardcoded to use `"requestor-jwt"` when validating incoming requests ([src/mcp/middleware.ts:113](../src/mcp/middleware.ts#L113)):

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

## Authorization Methods

The framework supports **two complementary authorization methods** for controlling access to MCP tools:

### 1. Role-Based Access Control (RBAC)

**Purpose:** Coarse-grained access control using role assignments

**How it works:**
1. JWT contains role claims (e.g., `"user_roles": ["admin", "developer"]`)
2. `claimMappings.roles` extracts roles from JWT → `session.customRoles`
3. `roleMappings` translates JWT roles to framework roles (admin/user/guest) → `session.role`
4. Tools check `session.role` for access (e.g., `requireRole(context, 'admin')`)

**Configuration Example:**
```json
{
  "auth": {
    "trustedIDPs": [{
      "name": "requestor-jwt",
      "claimMappings": {
        "roles": "user_roles"                    // Extract from JWT claim
      },
      "roleMappings": {                          // Translate to framework roles
        "admin": ["admin", "administrator"],
        "user": ["developer", "member"],
        "guest": [],
        "defaultRole": "guest"
      }
    }]
  }
}
```

**Use Cases:**
- ✅ Admin-only tools (delete operations, system configuration)
- ✅ User-tier features (read/write operations)
- ✅ Guest access (read-only operations)

### 2. Scope-Based Access Control (OAuth 2.1 Scopes)

**Purpose:** Fine-grained access control using OAuth scopes

**How it works:**
1. JWT contains scope claims (e.g., `"scopes": "sql:read sql:write api:invoke"`)
2. `claimMappings.scopes` extracts scopes from JWT → `session.scopes`
3. Tools check specific scopes (e.g., `requireScope(context, 'sql:write')`)

**Configuration Example:**
```json
{
  "auth": {
    "trustedIDPs": [{
      "name": "requestor-jwt",
      "claimMappings": {
        "scopes": "authorized_scopes"            // Extract from JWT claim
      }
    }]
  }
}
```

**JWT Example:**
```json
{
  "sub": "user123",
  "authorized_scopes": "mcp:read mcp:write sql:read sql:execute api:invoke"
}
```

**Result:** `session.scopes = ["mcp:read", "mcp:write", "sql:read", "sql:execute", "api:invoke"]`

**Use Cases:**
- ✅ Fine-grained SQL access (`sql:read` vs `sql:write` vs `sql:admin`)
- ✅ API-specific permissions (`api:invoke`, `api:configure`)
- ✅ Resource-specific access (`resource:database1:read`, `resource:database2:write`)

### Combining Both Methods

**Best Practice:** Use both methods together for defense-in-depth:

```json
{
  "auth": {
    "trustedIDPs": [{
      "name": "requestor-jwt",
      "claimMappings": {
        "roles": "user_roles",                   // RBAC
        "scopes": "authorized_scopes"            // Permissions
      },
      "roleMappings": {
        "admin": ["admin"],
        "user": ["user", "developer"],
        "guest": []
      }
    }]
  }
}
```

**Tool Authorization Example:**
```typescript
// Requires BOTH admin role AND sql:admin scope
auth.requireRole(context, 'admin');
auth.requireScope(context, 'sql:admin');
```

**Comparison:**

| Aspect | Role-Based (RBAC) | Scope-Based (OAuth 2.1) |
|--------|------------------|---------------------------|
| **Granularity** | Coarse (3-5 roles) | Fine (unlimited scopes) |
| **Configuration** | `roleMappings` required | No additional config |
| **JWT Claim** | `roles` array | `scopes` string or array |
| **Session Property** | `session.role`, `session.customRoles` | `session.scopes` |
| **Check Method** | `requireRole()`, `hasRole()` | `requireScope()`, `hasScope()` |
| **Use Case** | User tier separation | Feature-specific access |
| **Example** | `admin`, `user`, `guest` | `sql:read`, `sql:write`, `api:invoke` |

**When to Use Each:**

- **RBAC only:** Simple applications with clear user tiers (admin/user/guest)
- **Scopes only:** Microservices with fine-grained OAuth scopes
- **Both (recommended):** Enterprise applications requiring defense-in-depth

---

## Secret Management (v3.2+)

**NEW:** The framework now supports **Dynamic Secret Resolution** to eliminate hardcoded credentials from configuration files.

### Overview

Instead of storing sensitive values as plaintext in configuration files:

```json
{
  "password": "MyPassword123!",           // ❌ Hardcoded secret
  "clientSecret": "abc123xyz"             // ❌ Committed to Git
}
```

Use **secret descriptors** that reference logical names:

```json
{
  "password": { "$secret": "DB_PASSWORD" },           // ✅ Logical name
  "clientSecret": { "$secret": "OAUTH_CLIENT_SECRET" } // ✅ Resolved at runtime
}
```

### Benefits

✅ **No secrets in Git** - Config files contain logical names only
✅ **Production-ready** - Kubernetes/Docker secret mounts supported
✅ **Fail-fast security** - Server won't start with missing secrets
✅ **Audit logging** - Track which provider resolved each secret
✅ **Zero code changes** - Works with existing FastMCPOAuthServer
✅ **Backward compatible** - Plain strings still supported

### Secret Descriptor Format

A secret descriptor is a JSON object with a single `$secret` property:

```json
{
  "$secret": "LOGICAL_SECRET_NAME"
}
```

**Rules:**
- Secret name must be non-empty string
- Secret names are **user-defined** (no predefined names required)
- Can be used anywhere a sensitive string is expected

### Resolution Flow

```
Configuration File ({"$secret": "NAME"})
         ↓
   SecretResolver
         ↓
FileSecretProvider → Check /run/secrets/NAME (Kubernetes/Docker)
         ↓
   EnvProvider → Check process.env.NAME (development)
         ↓
 Fail-Fast → Server exits if secret not found
```

### Provider Priority

Secrets are resolved in this order:

1. **FileSecretProvider** (highest priority)
   - Location: `/run/secrets/{SECRET_NAME}`
   - Use case: Production (Kubernetes, Docker)
   - Security: ✅ Best (file permissions, no process leakage)

2. **EnvProvider** (fallback)
   - Location: `process.env[SECRET_NAME]`
   - Use case: Development, testing
   - Security: ⚠️ Lower (visible in process list)

3. **Fail-Fast** (if not found)
   - Server exits with error message
   - Forces explicit secret configuration

### Configuration Examples

#### PostgreSQL Password

```json
{
  "delegation": {
    "modules": {
      "postgresql": {
        "host": "db.company.com",
        "database": "app_db",
        "user": "mcp_service",
        "password": { "$secret": "POSTGRESQL_PASSWORD" }
      }
    }
  }
}
```

#### OAuth Client Secrets

```json
{
  "delegation": {
    "modules": {
      "postgresql": {
        "tokenExchange": {
          "clientId": "mcp-server",
          "clientSecret": { "$secret": "OAUTH_CLIENT_SECRET" }
        }
      }
    }
  }
}
```

#### Kerberos Service Account

```json
{
  "delegation": {
    "modules": {
      "kerberos": {
        "serviceAccount": {
          "username": "svc-mcp-server",
          "password": { "$secret": "KERBEROS_SERVICE_PASSWORD" }
        }
      }
    }
  }
}
```

### Development Setup

**Option 1: Environment Variables**

```bash
# Linux/macOS
export POSTGRESQL_PASSWORD="MyPassword123!"
export OAUTH_CLIENT_SECRET="abc123xyz"

# Windows PowerShell
$env:POSTGRESQL_PASSWORD="MyPassword123!"
$env:OAUTH_CLIENT_SECRET="abc123xyz"

# Windows CMD
set POSTGRESQL_PASSWORD=MyPassword123!
set OAUTH_CLIENT_SECRET=abc123xyz
```

**Option 2: .env File (recommended)**

Create `.env` file:
```bash
POSTGRESQL_PASSWORD=MyPassword123!
OAUTH_CLIENT_SECRET=abc123xyz
```

⚠️ **IMPORTANT:** Add `.env` to `.gitignore`!

### Production Setup (Kubernetes)

**Step 1: Create Secrets**

```bash
kubectl create secret generic mcp-postgresql \
  --from-literal=password='MyPassword123!' \
  --from-literal=oauth-client-secret='abc123xyz'
```

**Step 2: Mount in Deployment**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mcp-oauth-server
spec:
  template:
    spec:
      containers:
      - name: mcp-server
        image: mcp-oauth:3.2
        volumeMounts:
        - name: postgresql-secrets
          mountPath: /run/secrets
          readOnly: true
      volumes:
      - name: postgresql-secrets
        secret:
          secretName: mcp-postgresql
          items:
          - key: password
            path: POSTGRESQL_PASSWORD
          - key: oauth-client-secret
            path: OAUTH_CLIENT_SECRET
```

**How It Works:**
1. Kubernetes mounts secrets as files in `/run/secrets/`
2. FileSecretProvider reads `/run/secrets/POSTGRESQL_PASSWORD`
3. No environment variables needed (more secure)

### Finding Required Secrets

Your required secrets depend entirely on your configuration. To find them:

**Method 1: Search Config File**

```bash
# Linux/macOS
grep -o '"$secret":\s*"[^"]*"' config.json

# Windows PowerShell
Select-String -Path config.json -Pattern '\$secret'
```

**Method 2: Check Error Messages**

If a secret is missing, the server will exit with:
```
❌ [SecretResolver] Secret "DB_PASSWORD" at path "config.delegation.modules.postgresql.password" could not be resolved by any provider.
```

The error tells you:
- Secret name: `DB_PASSWORD`
- Config location: `delegation.modules.postgresql.password`

### Troubleshooting

**Error: Secret could not be resolved**

```
[SecretResolver] Secret "DB_PASSWORD" could not be resolved
```

**Solution:**
1. Check which secret is missing from error message
2. Search config for `{"$secret": "DB_PASSWORD"}`
3. Set the secret:
   ```bash
   export DB_PASSWORD="actual_password"
   # or
   echo "actual_password" > /run/secrets/DB_PASSWORD
   ```

**Error: Config file valid but database connection fails**

**Cause:** Secret contains wrong value or extra whitespace

**Solution:**
- Secrets are automatically trimmed
- Verify secret value matches actual credential
- Check database logs for authentication errors

### Security Best Practices

**✅ DO:**
- Use Kubernetes secrets for production
- Use `/run/secrets/` file mounts (most secure)
- Add `.env` to `.gitignore`
- Rotate secrets regularly
- Use different secrets for dev/test/prod
- Monitor audit logs for secret access

**❌ DON'T:**
- Commit `.env` to version control
- Use hardcoded secrets in config files
- Share secrets in Slack/email
- Use production secrets in development
- Log secret values (automatically sanitized)

### Migration from Hardcoded Secrets

**Before (v3.1 and earlier):**
```json
{
  "password": "MyPassword123!",
  "clientSecret": "${OAUTH_SECRET}"
}
```

**After (v3.2+):**
```json
{
  "password": { "$secret": "DB_PASSWORD" },
  "clientSecret": { "$secret": "OAUTH_CLIENT_SECRET" }
}
```

**Migration Steps:**
1. Identify all sensitive fields in config
2. Replace values with secret descriptors
3. Set secrets as environment variables or files
4. Test that server starts successfully
5. Remove old plaintext secrets from Git history

### Supported Fields

Secret descriptors work with **any string field** in the configuration. Common fields:

| Configuration Path | Field | Example Secret Name |
|-------------------|-------|---------------------|
| `delegation.modules.*.password` | Database password | `POSTGRESQL_PASSWORD` |
| `delegation.modules.*.tokenExchange.clientSecret` | OAuth client secret | `OAUTH_CLIENT_SECRET` |
| `delegation.modules.kerberos.serviceAccount.password` | Kerberos password | `KERBEROS_PASSWORD` |
| Custom module fields | Any sensitive field | User-defined |

**Note:** Secret names are **configuration-dependent**. There are no "required" secrets at the framework level - only those defined in your specific configuration.

### Additional Resources

- [SECRETS-MANAGEMENT.md](SECRETS-MANAGEMENT.md) - Full implementation guide
- [test-harness/SECRETS-SETUP.md](../test-harness/SECRETS-SETUP.md) - Test server setup guide
- [examples/server-with-secrets.ts](../examples/server-with-secrets.ts) - Example code

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
    return context.session?.scopes?.includes('sql:read');
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

The framework extracts JWT claims and maps them to a `UserSession` object using `claimMappings`.

> **📖 See Also:** [Authorization Methods](#authorization-methods) section explains the two complementary authorization approaches (RBAC and Permissions)

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
| `{ "user_roles": ["admin", "user"] }` | `roles: "user_roles"` | `session.customRoles = ["admin", "user"]` | **RBAC Authorization** |
| `{ "authorized_scopes": "sql:read sql:write" }` | `scopes: "authorized_scopes"` | `session.scopes = ["sql:read", "sql:write"]` | **Scope-Based Authorization** |

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
          "legacyUsername": "string",          // Required: JWT claim for legacy username
          "roles": "string",                   // Required: JWT claim for roles
          "scopes": "string",                  // Optional: JWT claim for scopes
          "userId": "string",                  // Optional: JWT claim for user ID (default: "sub")
          "username": "string"                 // Optional: JWT claim for username (default: "preferred_username")
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
      "enabled": true,                         // Optional: Enable audit logging (default: true)
      "logAllAttempts": true,                  // Optional: Log all auth attempts
      "logFailedAttempts": true,               // Optional: Log failed attempts (default: true)
      "retentionDays": 90                      // Optional: Log retention period
    }
  }
}
```

### Auth Field Descriptions

#### trustedIDPs

Array of identity providers trusted by the framework.

**Field: name** (string, optional but recommended)
- **Purpose:** Identifier for this IDP configuration for explicit IDP selection
- **Requestor IDP:** Convention is `"requestor-jwt"` (used by FastMCPAuthMiddleware)
- **Delegation IDPs:** Can be any name (e.g., `"sql-db-idp"`, `"analytics-idp"`)
- **Fallback Behavior:** If omitted, IDP matching falls back to issuer + audience matching only
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

**Field: claimMappings** (object, required)
- **Purpose:** Map JWT claims to session properties for authentication and authorization
- **Subfields:**
  - `legacyUsername` (string, **required**): JWT claim containing legacy username (e.g., "DOMAIN\\user")
  - `roles` (string, **required**): JWT claim containing user roles for **RBAC authorization** (supports nested paths like "realm_access.roles") → Maps to `session.customRoles` and `session.role`
  - `scopes` (string, optional): JWT claim containing OAuth scopes for **scope-based authorization** → Maps to `session.scopes`
  - `userId` (string, optional): JWT claim for unique user ID (defaults to "sub" if omitted)
  - `username` (string, optional): JWT claim for username (defaults to "preferred_username" if omitted)
- **Authorization:** See [Authorization Methods](#authorization-methods) for details on RBAC (roles) vs Permission-based (scopes) access control
- **Example:**
  ```json
  "claimMappings": {
    "legacyUsername": "legacy_sam_account",
    "roles": "user_roles",
    "scopes": "scopes",
    "userId": "sub",
    "username": "preferred_username"
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
- **Purpose:** Maps JWT role values to framework roles **for this specific IDP**
- **Location:** Inside each `trustedIDPs[]` object (NOT at global auth level)
- **Why per-IDP:** Different IDPs may use different role naming conventions or require different access levels
- **Flexible Role Support:** The schema uses `.passthrough()` allowing **custom role names beyond admin/user/guest**
- **Standard Subfields:**
  - `admin` (string[]): JWT role values that map to admin role (default: `["admin", "administrator"]`)
  - `user` (string[]): JWT role values that map to user role (default: `["user"]`)
  - `guest` (string[]): JWT role values that map to guest role (default: `[]`)
  - `defaultRole` (string): Fallback role for unmapped values - "admin", "user", or "guest" (default: `"guest"`)
  - `rejectUnmappedRoles` (boolean): Reject authentication if JWT roles don't match any mapping (default: `false`)
- **Custom Roles:** You can add arbitrary role mappings (e.g., `"auditor"`, `"writer"`, `"manager"`) by adding additional fields
- **Example with Custom Roles:**
  ```json
  "roleMappings": {
    "admin": ["admin", "employee_admin"],
    "user": ["user", "employee"],
    "guest": [],
    "auditor": ["compliance_auditor", "security_auditor"],
    "writer": ["content_writer", "editor"],
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

**Field: logFailedAttempts** (boolean, optional)
- **Purpose:** Log failed authentication attempts
- **Default:** `true`
- **Example:** `"logFailedAttempts": true`

**Field: retentionDays** (number, optional)
- **Purpose:** Log retention period in days
- **Default:** `90`
- **Example:** `"retentionDays": 30`

---

## Delegation Section

### Complete Delegation Schema

```json
{
  "delegation": {
    "defaultToolPrefix": "sql",              // Optional: Default tool prefix (v2.2.0+)
    "modules": {
      "postgresql": {                        // Module name (used for createSQLToolsForModule)
        "toolPrefix": "hr-sql",              // Optional: Tool prefix override (v2.2.0+)
        "type": "postgresql",                // Optional: Database type
        "host": "string",                    // Required: Database host (PostgreSQL/MySQL)
        "server": "string",                  // Required: Database server (MSSQL only)
        "port": 5432,                        // Optional: Database port
        "database": "string",                // Required: Database name
        "user": "string",                    // Optional: Database username
        "password": "string",                // Optional: Database password
        "options": {
          "trustedConnection": false,        // Optional: Use Windows auth (MSSQL only)
          "encrypt": true,                   // Optional: Require TLS
          "enableArithAbort": true,          // Optional: Enable ARITHABORT (MSSQL)
          "trustServerCertificate": false    // Optional: Trust self-signed certs
        },
        "tokenExchange": {                   // Optional: Per-database token exchange
          "idpName": "string",               // Required: IDP name from trustedIDPs
          "tokenEndpoint": "string",         // Required: Token endpoint URL
          "clientId": "string",              // Required: Client ID
          "clientSecret": "string | SecretDescriptor",  // Required: Client secret (use {"$secret": "NAME"})
          "audience": "string",              // Optional: Target audience
          "scope": "string"                  // Optional: Requested scopes
        }
      }
    }
  }
}
```

### Delegation Field Descriptions

#### defaultToolPrefix (v2.2.0+)

Automatic tool registration with configurable prefixes!

**Purpose:** Sets the default tool name prefix for all delegation modules that don't specify their own `toolPrefix`.

**Type:** string (optional)

**Default:** `"sql"`

**Validation:**
- Must start with a lowercase letter
- Can contain lowercase letters, numbers, and hyphens only
- Maximum 20 characters
- Regex: `^[a-z][a-z0-9-]*$`

**Example:**
```json
{
  "delegation": {
    "defaultToolPrefix": "db"  // All modules use "db-*" unless overridden
  }
}
```

**When to Use:**
- Multi-module deployments where most modules share a common prefix
- Single-module deployments (optional, defaults to "sql")

**Backward Compatibility:**
- If not specified, defaults to `"sql"` (maintains backward compatibility)
- Existing configurations without this field continue to work unchanged

---

#### modules

Object containing delegation module configurations. Keys are module names used by `DelegationRegistry.delegate(moduleName, ...)`.

**Module Name Convention:**
- Single database: `"sql"` or `"postgresql"` or `"mssql"`
- Multiple databases: `"postgresql1"`, `"postgresql2"` or `"hr-db"`, `"sales-db"`
- Use descriptive names for tool prefix generation

**NEW (v2.2.0+): Automatic Tool Registration:**

Each module can now include a `toolPrefix` field to enable automatic tool registration:

```json
{
  "delegation": {
    "defaultToolPrefix": "sql",
    "modules": {
      "postgresql1": {
        "toolPrefix": "hr-sql",  // ← Auto-registers hr-sql-delegate, hr-sql-schema, hr-sql-table-details
        "host": "localhost",
        "database": "hr_database"
      },
      "rest-api1": {
        "toolPrefix": "internal-api",  // ← Auto-registers internal-api-delegate, internal-api-health
        "baseUrl": "https://api.internal.com"
      }
    }
  }
}
```

**Benefits:**
- **85% code reduction** - No manual tool registration needed
- **Configuration-only updates** - Change tool names without code changes
- **Consistent naming** - Schema validation enforces naming conventions
- **All module types supported** - SQL, REST API, Kerberos, and future modules

**Before (Manual Registration - 100+ lines):**
```typescript
const coreContext = server.getCoreContext();
const sqlTools = createSQLToolsForModule({
  toolPrefix: 'hr-sql',
  moduleName: 'postgresql1',
});
server.registerTools(sqlTools.map(factory => factory(coreContext)));
// ... repeat for each module
```

**After (Auto-Registration - 15 lines):**
```typescript
const server = new FastMCPOAuthServer(CONFIG_PATH);
await server.start({ transport: 'httpStream', port: 3000 });
// Tools auto-registered from config!
```

See [examples/multi-module-auto-registration.ts](../examples/multi-module-auto-registration.ts) for a complete example

**SQL Module Fields:**

**Field: toolPrefix** (string, optional) 
- **Purpose:** Tool name prefix for this module (enables automatic tool registration)
- **Overrides:** `delegation.defaultToolPrefix` if specified
- **Validation:** Same as `defaultToolPrefix` (lowercase letters, numbers, hyphens; max 20 chars)
- **Example:** `"toolPrefix": "hr-sql"`
- **Result:** Generates tools: `hr-sql-delegate`, `hr-sql-schema`, `hr-sql-table-details`
- **When omitted:** No automatic registration (use manual `createSQLToolsForModule()`)

**Field: type** (string, optional)
- **Purpose:** Database type identifier
- **Allowed Values:** `"postgresql"`, `"mssql"`, `"mysql"`
- **Example:** `"type": "postgresql"`

**Field: host** (string, required for PostgreSQL/MySQL)
- **Purpose:** Database server hostname or IP (PostgreSQL/MySQL use `host`)
- **Example:** `"host": "db.company.com"`
- **Note:** MSSQL uses `server` field instead (see below)

**Field: server** (string, required for MSSQL)
- **Purpose:** SQL Server hostname or IP (MSSQL-specific field name)
- **Example:** `"server": "sql.company.com"`
- **Note:** PostgreSQL/MySQL use `host` field instead (see above)

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

**Field: password** (string | SecretDescriptor, optional)
- **Purpose:** Database password for authentication
- **Security:** Use secret descriptors for production deployments (v3.2+)
- **Formats:**
  - Plain string (deprecated): `"password": "mypassword"` ❌ Not recommended
  - Environment variable (legacy): `"password": "${DB_PASSWORD}"` ⚠️ Deprecated syntax
  - **Secret descriptor (recommended):** `"password": { "$secret": "DB_PASSWORD" }` ✅ Secure
- **Example:** `"password": { "$secret": "POSTGRESQL_PASSWORD" }`
- **See:** [Secret Management](#secret-management-v32) above

**Field: options** (object, optional)
- **Purpose:** Database-specific connection options
- **Subfields:**
  - `trustedConnection` (boolean): Use Windows authentication (MSSQL only, default: true)
  - `encrypt` (boolean): Require TLS encryption (default: true)
  - `enableArithAbort` (boolean): Enable ARITHABORT setting (MSSQL only, default: true)
  - `trustServerCertificate` (boolean): Trust self-signed certificates (default: false)
  - `connectionTimeout` (number): Connection timeout in milliseconds
- **Example:**
  ```json
  "options": {
    "trustedConnection": true,
    "encrypt": true,
    "enableArithAbort": true,
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
    "oauth": {                               // Optional: OAuth metadata configuration
      "scopes": ["mcp:read", "mcp:write"],   // Optional: Advertised OAuth scopes
      "protectedResource": true,             // Optional: Include protected resource in WWW-Authenticate header (default: true)
      "registrationEndpoint": "string"       // Optional: RFC 7591 Dynamic Client Registration endpoint
    },
    "enabledTools": {                        // Optional: Tool enable/disable map
      "sql-delegate": true,
      "health-check": true,
      "user-info": true
    }
  }
}
```

### MCP Field Descriptions

**Field: serverName** (string, optional)
- **Purpose:** Server display name shown to MCP clients
- **Default:** `"MCP OAuth Server"` (hardcoded in FastMCPOAuthServer)
- **Example:** `"serverName": "HR Database MCP Server"`

**Field: version** (string, optional)
- **Purpose:** Server version (semantic versioning)
- **Default:** `"2.0.0"` (hardcoded in FastMCPOAuthServer)
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

**Field: oauth** (object, optional)
- **Purpose:** OAuth metadata configuration for the MCP server
- **Subfields:**
  - `scopes` (string[]): OAuth scopes to advertise in protected resource metadata
  - `protectedResource` (boolean): Include protected resource metadata in WWW-Authenticate header (default: `true`)
  - `registrationEndpoint` (string): RFC 7591 Dynamic Client Registration endpoint URL
- **Example:**
  ```json
  "oauth": {
    "scopes": ["mcp:read", "mcp:write", "mcp:admin"],
    "protectedResource": true,
    "registrationEndpoint": "https://auth.company.com/register"
  }
  ```

**Field: oauth.scopes** (string[], optional)
- **Purpose:** List of OAuth scopes supported by this MCP server
- **Usage:** Advertised in OAuth Protected Resource Metadata and used by clients for authorization
- **Example:** `"scopes": ["mcp:read", "mcp:write", "sql:query"]`

**Field: oauth.protectedResource** (boolean, optional)
- **Purpose:** Control whether authorization server information is included in WWW-Authenticate header on 401 responses
- **Default:** `true` (enabled by default, must be explicitly disabled)
- **Behavior:**
  - When `true` (default): WWW-Authenticate header includes authorization server information
    ```
    WWW-Authenticate: Bearer realm="MCP Server", authorization_server="https://auth.example.com"
    ```
  - When `false`: WWW-Authenticate header includes only realm (minimal RFC 6750 format)
    ```
    WWW-Authenticate: Bearer realm="MCP Server"
    ```
- **When to disable:**
  - Security requirement to not expose IDP information in response headers
  - Client applications perform OAuth discovery through other means
  - Reduced header size requirements
- **Example:**
  ```json
  "oauth": {
    "protectedResource": false  // Disable authorization server in WWW-Authenticate header
  }
  ```

**Field: oauth.registrationEndpoint** (string, optional)
- **Purpose:** RFC 7591 Dynamic Client Registration endpoint URL
- **Usage:** Advertised in `/.well-known/oauth-authorization-server` metadata response to enable clients to dynamically register
- **Format:** HTTPS URL (HTTP allowed in development/test mode only)
- **Validation:** Must be valid URL; HTTPS required in production (`NODE_ENV !== 'development' && NODE_ENV !== 'test'`)
- **RFC Compliance:** RFC 7591 (OAuth 2.0 Dynamic Client Registration Protocol), RFC 8414 (Authorization Server Metadata)
- **Behavior:**
  - When configured: `registration_endpoint` field appears in authorization server metadata
  - When omitted: Field not included in metadata (standard behavior for servers without DCR support)
- **Example:**
  ```json
  "oauth": {
    "registrationEndpoint": "https://auth.company.com/register"
  }
  ```
- **Metadata Response Example:**
  ```json
  {
    "issuer": "https://auth.company.com",
    "authorization_endpoint": "https://auth.company.com/protocol/openid-connect/auth",
    "token_endpoint": "https://auth.company.com/protocol/openid-connect/token",
    "jwks_uri": "https://auth.company.com/.well-known/jwks.json",
    "registration_endpoint": "https://auth.company.com/register",
    "response_types_supported": ["code"],
    "grant_types_supported": ["authorization_code"],
    ...
  }
  ```
- **Use Cases:**
  - Enable MCP clients to dynamically register without manual configuration
  - Support multi-tenant deployments where clients register on-demand
  - Facilitate automated client onboarding workflows
- **Security Notes:**
  - The MCP server only advertises this endpoint; it does NOT implement the registration handler
  - Actual client registration logic must be implemented by your IDP or authorization server
  - Ensure proper authentication/authorization on the registration endpoint to prevent unauthorized client registration

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

### Example 1: Single Database with Basic Auth (v3.2+ with Secret Management)

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
        "password": { "$secret": "POSTGRESQL_PASSWORD" },
        "options": {
          "encrypt": true
        }
      }
    }
  },
  "mcp": {
    "serverName": "Company Database Server",
    "version": "1.0.0",
    "port": 3000,
    "oauth": {
      "scopes": ["mcp:read", "mcp:write"],
      "protectedResource": true,
      "registrationEndpoint": "https://auth.company.com/register"
    }
  }
}
```

**Required Environment Variables / Files:**
- `POSTGRESQL_PASSWORD` - Database password for `mcp_service` user

### Example 2: Multi-Database with Token Exchange (v3.2+ with Secret Management)

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
          "clientSecret": { "$secret": "PRIMARY_DB_OAUTH_SECRET" },
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
          "clientSecret": { "$secret": "ANALYTICS_DB_OAUTH_SECRET" },
          "audience": "analytics-db",
          "scope": "openid profile analytics:read"
        }
      }
    }
  },
  "mcp": {
    "serverName": "Multi-Database MCP Server",
    "version": "2.0.0",
    "oauth": {
      "scopes": ["mcp:read", "mcp:write", "sql:read", "sql:write"],
      "protectedResource": true,
      "registrationEndpoint": "https://auth.company.com/register"
    },
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
- ✅ **Secure secret management** with secret descriptors
- ✅ Prefixed SQL tools (`sql1-delegate`, `sql2-delegate`)
- ✅ **OAuth metadata** with advertised scopes and protected resource configuration

**Required Environment Variables / Files:**
- `PRIMARY_DB_OAUTH_SECRET` - OAuth client secret for primary database IDP
- `ANALYTICS_DB_OAUTH_SECRET` - OAuth client secret for analytics database IDP

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

**Questions?** Open an issue at https://github.com/your-org/fastmcp-oauth/issues
