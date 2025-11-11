# Multi-Server Deployment Guide

This guide explains how to deploy multiple MCP servers with this framework and avoid tool name collisions.

## Table of Contents

- [Problem: Tool Name Collisions](#problem-tool-name-collisions)
- [Solution: Tool Prefixes](#solution-tool-prefixes)
- [Automatic Tool Registration (v2.2.0+)](#automatic-tool-registration-v220)
- [Manual Tool Registration (Legacy)](#manual-tool-registration-legacy)
- [Deployment Scenarios](#deployment-scenarios)
- [Configuration Examples](#configuration-examples)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

---

## Problem: Tool Name Collisions

### Scenario

You have multiple MCP servers, each built with this framework:

**Server 1 (HR Database):**
```typescript
const tools = getAllToolFactories();
// Registers: sql-delegate, sql-schema, sql-table-details, health-check, user-info
```

**Server 2 (Sales Database):**
```typescript
const tools = getAllToolFactories();
// Registers: sql-delegate, sql-schema, sql-table-details, health-check, user-info
```

### What Happens

When an LLM client loads both servers:

```
MCP Server 1: sql-delegate (registered)
MCP Server 2: sql-delegate (⚠️ COLLISION - fails to register or overrides)
```

**Result:**
- ❌ Only one server's `sql-delegate` tool is accessible
- ❌ LLM cannot distinguish between databases
- ❌ Queries may go to wrong database
- ❌ Tool calls may fail unexpectedly

---

## Solution: Tool Prefixes

The framework provides **two approaches** to create tools with custom prefixes:

1. **✅ Automatic Registration (v2.2.0+)** - Configuration-driven (recommended, 85% code reduction)
2. **⚠️ Manual Registration (Legacy)** - Code-driven using `createSQLToolsForModule()`

---

## Automatic Tool Registration (v2.2.0+)

**NEW in v2.2.0:** Tools are automatically registered from configuration - no code changes needed!

### Benefits

- **✅ 85% code reduction** - 100+ lines → 15 lines
- **✅ Configuration-only updates** - Change tool names without code changes
- **✅ Consistent naming** - Schema validation enforces naming conventions
- **✅ All module types supported** - SQL, REST API, Kerberos, and future modules
- **✅ Backward compatible** - Existing manual registration still works

### Quick Start

**Step 1: Add `toolPrefix` to `config.json`**

```json
{
  "delegation": {
    "modules": {
      "postgresql1": {
        "toolPrefix": "hr-sql",
        "host": "hr-db.company.com",
        "database": "hr_database"
      },
      "postgresql2": {
        "toolPrefix": "sales-sql",
        "host": "sales-db.company.com",
        "database": "sales_database"
      }
    }
  }
}
```

**Step 2: Start server**

```typescript
import { MCPOAuthServer } from 'fastmcp-oauth-obo';

const server = new MCPOAuthServer('./config.json');
await server.start({ transport: 'httpStream', port: 3000 });

// Tools auto-registered:
// - hr-sql-delegate, hr-sql-schema, hr-sql-table-details
// - sales-sql-delegate, sales-sql-schema, sales-sql-table-details
```

**That's it! No manual tool registration needed.**

### Configuration Reference

See [CONFIGURATION.md](CONFIGURATION.md#delegation-section) for complete configuration options:

- **`defaultToolPrefix`** - Default prefix for all modules (optional, defaults to `"sql"`)
- **`toolPrefix`** - Per-module prefix override (optional, enables auto-registration)

**Validation Rules:**
- Must start with lowercase letter
- Can contain lowercase letters, numbers, and hyphens only
- Maximum 20 characters
- Pattern: `^[a-z][a-z0-9-]*$`

### Supported Module Types

| Module Type | Example `toolPrefix` | Generated Tools |
|-------------|---------------------|-----------------|
| **PostgreSQL** | `"hr-sql"` | `hr-sql-delegate`, `hr-sql-schema`, `hr-sql-table-details` |
| **MSSQL** | `"ms-sql"` | `ms-sql-delegate`, `ms-sql-schema`, `ms-sql-table-details` |
| **MySQL** | `"my-sql"` | `my-sql-delegate`, `my-sql-schema`, `my-sql-table-details` |
| **REST API** | `"api"` | `api-delegate`, `api-health` |
| **Kerberos** | `"krb"` | `krb-delegate`, `krb-health` |

---

## Manual Tool Registration (Legacy)

**Use this approach only if:**
- You need complete control over tool descriptions
- You're using an older version (<v2.2.0)
- You need custom tool registration logic

### Basic Usage

```typescript
import {
  createSQLToolsForModule,
  getAllToolFactories
} from 'fastmcp-oauth-obo';

// Get non-SQL tools
const nonSqlTools = getAllToolFactories({ excludeSqlTools: true });

// Create prefixed SQL tools
const hrTools = createSQLToolsForModule({
  toolPrefix: 'hr',
  moduleName: 'postgresql',
  descriptionSuffix: '(HR Database)'
});

// Register all tools
const allTools = [...nonSqlTools, ...hrTools];
for (const factory of allTools) {
  const tool = factory(coreContext);
  server.addTool({
    name: tool.name,
    description: tool.schema.description,
    parameters: tool.schema,
    execute: tool.handler,
    canAccess: tool.canAccess
  });
}
```

See [TOOL-FACTORIES.md](TOOL-FACTORIES.md) for detailed manual registration examples.

---

## Deployment Scenarios

### Scenario 1: One Database Per Server (Auto-Registration)

**Use Case:** Separate MCP servers for different databases.

**Config (config-hr.json):**
```json
{
  "delegation": {
    "modules": {
      "postgresql": {
        "toolPrefix": "hr",
        "host": "hr-db.company.com",
        "database": "hr_database"
      }
    }
  }
}
```

**Config (config-sales.json):**
```json
{
  "delegation": {
    "modules": {
      "postgresql": {
        "toolPrefix": "sales",
        "host": "sales-db.company.com",
        "database": "sales_database"
      }
    }
  }
}
```

**Server Code (same for all):**
```typescript
const server = new MCPOAuthServer('./config.json');
await server.start({ transport: 'httpStream', port: 3000 });
```

**Result:**
- HR Server: `hr-delegate`, `hr-schema`, `hr-table-details`
- Sales Server: `sales-delegate`, `sales-schema`, `sales-table-details`

---

### Scenario 2: Multiple Databases Per Server (Auto-Registration)

**Use Case:** Single server connecting to multiple databases.

**Config:**
```json
{
  "delegation": {
    "defaultToolPrefix": "sql",
    "modules": {
      "postgresql1": {
        "toolPrefix": "hr",
        "host": "hr-db.company.com",
        "database": "hr_database"
      },
      "postgresql2": {
        "toolPrefix": "sales",
        "host": "sales-db.company.com",
        "database": "sales_database"
      }
    }
  }
}
```

**Server Code:**
```typescript
const server = new MCPOAuthServer('./config.json');
await server.start({ transport: 'httpStream', port: 3000 });

// All tools auto-registered:
// - hr-delegate, hr-schema, hr-table-details
// - sales-delegate, sales-schema, sales-table-details
// - health-check, user-info
```

---

### Scenario 3: Multi-Tenant SaaS (Auto-Registration)

**Use Case:** Separate database per tenant.

**Config:**
```json
{
  "delegation": {
    "modules": {
      "postgresql_acme": {
        "toolPrefix": "acme",
        "host": "db.company.com",
        "database": "acme_db"
      },
      "postgresql_widgets": {
        "toolPrefix": "widgets",
        "host": "db.company.com",
        "database": "widgets_db"
      }
    }
  }
}
```

**Tool Names:**
- Acme: `acme-delegate`, `acme-schema`, `acme-table-details`
- Widgets: `widgets-delegate`, `widgets-schema`, `widgets-table-details`

---

### Scenario 4: Different Database Types (Auto-Registration)

**Use Case:** PostgreSQL, MSSQL, and MySQL from one server.

**Config:**
```json
{
  "delegation": {
    "modules": {
      "postgresql": {
        "toolPrefix": "pg",
        "type": "postgresql",
        "host": "pg.company.com",
        "database": "transactional_db"
      },
      "mssql": {
        "toolPrefix": "ms",
        "type": "mssql",
        "server": "ms.company.com",
        "database": "legacy_db"
      }
    }
  }
}
```

**Tool Names:**
- PostgreSQL: `pg-delegate`, `pg-schema`, `pg-table-details`
- MSSQL: `ms-delegate`, `ms-schema`, `ms-table-details`

---

## Configuration Examples

### Example 1: Auto-Registration with Multiple Databases

```json
{
  "auth": {
    "trustedIDPs": [{
      "name": "requestor-jwt",
      "issuer": "https://auth.company.com",
      "jwksUri": "https://auth.company.com/.well-known/jwks.json",
      "audience": "mcp-oauth",
      "claimMappings": {
        "legacyUsername": "legacy_sam_account",
        "roles": "user_roles"
      }
    }]
  },
  "delegation": {
    "defaultToolPrefix": "sql",
    "modules": {
      "postgresql1": {
        "toolPrefix": "hr-sql",
        "host": "hr-db.company.com",
        "database": "hr_database"
      },
      "postgresql2": {
        "toolPrefix": "sales-sql",
        "host": "sales-db.company.com",
        "database": "sales_database"
      }
    }
  },
  "mcp": {
    "serverName": "Multi-Database MCP Server",
    "port": 3000
  }
}
```

**Server Code (15 lines):**
```typescript
import { MCPOAuthServer } from 'fastmcp-oauth-obo';

async function main() {
  const server = new MCPOAuthServer('./config.json');
  await server.start({ transport: 'httpStream', port: 3000 });

  console.log('✅ Server running on port 3000');
  console.log('✅ Tools auto-registered from config');
}

main().catch(console.error);
```

**Before (Manual - 100+ lines):**
```typescript
// Extensive manual tool registration boilerplate...
const coreContext = server.getCoreContext();
const hrTools = createSQLToolsForModule({ toolPrefix: 'hr-sql', moduleName: 'postgresql1' });
// ... 80+ more lines
```

**Code Reduction:** 85% (100+ lines → 15 lines)

---

## Best Practices

### 1. Use Auto-Registration (v2.2.0+)

**✅ Recommended:**
```json
{
  "delegation": {
    "modules": {
      "postgresql": { "toolPrefix": "hr", "host": "localhost" }
    }
  }
}
```

**⚠️ Legacy (still supported):**
```typescript
const hrTools = createSQLToolsForModule({ toolPrefix: 'hr', moduleName: 'postgresql' });
```

### 2. Prefix Naming Convention

| Scenario | Recommended Prefix | Example Tools |
|----------|-------------------|---------------|
| **Descriptive** | `hr`, `sales`, `analytics` | `hr-delegate`, `sales-delegate` |
| **Short** | `db1`, `db2`, `db3` | `db1-delegate`, `db2-delegate` |
| **Type-based** | `pg`, `ms`, `my` | `pg-delegate`, `ms-delegate` |
| **Tenant-based** | `acme`, `widgets` | `acme-delegate`, `widgets-delegate` |
| **❌ Avoid** | `database`, `sql` | Too generic |

### 3. Set Default Prefix

```json
{
  "delegation": {
    "defaultToolPrefix": "db",
    "modules": {
      "postgresql1": { "host": "localhost" },  // Uses "db-*"
      "postgresql2": { "toolPrefix": "hr-db", "host": "localhost" }  // Override
    }
  }
}
```

### 4. Document Tool Prefixes

```markdown
## Available Tools

### HR Database
- `hr-delegate` - Query HR database
- `hr-schema` - List HR schemas
- `hr-table-details` - Get HR table details

### Sales Database
- `sales-delegate` - Query Sales database
- `sales-schema` - List Sales schemas
- `sales-table-details` - Get Sales table details
```

---

## Troubleshooting

### Issue 1: Tools Not Auto-Registering

**Symptom:** No tools after adding `toolPrefix` to config.

**Solution:** Use `MCPOAuthServer` wrapper:

**✅ Correct:**
```typescript
const server = new MCPOAuthServer('./config.json');
await server.start({ transport: 'httpStream', port: 3000 });
```

**❌ Incorrect:**
```typescript
// Manual initialization doesn't support auto-registration
const configManager = new ConfigManager();
await configManager.loadConfig('./config.json');
```

### Issue 2: Invalid `toolPrefix` Value

**Symptom:** Validation error on startup.

**❌ Invalid:**
```json
{ "toolPrefix": "HR_SQL" }  // Uppercase/underscore not allowed
```

**✅ Valid:**
```json
{ "toolPrefix": "hr-sql" }  // Lowercase with hyphen
```

### Issue 3: Tool Name Collisions

**Symptom:** Duplicate tool names across servers.

**Solution:** Add `toolPrefix` to each module:

```json
{
  "delegation": {
    "modules": {
      "postgresql1": { "toolPrefix": "hr", "host": "localhost" },
      "postgresql2": { "toolPrefix": "sales", "host": "localhost" }
    }
  }
}
```

### Issue 4: Module Not Found

**Symptom:** Error: "Module not found: postgresql1"

**Solution:** Ensure module names match in config and registration:

```json
{
  "delegation": {
    "modules": {
      "postgresql1": {  // ← Must match module name
        "toolPrefix": "hr",
        "host": "localhost"
      }
    }
  }
}
```

---

## Additional Resources

- **[CONFIGURATION.md](CONFIGURATION.md)** - Complete configuration reference with `toolPrefix` and `defaultToolPrefix` details
- **[TOOL-FACTORIES.md](TOOL-FACTORIES.md)** - Tool creation approaches (built-in, auto-registration, factory, manual)
- **[examples/multi-module-auto-registration.ts](../examples/multi-module-auto-registration.ts)** - Complete working example
- **[README.md](../README.md)** - Framework overview

**Questions?** Open an issue at https://github.com/your-org/mcp-oauth-framework/issues
