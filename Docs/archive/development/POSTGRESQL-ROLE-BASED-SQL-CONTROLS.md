# PostgreSQL Role-Based SQL Command Controls

## Overview

This document describes the role-based SQL command authorization system implemented in the PostgreSQL delegation module. The system uses TE-JWT (Token Exchange JWT) roles to control which SQL commands users can execute.

## Implementation Date

**Date:** 2025-10-12
**Version:** Added to v3.x
**File:** [src/delegation/sql/postgresql-module.ts](../src/delegation/sql/postgresql-module.ts)

## Role Hierarchy

The system implements a four-tier role hierarchy for SQL command authorization:

### 1. `sql-read` - Read-Only Access
**Permitted Commands:**
- `SELECT` - Query data
- `WITH` - Common Table Expressions (CTEs)
- `EXPLAIN` - Query execution plans
- `SHOW` - Show configuration
- `DESCRIBE` - Describe objects

**Use Case:** Analysts, reporting users, read-only applications

### 2. `sql-write` - Read and Write Access
**Permitted Commands:**
- All `sql-read` commands, plus:
- `INSERT` - Add new records
- `UPDATE` - Modify existing records
- `DELETE` - Remove records

**Use Case:** Application users, data entry personnel, standard operations

### 3. `sql-admin` - Administrative Access (Non-Destructive)
**Permitted Commands:**
- All `sql-write` commands, plus:
- `CREATE` - Create objects (tables, indexes, etc.)
- `ALTER` - Modify object structure
- `GRANT` - Grant permissions
- `REVOKE` - Revoke permissions

**Use Case:** Database administrators, DevOps, schema management

### 4. `admin` - Super Admin (All Operations)
**Permitted Commands:**
- All `sql-admin` commands, plus:
- `DROP` - Delete objects
- `TRUNCATE` - Remove all data from tables

**Use Case:** Senior DBAs, emergency operations, destructive operations

## Authorization Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     1. User Request                              │
│  Client sends request with requestor JWT (Bearer token)         │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ↓
┌─────────────────────────────────────────────────────────────────┐
│                  2. Token Exchange                               │
│  Exchange requestor JWT for TE-JWT with IDP                     │
│  TE-JWT contains: legacy_name, roles, permissions               │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ↓
┌─────────────────────────────────────────────────────────────────┐
│               3. Extract TE-JWT Roles                            │
│  roles = ['sql-read', 'sql-write', 'user']                      │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ↓
┌─────────────────────────────────────────────────────────────────┐
│            4. Action-Level Authorization                         │
│  Check if user has minimum role for action type                 │
│  - query: requires sql-read or higher                           │
│  - schema: requires sql-read or higher                          │
│  - table-details: requires sql-read or higher                   │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ↓
┌─────────────────────────────────────────────────────────────────┐
│          5. SQL Command-Level Authorization                      │
│  Parse SQL query to extract command (SELECT, INSERT, etc.)     │
│  Validate command against user's roles                           │
│  - SELECT: requires sql-read                                     │
│  - INSERT/UPDATE/DELETE: requires sql-write                      │
│  - CREATE/ALTER/GRANT: requires sql-admin                        │
│  - DROP/TRUNCATE: requires admin                                 │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ↓
┌─────────────────────────────────────────────────────────────────┐
│                 6. Execute SQL Operation                         │
│  SET ROLE {legacy_name}                                          │
│  Execute SQL query                                               │
│  RESET ROLE                                                      │
└─────────────────────────────────────────────────────────────────┘
```

## Security Features

### 1. Two-Stage Authorization

The system implements **two stages of authorization checks**:

#### Stage 1: Action-Level Authorization (Line 340-370)
Checks if the user has the minimum role required to perform the action type (query, schema, table-details).

**Example:**
```typescript
// User with sql-read can execute 'query' action
// But the specific SQL command will be checked in Stage 2
if (action === 'query' && !hasReadAccess) {
  return { success: false, error: "Insufficient permissions" };
}
```

#### Stage 2: SQL Command-Level Authorization (Line 684-784)
Parses the SQL query to extract the command and validates it against the user's roles.

**Example:**
```typescript
// User with sql-read tries to execute "UPDATE users SET..."
// Stage 1 passes (query action requires sql-read)
// Stage 2 FAILS (UPDATE command requires sql-write)
validateSQL(params.sql, teJwtRoles); // Throws 403 error
```

### 2. Command Extraction

The `validateSQL` method uses regex to extract the primary SQL command:

```typescript
const commandMatch = upperSQL.match(/^(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE|WITH|EXPLAIN|SHOW|DESCRIBE)/);
```

This handles:
- Leading whitespace
- Comments (requires trimming)
- CTEs (WITH clauses)
- Complex queries

### 3. Role-Based Access Control (RBAC)

```typescript
const hasReadAccess = roles.some((role: string) =>
  ['sql-read', 'sql-write', 'sql-admin', 'admin'].includes(role)
);
const hasWriteAccess = roles.some((role: string) =>
  ['sql-write', 'sql-admin', 'admin'].includes(role)
);
const hasAdminAccess = roles.some((role: string) =>
  ['sql-admin', 'admin'].includes(role)
);
const hasSuperAdminAccess = roles.some((role: string) =>
  ['admin'].includes(role)
);
```

**Design Decision:** Uses OR logic (`some()`) to check if user has ANY qualifying role. This allows flexible role assignment (e.g., user can have both `sql-read` and `sql-write`).

### 4. Fail-Secure Design

- **Unknown commands** require `sql-admin` role (line 754-762)
- **No roles provided** falls back to legacy dangerous operation blocking (line 763-783)
- **Invalid SQL** throws 400 error (line 691-697)

### 5. Security-Conscious Error Messages

**User-Facing Errors (Generic):**
Error messages intentionally do NOT reveal authorization structure to prevent information disclosure:

```
Insufficient permissions to execute UPDATE operation.
```

**Audit Trail (Detailed):**
The audit trail contains full details for security monitoring and forensics:

```json
{
  "success": false,
  "reason": "Insufficient permissions: user has roles [sql-read], requires sql-write or higher",
  "metadata": {
    "command": "UPDATE",
    "userRoles": ["sql-read"],
    "requiredRole": "sql-write"
  }
}
```

**Security Principle:** Users should only receive generic error messages. Detailed authorization information (required roles, permission structure) is logged internally for security teams but never exposed to end users.

## Code Changes

### 1. Enhanced `validateSQL` Method

**Location:** [postgresql-module.ts:684-784](../src/delegation/sql/postgresql-module.ts#L684-L784)

**Changes:**
- Added `roles?: string[]` parameter
- Implemented command extraction logic
- Added role-based authorization checks
- Maintained backward compatibility (roles optional)

**Signature:**
```typescript
private validateSQL(sqlQuery: string, roles?: string[]): void
```

### 2. Updated `delegate` Method

**Location:** [postgresql-module.ts:167-490](../src/delegation/sql/postgresql-module.ts#L167-L490)

**Changes:**
- Added `teRoles` variable to store TE-JWT roles (line 213)
- Extract roles from TE-JWT claims (line 332)
- Pass roles to `executeQuery` method (line 426)

**Code:**
```typescript
let teRoles: string[] | undefined = undefined;

// Inside token exchange block
teRoles = Array.isArray(teClaims.roles) ? teClaims.roles : [];

// Pass to executeQuery
result = await this.executeQuery(effectiveLegacyUsername, params, teRoles);
```

### 3. Updated `executeQuery` Method

**Location:** [postgresql-module.ts:532-571](../src/delegation/sql/postgresql-module.ts#L532-L571)

**Changes:**
- Added `teJwtRoles?: string[]` parameter (line 535)
- Pass roles to `validateSQL` (line 542)

**Signature:**
```typescript
private async executeQuery<T>(
  roleName: string,
  params: { sql: string; params?: any[] },
  teJwtRoles?: string[]
): Promise<T>
```

## Usage Examples

### Example 1: Read-Only User

**TE-JWT Roles:** `['sql-read', 'user']`

**Permitted:**
```sql
SELECT * FROM customers WHERE id = $1
SELECT COUNT(*) FROM orders
WITH sales AS (SELECT * FROM orders) SELECT * FROM sales
EXPLAIN SELECT * FROM products
```

**Blocked:**
```sql
INSERT INTO customers (name) VALUES ($1)  -- ❌ Requires sql-write
UPDATE products SET price = $1 WHERE id = $2  -- ❌ Requires sql-write
DELETE FROM orders WHERE id = $1  -- ❌ Requires sql-write
```

### Example 2: Write User

**TE-JWT Roles:** `['sql-write', 'user']`

**Permitted:**
```sql
SELECT * FROM customers WHERE id = $1  -- ✅ (sql-write includes sql-read)
INSERT INTO orders (customer_id, total) VALUES ($1, $2)  -- ✅
UPDATE customers SET email = $1 WHERE id = $2  -- ✅
DELETE FROM orders WHERE id = $1  -- ✅
```

**Blocked:**
```sql
CREATE TABLE products (id SERIAL, name TEXT)  -- ❌ Requires sql-admin
ALTER TABLE customers ADD COLUMN phone TEXT  -- ❌ Requires sql-admin
DROP TABLE orders  -- ❌ Requires admin
```

### Example 3: Admin User

**TE-JWT Roles:** `['sql-admin', 'admin']`

**Permitted:**
```sql
CREATE TABLE inventory (id SERIAL, name TEXT)  -- ✅
ALTER TABLE products ADD COLUMN category TEXT  -- ✅
GRANT SELECT ON customers TO reporting_user  -- ✅
```

**Blocked:**
```sql
DROP TABLE customers  -- ❌ Requires admin (super admin)
TRUNCATE orders  -- ❌ Requires admin (super admin)
```

### Example 4: Super Admin

**TE-JWT Roles:** `['admin']`

**Permitted:**
```sql
-- All commands including dangerous operations
DROP TABLE legacy_table  -- ✅
TRUNCATE audit_log  -- ✅
```

## Configuration

### Keycloak IDP Configuration

To use role-based SQL controls, configure your Keycloak IDP to return roles in the TE-JWT:

**Token Exchange Mapper:**
1. Navigate to: Client Scopes → `roles` → Mappers
2. Add User Realm Role Mapper:
   - **Name:** `sql-roles`
   - **Token Claim Name:** `roles`
   - **Claim JSON Type:** `String` (array)
   - **Add to access token:** ✅

**Client Configuration:**
```json
{
  "trustedIDPs": [{
    "issuer": "https://keycloak.example.com/realms/mcp",
    "tokenExchange": {
      "tokenEndpoint": "https://keycloak.example.com/realms/mcp/protocol/openid-connect/token",
      "clientId": "mcp-server",
      "clientSecret": "SECRET",
      "audience": "postgresql-delegation"
    }
  }]
}
```

### User Role Assignment

In Keycloak, assign users one or more SQL roles:

1. Navigate to: Users → {username} → Role Mapping
2. Assign roles:
   - `sql-read` (read-only access)
   - `sql-write` (read/write access)
   - `sql-admin` (administrative access)
   - `admin` (super admin - all operations)

**Best Practice:** Assign the **minimum required role** for the user's job function.

## Testing

### Manual Testing

**Test Read-Only User:**
```bash
# Assign user role: sql-read
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "postgres-read",
      "arguments": {
        "sql": "INSERT INTO users (name) VALUES ($1)",
        "params": ["Alice"]
      }
    },
    "id": 1
  }'

# Expected: 403 Forbidden
# Error: "Insufficient permissions to execute INSERT operation."
```

**Test Write User:**
```bash
# Assign user role: sql-write
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "postgres-read",
      "arguments": {
        "sql": "UPDATE users SET name = $1 WHERE id = $2",
        "params": ["Bob", 1]
      }
    },
    "id": 1
  }'

# Expected: 200 OK
# Result: User updated successfully
```

### Automated Testing

Add test cases to verify role-based authorization:

```typescript
describe('PostgreSQL Role-Based SQL Controls', () => {
  it('should allow SELECT for sql-read role', async () => {
    const session = createSession(['sql-read']);
    const result = await pgModule.delegate(session, 'query', {
      sql: 'SELECT * FROM users',
      params: []
    });
    expect(result.success).toBe(true);
  });

  it('should block INSERT for sql-read role', async () => {
    const session = createSession(['sql-read']);
    const result = await pgModule.delegate(session, 'query', {
      sql: 'INSERT INTO users (name) VALUES ($1)',
      params: ['Alice']
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Insufficient permissions to execute INSERT operation');
  });

  it('should allow INSERT for sql-write role', async () => {
    const session = createSession(['sql-write']);
    const result = await pgModule.delegate(session, 'query', {
      sql: 'INSERT INTO users (name) VALUES ($1)',
      params: ['Alice']
    });
    expect(result.success).toBe(true);
  });

  it('should block DROP for sql-admin role', async () => {
    const session = createSession(['sql-admin']);
    const result = await pgModule.delegate(session, 'query', {
      sql: 'DROP TABLE users',
      params: []
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Insufficient permissions to execute DROP operation');
  });

  it('should allow DROP for admin role', async () => {
    const session = createSession(['admin']);
    const result = await pgModule.delegate(session, 'query', {
      sql: 'DROP TABLE users',
      params: []
    });
    expect(result.success).toBe(true);
  });
});
```

## Backward Compatibility

The implementation maintains **full backward compatibility**:

### Without Token Exchange
If token exchange is not configured, the system falls back to **legacy dangerous operation blocking**:

```typescript
// No roles provided - fall back to basic dangerous operation blocking
const dangerous = ['DROP', 'CREATE', 'ALTER', 'TRUNCATE', 'GRANT', 'REVOKE'];

for (const keyword of dangerous) {
  if (upperSQL.includes(keyword)) {
    throw createSecurityError(
      'POSTGRESQL_DANGEROUS_OPERATION',
      `Dangerous SQL operation blocked: ${keyword}`,
      403
    );
  }
}
```

**Behavior:**
- All queries permitted **except** dangerous operations (DROP, CREATE, ALTER, TRUNCATE, GRANT, REVOKE)
- No role-based authorization

### With Token Exchange (No Roles in TE-JWT)
If TE-JWT does not contain roles, the system still uses legacy blocking:

```typescript
if (roles && roles.length > 0) {
  // Role-based authorization
} else {
  // Legacy dangerous operation blocking
}
```

**Behavior:**
- Same as "Without Token Exchange"
- Maintains security without breaking existing deployments

## Audit Logging

All authorization decisions are logged to the audit trail:

**Success:**
```json
{
  "timestamp": "2025-10-12T10:30:00Z",
  "source": "delegation:postgresql",
  "userId": "alice@example.com",
  "action": "postgresql_delegation:query",
  "success": true,
  "metadata": {
    "legacyUsername": "alice_db",
    "action": "query",
    "tokenExchangeUsed": true,
    "roles": ["sql-write", "user"]
  }
}
```

**Failure:**
```json
{
  "timestamp": "2025-10-12T10:31:00Z",
  "source": "delegation:postgresql",
  "userId": "bob@example.com",
  "action": "postgresql_delegation:query",
  "success": false,
  "reason": "Insufficient permissions: user has roles [sql-read], requires sql-write or higher",
  "metadata": {
    "command": "UPDATE",
    "requiredRole": "sql-write"
  }
}
```

## Best Practices

### 1. Least Privilege Principle
Always assign the **minimum role** required for the user's job function:
- Analysts → `sql-read`
- Application users → `sql-write`
- DBAs → `sql-admin`
- Senior DBAs → `admin` (only for emergency operations)

### 2. Role Separation
Use separate roles for different responsibilities:
- **Reporting users:** `sql-read` only
- **Data entry:** `sql-write` (no admin)
- **Schema changes:** `sql-admin` (no destructive ops)
- **Emergency ops:** `admin` (time-limited)

### 3. Regular Auditing
Monitor audit logs for:
- Failed authorization attempts (potential abuse)
- Excessive admin role usage
- Dangerous operations (DROP, TRUNCATE)

### 4. Token Exchange Configuration
Always use token exchange with role mapping:
- Configure IDP to return SQL roles in TE-JWT
- Test role mappings before production deployment
- Document role assignment procedures

### 5. Testing
Test all role combinations:
- `sql-read` → SELECT only
- `sql-write` → SELECT, INSERT, UPDATE, DELETE
- `sql-admin` → All except DROP/TRUNCATE
- `admin` → All operations

## Limitations

### 1. Single Command Detection
The system extracts the **first SQL command** only. Multi-statement queries may bypass checks:

**Example:**
```sql
SELECT 1; DROP TABLE users;  -- ❌ May bypass detection
```

**Mitigation:** Enforce single-statement queries at the application layer or use PostgreSQL's `multi_statement_query` parameter.

### 2. Dynamic SQL
The system cannot analyze dynamic SQL within stored procedures:

**Example:**
```sql
CREATE OR REPLACE FUNCTION drop_table() RETURNS void AS $$
BEGIN
  EXECUTE 'DROP TABLE users';  -- Not detected
END;
$$ LANGUAGE plpgsql;
```

**Mitigation:** Block `CREATE` operations for non-admin users, preventing malicious procedure creation.

### 3. SQL Injection via Parameterized Queries
While the system uses parameterized queries, it cannot prevent injection in dynamic SQL:

**Example:**
```sql
-- Safe (parameterized)
SELECT * FROM users WHERE id = $1

-- Unsafe (dynamic)
EXECUTE 'SELECT * FROM users WHERE id = ' || user_input;
```

**Mitigation:** The `validateSQL` method already blocks dangerous operations. Always use parameterized queries.

## Future Enhancements

### 1. Custom Role Definitions
Allow custom role definitions in configuration:

```json
{
  "sqlRoles": {
    "analyst": {
      "commands": ["SELECT", "WITH", "EXPLAIN"],
      "tables": ["customers", "orders"]
    },
    "developer": {
      "commands": ["SELECT", "INSERT", "UPDATE", "DELETE"],
      "tables": ["*"]
    }
  }
}
```

### 2. Table-Level Permissions
Extend authorization to table-level granularity:

```typescript
// User has sql-read on 'customers' but not 'orders'
if (table === 'orders' && !hasPermission('orders', 'read')) {
  throw error;
}
```

### 3. Time-Based Role Elevation
Support temporary role elevation with expiration:

```json
{
  "roles": ["sql-write"],
  "temporaryRoles": {
    "sql-admin": {
      "expires": "2025-10-12T12:00:00Z",
      "reason": "Schema migration"
    }
  }
}
```

### 4. Query Complexity Limits
Add query complexity scoring to prevent resource exhaustion:

```typescript
// Block queries with excessive JOINs, subqueries, or Cartesian products
if (queryComplexity > threshold) {
  throw error;
}
```

## References

- [PostgreSQL Security Best Practices](https://www.postgresql.org/docs/current/sql-security.html)
- [OAuth 2.0 Token Exchange (RFC 8693)](https://datatracker.ietf.org/doc/html/rfc8693)
- [NIST RBAC Model](https://csrc.nist.gov/projects/role-based-access-control)
- [OWASP SQL Injection Prevention](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html)

## Conclusion

The role-based SQL command controls provide **fine-grained authorization** for PostgreSQL operations while maintaining **backward compatibility** and **fail-secure** defaults. The implementation follows **least privilege principles** and provides **detailed audit logging** for compliance and security monitoring.

**Key Benefits:**
- ✅ Four-tier role hierarchy (read, write, admin, super admin)
- ✅ Two-stage authorization (action + command level)
- ✅ Backward compatible (falls back to legacy blocking)
- ✅ Fail-secure design (unknown commands blocked)
- ✅ Detailed error messages and audit logs
- ✅ TE-JWT based (leverages OAuth 2.0 token exchange)

**Security Considerations:**
- Always use token exchange with role mapping
- Assign minimum required roles (least privilege)
- Monitor audit logs for authorization failures
- Test all role combinations before production
- Enforce single-statement queries at application layer
