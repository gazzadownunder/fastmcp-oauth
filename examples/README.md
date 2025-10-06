# FastMCP OAuth OBO Framework - Examples

This directory contains example applications demonstrating how to use the `fastmcp-oauth-obo` framework in your own projects.

## Framework vs. Application Code

**Framework code** (what you import):
- `src/core/` - Authentication, JWT validation, role mapping, session management
- `src/delegation/` - SQL, Kerberos delegation modules
- `src/mcp/` - FastMCP integration, middleware, tools

**Application code** (what you write):
- Import framework modules: `import { MCPOAuthServer } from 'fastmcp-oauth-obo'`
- Configure via JSON (no code changes to framework)
- Compose your server with the modules you need

## Examples

### [start-server.ts](./start-server.ts)
**Basic server startup with SQL delegation**

Demonstrates:
- Creating an `MCPOAuthServer` instance
- Loading configuration from JSON
- Registering the SQL delegation module
- Starting the server with custom transport/port
- Graceful shutdown handling

Usage:
```bash
# Set environment variables
export CONFIG_PATH=./config/unified-config.json
export SERVER_PORT=3000
export MCP_TRANSPORT=httpStream

# Run the application
node dist/examples/start-server.js
```

### [simple-server.ts](./simple-server.ts)
**Minimal boilerplate example**

Shows the absolute minimum code needed to start an OAuth-enabled MCP server:
- ~20 lines of code (vs. ~127 lines without framework)
- All configuration in JSON
- Default settings from config file

### [full-mcp-server.ts](./full-mcp-server.ts)
**Complete production-ready server**

Demonstrates:
- Custom error handling
- Logging integration
- Health checks
- Metrics collection
- Multiple delegation modules

### [core-only.ts](./core-only.ts)
**Using Core layer standalone (without MCP)**

Shows how to use the authentication services independently:
- Direct JWT validation
- Role mapping
- Session management
- Without FastMCP dependency

### [with-sql-delegation.ts](./with-sql-delegation.ts)
**SQL delegation integration**

Demonstrates:
- Configuring SQL Server connection
- On-behalf-of query execution
- Security best practices

### [custom-delegation.ts](./custom-delegation.ts)
**Building custom delegation modules**

Shows how to create your own delegation module:
- Implement `DelegationModule` interface
- Register with `DelegationRegistry`
- ~50 lines of code

### [canAccess-demo.ts](./canAccess-demo.ts)
**Tool visibility and permissions**

Demonstrates:
- Two-tier security (visibility + execution)
- `canAccess` filtering
- Permission-based tool access

## Installation

When using this framework in your own project:

```bash
npm install fastmcp-oauth-obo
```

Then create your application entry point:

```typescript
// my-app/server.ts
import { MCPOAuthServer } from 'fastmcp-oauth-obo';
import { SQLDelegationModule } from 'fastmcp-oauth-obo/delegation';

const server = new MCPOAuthServer('./config/unified-config.json');

await server.start({ transport: 'httpStream', port: 3000 });

await server.registerDelegationModule('sql', new SQLDelegationModule());
```

## Configuration

All examples use JSON configuration files (no code changes needed):

```json
{
  "auth": {
    "trustedIDPs": [...],
    "roleMappings": {...},
    "audit": {...}
  },
  "delegation": {
    "modules": {
      "sql": {...}
    }
  },
  "mcp": {
    "serverName": "My MCP Server",
    "version": "1.0.0",
    "transport": "httpStream",
    "port": 3000
  }
}
```

See `config/oauth-obo-test.json` for a complete example.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│               Your Application Code                      │
│  examples/*.ts - What developers write                  │
│  - Server startup                                        │
│  - Configuration loading                                 │
│  - Module registration                                   │
└──────────────────┬──────────────────────────────────────┘
                   │ imports from ↓
┌─────────────────────────────────────────────────────────┐
│                  MCP Layer (Framework)                   │
│  src/mcp/ - FastMCP Integration                         │
│  - MCPOAuthServer wrapper                                │
│  - Tool factories                                        │
└──────────────────┬──────────────────────────────────────┘
                   │ depends on ↓
┌─────────────────────────────────────────────────────────┐
│               Delegation Layer (Framework)               │
│  src/delegation/ - Pluggable modules                    │
│  - SQLDelegationModule                                   │
│  - Custom module support                                 │
└──────────────────┬──────────────────────────────────────┘
                   │ depends on ↓
┌─────────────────────────────────────────────────────────┐
│                Core Layer (Framework)                    │
│  src/core/ - Standalone auth services                   │
│  - AuthenticationService                                 │
│  - JWTValidator                                          │
│  - RoleMapper, SessionManager                            │
└─────────────────────────────────────────────────────────┘
```

## Development vs. Production

**During framework development** (this repo):
- Examples import from `../src/` (relative paths)
- Built with `npm run build` → `dist/examples/`

**In production** (user's project):
- Applications import from `fastmcp-oauth-obo` (npm package)
- Users never modify framework code
- All customization via configuration

## Further Reading

- [Docs/refactor.md](../Docs/refactor.md) - Architecture details
- [CLAUDE.md](../CLAUDE.md) - Framework overview
- [Docs/oauth2 implementation.md](../Docs/oauth2%20implementation.md) - OAuth 2.1 OBO pattern
