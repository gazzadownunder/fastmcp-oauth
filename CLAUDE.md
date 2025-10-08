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

### Token Exchange Architecture (Phase 1 - RFC 8693)

**Status:** Implementation Complete | **Version:** v3.0 | **Completion Date:** 2025-01-08

The framework implements **RFC 8693 OAuth 2.0 Token Exchange** for on-behalf-of (OBO) delegation. This enables the MCP server to exchange a requestor's JWT for a delegation token with different privileges for downstream resources.

#### Two-Stage Authorization Model

```
┌──────────────────────────────────────────────────────────────────┐
│                    Stage 1: MCP Tool Access                      │
│  Requestor JWT → JWT Validation → Role/Permission Check         │
│  Authorization: Can user access this MCP tool?                   │
└────────────────────────────┬─────────────────────────────────────┘
                             ↓
┌──────────────────────────────────────────────────────────────────┐
│                 Stage 2: Downstream Resource Access              │
│  Token Exchange → Delegation Token (TE-JWT)                      │
│  Authorization: What privileges does user have on SQL/API?       │
└──────────────────────────────────────────────────────────────────┘
```

**Key Principle:** Requestor JWT authorizes MCP tool access, TE-JWT authorizes downstream resource operations.

#### TokenExchangeService

**Location:** [src/delegation/token-exchange.ts](src/delegation/token-exchange.ts)

**Purpose:** Performs stateless RFC 8693 token exchange with external IDPs

**Key Methods:**
- `performExchange(params)` - Exchanges requestor JWT for delegation token
- `decodeTokenClaims(token)` - Extracts claims from TE-JWT (sub, aud, exp, legacy_name, roles, permissions)

**Security Features:**
- HTTPS-only enforcement for token endpoints
- Audit logging for all exchange attempts (success/failure)
- Error sanitization (no sensitive data leakage)
- Configurable per-IDP credentials and audiences

**Configuration Example:**
```json
{
  "trustedIDPs": [{
    "issuer": "https://auth.company.com",
    "tokenExchange": {
      "tokenEndpoint": "https://auth.company.com/token",
      "clientId": "mcp-server",
      "clientSecret": "SECRET",
      "audience": "urn:sql:database"
    }
  }]
}
```

#### Delegation Module Integration

**SQLDelegationModule** ([src/delegation/sql/sql-module.ts](src/delegation/sql/sql-module.ts)) integrates TokenExchangeService:

1. **Before Delegation:** Calls `tokenExchangeService.performExchange()` with requestor JWT
2. **Extract Claims:** Decodes TE-JWT to get `legacy_name`, `roles`, `permissions`
3. **Authorization:** Uses TE-JWT claims (not requestor JWT) for SQL operations
4. **Execute:** Performs `EXECUTE AS USER` with `legacy_name` from TE-JWT

**Example Flow:**
```typescript
// Requestor JWT has role: "user", no legacy_name claim
// Token exchange returns TE-JWT with:
//   - legacy_name: "ALICE_ADMIN"
//   - roles: ["admin"]
//   - permissions: ["sql:write"]

// SQLDelegationModule uses TE-JWT claims for authorization
await sqlDelegator.delegate('ALICE_ADMIN', query, params);
```

#### Why Token Exchange?

**Problem:** Requestor's JWT may not contain required claims for downstream systems (e.g., legacy username for SQL Server)

**Solution:** Exchange requestor JWT for delegation token with appropriate claims

**Benefits:**
1. **Privilege Elevation:** User may have higher privileges on downstream resource
2. **Privilege Reduction:** User may have lower privileges (read-only scope)
3. **Claim Transformation:** Map modern claims to legacy system requirements
4. **Centralized Authorization:** IDP controls both MCP access and resource access

#### Testing

**Test Suite:** [tests/unit/delegation/token-exchange.test.ts](tests/unit/delegation/token-exchange.test.ts)
- **Coverage:** 99% statements, 88% branches, 100% functions
- **Test Count:** 18 tests (configuration, success/error flows, audit logging)

**Test Harness:** [test-harness/PHASE1-TOKEN-EXCHANGE-TEST.md](test-harness/PHASE1-TOKEN-EXCHANGE-TEST.md)
- Web UI testing with Keycloak IDP
- curl command examples for manual testing
- Configuration: [test-harness/config/v2-keycloak-token-exchange.json](test-harness/config/v2-keycloak-token-exchange.json)

---

### EncryptedTokenCache Architecture (Phase 2 - AES-256-GCM)

**Status:** Implementation Complete | **Version:** v3.0 | **Completion Date:** 2025-01-08

Phase 2 adds **optional encrypted token caching** to reduce IDP token exchange requests while maintaining security through cryptographic binding. Cache is **disabled by default** (opt-in via configuration).

#### Problem Statement

Token exchange with external IDPs introduces latency (150-300ms per request). For high-throughput scenarios, caching delegation tokens can reduce latency by 81% while maintaining security.

#### Security-First Design

**Critical Requirement:** Cached tokens must be cryptographically bound to the requestor's JWT to prevent impersonation and replay attacks.

```
┌─────────────────────────────────────────────────────────────────┐
│                  EncryptedTokenCache Security                    │
│                                                                   │
│  1. Session-Specific Encryption Keys (256-bit AES)              │
│     - Unique key per session (perfect forward secrecy)          │
│     - Keys destroyed on session cleanup (secure zeroing)        │
│                                                                   │
│  2. Additional Authenticated Data (AAD) Binding                  │
│     - AAD = SHA-256 hash of requestor JWT                       │
│     - Decryption fails if JWT changes (automatic invalidation)  │
│     - Prevents impersonation even with stolen ciphertext        │
│                                                                   │
│  3. Automatic Invalidation on JWT Refresh                        │
│     - New JWT hash → AAD mismatch → cache miss → new exchange   │
│     - Seamless transition without manual cache clearing         │
│                                                                   │
│  4. TTL Synchronization                                          │
│     - TTL = min(delegation token exp, configured TTL)           │
│     - Prevents serving expired tokens                           │
│                                                                   │
│  5. Heartbeat-Based Session Cleanup                              │
│     - Sessions timeout after inactivity (default: 15 minutes)   │
│     - Automatic key destruction on timeout                      │
└─────────────────────────────────────────────────────────────────┘
```

#### EncryptedTokenCache

**Location:** [src/delegation/encrypted-token-cache.ts](src/delegation/encrypted-token-cache.ts)

**Purpose:** Session-scoped encrypted cache with AAD binding to requestor JWT

**Key Methods:**
- `activateSession(requestorJWT, jwtSubject)` - Generate session-specific 256-bit encryption key
- `set(sessionId, cacheKey, delegationToken, requestorJWT, expiresAt)` - Encrypt with AAD binding
- `get(sessionId, cacheKey, requestorJWT)` - Decrypt with AAD validation
- `clearSession(sessionId)` - Secure key destruction (zero memory)
- `heartbeat(sessionId)` - Update last-active timestamp
- `getMetrics()` - Cache performance metrics

**Encryption Details:**
- **Algorithm:** AES-256-GCM (authenticated encryption)
- **Key Generation:** `crypto.randomBytes(32)` per session
- **IV:** Random 12 bytes per encryption operation (never reused)
- **AAD:** SHA-256 hash of requestor JWT (binds ciphertext to specific JWT)
- **Auth Tag:** 16 bytes (prevents tampering)

**Security Guarantees:**

| Attack Scenario | Protection Mechanism |
|----------------|---------------------|
| Impersonation Attack | AAD binding - Different JWT = decryption failure |
| Replay Attack | Stolen ciphertext useless without exact JWT |
| Spoofing Attack | Forged cache entry fails AAD validation |
| Session Key Compromise | Still requires requestor JWT hash to decrypt |
| Token Revocation | JWT refresh invalidates cache automatically |
| Memory Dump Attack | Encrypted data requires both key + JWT hash |

**Configuration Example:**
```json
{
  "tokenExchange": {
    "tokenEndpoint": "https://auth.company.com/token",
    "clientId": "mcp-server",
    "clientSecret": "SECRET",
    "cache": {
      "enabled": true,
      "ttlSeconds": 60,
      "sessionTimeoutMs": 900000,
      "maxEntriesPerSession": 10,
      "maxTotalEntries": 1000
    }
  }
}
```

#### Integration with TokenExchangeService

When cache is enabled, TokenExchangeService performs the following flow:

```typescript
1. Activate session if not already active
   → cache.activateSession(requestorJWT, jwtSubject)

2. Generate cache key from audience
   → cacheKey = `te:${audience}`

3. Try cache lookup
   → cachedToken = cache.get(sessionId, cacheKey, requestorJWT)

4. If cache hit:
   → return cachedToken (latency: <1ms)

5. If cache miss:
   → perform token exchange with IDP (latency: 150-300ms)
   → cache.set(sessionId, cacheKey, delegationToken, requestorJWT, expiresAt)
   → return delegationToken

6. On JWT refresh:
   → AAD mismatch → cache miss → automatic new token exchange
```

#### Performance Characteristics

| Metric | Cache Disabled | Cache Enabled (60s TTL) |
|--------|---------------|-------------------------|
| Token exchange latency (p99) | 300ms | N/A |
| Cache hit latency (p99) | N/A | <2ms |
| Overall latency reduction | Baseline | 81% |
| Memory usage (1K sessions) | <5MB | <10MB |
| Cache hit rate | N/A | >85% |

#### Testing

**Test Suite:** [tests/unit/delegation/encrypted-token-cache.test.ts](tests/unit/delegation/encrypted-token-cache.test.ts)
- **Coverage:** 97% statements, 92% branches, 100% functions
- **Test Count:** 29 tests (encryption/decryption, TTL, security attacks, metrics)

**Security Test Scenarios:**
- Impersonation attack (different requestor JWT fails decryption)
- Replay attack (stolen ciphertext useless without exact JWT)
- Spoofing attack (forged cache entry fails AAD validation)
- Session key compromise (still requires requestor JWT to decrypt)
- Token revocation (new JWT invalidates old cached tokens)
- Memory dump attack (encrypted data requires both key + JWT hash)

#### Cache Metrics

Available via `tokenExchangeService.getCacheMetrics()`:

```typescript
{
  cacheHits: number;           // Successful cache lookups
  cacheMisses: number;         // Cache misses (token exchange performed)
  decryptionFailures: number;  // AAD mismatch (JWT changed)
  requestorMismatch: number;   // Session ownership violation
  activeSessions: number;      // Sessions with active encryption keys
  totalEntries: number;        // Total cached entries
  memoryUsageEstimate: number; // Estimated memory usage (bytes)
}
```

#### Why Opt-In Design?

Cache is **disabled by default** to prioritize security over performance. Enable caching only when:

1. **High throughput requirements** - Token exchange latency is a bottleneck
2. **Security review completed** - Cryptographic implementation validated
3. **Monitoring in place** - Cache metrics tracked and alerted
4. **Risk acceptance** - Understanding that cached tokens exist in memory

#### Operational Considerations

**Memory Management:**
- Set `maxEntriesPerSession` to limit per-session memory usage
- Set `maxTotalEntries` to cap global cache size
- Monitor `memoryUsageEstimate` metric for capacity planning

**Session Cleanup:**
- Sessions timeout after `sessionTimeoutMs` (default: 15 minutes)
- Encryption keys securely destroyed on timeout
- Automatic LRU eviction when size limits reached

**Hot-Reload Support:**
- Cache can be enabled/disabled via configuration hot-reload
- Existing sessions unaffected by config changes
- New sessions respect new configuration

---

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