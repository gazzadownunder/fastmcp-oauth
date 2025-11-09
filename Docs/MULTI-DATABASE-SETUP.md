# Multi-Database PostgreSQL Setup

This guide explains how to configure and use multiple PostgreSQL database instances with the MCP OAuth framework, each with its own set of SQL tools.

## Overview

The framework supports multiple PostgreSQL database connections, each registered as a separate delegation module with its own set of tools. This enables scenarios like:

- **Primary and Analytics Databases** - Separate read-only analytics database
- **Multi-Tenant Databases** - Different databases for different tenants
- **Regional Databases** - Geographically distributed databases
- **Development and Production** - Multiple environments in testing

## Architecture

Each PostgreSQL module gets:
- **Unique module name** (e.g., `postgresql1`, `postgresql2`)
- **Unique tool prefix** (e.g., `sql1-`, `sql2-`)
- **Independent connection pool** and configuration
- **Separate token exchange** configuration (optional)

```
┌─────────────────────────────────────────────────────────────┐
│                     MCP OAuth Server                        │
└─────────────────────────────────────────────────────────────┘
                           │
          ┌────────────────┼───────────────┐
          │                │               │
    ┌─────▼─────┐    ┌─────▼─────┐    ┌────▼──────┐
    │   sql1-   │    │   sql2-   │    │   sql3-   │
    │ delegate  │    │ delegate  │    │ delegate  │
    │ schema    │    │ schema    │    │ schema    │
    │table-det. │    │table-det. │    │table-det. │
    └─────┬─────┘    └─────┬─────┘    └────┬──────┘
          │                │               │
    ┌─────▼─────┐    ┌─────▼─────┐    ┌────▼──────┐
    │postgresql1│    │postgresql2│    │postgresql3│
    │  Module   │    │  Module   │    │  Module   │
    └─────┬─────┘    └─────┬─────┘    └────┬──────┘
          │                │               │
    ┌─────▼─────┐    ┌─────▼─────┐    ┌────▼──────┐
    │  Primary  │    │ Analytics │    │  Staging  │
    │   DB      │    │    DB     │    │    DB     │
    └───────────┘    └───────────┘    └───────────┘
```

## Configuration

### Step 1: Define Multiple PostgreSQL Modules

In your configuration file (e.g., `dual-postgresql-config.json`):

```json
{
  "delegation": {
    "modules": {
      "postgresql1": {
        "_comment": "PRIMARY DATABASE - Main application database",
        "host": "localhost",
        "port": 5432,
        "database": "postgres",
        "user": "mcp_service",
        "password": "ServicePass123!",
        "options": {
          "ssl": false
        },
        "pool": {
          "max": 10,
          "min": 0,
          "idleTimeoutMillis": 30000,
          "connectionTimeoutMillis": 5000
        },
        "tokenExchange": {
          "idpName": "sql-delegation-te-jwt",
          "tokenEndpoint": "http://auth.example.com/token",
          "clientId": "mcp-server-client",
          "clientSecret": "SECRET",
          "audience": "mcp-server-client",
          "requiredClaim": "legacy_name",
          "cache": {
            "enabled": true,
            "ttlSeconds": 60
          }
        }
      },
      "postgresql2": {
        "_comment": "SECONDARY DATABASE - Analytics/Reporting database",
        "host": "analytics-db.example.com",
        "port": 5432,
        "database": "analytics_db",
        "user": "mcp_analytics",
        "password": "AnalyticsPass123!",
        "options": {
          "ssl": true
        },
        "pool": {
          "max": 5,
          "min": 0,
          "idleTimeoutMillis": 30000,
          "connectionTimeoutMillis": 5000
        },
        "tokenExchange": {
          "idpName": "sql-delegation-te-jwt",
          "tokenEndpoint": "http://auth.example.com/token",
          "clientId": "mcp-server-client",
          "clientSecret": "SECRET",
          "audience": "mcp-server-client",
          "requiredClaim": "legacy_name",
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

### Step 2: Enable Tools in MCP Config

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

### Step 3: Register Modules in Server Code

The `v2-test-server.ts` automatically detects and registers all PostgreSQL modules:

```typescript
import { MCPOAuthServer } from '../src/mcp/server.js';
import { PostgreSQLDelegationModule } from '@mcp-oauth/sql-delegation';
import { createSQLToolsForModule } from '../src/mcp/tools/sql-tools-factory.js';

// ... server setup ...

const delegationConfig = coreContext.configManager.getDelegationConfig();

// Register PostgreSQL modules dynamically
const postgresModules = Object.keys(delegationConfig?.modules || {}).filter(
  key => key.startsWith('postgresql')
);

for (const moduleName of postgresModules) {
  const moduleConfig = delegationConfig.modules[moduleName];
  const pgModule = new PostgreSQLDelegationModule();

  // Initialize module
  await pgModule.initialize(moduleConfig);
  await server.registerDelegationModule(moduleName, pgModule);

  // Create and register SQL tools
  const toolPrefix = moduleName.replace('postgresql', 'sql');
  const descriptionSuffix = moduleConfig._comment || '';

  const sqlTools = createSQLToolsForModule({
    toolPrefix,
    moduleName,
    descriptionSuffix,
  });

  server.registerTools(sqlTools.map(factory => factory(coreContext)));
}
```

## Tool Naming Convention

| Module Name | Tool Prefix | Tools Generated |
|------------|-------------|-----------------|
| `postgresql` | `sql` | `sql-delegate`, `sql-schema`, `sql-table-details` |
| `postgresql1` | `sql1` | `sql1-delegate`, `sql1-schema`, `sql1-table-details` |
| `postgresql2` | `sql2` | `sql2-delegate`, `sql2-schema`, `sql2-table-details` |
| `postgresqlN` | `sqlN` | `sqlN-delegate`, `sqlN-schema`, `sqlN-table-details` |

## Usage Examples

### Query Primary Database (SQL1)

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "sql1-delegate",
      "arguments": {
        "action": "query",
        "sql": "SELECT * FROM users WHERE id = $1",
        "params": [123]
      }
    },
    "id": 1
  }'
```

### Query Analytics Database (SQL2)

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "sql2-delegate",
      "arguments": {
        "action": "query",
        "sql": "SELECT date, total_revenue FROM daily_sales WHERE date > $1",
        "params": ["2025-01-01"]
      }
    },
    "id": 2
  }'
```

### Get Schema from Primary Database

```bash
curl -X POST http://localhost:3000/mcp \
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
    "id": 3
  }'
```

### Get Table Details from Analytics Database

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "sql2-table-details",
      "arguments": {
        "tableName": "daily_sales",
        "schemaName": "public"
      }
    },
    "id": 4
  }'
```

## Advanced: Custom Tool Prefixes

You can customize tool prefixes beyond the automatic naming:

```typescript
const sqlTools = createSQLToolsForModule({
  toolPrefix: 'primary-db',      // Custom prefix
  moduleName: 'postgresql1',
  descriptionSuffix: '(Production Database)',
});

// Generates: primary-db-delegate, primary-db-schema, primary-db-table-details
```

## Security Considerations

### Per-Module Token Exchange

Each PostgreSQL module can have its own token exchange configuration:

- **Different audiences** - Separate authorization scopes per database
- **Different credentials** - Separate service accounts per database
- **Independent caching** - Each module has its own token cache

### Role-Based Access Control

Use different role mappings for different databases:

```json
{
  "auth": {
    "trustedIDPs": [
      {
        "name": "primary-db-jwt",
        "audience": "primary-db",
        "roleMappings": {
          "admin": ["db-admin"],
          "user": ["db-user"]
        }
      },
      {
        "name": "analytics-db-jwt",
        "audience": "analytics-db",
        "roleMappings": {
          "analyst": ["data-analyst"],
          "viewer": ["read-only"]
        }
      }
    ]
  }
}
```

### Connection Pool Sizing

Adjust pool sizes based on expected load:

- **Primary database** - Higher `max` for write-heavy workloads
- **Analytics database** - Lower `max` for read-only queries
- **Staging database** - Minimal `max` for testing

## Testing

### Test Configuration

Use the provided test configuration:

```bash
export CONFIG_PATH=./test-harness/config/dual-postgresql-config.json
export SERVER_PORT=3000
npm run build
node dist/test-harness/v2-test-server.js
```

### Verify Tools Registration

Check server startup logs:

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
```

### List Available Tools

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

## Troubleshooting

### Module Not Found Error

**Error:** `PostgreSQL delegation module 'postgresql2' is not available`

**Solution:** Ensure the module is registered before tools are created:

```typescript
await server.registerDelegationModule(moduleName, pgModule);
// THEN
server.registerTools(sqlTools);
```

### Tool Not Listed

**Error:** Tool doesn't appear in `tools/list` response

**Solution:** Check `mcp.enabledTools` configuration:

```json
{
  "mcp": {
    "enabledTools": {
      "sql2-delegate": true  // Must be enabled
    }
  }
}
```

### Connection Pool Exhausted

**Error:** `TimeoutError: ResourceRequest timed out`

**Solution:** Increase pool size or reduce connection timeout:

```json
{
  "pool": {
    "max": 20,  // Increase from 10
    "connectionTimeoutMillis": 10000  // Increase to 10s
  }
}
```

## API Reference

### `createSQLToolsForModule(config)`

Creates SQL tools for a specific PostgreSQL module.

**Parameters:**
- `config.toolPrefix` - Tool name prefix (e.g., 'sql1', 'sql2')
- `config.moduleName` - Delegation module name (e.g., 'postgresql1')
- `config.descriptionSuffix` - Optional suffix for tool descriptions

**Returns:** Array of `ToolFactory` functions

**Example:**

```typescript
import { createSQLToolsForModule } from 'mcp-oauth-framework';

const sql1Tools = createSQLToolsForModule({
  toolPrefix: 'sql1',
  moduleName: 'postgresql1',
  descriptionSuffix: '(Primary Database)'
});

const sql2Tools = createSQLToolsForModule({
  toolPrefix: 'sql2',
  moduleName: 'postgresql2',
  descriptionSuffix: '(Analytics Database)'
});

server.registerTools([
  ...sql1Tools.map(factory => factory(coreContext)),
  ...sql2Tools.map(factory => factory(coreContext))
]);
```

## See Also

- [EXTENDING.md](EXTENDING.md) - Framework extension patterns
- [NPM-LIBRARY-VERIFICATION.md](NPM-LIBRARY-VERIFICATION.md) - OAuth library verification
- [phase3-test-config.json](../test-harness/config/phase3-test-config.json) - Single database example
- [dual-postgresql-config.json](../test-harness/config/dual-postgresql-config.json) - Multi-database example
