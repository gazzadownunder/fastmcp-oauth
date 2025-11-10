# Tool Prefix Configuration Option - Impact Assessment

## Executive Summary

**Proposal:** Add `toolPrefix` as a configuration file option under **all delegation modules** to simplify multi-instance deployments.

**Scope:** All delegation module types:
- SQL modules (PostgreSQL, MSSQL)
- REST API modules
- Kerberos modules (file browsing)
- Future custom delegation modules

**Current Approach:** Tool prefixes are specified in code via factory functions like `createSQLToolsForModule({ toolPrefix, moduleName })` and `createRESTAPIToolsForModule({ toolPrefix, moduleName })`.

**Proposed Approach:** Tool prefixes are specified in `config.json` per delegation module instance.

**Recommendation:** ✅ **Implement with Option C (Global Default + Per-Module Override)**

**Impact:** Medium complexity, high developer experience benefit, maintains backward compatibility, applies to **all delegation modules**.

---

## Current Implementation Analysis

### How Tool Prefixes Work Today

**Code-Based Configuration** works the same way for all delegation module types:

**Example 1: SQL Modules** ([examples/multi-database-example.ts:83-91](examples/multi-database-example.ts#L83-L91)):

```typescript
// Developer must calculate tool prefix in code
const toolPrefix = moduleName === 'postgresql' ? 'sql' : moduleName.replace('postgresql', 'sql');

const sqlTools = createSQLToolsForModule({
  toolPrefix,           // ← Specified in code
  moduleName,
  descriptionSuffix,
});

server.registerTools(sqlTools.map(factory => factory(coreContext)));
```

**Example 2: REST API Modules** ([src/mcp/tools/rest-api-tools-factory.ts:223-236](src/mcp/tools/rest-api-tools-factory.ts#L223-L236)):

```typescript
// Same pattern - tool prefix specified in code
const api1Tools = createRESTAPIToolsForModule({
  toolPrefix: 'api1',   // ← Specified in code
  moduleName: 'rest-api1',
  descriptionSuffix: '(Internal API)'
});

const api2Tools = createRESTAPIToolsForModule({
  toolPrefix: 'api2',   // ← Specified in code
  moduleName: 'rest-api2',
  descriptionSuffix: '(Partner API)'
});

server.registerTools(api1Tools.map(factory => factory(coreContext)));
server.registerTools(api2Tools.map(factory => factory(coreContext)));
```

**Problems with Current Approach:**

1. **Boilerplate code required** - Every multi-instance deployment (databases, APIs, etc.) must write tool registration logic
2. **Prefix logic duplicated** - String transformation repeated in every project
3. **Code changes for prefix updates** - Changing tool names requires code modification and rebuild
4. **Inconsistent naming** - No enforced naming convention across projects
5. **Applies to ALL module types** - SQL, REST API, Kerberos, and future modules all have this problem

---

## Proposed Configuration Schema

### Option A: Global Delegation Prefix (NOT RECOMMENDED)

```json
{
  "delegation": {
    "toolPrefix": "myprefix",  // ← Global prefix affects ALL modules
    "modules": {
      "postgresql1": { ... },
      "postgresql2": { ... }
    }
  }
}
```

**Result:** `myprefix-delegate`, `myprefix-schema`, `myprefix-table-details` (only one set of tools)

**Problems:**
- ❌ Defeats the purpose of multi-instance support
- ❌ All modules share same tool names (collisions!)
- ❌ Cannot distinguish between module instances

---

### Option B: Per-Module Tool Prefix (RECOMMENDED FOR SIMPLICITY)

```json
{
  "delegation": {
    "modules": {
      "postgresql1": {
        "toolPrefix": "hr-sql",  // ← Per-module prefix
        "host": "db1.company.com",
        "database": "hr_database",
        // ... other PostgreSQL config
      },
      "postgresql2": {
        "toolPrefix": "sales-sql",  // ← Different prefix for second database
        "host": "db2.company.com",
        "database": "sales_database",
        // ... other PostgreSQL config
      },
      "mssql1": {
        "toolPrefix": "legacy",  // ← Custom prefix for legacy MSSQL
        "server": "legacy.company.com",
        "database": "old_system"
      },
      "rest-api1": {
        "toolPrefix": "internal-api",  // ← REST API module
        "baseUrl": "https://internal-api.company.com",
        "tokenExchange": { ... }
      },
      "rest-api2": {
        "toolPrefix": "partner-api",  // ← Another REST API module
        "baseUrl": "https://partner-api.example.com",
        "tokenExchange": { ... }
      },
      "kerberos1": {
        "toolPrefix": "file-browse",  // ← Kerberos file browsing
        "realm": "COMPANY.COM",
        "allowedSpns": ["cifs/fileserver.company.com"]
      }
    }
  }
}
```

**Result:**
- HR Database: `hr-sql-delegate`, `hr-sql-schema`, `hr-sql-table-details`
- Sales Database: `sales-sql-delegate`, `sales-sql-schema`, `sales-sql-table-details`
- Legacy MSSQL: `legacy-delegate`, `legacy-schema`, `legacy-table-details`
- Internal API: `internal-api-delegate`, `internal-api-health`
- Partner API: `partner-api-delegate`, `partner-api-health`
- File Browse: `file-browse-list`, `file-browse-read`, `file-browse-info`

**Benefits:**
- ✅ Each module has unique, configurable tool names
- ✅ Clear separation between module instances
- ✅ Flexible naming (can use business terms like "hr", "sales", "legacy", "internal-api")
- ✅ Configuration-only changes (no code rebuild needed)
- ✅ Works for all delegation module types

---

### Option C: Global Default + Per-Module Override (MOST FLEXIBLE)

```json
{
  "delegation": {
    "defaultToolPrefix": "sql",  // ← Global default
    "modules": {
      "postgresql1": {
        // No toolPrefix → uses "sql" (default)
        "host": "db1.company.com",
        "database": "main_database"
      },
      "postgresql2": {
        "toolPrefix": "hr",  // ← Override default
        "host": "db2.company.com",
        "database": "hr_database"
      },
      "postgresql3": {
        "toolPrefix": "sales",  // ← Override default
        "host": "db3.company.com",
        "database": "sales_database"
      },
      "rest-api1": {
        "toolPrefix": "api",  // ← Override for REST API
        "baseUrl": "https://api.company.com"
      }
    }
  }
}
```

**Result:**
- Database 1: `sql-delegate`, `sql-schema`, `sql-table-details` (default)
- Database 2: `hr-delegate`, `hr-schema`, `hr-table-details` (override)
- Database 3: `sales-delegate`, `sales-schema`, `sales-table-details` (override)
- API: `api-delegate`, `api-health` (override)

**Benefits:**
- ✅ Backward compatible (default "sql" matches current behavior)
- ✅ Single module case doesn't require toolPrefix config
- ✅ Multi-module deployments can override per module
- ✅ Clearest intent (explicit is better than implicit)
- ✅ Works for all module types

---

## Schema Changes Required

### 1. Update DelegationConfigSchema

**File:** [src/config/schemas/delegation.ts:202-212](src/config/schemas/delegation.ts#L202-L212)

**Proposed Schema (Option C - Global Default + Per-Module Override):**
```typescript
export const DelegationConfigSchema = z.object({
  defaultToolPrefix: z
    .string()
    .min(1)
    .max(20)
    .regex(/^[a-z][a-z0-9-]*$/, 'Must start with lowercase letter, contain only lowercase letters, numbers, and hyphens')
    .optional()
    .default('sql')
    .describe('Default tool prefix for all modules (default: "sql"). Modules can override this.'),

  modules: z
    .record(z.any())
    .optional()
    .describe('Delegation module configurations keyed by module name'),

  // ... rest of schema
});
```

### 2. Add toolPrefix to All Module Schemas

**Same change needed for ALL delegation module types:**

1. **`PostgreSQLConfigSchema`** - [delegation.ts:153-190](src/config/schemas/delegation.ts#L153-L190)
   - Tools: `{prefix}-delegate`, `{prefix}-schema`, `{prefix}-table-details`

2. **`SQLConfigSchema`** (MSSQL delegation) - [delegation.ts:99-119](src/config/schemas/delegation.ts#L99-L119)
   - Tools: `{prefix}-delegate`, `{prefix}-schema`, `{prefix}-table-details`

3. **`KerberosConfigSchema`** (Kerberos delegation) - [delegation.ts:130-142](src/config/schemas/delegation.ts#L130-L142)
   - Tools: `{prefix}-list`, `{prefix}-read`, `{prefix}-info` (file browsing)

4. **`RESTAPIConfigSchema`** (REST API delegation) - New schema needed
   - Tools: `{prefix}-delegate`, `{prefix}-health`

5. **Future custom delegation modules** - Any new module types added later
   - Each module type defines its own tool set with configurable prefix

**Universal Schema Pattern:**
```typescript
export const GenericDelegationModuleSchema = z.object({
  toolPrefix: z
    .string()
    .min(1)
    .max(20)
    .regex(/^[a-z][a-z0-9-]*$/, 'Must start with lowercase letter, contain only lowercase letters, numbers, and hyphens')
    .optional()
    .describe('Tool name prefix (e.g., "sql1", "hr", "api1"). Overrides delegation.defaultToolPrefix.'),

  // ... module-specific fields
});
```

**Example: PostgreSQLConfigSchema with toolPrefix:**
```typescript
export const PostgreSQLConfigSchema = z.object({
  toolPrefix: z
    .string()
    .min(1)
    .max(20)
    .regex(/^[a-z][a-z0-9-]*$/)
    .optional()
    .describe('Tool name prefix. Overrides delegation.defaultToolPrefix.'),

  host: z.string().min(1).describe('PostgreSQL hostname or IP'),
  port: z.number().int().min(1).max(65535).optional().default(5432),
  database: z.string().min(1).describe('Database name'),
  user: z.string().min(1).describe('Service account username'),
  password: z.string().min(1).describe('Service account password'),
  options: z.object({ ... }).optional(),
  pool: z.object({ ... }).optional(),
  tokenExchange: TokenExchangeConfigSchema.optional(),
});
```

---

## Code Impact Analysis

### 1. MCPOAuthServer.start() Method

**File:** [src/mcp/server.ts:376-567](src/mcp/server.ts#L376-L567)

**Current Logic (lines 424-440):**
```typescript
// 8. Register enabled tools
const enabledTools = mcpConfig?.enabledTools || {};
const enabledToolNames = Object.keys(enabledTools);
const hasCustomSqlTools = enabledToolNames.some(
  (name) => /^sql\d+-/.test(name) // Matches sql1-, sql2-, etc.
);

const toolFactories = getAllToolFactories({ excludeSqlTools: hasCustomSqlTools });
```

**Proposed Logic (Option C - All Module Types):**
```typescript
// 8. Register enabled tools
const enabledTools = mcpConfig?.enabledTools || {};

// 8a. Check if user is registering custom tools after start()
const enabledToolNames = Object.keys(enabledTools);
const hasCustomSqlTools = enabledToolNames.some(
  (name) => /^sql\d+-/.test(name) // Matches sql1-, sql2-, etc.
);

// 8b. Auto-register tools from delegation.modules if toolPrefix is configured
const delegationConfig = this.configManager.getDelegationConfig();
const autoRegisterTools: ToolRegistration[] = [];

if (delegationConfig?.modules) {
  for (const [moduleName, moduleConfig] of Object.entries(delegationConfig.modules)) {
    if (!moduleConfig.toolPrefix) {
      continue; // Skip modules without toolPrefix (manual registration required)
    }

    // Detect module type and create appropriate tools
    let tools: ToolFactory[] = [];

    if (moduleName.startsWith('postgresql') || moduleName.startsWith('mssql')) {
      // SQL module (PostgreSQL or MSSQL)
      console.log(`[MCP OAuth Server] Auto-registering SQL tools for ${moduleName} with prefix '${moduleConfig.toolPrefix}'`);
      tools = createSQLToolsForModule({
        toolPrefix: moduleConfig.toolPrefix,
        moduleName,
        descriptionSuffix: moduleConfig._comment || `(${moduleConfig.database})`,
      });
    } else if (moduleName.startsWith('rest-api')) {
      // REST API module
      console.log(`[MCP OAuth Server] Auto-registering REST API tools for ${moduleName} with prefix '${moduleConfig.toolPrefix}'`);
      tools = createRESTAPIToolsForModule({
        toolPrefix: moduleConfig.toolPrefix,
        moduleName,
        descriptionSuffix: moduleConfig._comment || `(${moduleConfig.baseUrl})`,
      });
    } else if (moduleName.startsWith('kerberos')) {
      // Kerberos module (file browsing)
      console.log(`[MCP OAuth Server] Auto-registering Kerberos tools for ${moduleName} with prefix '${moduleConfig.toolPrefix}'`);
      // Note: Kerberos file browsing tools use prefix for list/read/info tools
      // Implementation depends on kerberos-file-browse.ts refactoring
      console.warn(`[MCP OAuth Server] Kerberos tool auto-registration not yet implemented`);
    } else {
      console.warn(`[MCP OAuth Server] Unknown module type: ${moduleName} - skipping auto-registration`);
    }

    if (tools.length > 0) {
      autoRegisterTools.push(...tools.map(factory => factory(this.coreContext!)));
    }
  }
}

// 8c. Get default tool factories (exclude SQL if custom tools will be registered)
const hasAutoRegisteredSqlTools = autoRegisterTools.some(t =>
  t.name.endsWith('-delegate') || t.name.endsWith('-schema') || t.name.endsWith('-table-details')
);

const toolFactories = getAllToolFactories({
  excludeSqlTools: hasCustomSqlTools || hasAutoRegisteredSqlTools
});

// 8d. Register auto-generated tools first
for (const tool of autoRegisterTools) {
  this.registerTool(tool);
}
```

**Backward Compatibility:**
- If `toolPrefix` is NOT configured → behavior unchanged (existing code continues to work)
- If `toolPrefix` IS configured → automatic tool registration happens
- Existing manual registration still works (for advanced use cases)

### 2. Example Code Simplification

**Before (100+ lines with boilerplate for multiple module types):**
```typescript
// examples/multi-module-example.ts
async function main() {
  const server = new MCPOAuthServer(CONFIG_PATH);
  await server.start({ transport: 'httpStream', port: SERVER_PORT });

  const coreContext = server.getCoreContext();
  const delegationConfig = coreContext.configManager.getDelegationConfig();

  // Register PostgreSQL modules
  const postgresModules = Object.keys(delegationConfig?.modules || {}).filter(
    key => key.startsWith('postgresql')
  );

  for (const moduleName of postgresModules) {
    const moduleConfig = delegationConfig.modules[moduleName];
    const pgModule = new PostgreSQLDelegationModule(moduleName);
    await pgModule.initialize(moduleConfig);
    await server.registerDelegationModule(moduleName, pgModule);

    const toolPrefix = moduleName === 'postgresql' ? 'sql' : moduleName.replace('postgresql', 'sql');
    const sqlTools = createSQLToolsForModule({
      toolPrefix,
      moduleName,
      descriptionSuffix: moduleConfig._comment || '',
    });
    server.registerTools(sqlTools.map(factory => factory(coreContext)));
  }

  // Register REST API modules
  const apiModules = Object.keys(delegationConfig?.modules || {}).filter(
    key => key.startsWith('rest-api')
  );

  for (const moduleName of apiModules) {
    const moduleConfig = delegationConfig.modules[moduleName];
    const apiModule = new RESTAPIDelegationModule(moduleName);
    await apiModule.initialize(moduleConfig);
    await server.registerDelegationModule(moduleName, apiModule);

    const toolPrefix = moduleName.replace('rest-api', 'api');
    const apiTools = createRESTAPIToolsForModule({
      toolPrefix,
      moduleName,
      descriptionSuffix: moduleConfig._comment || '',
    });
    server.registerTools(apiTools.map(factory => factory(coreContext)));
  }

  // Register Kerberos modules
  const kerberosModules = Object.keys(delegationConfig?.modules || {}).filter(
    key => key.startsWith('kerberos')
  );

  for (const moduleName of kerberosModules) {
    const moduleConfig = delegationConfig.modules[moduleName];
    const kerberosModule = new KerberosDelegationModule(moduleName);
    await kerberosModule.initialize(moduleConfig);
    await server.registerDelegationModule(moduleName, kerberosModule);

    const toolPrefix = 'file-browse';
    const kerberosTools = createKerberosFileToolsForModule({
      toolPrefix,
      moduleName,
      descriptionSuffix: moduleConfig._comment || '',
    });
    server.registerTools(kerberosTools.map(factory => factory(coreContext)));
  }

  await new Promise(() => {});
}
```

**After (15 lines, 85% reduction):**
```typescript
// examples/multi-module-example.ts
async function main() {
  // Tool prefixes configured in config.json for ALL module types!
  // No manual tool registration needed!
  const server = new MCPOAuthServer(CONFIG_PATH);
  await server.start({
    transport: 'httpStream',
    port: SERVER_PORT
  });

  console.log('Server ready with auto-registered tools from all delegation modules!');

  await new Promise(() => {});
}
```

**Configuration File ([test-harness/config/multi-module-config.json](test-harness/config/multi-module-config.json)):**
```json
{
  "delegation": {
    "modules": {
      "postgresql1": {
        "toolPrefix": "hr-sql",
        "host": "db1.company.com",
        "database": "hr_database",
        "_comment": "HR Database"
      },
      "postgresql2": {
        "toolPrefix": "sales-sql",
        "host": "db2.company.com",
        "database": "sales_database",
        "_comment": "Sales Database"
      },
      "rest-api1": {
        "toolPrefix": "internal-api",
        "baseUrl": "https://internal-api.company.com",
        "_comment": "Internal API"
      },
      "rest-api2": {
        "toolPrefix": "partner-api",
        "baseUrl": "https://partner-api.example.com",
        "_comment": "Partner API"
      },
      "kerberos1": {
        "toolPrefix": "file-browse",
        "realm": "COMPANY.COM",
        "allowedSpns": ["cifs/fileserver.company.com"],
        "_comment": "File Server Access"
      }
    }
  }
}
```

**Result:** All delegation module types use the same configuration pattern!

---

## Backward Compatibility Strategy

### Phase 1: Add Configuration Support (Non-Breaking)

**Release:** v2.2.0

**Changes:**
1. Add `toolPrefix` field to **ALL delegation module schemas** (optional):
   - `PostgreSQLConfigSchema`
   - `SQLConfigSchema` (MSSQL)
   - `RESTAPIConfigSchema` (new or existing)
   - `KerberosConfigSchema`
2. Add `defaultToolPrefix` field to `DelegationConfigSchema` (optional, default: "sql")
3. Add auto-registration logic to `MCPOAuthServer.start()` with module type detection
4. Update tool factory exports to support all module types
5. Update documentation with new configuration examples

**Backward Compatibility:**
- ✅ Existing configurations without `toolPrefix` continue to work (manual registration required)
- ✅ Existing code using `createSQLToolsForModule()` / `createRESTAPIToolsForModule()` works unchanged
- ✅ No breaking changes to public APIs

**Migration Path:**
- Optional: Users can migrate to config-based approach when convenient
- No forced migration required

### Phase 2: Deprecate Code-Based Prefixes (Future)

**Release:** v3.0.0 (breaking change)

**Changes:**
1. Mark manual tool factory calls as deprecated for all module types
2. Add deprecation warnings to documentation
3. Remove from examples (show config-based approach only)

**Migration Guide:**
```typescript
// ❌ Deprecated (still works, but discouraged)
const sqlTools = createSQLToolsForModule({ toolPrefix: 'sql1', moduleName: 'postgresql1' });
const apiTools = createRESTAPIToolsForModule({ toolPrefix: 'api1', moduleName: 'rest-api1' });
server.registerTools(sqlTools.map(factory => factory(coreContext)));
server.registerTools(apiTools.map(factory => factory(coreContext)));

// ✅ Recommended (config-based)
// Add to config.json:
// "delegation": {
//   "modules": {
//     "postgresql1": { "toolPrefix": "sql1", ... },
//     "rest-api1": { "toolPrefix": "api1", ... }
//   }
// }
// Framework auto-registers tools on server.start()
```

---

## Benefits Analysis

### Developer Experience Benefits

| Metric | Current Approach | Config-Based Approach | Improvement |
|--------|------------------|----------------------|-------------|
| Lines of code (multi-module setup) | 100+ lines | 15 lines | **85% reduction** |
| Configuration changes | Code change + rebuild | Config file edit only | **Zero code changes** |
| Deployment complexity | High (code + config) | Low (config only) | **Simpler deployments** |
| Learning curve | Must understand factories + registry | Declarative configuration | **Lower barrier to entry** |
| Error prone | String manipulation bugs | Schema validated | **Fewer runtime errors** |
| Consistency | No enforcement | Regex validation | **Enforced naming convention** |
| Module type support | Manual per type | Universal pattern | **All modules work the same** |

### Production Operations Benefits

**Configuration-Only Updates:**
- Change tool prefix without rebuilding application
- Hot-reload configuration (if framework supports it)
- A/B testing with different tool naming schemes

**Audit Trail:**
- Tool naming strategy visible in config file (version controlled)
- No need to inspect code to understand tool names
- Clear mapping between module names and tool names

**Multi-Environment Support:**
```json
// config/dev.json
{ "delegation": { "modules": { "postgresql1": { "toolPrefix": "dev-sql" } } } }

// config/staging.json
{ "delegation": { "modules": { "postgresql1": { "toolPrefix": "staging-sql" } } } }

// config/prod.json
{ "delegation": { "modules": { "postgresql1": { "toolPrefix": "sql" } } } }
```

---

## Drawbacks and Risks

### Drawbacks

1. **Configuration complexity increases** - More fields in config schema (applies to all module types)
2. **Dual configuration locations** - Tool naming split between code and config (during migration period)
3. **Magic behavior** - Auto-registration may surprise developers used to explicit registration

### Mitigation Strategies

**For Configuration Complexity:**
- Provide clear documentation with examples for each module type
- Use schema validation to catch errors early
- Provide default values (`defaultToolPrefix: "sql"`)

**For Dual Configuration:**
- Clear migration guide showing all module types
- Deprecation warnings for code-based approach
- Examples show config-based approach only (after v2.2.0)

**For Magic Behavior:**
- Detailed logging showing auto-registered tools per module type
- Explicit opt-out mechanism (don't configure `toolPrefix` → manual registration required)
- Documentation explains both approaches for all module types

---

## Implementation Plan

### Phase 1: Schema Changes (2-3 days)

**Tasks:**
1. Update `DelegationConfigSchema` to add `defaultToolPrefix` field (optional, default: "sql")
2. Update **ALL delegation module schemas** to add `toolPrefix` field (optional):
   - `PostgreSQLConfigSchema` (line 153)
   - `SQLConfigSchema` (MSSQL) (line 99)
   - `KerberosConfigSchema` (line 130)
   - Create `RESTAPIConfigSchema` if not already exists
3. Add regex validation for tool prefix format (`^[a-z][a-z0-9-]*$`)
4. Write unit tests for schema validation (all module types)

**Files to modify:**
- [src/config/schemas/delegation.ts](src/config/schemas/delegation.ts)
- [src/config/schemas/kerberos.ts](src/config/schemas/kerberos.ts) (if separate file)
- Add schema for REST API modules if needed
- Add tests: `tests/unit/config/schemas/delegation.test.ts`

### Phase 2: Auto-Registration Logic (3-4 days)

**Tasks:**
1. Update `MCPOAuthServer.start()` to detect configured `toolPrefix` fields
2. Add module type detection logic:
   - PostgreSQL/MSSQL → SQL tools
   - REST API → API tools
   - Kerberos → File browsing tools
   - Future modules → Extensible pattern
3. Add auto-registration logic for **all module types** with configured prefixes
4. Import necessary tool factory functions (`createRESTAPIToolsForModule`, etc.)
5. Add logging to show auto-registered tools per module type
6. Handle edge cases:
   - Module with `toolPrefix` but no delegation module registered
   - Duplicate tool names (should error with clear message)
   - Mix of auto-registered and manually registered tools
   - Unknown module types (warn and skip)

**Files to modify:**
- [src/mcp/server.ts](src/mcp/server.ts) (lines 424-520)
- [src/mcp/tools/index.ts](src/mcp/tools/index.ts) (ensure all factories exported)
- Add tests: `tests/unit/mcp/server-auto-registration.test.ts`
- Add tests for each module type: `tests/unit/mcp/server-auto-registration-{sql,api,kerberos}.test.ts`

### Phase 3: Documentation Updates (1-2 days)

**Tasks:**
1. Update [Docs/CONFIGURATION.md](Docs/CONFIGURATION.md) with new fields for all module types
2. Update [Docs/MULTI-DATABASE-SETUP.md](Docs/MULTI-DATABASE-SETUP.md) with config-based examples
3. Update [Docs/TOOL-FACTORIES.md](Docs/TOOL-FACTORIES.md) to show both approaches for all module types
4. Update [README.md](README.md) quick start guide
5. Add migration guide for existing deployments (all module types)
6. Update [examples/multi-database-example.ts](examples/multi-database-example.ts) to show simplified version
7. Create new [examples/multi-module-example.ts](examples/multi-module-example.ts) showing SQL + API + Kerberos

**New sections needed:**
- "Tool Prefix Configuration" in CONFIGURATION.md (all module types)
- "Simplified Multi-Module Setup (Config-Based)" in MULTI-DATABASE-SETUP.md (rename to MULTI-MODULE-SETUP.md)
- "Migration from Code-Based to Config-Based Prefixes" in EXTENDING.md (all module types)

### Phase 4: Testing (2-3 days)

**Test Cases (Per Module Type):**

**SQL Modules (PostgreSQL, MSSQL):**
1. Single PostgreSQL module with `toolPrefix` → 3 tools registered (`{prefix}-delegate`, `-schema`, `-table-details`)
2. Multiple PostgreSQL modules with different `toolPrefix` values → unique tool names
3. MSSQL module with `toolPrefix` → 3 tools registered (same pattern)

**REST API Modules:**
4. Single REST API module with `toolPrefix` → 2 tools registered (`{prefix}-delegate`, `-health`)
5. Multiple REST API modules with different `toolPrefix` values → unique tool names

**Kerberos Modules:**
6. Kerberos module with `toolPrefix` → 3 tools registered (`{prefix}-list`, `-read`, `-info`)

**Cross-Module Tests:**
7. Mixed modules (SQL + API + Kerberos) all with different `toolPrefix` → all tools registered
8. Module with `toolPrefix` + manual registration → error or warning
9. Module without `toolPrefix` → no auto-registration (backward compat)
10. Invalid `toolPrefix` format → schema validation error
11. Duplicate `toolPrefix` across different module types → runtime error with clear message
12. Mix of auto-registered and manually registered tools → both work
13. Hot-reload configuration with changed `toolPrefix` → tools updated

**Test Files:**
- Unit tests: `tests/unit/mcp/server-auto-registration.test.ts`
- Integration tests:
  - `tests/integration/multi-database-config-based.test.ts`
  - `tests/integration/multi-api-config-based.test.ts`
  - `tests/integration/mixed-modules-config-based.test.ts`

### Phase 5: Release (1 day)

**Release Checklist:**
1. Update CHANGELOG.md with new feature (all module types)
2. Bump version to v2.2.0
3. Create release notes with migration guide (all module types)
4. Update npm package documentation
5. Announce in GitHub discussions/Discord

---

## Recommendation

✅ **Implement Option C: Global Default + Per-Module Override**

**Reasoning:**

1. **Best backward compatibility** - Default `sql` prefix matches current behavior
2. **Maximum flexibility** - Single module doesn't need config, multi-module can customize
3. **Clearest intent** - Explicit is better than implicit
4. **Future-proof** - Supports both simple and complex deployment scenarios
5. **Universal pattern** - Works for all delegation module types (SQL, API, Kerberos, future)

**Priority:** **HIGH** - This change significantly improves developer experience and reduces boilerplate code for a common use case (multi-module deployments).

**Estimated Effort:** 10-14 days (including testing and documentation for all module types)

**Risk Level:** **LOW** - Non-breaking change, optional configuration, clear migration path

---

## Example Configuration Files

### Single Database (No Change Required)

```json
{
  "delegation": {
    "modules": {
      "postgresql": {
        "host": "db.company.com",
        "database": "main",
        "user": "service_account",
        "password": "secret"
      }
    }
  }
}
```

**Result:** Default `sql-delegate`, `sql-schema`, `sql-table-details` tools (backward compatible)

### Multi-Module (All Delegation Types)

```json
{
  "delegation": {
    "defaultToolPrefix": "sql",
    "modules": {
      "postgresql1": {
        "toolPrefix": "hr-sql",
        "host": "hr-db.company.com",
        "database": "hr_system",
        "_comment": "HR Database"
      },
      "postgresql2": {
        "toolPrefix": "sales-sql",
        "host": "sales-db.company.com",
        "database": "sales_system",
        "_comment": "Sales Database"
      },
      "mssql1": {
        "toolPrefix": "legacy",
        "server": "legacy.company.com",
        "database": "old_erp",
        "_comment": "Legacy ERP System"
      },
      "rest-api1": {
        "toolPrefix": "internal-api",
        "baseUrl": "https://internal-api.company.com",
        "tokenExchange": { "idpName": "requestor-jwt", "audience": "internal-api" },
        "_comment": "Internal REST API"
      },
      "rest-api2": {
        "toolPrefix": "partner-api",
        "baseUrl": "https://partner-api.example.com",
        "tokenExchange": { "idpName": "requestor-jwt", "audience": "partner-api" },
        "_comment": "Partner REST API"
      },
      "kerberos1": {
        "toolPrefix": "file-browse",
        "realm": "COMPANY.COM",
        "allowedSpns": ["cifs/fileserver.company.com"],
        "_comment": "File Server Access"
      }
    }
  }
}
```

**Result (All Tools Auto-Registered):**
- HR Database: `hr-sql-delegate`, `hr-sql-schema`, `hr-sql-table-details`
- Sales Database: `sales-sql-delegate`, `sales-sql-schema`, `sales-sql-table-details`
- Legacy MSSQL: `legacy-delegate`, `legacy-schema`, `legacy-table-details`
- Internal API: `internal-api-delegate`, `internal-api-health`
- Partner API: `partner-api-delegate`, `partner-api-health`
- File Server: `file-browse-list`, `file-browse-read`, `file-browse-info`

**Total Tools:** 18 tools from 6 delegation modules
**Code Required:** Just `await server.start()` - 100+ lines of boilerplate eliminated!

---

## Conclusion

Adding `toolPrefix` as a configuration option provides:

✅ **85% code reduction** for multi-module deployments (SQL + API + Kerberos)
✅ **Zero code changes** for tool name updates
✅ **Universal pattern** - Works for all delegation module types
✅ **Backward compatible** (optional configuration)
✅ **Better developer experience** (declarative over imperative)
✅ **Production-friendly** (config-only updates)
✅ **Clear migration path** (gradual adoption)
✅ **Extensible** - Future delegation modules automatically support tool prefixes

**Recommended Implementation:** Option C (Global Default + Per-Module Override)

**Module Types Supported:**
- SQL modules (PostgreSQL, MSSQL)
- REST API modules
- Kerberos modules (file browsing)
- Future custom delegation modules

**Next Steps:**
1. Approve this impact assessment
2. Create implementation tasks for all module types
3. Begin Phase 1 (Schema Changes for all delegation modules)
