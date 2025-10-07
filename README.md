# FastMCP OAuth On-Behalf-Of (OBO) Framework

[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org/)
[![Jose](https://img.shields.io/badge/Jose-6.1.0-orange)](https://github.com/panva/jose)
[![FastMCP](https://img.shields.io/badge/FastMCP-3.19.0-purple)](https://github.com/modelcontextprotocol/fastmcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A production-ready, modular OAuth 2.1 authentication and delegation framework for FastMCP. **Extends standard OAuth redirection flow** with on-behalf-of (OBO) authentication, enabling secure server-side delegation to legacy systems (SQL Server, Kerberos, custom APIs) using JWT tokens from external identity providers.

## 🏗️ Architecture

The framework follows a **layered modular architecture** with strict one-way dependencies:

```
┌─────────────────────────────────────────────────────────┐
│                     MCP Layer                            │
│  (FastMCP Integration, Tools, Middleware)               │
│  - MCPAuthMiddleware, ConfigOrchestrator                │
│  - Tool factories with CoreContext injection            │
└──────────────────┬──────────────────────────────────────┘
                   │ depends on ↓
┌─────────────────────────────────────────────────────────┐
│                  Delegation Layer                        │
│  (Pluggable delegation modules)                         │
│  - DelegationRegistry, SQLDelegationModule              │
│  - Custom delegation modules (API, Kerberos, etc.)      │
└──────────────────┬──────────────────────────────────────┘
                   │ depends on ↓
┌─────────────────────────────────────────────────────────┐
│                    Core Layer                            │
│  (Authentication framework - usable standalone)         │
│  - AuthenticationService, JWTValidator                   │
│  - SessionManager, RoleMapper, AuditService             │
│  - CoreContext, CoreContextValidator                     │
└─────────────────────────────────────────────────────────┘
```

**Key Principles:**
- **Core** is usable standalone (no MCP or delegation dependencies)
- **Delegation** is pluggable (add custom modules in <50 LOC)
- **MCP** orchestrates everything via `CoreContext` dependency injection
- **One-way dependencies**: Core ← Delegation ← MCP

## 🚀 Implementation Status

✅ **v2.0.1 RELEASED**: Modular architecture with Core, Delegation, and MCP layers fully implemented and tested.

**Test Coverage**: 319/319 tests passing (100% pass rate, all layers tested)

## ✨ Features

### Implemented ✅
- 🔐 **RFC 8725 Compliant JWT Validation** using jose library v6.1.0+
- 🛡️ **RFC 8414 OAuth Server Metadata** configuration support
- 🎯 **SQL Server EXECUTE AS USER** delegation with comprehensive security
- 🔄 **Multi-IDP Support** with dynamic JWKS discovery and caching
- 📊 **Comprehensive Audit Logging** with Null Object Pattern (works without config)
- ⚡ **Security Monitoring** via health-check, user-info, and sql-delegate tools
- 🧩 **Modular Architecture** - Core, Delegation, and MCP layers
- 🔌 **Pluggable Delegation** - Add custom modules in <50 LOC
- 🎭 **Sophisticated Role Mapping** with Unassigned role failure policy
- 📝 **Session Rejection Pattern** - Authenticated but unauthorized users gracefully rejected
- 🔒 **Two-Tier Security** - Visibility filtering (canAccess) + Execution enforcement (requirePermission)
- 🚀 **Zero-Boilerplate Setup** - MCPOAuthServer wrapper reduces setup from 127 to 19 lines (85% reduction)
- 🛠️ **TypeScript First** with full type safety and CoreContext validation
- 🧪 **319 Tests Passing** - Comprehensive unit and integration tests (100% pass rate)
- 🌐 **Cross-Platform Support** (Windows/Linux tested)
- 📦 **3 Built-in Tools** - sql-delegate, health-check, user-info

### Planned 🔄
- 🎫 **Kerberos Constrained Delegation** (S4U2Self/S4U2Proxy) - Stub implemented
- 📈 **Enhanced Monitoring** with Prometheus metrics
- 🔑 **Automated Key Rotation** for JWKS management
- 🔧 **Authorization Class** - Extracted soft/hard check methods (v2.2.0)

## Quick Start

### Installation

```bash
# From npm (when published)
npm install fastmcp-oauth-obo

# From source (current)
git clone https://github.com/your-org/MCP-Oauth.git
cd MCP-Oauth
npm install
npm run build
```

### Simplest Setup (v2.0+) - Recommended ⭐

Use the `MCPOAuthServer` wrapper for zero-boilerplate setup:

```typescript
import { MCPOAuthServer } from 'fastmcp-oauth-obo';

async function main() {
  // 1. Create server with config path
  const server = new MCPOAuthServer('./config/unified-config.json');

  // 2. (Optional) Register custom delegation modules
  // await server.registerDelegationModule('custom', new CustomModule());

  // 3. Start server
  await server.start({
    transportType: 'httpStream',
    httpStream: { port: 3000, endpoint: '/mcp' },
    stateless: true
  });

  console.log('MCP OAuth Server running on http://localhost:3000/mcp');

  // 4. Graceful shutdown
  process.on('SIGINT', async () => {
    await server.stop();
    process.exit(0);
  });
}

main().catch(console.error);
```

**That's it!** 19 lines vs 127 lines (85% reduction). See [examples/simple-server.ts](examples/simple-server.ts).

### Advanced Setup (Manual Wiring)

For full control, manually wire the components:

```typescript
import {
  ConfigManager,
  ConfigOrchestrator,
  MCPAuthMiddleware,
  getAllToolFactories
} from 'fastmcp-oauth-obo';
import { FastMCP } from 'fastmcp';

async function main() {
  // 1. Load configuration
  const configManager = new ConfigManager();
  await configManager.loadConfig('./config/unified-config.json');

  // 2. Build CoreContext using orchestrator
  const orchestrator = new ConfigOrchestrator({
    configManager,
    enableAudit: true
  });

  const coreContext = await orchestrator.buildCoreContext();

  // 3. Create FastMCP with authentication
  const middleware = new MCPAuthMiddleware(coreContext.authService);

  const server = new FastMCP({
    name: 'My MCP Server',
    version: '1.0.0',
    authenticate: middleware.authenticate.bind(middleware)
  });

  // 4. Register tools using factories
  const toolFactories = getAllToolFactories();

  for (const factory of toolFactories) {
    const tool = factory(coreContext);
    server.addTool({
      name: tool.name,
      description: tool.schema.description || tool.name,
      parameters: tool.schema,
      execute: tool.handler,
      canAccess: tool.canAccess // Two-tier security (visibility + execution)
    });
  }

  // 5. Start server
  await server.start({
    transportType: 'httpStream',
    httpStream: { port: 3000, endpoint: '/mcp' },
    stateless: true
  });
}

main().catch(console.error);
```

See [examples/full-mcp-server.ts](examples/full-mcp-server.ts) for complete example.

## How It Extends Standard OAuth

**Standard OAuth 2.1 Flow** (browser-based redirection):
```
User → Browser → IDP Login → Redirect → Client App (with access token)
```

**This Framework's Extension** (server-side OBO with delegation):
```
User → Client App → MCP Server (validates JWT via JWKS) → Delegation Module → Legacy System
             ↓
        Bearer Token (JWT from external IDP)
             ↓
    Framework validates + creates session
             ↓
    Executes as legacy user (SQL, Kerberos, API)
```

**Key Benefits:**
1. **No Browser Required**: Server-to-server JWT validation using JWKS endpoints
2. **Stateless**: No session storage, validates JWT on every request
3. **Delegation**: Impersonates legacy users in downstream systems (SQL `EXECUTE AS USER`, Kerberos S4U2Proxy)
4. **Multi-IDP**: Trust multiple identity providers simultaneously
5. **Legacy Integration**: Modern OAuth → Legacy Windows/SQL systems

**Security Features:**
- RFC 8725 compliant JWT validation (algorithm allowlisting, claims validation)
- RFC 8693 token exchange for OBO pattern (optional)
- Two-tier authorization (visibility filtering + execution enforcement)
- Comprehensive audit logging with source tracking

## Usage Examples

The framework includes 4 comprehensive examples:

### 1. Core Authentication Only
**File**: [examples/core-only.ts](examples/core-only.ts)

Use the authentication framework standalone without MCP or delegation:

```typescript
import { AuthenticationService, AuditService } from 'fastmcp-oauth-obo';

const auditService = new AuditService({ enabled: true });
const authService = new AuthenticationService(authConfig, auditService);
await authService.initialize();

const result = await authService.authenticate(jwtToken);
if (!result.rejected) {
  console.log('User authenticated:', result.session.userId);
}
```

### 2. Authentication + SQL Delegation
**File**: [examples/with-sql-delegation.ts](examples/with-sql-delegation.ts)

Add SQL delegation without MCP:

```typescript
import {
  AuthenticationService,
  DelegationRegistry,
  SQLDelegationModule
} from 'fastmcp-oauth-obo';

const registry = new DelegationRegistry(auditService);
const sqlModule = new SQLDelegationModule();
await sqlModule.initialize(sqlConfig);
registry.register(sqlModule);

const result = await registry.delegate('sql', session, 'query', {
  sql: 'SELECT * FROM Users WHERE IsActive = @active',
  params: { active: true }
});
```

### 3. Custom Delegation Module
**File**: [examples/custom-delegation.ts](examples/custom-delegation.ts)

Create a custom delegation module (e.g., REST API delegation):

```typescript
import { DelegationModule, DelegationResult } from 'fastmcp-oauth-obo';

class APIDelegationModule implements DelegationModule {
  public readonly name = 'api';
  public readonly type = 'rest-api';

  async delegate<T>(session: UserSession, action: string, params: any): Promise<DelegationResult<T>> {
    const response = await fetch(`${this.config.baseUrl}${params.endpoint}`, {
      headers: {
        'X-Legacy-User': session.legacyUsername,
        'X-On-Behalf-Of': session.userId
      }
    });

    return {
      success: response.ok,
      data: await response.json(),
      auditTrail: { /* ... */ }
    };
  }

  // ... other methods
}
```

### 4. Full MCP Server
**File**: [examples/full-mcp-server.ts](examples/full-mcp-server.ts)

Complete MCP server with all layers - see Quick Start above.

## OAuth Extension Capabilities

### What Makes This Different from Standard OAuth?

Standard OAuth 2.1 is designed for **browser-based user authentication**. This framework extends OAuth for **server-side delegation scenarios** where you need to:

1. **Accept tokens from external IDPs** - No need to implement your own OAuth server
2. **Validate JWTs server-side** - JWKS discovery, caching, and rotation
3. **Map OAuth users to legacy identities** - Modern JWT claims → legacy Windows usernames
4. **Delegate to backend systems** - Execute operations as the authenticated user
5. **Audit everything** - Comprehensive logging with source tracking

### Use Cases

#### 1. SQL Server Integration (Implemented)
**Problem**: Modern OAuth users need to query SQL Server as their legacy Windows identity.

**Solution**: Framework validates JWT → extracts `legacy_sam_account` claim → executes `EXECUTE AS USER [DOMAIN\user]` → runs query → reverts context.

```typescript
// User authenticates to IDP, gets JWT with claim:
// { "legacy_sam_account": "DOMAIN\\jsmith", "roles": ["user"] }

// Framework validates JWT, creates session, executes SQL:
const result = await sqlDelegate({
  action: 'query',
  sql: 'SELECT * FROM Users WHERE IsActive = @active',
  params: { active: true }
});
// SQL executes as DOMAIN\jsmith, respects SQL Server row-level security
```

#### 2. Kerberos Delegation (Planned)
**Problem**: Need to access Kerberos-protected services on behalf of user.

**Solution**: Framework performs S4U2Self (self-to-self) + S4U2Proxy (protocol transition) to obtain Kerberos ticket for downstream service.

#### 3. API Delegation (Custom Module)
**Problem**: Need to call internal API with user context.

**Solution**: Create custom delegation module that adds `X-On-Behalf-Of` headers:

```typescript
class APIDelegationModule implements DelegationModule {
  async delegate(session, action, params) {
    return await fetch(params.url, {
      headers: {
        'X-On-Behalf-Of': session.userId,
        'X-Legacy-User': session.legacyUsername
      }
    });
  }
}
```

### Integration with External IDPs

The framework trusts **external identity providers** via JWKS endpoints:

```json
{
  "auth": {
    "trustedIDPs": [{
      "issuer": "https://auth.company.com",
      "jwksUri": "https://auth.company.com/.well-known/jwks.json",
      "audience": "mcp-server",
      "claimMappings": {
        "legacyUsername": "legacy_sam_account",
        "roles": "user_roles"
      }
    }]
  }
}
```

**Supports:**
- Keycloak, Auth0, Okta, Azure AD, Google Identity Platform
- Custom OAuth 2.1 / OIDC providers
- Multi-IDP scenarios (trust multiple providers simultaneously)

### Token Flow

```
┌──────────┐     ┌─────────────┐     ┌──────────────┐     ┌──────────┐
│  Client  │────▶│ External IDP│────▶│  MCP Server  │────▶│ SQL / API│
│   App    │     │ (Keycloak)  │     │ (This Fwk)   │     │          │
└──────────┘     └─────────────┘     └──────────────┘     └──────────┘
    │                   │                     │                  │
    │ 1. Login          │                     │                  │
    ├──────────────────▶│                     │                  │
    │                   │                     │                  │
    │ 2. JWT Token      │                     │                  │
    │◀──────────────────┤                     │                  │
    │                   │                     │                  │
    │ 3. Bearer Token (JWT)                   │                  │
    ├─────────────────────────────────────────▶                  │
    │                   │                     │                  │
    │                   │ 4. Validate via JWKS│                  │
    │                   │◀────────────────────┤                  │
    │                   │                     │                  │
    │                   │                     │ 5. EXECUTE AS    │
    │                   │                     ├─────────────────▶│
    │                   │                     │                  │
    │                   │                     │ 6. Results       │
    │                   │                     │◀─────────────────┤
    │                   │                     │                  │
    │ 7. Response       │                     │                  │
    │◀─────────────────────────────────────────                  │
```

**No custom OAuth server required!** Just configure trusted IDPs and claim mappings.

## Getting Started Tutorial

This tutorial walks you through creating a complete MCP server with OAuth authentication and SQL delegation in 5 minutes.

### Step 1: Install Dependencies

```bash
npm install fastmcp-oauth-obo fastmcp
# or from source
git clone https://github.com/your-org/MCP-Oauth.git
cd MCP-Oauth && npm install && npm run build
```

### Step 2: Configure Your IDP

Create `config/unified-config.json`:

```json
{
  "auth": {
    "trustedIDPs": [{
      "issuer": "https://auth.example.com",
      "discoveryUrl": "https://auth.example.com/.well-known/oauth-authorization-server",
      "jwksUri": "https://auth.example.com/.well-known/jwks.json",
      "audience": "mcp-server",
      "algorithms": ["RS256"],
      "claimMappings": {
        "legacyUsername": "legacy_sam_account",
        "roles": "user_roles"
      }
    }]
  },
  "delegation": {
    "modules": {
      "sql": {
        "server": "sql-server.example.com",
        "database": "mydb",
        "options": {
          "trustedConnection": true,
          "encrypt": true
        }
      }
    }
  },
  "mcp": {
    "serverName": "My OAuth MCP Server",
    "version": "1.0.0",
    "transport": "httpStream",
    "port": 3000
  }
}
```

**IDP-Specific Examples:**

<details>
<summary><b>Keycloak</b></summary>

```json
{
  "issuer": "https://keycloak.example.com/realms/myrealm",
  "discoveryUrl": "https://keycloak.example.com/realms/myrealm/.well-known/openid-configuration",
  "jwksUri": "https://keycloak.example.com/realms/myrealm/protocol/openid-connect/certs",
  "audience": "mcp-server",
  "claimMappings": {
    "legacyUsername": "preferred_username",
    "roles": "realm_access.roles"
  }
}
```
</details>

<details>
<summary><b>Auth0</b></summary>

```json
{
  "issuer": "https://your-tenant.auth0.com/",
  "discoveryUrl": "https://your-tenant.auth0.com/.well-known/openid-configuration",
  "jwksUri": "https://your-tenant.auth0.com/.well-known/jwks.json",
  "audience": "https://your-api-identifier",
  "claimMappings": {
    "legacyUsername": "https://your-namespace.com/legacy_username",
    "roles": "https://your-namespace.com/roles"
  }
}
```
</details>

<details>
<summary><b>Azure AD</b></summary>

```json
{
  "issuer": "https://login.microsoftonline.com/{tenant-id}/v2.0",
  "discoveryUrl": "https://login.microsoftonline.com/{tenant-id}/v2.0/.well-known/openid-configuration",
  "jwksUri": "https://login.microsoftonline.com/{tenant-id}/discovery/v2.0/keys",
  "audience": "api://{client-id}",
  "claimMappings": {
    "legacyUsername": "upn",
    "roles": "roles"
  }
}
```
</details>

### Step 3: Create Server

Create `server.ts`:

```typescript
import { MCPOAuthServer } from 'fastmcp-oauth-obo';

async function main() {
  const server = new MCPOAuthServer('./config/unified-config.json');

  await server.start({
    transportType: 'httpStream',
    httpStream: { port: 3000, endpoint: '/mcp' },
    stateless: true
  });

  console.log('🚀 MCP OAuth Server running on http://localhost:3000/mcp');

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down...');
    await server.stop();
    process.exit(0);
  });
}

main().catch(console.error);
```

### Step 4: Run Server

```bash
npx tsx server.ts
# or if built:
node dist/server.js
```

### Step 5: Test with cURL

```bash
# Get a JWT token from your IDP (example using Keycloak)
TOKEN=$(curl -X POST "https://keycloak.example.com/realms/myrealm/protocol/openid-connect/token" \
  -d "client_id=myclient" \
  -d "client_secret=secret" \
  -d "grant_type=client_credentials" | jq -r '.access_token')

# Call user-info tool
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "user-info",
      "arguments": {}
    },
    "id": 1
  }'

# Call sql-delegate tool
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "sql-delegate",
      "arguments": {
        "action": "query",
        "sql": "SELECT TOP 10 * FROM Users WHERE IsActive = @active",
        "params": { "active": true }
      }
    },
    "id": 2
  }'
```

### Step 6 (Optional): Add Custom Delegation Module

```typescript
import { MCPOAuthServer, DelegationModule } from 'fastmcp-oauth-obo';

class MyAPIModule implements DelegationModule {
  readonly name = 'myapi';
  readonly type = 'rest-api';

  async initialize(config: any) {
    this.baseUrl = config.baseUrl;
  }

  async delegate(session, action, params) {
    const response = await fetch(`${this.baseUrl}${params.endpoint}`, {
      headers: {
        'Authorization': `Bearer ${params.token}`,
        'X-On-Behalf-Of': session.userId
      }
    });

    return {
      success: response.ok,
      data: await response.json(),
      auditTrail: {
        timestamp: new Date(),
        source: 'delegation:myapi',
        userId: session.userId,
        action: `myapi:${action}`,
        success: response.ok
      }
    };
  }

  async validateAccess(session) { return true; }
  async healthCheck() { return true; }
  async destroy() {}
}

// Register custom module
const server = new MCPOAuthServer('./config/unified-config.json');
await server.registerDelegationModule('myapi', new MyAPIModule());
await server.start({ /* ... */ });
```

**Done!** You now have a production-ready MCP server with OAuth authentication and delegation.

## Configuration

### Unified Configuration Format

```json
{
  "auth": {
    "trustedIDPs": [{
      "issuer": "https://auth.example.com",
      "discoveryUrl": "https://auth.example.com/.well-known/oauth-authorization-server",
      "jwksUri": "https://auth.example.com/.well-known/jwks.json",
      "audience": "mcp-server",
      "algorithms": ["RS256", "ES256"],
      "claimMappings": {
        "legacyUsername": "legacy_sam_account",
        "roles": "user_roles",
        "scopes": "scopes"
      },
      "security": {
        "clockTolerance": 60,
        "maxTokenAge": 3600,
        "requireNbf": true
      }
    }],
    "roleMappings": {
      "adminRole": "admin",
      "userRole": "user",
      "guestRole": "guest",
      "customRoles": ["developer"]
    },
    "audit": {
      "enabled": true,
      "logAllAttempts": true,
      "retentionDays": 90
    }
  },
  "delegation": {
    "modules": {
      "sql": {
        "server": "sql01.company.com",
        "database": "legacy_app",
        "options": {
          "trustedConnection": true,
          "encrypt": true
        }
      }
    }
  },
  "mcp": {
    "serverName": "MCP OAuth Server",
    "version": "2.0.0",
    "transport": "httpStream",
    "port": 3000,
    "enabledTools": ["sql-delegate", "health-check", "user-info"]
  }
}
```

## API Reference

### Core Layer

#### AuthenticationService
```typescript
class AuthenticationService {
  constructor(config: AuthConfig, auditService: AuditService);
  async initialize(): Promise<void>;
  async authenticate(token: string): Promise<AuthenticationResult>;
  async destroy(): Promise<void>;
}
```

#### SessionManager
```typescript
class SessionManager {
  validateSession(session: UserSession): boolean;
  migrateSession(oldSession: any): UserSession;
}
```

#### RoleMapper
```typescript
class RoleMapper {
  constructor(config?: RoleMappingConfig);
  mapRole(claims: Record<string, any>): RoleMappingResult;
}
```

#### AuditService
```typescript
class AuditService {
  constructor(config?: AuditConfig);
  log(entry: AuditEntry): void;
  getEntries(filter?: AuditFilter): AuditEntry[];
  clear(): void;
}
```

### Delegation Layer

#### DelegationRegistry
```typescript
class DelegationRegistry {
  constructor(auditService: AuditService);
  register(module: DelegationModule): void;
  async delegate<T>(moduleName: string, session: UserSession, action: string, params: any): Promise<DelegationResult<T>>;
  list(): string[];
  async destroyAll(): Promise<void>;
}
```

#### SQLDelegationModule
```typescript
class SQLDelegationModule implements DelegationModule {
  readonly name = 'sql';
  async initialize(config: SQLConfig): Promise<void>;
  async delegate<T>(session: UserSession, action: string, params: any): Promise<DelegationResult<T>>;
  async validateAccess(session: UserSession): Promise<boolean>;
  async healthCheck(): Promise<boolean>;
  async destroy(): Promise<void>;
}
```

### MCP Layer

#### MCPOAuthServer ⭐ (v2.0+)
```typescript
class MCPOAuthServer {
  constructor(configPath: string);

  async registerDelegationModule(
    name: string,
    module: DelegationModule
  ): Promise<void>;

  async start(options: {
    transportType: 'stdio' | 'sse' | 'httpStream';
    httpStream?: { port: number; endpoint: string };
    stateless?: boolean;
  }): Promise<void>;

  async stop(): Promise<void>;

  getCoreContext(): CoreContext;
  getConfigManager(): ConfigManager;
  isServerRunning(): boolean;
}
```

**Simplest way to create an MCP server with OAuth!** Handles all wiring automatically.

#### ConfigOrchestrator
```typescript
class ConfigOrchestrator {
  constructor(options: OrchestratorOptions);
  async buildCoreContext(): Promise<CoreContext>;
  static validateCoreContext(context: CoreContext): void;
  static async destroyCoreContext(context: CoreContext): Promise<void>;
}
```

#### MCPAuthMiddleware
```typescript
class MCPAuthMiddleware {
  constructor(authService: AuthenticationService);
  async authenticate(request: any): Promise<UserSession | undefined>;
}
```

#### Tool Factories
```typescript
function createSqlDelegateTool(context: CoreContext): ToolRegistration;
function createHealthCheckTool(context: CoreContext): ToolRegistration;
function createUserInfoTool(context: CoreContext): ToolRegistration;
function getAllToolFactories(): ToolFactory[];
```

## Available Tools

All tools support **two-tier security**:
1. **Visibility** (canAccess) - Controls whether tool appears in tool list
2. **Execution** (requirePermission) - Enforces permissions at execution time

### sql-delegate 🔐
Execute SQL operations on behalf of legacy users using `EXECUTE AS USER` delegation.

**Parameters:**
- `action`: "query" | "procedure" | "function"
- `sql`: SQL query string (for query action)
- `procedure`: Stored procedure name (for procedure action)
- `functionName`: Function name (for function action)
- `params`: Parameters object (supports parameterized queries)
- `resource`: Resource identifier (optional, default: "sql-database")

**Security:**
- **Requires**: `sql:query` permission
- **Visibility**: Users with `sql:query` permission only
- **SQL Injection Prevention**: Parameterized queries mandatory
- **Dangerous Operations Blocked**: DROP, CREATE, ALTER, TRUNCATE, EXEC

**Example:**
```typescript
// Query with parameters
await tool.execute({
  action: 'query',
  sql: 'SELECT * FROM Users WHERE Department = @dept AND IsActive = @active',
  params: { dept: 'Engineering', active: true }
});

// Stored procedure
await tool.execute({
  action: 'procedure',
  procedure: 'sp_GetUserData',
  params: { userId: 123 }
});
```

### health-check ⚕️
Monitor delegation service health and availability.

**Parameters:**
- `service`: "sql" | "kerberos" | "all" (default: "all")

**Security:**
- **Requires**: Authentication (any authenticated user)
- **Visibility**: All authenticated users

**Returns:**
```json
{
  "status": "success",
  "data": {
    "healthy": true,
    "modules": {
      "sql": { "healthy": true, "type": "database" },
      "kerberos": { "healthy": false, "type": "authentication" }
    }
  }
}
```

### user-info 👤
Get current user session information (username, roles, permissions).

**Parameters**: None

**Security:**
- **Requires**: Authentication (any authenticated user)
- **Visibility**: All authenticated users

**Returns:**
```json
{
  "status": "success",
  "data": {
    "userId": "user@example.com",
    "username": "user@example.com",
    "legacyUsername": "DOMAIN\\user",
    "role": "user",
    "customRoles": ["developer"],
    "permissions": ["read", "write", "sql:query"],
    "scopes": ["openid", "profile"]
  }
}
```

**Note**: `audit-log` tool was removed from scope. Admin audit review should use dedicated admin tools (SIEM, database query tools) rather than MCP client interface. See [Docs/refactor-progress.md](Docs/refactor-progress.md#gap-2-missing-mcp-tools) for rationale.

## Security Features

### JWT Security (RFC 8725 Compliance)

- **Mandatory Algorithm Allowlisting**: Only RS256, ES256 permitted
- **Strict Claims Validation**: iss, aud, exp, nbf validation required
- **Token Lifecycle Management**: 15-60 minute access token lifetime
- **Algorithm Confusion Prevention**: Explicit algorithm validation
- **AZP Claim Validation**: Prevents token substitution attacks (OAuth 2.1)

### Session Rejection Pattern

Users are **authenticated but rejected** if they lack required roles:

```typescript
const result = await authService.authenticate(token);

if (result.rejected) {
  // User authenticated but lacks permissions
  // result.session.role === UNASSIGNED_ROLE
  // result.session.permissions === []
  // result.rejectionReason === "Unassigned role not allowed"
}
```

### Role-Based Access Control (RBAC)

- **Priority-Based Role Assignment**: admin → user → custom roles → guest
- **Unassigned Role Failure Policy**: RoleMapper never crashes, returns Unassigned role
- **Custom Role Support**: Define unlimited custom roles
- **Multi-Role Support**: Users can have primary + additional custom roles
- **Nested Claim Support**: Extract roles from nested JWT paths

### SQL Security

- **Parameterized Queries**: Prevention of SQL injection attacks
- **Dangerous Operation Blocking**: DROP, CREATE, ALTER, TRUNCATE, EXEC blocked
- **Context Impersonation**: Secure EXECUTE AS USER implementation
- **Automatic Context Reversion**: Even on errors
- **Connection Security**: TLS encryption required

### Audit and Monitoring

- **Null Object Pattern**: Audit logging works without configuration
- **Source Tracking**: Every entry has source field (auth:service, delegation:sql, etc.)
- **Overflow Callbacks**: Handle audit log overflow gracefully
- **Comprehensive Logging**: All authentication and delegation attempts
- **Security Event Tracking**: Failed attempts and error analysis

## Development

### Prerequisites

- Node.js 18+ (tested with v22.14.0)
- TypeScript 5.6+
- SQL Server with Windows Authentication (for SQL delegation)
- External IDP with JWKS endpoint (for JWT validation)

### Setup

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Run tests (214 tests)
npm test

# Type checking
npm run typecheck

# Linting
npm run lint

# Format code
npm run format

# Development mode (watch)
npm run dev
```

### Testing

```bash
# Run all tests
npm test

# Run specific test file
npm test jwt-validator

# Run with coverage
npm run test:coverage

# Watch mode
npm test -- --watch
```

**Test Coverage**: 319/319 tests passing (100% pass rate)
- ✅ Core layer: 158 tests (validators, audit, JWT, role mapper, session manager, auth service)
- ✅ Delegation layer: 63 tests (registry, SQL module, Kerberos stub)
- ✅ MCP layer: 65 tests (middleware, orchestrator, server wrapper, tools)
- ✅ Config layer: 25 tests (schemas, migration)
- ✅ Integration: 8 tests (core standalone, delegation standalone, MCP standalone)

### Creating a Custom Delegation Module

Implement the `DelegationModule` interface:

```typescript
import { DelegationModule, DelegationResult, UserSession } from 'fastmcp-oauth-obo';

class MyCustomModule implements DelegationModule {
  public readonly name = 'my-module';
  public readonly type = 'custom';

  async initialize(config: any): Promise<void> {
    // Initialize your module
  }

  async delegate<T>(
    session: UserSession,
    action: string,
    params: any
  ): Promise<DelegationResult<T>> {
    // Implement delegation logic
    return {
      success: true,
      data: result as T,
      auditTrail: {
        timestamp: new Date(),
        userId: session.userId,
        action: `my-module:${action}`,
        resource: params.resource || 'my-resource',
        success: true,
        source: 'delegation:my-module'
      }
    };
  }

  async validateAccess(session: UserSession): Promise<boolean> {
    return session.permissions.includes('my-module:access');
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async destroy(): Promise<void> {
    // Cleanup resources
  }
}
```

Register the module:

```typescript
const registry = new DelegationRegistry(auditService);
const myModule = new MyCustomModule();
await myModule.initialize(config);
registry.register(myModule);
```

See [examples/custom-delegation.ts](examples/custom-delegation.ts) for a complete example.

## Documentation

- **[CLAUDE.md](CLAUDE.md)** - Architecture, patterns, and development guide
- **[Docs/MIGRATION.md](Docs/MIGRATION.md)** - Migration guide from legacy to modular architecture
- **[Docs/refactor-progress.md](Docs/refactor-progress.md)** - Detailed refactor progress tracker
- **[examples/](examples/)** - 4 comprehensive usage examples

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`npm test`)
5. Run type checking (`npm run typecheck`)
6. Commit your changes (`git commit -m 'Add amazing feature'`)
7. Push to the branch (`git push origin feature/amazing-feature`)
8. Open a Pull Request

## License

MIT License - see [LICENSE](LICENSE) file for details

## Acknowledgments

- [FastMCP](https://github.com/modelcontextprotocol/fastmcp) - FastMCP TypeScript framework
- [jose](https://github.com/panva/jose) - JWT and JWK library
- [Zod](https://github.com/colinhacks/zod) - TypeScript-first schema validation

## Support

- 📝 Documentation: See [CLAUDE.md](CLAUDE.md) and [Docs/](Docs/) directory
- 🐛 Bug Reports: Create an issue on GitHub
- 💬 Questions: Open a discussion on GitHub
- 📧 Security Issues: security@your-domain.com (private disclosure)
