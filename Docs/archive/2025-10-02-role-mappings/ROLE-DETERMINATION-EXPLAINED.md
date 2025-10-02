# Role Determination from JWT - How It Works

Based on your debug output:
```
[AUTH DEBUG] Session created:
  - userId: 541f5d3f-f6bc-41a8-91bd-6e6e0c98bd79
  - username: admin@contextflow.ai
  - legacyUsername: greynolds
  - role: user
  - permissions: email, profile, legacy_name
```

## How Role is Determined

### Step 1: Extract Roles from JWT

**Configuration** ([test-harness/config/keycloak-oauth-only.json:11](test-harness/config/keycloak-oauth-only.json#L11)):
```json
{
  "claimMappings": {
    "roles": "realm_access.roles"
  }
}
```

This tells the JWT validator to extract roles from the nested claim `realm_access.roles` in the JWT token.

### Step 2: JWT Token Structure

Your Keycloak JWT likely looks like:
```json
{
  "sub": "541f5d3f-f6bc-41a8-91bd-6e6e0c98bd79",
  "preferred_username": "admin@contextflow.ai",
  "legacy_name": "greynolds",
  "scope": "email profile legacy_name",
  "realm_access": {
    "roles": ["default-roles-mcp_security", "offline_access", "uma_authorization"]
  },
  "resource_access": {
    "mcp-oauth": {
      "roles": ["view-profile", "manage-account"]
    }
  }
}
```

### Step 3: Role Determination Logic

**Code** ([src/middleware/jwt-validator.ts:290-298](src/middleware/jwt-validator.ts#L290-298)):

```typescript
private determinePrimaryRole(roles: string[]): 'admin' | 'user' | 'guest' {
  if (roles.includes('admin') || roles.includes('administrator')) {
    return 'admin';
  }
  if (roles.includes('user') || roles.length > 0) {
    return 'user';  // ← This is why you get 'user'
  }
  return 'guest';
}
```

**Logic:**
1. Check if roles array contains `'admin'` or `'administrator'` → return `'admin'`
2. Check if roles array contains `'user'` OR has ANY roles → return `'user'`
3. Otherwise → return `'guest'`

### Step 4: Why You Get "user"

Your JWT token has roles:
```javascript
["default-roles-mcp_security", "offline_access", "uma_authorization"]
```

- **Does NOT contain** `"admin"` or `"administrator"` ❌
- **Does NOT contain** `"user"` ❌
- **BUT has roles** (length > 0) ✅

Therefore: `role = 'user'` (line 294: `roles.length > 0`)

## How to Get "admin" Role

You need to add the `"admin"` role to the user in Keycloak:

### Option 1: Add Realm Role

1. In Keycloak Admin Console
2. Go to **Realm Settings** → **Roles**
3. Create role: `admin`
4. Go to **Users** → Find your user (`admin@contextflow.ai`)
5. Click **Role Mappings** tab
6. Assign **Realm Role**: `admin`

### Option 2: Add Client Role

1. Go to **Clients** → `mcp-oauth`
2. Go to **Roles** tab
3. Create role: `admin`
4. Go to **Users** → Find your user
5. Click **Role Mappings** tab → **Client Roles** → Select `mcp-oauth`
6. Assign role: `admin`

Then update the claim mapping to check client roles:
```json
{
  "claimMappings": {
    "roles": "resource_access.mcp-oauth.roles"
  }
}
```

### Option 3: Use Custom Mapper

Create a Keycloak mapper that adds a custom claim:

1. **Clients** → `mcp-oauth` → **Mappers** → **Create**
2. **Mapper Type**: User Attribute
3. **User Attribute**: `role` (set this attribute on the user)
4. **Token Claim Name**: `app_role`
5. **Claim JSON Type**: String

Then update config:
```json
{
  "claimMappings": {
    "roles": "app_role"
  }
}
```

## Verifying Roles in JWT

To see what's actually in your JWT token:

### In Web Console (Browser DevTools)

```javascript
// After token exchange, decode the JWT
const parts = exchangedToken.split('.');
const payload = JSON.parse(atob(parts[1]));
console.log('JWT Payload:', JSON.stringify(payload, null, 2));
console.log('realm_access.roles:', payload.realm_access?.roles);
console.log('resource_access:', payload.resource_access);
```

### Using jwt.io

1. Copy your JWT token
2. Go to https://jwt.io
3. Paste token in the left panel
4. View decoded payload on the right
5. Check `realm_access.roles` or `resource_access`

## Alternative: Use Group-Based Roles

Keycloak also supports groups:

1. Create groups: `admins`, `users`, `guests`
2. Add users to groups
3. Create group mapper in client
4. Update claim mapping:
   ```json
   {
     "claimMappings": {
       "roles": "groups"
     }
   }
   ```

5. Update role determination logic to check group names

## Current Behavior Summary

| JWT Contains | Role Assigned | Why |
|--------------|---------------|-----|
| `roles: ["admin"]` | `admin` | Matches 'admin' string |
| `roles: ["administrator"]` | `admin` | Matches 'administrator' string |
| `roles: ["user"]` | `user` | Matches 'user' string |
| `roles: ["something-else"]` | `user` | Has roles (length > 0) |
| `roles: []` | `guest` | No roles |

## Customizing Role Logic

If you want different behavior, edit [src/middleware/jwt-validator.ts:290-298](src/middleware/jwt-validator.ts#L290-298):

```typescript
private determinePrimaryRole(roles: string[]): 'admin' | 'user' | 'guest' {
  // Check for admin-like roles
  if (roles.some(r => ['admin', 'administrator', 'superuser'].includes(r))) {
    return 'admin';
  }

  // Check for specific user role
  if (roles.includes('user')) {
    return 'user';
  }

  // Default to guest if no recognized roles
  return 'guest';
}
```

Or use a priority-based system:
```typescript
private determinePrimaryRole(roles: string[]): 'admin' | 'user' | 'guest' {
  // Priority order: highest role wins
  const rolePriority = {
    'admin': 3,
    'administrator': 3,
    'superuser': 3,
    'user': 2,
    'authenticated': 1,
  };

  let highestPriority = 0;
  let assignedRole: 'admin' | 'user' | 'guest' = 'guest';

  for (const role of roles) {
    const priority = rolePriority[role.toLowerCase()] || 0;
    if (priority > highestPriority) {
      highestPriority = priority;
      assignedRole = priority >= 3 ? 'admin' : priority >= 2 ? 'user' : 'guest';
    }
  }

  return assignedRole;
}
```

## Debug Your Current JWT

Add logging to see what roles are extracted:

```typescript
// In createUserSession (line 272)
const roleArray = Array.isArray(roles) ? roles : [roles].filter(Boolean);
console.log('[JWT VALIDATOR] Extracted roles:', roleArray);
const primaryRole = this.determinePrimaryRole(roleArray);
console.log('[JWT VALIDATOR] Determined primary role:', primaryRole);
```

Then restart server and check logs when you authenticate.

## Quick Fix for Your Case

If `admin@contextflow.ai` should be an admin:

**In Keycloak:**
1. Users → `admin@contextflow.ai` → Role Mappings
2. Available Roles → Create or select `admin`
3. Add to Assigned Roles

**Verify:**
1. Get new token (logout and login again)
2. Check server logs - should show `role: admin`
