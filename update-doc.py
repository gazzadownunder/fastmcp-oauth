#!/usr/bin/env python3
"""Update Token-Exchange.md with Phase 7.2 fix"""

FILE_PATH = 'Docs/Token-Exchange.md'

PHASE_72_DOC = """
### Phase 7.2: Fix Undefined teRoles Variable - COMPLETED (2025-01-06)

**Problem:** Runtime error `ReferenceError: teRoles is not defined` in PostgreSQL module

**Root Cause:** After token exchange completed and `legacy_name` was extracted from TE-JWT (line 369), the code forgot to extract the `roles` claim from the same TE-JWT before using it on lines 419-420.

**Solution:** Extract roles from TE-JWT after extracting legacy username

**Changes Made:**
- [x] Added `rolesClaim?: string` field to `TokenExchangeConfig` interface (line 50-51)
- [x] Added role extraction logic after line 369 (5 lines of code):
  ```typescript
  // Extract roles from TE-JWT (may be in 'roles', 'user_roles', or other claim)
  const rolesClaimPath = this.tokenExchangeConfig.rolesClaim || 'roles';
  const teRoles = (Array.isArray(teClaims?.[rolesClaimPath])
    ? teClaims[rolesClaimPath]
    : []) as string[];
  ```
- [x] Updated console.log to show extracted roles (lines 374-378)
- [x] Fixed incorrect `this.tokenExchangeService` references → `this.tokenExchangeConfig` (lines 456, 473)

**Files Changed:**
- `packages/sql-delegation/src/postgresql-module.ts` - 3 fixes applied (~15 lines changed)

**Design Alignment:**
This fix implements the missing role extraction specified in the design document (Unified OAuth & Token Exchange Implementation plan.md lines 523-527):

```typescript
// CRITICAL: Decode TE-JWT for legacy authorization
const delegationClaims = decodeJWT(delegationToken);

// Extract TE-JWT authorization (NOT requestor JWT!)
const legacyUsername = delegationClaims.legacy_name;      // ✅ Already implemented
const legacyRoles = delegationClaims.roles || [];         // ✅ FIXED in Phase 7.2
const legacyPermissions = delegationClaims.permissions || []; // Can be added later
```

**Build Verification:** ✅ All builds successful after fix
- Core: ✅ (61ms)
- @mcp-oauth/sql-delegation: ✅ (11ms)

**Security Impact:** ✅ POSITIVE - TE-JWT roles now properly extracted and used for SQL authorization

---

"""

with open(FILE_PATH, 'r', encoding='utf-8') as f:
    content = f.read()

# Find the insertion point (after Phase 7.1 section)
insertion_point = content.find('**Build Verification:** ✅ All builds successful after fix\n\n---\n\n## Key Decisions')

if insertion_point == -1:
    print("ERROR: Could not find insertion point")
    exit(1)

# Insert Phase 7.2 doc
new_content = content[:insertion_point] + '**Build Verification:** ✅ All builds successful after fix\n\n---\n' + PHASE_72_DOC + '\n## Key Decisions' + content[insertion_point + len('**Build Verification:** ✅ All builds successful after fix\n\n---\n\n## Key Decisions'):]

with open(FILE_PATH, 'w', encoding='utf-8') as f:
    f.write(new_content)

print("SUCCESS: Added Phase 7.2 documentation to Token-Exchange.md")
