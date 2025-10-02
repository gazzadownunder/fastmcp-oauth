# Configurable Role Mappings - Framework Flexibility

**Date:** 2025-10-02
**Status:** ✅ Fixed - Role determination is now fully configurable

## The Problem (Fixed)

**Previous flawed logic:**
```typescript
private determinePrimaryRole(roles: string[]): 'admin' | 'user' | 'guest' {
  if (roles.includes('admin') || roles.includes('administrator')) {
    return 'admin';
  }
  if (roles.includes('user') || roles.length > 0) {  // ❌ WRONG!
    return 'user';  // Any role = 'user' (too opinionated)
  }
  return 'guest';
}
```

**Issue:** If user has ANY role (even just `["offline_access"]`), they get `role: 'user'`. This is not appropriate for a framework.

## The Solution

**New configurable logic:**
```typescript
private determinePrimaryRole(roles: string[], roleMappings?: any): 'admin' | 'user' | 'guest' {
  // Use configured role mappings or defaults
  const adminRoles = roleMappings?.admin || ['admin', 'administrator'];
  const userRoles = roleMappings?.user || ['user'];
  const guestRoles = roleMappings?.guest || [];
  const defaultRole = roleMappings?.defaultRole || 'guest';

  // Check for admin roles (highest priority)
  if (roles.some(role => adminRoles.includes(role))) {
    return 'admin';
  }

  // Check for user roles (medium priority)
  if (roles.some(role => userRoles.includes(role))) {
    return 'user';
  }

  // Check for guest roles (low priority)
  if (roles.some(role => guestRoles.includes(role))) {
    return 'guest';
  }

  // No matching roles - use configured default
  return defaultRole;  // ✓ Defaults to 'guest' if no matches
}
```

## Configuration

Add `roleMappings` to your IDP configuration:

### Example Configuration

**[test-harness/config/keycloak-oauth-only.json](test-harness/config/keycloak-oauth-only.json#L16-21)**:
```json
{
  "trustedIDPs": [
    {
      "issuer": "http://localhost:8080/realms/mcp_security",
      "claimMappings": {
        "roles": "realm_access.roles"
      },
      "roleMappings": {
        "admin": ["admin", "administrator", "realm-admin"],
        "user": ["user", "authenticated"],
        "guest": ["guest", "anonymous"],
        "defaultRole": "guest"
      }
    }
  ]
}
```

### Configuration Options

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `admin` | `string[]` | `["admin", "administrator"]` | JWT roles that map to admin |
| `user` | `string[]` | `["user"]` | JWT roles that map to user |
| `guest` | `string[]` | `[]` | JWT roles that map to guest |
| `defaultRole` | `"admin"│"user"│"guest"` | `"guest"` | Role when no mappings match |

## How It Works

### Priority Order

1. **Check admin roles** - If ANY JWT role matches `admin` array → `'admin'`
2. **Check user roles** - If ANY JWT role matches `user` array → `'user'`
3. **Check guest roles** - If ANY JWT role matches `guest` array → `'guest'`
4. **Use default** - If no matches → use `defaultRole`

### Example Scenarios

#### Scenario 1: User with Admin Role

**JWT:**
```json
{
  "realm_access": {
    "roles": ["admin", "offline_access", "uma_authorization"]
  }
}
```

**Config:**
```json
{
  "roleMappings": {
    "admin": ["admin"],
    "user": ["user"],
    "defaultRole": "guest"
  }
}
```

**Result:** `role: 'admin'` ✓ (matches admin array)

#### Scenario 2: User with Keycloak Default Roles Only

**JWT:**
```json
{
  "realm_access": {
    "roles": ["default-roles-mcp_security", "offline_access"]
  }
}
```

**Config:**
```json
{
  "roleMappings": {
    "admin": ["admin"],
    "user": ["user"],
    "defaultRole": "guest"
  }
}
```

**Result:** `role: 'guest'` ✓ (no matches, uses defaultRole)

#### Scenario 3: Authenticated User

**JWT:**
```json
{
  "realm_access": {
    "roles": ["authenticated", "offline_access"]
  }
}
```

**Config:**
```json
{
  "roleMappings": {
    "admin": ["admin"],
    "user": ["user", "authenticated"],
    "defaultRole": "guest"
  }
}
```

**Result:** `role: 'user'` ✓ (matches user array)

## Use Cases

### Use Case 1: Keycloak with Realm Roles

```json
{
  "roleMappings": {
    "admin": ["admin", "administrator", "superuser"],
    "user": ["user", "member", "authenticated"],
    "guest": ["guest"],
    "defaultRole": "guest"
  }
}
```

### Use Case 2: Azure AD with Group-Based Roles

```json
{
  "claimMappings": {
    "roles": "groups"
  },
  "roleMappings": {
    "admin": ["cn=IT-Admins,ou=Groups,dc=company,dc=com"],
    "user": ["cn=Employees,ou=Groups,dc=company,dc=com"],
    "defaultRole": "guest"
  }
}
```

### Use Case 3: Okta with Custom Claims

```json
{
  "claimMappings": {
    "roles": "app_roles"
  },
  "roleMappings": {
    "admin": ["ADMIN", "SUPER_ADMIN"],
    "user": ["USER", "EMPLOYEE"],
    "guest": ["GUEST", "VISITOR"],
    "defaultRole": "guest"
  }
}
```

### Use Case 4: Strict Security (No Defaults)

```json
{
  "roleMappings": {
    "admin": ["admin"],
    "user": ["user"],
    "guest": ["guest"],
    "defaultRole": "guest"  // Any unknown role = guest
  }
}
```

### Use Case 5: Permissive (All Authenticated = User)

```json
{
  "roleMappings": {
    "admin": ["admin"],
    "user": ["user", "authenticated", "offline_access"],
    "defaultRole": "user"  // Default to user if authenticated
  }
}
```

## Migration from Old Logic

**Old behavior:**
- Any role → `'user'`
- Specific `admin` → `'admin'`
- No roles → `'guest'`

**New default behavior:**
- Specific `admin` → `'admin'`
- Specific `user` → `'user'`
- **No matches → `'guest'`** (BREAKING CHANGE)

### If You Want Old Behavior

To maintain the old (flawed) behavior where any role = user:

```json
{
  "roleMappings": {
    "admin": ["admin", "administrator"],
    "user": ["*"],  // ❌ Not supported - use defaultRole instead
    "defaultRole": "user"  // ✓ Use this to default to 'user'
  }
}
```

## Framework Philosophy

As a **framework**, this project should:

✅ **Be configurable** - Let implementers decide role logic
✅ **Have sane defaults** - `defaultRole: "guest"` is secure
✅ **Be explicit** - No surprises (any role ≠ user by default)
✅ **Support various IDPs** - Keycloak, Azure AD, Okta, Auth0, etc.

## Schema Definition

**[src/config/schema.ts](src/config/schema.ts#L4-9)**:
```typescript
export const RoleMappingSchema = z.object({
  admin: z.array(z.string()).optional().default(['admin', 'administrator']),
  user: z.array(z.string()).optional().default(['user']),
  guest: z.array(z.string()).optional().default([]),
  defaultRole: z.enum(['admin', 'user', 'guest']).optional().default('guest'),
});
```

All properties are optional with sensible defaults.

## Testing

After updating configuration:

```bash
# Rebuild
npm run build

# Restart server
npm start

# Test in web console
# 1. Login with Keycloak
# 2. Check server logs:
```

**Expected output:**
```
[JWT VALIDATOR] Extracted roles: ["default-roles-mcp_security", "offline_access"]
[JWT VALIDATOR] Determined primary role: guest
[AUTH DEBUG] Session created:
  - role: guest
```

If you add `"user"` role in Keycloak and re-login:
```
[JWT VALIDATOR] Extracted roles: ["user", "offline_access"]
[JWT VALIDATOR] Determined primary role: user
[AUTH DEBUG] Session created:
  - role: user
```

## Documentation

See also:
- [ROLE-DETERMINATION-EXPLAINED.md](ROLE-DETERMINATION-EXPLAINED.md) - Original explanation
- [CLAUDE.md](CLAUDE.md) - Configuration overview
- [src/config/example.json](src/config/example.json) - Example configurations

## Summary

✅ **Fixed:** Role determination is now configurable
✅ **Breaking Change:** Default behavior is now secure (`defaultRole: "guest"`)
✅ **Framework Appropriate:** Implementers control role logic
✅ **Flexible:** Supports any IDP role structure
