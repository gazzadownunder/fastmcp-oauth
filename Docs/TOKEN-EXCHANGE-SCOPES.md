# Token Exchange Scopes (RFC 8693)

## Overview

The framework now supports the `scope` parameter in OAuth 2.0 Token Exchange requests (RFC 8693 Section 2.1). This allows you to request specific OAuth scopes when exchanging tokens, enabling fine-grained authorization control per database or delegation module.

## Configuration

### Per-Module Scope Configuration

Each delegation module can specify which scopes to request during token exchange:

```json
{
  "delegation": {
    "modules": {
      "postgresql1": {
        "host": "primary-db.example.com",
        "database": "app_db",
        "tokenExchange": {
          "tokenEndpoint": "https://auth.example.com/token",
          "clientId": "mcp-server-client",
          "clientSecret": "SECRET",
          "audience": "mcp-server-client",
          "scope": "openid profile sql:read sql:write"
        }
      },
      "postgresql2": {
        "host": "analytics-db.example.com",
        "database": "analytics",
        "tokenExchange": {
          "tokenEndpoint": "https://auth.example.com/token",
          "clientId": "analytics-client",
          "clientSecret": "SECRET",
          "audience": "analytics-client",
          "scope": "openid profile analytics:read"
        }
      }
    }
  }
}
```

## Scope Format

The `scope` parameter is a **space-separated list** of OAuth scope values, as defined in RFC 6749 Section 3.3:

```
scope = "scope1 scope2 scope3"
```

### Standard OpenID Connect Scopes

- `openid` - Indicates this is an OpenID Connect request
- `profile` - Access to user's profile information
- `email` - Access to user's email address
- `address` - Access to user's address
- `phone` - Access to user's phone number

### Custom Application Scopes

Define scopes that match your application's authorization model:

- `sql:read` - Read-only SQL access
- `sql:write` - SQL write operations
- `sql:admin` - SQL administrative operations
- `analytics:read` - Analytics database read access
- `analytics:export` - Export analytics data
- `api:read` - API read operations
- `api:write` - API write operations

## Use Cases

### 1. Read-Only Analytics Database

Restrict analytics database access to read-only operations:

```json
{
  "postgresql_analytics": {
    "database": "analytics",
    "tokenExchange": {
      "scope": "openid profile analytics:read",
      "audience": "analytics-db"
    }
  }
}
```

The exchanged token will only contain `analytics:read` scope, preventing write operations even if the user has broader permissions elsewhere.

### 2. Privilege Elevation

Request elevated privileges for primary database:

```json
{
  "postgresql_primary": {
    "database": "app_db",
    "tokenExchange": {
      "scope": "openid profile sql:read sql:write sql:admin",
      "audience": "primary-db"
    }
  }
}
```

### 3. Privilege Reduction

Reduce user's privileges for specific databases:

```json
{
  "postgresql_staging": {
    "database": "staging",
    "tokenExchange": {
      "scope": "openid profile sql:read",
      "audience": "staging-db"
    }
  }
}
```

Even if the user has `admin` role, the exchanged token only grants `sql:read` scope.

### 4. Multi-Tenant Isolation

Separate scopes per tenant database:

```json
{
  "postgresql_tenant1": {
    "database": "tenant1_db",
    "tokenExchange": {
      "scope": "openid tenant1:read tenant1:write",
      "audience": "tenant1-db"
    }
  },
  "postgresql_tenant2": {
    "database": "tenant2_db",
    "tokenExchange": {
      "scope": "openid tenant2:read",
      "audience": "tenant2-db"
    }
  }
}
```

## Token Exchange Request

When configured with a scope, the framework sends the following request to the IDP:

```http
POST /realms/mcp_security/protocol/openid-connect/token HTTP/1.1
Host: auth.example.com
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:token-exchange
&subject_token=eyJhbGc...  (requestor's JWT)
&subject_token_type=urn:ietf:params:oauth:token-type:access_token
&audience=mcp-server-client
&client_id=mcp-server-client
&client_secret=SECRET
&scope=openid profile sql:read sql:write
```

## Token Exchange Response

The IDP returns a token with the requested (or downscoped) scopes:

```json
{
  "access_token": "eyJhbGc...",
  "token_type": "Bearer",
  "expires_in": 300,
  "scope": "openid profile sql:read sql:write",
  "issued_token_type": "urn:ietf:params:oauth:token-type:access_token"
}
```

The `scope` in the response indicates which scopes were actually granted (may be less than requested if IDP policy restricts access).

## Keycloak Configuration

### Step 1: Define Client Scopes

In Keycloak Admin Console:

1. Navigate to **Client Scopes** → **Create**
2. Create custom scopes:
   - `sql:read` - Description: "Read-only SQL access"
   - `sql:write` - Description: "SQL write operations"
   - `sql:admin` - Description: "SQL administrative operations"
   - `analytics:read` - Description: "Analytics read access"

### Step 2: Assign Scopes to Client

For each client (`mcp-server-client`, `second_sql`, etc.):

1. Navigate to **Clients** → **[client-id]** → **Client Scopes**
2. Add the custom scopes to **Assigned Optional Client Scopes**
3. Configure scope mappers to include scope claim in tokens

### Step 3: Configure Scope Mappers

Create a protocol mapper to include scopes in the token:

1. Navigate to **Client Scopes** → **[scope-name]** → **Mappers**
2. **Create** → **Audience**
   - Name: `audience`
   - Included Client Audience: `[client-id]`
   - Add to access token: ON

### Step 4: Test Token Exchange

```bash
# Get requestor JWT
REQUESTOR_JWT=$(curl -X POST http://auth.example.com/token \
  -d "grant_type=password" \
  -d "client_id=mcp-oauth" \
  -d "username=alice" \
  -d "password=alice123" \
  | jq -r '.access_token')

# Exchange with scope
curl -X POST http://auth.example.com/token \
  -d "grant_type=urn:ietf:params:oauth:grant-type:token-exchange" \
  -d "subject_token=$REQUESTOR_JWT" \
  -d "subject_token_type=urn:ietf:params:oauth:token-type:access_token" \
  -d "audience=mcp-server-client" \
  -d "client_id=mcp-server-client" \
  -d "client_secret=SECRET" \
  -d "scope=openid profile sql:read sql:write" \
  | jq
```

## Authorization Logic

### Framework Behavior

The framework passes the `scope` parameter to the IDP but **does not enforce** scope-based authorization itself. Authorization is handled by:

1. **IDP Policy** - IDP determines which scopes to grant based on:
   - User's roles and permissions
   - Client configuration
   - Resource policies

2. **Delegation Module** - Can check scopes in exchanged token:
   ```typescript
   const claims = tokenExchangeService.decodeTokenClaims(delegationToken);
   if (!claims.scope?.includes('sql:write')) {
     throw new Error('Write operations require sql:write scope');
   }
   ```

3. **Backend Resource** - PostgreSQL roles, file permissions, API authorization

### Scope Enforcement Example

If you want to enforce scope-based authorization in your delegation module:

```typescript
// In PostgreSQL delegation module
async delegate(session, action, params, context) {
  // Perform token exchange with scope
  const teJWT = await tokenExchangeService.performExchange({
    requestorJWT: session.claims.access_token,
    tokenEndpoint: config.tokenEndpoint,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    audience: config.audience,
    scope: 'openid profile sql:read sql:write',  // Request scopes
    sessionId: context.sessionId,
  });

  // Decode and check granted scopes
  const claims = tokenExchangeService.decodeTokenClaims(teJWT);
  const grantedScopes = claims.scope?.split(' ') || [];

  // Enforce scope-based authorization
  if (action === 'write' && !grantedScopes.includes('sql:write')) {
    throw new Error('Forbidden: sql:write scope required for write operations');
  }

  // Proceed with delegation
  await executeQuery(params.sql, params.params);
}
```

## Best Practices

### 1. Use Specific Scopes

❌ **Bad:**
```json
{ "scope": "openid" }
```

✅ **Good:**
```json
{ "scope": "openid profile sql:read sql:write" }
```

### 2. Follow Principle of Least Privilege

Grant only the minimum scopes needed:

- **Analytics DB** → `analytics:read` (no write)
- **Reporting DB** → `reports:read reports:export`
- **Primary DB** → `sql:read sql:write` (only if needed)

### 3. Separate Scopes by Resource

Use resource-specific scope naming:

- `primary:read` / `primary:write` (primary database)
- `analytics:read` (analytics database)
- `staging:read` (staging database)

### 4. Document Scope Requirements

Clearly document which scopes are required for each tool:

```json
{
  "mcp": {
    "enabledTools": {
      "sql1-delegate": true,
      "sql2-delegate": true,
      "_comment": "sql1-delegate requires: sql:read sql:write",
      "_comment2": "sql2-delegate requires: analytics:read"
    }
  }
}
```

## Troubleshooting

### Issue: Token Exchange Fails with "invalid_scope"

**Error:**
```json
{
  "error": "invalid_scope",
  "error_description": "Requested scope not configured for client"
}
```

**Solution:**
1. Verify scopes are configured in Keycloak client scopes
2. Ensure scopes are assigned to the client
3. Check scope spelling matches exactly

### Issue: Token Lacks Expected Scopes

**Symptom:** Exchanged token has fewer scopes than requested

**Cause:** IDP policy restricts scope based on user roles

**Solution:**
1. Check user's role mappings in Keycloak
2. Verify client scope mappers are configured
3. Review IDP audit logs for scope denials

### Issue: Scope Not Included in Token

**Symptom:** `scope` claim missing from exchanged token

**Solution:**
1. Add scope mapper to client scope in Keycloak
2. Ensure "Add to access token" is enabled
3. Verify token exchange response includes `scope` field

## See Also

- [RFC 8693 - OAuth 2.0 Token Exchange](https://datatracker.ietf.org/doc/html/rfc8693)
- [RFC 6749 Section 3.3 - Access Token Scope](https://datatracker.ietf.org/doc/html/rfc6749#section-3.3)
- [MULTI-DATABASE-SETUP.md](MULTI-DATABASE-SETUP.md) - Multi-database configuration
- [test-harness/config/phase3-test-config.json](../test-harness/config/phase3-test-config.json) - Example configuration
