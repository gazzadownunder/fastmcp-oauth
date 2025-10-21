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

### [rest-api-delegation.ts](./rest-api-delegation.ts)
**REST API integration with token exchange**

Demonstrates:
- Custom REST API delegation module
- Token exchange for API-specific JWTs
- Parameter and result transformation
- Production-ready error handling

### [graphql-delegation.ts](./graphql-delegation.ts)
**GraphQL API integration**

Shows how to delegate to GraphQL backends:
- GraphQL query and mutation support
- Variable parameterization
- Token exchange for GraphQL-specific JWT
- GraphQL error handling
- Operation name support

### [grpc-delegation.ts](./grpc-delegation.ts)
**gRPC service integration**

Demonstrates:
- gRPC unary call delegation
- Token exchange for service-specific JWT
- Metadata (headers) propagation
- Automatic retry with exponential backoff
- gRPC status code handling

### [ldap-delegation.ts](./ldap-delegation.ts)
**LDAP/Active Directory integration**

Shows how to integrate with directory services:
- LDAP authentication and bind
- User search and attribute retrieval
- Group membership queries
- Directory modifications (add, modify, delete)
- LDAPS (secure) connection support

### [filesystem-delegation.ts](./filesystem-delegation.ts)
**Secure filesystem access**

Demonstrates:
- User-scoped filesystem operations
- Path validation and traversal prevention
- Whitelist-based directory access
- File read/write/delete operations
- Cross-platform support (Windows/Linux)

### [api-delegation-with-token-exchange.ts](./api-delegation-with-token-exchange.ts)
**Token exchange pattern**

Shows the token exchange pattern for API delegation:
- Exchanging requestor JWT for delegation token
- Token caching with session binding
- Fallback to API key authentication
- CoreContext integration

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

## When to Use Each Delegation Pattern

### REST API Delegation
**Use when:**
- Integrating with modern HTTP/JSON APIs
- Need to exchange tokens for downstream API access
- APIs support Bearer token authentication
- Stateless request/response pattern

**Best for:** Third-party SaaS APIs, internal microservices, cloud services

### GraphQL Delegation
**Use when:**
- Backend uses GraphQL instead of REST
- Need flexible query capabilities with variables
- Working with federated GraphQL schemas
- Complex nested data requirements

**Best for:** Modern web applications, data aggregation services, microservice orchestration

### gRPC Delegation
**Use when:**
- Backend services use gRPC protocol
- Need high-performance RPC calls
- Working with protocol buffers (protobuf)
- Microservice-to-microservice communication

**Best for:** Internal microservices, high-throughput systems, streaming data

### LDAP Delegation
**Use when:**
- Need to authenticate users against Active Directory
- Querying organizational directory information
- Managing user groups and permissions
- Legacy enterprise integration

**Best for:** Corporate environments, Windows Active Directory, enterprise user management

### Filesystem Delegation
**Use when:**
- Need secure file access on behalf of users
- Document management and storage
- User-scoped file operations
- Legacy file-based applications

**Best for:** Document repositories, file processing systems, backup/restore operations

### SQL Delegation
**Use when:**
- Legacy databases require user impersonation
- SQL Server `EXECUTE AS USER` delegation
- Row-level security based on login context
- Direct database access is necessary

**Best for:** Legacy enterprise databases, SQL Server environments, mainframe integration

### Kerberos Delegation
**Use when:**
- Windows Active Directory constrained delegation
- Legacy Windows platforms require user context
- S4U2Self/S4U2Proxy delegation needed
- Enterprise SSO integration

**Best for:** Windows enterprise environments, legacy system integration, Kerberos-based SSO

## Choosing the Right Pattern

| Pattern | Complexity | Performance | Security | Use Case |
|---------|-----------|-------------|----------|----------|
| REST API | Low | Medium | High | Modern web APIs |
| GraphQL | Medium | Medium | High | Flexible data queries |
| gRPC | High | Very High | High | Internal microservices |
| LDAP | Medium | Medium | High | Directory services |
| Filesystem | Low | High | Medium | File operations |
| SQL | Medium | High | Very High | Database delegation |
| Kerberos | Very High | Medium | Very High | Windows SSO |

## Further Reading

- [Docs/EXTENDING.md](../Docs/EXTENDING.md) - Complete guide to creating custom modules
- [Docs/refactor.md](../Docs/refactor.md) - Architecture details
- [CLAUDE.md](../CLAUDE.md) - Framework overview
- [Docs/oauth2 implementation.md](../Docs/oauth2%20implementation.md) - OAuth 2.1 OBO pattern
