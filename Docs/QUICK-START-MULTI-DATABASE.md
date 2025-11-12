# Quick Start: Multi-Database PostgreSQL Setup

This guide shows you exactly how to configure multiple PostgreSQL databases with SQL1, SQL2, SQL3, etc. tool prefixes.

## Configuration File

Create a configuration file (e.g., `multi-db-config.json`) with the following structure:

```json
{
  "auth": {
    "trustedIDPs": [
      {
        "name": "requestor-jwt",
        "issuer": "https://auth.example.com",
        "jwksUri": "https://auth.example.com/.well-known/jwks.json",
        "audience": "mcp-oauth",
        "algorithms": ["RS256"],
        "claimMappings": {
          "legacyUsername": "legacy_name",
          "roles": "roles",
          "scopes": "scope",
          "userId": "sub",
          "username": "preferred_username"
        },
        "roleMappings": {
          "admin": ["admin"],
          "user": ["user"],
          "defaultRole": "guest"
        }
      }
    ]
  },
  "delegation": {
    "modules": {
      "postgresql1": {
        "_comment": "PRIMARY DATABASE",
        "host": "primary-db.example.com",
        "port": 5432,
        "database": "app_db",
        "user": "mcp_service",
        "password": "PASSWORD1",
        "options": { "ssl": true },
        "pool": { "max": 10 }
      },
      "postgresql2": {
        "_comment": "ANALYTICS DATABASE",
        "host": "analytics-db.example.com",
        "port": 5432,
        "database": "analytics",
        "user": "mcp_analytics",
        "password": "PASSWORD2",
        "options": { "ssl": true },
        "pool": { "max": 5 }
      },
      "postgresql3": {
        "_comment": "STAGING DATABASE",
        "host": "staging-db.example.com",
        "port": 5432,
        "database": "staging",
        "user": "mcp_staging",
        "password": "PASSWORD3",
        "options": { "ssl": true },
        "pool": { "max": 3 }
      }
    }
  },
  "mcp": {
    "serverName": "Multi-Database MCP Server",
    "version": "3.0.0",
    "transport": "http-stream",
    "port": 3000,
    "enabledTools": {
      "sql1-delegate": true,
      "sql1-schema": true,
      "sql1-table-details": true,
      "sql2-delegate": true,
      "sql2-schema": true,
      "sql2-table-details": true,
      "sql3-delegate": true,
      "sql3-schema": true,
      "sql3-table-details": true,
      "health-check": true,
      "user-info": true
    }
  }
}
```

## Key Points

### 1. Module Names → Tool Prefixes

| Module Name | Tool Prefix | Database |
|------------|-------------|----------|
| `postgresql1` | `sql1-` | Primary |
| `postgresql2` | `sql2-` | Analytics |
| `postgresql3` | `sql3-` | Staging |

### 2. Required Configuration

**Must have:**
- Module names starting with `postgresql` followed by a number (e.g., `postgresql1`, `postgresql2`)
- Each module must be enabled in `mcp.enabledTools` (e.g., `sql1-delegate: true`)

**Don't use:**
- ❌ `sql-delegate: true` (this is the old single-database tool)
- ✅ `sql1-delegate: true`, `sql2-delegate: true` (new multi-database tools)

### 3. Test Server Code

The `v2-test-server.ts` automatically detects PostgreSQL modules and creates tools:

```typescript
import { FastMCPOAuthServer } from '../src/mcp/server.js';
import { PostgreSQLDelegationModule } from '@fastmcp-oauth/sql-delegation';
import { createSQLToolsForModule } from '../src/mcp/tools/sql-tools-factory.js';

const server = new FastMCPOAuthServer(CONFIG_PATH);
await server.start({ transport: 'httpStream', port: 3000 });

const coreContext = server.getCoreContext();
const delegationConfig = coreContext.configManager.getDelegationConfig();

// Auto-detect PostgreSQL modules (postgresql1, postgresql2, etc.)
const postgresModules = Object.keys(delegationConfig?.modules || {}).filter(
  key => key.startsWith('postgresql')
);

for (const moduleName of postgresModules) {
  const moduleConfig = delegationConfig.modules[moduleName];

  // Initialize module
  const pgModule = new PostgreSQLDelegationModule();
  await pgModule.initialize(moduleConfig);
  await server.registerDelegationModule(moduleName, pgModule);

  // Create tools with prefix (postgresql1 -> sql1)
  const toolPrefix = moduleName.replace('postgresql', 'sql');
  const sqlTools = createSQLToolsForModule({
    toolPrefix,
    moduleName,
    descriptionSuffix: moduleConfig._comment || '',
  });

  server.registerTools(sqlTools.map(factory => factory(coreContext)));
}
```

## Testing

### 1. Start the server:

```bash
export CONFIG_PATH=./test-harness/config/dual-postgresql-config.json
npm run build
node dist/test-harness/v2-test-server.js
```

### 2. List available tools:

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

Expected output:
```json
{
  "result": {
    "tools": [
      { "name": "sql1-delegate", "description": "Execute PostgreSQL queries..." },
      { "name": "sql1-schema", "description": "Get list of tables..." },
      { "name": "sql1-table-details", "description": "Get column details..." },
      { "name": "sql2-delegate", "description": "Execute PostgreSQL queries..." },
      { "name": "sql2-schema", "description": "Get list of tables..." },
      { "name": "sql2-table-details", "description": "Get column details..." },
      { "name": "health-check", "description": "Check service health..." },
      { "name": "user-info", "description": "Get user session..." }
    ]
  }
}
```

### 3. Query primary database (SQL1):

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "sql1-delegate",
      "arguments": {
        "action": "query",
        "sql": "SELECT current_database(), version()",
        "params": []
      }
    },
    "id": 2
  }'
```

### 4. Query analytics database (SQL2):

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "sql2-delegate",
      "arguments": {
        "action": "query",
        "sql": "SELECT current_database(), version()",
        "params": []
      }
    },
    "id": 3
  }'
```

## Troubleshooting

### Issue: Tools appear as `sql-delegate` instead of `sql1-delegate`

**Cause:** The old single-database tools are still enabled in config.

**Solution:** Remove these from `enabledTools`:
```json
{
  "mcp": {
    "enabledTools": {
      // ❌ Remove these:
      "sql-delegate": false,
      "sql-schema": false,
      "sql-table-details": false,

      // ✅ Use these instead:
      "sql1-delegate": true,
      "sql1-schema": true,
      "sql1-table-details": true
    }
  }
}
```

### Issue: Duplicate tools in `tools/list` response

**Cause:** Both default and custom SQL tools are being registered.

**Solution:** The framework automatically detects custom SQL tools (sql1-, sql2-) and excludes defaults. Ensure:
1. Module names are `postgresql1`, `postgresql2` (with numbers)
2. Enabled tools use prefixed names (`sql1-delegate`, not `sql-delegate`)

### Issue: Module not found error

**Error:** `PostgreSQL delegation module 'postgresql2' is not available`

**Solution:** Register the module before creating tools:

```typescript
await server.registerDelegationModule(moduleName, pgModule);
// THEN
server.registerTools(sqlTools);
```

## See Also

- [MULTI-DATABASE-SETUP.md](MULTI-DATABASE-SETUP.md) - Comprehensive guide
- [dual-postgresql-config.json](../test-harness/config/dual-postgresql-config.json) - Example config
- [v2-test-server.ts](../test-harness/v2-test-server.ts) - Reference implementation
