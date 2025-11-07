# Phase 3 Test Server - Multi-Database Configuration

## Overview

The Phase 3 test server now supports **multiple PostgreSQL database instances** with separate tool sets:

- **SQL1 Tools** → Primary database (`postgres`)
- **SQL2 Tools** → Analytics database (`analytics_db`)

Each database has its own connection pool, token exchange configuration, and delegation module.

## Quick Start

### 1. Start the Server

```bash
cd test-harness
start-phase3-server.bat
```

Or manually:

```bash
npm run build
set CONFIG_PATH=./test-harness/config/phase3-test-config.json
set SERVER_PORT=3010
node dist/test-harness/v2-test-server.js
```

### 2. Verify Tool Registration

The server should display:

```
[3/3] Checking for delegation modules...
      Found 2 PostgreSQL module(s) in config

      Registering PostgreSQL module: postgresql1
      Initializing connection to postgres@localhost:5432...
✓     PostgreSQL connection initialized for postgresql1
      Creating SQL tools with prefix 'sql1' for module 'postgresql1'...
✓     Registered 3 SQL tools for 'postgresql1'

      Registering PostgreSQL module: postgresql2
      Initializing connection to analytics_db@localhost:5432...
✓     PostgreSQL connection initialized for postgresql2
      Creating SQL tools with prefix 'sql2' for module 'postgresql2'...
✓     Registered 3 SQL tools for 'postgresql2'

Available Tools:
  • health-check      - Check delegation service health
  • user-info         - Get current user session info

  SQL1 Tools (PRIMARY DATABASE - Main PostgreSQL database):
  • sql1-delegate      - Execute SQL queries with positional params ($1, $2, etc.)
  • sql1-schema        - Get list of tables in database schema
  • sql1-table-details - Get column details for a specific table

  SQL2 Tools (SECONDARY DATABASE - Analytics/Testing database):
  • sql2-delegate      - Execute SQL queries with positional params ($1, $2, etc.)
  • sql2-schema        - Get list of tables in database schema
  • sql2-table-details - Get column details for a specific table
```

## Configuration

### Database Modules

Located in [config/phase3-test-config.json](config/phase3-test-config.json):

```json
{
  "delegation": {
    "modules": {
      "postgresql1": {
        "_comment": "PRIMARY DATABASE - Main PostgreSQL database",
        "host": "localhost",
        "port": 5432,
        "database": "postgres",
        "user": "mcp_service",
        "password": "ServicePass123!"
      },
      "postgresql2": {
        "_comment": "SECONDARY DATABASE - Analytics/Testing database",
        "host": "localhost",
        "port": 5432,
        "database": "analytics_db",
        "user": "mcp_service",
        "password": "ServicePass123!"
      }
    }
  }
}
```

### Enabled Tools

```json
{
  "mcp": {
    "enabledTools": {
      "sql1-delegate": true,
      "sql1-schema": true,
      "sql1-table-details": true,
      "sql2-delegate": true,
      "sql2-schema": true,
      "sql2-table-details": true,
      "health-check": true,
      "user-info": true
    }
  }
}
```

## Testing

### Get JWT Token

```bash
# Replace with your Keycloak credentials
curl -X POST http://192.168.1.137:8080/realms/mcp_security/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=mcp-oauth" \
  -d "client_secret=YOUR_SECRET" \
  -d "grant_type=password" \
  -d "username=alice" \
  -d "password=alice123" \
  | jq -r '.access_token'
```

### List Available Tools

```bash
curl -X POST http://localhost:3010/mcp \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' \
  | jq '.result.tools[].name'
```

Expected output:
```
sql1-delegate
sql1-schema
sql1-table-details
sql2-delegate
sql2-schema
sql2-table-details
health-check
user-info
```

### Query Primary Database (SQL1)

```bash
curl -X POST http://localhost:3010/mcp \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "sql1-delegate",
      "arguments": {
        "action": "query",
        "sql": "SELECT current_database(), current_user, version()",
        "params": []
      }
    },
    "id": 2
  }' | jq
```

### Query Analytics Database (SQL2)

```bash
curl -X POST http://localhost:3010/mcp \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "sql2-delegate",
      "arguments": {
        "action": "query",
        "sql": "SELECT current_database(), current_user, version()",
        "params": []
      }
    },
    "id": 3
  }' | jq
```

### Get Schema from Primary Database

```bash
curl -X POST http://localhost:3010/mcp \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "sql1-schema",
      "arguments": {
        "schemaName": "public"
      }
    },
    "id": 4
  }' | jq
```

### Get Table Details from Analytics Database

```bash
curl -X POST http://localhost:3010/mcp \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "sql2-table-details",
      "arguments": {
        "tableName": "analytics_events",
        "schemaName": "public"
      }
    },
    "id": 5
  }' | jq
```

## Architecture

### Tool Naming Convention

| Module Name | Tool Prefix | Database | Description |
|------------|-------------|----------|-------------|
| `postgresql1` | `sql1-` | `postgres` | Primary application database |
| `postgresql2` | `sql2-` | `analytics_db` | Analytics/testing database |

### Generated Tools Per Module

Each PostgreSQL module generates 3 tools:

1. **`{prefix}-delegate`** - Execute SQL queries with parameterized statements
2. **`{prefix}-schema`** - Get list of tables in schema
3. **`{prefix}-table-details`** - Get column details for specific table

### Token Exchange Flow

Each database module has independent token exchange:

```
Requestor JWT (aud: mcp-oauth)
           ↓
    Token Exchange Service
           ↓
  ┌────────┴─────────┐
  ↓                  ↓
SQL1 TE-JWT    SQL2 TE-JWT
(for postgres) (for analytics_db)
  ↓                  ↓
SET ROLE alice  SET ROLE alice
```

## Database Setup

### Create Analytics Database (PostgreSQL)

```sql
-- Connect as postgres user
CREATE DATABASE analytics_db;

-- Create service account (if not exists)
CREATE USER mcp_service WITH PASSWORD 'ServicePass123!';

-- Create test roles
CREATE ROLE alice LOGIN PASSWORD 'alice123';
CREATE ROLE bob LOGIN PASSWORD 'bob123';

-- Grant permissions
GRANT mcp_service TO alice, bob;
GRANT CONNECT ON DATABASE analytics_db TO alice, bob;

\c analytics_db

-- Create sample analytics table
CREATE TABLE analytics_events (
  id SERIAL PRIMARY KEY,
  event_name TEXT NOT NULL,
  user_id TEXT,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  properties JSONB
);

-- Grant access to roles
GRANT SELECT, INSERT ON analytics_events TO alice, bob;
GRANT USAGE ON SEQUENCE analytics_events_id_seq TO alice, bob;
```

## Troubleshooting

### Issue: Database Connection Failed

**Error:** `connection to server at "localhost" (::1), port 5432 failed`

**Solution:**
1. Ensure PostgreSQL is running: `pg_ctl status`
2. Check database exists: `psql -l | grep analytics_db`
3. Verify user credentials: `psql -U mcp_service -d postgres`

### Issue: Tools Show as `sql-delegate` Instead of `sql1-delegate`

**Cause:** Old configuration still using single-database setup.

**Solution:**
1. Ensure `postgresql1` and `postgresql2` module names (not `postgresql`)
2. Ensure `enabledTools` has `sql1-delegate`, `sql2-delegate` (not `sql-delegate`)
3. Rebuild: `npm run build`

### Issue: Duplicate Tools in `tools/list`

**Cause:** Both default and custom SQL tools registered.

**Solution:** The framework automatically excludes default SQL tools when custom ones are detected. Ensure module names follow the pattern `postgresql1`, `postgresql2`, etc.

## Adding More Databases

To add a third database (`sql3`):

1. **Add module to config:**

```json
{
  "delegation": {
    "modules": {
      "postgresql3": {
        "_comment": "STAGING DATABASE",
        "host": "staging-db.example.com",
        "port": 5432,
        "database": "staging",
        "user": "mcp_staging",
        "password": "PASSWORD"
      }
    }
  }
}
```

2. **Enable tools:**

```json
{
  "mcp": {
    "enabledTools": {
      "sql3-delegate": true,
      "sql3-schema": true,
      "sql3-table-details": true
    }
  }
}
```

3. **Restart server** - Tools are registered automatically!

## See Also

- [../Docs/MULTI-DATABASE-SETUP.md](../Docs/MULTI-DATABASE-SETUP.md) - Comprehensive guide
- [../Docs/QUICK-START-MULTI-DATABASE.md](../Docs/QUICK-START-MULTI-DATABASE.md) - Quick reference
- [config/phase3-test-config.json](config/phase3-test-config.json) - Configuration file
- [v2-test-server.ts](v2-test-server.ts) - Server implementation
