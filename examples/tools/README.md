# Example MCP Tools

This directory contains example tool implementations that demonstrate framework capabilities. These are **not** part of the core framework and are provided for educational purposes.

## Test Tools

### sql-read.ts
**Purpose:** Demonstrates role-based visibility filtering

- Only visible to users with `read` or `write` role
- Shows how to use `canAccess()` for tool visibility control
- Example of using `Authorization.hasAnyRole()` helper

**Usage Example:**
```typescript
import { createSQLReadTool } from './examples/tools/sql-read.js';

const tool = createSQLReadTool(coreContext);
server.addTool(tool);
```

### sql-write.ts
**Purpose:** Demonstrates strict role-based access control

- Only visible to users with `write` role
- Shows single-role visibility filtering
- Example of using `Authorization.hasRole()` helper

**Usage Example:**
```typescript
import { createSQLWriteTool } from './examples/tools/sql-write.js';

const tool = createSQLWriteTool(coreContext);
server.addTool(tool);
```

### oauth-metadata.ts
**Purpose:** Workaround tool for OAuth metadata discovery

- Returns RFC 9728 OAuth 2.0 Protected Resource Metadata
- Does NOT require authentication (pre-auth discovery)
- **Note:** This is a workaround because FastMCP doesn't expose the Express app for custom HTTP endpoints

**Ideal Implementation:**
OAuth metadata should be served via HTTP endpoint (`.well-known/oauth-protected-resource`), not as an MCP tool. This tool demonstrates how to work around FastMCP limitations.

**Usage Example:**
```typescript
import { createOAuthMetadataTool } from './examples/tools/oauth-metadata.js';

const tool = createOAuthMetadataTool(coreContext);
server.addTool(tool);
```

## Why These Are Examples

These tools were created during framework development to test specific features:

1. **sql-read.ts** / **sql-write.ts**: Test tools for verifying role-based visibility (`canAccess()` filtering)
2. **oauth-metadata.ts**: Workaround for FastMCP limitation (should be HTTP endpoint, not MCP tool)

They are **not recommended for production use** but serve as learning resources for developers building custom tools.

## Creating Your Own Tools

For production tools, use the framework's tool factory pattern:

```typescript
import { createDelegationTool } from '@mcp-oauth/mcp';
import type { CoreContext } from '@mcp-oauth/core';

const myTool = createDelegationTool('module-name', {
  name: 'my-tool',
  description: 'Tool description',
  parameters: z.object({ param1: z.string() }),
  action: 'action-name',
  requiredPermission: 'scope:action',
  requiredRoles: ['user'],
}, coreContext);
```

See [Docs/EXTENDING.md](../../Docs/EXTENDING.md) for detailed guidance on extending the framework.
