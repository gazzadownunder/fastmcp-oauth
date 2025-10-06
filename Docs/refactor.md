# Modular Architecture Refactoring Plan

## Executive Summary

Refactor the monolithic OAuth OBO server into a layered, modular architecture that separates core authentication from MCP integration and delegation modules. This enables the framework to be used standalone, with custom delegation strategies, and in non-MCP contexts, **while implementing defense-in-depth security and enhanced LLM-friendly error handling**.

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
6. **Defense-in-Depth**: Implement two-tier authorization (Visibility/Execution)

### Architectural Rule (Critical)

**One-Way Dependency Flow:** Core → Delegation → MCP.

Files in `src/core/` **MUST NOT** import anything from `src/delegation/` or `src/mcp/`. This prevents circular dependencies and maintains clean layer separation. Enforce with linting rules.

### Target File Structure
```
src/
├── core/                     # 🆕 Core Authentication Framework (standalone)
│   ├── jwt-validator.ts      # JWT validation only
│   ├── role-mapper.ts        # Role mapping logic (never throws)
│   ├── authentication-service.ts  # Main auth API
│   ├── session-manager.ts    # Session lifecycle & migration
│   ├── audit-service.ts      # Centralized logging (Null Object Pattern)
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
│   ├── authorization.ts      # Role/permission helpers (two-tier)
│   ├── server.ts             # FastMCP server orchestration
│   ├── types.ts              # MCP-specific types (LLM/Tool interfaces)
│   ├── tools/                # MCP Tools (refactored with factories)
│   │   ├── health-check.ts
│   │   ├── user-info.ts
│   │   └── index.ts          # (audit-log removed - security decision)
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

### Phase 0: Pre-Migration Discovery (New)

**Purpose**: Verify critical assumptions and prepare runtime validation before implementation.

#### 0.1 Verify FastMCP Contextual Access API
**Task**: Verify the existence and signature of the fastmcp **Contextual Access (CA)** method.

- **Method**: Examine fastmcp source code or documentation for `canAccess`, `accessCheck`, or similar property on `addTool()`
- **Expected API**: Tool registration should support visibility control based on session/context
- **Fallback**: If CA API is missing, revert to **execution-only security** (no visibility filtering)
- **Deliverable**: Document the exact CA API signature or confirm fallback approach

#### 0.2 Define Core Context Schema & Validation
**Task**: Define CoreContext structure and implement runtime validation.

```typescript
// ARCHITECTURAL CORRECTION: CoreContext belongs in Core layer (not MCP)
// Reason: Prevents circular dependency (Core must not import from MCP)

// src/core/types.ts
export interface CoreContext {
  authService: AuthenticationService;
  auditService: AuditService;
  delegationRegistry: DelegationRegistry; // Forward reference OK (type-only)
  configManager: ConfigManager;
}

// src/core/validators.ts
import { CoreContext } from './types.js'; // Import from Core, not MCP

export class CoreContextValidator {
  static validate(context: CoreContext): void {
    if (!context.authService) {
      throw new Error('CoreContext missing required field: authService');
    }
    if (!context.auditService) {
      throw new Error('CoreContext missing required field: auditService');
    }
    if (!context.delegationRegistry) {
      throw new Error('CoreContext missing required field: delegationRegistry');
    }
    if (!context.configManager) {
      throw new Error('CoreContext missing required field: configManager');
    }
  }
}
```

- **Test**: Create validation tests that verify runtime checks
- **Integration**: MCPOAuthServer calls `CoreContextValidator.validate()` before tool registration
- **Architectural Note**: CoreContext is defined in Core layer (not MCP) to maintain one-way dependency flow

---

### Phase 1: Core Authentication Framework (Standalone)

#### 1.1 Create Core Types (`src/core/types.ts`)
```typescript
// Role constants (Enhancement v0.2)
export const UNASSIGNED_ROLE = 'unassigned';
export const ROLE_ADMIN = 'admin';
export const ROLE_USER = 'user';
export const ROLE_GUEST = 'guest';

export interface AuthConfig {
  trustedIDPs: IDPConfig[];
  rateLimiting?: RateLimitConfig;
  audit?: AuditConfig;
}

export interface UserSession {
  _version: number; // MANDATORY (GAP #6): Schema version for backward-compatible migrations
  userId: string;
  username: string;
  legacyUsername?: string;
  role: string; // Can be UNASSIGNED_ROLE if mapping fails
  customRoles?: string[];
  permissions: string[]; // CRITICAL: UNASSIGNED_ROLE must have permissions: []
  scopes?: string[];
  claims?: Record<string, unknown>;
  rejected?: boolean; // MANDATORY (GAP #1): Set if session was rejected (for runtime checks)
}

// Enhancement v0.2: UNASSIGNED_ROLE Policy
// When role === UNASSIGNED_ROLE, permissions MUST be [] (empty array) to explicitly deny all access

export interface AuthenticationResult {
  session: UserSession;
  rejected: boolean; // True if role === UNASSIGNED_ROLE
  rejectionReason?: string; // Reason for rejection (e.g., role mapping failure)
  auditEntry: AuditEntry;
}

export interface RoleMapperResult {
  primaryRole: string; // Will be UNASSIGNED_ROLE on failure
  customRoles: string[];
  mappingFailed: boolean; // True if mapping encountered an error
  failureReason?: string; // Error details if mapping failed
}

export interface RoleMapper {
  // Enhancement v0.2: NEVER throws - always returns result
  determineRoles(roles: string[], config?: any): RoleMapperResult;
}

// MANDATORY (GAP #3): AuditEntry with source tracking
export interface AuditEntry {
  timestamp: Date;
  source: string; // MANDATORY: Origin of audit entry (e.g., 'auth:mapper', 'delegation:sql')
  userId?: string;
  action: string;
  success: boolean;
  reason?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

// MANDATORY (GAP #Architecture): CoreContext for dependency injection
// NOTE: Defined in Core layer (not MCP) to prevent circular dependencies
// One-Way Flow: Core → Delegation → MCP (Core must NOT import from MCP)
export interface CoreContext {
  authService: AuthenticationService;
  auditService: AuditService;
  delegationRegistry: DelegationRegistry; // Forward reference OK (type-only, no import)
  configManager: ConfigManager;
}
```

**Critical Policy**: The `UNASSIGNED_ROLE` constant represents a failed role mapping. Sessions with this role:
- Have `permissions: []` (empty array)
- Are marked as `rejected: true` in `AuthenticationResult`
- Are blocked before any tool execution
- **MUST be enforced with runtime assertion** (see SessionManager below)

#### 1.2 Extract JWT Validator (`src/core/jwt-validator.ts`)
- Move from `src/middleware/jwt-validator.ts`
- Remove role mapping logic (move to role-mapper.ts)
- Focus only on JWT validation and claim extraction
- Returns raw JWT payload + mapped claims

#### 1.3 Create Audit Service (Enhancement v0.2)
**File**: `src/core/audit-service.ts`

```typescript
export interface AuditServiceConfig {
  enabled: boolean;
  logAllAttempts?: boolean;
  retentionDays?: number;
  storage?: AuditStorage;
}

export interface AuditStorage {
  log(entry: AuditEntry): Promise<void> | void;
  // NOTE: NO query methods - write-only to prevent O(n) performance issues
}

// Null Object Pattern implementation
export class AuditService {
  private enabled: boolean;
  private storage: AuditStorage;
  private onOverflow?: (entries: AuditEntry[]) => void; // MANDATORY (GAP #7)

  // Enhancement v0.2: Optional config (defaults to disabled)
  // MANDATORY (GAP #7): Accepts onOverflow callback
  constructor(config?: AuditServiceConfig & { onOverflow?: (entries: AuditEntry[]) => void }) {
    this.enabled = config?.enabled ?? false;
    this.storage = config?.storage ?? new InMemoryAuditStorage(config?.onOverflow);
    this.onOverflow = config?.onOverflow;
  }

  // No-op if disabled (Null Object Pattern)
  async log(entry: AuditEntry): Promise<void> {
    if (!this.enabled) return;
    await this.storage.log(entry);
  }

  // NO query methods exposed - prevents O(n) operations
  // Querying must be backed by indexed persistence layer
}

// Default in-memory storage with limit and overflow handling
class InMemoryAuditStorage implements AuditStorage {
  private entries: AuditEntry[] = [];
  private readonly maxEntries = 10000;
  private onOverflow?: (entries: AuditEntry[]) => void;

  // MANDATORY (GAP #7): Accept onOverflow callback
  constructor(onOverflow?: (entries: AuditEntry[]) => void) {
    this.onOverflow = onOverflow;
  }

  log(entry: AuditEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      // MANDATORY (GAP #7): Call onOverflow before discarding
      if (this.onOverflow) {
        this.onOverflow([...this.entries]); // Pass copy of all entries
      }
      this.entries.shift(); // Remove oldest
    }
  }
}
```

**Critical Design Decisions**:
- **Null Object Pattern**: Works without configuration (no crashes)
- **Write-Only API**: No query methods to prevent O(n) performance degradation
- **In-memory limit**: 10,000 entries maximum
- **Persistence**: Any querying must use indexed backend (database, etc.)

#### 1.4 Create Role Mapper with Failure Policy (Enhancement v0.2)
**File**: `src/core/role-mapper.ts`

```typescript
export class RoleMapper {
  constructor(private config: RoleMappingConfig) {}

  // Enhancement v0.2: CRITICAL - NEVER throws exceptions
  determineRoles(roles: string[], customConfig?: any): RoleMapperResult {
    try {
      // Priority-based role assignment: admin > user > custom > guest
      const primaryRole = this.determinePrimaryRole(roles);
      const customRoles = this.determineCustomRoles(roles);

      return {
        primaryRole,
        customRoles,
        mappingFailed: false
      };
    } catch (error) {
      // Enhancement v0.2: CRITICAL - catch ALL errors, return UNASSIGNED
      return {
        primaryRole: UNASSIGNED_ROLE,
        customRoles: [],
        mappingFailed: true,
        failureReason: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private determinePrimaryRole(roles: string[]): string {
    // Check priority order
    if (roles.some(r => this.config.adminRoles?.includes(r))) return ROLE_ADMIN;
    if (roles.some(r => this.config.userRoles?.includes(r))) return ROLE_USER;
    if (roles.some(r => this.config.guestRoles?.includes(r))) return ROLE_GUEST;

    // Enhancement v0.2: No match = UNASSIGNED, not error
    return UNASSIGNED_ROLE;
  }

  private determineCustomRoles(roles: string[]): string[] {
    // Extract custom roles based on config patterns
    return roles.filter(r =>
      this.config.customRolePatterns?.some(p => r.match(p))
    );
  }
}
```

**Critical Requirements**:
- **NEVER throws** - all errors caught and converted to `UNASSIGNED_ROLE`
- Priority-based role assignment
- Support custom roles
- Returns failure metadata for auditing

#### 1.5 Create Session Manager with Migration Support (Enhancement v0.2)
**File**: `src/core/session-manager.ts`

**SECURITY PRINCIPLE**: Zero-Default Permissions Policy

> **Framework MUST NOT assign permissions by default. All permissions MUST be explicitly configured by framework users.**

```typescript
export interface PermissionConfig {
  adminPermissions?: string[];
  userPermissions?: string[];
  guestPermissions?: string[];
  customPermissions?: Record<string, string[]>;
}

export class SessionManager {
  private readonly SESSION_VERSION = 1; // Current schema version
  private config: PermissionConfig;

  // SECURITY: Constructor accepts optional config, defaults to EMPTY permissions
  constructor(config?: PermissionConfig) {
    // CRITICAL: No default permissions - users MUST explicitly configure
    this.config = {
      adminPermissions: config?.adminPermissions || [],  // ✅ Empty by default
      userPermissions: config?.userPermissions || [],    // ✅ Empty by default
      guestPermissions: config?.guestPermissions || [],  // ✅ Empty by default
      customPermissions: config?.customPermissions || {},
    };
  }

  createSession(jwtPayload: JWTPayload, roleResult: RoleMapperResult): UserSession {
    // Get permissions from config (returns [] if not configured)
    const permissions = this.getPermissions(roleResult.primaryRole);

    // MANDATORY (GAP #2): Runtime assertion for UNASSIGNED_ROLE
    if (roleResult.primaryRole === UNASSIGNED_ROLE && permissions.length > 0) {
      throw new Error('CRITICAL: UNASSIGNED_ROLE must have empty permissions array');
    }

    const session: UserSession = {
      _version: this.SESSION_VERSION, // MANDATORY (GAP #6)
      userId: jwtPayload.sub,
      username: jwtPayload.username,
      legacyUsername: jwtPayload.legacy_sam_account,
      role: roleResult.primaryRole,
      customRoles: roleResult.customRoles,
      permissions,
      scopes: jwtPayload.scopes,
      claims: jwtPayload,
      rejected: roleResult.primaryRole === UNASSIGNED_ROLE // MANDATORY (GAP #1)
    };

    return session;
  }

  validateSession(session: UserSession): boolean {
    // Reject UNASSIGNED sessions
    return session.role !== UNASSIGNED_ROLE;
  }

  refreshSession(session: UserSession): UserSession {
    // Refresh logic
  }

  // Enhancement v0.2: NEW - Support migration for existing serialized sessions
  // MANDATORY (GAP #6): Version-based migration
  migrateSession(rawSession: any): UserSession {
    const currentVersion = this.SESSION_VERSION;
    const sessionVersion = rawSession._version || 0;

    // Apply migrations based on version
    if (sessionVersion < 1) {
      // Migration to v1: Add _version, rejected fields
      rawSession._version = 1;
      if (rawSession.role === UNASSIGNED_ROLE && !('rejected' in rawSession)) {
        rawSession.rejected = true;
      }
      if (rawSession.role === UNASSIGNED_ROLE && !rawSession.permissions) {
        rawSession.permissions = [];
      }
    }

    // Future migrations would go here
    // if (sessionVersion < 2) { ... }

    return rawSession as UserSession;
  }

  // SECURITY: Map roles to permissions from CONFIG (not hardcoded)
  private getPermissions(role: string): string[] {
    // Standard roles - use configured permissions
    if (role === ROLE_ADMIN) {
      return this.config.adminPermissions || [];
    }
    if (role === ROLE_USER) {
      return this.config.userPermissions || [];
    }
    if (role === ROLE_GUEST) {
      return this.config.guestPermissions || [];
    }

    // UNASSIGNED_ROLE - always empty
    if (role === UNASSIGNED_ROLE) {
      return [];
    }

    // Custom roles - look up in customPermissions map
    return this.config.customPermissions?.[role] || [];
  }
}
```

**Critical Security Features**:
- **Zero-Default Policy**: Framework assigns NO permissions unless explicitly configured
- **Configuration Required**: Users must provide PermissionConfig to grant any permissions
- **Fail-Safe Design**: Missing config = empty permissions = tools not visible/executable
- **Explicit Consent**: Users must consciously grant each permission in configuration

#### 1.6 Create Authentication Service with Rejection Policy (Enhancement v0.2)
**File**: `src/core/authentication-service.ts`

```typescript
export class AuthenticationService {
  private jwtValidator: JWTValidator;
  private roleMapper: RoleMapper;
  private sessionManager: SessionManager;
  private auditService: AuditService;

  // Enhancement v0.2: Accepts optional AuditService (Null Object Pattern)
  constructor(config: AuthConfig, auditService?: AuditService) {
    this.jwtValidator = new JWTValidator(config);
    this.roleMapper = new RoleMapper(config.roleMappings);
    this.sessionManager = new SessionManager();
    this.auditService = auditService ?? new AuditService(); // Null Object Pattern
  }

  async authenticate(token: string): Promise<AuthenticationResult> {
    try {
      // Step 1: Validate JWT (may throw on invalid token)
      const jwtPayload = await this.jwtValidator.validateJWT(token);

      // Step 2: Map roles (Enhancement v0.2: never throws, returns result)
      const roleResult = this.roleMapper.determineRoles(
        jwtPayload.roles || [],
        this.config.roleMappings
      );

      // Step 3: Create session
      const session = this.sessionManager.createSession(jwtPayload, roleResult);

      // Step 4: Enhancement v0.2 - Check if role is UNASSIGNED
      const rejected = session.role === UNASSIGNED_ROLE;
      const rejectionReason = rejected
        ? (roleResult.failureReason || 'No matching roles found')
        : undefined;

      // Step 5: Enhancement v0.2 - Log to AuditService
      // MANDATORY (GAP #3): Include source field
      const auditEntry: AuditEntry = {
        timestamp: new Date(),
        source: 'auth:service', // MANDATORY
        userId: session.userId,
        action: 'authenticate',
        success: !rejected,
        reason: rejectionReason,
        metadata: { role: session.role, mappingFailed: roleResult.mappingFailed }
      };
      await this.auditService.log(auditEntry);

      // Step 6: Return result (doesn't throw on UNASSIGNED)
      return {
        session,
        rejected,
        rejectionReason,
        auditEntry
      };
    } catch (error) {
      // Only JWT validation errors throw
      // MANDATORY (GAP #3): Include source field
      const auditEntry: AuditEntry = {
        timestamp: new Date(),
        source: 'auth:service',
        action: 'authenticate',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
      await this.auditService.log(auditEntry);
      throw error;
    }
  }

  async validateSession(sessionId: string): Promise<UserSession | null> {
    // Session validation logic
  }

  getConfig(): AuthConfig {
    return this.config;
  }
}
```

**Critical Flow**:
1. JWT validation (may throw)
2. Role mapping (never throws, returns UNASSIGNED on failure)
3. Session creation
4. Check for UNASSIGNED_ROLE
5. Mark as rejected if UNASSIGNED
6. Log to audit
7. Return result (rejection is NOT an exception)

#### 1.7 Create Core Validators (MANDATORY - GAP #Architecture)
**File**: `src/core/validators.ts`

**Purpose**: Centralize validation logic in Core layer to maintain one-way dependency flow.

**Architectural Note**: CoreContextValidator and CoreContext are BOTH in Core layer to prevent circular dependencies. Core must never import from MCP or Delegation layers.

```typescript
import { CoreContext } from './types.js'; // CRITICAL: Import from Core, NOT from MCP

// MANDATORY: CoreContextValidator in Core layer enforces architectural integrity
// One-Way Dependency Flow: Core → Delegation → MCP
export class CoreContextValidator {
  static validate(context: CoreContext): void {
    if (!context.authService) {
      throw new Error('CoreContext missing required field: authService');
    }
    if (!context.auditService) {
      throw new Error('CoreContext missing required field: auditService');
    }
    if (!context.delegationRegistry) {
      throw new Error('CoreContext missing required field: delegationRegistry');
    }
    if (!context.configManager) {
      throw new Error('CoreContext missing required field: configManager');
    }
  }
}
```

**Why CoreContext is in Core layer**:
- CoreContext references Core services (AuthenticationService, AuditService)
- CoreContextValidator validates CoreContext
- If CoreContext was in MCP layer, Core would need to import from MCP (circular dependency)
- DelegationRegistry reference is a forward type reference only (no runtime import needed)

#### 1.8 Create Core Public API (`src/core/index.ts`)
```typescript
export { AuthenticationService } from './authentication-service.js';
export { SessionManager } from './session-manager.js';
export { JWTValidator } from './jwt-validator.js';
export { RoleMapper } from './role-mapper.js';
export { AuditService } from './audit-service.js'; // Enhancement v0.2
export { CoreContextValidator } from './validators.js'; // MANDATORY (GAP #Architecture)
export * from './types.js';

// Enhancement v0.2: Export role constants
export { UNASSIGNED_ROLE, ROLE_ADMIN, ROLE_USER, ROLE_GUEST } from './types.js';

// MANDATORY (GAP #Architecture): Export CoreContext interface
export type { CoreContext } from './types.js';
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
  auditTrail: AuditEntry; // Enhancement v0.2: Module creates, Registry logs
}
```

#### 2.2 Create Delegation Registry with AuditService (Enhancement v0.2)
**File**: `src/delegation/registry.ts`

```typescript
export class DelegationRegistry {
  private modules: Map<string, DelegationModule> = new Map();
  private auditService?: AuditService; // Enhancement v0.2

  // Enhancement v0.2: Constructor accepts optional AuditService
  constructor(auditService?: AuditService) {
    this.auditService = auditService;
  }

  register(module: DelegationModule): void {
    this.modules.set(module.name, module);

    // Enhancement v0.2: Log registration event
    // MANDATORY (GAP #3): Include source field
    this.auditService?.log({
      timestamp: new Date(),
      source: `delegation:registry`,
      action: 'delegation_module_registered',
      success: true,
      metadata: { moduleName: module.name, moduleType: module.type }
    });
  }

  unregister(name: string): void {
    this.modules.delete(name);
  }

  get(name: string): DelegationModule | undefined {
    return this.modules.get(name);
  }

  list(): DelegationModule[] {
    return Array.from(this.modules.values());
  }

  // Enhancement v0.2: NEW - Centralized delegation method with audit logging
  async delegate<T>(
    moduleName: string,
    session: UserSession,
    action: string,
    params: any
  ): Promise<DelegationResult<T>> {
    const module = this.get(moduleName);

    if (!module) {
      // MANDATORY (GAP #3): Include source field
      const auditEntry: AuditEntry = {
        timestamp: new Date(),
        source: `delegation:registry`,
        userId: session.userId,
        action: 'delegation_failed',
        success: false,
        reason: `Module not found: ${moduleName}`
      };
      await this.auditService?.log(auditEntry);

      return {
        success: false,
        error: `Module not found: ${moduleName}`,
        auditTrail: auditEntry
      };
    }

    // Call module delegation
    const result = await module.delegate<T>(session, action, params);

    // MANDATORY (GAP #3): Ensure module's auditTrail has source field
    if (!result.auditTrail.source) {
      result.auditTrail.source = `delegation:${module.name}`;
    }

    // Enhancement v0.2: Log the auditTrail returned by module
    await this.auditService?.log(result.auditTrail);

    return result;
  }

  async initializeAll(configs: Record<string, any>): Promise<void> {
    // Initialize all registered modules
  }

  async destroyAll(): Promise<void> {
    // Clean up all modules
  }
}
```

**Critical Design**: Modules create `auditTrail`, Registry logs it. This separation of concerns ensures modules don't need direct AuditService injection.

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

#### 3.1 Create MCP Types (Enhancement v0.2 - NEW)
**File**: `src/mcp/types.ts`

**Purpose**: Standardize LLM error responses, tool registration, and MCP-specific types.

**ARCHITECTURAL NOTE**: CoreContext is imported from Core layer (not defined here) to maintain one-way dependency flow.

```typescript
// MANDATORY (GAP #Architecture): Import CoreContext from Core layer
import { CoreContext } from '../core/index.js';

// Enhancement v0.2: Standardize LLM Error Response
export interface LLMFailureResponse {
  status: 'failure';
  code: 'INSUFFICIENT_PERMISSIONS' | 'UNAUTHENTICATED' | 'DELEGATION_ERROR' | 'INVALID_INPUT' | string;
  message: string; // Human-readable refusal message for LLM
}

// MANDATORY (GAP #5): Standardize LLM Success Response
export interface LLMSuccessResponse {
  status: 'success';
  data: any; // Tool-specific data
}

// MANDATORY (GAP #12): Type-safe MCP Context
export interface MCPContext {
  session: UserSession;
  // Add other MCP-specific context fields as needed
}

// MANDATORY (GAP #12): Generic Tool Handler type
export type ToolHandler<P = any, R = any> = (params: P, context: MCPContext) => Promise<R>;

// Enhancement v0.2: Standardize Tool Registration with Contextual Access
export interface ToolRegistration {
  name: string;
  schema: z.ZodObject<any>;
  handler: ToolHandler; // MANDATORY (GAP #12): Use typed handler
  // NEW: Contextual Access (CA) method for dynamic visibility
  accessCheck?: (context: FastMCPRequestContext) => boolean;
}

// Enhancement v0.2: Tool Factory uses CoreContext from Core layer
export type ToolFactory = (context: CoreContext) => ToolRegistration;

export interface MCPOAuthConfig {
  auth: CoreAuthConfig;
  delegation?: DelegationConfig;
  mcp?: MCPConfig;
}

export interface MCPStartOptions {
  transport?: 'stdio' | 'sse' | 'http-stream';
  port?: number;
}
```

**Critical Features**:
- `LLMFailureResponse` & `LLMSuccessResponse`: Ensures consistent response format for conversational clients (MANDATORY GAP #5)
- `MCPContext` & `ToolHandler<P,R>`: Type-safe tool handler signatures (MANDATORY GAP #12)
- `ToolRegistration`: Formalizes tool factory return type with `accessCheck` for Contextual Access
- `ToolFactory`: Uses CoreContext imported from Core layer

**Architectural Integrity**:
- CoreContext is **imported** from `../core/index.js` (not defined in MCP layer)
- This maintains one-way dependency flow: Core → Delegation → MCP
- CoreContextValidator remains in `src/core/validators.ts`

#### 3.2 Create MCP Middleware with Rejection Handling (Enhancement v0.2)
**File**: `src/mcp/middleware.ts`

```typescript
import { AuthenticationService } from '../core/index.js';
import { FastMCPRequestContext } from 'fastmcp';

export class MCPAuthMiddleware {
  constructor(private authService: AuthenticationService);

  async authenticate(request: any): Promise<FastMCPRequestContext> {
    const token = this.extractToken(request);

    // Enhancement v0.2: Check for rejected sessions
    const authResult = await this.authService.authenticate(token);

    if (authResult.rejected) {
      throw createSecurityError(
        'INSUFFICIENT_PERMISSIONS',
        authResult.rejectionReason || 'Session rejected due to role mapping failure',
        403
      );
    }

    // MANDATORY (GAP #1): Runtime rejection check
    // Check session.rejected field on every request to close timing gap
    if (authResult.session.rejected) {
      throw createSecurityError(
        'INSUFFICIENT_PERMISSIONS',
        'Session has been rejected',
        403
      );
    }

    return {
      session: authResult.session,
      // ... other context
    };
  }

  private extractToken(request: any): string {
    // Extract Bearer token from Authorization header
  }
}
```

**Critical Changes**:
- Checks `authResult.rejected` and throws 403 if session has UNASSIGNED_ROLE
- **MANDATORY (GAP #1)**: Also checks `session.rejected` field on every request to prevent timing attacks where role is revoked after session creation

#### 3.3 Create Authorization Helpers with Two-Tier System (Enhancement v0.2)
**File**: `src/mcp/authorization.ts`

**Purpose**: Implement defense-in-depth with soft (visibility) and hard (execution) authorization checks.

```typescript
export class Authorization {
  // Enhancement v0.2: SOFT CHECKS - For visibility (Contextual Access)
  // Returns boolean, does NOT throw

  static hasRole(session: UserSession | null, role: string): boolean {
    if (!session) return false;
    return session.role === role || session.customRoles?.includes(role) || false;
  }

  static hasAnyRole(session: UserSession | null, roles: string[]): boolean {
    if (!session) return false;
    return roles.some(r => this.hasRole(session, r));
  }

  static hasCustomRole(session: UserSession | null, role: string): boolean {
    if (!session) return false;
    return session.customRoles?.includes(role) ?? false;
  }

  // Enhancement v0.2: HARD CHECKS - For execution enforcement
  // Throws on failure

  static requireRole(session: UserSession, role: string): void {
    if (!this.hasRole(session, role)) {
      throw createSecurityError('INSUFFICIENT_PERMISSIONS',
        `Required role: ${role}`, 403);
    }
  }

  static requireAnyRole(session: UserSession, roles: string[]): void {
    if (!this.hasAnyRole(session, roles)) {
      throw createSecurityError('INSUFFICIENT_PERMISSIONS',
        `Required one of: ${roles.join(', ')}`, 403);
    }
  }

  static requirePermission(session: UserSession, permission: string): void {
    if (!session.permissions?.includes(permission)) {
      throw createSecurityError('INSUFFICIENT_PERMISSIONS',
        `Required permission: ${permission}`, 403);
    }
  }
}
```

**Two-Tier Authorization** (Defense-in-Depth):
1. **Visibility Tier** (Contextual Access): Uses `hasRole()` family - returns boolean, no throw
2. **Execution Tier** (Handler): Uses `requireRole()` family - throws on failure

This prevents unauthorized users from seeing tools they can't use, while also enforcing permissions at execution time.

#### 3.4 Refactor Tools with CoreContext and LLM Support (Enhancement v0.2)

**Planned Tools**: health-check, user-info ~~, audit-log~~

**Security Note**: The `audit-log` tool has been **removed from scope** based on security analysis:
- **Segregation of Administrative Duties**: Audit review should be performed through dedicated admin interfaces (SIEM, database query tools, admin dashboards) rather than exposed via MCP client
- **Low Value-to-Risk Ratio**: Exposing audit data creates reconnaissance vectors with limited operational value
- **Write-Only API Design**: AuditService intentionally implements write-only API to prevent O(n) performance issues
- **Alternative Access**: Administrators access audit data directly through persistent storage backend with proper indexing and access controls

**File**: `src/mcp/tools/health-check.ts`

**Purpose**: Tools use CoreContext pattern and provide LLM-friendly error responses.

```typescript
import { Authorization } from '../authorization.js';
import { CoreContext, LLMFailureResponse, ToolRegistration } from '../types.js';
import { ROLE_ADMIN, ROLE_USER } from '../../core/index.js';

// Enhancement v0.2: Tool Factory accepts CoreContext
export function createHealthCheckTool(context: CoreContext): ToolRegistration {
  return {
    name: 'health-check',
    description: 'Check delegation service health',
    schema: z.object({
      service: z.enum(['sql', 'kerberos', 'all']).default('all')
    }),

    // Enhancement v0.2: Contextual Access (CA) - SOFT CHECK for visibility
    accessCheck: (mcpContext: FastMCPRequestContext) => {
      const session = mcpContext.session as UserSession | null;
      return Authorization.hasAnyRole(session, [ROLE_ADMIN, ROLE_USER]);
    },

    // Enhancement v0.2: Handler with LLM-friendly error handling
    // MANDATORY (GAP #12): Type-safe handler signature
    handler: async (params: any, mcpContext: MCPContext) => {
      try {
        const session = mcpContext.session;
        if (!session) {
          throw createSecurityError('UNAUTHENTICATED', 'No session', 401);
        }

        // HARD CHECK - Throws if unauthorized
        Authorization.requireAnyRole(session, [ROLE_ADMIN, ROLE_USER]);

        // Use context.registry instead of direct parameter
        if (params.service === 'all') {
          const modules = context.delegationRegistry.list();
          const results = await Promise.all(
            modules.map(m => m.healthCheck())
          );

          // MANDATORY (GAP #5): Return standardized success response
          const response: LLMSuccessResponse = {
            status: 'success',
            data: { healthy: results.every(r => r), modules }
          };
          return JSON.stringify(response);
        }

        const module = context.delegationRegistry.get(params.service);
        if (!module) {
          throw new Error(`Module not found: ${params.service}`);
        }

        // MANDATORY (GAP #5): Return standardized success response
        const response: LLMSuccessResponse = {
          status: 'success',
          data: { healthy: await module.healthCheck() }
        };
        return JSON.stringify(response);

      } catch (error) {
        // MANDATORY (GAP #4): Convert ALL OAuthSecurityError types to LLM-friendly JSON
        if (error instanceof OAuthSecurityError) {
          const llmResponse: LLMFailureResponse = {
            status: 'failure',
            code: error.code,
            message: this.getLLMFriendlyMessage(error.code, error.message)
          };
          return JSON.stringify(llmResponse);
        }
        throw error; // Re-throw non-security errors
      }
    },

    // Helper method for user-friendly messages
    getLLMFriendlyMessage(code: string, technical: string): string {
      const messages: Record<string, string> = {
        'INSUFFICIENT_PERMISSIONS': 'You do not have permission to check service health. This requires admin or user role.',
        'UNAUTHENTICATED': 'You must be authenticated to check service health.',
        'DELEGATION_ERROR': 'An error occurred while checking service health.',
        'INVALID_INPUT': 'The service name you provided is invalid.'
      };
      return messages[code] || `An error occurred: ${technical}`;
    }
  };
}
```

**Key Enhancements**:
1. **CoreContext Parameter**: Tool factory receives all dependencies via single object
2. **Contextual Access**: `accessCheck` function controls tool visibility using `hasAnyRole()` (soft check)
3. **MANDATORY (GAP #4)**: ALL OAuthSecurityError types converted to LLM-friendly JSON (not just INSUFFICIENT_PERMISSIONS)
4. **MANDATORY (GAP #5)**: Standardized LLMSuccessResponse and LLMFailureResponse formats
5. **MANDATORY (GAP #12)**: Type-safe MCPContext parameter
6. **Two-Tier Security**: Visibility check (CA) + execution check (handler)

#### 3.5 Create MCP Server Orchestration with CoreContext (Enhancement v0.2)
**File**: `src/mcp/server.ts`

**Purpose**: Orchestrate all components with CoreContext pattern and config subsetting.

```typescript
import { FastMCP } from 'fastmcp';
import { AuthenticationService, AuditService, CoreContext, CoreContextValidator } from '../core/index.js';
import { DelegationRegistry } from '../delegation/index.js';
import { ConfigManager } from '../config/index.js';
import { MCPAuthMiddleware } from './middleware.js';
import * as toolFactories from './tools/index.js';

export class MCPOAuthServer {
  private server: FastMCP;
  private configManager: ConfigManager; // Enhancement v0.2
  private auditService: AuditService; // Enhancement v0.2
  private authService: AuthenticationService;
  private delegationRegistry: DelegationRegistry;
  private middleware: MCPAuthMiddleware;
  private coreContext: CoreContext; // Enhancement v0.2

  // Enhancement v0.2: Constructor accepts configPath, orchestrates initialization
  constructor(configPath: string) {
    // Step 1: Load and validate config
    this.configManager = new ConfigManager();
    this.configManager.loadConfig(configPath);

    // Step 2: Enhancement v0.2 - Initialize AuditService (Null Object Pattern)
    const auditConfig = this.configManager.getAuthConfig().audit;
    this.auditService = new AuditService(auditConfig);

    // Step 3: Enhancement v0.2 - Extract auth config subset
    const authConfig = this.configManager.getAuthConfig();
    this.authService = new AuthenticationService(authConfig, this.auditService);

    // Step 4: Enhancement v0.2 - Initialize registry with AuditService
    this.delegationRegistry = new DelegationRegistry(this.auditService);

    // Step 5: Initialize middleware
    this.middleware = new MCPAuthMiddleware(this.authService);

    // Step 6: Enhancement v0.2 - Build CoreContext
    // MANDATORY (GAP #11): Use satisfies operator for type enforcement
    this.coreContext = {
      authService: this.authService,
      auditService: this.auditService,
      delegationRegistry: this.delegationRegistry,
      configManager: this.configManager
    } satisfies CoreContext;

    // Step 7: REMOVED - Validation moved to start() method (GAP #8)

    // Step 8: Initialize FastMCP
    const mcpConfig = this.configManager.getMCPConfig();
    this.server = new FastMCP({
      name: mcpConfig?.serverName || 'OAuth OBO Server',
      version: mcpConfig?.version || '1.0.0'
    });
  }

  // Enhancement v0.2: Config subsetting for modules
  async registerDelegationModule(module: DelegationModule, config?: any): Promise<void> {
    // If no config provided, get it from ConfigManager
    const moduleConfig = config ?? this.configManager.getDelegationModuleConfig(module.name);

    if (!moduleConfig) {
      throw new Error(`No configuration found for module: ${module.name}`);
    }

    await module.initialize(moduleConfig);
    this.delegationRegistry.register(module);
  }

  async start(options: MCPStartOptions): Promise<void> {
    // MANDATORY (GAP #8): Validate CoreContext AFTER all services initialized
    CoreContextValidator.validate(this.coreContext);

    // Setup authentication
    this.server.setAuthHandler(async (request) => {
      return this.middleware.authenticate(request);
    });

    // Enhancement v0.2: Register tools using CoreContext and Contextual Access
    const factories: ToolFactory[] = [
      toolFactories.createHealthCheckTool,
      toolFactories.createUserInfoTool
      // NOTE: audit-log tool removed (security decision - use dedicated admin tools)
      // Add more tool factories here
    ];

    for (const factory of factories) {
      // Each factory receives the entire CoreContext
      const tool = factory(this.coreContext);

      // Enhancement v0.2: Register tool with Contextual Access
      this.server.addTool({
        ...tool,
        // Contextual Access integration with fastmcp
        // NOTE: This depends on Phase 0 verification of FastMCP CA API
        contextualAccess: tool.accessCheck
      });
    }

    // Start server
    await this.server.start(options);
  }

  async stop(): Promise<void> {
    await this.delegationRegistry.destroyAll();
    await this.server.stop();
  }
}
```

**Critical Features**:
1. **Config Orchestrator**: ConfigManager extracts and distributes config subsets
2. **CoreContext Pattern**: All tool factories receive single dependency container
3. **MANDATORY (GAP #11)**: CoreContext built with `satisfies` operator for compile-time type safety
4. **MANDATORY (GAP #8)**: Runtime validation moved to `start()` method (after initialization complete)
5. **Contextual Access**: Tools registered with `accessCheck` for visibility control

**Import Note**: CoreContext and CoreContextValidator imported from `'../core/index.js'` (both defined in Core layer to maintain architectural integrity and prevent circular dependencies)

#### 3.6 Create MCP Public API (`src/mcp/index.ts`)
```typescript
export { MCPOAuthServer } from './server.js';
export { MCPAuthMiddleware } from './middleware.js';
export { Authorization } from './authorization.js';
export * from './types.js';
export type {
  ToolFactory,
  LLMFailureResponse,
  LLMSuccessResponse, // MANDATORY (GAP #5)
  ToolRegistration,
  MCPContext, // MANDATORY (GAP #12)
  ToolHandler // MANDATORY (GAP #12)
} from './types.js'; // Enhancement v0.2

// NOTE: CoreContext is exported from src/core/index.ts (not re-exported here)
// This enforces the architectural rule: Core → Delegation → MCP
```

---

### Phase 4: Configuration Schema Updates

#### 4.1 Create Modular Config Schemas (`src/config/schemas/`)

**Core Auth Schema** (`src/config/schemas/core.ts`):
```typescript
// SECURITY: Permission configuration with zero-default policy
export const PermissionConfigSchema = z.object({
  adminPermissions: z
    .array(z.string())
    .min(0)
    .describe('Permissions granted to admin role'),
  userPermissions: z
    .array(z.string())
    .min(0)
    .describe('Permissions granted to user role'),
  guestPermissions: z
    .array(z.string())
    .min(0)
    .describe('Permissions granted to guest role'),
  customPermissions: z
    .record(z.array(z.string()))
    .optional()
    .default({})
    .describe('Custom role to permissions mapping'),
});

export const CoreAuthConfigSchema = z.object({
  trustedIDPs: z.array(IDPConfigSchema).min(1),
  rateLimiting: RateLimitConfigSchema.optional(),
  audit: AuditConfigSchema.optional(),
  permissions: PermissionConfigSchema.describe(
    'Role to permission mappings (REQUIRED - no framework defaults)'
  )
});
```

**SECURITY NOTE**: The `permissions` field is **REQUIRED** in the schema. Framework does NOT provide default permissions - users MUST explicitly configure all permissions in their JSON config file. This prevents unintended privilege escalation and ensures explicit consent for all access grants.

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

#### 4.2 Update Config Manager with Module Config Extraction (Enhancement v0.2)
**File**: `src/config/manager.ts`

**Purpose**: Implement config orchestrator pattern - extract and distribute config subsets.

```typescript
export class ConfigManager {
  private config: UnifiedConfig;

  loadConfig(path: string): void {
    const raw = JSON.parse(fs.readFileSync(path, 'utf-8'));
    this.config = UnifiedConfigSchema.parse(raw);
  }

  // Enhancement v0.2: Extract specific config subsets (Orchestrator pattern)
  getAuthConfig(): CoreAuthConfig {
    return this.config.auth;
  }

  getDelegationConfig(): Record<string, any> | undefined {
    return this.config.delegation?.modules;
  }

  getMCPConfig(): MCPConfig | undefined {
    return this.config.mcp;
  }

  // Enhancement v0.2: NEW - Get config for specific delegation module
  getDelegationModuleConfig(moduleName: string): any | undefined {
    if (!this.config.delegation) return undefined;

    // Try module-specific config first
    if (this.config.delegation.modules?.[moduleName]) {
      return this.config.delegation.modules[moduleName];
    }

    // Fallback to named config (e.g., sql, kerberos)
    return (this.config.delegation as any)[moduleName];
  }
}
```

**Orchestrator Pattern**: MCPOAuthServer uses ConfigManager to extract and distribute config subsets to each component, preventing config duplication and ensuring single source of truth.

#### 4.3 Create Config Migration Utility
```typescript
// src/config/migrate.ts
export function migrateOldConfig(oldConfig: OAuthOBOConfig): UnifiedConfig {
  return {
    auth: {
      trustedIDPs: oldConfig.trustedIDPs,
      rateLimiting: oldConfig.rateLimiting,
      audit: oldConfig.audit,
      permissions: oldConfig.permissions // Migrate permissions if present
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

#### 4.4 Example Configuration with Permissions (SECURITY)

**Example: Unified Configuration** (`config/unified-config.json`):
```json
{
  "auth": {
    "trustedIDPs": [
      {
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
        "roleMappings": {
          "admin": ["admin", "administrator"],
          "user": ["user", "member"],
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
      "enabled": true,
      "logAllAttempts": true,
      "retentionDays": 90
    },
    "permissions": {
      "adminPermissions": [
        "read",
        "write",
        "delete",
        "admin",
        "sql:query",
        "sql:procedure",
        "sql:function"
      ],
      "userPermissions": [
        "read",
        "write",
        "sql:query"
      ],
      "guestPermissions": [
        "read"
      ],
      "customPermissions": {
        "write": ["sql:query", "sql:procedure"],
        "read": ["sql:query"]
      }
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
    "port": 3000
  }
}
```

**CRITICAL SECURITY NOTES**:
1. **Permissions MUST be explicitly configured** - No framework defaults
2. **Missing permissions = Empty array** - Tools will not be visible or executable
3. **Principle of Least Privilege** - Grant only the minimum permissions required
4. **SQL-specific permissions** - Use namespaced permissions like `sql:query`, `sql:procedure`, `sql:function`
5. **Custom role permissions** - Map custom roles (e.g., `write`, `read`) to specific permissions
6. **Audit all permission grants** - Review and document why each permission is needed

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

## Risks & Mitigations (Enhancement v0.2 - Updated)

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **Circular dependency** (Core ↔ MCP) | High | **NEW POLICY:** Enforce **One-Way Dependency Flow: Core → Delegation → MCP**. Use linting rules (`eslint-plugin-import`) to enforce no imports from `delegation/` or `mcp/` within `core/`. Files in `src/core/` **MUST NOT** import from `src/delegation/` or `src/mcp/`. |
| **Rollback failure** (Mid-refactor instability) | Critical | **NEW POLICY:** Implement **Feature Branch Isolation** strategy. Development occurs on dedicated branch (`feature/v2-refactor`). Rollback = delete branch + deploy last stable release tag. No changes to `main` until fully tested. |
| **FastMCP CA API Missing** (Design blocker) | High | **NEW TASK (Phase 0):** Verify API signature in discovery phase. If missing, revert visibility filtering to **Execution-Level Security Only** (Authorization.requireRole). Document fallback approach. |
| **Audit Service performance** (O(n) queries) | Medium | **NEW POLICY:** AuditService exposes **write-only API** (`log()` only). No `query()` methods to prevent O(n) operations. Querying must use indexed persistence layer (database). In-memory storage limited to 10,000 entries. |
| **CoreContext misconfiguration** (Runtime errors) | Medium | **NEW TASK (Phase 0):** Implement `CoreContextValidator.validate()` method. Performs strict runtime checks on all required dependencies before server starts. Throws clear error if any field missing. |
| **Existing session migration** (Production deployment risk) | High | **NEW METHOD:** Implement `SessionManager.migrateSession(rawSession)` to backfill missing fields for old serialized sessions. Prevents crashes during production deployment. |
| **Type inconsistency** (LLM/Tool interfaces) | Medium | **NEW INTERFACES:** Formalize `LLMFailureResponse` and `ToolRegistration` interfaces in `src/mcp/types.ts`. Enforce consistency at module boundary. |
| Breaking changes for existing users | High | Backward compatibility adapter + migration guide |
| Increased complexity | Medium | Clear documentation, examples, JSDoc |
| Config migration issues | Medium | Automated migration utility with validation |
| Performance regression | Low | Benchmark before/after, optimize hot paths |

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
