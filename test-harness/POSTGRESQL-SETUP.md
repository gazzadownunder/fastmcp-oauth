# PostgreSQL Setup for MCP OAuth Testing

## Quick Start

### 1. Run the Setup Script

Connect to PostgreSQL as a superuser and run the setup script:

```bash
# Using psql command line
psql -U postgres -d postgres -f test-harness/setup-postgres-roles.sql

# OR using pgAdmin
# 1. Open pgAdmin
# 2. Connect to your PostgreSQL server
# 3. Open Query Tool
# 4. Load and execute setup-postgres-roles.sql
```

### 2. Verify Roles Created

```sql
-- Check that roles exist
SELECT rolname, rolcanlogin
FROM pg_roles
WHERE rolname IN ('ALICE_ADMIN', 'BOB_USER', 'CAROL_GUEST');

-- Should return:
--    rolname     | rolcanlogin
-- ---------------+-------------
--  ALICE_ADMIN   | t
--  BOB_USER      | t
--  CAROL_GUEST   | t
```

### 3. Test Role Permissions

```sql
-- Switch to ALICE_ADMIN role
SET ROLE "ALICE_ADMIN";

-- Alice should see all data
SELECT * FROM public.test_data;

-- Alice can insert
INSERT INTO public.test_data (username, data)
VALUES ('test', 'Alice inserted this');

-- Switch to BOB_USER role
RESET ROLE;
SET ROLE "BOB_USER";

-- Bob should see all data
SELECT * FROM public.test_data;

-- Bob cannot insert (should fail)
INSERT INTO public.test_data (username, data)
VALUES ('test', 'Bob trying to insert');
-- ERROR: permission denied for table test_data

-- Switch to CAROL_GUEST role
RESET ROLE;
SET ROLE "CAROL_GUEST";

-- Carol cannot see data (should fail)
SELECT * FROM public.test_data;
-- ERROR: permission denied for table test_data

-- But Carol can see table structure
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public';
```

## Role Summary

| Role | Permissions | Use Case |
|------|------------|----------|
| **ALICE_ADMIN** | Full access (SELECT, INSERT, UPDATE, DELETE) | Admin operations, write access |
| **BOB_USER** | Read-only (SELECT) | Reporting, analytics, read-only access |
| **CAROL_GUEST** | Schema info only | Can list tables but not read data |

## MCP OAuth Integration

### Keycloak Configuration

Configure Keycloak to return these legacy_name values in the TE-JWT:

1. **Alice's Token**:
   ```json
   {
     "sub": "...",
     "legacy_name": "ALICE_ADMIN",
     "roles": ["sql-read", "sql-write"]
   }
   ```

2. **Bob's Token**:
   ```json
   {
     "sub": "...",
     "legacy_name": "BOB_USER",
     "roles": ["sql-read"]
   }
   ```

3. **Carol's Token**:
   ```json
   {
     "sub": "...",
     "legacy_name": "CAROL_GUEST",
     "roles": ["guest"]
   }
   ```

### Expected Behavior

**Alice (ALICE_ADMIN role)**:
- ✅ Can call sql-schema tool (has sql-read role)
- ✅ Can execute SELECT queries (has database SELECT permission)
- ✅ Can execute INSERT/UPDATE/DELETE queries (has database write permissions)

**Bob (BOB_USER role)**:
- ✅ Can call sql-schema tool (has sql-read role)
- ✅ Can execute SELECT queries (has database SELECT permission)
- ❌ Cannot execute INSERT/UPDATE/DELETE queries (no database write permissions)

**Carol (CAROL_GUEST role)**:
- ❌ Cannot call sql-schema tool (lacks sql-read role in TE-JWT)
- Error: "You don't have rights to perform that operation. Required role: sql-read, sql-write, or admin."

## Troubleshooting

### Error: "role 'ALICE_ADMIN' does not exist"

**Cause**: PostgreSQL role not created

**Solution**: Run the setup script above

### Error: "permission denied for table test_data"

**Cause**: Role doesn't have required table permissions

**Solution**: Check role permissions:
```sql
SELECT grantee, privilege_type
FROM information_schema.table_privileges
WHERE table_name = 'test_data' AND grantee = 'ALICE_ADMIN';
```

### MCP Server Connection Issues

Verify the MCP server's PostgreSQL connection config in phase3-test-config.json:

```json
{
  "delegation": {
    "modules": {
      "postgresql": {
        "host": "localhost",
        "port": 5432,
        "database": "postgres",
        "user": "mcp_service",
        "password": "ServicePass123!",
        "options": {
          "ssl": false
        }
      }
    }
  }
}
```

**Important**: The `user` in the config (`mcp_service`) is the **service account** that connects to PostgreSQL. The `legacy_name` from the TE-JWT is the **delegated user** that operations run as via `SET ROLE`.

### Verify SET ROLE Works

```sql
-- Connect as mcp_service
psql -U mcp_service -d postgres

-- Check current role
SELECT CURRENT_USER, SESSION_USER;
-- Should show: mcp_service | mcp_service

-- Switch to ALICE_ADMIN
SET ROLE "ALICE_ADMIN";

-- Verify switch worked
SELECT CURRENT_USER, SESSION_USER;
-- Should show: ALICE_ADMIN | mcp_service

-- Now queries run as ALICE_ADMIN
SELECT * FROM test_data;

-- Reset to original role
RESET ROLE;
```

## Security Notes

1. **Password Security**: The passwords in this script (`AlicePass123!`, etc.) are for testing only. Use strong, unique passwords in production.

2. **Service Account**: The `mcp_service` user must have permission to `SET ROLE` to any delegated user. Grant this with:
   ```sql
   GRANT "ALICE_ADMIN" TO mcp_service;
   GRANT "BOB_USER" TO mcp_service;
   GRANT "CAROL_GUEST" TO mcp_service;
   ```

3. **Least Privilege**: In production, grant only the minimum permissions required for each role.

## Clean Up (Optional)

To remove the test roles and data:

```sql
-- Drop test table
DROP TABLE IF EXISTS public.test_data CASCADE;

-- Drop roles (must disconnect sessions first)
DROP ROLE IF EXISTS "ALICE_ADMIN";
DROP ROLE IF EXISTS "BOB_USER";
DROP ROLE IF EXISTS "CAROL_GUEST";
```
