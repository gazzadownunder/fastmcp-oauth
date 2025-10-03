# Migration Guide: Legacy to Modular Architecture

This guide helps you migrate from the legacy `OAuthOBOServer` class to the new modular architecture introduced in version 2.0.0.

## Table of Contents

- [Overview](#overview)
- [Breaking Changes](#breaking-changes)
- [Migration Steps](#migration-steps)
- [Configuration Migration](#configuration-migration)
- [Code Migration Examples](#code-migration-examples)
- [Testing Your Migration](#testing-your-migration)
- [Troubleshooting](#troubleshooting)

## Overview

### Why Migrate?

The new modular architecture provides:

✅ **Better separation of concerns** - Core, Delegation, and MCP layers are independent
✅ **Standalone usage** - Use authentication without MCP dependencies
✅ **Pluggable delegation** - Add custom delegation modules in <50 LOC
✅ **Improved testability** - Each layer can be tested independently
✅ **Type safety** - Full TypeScript support with CoreContext validation
✅ **Better maintainability** - Clear dependencies and module boundaries

### Architecture Comparison

**Legacy (v1.x):**
```
OAuthOBOServer (monolithic)
├── Authentication logic
├── SQL delegation
├── MCP tools
└── Configuration
```

**New (v2.x):**
```
Core Layer (standalone auth)
  └── AuthenticationService, SessionManager, RoleMapper, AuditService

Delegation Layer (pluggable)
  └── DelegationRegistry + SQLDelegationModule

MCP Layer (orchestration)
  └── ConfigOrchestrator, MCPAuthMiddleware, Tool Factories
```

## Breaking Changes

### 1. Main Export Changed

**Before (v1.x):**
```typescript
import { OAuthOBOServer } from 'fastmcp-oauth-obo';
```

**After (v2.x):**
```typescript
import {
  ConfigManager,
  ConfigOrchestrator,
  MCPAuthMiddleware,
  getAllToolFactories
} from 'fastmcp-oauth-obo';
```

### 2. Configuration Format Changed

**Before (v1.x):** Flat JSON structure
```json
{
  "trustedIDPs": [...],
  "sql": {...},
  "audit": {...}
}
```

**After (v2.x):** Nested structure with `auth`, `delegation`, `mcp` sections
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
    "serverName": "...",
    "port": 3000
  }
}
```

### 3. Server Initialization Changed

**Before (v1.x):**
```typescript
const server = new OAuthOBOServer();
await server.start({ configPath: './config.json' });
```

**After (v2.x):**
```typescript
const configManager = new ConfigManager();
await configManager.loadConfig('./config.json');

const orchestrator = new ConfigOrchestrator({ configManager });
const coreContext = await orchestrator.buildCoreContext();

const middleware = new MCPAuthMiddleware(coreContext.authService);
const server = new FastMCP({ authenticate: middleware.authenticate.bind(middleware) });

// Register tools...
await server.start({ transportType: 'httpStream', httpStream: { port: 3000 } });
```

### 4. Tool Registration Changed

**Before (v1.x):** Tools registered automatically in constructor

**After (v2.x):** Tools registered using factories
```typescript
const toolFactories = getAllToolFactories();

for (const factory of toolFactories) {
  const tool = factory(coreContext);
  server.addTool({
    name: tool.name,
    description: tool.schema.description || tool.name,
    parameters: tool.schema,
    execute: tool.handler
  });
}
```

### 5. Role Mapping Configuration Changed

**Before (v1.x):** Role mappings inside each IDP config
```json
{
  "trustedIDPs": [{
    "roleMappings": {
      "admin": ["admin"],
      "user": ["user"]
    }
  }]
}
```

**After (v2.x):** Global role mappings in `auth.roleMappings`
```json
{
  "auth": {
    "roleMappings": {
      "adminRole": "admin",
      "userRole": "user",
      "guestRole": "guest",
      "customRoles": ["developer", "analyst"]
    }
  }
}
```

## Migration Steps

### Step 1: Update Dependencies

```bash
# Update package.json
npm install fastmcp-oauth-obo@^2.0.0

# Or update package.json manually:
{
  "dependencies": {
    "fastmcp-oauth-obo": "^2.0.0",
    "fastmcp": "^3.19.0"
  }
}
```

### Step 2: Migrate Configuration File

Use the automatic migration utility:

```typescript
import { migrateConfig } from 'fastmcp-oauth-obo';
import fs from 'fs/promises';

const oldConfig = JSON.parse(await fs.readFile('./config/old-config.json', 'utf-8'));
const newConfig = migrateConfig(oldConfig);

await fs.writeFile('./config/unified-config.json', JSON.stringify(newConfig, null, 2));
```

Or manually convert your configuration (see [Configuration Migration](#configuration-migration)).

### Step 3: Update Server Code

Replace your legacy server initialization with the new modular approach.

**Legacy Code:**
```typescript
import { OAuthOBOServer } from './src/index-simple.js';

const server = new OAuthOBOServer();

await server.start({
  transportType: 'httpStream',
  port: 3000,
  configPath: './config.json'
});
```

**New Code:**
```typescript
import { FastMCP } from 'fastmcp';
import {
  ConfigManager,
  ConfigOrchestrator,
  MCPAuthMiddleware,
  getAllToolFactories
} from 'fastmcp-oauth-obo';

async function main() {
  // 1. Load configuration
  const configManager = new ConfigManager();
  await configManager.loadConfig('./config/unified-config.json');

  // 2. Build CoreContext
  const orchestrator = new ConfigOrchestrator({
    configManager,
    enableAudit: true
  });

  const coreContext = await orchestrator.buildCoreContext();

  // 3. Create FastMCP with authentication
  const middleware = new MCPAuthMiddleware(coreContext.authService);

  const server = new FastMCP({
    name: 'My MCP Server',
    version: '2.0.0',
    authenticate: middleware.authenticate.bind(middleware)
  });

  // 4. Register tools
  const toolFactories = getAllToolFactories();

  for (const factory of toolFactories) {
    const tool = factory(coreContext);
    server.addTool({
      name: tool.name,
      description: tool.schema.description || tool.name,
      parameters: tool.schema,
      execute: tool.handler
    });
  }

  // 5. Start server
  const mcpConfig = configManager.getMCPConfig();
  await server.start({
    transportType: 'httpStream',
    httpStream: { port: mcpConfig.port || 3000, endpoint: '/mcp' },
    stateless: true
  });

  console.log('Server started on port', mcpConfig.port || 3000);

  // Graceful shutdown
  process.on('SIGINT', async () => {
    await ConfigOrchestrator.destroyCoreContext(coreContext);
    process.exit(0);
  });
}

main().catch(console.error);
```

### Step 4: Update Tests

**Before:**
```typescript
import { OAuthOBOServer } from '../src/index-simple.js';

const server = new OAuthOBOServer();
await server.start({ configPath: './test-config.json' });
```

**After:**
```typescript
import {
  AuthenticationService,
  AuditService,
  DelegationRegistry,
  SQLDelegationModule
} from 'fastmcp-oauth-obo';

// Test Core layer standalone
const auditService = new AuditService({ enabled: true });
const authService = new AuthenticationService(authConfig, auditService);
await authService.initialize();

const result = await authService.authenticate(mockJwtToken);
expect(result.rejected).toBe(false);

// Test Delegation layer
const registry = new DelegationRegistry(auditService);
const sqlModule = new SQLDelegationModule();
await sqlModule.initialize(sqlConfig);
registry.register(sqlModule);

const delegationResult = await registry.delegate('sql', session, 'query', { sql: '...' });
expect(delegationResult.success).toBe(true);
```

## Configuration Migration

### Full Example

**Legacy Config (`config.json`):**
```json
{
  "trustedIDPs": [
    {
      "issuer": "https://auth.example.com",
      "discoveryUrl": "https://auth.example.com/.well-known/oauth-authorization-server",
      "jwksUri": "https://auth.example.com/.well-known/jwks.json",
      "audience": "mcp-server-api",
      "algorithms": ["RS256", "ES256"],
      "claimMappings": {
        "legacyUsername": "legacy_sam_account",
        "roles": "user_roles",
        "scopes": "authorized_scopes"
      },
      "roleMappings": {
        "admin": ["admin", "administrator"],
        "user": ["user", "authenticated"],
        "guest": ["guest"],
        "defaultRole": "guest"
      },
      "security": {
        "clockTolerance": 60,
        "maxTokenAge": 3600,
        "requireNbf": true
      }
    }
  ],
  "rateLimiting": {
    "maxRequests": 100,
    "windowMs": 900000
  },
  "audit": {
    "logAllAttempts": true,
    "retentionDays": 90
  },
  "sql": {
    "server": "sql01.company.com",
    "database": "legacy_app",
    "options": {
      "trustedConnection": true,
      "encrypt": true
    }
  }
}
```

**New Config (`unified-config.json`):**
```json
{
  "auth": {
    "trustedIDPs": [
      {
        "issuer": "https://auth.example.com",
        "discoveryUrl": "https://auth.example.com/.well-known/oauth-authorization-server",
        "jwksUri": "https://auth.example.com/.well-known/jwks.json",
        "audience": "mcp-server-api",
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
      }
    ],
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

### Key Differences

| **Legacy (v1.x)** | **New (v2.x)** | **Notes** |
|-------------------|----------------|-----------|
| Top-level `trustedIDPs` | `auth.trustedIDPs` | Moved into `auth` section |
| `IDP.roleMappings` | `auth.roleMappings` | Global role mappings, different structure |
| Top-level `audit` | `auth.audit` | Moved into `auth` section |
| Top-level `sql` | `delegation.modules.sql` | Moved into `delegation.modules` |
| ❌ Not present | `mcp` section | New section for MCP-specific config |
| `rateLimiting` | ❌ Removed | Not yet implemented in v2.x |

### Role Mapping Changes

**Legacy format** (per-IDP, role → claim values):
```json
{
  "roleMappings": {
    "admin": ["admin", "administrator"],
    "user": ["user", "authenticated"],
    "defaultRole": "guest"
  }
}
```

**New format** (global, role type → role name):
```json
{
  "roleMappings": {
    "adminRole": "admin",
    "userRole": "user",
    "guestRole": "guest",
    "customRoles": ["developer", "analyst"]
  }
}
```

## Code Migration Examples

### Example 1: Simple Server

**Before:**
```typescript
import { OAuthOBOServer } from 'fastmcp-oauth-obo';

const server = new OAuthOBOServer();
await server.start({
  transportType: 'stdio',
  configPath: './config.json'
});
```

**After:**
```typescript
import { FastMCP } from 'fastmcp';
import {
  ConfigManager,
  ConfigOrchestrator,
  MCPAuthMiddleware,
  getAllToolFactories
} from 'fastmcp-oauth-obo';

const configManager = new ConfigManager();
await configManager.loadConfig('./unified-config.json');

const orchestrator = new ConfigOrchestrator({ configManager, enableAudit: true });
const coreContext = await orchestrator.buildCoreContext();

const middleware = new MCPAuthMiddleware(coreContext.authService);
const server = new FastMCP({
  name: 'My Server',
  version: '2.0.0',
  authenticate: middleware.authenticate.bind(middleware)
});

const toolFactories = getAllToolFactories();
for (const factory of toolFactories) {
  const tool = factory(coreContext);
  server.addTool({
    name: tool.name,
    description: tool.schema.description || tool.name,
    parameters: tool.schema,
    execute: tool.handler
  });
}

await server.start({ transportType: 'stdio', stateless: true });
```

### Example 2: Using Core Layer Only (No MCP)

**Use Case:** You want authentication but don't need MCP tools.

```typescript
import { AuthenticationService, AuditService } from 'fastmcp-oauth-obo';

const auditService = new AuditService({ enabled: true });
const authService = new AuthenticationService(authConfig, auditService);
await authService.initialize();

// Authenticate users
app.post('/api/auth', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const result = await authService.authenticate(token);

  if (result.rejected) {
    return res.status(403).json({
      error: 'Access denied',
      reason: result.rejectionReason
    });
  }

  res.json({
    user: result.session.userId,
    role: result.session.role,
    permissions: result.session.permissions
  });
});
```

### Example 3: Adding Custom Delegation Module

**Use Case:** You want to delegate to a legacy REST API, not just SQL.

```typescript
import {
  DelegationModule,
  DelegationResult,
  UserSession,
  AuditEntry
} from 'fastmcp-oauth-obo';

class APIDelegationModule implements DelegationModule {
  public readonly name = 'api';
  public readonly type = 'rest-api';
  private config?: { baseUrl: string };

  async initialize(config: any): Promise<void> {
    this.config = config;
  }

  async delegate<T>(
    session: UserSession,
    action: string,
    params: any
  ): Promise<DelegationResult<T>> {
    const auditEntry: AuditEntry = {
      timestamp: new Date(),
      userId: session.userId,
      action: `api:${action}`,
      resource: params.endpoint,
      success: false,
      source: 'delegation:api'
    };

    try {
      const response = await fetch(`${this.config!.baseUrl}${params.endpoint}`, {
        method: params.method || 'GET',
        headers: {
          'X-Legacy-User': session.legacyUsername || session.userId,
          'Content-Type': 'application/json'
        },
        body: params.body ? JSON.stringify(params.body) : undefined
      });

      const data = await response.json();

      if (!response.ok) {
        auditEntry.error = `API error: ${response.status}`;
        return { success: false, error: auditEntry.error, auditTrail: auditEntry };
      }

      auditEntry.success = true;
      return { success: true, data: data as T, auditTrail: auditEntry };
    } catch (error) {
      auditEntry.error = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: auditEntry.error, auditTrail: auditEntry };
    }
  }

  async validateAccess(session: UserSession): Promise<boolean> {
    return session.permissions.includes('api:access');
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config!.baseUrl}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }

  async destroy(): Promise<void> {
    this.config = undefined;
  }
}

// Register the module
const registry = new DelegationRegistry(auditService);
const apiModule = new APIDelegationModule();
await apiModule.initialize({ baseUrl: 'https://legacy-api.example.com' });
registry.register(apiModule);
```

## Testing Your Migration

### Checklist

- [ ] Configuration file migrated to unified format
- [ ] Server code updated to use new modular architecture
- [ ] All custom tools migrated to factory pattern
- [ ] Tests updated for new architecture
- [ ] Build succeeds (`npm run build`)
- [ ] Type checking passes (`npm run typecheck`)
- [ ] All tests pass (`npm test`)
- [ ] Server starts without errors
- [ ] Authentication works (try with real JWT)
- [ ] SQL delegation works (if applicable)
- [ ] Audit logging works
- [ ] Health checks work

### Validation Script

```typescript
import { ConfigManager, ConfigOrchestrator } from 'fastmcp-oauth-obo';

async function validateMigration() {
  try {
    console.log('1. Loading configuration...');
    const configManager = new ConfigManager();
    await configManager.loadConfig('./config/unified-config.json');
    console.log('✓ Configuration loaded');

    console.log('2. Building CoreContext...');
    const orchestrator = new ConfigOrchestrator({ configManager, enableAudit: true });
    const coreContext = await orchestrator.buildCoreContext();
    console.log('✓ CoreContext built');

    console.log('3. Validating CoreContext...');
    ConfigOrchestrator.validateCoreContext(coreContext);
    console.log('✓ CoreContext valid');

    console.log('4. Checking services...');
    console.log('  - AuthenticationService:', coreContext.authService ? '✓' : '✗');
    console.log('  - AuditService:', coreContext.auditService ? '✓' : '✗');
    console.log('  - DelegationRegistry:', coreContext.delegationRegistry ? '✓' : '✗');
    console.log('  - ConfigManager:', coreContext.configManager ? '✓' : '✗');

    console.log('\n✅ Migration validation successful!');

    await ConfigOrchestrator.destroyCoreContext(coreContext);
  } catch (error) {
    console.error('\n❌ Migration validation failed:', error);
    process.exit(1);
  }
}

validateMigration();
```

## Troubleshooting

### Issue: "Cannot read properties of undefined (reading 'trustedIDPs')"

**Cause:** Configuration format is still using legacy structure.

**Solution:** Migrate your configuration to the new format with `auth.trustedIDPs` instead of top-level `trustedIDPs`.

### Issue: "CoreContext validation failed"

**Cause:** Missing required services in CoreContext.

**Solution:** Use `ConfigOrchestrator.buildCoreContext()` instead of manually constructing CoreContext.

### Issue: "Deprecated warnings in console"

**Cause:** You're still using `OAuthOBOServer` class.

**Solution:** Migrate to new modular architecture (see Step 3).

### Issue: "Tools not registered"

**Cause:** Tools are no longer auto-registered in constructor.

**Solution:** Use tool factories:
```typescript
const toolFactories = getAllToolFactories();
for (const factory of toolFactories) {
  const tool = factory(coreContext);
  server.addTool({ /* ... */ });
}
```

### Issue: "Role mappings not working"

**Cause:** Role mapping format changed from claim-value arrays to role-type strings.

**Solution:** Update `roleMappings` in config:
```json
{
  "auth": {
    "roleMappings": {
      "adminRole": "admin",
      "userRole": "user",
      "guestRole": "guest",
      "customRoles": ["developer"]
    }
  }
}
```

### Issue: "SQL delegation not working"

**Cause:** SQL config moved to `delegation.modules.sql`.

**Solution:** Update config structure:
```json
{
  "delegation": {
    "modules": {
      "sql": {
        "server": "...",
        "database": "..."
      }
    }
  }
}
```

### Issue: "Tests failing after migration"

**Cause:** Tests still use legacy `OAuthOBOServer` class.

**Solution:** Update tests to use individual services:
```typescript
// Instead of:
const server = new OAuthOBOServer();

// Use:
const auditService = new AuditService({ enabled: true });
const authService = new AuthenticationService(config, auditService);
const registry = new DelegationRegistry(auditService);
```

## Getting Help

If you encounter issues not covered in this guide:

1. Check the [examples/](../examples/) directory for working code
2. Review [CLAUDE.md](../CLAUDE.md) for architecture details
3. Check [refactor-progress.md](refactor-progress.md) for implementation status
4. Open an issue on GitHub with:
   - Your current code
   - Expected behavior
   - Actual behavior
   - Error messages

## Gradual Migration Strategy

If you can't migrate everything at once, consider this approach:

### Phase 1: Keep Legacy, Add New Config
1. Keep `OAuthOBOServer` running (it's deprecated but still works)
2. Create new unified config file alongside old one
3. Validate new config works with validation script

### Phase 2: Migrate Tests
1. Write new tests using modular architecture
2. Keep old tests running
3. Verify both pass

### Phase 3: Migrate Server Code
1. Update server initialization to use new architecture
2. Test thoroughly in development environment
3. Deploy to production

### Phase 4: Clean Up
1. Remove legacy `OAuthOBOServer` imports
2. Delete old configuration files
3. Remove old tests

This phased approach minimizes risk and allows rollback at each step.
