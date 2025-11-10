# Multi-Server Deployment Guide

This guide explains how to deploy multiple MCP servers with this framework and avoid tool name collisions.

## Table of Contents

- [Problem: Tool Name Collisions](#problem-tool-name-collisions)
- [Solution: Tool Prefixes](#solution-tool-prefixes)
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

The framework provides `createSQLToolsForModule()` to create tools with custom prefixes.

### Basic Usage

```typescript
import { createSQLToolsForModule } from 'fastmcp-oauth-obo';

// Create tools with 'hr' prefix
const hrTools = createSQLToolsForModule('hr', 'postgresql');

// Result: hr-delegate, hr-schema, hr-table-details
```

### Complete Example

**Server 1 (HR Database - server-hr.ts):**
```typescript
import { FastMCP } from 'fastmcp';
import {
  ConfigManager,
  ConfigOrchestrator,
  MCPAuthMiddleware,
  createSQLToolsForModule,
  createHealthCheckTool,
  createUserInfoTool
} from 'fastmcp-oauth-obo';

async function main() {
  // Setup CoreContext
  const configManager = new ConfigManager();
  await configManager.loadConfig('./config-hr.json');

  const orchestrator = new ConfigOrchestrator({ configManager, enableAudit: true });
  const coreContext = await orchestrator.buildCoreContext();
  await coreContext.authService.initialize();

  // Create FastMCP server
  const middleware = new MCPAuthMiddleware(coreContext.authService);
  const server = new FastMCP({
    name: 'HR Database Server',
    version: '1.0.0',
    authenticate: middleware.authenticate.bind(middleware)
  });

  // Register HR-prefixed SQL tools
  const hrTools = createSQLToolsForModule('hr', 'postgresql', '(HR Database)');
  for (const factory of hrTools) {
    const tool = factory(coreContext);
    server.addTool({
      name: tool.name,
      description: tool.schema.description,
      parameters: tool.schema,
      execute: tool.handler,
      canAccess: tool.canAccess
    });
  }

  // Register shared tools (no prefix)
  const sharedTools = [createHealthCheckTool, createUserInfoTool];
  for (const factory of sharedTools) {
    const tool = factory(coreContext);
    server.addTool({
      name: tool.name,
      description: tool.schema.description,
      parameters: tool.schema,
      execute: tool.handler,
      canAccess: tool.canAccess
    });
  }

  await server.start({ transportType: 'httpStream', httpStream: { port: 3001 } });
  console.log('HR Server running on port 3001');
  console.log('Tools: hr-delegate, hr-schema, hr-table-details, health-check, user-info');
}

main().catch(console.error);
```

**Server 2 (Sales Database - server-sales.ts):**
```typescript
// Same as above, but with 'sales' prefix and different port

const salesTools = createSQLToolsForModule('sales', 'postgresql', '(Sales Database)');
// ...
await server.start({ transportType: 'httpStream', httpStream: { port: 3002 } });
```

**Result:**
- ✅ **HR Server (port 3001):** `hr-delegate`, `hr-schema`, `hr-table-details`, `health-check`, `user-info`
- ✅ **Sales Server (port 3002):** `sales-delegate`, `sales-schema`, `sales-table-details`, `health-check`, `user-info`
- ✅ No tool name collisions!

### Using Tools from Multiple Servers

**LLM Client:**
```typescript
// Connect to both servers
const hrServer = new MCPClient('http://localhost:3001/mcp');
const salesServer = new MCPClient('http://localhost:3002/mcp');

// Query HR database
const hrResults = await hrServer.callTool('hr-delegate', {
  action: 'query',
  sql: 'SELECT * FROM employees WHERE department = $1',
  params: ['Engineering']
});

// Query Sales database
const salesResults = await salesServer.callTool('sales-delegate', {
  action: 'query',
  sql: 'SELECT * FROM orders WHERE status = $1',
  params: ['pending']
});
```

---

## Deployment Scenarios

### Scenario 1: One Database Per Server

**Use Case:** Separate MCP servers for different databases.

**Example:**
- Server 1: HR Database (PostgreSQL on hr-db.company.com)
- Server 2: Sales Database (PostgreSQL on sales-db.company.com)
- Server 3: Analytics Database (PostgreSQL on analytics-db.company.com)

**Implementation:**

```typescript
// Server 1 (HR)
const hrTools = createSQLToolsForModule('hr', 'postgresql', '(HR Database)');

// Server 2 (Sales)
const salesTools = createSQLToolsForModule('sales', 'postgresql', '(Sales Database)');

// Server 3 (Analytics)
const analyticsTools = createSQLToolsForModule('analytics', 'postgresql', '(Analytics Database)');
```

**Tool Names:**
- Server 1: `hr-delegate`, `hr-schema`, `hr-table-details`
- Server 2: `sales-delegate`, `sales-schema`, `sales-table-details`
- Server 3: `analytics-delegate`, `analytics-schema`, `analytics-table-details`

---

### Scenario 2: Multiple Databases Per Server

**Use Case:** One MCP server connects to multiple databases.

**Example:**
- Single server connecting to HR and Sales databases

**Implementation:**

```typescript
import {
  createSQLToolsForModule,
  getAllToolFactories
} from 'fastmcp-oauth-obo';

async function main() {
  // Setup CoreContext
  // ... (see above)

  // Get non-SQL tools
  const nonSqlTools = getAllToolFactories({ excludeSqlTools: true });

  // Create prefixed SQL tools for each database
  const hrTools = createSQLToolsForModule('hr', 'postgresql1', '(HR Database)');
  const salesTools = createSQLToolsForModule('sales', 'postgresql2', '(Sales Database)');

  // Register all tools
  const allTools = [...nonSqlTools, ...hrTools, ...salesTools];
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

  await server.start({ transportType: 'httpStream', httpStream: { port: 3000 } });
  console.log('Server tools:', [
    'hr-delegate', 'hr-schema', 'hr-table-details',
    'sales-delegate', 'sales-schema', 'sales-table-details',
    'health-check', 'user-info'
  ]);
}
```

**Configuration (config.json):**
```json
{
  "delegation": {
    "modules": {
      "postgresql1": {
        "host": "hr-db.company.com",
        "port": 5432,
        "database": "hr_database",
        "user": "mcp_service",
        "password": "SECRET1",
        "tokenExchange": {
          "idpName": "requestor-jwt",
          "audience": "urn:db:hr"
        }
      },
      "postgresql2": {
        "host": "sales-db.company.com",
        "port": 5432,
        "database": "sales_database",
        "user": "mcp_service",
        "password": "SECRET2",
        "tokenExchange": {
          "idpName": "requestor-jwt",
          "audience": "urn:db:sales"
        }
      }
    }
  }
}
```

---

### Scenario 3: Multi-Tenant SaaS

**Use Case:** Separate database per tenant with tenant isolation.

**Example:**
- Tenant 1: Acme Corp
- Tenant 2: Widgets Inc
- Tenant 3: Gadgets Ltd

**Implementation:**

```typescript
// Create tools for each tenant
const acmeTools = createSQLToolsForModule('acme', 'postgresql_acme', '(Acme Corp)');
const widgetsTools = createSQLToolsForModule('widgets', 'postgresql_widgets', '(Widgets Inc)');
const gadgetsTools = createSQLToolsForModule('gadgets', 'postgresql_gadgets', '(Gadgets Ltd)');

// Register all tenant tools
const allTools = [...acmeTools, ...widgetsTools, ...gadgetsTools];
for (const factory of allTools) {
  const tool = factory(coreContext);
  server.addTool({ ...tool });
}
```

**Tool Names:**
- Acme: `acme-delegate`, `acme-schema`, `acme-table-details`
- Widgets: `widgets-delegate`, `widgets-schema`, `widgets-table-details`
- Gadgets: `gadgets-delegate`, `gadgets-schema`, `gadgets-table-details`

**Authorization:** Configure role mappings per tenant in JWT claims or use custom `canAccess()` logic to restrict tenant access.

---

### Scenario 4: Different Database Types

**Use Case:** Connect to PostgreSQL, MSSQL, and MySQL from one server.

**Example:**
- PostgreSQL for transactional data
- MSSQL for legacy data
- MySQL for analytics

**Implementation:**

```typescript
const pgTools = createSQLToolsForModule('pg', 'postgresql', '(PostgreSQL)');
const msTools = createSQLToolsForModule('ms', 'mssql', '(SQL Server)');
const myTools = createSQLToolsForModule('my', 'mysql', '(MySQL)');

const allTools = [...pgTools, ...msTools, ...myTools];
// Register...
```

**Tool Names:**
- PostgreSQL: `pg-delegate`, `pg-schema`, `pg-table-details`
- MSSQL: `ms-delegate`, `ms-schema`, `ms-table-details`
- MySQL: `my-delegate`, `my-schema`, `my-table-details`

---

## Configuration Examples

### Example 1: Single Server, Two Databases

**File:** `config.json`

```json
{
  "auth": {
    "trustedIDPs": [{
      "issuer": "https://auth.company.com",
      "jwksUri": "https://auth.company.com/.well-known/jwks.json",
      "audience": "mcp-oauth"
    }]
  },
  "delegation": {
    "modules": {
      "postgresql1": {
        "host": "db1.company.com",
        "database": "database1",
        "tokenExchange": { "audience": "urn:db:db1" }
      },
      "postgresql2": {
        "host": "db2.company.com",
        "database": "database2",
        "tokenExchange": { "audience": "urn:db:db2" }
      }
    }
  },
  "mcp": {
    "serverName": "Multi-Database MCP Server",
    "port": 3000
  }
}
```

**Server Code:**
```typescript
const db1Tools = createSQLToolsForModule('db1', 'postgresql1');
const db2Tools = createSQLToolsForModule('db2', 'postgresql2');
// Register both...
```

### Example 2: Separate Servers, One Database Each

**File:** `config-hr.json` (HR Server)

```json
{
  "auth": {
    "trustedIDPs": [{ "issuer": "https://auth.company.com", "audience": "mcp-oauth" }]
  },
  "delegation": {
    "modules": {
      "postgresql": {
        "host": "hr-db.company.com",
        "database": "hr_database",
        "tokenExchange": { "audience": "urn:db:hr" }
      }
    }
  },
  "mcp": { "serverName": "HR Database Server", "port": 3001 }
}
```

**File:** `config-sales.json` (Sales Server)

```json
{
  "auth": {
    "trustedIDPs": [{ "issuer": "https://auth.company.com", "audience": "mcp-oauth" }]
  },
  "delegation": {
    "modules": {
      "postgresql": {
        "host": "sales-db.company.com",
        "database": "sales_database",
        "tokenExchange": { "audience": "urn:db:sales" }
      }
    }
  },
  "mcp": { "serverName": "Sales Database Server", "port": 3002 }
}
```

**Server Code (HR):**
```typescript
const hrTools = createSQLToolsForModule('hr', 'postgresql', '(HR Database)');
await server.start({ transportType: 'httpStream', httpStream: { port: 3001 } });
```

**Server Code (Sales):**
```typescript
const salesTools = createSQLToolsForModule('sales', 'postgresql', '(Sales Database)');
await server.start({ transportType: 'httpStream', httpStream: { port: 3002 } });
```

---

## Best Practices

### 1. Prefix Naming Convention

| Scenario | Recommended Prefix | Example Tools |
|----------|-------------------|---------------|
| **Descriptive (single DB/server)** | `hr`, `sales`, `analytics` | `hr-delegate`, `sales-delegate` |
| **Short (multiple DBs/server)** | `db1`, `db2`, `db3` | `db1-delegate`, `db2-delegate` |
| **Type-based** | `pg`, `ms`, `my` | `pg-delegate`, `ms-delegate` |
| **Tenant-based** | `acme`, `widgets` | `acme-delegate`, `widgets-delegate` |
| **Avoid** | ❌ `database`, `sql` | Too generic, confusing |

### 2. Description Suffix

Add context to tool descriptions:

```typescript
const hrTools = createSQLToolsForModule('hr', 'postgresql', '(HR Database)');
// Tool description: "Execute PostgreSQL queries... (HR Database)"

const salesTools = createSQLToolsForModule('sales', 'postgresql', '(Sales Database)');
// Tool description: "Execute PostgreSQL queries... (Sales Database)"
```

**Benefit:** LLM can see which database each tool queries.

### 3. Exclude Default Tools When Using Prefixes

```typescript
// ✅ GOOD: No duplicate unprefixed tools
const nonSqlTools = getAllToolFactories({ excludeSqlTools: true });
const db1Tools = createSQLToolsForModule('db1', 'postgresql1');
const db2Tools = createSQLToolsForModule('db2', 'postgresql2');

// ❌ BAD: Default 'sql-delegate' conflicts with prefixed tools
const allTools = getAllToolFactories(); // Includes sql-delegate
const db1Tools = createSQLToolsForModule('db1', 'postgresql1'); // db1-delegate
// Now you have both 'sql-delegate' AND 'db1-delegate' (confusing!)
```

### 4. Document Tool Prefixes

In your server documentation, clearly list available tools:

```markdown
## Available Tools

### Database Tools
- `hr-delegate` - Query HR database (PostgreSQL)
- `hr-schema` - List HR database schemas
- `hr-table-details` - Get HR table details

- `sales-delegate` - Query Sales database (PostgreSQL)
- `sales-schema` - List Sales database schemas
- `sales-table-details` - Get Sales table details

### Server Tools
- `health-check` - Check server health
- `user-info` - Get current user session
```

### 5. Port Assignment Strategy

Assign predictable ports to servers:

| Server | Port | Prefix | Database |
|--------|------|--------|----------|
| HR | 3001 | `hr` | hr_database |
| Sales | 3002 | `sales` | sales_database |
| Analytics | 3003 | `analytics` | analytics_database |
| Support | 3004 | `support` | support_database |

---

## Troubleshooting

### Issue 1: Tool Name Collisions Still Occurring

**Symptom:** LLM reports duplicate tool names or tools fail to register.

**Cause:** Using `getAllToolFactories()` without excluding SQL tools when registering prefixed tools.

**Solution:**
```typescript
// ✅ Exclude default SQL tools
const nonSqlTools = getAllToolFactories({ excludeSqlTools: true });

// Add prefixed SQL tools
const db1Tools = createSQLToolsForModule('db1', 'postgresql1');

// Register
for (const factory of [...nonSqlTools, ...db1Tools]) {
  // ...
}
```

### Issue 2: Wrong Database Queried

**Symptom:** Query intended for HR database executes on Sales database.

**Cause:** LLM confused about which tool to use.

**Solution:** Use descriptive prefixes and description suffixes:
```typescript
const hrTools = createSQLToolsForModule('hr', 'postgresql1', '(HR Database - Employee Records)');
const salesTools = createSQLToolsForModule('sales', 'postgresql2', '(Sales Database - Order Management)');
```

### Issue 3: Delegation Module Not Found

**Symptom:** Error: "Module not found: postgresql1"

**Cause:** Module name in `createSQLToolsForModule()` doesn't match configuration.

**Solution:** Ensure module names match:
```typescript
// Config: "postgresql1"
createSQLToolsForModule('db1', 'postgresql1'); // ✅ Matches

// Config: "postgres_hr"
createSQLToolsForModule('hr', 'postgres_hr'); // ✅ Matches

// Config: "postgresql"
createSQLToolsForModule('db1', 'postgresql1'); // ❌ Mismatch!
```

### Issue 4: Health-Check/User-Info Collisions

**Symptom:** `health-check` and `user-info` tools collide across servers.

**Cause:** These are **server-scoped** tools, not database-scoped.

**Solution:** This is expected behavior. Each server has its own `health-check` and `user-info`:
- HR Server's `health-check` checks HR server health
- Sales Server's `health-check` checks Sales server health

No action needed - these tools are server-specific.

### Issue 5: Missing Tools After Migration

**Symptom:** Expected tools not appearing after switching to prefixed tools.

**Cause:** Forgot to exclude default SQL tools.

**Solution:** Check tool registration:
```typescript
const allTools = getAllToolFactories({ excludeSqlTools: true });
const db1Tools = createSQLToolsForModule('db1', 'postgresql1');

console.log('Registering tools:', [...allTools, ...db1Tools].map(f => f.name));
// Should show: health-check, user-info, db1-delegate, db1-schema, db1-table-details
```

---

## Additional Resources

- **[README.md](../README.md#-handling-multiple-mcp-servers-tool-name-collisions)** - Quick overview
- **[TOOL-FACTORIES.md](TOOL-FACTORIES.md)** - Tool creation approaches
- **[EXTENDING.md](EXTENDING.md)** - Custom delegation modules
- **[API-REFERENCE.md](API-REFERENCE.md)** - Complete API documentation

**Questions?** Open an issue at https://github.com/your-org/mcp-oauth-framework/issues
