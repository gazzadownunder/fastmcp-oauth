# Modular Architecture Refactoring Plan

## Executive Summary

Refactor the monolithic OAuth OBO server into a layered, modular architecture that separates core authentication from MCP integration and delegation modules. This enables the framework to be used standalone, with custom delegation strategies, and in non-MCP contexts.

## Current Architecture Issues

### Problems
1. **Tight Coupling**: `OAuthOBOServer` directly manages SQL delegation - no separation of concerns
2. **Monolithic Design**: Core authentication is mixed with MCP integration and delegation logic
3. **No Plugin System**: Cannot easily add/remove delegation modules without modifying core
4. **Tool Coupling**: Tools are hardcoded in server class, not modular or extensible
5. **Reusability**: Cannot use authentication framework without FastMCP dependency

### Current File Structure
```
src/
├── middleware/
│   └── jwt-validator.ts      # JWT validation (coupled with role mapping)
├── services/
│   └── sql-delegator.ts      # SQL delegation (tightly coupled)
├── config/
│   ├── manager.ts
│   └── schema.ts             # Monolithic config schema
├── types/
│   └── index.ts              # Mixed types
├── utils/
│   └── errors.ts
├── index.ts                  # Exports everything
└── index-simple.ts           # MCP server (monolithic)
```

## Target Architecture

### Design Goals
1. **Layered Architecture**: Core → Delegation → MCP Integration
2. **Separation of Concerns**: Authentication, authorization, delegation are separate
3. **Pluggable Modules**: Easy to add/remove delegation strategies
4. **Framework Flexibility**: Use auth without delegation, delegation without MCP, etc.
5. **Backward Compatible**: Existing code continues to work with adapters

### Target File Structure
```
src/
├── core/                     # 🆕 Core Authentication Framework (standalone)
│   ├── jwt-validator.ts      # JWT validation only
│   ├── role-mapper.ts        # Role mapping logic
│   ├── authentication-service.ts  # Main auth API
│   ├── session-manager.ts    # Session lifecycle
│   ├── types.ts              # Core types only
│   └── index.ts              # Clean public API
│
├── delegation/               # 🆕 Delegation Module System
│   ├── base.ts               # DelegationModule interface
│   ├── registry.ts           # DelegationRegistry (plugin manager)
│   ├── types.ts              # Delegation types
│   ├── sql/                  # SQL Module (refactored)
│   │   ├── sql-module.ts     # Implements DelegationModule
│   │   ├── sql-delegator.ts  # Core SQL logic
│   │   ├── types.ts          # SQL-specific types
│   │   └── index.ts          # SQL module exports
│   ├── kerberos/             # Kerberos Module (placeholder)
│   │   ├── kerberos-module.ts
│   │   ├── types.ts
│   │   └── index.ts
│   └── index.ts              # Delegation exports
│
├── mcp/                      # 🆕 MCP Integration Layer
│   ├── middleware.ts         # FastMCP auth middleware
│   ├── authorization.ts      # Role/permission helpers
│   ├── server.ts             # FastMCP server orchestration
│   ├── types.ts              # MCP-specific types
│   ├── tools/                # MCP Tools (refactored)
│   │   ├── health-check.ts
│   │   ├── user-info.ts
│   │   ├── audit-log.ts
│   │   └── index.ts
│   └── index.ts              # MCP exports
│
├── config/                   # Updated Config Management
│   ├── schemas/              # 🆕 Modular schemas
│   │   ├── core.ts           # Core auth config
│   │   ├── delegation.ts     # Delegation config
│   │   └── mcp.ts            # MCP config
│   ├── manager.ts            # Updated for modular config
│   └── index.ts
│
├── utils/                    # Utilities (unchanged)
│   └── errors.ts
│
├── legacy/                   # 🆕 Backward compatibility adapters
│   └── index-simple-adapter.ts
│
├── examples/                 # 🆕 Usage examples
│   ├── core-only.ts          # Auth framework only
│   ├── with-sql-delegation.ts
│   ├── custom-delegation.ts
│   └── full-mcp-server.ts
│
└── index.ts                  # Unified exports (all modules)
```

## Implementation Phases

### Phase 1: Core Authentication Framework (Standalone)

#### 1.1 Create Core Types (`src/core/types.ts`)
```typescript
export interface AuthConfig {
  trustedIDPs: IDPConfig[];
  rateLimiting?: RateLimitConfig;
  audit?: AuditConfig;
}

export interface UserSession {
  userId: string;
  username: string;
  legacyUsername?: string;
  role: string;
  customRoles?: string[];
  permissions: string[];
  scopes?: string[];
  claims?: Record<string, unknown>;
}

export interface AuthenticationResult {
  session: UserSession;
  auditEntry: AuditEntry;
}

export interface RoleMapper {
  determineRoles(roles: string[], config?: any): {
    primaryRole: string;
    customRoles: string[];
  };
}
```

#### 1.2 Extract JWT Validator (`src/core/jwt-validator.ts`)
- Move from `src/middleware/jwt-validator.ts`
- Remove role mapping logic (move to role-mapper.ts)
- Focus only on JWT validation and claim extraction
- Returns raw JWT payload + mapped claims

#### 1.3 Create Role Mapper (`src/core/role-mapper.ts`)
- Extract role mapping logic from jwt-validator
- Implement RoleMapper interface
- Support priority-based role assignment
- Support custom roles

#### 1.4 Create Authentication Service (`src/core/authentication-service.ts`)
```typescript
export class AuthenticationService {
  constructor(config: AuthConfig);

  async authenticate(token: string): Promise<AuthenticationResult>;
  async validateSession(sessionId: string): Promise<UserSession | null>;
  getConfig(): AuthConfig;
}
```

#### 1.5 Create Session Manager (`src/core/session-manager.ts`)
```typescript
export class SessionManager {
  createSession(jwtPayload: JWTPayload, roleInfo: any): UserSession;
  validateSession(session: UserSession): boolean;
  refreshSession(session: UserSession): UserSession;
}
```

#### 1.6 Create Core Public API (`src/core/index.ts`)
```typescript
export { AuthenticationService } from './authentication-service.js';
export { SessionManager } from './session-manager.js';
export { JWTValidator } from './jwt-validator.js';
export { RoleMapper } from './role-mapper.js';
export * from './types.js';
```

---

### Phase 2: Delegation Module System

#### 2.1 Define Module Interface (`src/delegation/base.ts`)
```typescript
export interface DelegationModule {
  readonly name: string;
  readonly type: string;

  initialize(config: any): Promise<void>;
  delegate<T>(session: UserSession, action: string, params: any): Promise<DelegationResult<T>>;
  validateAccess(session: UserSession): Promise<boolean>;
  healthCheck(): Promise<boolean>;
  destroy(): Promise<void>;
}

export interface DelegationResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  auditTrail: AuditEntry;
}
```

#### 2.2 Create Delegation Registry (`src/delegation/registry.ts`)
```typescript
export class DelegationRegistry {
  private modules: Map<string, DelegationModule> = new Map();

  register(module: DelegationModule): void;
  unregister(name: string): void;
  get(name: string): DelegationModule | undefined;
  list(): DelegationModule[];
  async initializeAll(configs: Record<string, any>): Promise<void>;
  async destroyAll(): Promise<void>;
}
```

#### 2.3 Refactor SQL as Module (`src/delegation/sql/sql-module.ts`)
```typescript
export class SQLDelegationModule implements DelegationModule {
  readonly name = 'sql';
  readonly type = 'database';

  private delegator: SQLDelegator;

  constructor() {
    this.delegator = new SQLDelegator();
  }

  async initialize(config: SQLConfig): Promise<void> {
    await this.delegator.initialize(config);
  }

  async delegate<T>(
    session: UserSession,
    action: string,
    params: any
  ): Promise<DelegationResult<T>> {
    return this.delegator.delegate(
      session.legacyUsername!,
      action,
      params
    );
  }

  // ... other methods
}
```

#### 2.4 Move SQL Delegator (`src/delegation/sql/sql-delegator.ts`)
- Move from `src/services/sql-delegator.ts`
- Remove direct session dependency
- Keep core SQL logic
- Add SQL-specific exports in `src/delegation/sql/index.ts`

#### 2.5 Create Kerberos Module Structure (`src/delegation/kerberos/`)
```typescript
// src/delegation/kerberos/kerberos-module.ts
export class KerberosDelegationModule implements DelegationModule {
  readonly name = 'kerberos';
  readonly type = 'authentication';

  // Placeholder implementation for future
  async initialize(config: KerberosConfig): Promise<void> {
    throw new Error('Kerberos delegation not yet implemented');
  }

  // ... stub methods
}
```

#### 2.6 Create Delegation Public API (`src/delegation/index.ts`)
```typescript
export { DelegationModule, DelegationResult } from './base.js';
export { DelegationRegistry } from './registry.js';
export { SQLDelegationModule } from './sql/index.js';
export { KerberosDelegationModule } from './kerberos/index.js';
export * from './types.js';
```

---

### Phase 3: MCP Integration Layer

#### 3.1 Create MCP Middleware (`src/mcp/middleware.ts`)
```typescript
import { AuthenticationService } from '../core/index.js';
import { FastMCPRequestContext } from 'fastmcp';

export class MCPAuthMiddleware {
  constructor(private authService: AuthenticationService);

  async authenticate(request: any): Promise<FastMCPRequestContext> {
    const token = this.extractToken(request);
    const { session } = await this.authService.authenticate(token);

    return {
      session,
      // ... other context
    };
  }

  private extractToken(request: any): string {
    // Extract Bearer token from Authorization header
  }
}
```

#### 3.2 Create Authorization Helpers (`src/mcp/authorization.ts`)
```typescript
export class Authorization {
  static requireRole(session: UserSession, role: string): void {
    if (session.role !== role && !session.customRoles?.includes(role)) {
      throw createSecurityError('INSUFFICIENT_PERMISSIONS',
        `Required role: ${role}`, 403);
    }
  }

  static requireAnyRole(session: UserSession, roles: string[]): void {
    // Check if user has any of the required roles
  }

  static requirePermission(session: UserSession, permission: string): void {
    // Check if user has specific permission
  }

  static hasCustomRole(session: UserSession, role: string): boolean {
    return session.customRoles?.includes(role) ?? false;
  }
}
```

#### 3.3 Refactor Tools (`src/mcp/tools/`)
Move and update existing tools to use session context:

```typescript
// src/mcp/tools/health-check.ts
import { Authorization } from '../authorization.js';

export function createHealthCheckTool(registry: DelegationRegistry) {
  return {
    name: 'health-check',
    description: 'Check delegation service health',
    schema: z.object({
      service: z.enum(['sql', 'kerberos', 'all']).default('all')
    }),
    handler: async (params: any, context: any) => {
      // Get session from context
      const session = context.session as UserSession;
      if (!session) {
        throw createSecurityError('UNAUTHENTICATED', 'No session', 401);
      }

      // Authorization check
      Authorization.requireAnyRole(session, ['admin', 'user']);

      // Use registry to check health
      if (params.service === 'all') {
        const modules = registry.list();
        const results = await Promise.all(
          modules.map(m => m.healthCheck())
        );
        return { healthy: results.every(r => r), modules };
      }

      const module = registry.get(params.service);
      if (!module) {
        throw new Error(`Module not found: ${params.service}`);
      }

      return { healthy: await module.healthCheck() };
    }
  };
}
```

#### 3.4 Create MCP Server Orchestration (`src/mcp/server.ts`)
```typescript
import { FastMCP } from 'fastmcp';
import { AuthenticationService } from '../core/index.js';
import { DelegationRegistry } from '../delegation/index.js';
import { MCPAuthMiddleware } from './middleware.js';
import * as tools from './tools/index.js';

export class MCPOAuthServer {
  private server: FastMCP;
  private authService: AuthenticationService;
  private delegationRegistry: DelegationRegistry;
  private middleware: MCPAuthMiddleware;

  constructor(config: MCPOAuthConfig) {
    this.authService = new AuthenticationService(config.auth);
    this.delegationRegistry = new DelegationRegistry();
    this.middleware = new MCPAuthMiddleware(this.authService);

    this.server = new FastMCP({
      name: config.serverName || 'OAuth OBO Server',
      version: config.version || '1.0.0'
    });
  }

  async registerDelegationModule(module: DelegationModule, config: any): Promise<void> {
    await module.initialize(config);
    this.delegationRegistry.register(module);
  }

  async start(options: MCPStartOptions): Promise<void> {
    // Setup authentication
    this.server.setAuthHandler(async (request) => {
      return this.middleware.authenticate(request);
    });

    // Register tools
    this.server.addTool(tools.createHealthCheckTool(this.delegationRegistry));
    this.server.addTool(tools.createUserInfoTool());
    this.server.addTool(tools.createAuditLogTool(this.auditLog));

    // Start server
    await this.server.start(options);
  }

  async stop(): Promise<void> {
    await this.delegationRegistry.destroyAll();
    await this.server.stop();
  }
}
```

#### 3.5 Create MCP Public API (`src/mcp/index.ts`)
```typescript
export { MCPOAuthServer } from './server.js';
export { MCPAuthMiddleware } from './middleware.js';
export { Authorization } from './authorization.js';
export * from './types.js';
```

---

### Phase 4: Configuration Schema Updates

#### 4.1 Create Modular Config Schemas (`src/config/schemas/`)

**Core Auth Schema** (`src/config/schemas/core.ts`):
```typescript
export const CoreAuthConfigSchema = z.object({
  trustedIDPs: z.array(IDPConfigSchema).min(1),
  rateLimiting: RateLimitConfigSchema.optional(),
  audit: AuditConfigSchema.optional()
});
```

**Delegation Schema** (`src/config/schemas/delegation.ts`):
```typescript
export const DelegationConfigSchema = z.object({
  modules: z.record(z.any()).optional(), // Module configs by name
  sql: SQLConfigSchema.optional(),
  kerberos: KerberosConfigSchema.optional()
});
```

**MCP Schema** (`src/config/schemas/mcp.ts`):
```typescript
export const MCPConfigSchema = z.object({
  serverName: z.string(),
  version: z.string(),
  transport: z.enum(['stdio', 'sse', 'http-stream']),
  port: z.number().optional(),
  enabledTools: z.array(z.string()).optional()
});
```

**Unified Config** (`src/config/schemas/index.ts`):
```typescript
export const UnifiedConfigSchema = z.object({
  auth: CoreAuthConfigSchema,
  delegation: DelegationConfigSchema.optional(),
  mcp: MCPConfigSchema.optional()
});
```

#### 4.2 Update Config Manager (`src/config/manager.ts`)
```typescript
export class ConfigManager {
  private config: UnifiedConfig;

  loadConfig(path: string): void {
    const raw = JSON.parse(fs.readFileSync(path, 'utf-8'));
    this.config = UnifiedConfigSchema.parse(raw);
  }

  getAuthConfig(): CoreAuthConfig {
    return this.config.auth;
  }

  getDelegationConfig(): DelegationConfig | undefined {
    return this.config.delegation;
  }

  getMCPConfig(): MCPConfig | undefined {
    return this.config.mcp;
  }
}
```

#### 4.3 Create Config Migration Utility
```typescript
// src/config/migrate.ts
export function migrateOldConfig(oldConfig: OAuthOBOConfig): UnifiedConfig {
  return {
    auth: {
      trustedIDPs: oldConfig.trustedIDPs,
      rateLimiting: oldConfig.rateLimiting,
      audit: oldConfig.audit
    },
    delegation: {
      sql: oldConfig.sql,
      kerberos: oldConfig.kerberos
    },
    mcp: {
      serverName: 'OAuth OBO Server',
      version: '1.0.0',
      transport: 'stdio'
    }
  };
}
```

---

### Phase 5: Entry Points & Examples

#### 5.1 Update Main Export (`src/index.ts`)
```typescript
// Core Authentication Framework
export * from './core/index.js';

// Delegation System
export * from './delegation/index.js';

// MCP Integration
export * from './mcp/index.js';

// Configuration
export * from './config/index.js';

// Utils
export * from './utils/errors.js';

// Backward compatibility (deprecated)
export { OAuthOBOServer } from './legacy/index-simple-adapter.js';
```

#### 5.2 Create Usage Examples

**Example 1: Core Auth Only** (`examples/core-only.ts`):
```typescript
import { AuthenticationService } from '../src/core/index.js';

const authService = new AuthenticationService({
  trustedIDPs: [/* ... */]
});

const { session } = await authService.authenticate(jwtToken);
console.log('User authenticated:', session.userId);
```

**Example 2: Auth + SQL Delegation** (`examples/with-sql-delegation.ts`):
```typescript
import { AuthenticationService } from '../src/core/index.js';
import { DelegationRegistry, SQLDelegationModule } from '../src/delegation/index.js';

const authService = new AuthenticationService(authConfig);
const registry = new DelegationRegistry();

const sqlModule = new SQLDelegationModule();
await sqlModule.initialize(sqlConfig);
registry.register(sqlModule);

// Use in your app
const { session } = await authService.authenticate(token);
const result = await registry.get('sql')!.delegate(
  session,
  'query',
  { sql: 'SELECT * FROM Users', params: {} }
);
```

**Example 3: Custom Delegation Module** (`examples/custom-delegation.ts`):
```typescript
import { DelegationModule, DelegationResult } from '../src/delegation/index.js';

class CustomAPIModule implements DelegationModule {
  readonly name = 'custom-api';
  readonly type = 'api';

  async delegate(session: UserSession, action: string, params: any) {
    // Custom delegation logic
    const response = await fetch('https://api.example.com/data', {
      headers: {
        'X-User': session.legacyUsername,
        'X-Role': session.role
      }
    });

    return {
      success: true,
      data: await response.json(),
      auditTrail: { /* ... */ }
    };
  }

  // ... other methods
}
```

**Example 4: Full MCP Server** (`examples/full-mcp-server.ts`):
```typescript
import { MCPOAuthServer } from '../src/mcp/index.js';
import { SQLDelegationModule } from '../src/delegation/sql/index.js';

const server = new MCPOAuthServer({
  auth: authConfig,
  mcp: {
    serverName: 'My OAuth MCP Server',
    version: '1.0.0',
    transport: 'http-stream'
  }
});

// Register delegation modules
await server.registerDelegationModule(
  new SQLDelegationModule(),
  sqlConfig
);

await server.start({ port: 3000 });
```

#### 5.3 Create Backward Compatibility Adapter
```typescript
// src/legacy/index-simple-adapter.ts
import { MCPOAuthServer } from '../mcp/server.js';

/**
 * @deprecated Use MCPOAuthServer from src/mcp instead
 */
export class OAuthOBOServer extends MCPOAuthServer {
  constructor() {
    console.warn('OAuthOBOServer is deprecated. Use MCPOAuthServer instead.');
    super({
      auth: {/* old config adapter */},
      mcp: {/* defaults */}
    });
  }
}
```

---

### Phase 6: Documentation & Migration

#### 6.1 Update README.md
- Add architecture diagram showing layers
- Update quick start examples
- Add module system documentation
- Update configuration examples
- Add custom module development guide

#### 6.2 Create Migration Guide (`Docs/MIGRATION.md`)
```markdown
# Migration Guide: v1.x to v2.0

## Breaking Changes
- Configuration format changed to modular structure
- `OAuthOBOServer` replaced with `MCPOAuthServer`
- Direct delegation access replaced with registry pattern

## Migration Steps

### Step 1: Update Configuration
Old format:
```json
{
  "trustedIDPs": [...],
  "sql": {...}
}
```

New format:
```json
{
  "auth": {
    "trustedIDPs": [...]
  },
  "delegation": {
    "sql": {...}
  },
  "mcp": {
    "serverName": "...",
    "transport": "stdio"
  }
}
```

### Step 2: Update Code
Old:
```typescript
import { OAuthOBOServer } from 'fastmcp-oauth-obo';
const server = new OAuthOBOServer();
```

New:
```typescript
import { MCPOAuthServer } from 'fastmcp-oauth-obo/mcp';
import { SQLDelegationModule } from 'fastmcp-oauth-obo/delegation';

const server = new MCPOAuthServer(config);
await server.registerDelegationModule(new SQLDelegationModule(), sqlConfig);
```
```

#### 6.3 Update CLAUDE.md
- Document new module structure
- Update common patterns for each layer
- Add delegation module development guide
- Update architecture section

#### 6.4 Add JSDoc Comments
All public APIs must have comprehensive JSDoc:

```typescript
/**
 * Core authentication service for JWT validation and session management.
 *
 * @example
 * ```typescript
 * const auth = new AuthenticationService({
 *   trustedIDPs: [{ issuer: '...', ... }]
 * });
 *
 * const { session } = await auth.authenticate(bearerToken);
 * ```
 */
export class AuthenticationService {
  /**
   * Authenticate a JWT token and create a user session.
   *
   * @param token - JWT Bearer token
   * @returns Authentication result with session and audit entry
   * @throws {OAuthSecurityError} If token is invalid or expired
   */
  async authenticate(token: string): Promise<AuthenticationResult> {
    // ...
  }
}
```

---

## Testing Strategy

### Unit Tests
- [ ] Core: `AuthenticationService` isolated tests
- [ ] Core: `RoleMapper` with various config scenarios
- [ ] Core: `SessionManager` lifecycle tests
- [ ] Delegation: `DelegationRegistry` registration/lookup
- [ ] Delegation: `SQLDelegationModule` implementation
- [ ] MCP: `MCPAuthMiddleware` request handling
- [ ] MCP: `Authorization` helper functions

### Integration Tests
- [ ] Core + Delegation: Auth → Delegation flow
- [ ] MCP + Core: Request → Auth → Session flow
- [ ] Full Stack: HTTP request → Auth → Delegation → Response
- [ ] Config migration utility

### Backward Compatibility Tests
- [ ] Old `OAuthOBOServer` still works with adapter
- [ ] Old config format migrates correctly
- [ ] Existing tools continue to function

---

## Migration Checklist

### Pre-Migration
- [ ] Review current usage patterns
- [ ] Identify custom extensions
- [ ] Backup current implementation
- [ ] Create feature branch

### Phase 1: Core Framework
- [ ] Create `src/core/` directory
- [ ] Move `jwt-validator.ts` to core (remove role logic)
- [ ] Create `role-mapper.ts` with extracted logic
- [ ] Create `authentication-service.ts`
- [ ] Create `session-manager.ts`
- [ ] Create `src/core/index.ts` exports
- [ ] Update tests for core modules
- [ ] Verify core works standalone

### Phase 2: Delegation System
- [ ] Create `src/delegation/` structure
- [ ] Define `DelegationModule` interface
- [ ] Create `DelegationRegistry`
- [ ] Refactor SQL delegator as module
- [ ] Move to `src/delegation/sql/`
- [ ] Create Kerberos placeholder structure
- [ ] Create delegation exports
- [ ] Test delegation registry

### Phase 3: MCP Integration
- [ ] Create `src/mcp/` directory
- [ ] Create `MCPAuthMiddleware`
- [ ] Create `Authorization` helpers
- [ ] Move tools to `src/mcp/tools/`
- [ ] Update tools to use Authorization
- [ ] Create `MCPOAuthServer` orchestration
- [ ] Create MCP exports
- [ ] Test MCP integration

### Phase 4: Configuration
- [ ] Create modular config schemas
- [ ] Update `ConfigManager` for new format
- [ ] Create config migration utility
- [ ] Test config validation
- [ ] Verify backward compatibility

### Phase 5: Entry Points
- [ ] Update `src/index.ts` with all exports
- [ ] Create usage examples (4 scenarios)
- [ ] Create backward compatibility adapter
- [ ] Test all entry points
- [ ] Verify tree-shaking works

### Phase 6: Documentation
- [ ] Update README.md architecture section
- [ ] Create MIGRATION.md guide
- [ ] Update CLAUDE.md for new structure
- [ ] Add JSDoc to all public APIs
- [ ] Create module development guide
- [ ] Update examples in docs

### Post-Migration
- [ ] Run full test suite
- [ ] Verify backward compatibility
- [ ] Update package.json exports
- [ ] Update build configuration
- [ ] Performance testing
- [ ] Security review
- [ ] Create release notes

---

## Benefits of New Architecture

### For Framework Users
✅ **Use what you need**: Auth-only, auth+delegation, or full MCP stack
✅ **Custom delegation**: Easy to add your own delegation strategies
✅ **Better DX**: Clear separation, better types, comprehensive docs
✅ **Backward compatible**: Old code continues to work

### For Maintainers
✅ **Better organization**: Clear module boundaries
✅ **Easier testing**: Each layer tested independently
✅ **Extensibility**: Plugin system for new features
✅ **Reduced coupling**: Changes isolated to specific layers

### For the Ecosystem
✅ **Reusable core**: Auth framework usable in any Node.js app
✅ **Custom modules**: Community can build delegation modules
✅ **Framework agnostic**: Not locked to FastMCP
✅ **Production ready**: Enterprise-grade modularity

---

## Timeline Estimate

- **Phase 1** (Core): 4-6 hours
- **Phase 2** (Delegation): 3-4 hours
- **Phase 3** (MCP): 3-4 hours
- **Phase 4** (Config): 2-3 hours
- **Phase 5** (Examples): 2-3 hours
- **Phase 6** (Docs): 3-4 hours

**Total**: 17-24 hours of focused development

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Breaking changes for existing users | High | Backward compatibility adapter + migration guide |
| Increased complexity | Medium | Clear documentation, examples, JSDoc |
| Config migration issues | Medium | Automated migration utility with validation |
| Performance regression | Low | Benchmark before/after, optimize hot paths |
| Type system conflicts | Medium | Careful interface design, gradual typing |

---

## Success Criteria

✅ Core framework usable standalone (without MCP)
✅ SQL delegation works as pluggable module
✅ New custom delegation module can be added in < 50 LOC
✅ All existing tests pass
✅ Backward compatibility maintained
✅ Documentation complete and clear
✅ Build size < 10% increase
✅ Performance within 5% of current
