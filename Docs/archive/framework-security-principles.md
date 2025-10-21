# Framework Security Principles

## Zero-Default Security Policy

The `fastmcp-oauth-obo` framework follows a **zero-default security policy**:

> **Framework code MUST NOT assign permissions by default. All permissions MUST be explicitly configured by the framework user.**

This principle prevents:
- Unintended privilege escalation
- Security misconfigurations
- "Secure by default" false assumptions
- Framework users deploying with unknown permission grants

## Permission Configuration

### Framework Code (src/core/session-manager.ts)

```typescript
constructor(config?: PermissionConfig) {
  // SECURITY: No default permissions - users MUST explicitly configure
  // Framework will not assign ANY permissions unless explicitly configured
  this.config = {
    adminPermissions: config?.adminPermissions || [],
    userPermissions: config?.userPermissions || [],
    guestPermissions: config?.guestPermissions || [],
    customPermissions: config?.customPermissions || {},
  };
}
```

**Key points:**
- ❌ **NO hardcoded defaults** like `['read', 'write', 'admin']`
- ✅ **Empty arrays by default** `|| []`
- ⚠️ **Users MUST configure** permissions in their config file

### Configuration Schema (src/config/schemas/core.ts)

```typescript
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
  ),
});
```

**Key points:**
- ❌ **NO `.default()` for role permissions**
- ✅ **REQUIRED field** in CoreAuthConfigSchema
- ⚠️ **Config validation will fail** if permissions are omitted

### User Configuration (config/*.json)

Framework users MUST explicitly define all permissions:

```json
{
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
}
```

## What This Prevents

### ❌ Bad Example (Framework with defaults):
```typescript
// Framework code (WRONG - DO NOT DO THIS)
constructor(config?: PermissionConfig) {
  this.config = {
    adminPermissions: config?.adminPermissions || ['read', 'write', 'admin'], // ❌ DANGEROUS
    userPermissions: config?.userPermissions || ['read', 'write'],             // ❌ DANGEROUS
    guestPermissions: config?.guestPermissions || ['read'],                    // ❌ DANGEROUS
  };
}
```

**Problems:**
1. Users may not realize they have permissions enabled
2. Upgrades might introduce new default permissions unknowingly
3. Production deployments may grant unintended access
4. "Secure by default" creates false sense of security

### ✅ Good Example (Zero defaults):
```typescript
// Framework code (CORRECT)
constructor(config?: PermissionConfig) {
  // SECURITY: No default permissions - users MUST explicitly configure
  this.config = {
    adminPermissions: config?.adminPermissions || [],  // ✅ Empty by default
    userPermissions: config?.userPermissions || [],    // ✅ Empty by default
    guestPermissions: config?.guestPermissions || [],  // ✅ Empty by default
    customPermissions: config?.customPermissions || {},
  };
}
```

**Benefits:**
1. **Explicit consent** - Users must consciously grant permissions
2. **Configuration validation** - Schema requires permissions field
3. **Audit trail** - All permissions visible in config file
4. **Fail-safe** - Missing config = no permissions (tools not visible)

## Tool Visibility and Execution

The framework enforces **two-tier security**:

### Tier 1: Visibility (canAccess)
```typescript
canAccess: (mcpContext: MCPContext) => {
  if (!mcpContext.session || mcpContext.session.rejected) {
    return false; // Hide tool from unauthenticated users
  }

  // Only show if user has ANY sql permission
  return mcpContext.session.permissions.some(p => p.startsWith('sql:'));
}
```

### Tier 2: Execution (requirePermission)
```typescript
handler: async (params, mcpContext) => {
  // Require exact permission based on action
  const requiredPermission = `sql:${params.action}`; // 'sql:query', 'sql:procedure', etc.
  requirePermission(mcpContext, requiredPermission);

  // ... execute tool
}
```

**Result:**
- **No permissions = Tool invisible** (not in tool list)
- **Wrong permission = Tool visible but execution fails** (403 Forbidden)

## Framework Design Philosophy

### ❌ Anti-Pattern: "Secure by Default"
- Framework provides default permissions
- Users can "opt-out" of permissions
- Dangerous: Users may not know what defaults exist

### ✅ Best Practice: "Explicit Configuration Required"
- Framework provides **zero** default permissions
- Users **must opt-in** to every permission
- Safe: Users consciously grant each permission

## Migration Path

If you have existing code with hardcoded defaults, migrate like this:

**Before (v1.x - insecure):**
```typescript
// Framework provides defaults
const server = new MCPOAuthServer('./config.json');
// Permissions granted automatically: ['read', 'write', 'admin']
```

**After (v2.x - secure):**
```typescript
// Framework requires explicit config
const server = new MCPOAuthServer('./config.json');

// config.json MUST include:
{
  "permissions": {
    "adminPermissions": ["read", "write", "admin"],
    // ... all permissions explicitly listed
  }
}
```

## Documentation Requirements

When documenting the framework, always:

1. ✅ **Emphasize that permissions MUST be configured**
2. ✅ **Show example configurations with all permission fields**
3. ✅ **Explain security implications of each permission**
4. ❌ **Never suggest "just use defaults"**
5. ❌ **Never provide copy-paste configs with overly permissive settings**

## Summary

| Aspect | Framework Behavior | User Responsibility |
|--------|-------------------|---------------------|
| Default permissions | **None** (empty arrays) | **Must configure explicitly** |
| Schema validation | **Requires `permissions` field** | **Must provide valid config** |
| Tool visibility | **Hidden if no permissions** | **Grant specific permissions** |
| Tool execution | **Fails if wrong permission** | **Assign correct permissions** |
| Security posture | **Fail-safe (deny by default)** | **Opt-in (explicit grant)** |

**Core Principle:** The framework protects users from themselves by refusing to make security decisions on their behalf.
