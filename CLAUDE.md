# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

FastMCP OAuth On-Behalf-Of (OBO) Framework - A production-ready, modular OAuth 2.1 authentication and delegation framework for FastMCP. Provides on-behalf-of (OBO) authentication with pluggable delegation modules for SQL Server, Kerberos, and custom integrations.

**Current Status:** Phases 1-6 completed - Modular architecture with Core, Delegation, and MCP layers fully implemented, tested, and documented.

## Modular Architecture (v2.x)

The framework follows a **layered modular architecture** with strict one-way dependencies:

```
┌─────────────────────────────────────────────────────────┐
│                     MCP Layer                            │
│  src/mcp/ - FastMCP Integration                         │
│  - MCPAuthMiddleware, ConfigOrchestrator                │
│  - Tool factories with CoreContext injection            │
│  - Imports from: Core, Delegation, Config               │
└──────────────────┬──────────────────────────────────────┘
                   │ depends on ↓
┌─────────────────────────────────────────────────────────┐
│                  Delegation Layer                        │
│  src/delegation/ - Pluggable delegation modules         │
│  - DelegationRegistry, SQLDelegationModule              │
│  - Custom delegation module support                      │
│  - Imports from: Core only                               │
└──────────────────┬──────────────────────────────────────┘
                   │ depends on ↓
┌─────────────────────────────────────────────────────────┐
│                    Core Layer                            │
│  src/core/ - Standalone authentication framework        │
│  - AuthenticationService, JWTValidator                   │
│  - SessionManager, RoleMapper, AuditService             │
│  - CoreContext, CoreContextValidator                     │
│  - NO external layer dependencies                        │
└─────────────────────────────────────────────────────────┘
```

### Key Architectural Principles

1. **One-way Dependencies**: Core ← Delegation ← MCP (never reverse!)
2. **Core is Standalone**: Can be used without MCP or delegation
3. **Pluggable Delegation**: Add custom modules in <50 LOC
4. **CoreContext Injection**: All tools receive dependencies via single CoreContext object
5. **Fail-Safe Design**: RoleMapper never crashes (returns Unassigned role), AuditService works without config (Null Object Pattern)

### Critical Rules (DO NOT VIOLATE)

- ❌ **NEVER** import from `src/mcp/` in Core layer
- ❌ **NEVER** import from `src/delegation/` in Core layer
- ❌ **NEVER** import from `src/mcp/` in Delegation layer
- ✅ **ALWAYS** define CoreContext in `src/core/types.ts`
- ✅ **ALWAYS** use `ConfigOrchestrator.buildCoreContext()` to create CoreContext
- ✅ **ALWAYS** validate CoreContext with `CoreContextValidator.validate()`

## Dependencies

### NPM Packages (Official)

This project uses **official npm packages** that include full OAuth stateless authentication support:

#### 1. FastMCP (Core Framework)

- **Package**: `fastmcp@^3.19.0` (npm registry)
- **Original**: https://github.com/modelcontextprotocol/fastmcp
- **Package.json entry**: `"fastmcp": "^3.19.0"`

**Built-in OAuth Features:**
- OAuth Support on Tool Requests - OAuth/JWT authentication context on tool execution
- Bearer Token Handling - Extracts and validates Bearer tokens from requests
- Stateless Mode - Per-request authentication with no session persistence
- Session Context - Tool handlers receive authenticated user session information

#### 2. MCP-Proxy (HTTP Stream Transport)

- **Package**: `mcp-proxy@^5.8.0` (npm registry)
- **Original**: https://github.com/modelcontextprotocol/mcp-proxy
- **Package.json entry**: `"mcp-proxy": "^5.8.0"`

**Built-in OAuth Features:**
1. CORS Headers - Proper CORS headers for Authorization and Mcp-Session-Id
2. Per-Request Authentication - Validates JWT on every request in stateless mode
3. Session ID Management - Creates and returns real UUID session IDs
4. Stateless Support - Full support for stateless OAuth sessions

**Verification:** See [Docs/NPM-LIBRARY-VERIFICATION.md](Docs/NPM-LIBRARY-VERIFICATION.md) for code-level verification that npm packages contain all required OAuth features.

## Common Commands

### Build and Development
```bash
npm run build          # Build TypeScript with tsup
npm run dev           # Build with watch mode (hot reload)
npm run clean         # Remove build artifacts from dist/
npm start             # Run the built server from dist/index.js
```

### Testing
```bash
npm test                    # Run all tests with vitest
npm run test:coverage       # Run tests with coverage report
npm test jwt-validator      # Run specific test file
npm test -- --watch         # Watch mode for development
```

### Code Quality
```bash
npm run typecheck      # Type check without emitting files (tsc --noEmit)
npm run lint           # Lint TypeScript files with eslint
npm run lint:fix       # Auto-fix linting issues
npm run format         # Format code with prettier
```

## Architecture

### Core Component Flow
```
External IDP (OAuth/JWKS) → JWT Middleware (jose lib) → FastMCP Core
                                    ↓                         ↓
                              Config Manager            Tools Registry
                                    ↓                         ↓
                          Kerberos Module (Planned)    SQL Module (Implemented)
                                    ↓                         ↓
                          Legacy Windows Platforms     SQL Server (MSSQL 11.0+)
```

### Key Modules

**[src/index.ts](src/index.ts)** - Main server with OAuth metadata configuration (includes full OAuth server metadata in FastMCP constructor)

**[src/index-simple.ts](src/index-simple.ts)** - Simplified server without OAuth metadata (for basic FastMCP integration)

**[src/middleware/jwt-validator.ts](src/middleware/jwt-validator.ts)** - RFC 8725 compliant JWT validation using jose library v6.1.0+. Validates tokens from trusted IDPs with JWKS discovery, rate limiting, and comprehensive audit logging.

**[src/services/sql-delegator.ts](src/services/sql-delegator.ts)** - SQL Server delegation service implementing `EXECUTE AS USER` with security features:
  - Parameterized queries only
  - SQL injection prevention with multiple validation layers
  - Dangerous operation blocking (DROP, CREATE, ALTER, etc.)
  - Automatic context reversion on error

**[src/config/manager.ts](src/config/manager.ts)** - Configuration manager with hot-reload capability and Zod validation

**[src/config/schema.ts](src/config/schema.ts)** - Zod schemas for configuration validation. All config must pass validation before use.

**[src/types/index.ts](src/types/index.ts)** - Core TypeScript interfaces and type definitions

**[src/utils/errors.ts](src/utils/errors.ts)** - Security-focused error handling with sanitization for production

### Authentication Flow

1. Client sends Bearer token in Authorization header
2. `OAuthOBOServer.authenticateRequest()` extracts JWT from Bearer token
3. `jwtValidator.validateJWT()` validates against trusted IDPs using JWKS
4. Creates `UserSession` with claims mapping (legacyUsername, roles, scopes)
5. Session attached to context for tool execution
6. All operations logged to audit trail

### Tool Registration Pattern

All tools follow this security pattern:
- Extract `UserSession` from context
- Check authentication (throw 401 if missing)
- Validate permissions (throw 403 if insufficient)
- Perform operation with audit logging
- Return sanitized results as JSON strings

### Authorization Helpers

The framework provides two types of authorization checks via the `Authorization` class (in [src/mcp/authorization.ts](src/mcp/authorization.ts)):

#### Soft Checks (Return Boolean)
Use in `canAccess` implementations for fine-grained access control:
- `isAuthenticated(context)` - Check if session exists and not rejected
- `hasRole(context, role)` - Check if user has specific role
- `hasAnyRole(context, roles[])` - Check if user has any of multiple roles (OR logic)
- `hasAllRoles(context, roles[])` - Check if user has all roles (AND logic, checks customRoles)
- `hasPermission(context, permission)` - Check if user has specific permission
- `hasAnyPermission(context, permissions[])` - Check if user has any permission (OR logic)
- `hasAllPermissions(context, permissions[])` - Check if user has all permissions (AND logic)

#### Hard Checks (Throw on Failure)
Use in tool handlers to enforce access requirements:
- `requireAuth(context)` - Throws 401 if not authenticated
- `requireRole(context, role)` - Throws 403 if role mismatch
- `requireAnyRole(context, roles[])` - Throws 403 if lacks all roles
- `requireAllRoles(context, roles[])` - Throws 403 if missing any role
- `requirePermission(context, permission)` - Throws 403 if permission missing
- `requireAnyPermission(context, permissions[])` - Throws 403 if lacks all permissions
- `requireAllPermissions(context, permissions[])` - Throws 403 if missing any permission

**Example Usage:**
```typescript
import { Authorization } from './mcp/authorization.js';

const auth = new Authorization();

// In tool handler (hard check)
auth.requirePermission(context, 'sql:query');

// In canAccess implementation (soft check)
canAccess: (context) => {
  if (!auth.isAuthenticated(context)) return false;
  return auth.hasAnyPermission(context, ['sql:query', 'sql:execute']);
}
```

## Security Requirements

### JWT Validation (RFC 8725 Compliance)
- **ONLY** RS256 and ES256 algorithms permitted
- Mandatory claims validation: `iss`, `aud`, `exp`, `nbf`
- Token lifetime: 15-60 minutes (300-3600 seconds)
- HTTPS required for all JWKS endpoints
- Clock tolerance: max 300 seconds (5 minutes)

### SQL Security
- **ALWAYS** use parameterized queries via the `params` object
- **NEVER** concatenate user input into SQL strings
- Dangerous operations blocked by `sql-delegator`: DROP, CREATE, ALTER, DELETE (admin only), TRUNCATE, EXEC (sp_executesql, xp_cmdshell)
- SQL identifier validation enforced
- Connection must use TLS encryption (`encrypt: true`)

### Configuration Security
- All IDP URLs must use HTTPS (enforced by Zod schema)
- Trusted connection recommended for SQL Server
- Audit logging enabled by default
- Rate limiting configured per deployment

## OAuth 2.1 On-Behalf-Of Pattern

This implementation follows RFC 8693 (Token Exchange) for delegation:

1. **Subject Token**: User authenticates to Client 1 (e.g., "contextflow"), receives JWT with `aud: ["contextflow", "mcp-oauth"]`
2. **Token Exchange**: Client 2 ("mcp-oauth") exchanges Subject Token at IDP `/token` endpoint using `grant_type: urn:ietf:params:oauth:grant-type:token-exchange`
3. **Exchanged Token**: IDP returns new JWT with:
   - `aud: ["mcp-oauth"]` - scoped to this service
   - `azp: "mcp-oauth"` - proves token was minted for this actor
   - `act` claim (optional) - contains original subject details
4. **Validation**: Resource Server validates `azp` claim **MUST** equal "mcp-oauth" to reject Subject Tokens

See [Docs/oauth2 implementation.md](Docs/oauth2 implementation.md) for full delegation flow details.

## Configuration

Configuration files use JSON format with Zod validation. Example structure:

```json
{
  "trustedIDPs": [{
    "issuer": "https://auth.company.com",
    "discoveryUrl": "https://auth.company.com/.well-known/oauth-authorization-server",
    "jwksUri": "https://auth.company.com/.well-known/jwks.json",
    "audience": "mcp-server-api",
    "algorithms": ["RS256", "ES256"],
    "claimMappings": {
      "legacyUsername": "legacy_sam_account",
      "roles": "user_roles",
      "scopes": "authorized_scopes"
    },
    "security": {
      "clockTolerance": 60,
      "maxTokenAge": 3600,
      "requireNbf": true
    }
  }],
  "roleMappings": {
    "admin": ["admin", "administrator"],
    "user": ["user", "member"],
    "guest": ["guest"],
    "defaultRole": "guest",
    "rejectUnmappedRoles": false
  },
  "rateLimiting": { "maxRequests": 100, "windowMs": 900000 },
  "audit": { "logAllAttempts": true, "retentionDays": 90 },
  "sql": {
    "server": "sql01.company.com",
    "database": "legacy_app",
    "options": { "trustedConnection": true, "encrypt": true }
  }
}
```

### Role Mapping Configuration

The `roleMappings` section controls how JWT roles are mapped to application roles:

- **`admin`**: Array of JWT role values that map to admin role (default: `["admin", "administrator"]`)
- **`user`**: Array of JWT role values that map to user role (default: `["user"]`)
- **`guest`**: Array of JWT role values that map to guest role (default: `[]`)
- **`defaultRole`**: Role to use when JWT roles don't match any mapping (default: `"guest"`)
- **`rejectUnmappedRoles`**: Reject authentication if JWT roles don't match any mapping (default: `false`)

**Example 1 - Permissive (default)**: Accept unmapped roles and assign defaultRole
```json
{
  "roleMappings": {
    "admin": ["admin"],
    "user": ["user"],
    "defaultRole": "guest",
    "rejectUnmappedRoles": false
  }
}
```
User with JWT role `"developer"` → Assigned `guest` role (defaultRole)

**Example 2 - Strict**: Reject unmapped roles
```json
{
  "roleMappings": {
    "admin": ["admin"],
    "user": ["user"],
    "rejectUnmappedRoles": true
  }
}
```
User with JWT role `"developer"` → Authentication rejected with `HTTP 401 Unauthorized`

Load configuration via: `configManager.loadConfig(path)` or pass `configPath` to `server.start()`.

## Available FastMCP Tools

### sql-delegate
Execute SQL operations on behalf of legacy users. Requires authentication and legacyUsername claim.

Parameters:
- `action`: "query" | "procedure" | "function"
- `sql`: SQL query string (for query action)
- `procedure`: Stored procedure name (for procedure action)
- `functionName`: Function name (for function action)
- `params`: Parameters object for query/procedure/function
- `resource`: Resource identifier (optional, default: "sql-database")

### health-check
Monitor delegation service health. Requires authentication.

Parameters:
- `service`: "sql" | "kerberos" | "all" (default: "all")

### user-info
Get current user session information. Requires authentication.

Parameters: None

### audit-log
Retrieve audit log entries. **Admin role required**.

Parameters:
- `limit`: Number of entries (1-1000, default: 100)
- `userId`: Filter by user ID (optional)
- `action`: Filter by action type (optional)
- `success`: Filter by success status (optional)

## TypeScript Configuration

- **Module system**: ESNext with ES2022 target
- **Strict mode**: Enabled
- **Source maps**: Generated for debugging
- **Type declarations**: Generated in dist/
- **Test files**: Excluded from build (but not from type checking)

## Development Notes

### Transport Types
- `stdio`: Standard input/output (default in index-simple.ts)
- `sse`: Server-Sent Events
- `http-stream`: HTTP streaming (default in index.ts)

### Testing Coverage
- Configuration validation with Zod schemas
- JWT token format and encoding validation
- SQL identifier validation and injection prevention
- Dangerous SQL operation blocking
- Security error handling and sanitization
- Server integration and tool registration

### Planned Features
- Kerberos Constrained Delegation (S4U2Self/S4U2Proxy)
- Enhanced monitoring with Prometheus metrics
- Automated JWKS key rotation
- Multi-tenant support

## Common Patterns

### Adding a New Tool
1. Register in `setupTools()` method of OAuthOBOServer
2. Define Zod schema for parameters
3. Extract and validate session from context
4. Check permissions with role/scope validation
5. Perform operation with try-catch
6. Log to audit trail with `AuditEntry`
7. Return JSON stringified result

### Adding a New Delegation Service
1. Create service in `src/services/`
2. Implement `DelegationModule` interface from `types/index.ts`
3. Add configuration schema to `config/schema.ts`
4. Initialize in `OAuthOBOServer.start()`
5. Clean up in `OAuthOBOServer.stop()`
6. Add health check to health-check tool

### Error Handling
- Use `createSecurityError(code, message, statusCode)` for security-related errors
- Use `sanitizeError(error)` before logging errors to prevent information leakage
- Never expose internal error details to clients in production
- Log full error details to audit trail for investigation