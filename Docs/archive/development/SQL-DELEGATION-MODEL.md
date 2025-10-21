# SQL Server Delegation Model

## Overview

The SQL Server Delegation Module provides secure database operations on behalf of legacy users using SQL Server's `EXECUTE AS USER` feature. This enables modern OAuth-authenticated applications to access SQL Server with legacy Windows/SQL authentication identities.

## Architecture

### Component Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    Client Application                            │
│  (OAuth 2.1 authenticated with requestor JWT)                   │
└──────────────────┬──────────────────────────────────────────────┘
                   │
                   │ 1. Requestor JWT (aud: "mcp-oauth")
                   │    - Used for: MCP tool authorization
                   │    - Contains: user roles (user/admin/guest)
                   ↓
┌─────────────────────────────────────────────────────────────────┐
│                    MCP OAuth Server                              │
│                                                                   │
│  Step 1: Validate Requestor JWT                                 │
│  ├─ JWTValidator matches by iss + aud                           │
│  ├─ Creates UserSession with role from JWT                      │
│  └─ Authorization: Check user has 'user' or 'admin' role        │
│                                                                   │
│  Step 2: Token Exchange (Optional)                              │
│  ├─ Exchange requestor JWT for TE-JWT (aud: "urn:sql:database")│
│  ├─ TE-JWT contains delegation-specific claims:                 │
│  │  • legacy_name: "ALICE_ADMIN"                                │
│  │  • roles: ["admin"]                                          │
│  │  • allowed_operations: ["read", "write"] (optional)          │
│  └─ Extract legacy_name from TE-JWT                             │
│                                                                   │
│  Step 3: SQL Delegation                                          │
│  └─ SQLDelegationModule.delegate()                              │
└──────────────────┬──────────────────────────────────────────────┘
                   │
                   │ 3. EXECUTE AS USER 'legacy_name'
                   ↓
┌─────────────────────────────────────────────────────────────────┐
│                    SQL Server                                    │
│                                                                   │
│  1. EXECUTE AS USER 'ALICE_ADMIN';                              │
│  2. Check ALICE_ADMIN permissions (PRIMARY AUTHORIZATION)        │
│     ├─ Does user exist? (Windows AD / SQL users)                │
│     ├─ Has SELECT permission on target table?                   │
│     └─ Grant/Deny based on SQL Server permissions               │
│  3. Execute SQL query                                            │
│  4. REVERT; (restore original context)                           │
└─────────────────────────────────────────────────────────────────┘
```

## Two-Tier Authorization

### Tier 1: Primary Authorization (SQL Server)

SQL Server performs the **primary authorization** based on the `legacy_name`:

```sql
-- Framework executes:
EXECUTE AS USER 'ALICE_ADMIN';
SELECT * FROM sensitive_table;
REVERT;

-- SQL Server checks:
-- 1. Does ALICE_ADMIN exist in SQL Server?
-- 2. Is ALICE_ADMIN a Windows user (DOMAIN\ALICE_ADMIN) or SQL user?
-- 3. Does ALICE_ADMIN have SELECT permission on sensitive_table?
-- 4. If all checks pass → Execute query
-- 5. If any check fails → Deny with permission error
```

**Permission Sources:**
- **Windows Authentication**: Permissions from Active Directory groups
- **SQL Authentication**: Permissions from SQL Server roles/grants
- **Database Roles**: db_datareader, db_datawriter, db_owner, etc.
- **Object-level permissions**: GRANT SELECT/UPDATE/DELETE on specific tables

### Tier 2: Secondary Authorization (TE-JWT Constraints - Optional)

The TE-JWT can **optionally constrain** what operations are allowed, even if SQL Server would permit them:

```typescript
// TE-JWT claims
{
  "legacy_name": "ALICE_ADMIN",
  "allowed_operations": ["read", "write"]  // No "delete" or "admin"
}

// Framework checks BEFORE executing SQL:
const allowedOps = session.customClaims?.allowed_operations || [];
if (!allowedOps.includes('delete') && sql.includes('DELETE')) {
  throw new Error('TE-JWT does not permit DELETE operations');
}

// Result: Even if ALICE_ADMIN has DELETE permission in SQL Server,
// the TE-JWT constraint prevents DELETE operations
```

**Use Cases:**
- **Privilege Reduction**: User with admin SQL rights but limited to read-only via TE-JWT
- **Temporary Access**: Short-lived TE-JWT with restricted operations
- **Compliance**: Enforce additional controls beyond SQL Server permissions

## Token Exchange Flow (Phase 1)

### With Token Exchange (Recommended)

```
1. Client → MCP Server
   Authorization: Bearer <requestor-jwt>
   {
     "iss": "http://keycloak/realms/mcp",
     "aud": ["mcp-oauth"],
     "sub": "alice",
     "roles": ["user"]
   }

2. MCP Server validates requestor JWT
   - Matches by iss + aud → trustedIDPs[0]
   - Checks role: "user" ✓
   - Authorizes sql-delegate tool access

3. MCP Server → IDP (Token Exchange)
   POST /token
   {
     "grant_type": "urn:ietf:params:oauth:grant-type:token-exchange",
     "subject_token": "<requestor-jwt>",
     "audience": "urn:sql:database",
     "client_id": "mcp-oauth",
     "client_secret": "SECRET"
   }

4. IDP → MCP Server (TE-JWT)
   {
     "access_token": "<te-jwt>",
     "token_type": "Bearer"
   }

   TE-JWT payload:
   {
     "iss": "http://keycloak/realms/mcp",
     "aud": ["urn:sql:database"],
     "sub": "alice",
     "legacy_name": "ALICE_ADMIN",
     "roles": ["admin"],
     "allowed_operations": ["read", "write"]
   }

5. MCP Server extracts legacy_name from TE-JWT
   effectiveLegacyUsername = "ALICE_ADMIN"

6. SQL Delegation
   EXECUTE AS USER 'ALICE_ADMIN';
   SELECT * FROM table;
   REVERT;
```

### Without Token Exchange (Fallback)

```
1. Requestor JWT must contain legacy_name claim:
   {
     "iss": "http://keycloak/realms/mcp",
     "aud": ["mcp-oauth"],
     "sub": "alice",
     "legacy_name": "ALICE_ADMIN",  // ← Must be present
     "roles": ["user"]
   }

2. Framework uses legacy_name directly:
   effectiveLegacyUsername = session.legacyUsername

3. SQL Delegation
   EXECUTE AS USER 'ALICE_ADMIN';
   SELECT * FROM table;
   REVERT;
```

## SQL Operations Supported

### 1. Query Execution

**Action:** `query`

**Parameters:**
```typescript
{
  sql: string;           // Parameterized SQL query
  params?: Record<string, any>;  // Named parameters
}
```

**Example:**
```typescript
await sqlModule.delegate(session, 'query', {
  sql: 'SELECT * FROM users WHERE department = @dept AND status = @status',
  params: {
    dept: 'Engineering',
    status: 'Active'
  }
});
```

**SQL Execution:**
```sql
EXECUTE AS USER 'ALICE_ADMIN';
SELECT * FROM users WHERE department = @dept AND status = @status;
REVERT;
```

### 2. Stored Procedure Execution

**Action:** `procedure`

**Parameters:**
```typescript
{
  procedure: string;     // Procedure name
  params?: Record<string, any>;  // Named parameters
}
```

**Example:**
```typescript
await sqlModule.delegate(session, 'procedure', {
  procedure: 'GetUserReport',
  params: {
    userId: 123,
    reportType: 'summary'
  }
});
```

**SQL Execution:**
```sql
EXECUTE AS USER 'ALICE_ADMIN';
EXEC GetUserReport @userId = 123, @reportType = 'summary';
REVERT;
```

### 3. Scalar Function Execution

**Action:** `function`

**Parameters:**
```typescript
{
  functionName: string;  // Function name
  params?: Record<string, any>;  // Named parameters
}
```

**Example:**
```typescript
await sqlModule.delegate(session, 'function', {
  functionName: 'CalculateDiscount',
  params: {
    price: 100,
    category: 'premium'
  }
});
```

**SQL Execution:**
```sql
EXECUTE AS USER 'ALICE_ADMIN';
SELECT CalculateDiscount(@price, @category) AS result;
REVERT;
```

## Security Features

### 1. Parameterized Queries Only

**Enforced:** All parameters are bound using the `mssql` library's parameterization.

**Prevents:** SQL injection attacks

```typescript
// ✅ SAFE - Parameterized
{
  sql: 'SELECT * FROM users WHERE id = @id',
  params: { id: userInput }
}

// ❌ BLOCKED - String concatenation not allowed
{
  sql: `SELECT * FROM users WHERE id = ${userInput}`
}
```

### 2. Dangerous Operation Blocking

**Blocked Keywords:**
- `DROP` - Prevent dropping tables/databases
- `CREATE` - Prevent creating objects
- `ALTER` - Prevent schema modifications
- `TRUNCATE` - Prevent data truncation
- `xp_cmdshell` - Prevent OS command execution
- `sp_executesql` - Prevent dynamic SQL injection

```typescript
// ❌ BLOCKED
{
  sql: 'DROP TABLE users'
}
// Error: "Dangerous SQL operation blocked: DROP"

// ❌ BLOCKED
{
  sql: 'EXEC xp_cmdshell "dir"'
}
// Error: "Dangerous SQL operation blocked: xp_cmdshell"
```

### 3. SQL Identifier Validation

**Pattern:** `/^[a-zA-Z_][a-zA-Z0-9_\\]*$/`

**Rules:**
- Must start with letter or underscore
- Can contain alphanumeric, underscore, backslash (for domain users)
- Prevents SQL injection via identifier manipulation

```typescript
// ✅ VALID
'ALICE_ADMIN'
'DOMAIN\\ALICE_ADMIN'
'user_123'

// ❌ INVALID
'Alice; DROP TABLE users--'
'../../../etc/passwd'
'user@domain.com'
```

### 4. Automatic Context Reversion

**Guarantee:** `REVERT` is **always** executed, even on error.

```typescript
try {
  await request.query(`EXECUTE AS USER = 'ALICE_ADMIN'`);
  await request.query(params.sql);
  await request.query('REVERT');  // Success path
} catch (error) {
  try {
    await request.query('REVERT');  // Error path - always revert
  } catch {
    // Ignore revert errors
  }
  throw error;
}
```

**Protection:** Prevents privilege escalation from leaked execution contexts.

### 5. TLS Encryption Required

**Enforced:** `encrypt: true` is **mandatory** in connection config.

```typescript
const connectionConfig: sql.config = {
  server: config.server,
  database: config.database,
  options: {
    encrypt: true,  // MANDATORY: Always encrypt connections
    trustServerCertificate: config.options?.trustServerCertificate ?? false,
  }
};
```

**Protection:** Prevents credential theft and man-in-the-middle attacks.

## Configuration

### SQL Server Configuration

```json
{
  "delegation": {
    "modules": {
      "sql": {
        "server": "sql01.company.com",
        "database": "legacy_app",
        "options": {
          "trustedConnection": true,
          "encrypt": true,
          "trustServerCertificate": false
        },
        "pool": {
          "max": 10,
          "min": 0,
          "idleTimeoutMillis": 30000
        },
        "connectionTimeout": 5000,
        "requestTimeout": 30000
      }
    }
  }
}
```

### Token Exchange Configuration (Optional)

```json
{
  "delegation": {
    "tokenExchange": {
      "tokenEndpoint": "http://localhost:8080/realms/mcp_security/protocol/openid-connect/token",
      "clientId": "mcp-oauth",
      "clientSecret": "9DQjCpm4D9wbzXxHa1ki51PhBbyxOXrg",
      "audience": "urn:sql:database"
    }
  }
}
```

### TrustedIDP for SQL TE-JWT

```json
{
  "auth": {
    "trustedIDPs": [
      {
        "name": "sql-delegation-te-jwt",
        "issuer": "http://localhost:8080/realms/mcp_security",
        "audience": "urn:sql:database",
        "claimMappings": {
          "legacyUsername": "legacy_name",
          "roles": "roles"
        },
        "roleMappings": {
          "admin": ["admin"],
          "user": ["user"]
        }
      }
    ]
  }
}
```

## SQL Server Setup

### 1. Create Delegated User

```sql
-- Create Windows authenticated user (recommended)
CREATE USER [DOMAIN\ALICE_ADMIN] FOR LOGIN [DOMAIN\ALICE_ADMIN];

-- OR create SQL authenticated user
CREATE USER ALICE_ADMIN WITH PASSWORD = 'SecurePassword123!';
```

### 2. Grant IMPERSONATE Permission

The **service account** (running the MCP server) must have IMPERSONATE permission:

```sql
-- Grant IMPERSONATE on specific user
GRANT IMPERSONATE ON USER::ALICE_ADMIN TO [DOMAIN\MCP_SERVICE];

-- OR grant IMPERSONATE on all users (less secure)
ALTER AUTHORIZATION ON SCHEMA::dbo TO [DOMAIN\MCP_SERVICE];
```

### 3. Grant User Permissions

```sql
-- Grant database role
ALTER ROLE db_datareader ADD MEMBER [DOMAIN\ALICE_ADMIN];
ALTER ROLE db_datawriter ADD MEMBER [DOMAIN\ALICE_ADMIN];

-- OR grant specific permissions
GRANT SELECT, INSERT, UPDATE ON dbo.users TO [DOMAIN\ALICE_ADMIN];
GRANT EXECUTE ON dbo.GetUserReport TO [DOMAIN\ALICE_ADMIN];
```

### 4. Verify Setup

```sql
-- Test EXECUTE AS
EXECUTE AS USER = 'ALICE_ADMIN';
SELECT CURRENT_USER;  -- Should return: ALICE_ADMIN
REVERT;
SELECT CURRENT_USER;  -- Should return: MCP_SERVICE

-- Test permissions
EXECUTE AS USER = 'ALICE_ADMIN';
SELECT * FROM users;  -- Should succeed if granted
REVERT;
```

## Usage Examples

### Example 1: Basic Query

```typescript
const result = await sqlModule.delegate(session, 'query', {
  sql: 'SELECT TOP 10 * FROM users WHERE department = @dept',
  params: { dept: 'Engineering' }
});

console.log(result);
// [
//   { id: 1, name: 'Alice', department: 'Engineering' },
//   { id: 2, name: 'Bob', department: 'Engineering' },
//   ...
// ]
```

### Example 2: Stored Procedure with Multiple Parameters

```typescript
const result = await sqlModule.delegate(session, 'procedure', {
  procedure: 'GenerateMonthlyReport',
  params: {
    startDate: '2024-01-01',
    endDate: '2024-01-31',
    departmentId: 5
  }
});
```

### Example 3: Scalar Function

```typescript
const discount = await sqlModule.delegate(session, 'function', {
  functionName: 'dbo.CalculateDiscount',
  params: {
    customerTier: 'gold',
    purchaseAmount: 1000
  }
});

console.log(discount);
// 150 (15% of 1000)
```

## Error Handling

### DelegationResult Structure

```typescript
interface DelegationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  auditTrail: {
    timestamp: Date;
    source: string;
    userId: string;
    action: string;
    success: boolean;
    error?: string;
    reason?: string;
    metadata?: Record<string, any>;
  };
}
```

### Common Errors

**1. Missing Legacy Username**
```typescript
{
  success: false,
  error: 'Session missing legacyUsername (required for SQL delegation)',
  auditTrail: {
    reason: 'Missing legacyUsername'
  }
}
```

**2. Token Exchange Failure**
```typescript
{
  success: false,
  error: 'Token exchange failed: invalid_grant',
  auditTrail: {
    reason: 'Token exchange error: invalid_grant'
  }
}
```

**3. SQL Permission Denied**
```typescript
{
  success: false,
  error: 'The SELECT permission was denied on the object \'users\'',
  auditTrail: {
    error: 'The SELECT permission was denied...',
    metadata: {
      legacyUsername: 'ALICE_ADMIN',
      tokenExchangeUsed: true
    }
  }
}
```

**4. Dangerous Operation Blocked**
```typescript
{
  success: false,
  error: 'Dangerous SQL operation blocked: DROP',
  auditTrail: {
    reason: 'Security validation failed'
  }
}
```

## Audit Trail

Every SQL delegation operation is logged:

```typescript
{
  timestamp: new Date('2024-01-10T10:30:00Z'),
  source: 'delegation:sql',
  userId: 'alice',
  action: 'sql_delegation:query',
  success: true,
  metadata: {
    legacyUsername: 'ALICE_ADMIN',
    action: 'query',
    tokenExchangeUsed: true
  }
}
```

**Logged Information:**
- Timestamp of operation
- User ID from session
- Action type (query/procedure/function)
- Success/failure status
- Legacy username used for EXECUTE AS
- Whether token exchange was used
- Error details (if failed)

## Performance Considerations

### Connection Pooling

```json
{
  "pool": {
    "max": 10,           // Maximum concurrent connections
    "min": 0,            // Minimum idle connections
    "idleTimeoutMillis": 30000  // Close idle connections after 30s
  }
}
```

**Recommendations:**
- **Small deployments**: max 5-10 connections
- **Medium deployments**: max 20-50 connections
- **Large deployments**: max 100+ connections
- Monitor SQL Server connection count

### Request Timeout

```json
{
  "requestTimeout": 30000  // 30 seconds
}
```

**Recommendations:**
- **OLTP queries**: 5-15 seconds
- **Reporting queries**: 30-60 seconds
- **Long-running operations**: Consider async patterns

### Token Exchange Caching (Phase 2)

See [Docs/NPM-LIBRARY-VERIFICATION.md](NPM-LIBRARY-VERIFICATION.md) for EncryptedTokenCache details.

**Benefits:**
- Reduce token exchange latency (81% reduction)
- Cryptographic binding prevents impersonation
- Automatic invalidation on JWT refresh

## Security Best Practices

### 1. Use Windows Authentication

**Recommended:**
```json
{
  "options": {
    "trustedConnection": true
  }
}
```

**Benefits:**
- Centralized user management (Active Directory)
- Kerberos authentication
- No credentials in configuration

### 2. Principle of Least Privilege

**SQL Server:**
```sql
-- ❌ Avoid granting db_owner
ALTER ROLE db_owner ADD MEMBER ALICE_ADMIN;

-- ✅ Grant specific permissions only
GRANT SELECT, INSERT, UPDATE ON dbo.users TO ALICE_ADMIN;
GRANT EXECUTE ON dbo.GetUserReport TO ALICE_ADMIN;
```

### 3. Enable TLS Encryption

**Required:**
```json
{
  "options": {
    "encrypt": true,
    "trustServerCertificate": false  // Validate cert in production
  }
}
```

### 4. Monitor Audit Logs

**Track:**
- Failed delegation attempts
- Blocked dangerous operations
- Permission denied errors
- Token exchange failures

### 5. Use Token Exchange

**Recommended over direct legacy_name in requestor JWT:**
- Separates concerns (tool access vs delegation)
- Supports multiple delegations (SQL, Kerberos, APIs)
- Enables privilege reduction via TE-JWT constraints

## Troubleshooting

### "Cannot execute as the user because the principal does not exist"

**Cause:** User does not exist in SQL Server

**Fix:**
```sql
CREATE USER [DOMAIN\ALICE_ADMIN] FOR LOGIN [DOMAIN\ALICE_ADMIN];
```

### "The server principal 'MCP_SERVICE' is not able to access the database under the current security context"

**Cause:** Service account lacks IMPERSONATE permission

**Fix:**
```sql
GRANT IMPERSONATE ON USER::ALICE_ADMIN TO [DOMAIN\MCP_SERVICE];
```

### "The SELECT permission was denied on the object 'table'"

**Cause:** Delegated user lacks permission

**Fix:**
```sql
GRANT SELECT ON dbo.table TO [DOMAIN\ALICE_ADMIN];
```

### "Token exchange failed: invalid_grant"

**Cause:** Requestor JWT expired or invalid

**Fix:** Obtain fresh JWT from IDP

### "Dangerous SQL operation blocked: DROP"

**Cause:** Query contains blocked keyword

**Fix:** This is a security feature - use SQL Server Management Studio for DDL operations
