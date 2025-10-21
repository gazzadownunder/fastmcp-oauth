# 🔴 URGENT: Critical Design Correction Required

**Date:** 2025-01-10
**Status:** ⚠️ BLOCKING - Must be addressed before Phase 3 completion
**Priority:** P0 (Highest)
**Affects:** All phases, all documentation, current implementation

---

## Summary

The current implementation has **drifted from the original OAuth 2.1 design** by introducing static server-side permissions. This violates fundamental principles and must be corrected immediately.

---

## What's Wrong

### Current INCORRECT Implementation

```json
// ❌ WRONG: Configuration has static permissions
{
  "auth": {
    "permissions": {
      "adminPermissions": ["read", "write", "sql:query"],
      "userPermissions": ["read", "sql:query"],
      "guestPermissions": ["read"]
    }
  }
}
```

```typescript
// ❌ WRONG: UserSession has permissions field
interface UserSession {
  permissions: string[];  // Server-side permissions
}

// ❌ WRONG: Tools check static permissions
canAccess: (context) => {
  return context.session.permissions.includes('sql:query');
}
```

### Why This Is Wrong

1. **Violates OAuth 2.1 principles** - Authorization should be claim-based, not server-side config
2. **Cannot support multi-delegation** - Each delegation target (SQL, Kerberos, APIs) needs different permissions
3. **Cannot support privilege elevation/reduction** - TE-JWT cannot have different permissions than requestor JWT
4. **Requires server restart** to change permissions
5. **Duplicates authorization** - JWT has roles, server has permissions (two sources of truth)

---

## Correct Design

### Role-Based Authorization (From JWT Claims)

```json
// ✅ CORRECT: No static permissions config
{
  "trustedIDPs": [
    {
      "name": "requestor-jwt",
      "audience": "mcp-oauth",
      "claimMappings": {
        "roles": "user_roles"  // JWT claim → framework field
      },
      "roleMappings": {
        "user": ["user", "authenticated"]  // JWT role → framework role
      }
    },
    {
      "name": "sql-te-jwt",
      "audience": "urn:sql:database",
      "claimMappings": {
        "roles": "roles",
        "legacyUsername": "legacy_name",
        "allowedOperations": "allowed_operations"
      }
    }
  ]
}
```

```typescript
// ✅ CORRECT: UserSession has NO permissions field
interface UserSession {
  role: string;           // Mapped framework role (admin/user/guest)
  customRoles: string[];  // Direct JWT roles
  customClaims?: Record<string, any>;  // Custom TE-JWT claims
}

// ✅ CORRECT: Tools check roles from JWT
canAccess: (context) => {
  return context.session.customRoles.includes('sql-user');
}
```

---

## Required Actions

### Immediate (Before Any New Work)

1. **READ:** [MULTI-DELEGATION-ARCHITECTURE.md](./MULTI-DELEGATION-ARCHITECTURE.md)
2. **UNDERSTAND:** Role-based vs permission-based authorization
3. **REVIEW:** All existing code and documentation with this lens

### Phase 1: Remove Static Permissions (BREAKING CHANGE)

**Estimated Effort:** 2-3 days

1. **Delete from codebase:**
   - ❌ Remove `PermissionConfig` interface
   - ❌ Remove `permissions` field from `UserSession`
   - ❌ Remove `permissions` parameter from `SessionManager`
   - ❌ Remove `getPermissions()` method
   - ❌ Delete `hasPermission()` authorization helpers

2. **Delete from configuration:**
   - ❌ Remove `permissions` section from schema
   - ❌ Remove `permissions` from all config files

3. **Update tools:**
   - ✅ Change all `hasPermission()` to `hasRole()` or `customRoles.includes()`
   - ✅ Update `canAccess` implementations

4. **Update tests:**
   - ❌ Remove permission-based assertions
   - ✅ Add role-based assertions

5. **Update documentation:**
   - ✅ Update CLAUDE.md to reflect role-based design
   - ✅ Remove all permission references
   - ✅ Add multi-delegation examples

### Phase 2: Support Multiple TrustedIDPs (Enhancement)

**Estimated Effort:** 2-3 days

1. **JWT matching by iss + aud:**
   - Implement `JWTValidator.findIDPConfig(jwtPayload)`
   - Match JWT to IDP config by issuer + audience

2. **Support N delegations:**
   - Requestor JWT (aud: "mcp-oauth")
   - SQL TE-JWT (aud: "urn:sql:database")
   - Kerberos TE-JWT (aud: "urn:kerberos:legacy")
   - OAuth API TE-JWT (aud: "https://api.company.com")
   - Salesforce TE-JWT (aud: "https://login.salesforce.com")

3. **Custom claims support:**
   - Add `customClaims` to `UserSession`
   - Store delegation-specific claims (e.g., `allowed_operations`)

4. **Two-tier authorization:**
   - Primary: Downstream system (via legacy_name or OAuth scopes)
   - Secondary: TE-JWT constraints (optional)

---

## Documentation Updates Required

### Must Update

1. **CLAUDE.md** - Remove all permission references, add multi-delegation examples
2. **unified-oauth-progress.md** - Mark as "blocked pending design correction"
3. **Unified OAuth & Token Exchange Implementation plan.md** - Add design correction phase
4. **All config examples** - Remove `permissions` section
5. **All test documentation** - Update to role-based assertions

### New Documents

1. ✅ **MULTI-DELEGATION-ARCHITECTURE.md** - Comprehensive design spec (CREATED)
2. ✅ **URGENT-DESIGN-CORRECTION.md** - This document (CREATED)
3. ⬜ **MIGRATION-GUIDE.md** - How to migrate from permissions to roles

---

## Impact Assessment

### Breaking Changes

- ❌ **Configuration schema** - `permissions` section removed
- ❌ **UserSession** - `permissions` field removed
- ❌ **Authorization API** - `hasPermission()` methods removed
- ❌ **Tool implementations** - Must use `hasRole()` instead

### Non-Breaking Changes

- ✅ **Multiple TrustedIDPs** - Backward compatible (single IDP still works)
- ✅ **Custom claims** - Additive (optional field in UserSession)
- ✅ **JWT matching** - Transparent (automatic based on iss + aud)

### Migration Path

```typescript
// OLD CODE (WRONG)
canAccess: (context) => {
  return context.session.permissions.includes('sql:query');
}

// NEW CODE (CORRECT) - Option 1: Framework role
canAccess: (context) => {
  return auth.hasRole(context, 'user');
}

// NEW CODE (CORRECT) - Option 2: JWT custom role
canAccess: (context) => {
  return context.session.customRoles.includes('sql-user');
}
```

---

## Testing Impact

### Tests Affected

- ⬜ **All unit tests** checking `permissions` field
- ⬜ **All integration tests** with `permissions` config
- ⬜ **Phase 3 tests** (currently failing due to missing permissions)

### New Tests Needed

- ✅ Multi-IDP JWT matching (iss + aud)
- ✅ TE-JWT constraint enforcement (secondary authorization)
- ✅ Role-based tool access control
- ✅ Multiple delegation targets (SQL, Kerberos, APIs)

---

## Timeline

### Week 1: Design Correction (Phase 1)

- Day 1-2: Remove static permissions from codebase
- Day 3-4: Update all tools to use role-based authorization
- Day 5: Update tests and documentation

### Week 2: Multi-Delegation Support (Phase 2)

- Day 1-2: Implement JWT matching by iss + aud
- Day 3-4: Add custom claims support
- Day 5: Integration tests with multiple delegations

### Week 3: Documentation & Migration

- Day 1-2: Update all documentation
- Day 3: Create migration guide
- Day 4-5: Code review and validation

---

## Success Criteria

Before marking this as complete:

- ✅ NO `permissions` config anywhere in codebase
- ✅ NO `permissions` field in `UserSession`
- ✅ ALL tools use role-based authorization
- ✅ Multiple TrustedIDPs supported (requestor + N delegations)
- ✅ TE-JWT constraints work (secondary authorization)
- ✅ All tests pass with role-based design
- ✅ All documentation updated
- ✅ Migration guide created
- ✅ Git commit with detailed explanation

---

## Owner & Accountability

**Owner:** Development Team
**Reviewer:** Architecture Team
**Deadline:** Before Phase 3 integration tests
**Blocker For:** Production readiness, Phase 3 completion

---

## Questions?

See [MULTI-DELEGATION-ARCHITECTURE.md](./MULTI-DELEGATION-ARCHITECTURE.md) for the complete architectural specification.

---

**🔴 DO NOT PROCEED WITH PHASE 3 UNTIL THIS IS RESOLVED 🔴**
