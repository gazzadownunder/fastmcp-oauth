# Purpose of `sub` and `preferred_username` Claims

**Question**: What are `sub` and `preferred_username` used for in the authentication framework? Do they control authentication outcome?

**Short Answer**: **No, they do NOT control authentication outcome.** They are used for **audit logging, session identification, and user display** purposes only. Authorization decisions are made solely based on **roles** and **permissions**.

---

## Claims Mapping

| JWT Claim | UserSession Field | Purpose | Controls Authentication? |
|-----------|------------------|---------|------------------------|
| `sub` | `userId` | Unique user identifier for audit logs | ❌ No |
| `preferred_username` | `username` | Human-readable username for display | ❌ No |
| `roles` (or mapped claim) | `role`, `customRoles` | Role mapping → permissions | ✅ **YES** |
| `legacy_name` (TE-JWT only) | `legacyUsername` | Legacy system account mapping | ❌ No (used for delegation) |
| `scope` | `scopes` | OAuth scopes (optional) | ❌ No |

---

## What Controls Authentication Outcome?

### ✅ Authentication Decision Factors:

1. **JWT Signature Validation** - Is the JWT cryptographically valid?
2. **Issuer/Audience Validation** - Is the JWT from a trusted IDP with correct audience?
3. **Expiration Validation** - Is the JWT still valid (not expired)?
4. **Role Mapping** - Do JWT roles map to application roles?
   - If **no role match** → `UNASSIGNED_ROLE` → **Authentication REJECTED**
   - If **role matches** → Permissions granted → **Authentication ACCEPTED**

### ❌ NOT Used for Authentication Decisions:

- `sub` (userId)
- `preferred_username` (username)
- `legacy_name` (legacyUsername)
- `scope` (scopes)

These are **identity metadata** only - they identify WHO the user is, but don't determine WHAT they can do.

---

## Where `userId` and `username` Are Used

### 1. Audit Logging (Primary Use)

**Purpose**: Track WHO performed an action for security audit trail.

**Code Examples**:

```typescript
// src/core/authentication-service.ts:193
auditService.log({
  source: 'auth:service',
  userId: session.userId,  // ← Logs WHO authenticated
  action: 'authenticate',
  success: true
});

// src/delegation/sql/sql-module.ts:196
auditService.log({
  source: 'delegation:sql',
  userId: session.userId,  // ← Logs WHO initiated SQL query
  action: 'sql:query',
  success: true,
  metadata: { query: sanitizedQuery }
});
```

**Audit Log Example**:
```json
{
  "timestamp": "2025-01-09T10:30:00Z",
  "source": "delegation:sql",
  "userId": "550e8400-e29b-41d4-a716-446655440000",  // ← sub claim
  "action": "sql:query",
  "success": true,
  "metadata": {
    "query": "SELECT * FROM customers WHERE id = @p1"
  }
}
```

### 2. User Information Display

**Purpose**: Show human-readable user information to clients.

**Code Example**:

```typescript
// src/mcp/tools/user-info.ts:84-85
return JSON.stringify({
  userId: session.userId,      // ← sub: "550e8400-..."
  username: session.username,  // ← preferred_username: "alice@test.local"
  role: session.role,          // ← "admin"
  permissions: session.permissions,
  legacyUsername: session.legacyUsername
});
```

**API Response Example**:
```json
{
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "username": "alice@test.local",
  "role": "admin",
  "permissions": ["read", "write", "delete", "admin"],
  "legacyUsername": null
}
```

### 3. Session Identification (Internal)

**Purpose**: Uniquely identify user sessions for cache lookups.

**Code Example**:

```typescript
// src/delegation/encrypted-token-cache.ts:230
auditService.log({
  source: 'delegation:token-cache',
  userId: jwtSubject,  // ← sub claim used for session tracking
  action: 'cache:activate-session',
  success: true
});
```

### 4. Error Context (Debugging)

**Purpose**: Include user context in error messages for troubleshooting.

**Code Example**:

```typescript
// src/mcp/utils/error-helpers.ts:43
auditService.log({
  source: 'mcp:error-handler',
  userId: mcpContext.session?.userId,  // ← Context for debugging
  action: 'error:occurred',
  success: false,
  error: sanitizeError(error)
});
```

---

## What `userId` and `username` Do NOT Control

### ❌ Authorization Decisions

**NOT Used For**:
- Tool visibility (`tools/list`)
- Tool access (`canAccess()` checks)
- Permission validation (`requirePermission()`)
- Role-based access control

**Authorization Is Based On**:
```typescript
// Authorization checks use roles/permissions, NOT userId
Authorization.requirePermission(context, 'sql:query');  // ✅ Uses permissions
Authorization.requireRole(context, 'admin');            // ✅ Uses role

// userId is NOT checked in authorization
if (session.userId === 'specific-user-id') { ... }      // ❌ NEVER done
```

### ❌ Session Validity

**NOT Used For**:
- JWT expiration validation (uses `exp` claim)
- Token revocation checks
- Session rejection (`rejected` field is based on role mapping)

### ❌ Delegation Decisions

**NOT Used For**:
- SQL `EXECUTE AS USER` (uses `legacyUsername` from TE-JWT)
- Kerberos delegation (uses `legacyUsername`)
- Downstream API authorization (uses TE-JWT roles/permissions)

---

## Why `sub` and `preferred_username` Are Required

### Requirement 1: Audit Trail Integrity

**Regulatory Compliance**: Audit logs must identify WHO performed each action.

**Standards**:
- **GDPR**: Right to access logs of data processing activities
- **SOX**: Financial transaction audit trails must identify actors
- **HIPAA**: PHI access logs must identify accessing users
- **PCI-DSS**: All access to cardholder data must be logged with user IDs

**Without `userId`**: Cannot comply with audit requirements.

### Requirement 2: User Session Tracking

**Purpose**: Track user sessions for cache management and analytics.

**Use Cases**:
- Session-scoped token caching (Phase 2)
- User activity analytics
- Session timeout management
- Concurrent session limits

**Without `userId`**: Cannot implement session-based features.

### Requirement 3: User Experience

**Purpose**: Display meaningful user information in tools like `user-info`.

**Use Cases**:
- Debugging: "Who am I authenticated as?"
- Troubleshooting: "Why don't I have access?"
- User profile display

**Without `username`**: Users see cryptic UUIDs instead of readable names.

### Requirement 4: Security Incident Response

**Purpose**: Investigate security incidents and identify compromised accounts.

**Scenario**:
```
Alert: Unusual SQL query detected
Query: DROP TABLE customers;
UserId: 550e8400-e29b-41d4-a716-446655440000
Username: alice@test.local
Time: 2025-01-09 10:30:00

→ Security team can immediately identify:
  1. WHO: alice@test.local (human-readable)
  2. UNIQUE ID: 550e8400-... (for cross-system correlation)
  3. ACTION: What was attempted
```

**Without `userId` + `username`**: Cannot investigate incidents effectively.

---

## JWT Claim Validation Flow

### Step 1: JWT Cryptographic Validation
```typescript
// src/core/jwt-validator.ts:200-250
1. Verify JWT signature against JWKS
2. Validate issuer (iss)
3. Validate audience (aud)
4. Validate expiration (exp)
5. Validate not-before (nbf) if present

→ If any fail: Authentication REJECTED (401 Unauthorized)
```

### Step 2: Claim Extraction
```typescript
// src/core/jwt-validator.ts:306-310
Extract claims based on claimMappings:
  userId:         payload.sub                    ← Required
  username:       payload.preferred_username     ← Required
  roles:          payload.roles                  ← Required
  legacyUsername: payload.legacy_name            ← Optional (TE-JWT only)
  scopes:         payload.scope                  ← Optional
```

### Step 3: Required Claim Validation
```typescript
// src/core/jwt-validator.ts:323-329
if (!claims.userId) {
  throw new Error(`Missing required claim: sub`);  ← HARD REQUIREMENT
}

// username defaults to userId if missing
username: claims.username || claims.userId
```

**Why `userId` (sub) is Required**:
- Audit logs MUST have userId
- Session tracking requires unique identifier
- Prevents anonymous sessions

**Why `username` can default to `userId`**:
- Human-readable display is preferred, not required
- Falls back to UUID for display if preferred_username missing

### Step 4: Role Mapping (The ACTUAL Authorization Decision)
```typescript
// src/core/role-mapper.ts:50-100
1. Extract roles from JWT (e.g., ["user", "admin"])
2. Map JWT roles to application roles via roleMappings config
3. If NO role matches → UNASSIGNED_ROLE → Permissions = []
4. If role matches → Grant permissions from permissionsMapping

→ This step determines WHAT the user can do
→ userId/username are NOT involved in this decision
```

### Step 5: Session Creation
```typescript
// src/core/session-manager.ts:127-140
Create UserSession:
  userId:       from claims.userId (sub)        ← For audit logs
  username:     from claims.username            ← For display
  role:         from role mapping result        ← Controls access
  permissions:  from role mapping result        ← Controls access
  rejected:     true if role === UNASSIGNED     ← Controls access
```

---

## Example: Authentication Flow

### Scenario: Alice logs in with JWT

**JWT Claims**:
```json
{
  "sub": "550e8400-e29b-41d4-a716-446655440000",
  "preferred_username": "alice@test.local",
  "roles": ["user"],
  "exp": 1759995000
}
```

**Step-by-Step**:

1. **JWT Validation**: ✅ Signature valid, issuer trusted, not expired
2. **Claim Extraction**:
   - `userId` = "550e8400-..."
   - `username` = "alice@test.local"
   - `roles` = ["user"]
3. **Required Claim Check**: ✅ `userId` present
4. **Role Mapping**:
   - JWT roles: ["user"]
   - Config: `roleMappings.user = ["user"]` → **MATCH**
   - Mapped role: "user"
   - Permissions: ["read", "write", "sql:query"]
5. **Session Created**:
   ```typescript
   {
     userId: "550e8400-...",        // ← NOT used for authorization
     username: "alice@test.local",  // ← NOT used for authorization
     role: "user",                  // ← ✅ USED for authorization
     permissions: ["read", "write", "sql:query"],  // ← ✅ USED for authorization
     rejected: false
   }
   ```
6. **Authorization Check** (when Alice calls `sql-delegate` tool):
   ```typescript
   Authorization.requirePermission(context, 'sql:query');
   // Checks: session.permissions.includes('sql:query')
   // Result: ✅ ALLOWED (has permission)
   // NOTE: userId and username NOT checked!
   ```

7. **Audit Log**:
   ```json
   {
     "timestamp": "2025-01-09T10:30:00Z",
     "source": "delegation:sql",
     "userId": "550e8400-...",      // ← NOW used for audit
     "action": "sql:query",
     "success": true
   }
   ```

### Counter-Example: Bob with No Role Match

**JWT Claims**:
```json
{
  "sub": "7f3a2b1c-...",
  "preferred_username": "bob@test.local",
  "roles": ["contractor"],  // ← Not in roleMappings
  "exp": 1759995000
}
```

**Step-by-Step**:

1. **JWT Validation**: ✅ Signature valid
2. **Claim Extraction**:
   - `userId` = "7f3a2b1c-..."
   - `username` = "bob@test.local"
   - `roles` = ["contractor"]
3. **Required Claim Check**: ✅ `userId` present
4. **Role Mapping**:
   - JWT roles: ["contractor"]
   - Config: No matching role in `roleMappings`
   - Result: **NO MATCH** → `UNASSIGNED_ROLE`
   - Permissions: **[] (empty)**
5. **Session Created**:
   ```typescript
   {
     userId: "7f3a2b1c-...",        // ← Still captured for audit
     username: "bob@test.local",    // ← Still captured for display
     role: "unassigned",            // ← ❌ Authorization DENIED
     permissions: [],               // ← ❌ No permissions
     rejected: true                 // ← ❌ Session REJECTED
   }
   ```
6. **Authentication Result**: ❌ **REJECTED** (HTTP 403 Forbidden)
7. **Audit Log**:
   ```json
   {
     "timestamp": "2025-01-09T10:30:00Z",
     "source": "auth:service",
     "userId": "7f3a2b1c-...",      // ← Still logged for audit trail
     "action": "authenticate",
     "success": false,
     "reason": "No matching role found for JWT roles: contractor"
   }
   ```

**Key Observation**: Bob's `userId` and `username` are still captured for audit purposes, even though authentication was rejected due to role mismatch.

---

## Summary Table

| Claim | Session Field | Purpose | Controls Auth? | Required? | Why Required? |
|-------|---------------|---------|----------------|-----------|---------------|
| `sub` | `userId` | Audit trail identity | ❌ No | ✅ Yes | Regulatory compliance (GDPR, SOX, HIPAA) |
| `preferred_username` | `username` | Human-readable display | ❌ No | ⚠️ Optional* | User experience (defaults to userId) |
| `roles` | `role`, `customRoles` | Role mapping → permissions | ✅ **YES** | ✅ Yes | Authorization decisions |
| `legacy_name` (TE-JWT) | `legacyUsername` | Legacy system delegation | ❌ No | ⚠️ Conditional** | SQL Server `EXECUTE AS USER` |
| `scope` | `scopes` | OAuth scopes | ❌ No | ❌ No | OAuth-specific use cases |

\* Defaults to `userId` if missing
\*\* Required only for SQL delegation (in TE-JWT)

---

## Keycloak Configuration Impact

Based on this analysis, here's what happens if claims are missing:

### If `sub` is Missing:

**Result**: ❌ **Authentication FAILS** (HTTP 400 Bad Request)

**Error**:
```
Missing required claim: sub
```

**Impact**: Users cannot authenticate at all.

**Fix Required**: ✅ **CRITICAL** - Must add `sub` claim mapper in Keycloak

### If `preferred_username` is Missing:

**Result**: ⚠️ **Authentication SUCCEEDS** (falls back to `sub`)

**Behavior**:
```typescript
session.username = session.userId;  // ← UUID used as username
```

**Impact**: Users see UUID instead of email in `user-info` tool.

**Fix Required**: ⚠️ **RECOMMENDED** - Add `preferred_username` for better UX

### If `roles` is Missing:

**Result**: ❌ **Authentication FAILS** (HTTP 403 Forbidden)

**Reason**: No role match → `UNASSIGNED_ROLE` → Empty permissions → Rejected

**Impact**: Users authenticate but are immediately rejected.

**Fix Required**: ✅ **CRITICAL** - Must add `roles` claim mapper in Keycloak

---

## Conclusion

**Question**: Do `sub` and `preferred_username` control authentication outcome?

**Answer**: **No.** They are **audit and display metadata only**.

**What DOES control authentication**:
1. JWT signature validation
2. Issuer/audience validation
3. **Role mapping** (roles → permissions)

**Why they are still required**:
- **`sub` (userId)**: Regulatory compliance (audit trail)
- **`preferred_username` (username)**: User experience (display)

**Phase 3 Test Failures**:
- Missing `sub` → Cannot create sessions → HTTP 500
- Missing `roles` → No role match → HTTP 403
- Missing `preferred_username` → Non-critical (uses userId as fallback)

**Fix Priority**:
1. **CRITICAL**: Add `sub` claim (blocks authentication)
2. **CRITICAL**: Add `roles` claim (blocks authorization)
3. **RECOMMENDED**: Add `preferred_username` (improves UX)
4. **PHASE 2**: Configure token exchange for `legacy_name` (delegation only)
