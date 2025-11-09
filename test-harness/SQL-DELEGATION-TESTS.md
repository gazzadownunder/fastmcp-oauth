# SQL Delegation Integration Tests

This document explains how to run the optional SQL delegation integration tests.

## Overview

The SQL delegation tests are **optional** and separated from the core framework tests. They only need to be run if you:
- Have installed the `@mcp-oauth/sql-delegation` package
- Are using PostgreSQL delegation in your deployment
- Want to test SQL-specific functionality

## Prerequisites

### 1. Install SQL Delegation Package

```bash
npm install @mcp-oauth/sql-delegation
```

### 2. PostgreSQL Database Setup

You need a PostgreSQL database configured with:

**Service Account:**
- User: `mcp_service` (or as configured in your config)
- Must have permission to `SET ROLE` to delegated users

**Delegated User Roles:**
Create three PostgreSQL roles for testing:
```sql
CREATE ROLE alice LOGIN;
CREATE ROLE bob LOGIN;
CREATE ROLE charlie LOGIN;
```

**Database Schema:**
Create test tables in the `public` schema:

```sql
-- General table (unrestricted access)
CREATE TABLE general_table (
    id SERIAL PRIMARY KEY,
    data TEXT
);

-- Alice-specific table
CREATE TABLE alice_table (
    id SERIAL PRIMARY KEY,
    data TEXT
);

-- Bob-specific table
CREATE TABLE bob_table (
    id SERIAL PRIMARY KEY,
    data TEXT
);

-- Grant permissions
GRANT SELECT ON general_table TO alice, bob, charlie;
GRANT SELECT ON alice_table TO alice;
GRANT SELECT, INSERT, UPDATE, DELETE ON bob_table TO bob;
GRANT SELECT, INSERT, UPDATE, DELETE ON general_table TO bob;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO charlie;
```

### 3. Keycloak Configuration

Follow the setup in [KEYCLOAK-ROLE-SETUP-INT008.md](KEYCLOAK-ROLE-SETUP-INT008.md):

**Client Roles for `mcp-server-client`:**
- `sql-read` - SELECT only
- `sql-write` - SELECT, INSERT, UPDATE, DELETE
- `sql-admin` - All except DROP/TRUNCATE
- `admin` - All commands

**User Role Assignments:**
- Alice → `sql-read`, `alice_table`
- Bob → `sql-write`, `bob_table`
- Charlie → `sql-admin`

**Token Mapper:**
Must configure client role mapper to include roles in TE-JWT (see [KEYCLOAK-ROLE-SETUP-INT008.md](KEYCLOAK-ROLE-SETUP-INT008.md#step-3-configure-token-mapper-for-client-roles))

### 4. MCP Server Configuration

Your configuration file must include PostgreSQL delegation:

```json
{
  "delegation": {
    "modules": {
      "postgresql1": {
        "host": "localhost",
        "port": 5432,
        "database": "postgres",
        "user": "mcp_service",
        "password": "ServicePass123!",
        "tokenExchange": {
          "idpName": "sql-delegation-te-jwt",
          "tokenEndpoint": "http://192.168.1.137:8080/realms/mcp_security/protocol/openid-connect/token",
          "clientId": "mcp-server-client",
          "clientSecret": "YOUR_SECRET",
          "audience": "mcp-server-client",
          "requiredClaim": "legacy_name",
          "rolesClaim": "roles",
          "cache": {
            "enabled": true,
            "ttlSeconds": 60
          }
        }
      }
    }
  }
}
```

## Running the Tests

### Start the MCP Server

```bash
# Build the project
npm run build

# Start server with SQL delegation config
CONFIG_PATH=./test-harness/config/phase3-test-config.json node dist/index.js
```

### Run SQL Delegation Tests

```bash
npm run test:sql
```

### Debug Mode

To see detailed MCP responses:

```bash
DEBUG_MCP_RESPONSES=true npm run test:sql
```

## Test Coverage

The SQL delegation test suite includes:

### SQL-001: Basic PostgreSQL Delegation
- Token exchange with Keycloak
- SQL query execution via delegation
- TE-JWT claim validation

### SQL-002: PostgreSQL Schema Tools
- `sql-schema` tool (list tables)
- `sql-table-details` tool (column information)

### SQL-003: Role-Based Table Authorization
- Alice can access `alice_table` ✅
- Alice denied access to `bob_table` ❌
- Bob can access `bob_table` ✅
- Bob denied access to `alice_table` ❌
- Both can access `general_table` ✅

### SQL-004: Positional Parameters
- PostgreSQL `$1`, `$2` parameter substitution
- SQL injection prevention

### SQL-005: Role-Based SQL Command Controls
| Role | SELECT | INSERT | UPDATE | DELETE | CREATE | DROP |
|------|--------|--------|--------|--------|--------|------|
| sql-read | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| sql-write | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| sql-admin | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| admin | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

### SQL-006: Response Validation
- INSERT/UPDATE/DELETE return metadata with rowCount
- SELECT returns rows array

### SQL-007: Security - Error Messages
- Authorization errors don't leak role information
- Generic "Insufficient permissions" message

### SQL-008: Error Handling
- Missing `legacy_name` claim
- Token validation failures

### SQL-009: Cache Performance
- Cache hit rate >80% with 60s TTL
- JWT refresh invalidates cache

## Troubleshooting

### Tests Fail: "Token exchange failed"
**Cause:** Keycloak not configured correctly or not running

**Solution:**
1. Verify Keycloak is running at `http://192.168.1.137:8080`
2. Check client credentials in config
3. Verify token exchange grant type enabled for `mcp-server-client`

### Tests Fail: "Missing required claim: legacy_name"
**Cause:** TE-JWT doesn't include `legacy_name` claim

**Solution:**
1. Check Keycloak user attributes (alice should have `legacyUsername: alice`)
2. Verify token mapper configured correctly
3. Test token exchange manually with curl (see [KEYCLOAK-ROLE-SETUP-INT008.md](KEYCLOAK-ROLE-SETUP-INT008.md#step-4-verify-token-exchange-response))

### Tests Fail: "Insufficient permissions"
**Cause:** Roles not included in TE-JWT

**Solution:**
1. Verify client role mapper for `mcp-server-client`
2. Check user role assignments in Keycloak
3. Decode TE-JWT to verify roles claim present

### Tests Fail: PostgreSQL Permission Denied
**Cause:** PostgreSQL roles not configured with correct permissions

**Solution:**
1. Verify PostgreSQL roles exist: `\du` in psql
2. Check table permissions: `\dp` in psql
3. Re-run permission grants (see [Database Schema](#database-schema))

### Tests Fail: "MCP Server connection refused"
**Cause:** Server not running or wrong port

**Solution:**
1. Verify server started: `ps aux | grep node`
2. Check logs for startup errors
3. Verify port 3000 not in use: `netstat -an | findstr 3000`

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `KEYCLOAK_URL` | `http://192.168.1.137:8080` | Keycloak server URL |
| `KEYCLOAK_REALM` | `mcp_security` | Keycloak realm name |
| `MCP_SERVER_URL` | `http://localhost:3000` | MCP server URL |
| `REQUESTOR_CLIENT_ID` | `mcp-oauth` | Public client ID |
| `DEBUG_MCP_RESPONSES` | `false` | Enable debug logging |

## Related Documentation

- [KEYCLOAK-ROLE-SETUP-INT008.md](KEYCLOAK-ROLE-SETUP-INT008.md) - Keycloak configuration guide
- [phase3-test-config.json](config/phase3-test-config.json) - Example configuration
- [CLAUDE.md](../CLAUDE.md) - Framework architecture overview

## Quick Start (One-Line Commands)

```bash
# Full test setup and run (assuming Keycloak + PostgreSQL already configured)
npm run build && \
CONFIG_PATH=./test-harness/config/phase3-test-config.json node dist/index.js & \
sleep 5 && \
npm run test:sql && \
kill %1
```

## Core Framework Tests vs SQL Tests

**Unit Tests** (`npm test` or `npm run test`):
- Runs unit tests in `tests/unit/` directory
- No external dependencies required
- **Does NOT include** integration or SQL tests
- Fast execution, always run in CI/CD

**Core Framework Integration Tests** (`npm run test:phase3`):
- No SQL delegation package required
- Tests OAuth flow, JWT validation, role mapping
- Tests core MCP tools (user-info, health-check)
- Requires Keycloak running

**SQL Delegation Tests** (`npm run test:sql`):
- Requires `@mcp-oauth/sql-delegation` package
- Requires PostgreSQL database configured
- Tests SQL-specific functionality
- Optional - only run if using SQL delegation

**Note:** Integration tests (`test-harness/`) are excluded from `npm test` by default. Run them explicitly with their specific npm scripts.
