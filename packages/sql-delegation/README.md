# @mcp-oauth/sql-delegation

SQL delegation module for the MCP OAuth framework - provides PostgreSQL and SQL Server delegation capabilities.

## Overview

This package is a **reference implementation** demonstrating how to build delegation modules for the MCP OAuth framework. It provides secure database operations on behalf of authenticated users using:

- **PostgreSQL**: `SET ROLE` delegation
- **SQL Server**: `EXECUTE AS USER` delegation

## Installation

```bash
npm install @mcp-oauth/sql-delegation
```

This package is an **optional** dependency of `mcp-oauth-framework`. The core framework works without SQL support.

## Features

### Security

- ✅ Parameterized queries only (prevents SQL injection)
- ✅ Dangerous operation blocking (DROP, CREATE, ALTER, etc.)
- ✅ SQL identifier validation
- ✅ Automatic context/role reversion on error
- ✅ TLS encryption support
- ✅ Role-based command authorization (with token exchange)

### Token Exchange Integration

When integrated with the framework's TokenExchangeService, SQL delegation can:

1. Exchange requestor JWT for delegation token (TE-JWT)
2. Extract `legacy_name` claim for database user impersonation
3. Extract `roles` claim for command-level authorization (sql-read, sql-write, sql-admin)

## Usage

### PostgreSQL Delegation

```typescript
import { PostgreSQLDelegationModule } from '@mcp-oauth/sql-delegation';
import { DelegationRegistry } from 'mcp-oauth-framework/delegation';

const pgModule = new PostgreSQLDelegationModule();

await pgModule.initialize({
  host: 'localhost',
  port: 5432,
  database: 'mydb',
  user: 'service_account',
  password: 'secret',
  options: {
    ssl: true
  }
});

// Register with framework
const registry = new DelegationRegistry();
registry.register(pgModule);

// Delegate query
const result = await registry.delegate(
  'postgresql',
  session,
  'query',
  {
    sql: 'SELECT * FROM users WHERE id = $1',
    params: [123]
  }
);
```

### SQL Server Delegation

```typescript
import { SQLDelegationModule } from '@mcp-oauth/sql-delegation';
import { DelegationRegistry } from 'mcp-oauth-framework/delegation';

const sqlModule = new SQLDelegationModule();

await sqlModule.initialize({
  server: 'sql01.company.com',
  database: 'legacy_app',
  options: {
    trustedConnection: true,
    encrypt: true
  }
});

// Register with framework
const registry = new DelegationRegistry();
registry.register(sqlModule);

// Delegate query
const result = await registry.delegate(
  'sql',
  session,
  'query',
  {
    sql: 'SELECT * FROM Orders WHERE CustomerId = @customerId',
    params: { customerId: 456 }
  }
);
```

### Token Exchange Configuration

To enable token exchange for SQL delegation:

```typescript
import { TokenExchangeService } from 'mcp-oauth-framework/delegation';

// Create TokenExchangeService
const tokenExchangeService = new TokenExchangeService(auditService);

// Configure SQL module with token exchange
pgModule.setTokenExchangeService(tokenExchangeService, {
  tokenEndpoint: 'https://auth.company.com/token',
  clientId: 'mcp-server',
  clientSecret: 'SECRET',
  audience: 'postgresql-delegation',
  scope: 'openid profile sql:read sql:write'  // Request specific OAuth scopes
});
```

**OAuth Scope Support (RFC 8693):**
- Request fine-grained database permissions during token exchange
- Example scopes: `sql:read` (SELECT only), `sql:write` (INSERT/UPDATE/DELETE), `sql:admin` (DDL operations)
- IDP controls which scopes are granted based on user roles
- Enables least-privilege access patterns per database

**TE-JWT Requirements:**

The delegation token (TE-JWT) returned by the IDP must contain:

- `legacy_name` - Database username for impersonation
- `roles` - Array of roles for command authorization (optional)
  - `sql-read`: SELECT only
  - `sql-write`: SELECT, INSERT, UPDATE, DELETE
  - `sql-admin`: All commands except dangerous operations
  - `admin`: All commands including DROP, TRUNCATE

## API

### PostgreSQLDelegationModule

#### Actions

- **`query`** - Execute SQL query with parameterized params
  ```typescript
  { sql: 'SELECT * FROM users WHERE id = $1', params: [123] }
  ```

- **`schema`** - List tables in schema
  ```typescript
  { schemaName: 'public' }
  ```

- **`table-details`** - Get table column information
  ```typescript
  { tableName: 'users', schemaName: 'public' }
  ```

### SQLDelegationModule (SQL Server)

#### Actions

- **`query`** - Execute SQL query with named parameters
  ```typescript
  { sql: 'SELECT * FROM Orders WHERE Id = @id', params: { id: 123 } }
  ```

- **`schema`** - List tables in database
  ```typescript
  { }
  ```

- **`table-details`** - Get table column information
  ```typescript
  { tableName: 'Orders' }
  ```

## Security

### Blocked Operations

The following SQL operations are **always blocked** for non-admin users:

- `DROP` - Requires `admin` role
- `TRUNCATE` - Requires `admin` role
- `CREATE` - Requires `sql-admin` or `admin` role
- `ALTER` - Requires `sql-admin` or `admin` role
- `GRANT` - Requires `sql-admin` or `admin` role
- `REVOKE` - Requires `sql-admin` or `admin` role

### Command Authorization

When token exchange is enabled, commands are authorized based on TE-JWT roles:

| Command | Required Role |
|---------|--------------|
| SELECT, EXPLAIN | sql-read |
| INSERT, UPDATE, DELETE | sql-write |
| CREATE, ALTER, GRANT | sql-admin |
| DROP, TRUNCATE | admin |

## Multi-Database Support

The framework supports multiple PostgreSQL or SQL Server instances with separate tool names and IDP configurations:

```typescript
// postgresql1 module
const pgModule1 = new PostgreSQLDelegationModule('postgresql1');
await pgModule1.initialize({
  host: 'primary.company.com',
  database: 'app_db',
  user: 'service_account',
  password: 'secret'
});
pgModule1.setTokenExchangeService(tokenExchangeService, {
  idpName: 'primary-db-idp',
  tokenEndpoint: 'https://auth.company.com/token',
  clientId: 'primary-db-client',
  clientSecret: 'SECRET1',
  audience: 'primary-db',
  scope: 'openid profile sql:read sql:write sql:admin'
});

// postgresql2 module (analytics, read-only)
const pgModule2 = new PostgreSQLDelegationModule('postgresql2');
await pgModule2.initialize({
  host: 'analytics.company.com',
  database: 'analytics_db',
  user: 'analytics_account',
  password: 'secret'
});
pgModule2.setTokenExchangeService(tokenExchangeService, {
  idpName: 'analytics-db-idp',
  tokenEndpoint: 'https://analytics-auth.company.com/token',
  clientId: 'analytics-client',
  clientSecret: 'SECRET2',
  audience: 'analytics-db',
  scope: 'openid profile analytics:read'  // Read-only
});

// Register both modules
registry.register(pgModule1);
registry.register(pgModule2);

// Use SQL tools factory to create tools with prefixes
import { createSQLToolsForModule } from 'mcp-oauth-framework/mcp/tools';

const sql1Tools = createSQLToolsForModule({
  toolPrefix: 'sql1',
  moduleName: 'postgresql1',
  descriptionSuffix: ' (Primary DB)'
});

const sql2Tools = createSQLToolsForModule({
  toolPrefix: 'sql2',
  moduleName: 'postgresql2',
  descriptionSuffix: ' (Analytics DB - Read Only)'
});

// Tools are named: sql1-delegate, sql1-schema, sql2-delegate, sql2-schema
```

**Key Benefits:**
- **Separate IDPs** - Each database can use different identity provider
- **Scoped Permissions** - Primary DB has full access, analytics is read-only
- **Tool Prefixes** - Clear tool naming: `sql1-delegate`, `sql2-delegate`
- **Independent Configuration** - Each database has separate credentials and token exchange settings

## Configuration

### PostgreSQL

```typescript
{
  host: string;           // PostgreSQL hostname
  port?: number;          // Port (default: 5432)
  database: string;       // Database name
  user: string;          // Service account user
  password: string;      // Service account password
  options?: {
    ssl?: boolean | { ... };  // SSL/TLS config
  };
  pool?: {
    max?: number;         // Max connections (default: 10)
    min?: number;         // Min connections (default: 0)
    idleTimeoutMillis?: number;
    connectionTimeoutMillis?: number;
  };
}
```

### SQL Server

```typescript
{
  server: string;         // SQL Server hostname
  database: string;       // Database name
  options?: {
    trustedConnection?: boolean;  // Use Windows auth
    encrypt?: boolean;            // TLS encryption (recommended)
    trustServerCertificate?: boolean;
  };
}
```

## License

MIT

## See Also

- [MCP OAuth Framework](https://github.com/yourorg/mcp-oauth)
- [Framework Extension Guide](../../Docs/EXTENDING.md)
- [Token Exchange Documentation](../../Docs/Framework-update.md#phase-1-token-exchange)
