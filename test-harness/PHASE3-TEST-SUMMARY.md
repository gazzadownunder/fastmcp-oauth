# Phase 3 Integration Test Summary

**Date**: 2025-10-09
**Test Status**: ❌ **13/15 Failed** (2 passed)
**Root Cause**: Keycloak configuration incomplete
**Primary Issue**: Missing required JWT claims

---

## TL;DR

**Tests are failing because Keycloak is not configured to return required JWT claims.**

### Current Keycloak JWT (Missing Claims):
```json
{
  "iss": "http://localhost:8080/realms/mcp_security",
  "aud": ["mcp-server-client", "mcp-oauth"],
  "azp": "mcp-oauth",
  "exp": 1759993585
  // ❌ Missing: sub, preferred_username, roles
}
```

### Required for Tests:
- ✅ Requestor JWT: `sub`, `preferred_username`, `roles`
- ✅ Token Exchange enabled
- ✅ TE-JWT: includes `legacy_name` (only after token exchange)

---

## What's Wrong?

### Issue #1: Missing Standard Claims (Critical)

**Current**: JWT only has `iss`, `aud`, `azp`, `exp`
**Needed**: JWT must also include `sub`, `preferred_username`, `roles`
**Impact**: Server cannot create user sessions → HTTP 500 errors

### Issue #2: Token Exchange Not Configured (Critical)

**Current**: Token exchange not enabled/configured
**Needed**: Token exchange between `mcp-oauth` and `mcp-server-client`
**Impact**: Cannot test delegation flows

### Issue #3: Missing legacy_name in TE-JWT (Critical)

**Current**: TE-JWT doesn't include `legacy_name` claim
**Needed**: TE-JWT must include `legacy_name` from user attribute
**Impact**: SQL delegation fails (cannot determine legacy username)

---

## Quick Fix

### Step 1: Add Standard Claims (5 minutes)

**Keycloak Admin Console** → **Clients** → **mcp-oauth** → **Client Scopes** → **mcp-oauth-dedicated** → **Mappers**

Add/enable these mappers:
1. **username** → Token Claim: `preferred_username`
2. **Realm Roles** → Token Claim: `roles` (flat array, not nested)

### Step 2: Configure Token Exchange (10 minutes)

1. Create client: **mcp-server-client** (if doesn't exist)
2. Enable **Service accounts** and assign **token-exchange** role
3. Enable **Permissions** on mcp-server-client
4. Add **token-exchange permission** for `mcp-oauth` client

### Step 3: Add legacy_name to TE-JWT (10 minutes)

**Keycloak** → **Clients** → **mcp-server-client** → **Client Scopes** → **mcp-server-client-dedicated** → **Mappers**

Add mapper:
- **Type**: User Attribute
- **User Attribute**: `legacyName`
- **Token Claim Name**: `legacy_name`
- **Add to access token**: ✅

Add user attributes:
- `alice@test.local` → `legacyName` = `ALICE_ADMIN`
- `bob@test.local` → `legacyName` = `BOB_USER`
- `charlie@test.local` → `legacyName` = `CHARLIE_USER`

---

## Verification

### Test 1: Verify Requestor JWT

```bash
TOKEN=$(curl -s -X POST http://localhost:8080/realms/mcp_security/protocol/openid-connect/token \
  -d "client_id=mcp-oauth" \
  -d "client_secret=9DQjCpm4D9wbzXxHa1ki51PhBbyxOXrg" \
  -d "username=alice@test.local" \
  -d "password=Test123!" \
  -d "grant_type=password" | jq -r .access_token)

# Decode and check
echo $TOKEN | cut -d. -f2 | base64 -d | jq .
```

**Must have**: `sub`, `preferred_username`, `roles`
**Must NOT have**: `legacy_name` (only in TE-JWT)

### Test 2: Verify Token Exchange

```bash
TE_TOKEN=$(curl -s -X POST http://localhost:8080/realms/mcp_security/protocol/openid-connect/token \
  -d "client_id=mcp-oauth" \
  -d "client_secret=9DQjCpm4D9wbzXxHa1ki51PhBbyxOXrg" \
  -d "grant_type=urn:ietf:params:oauth:grant-type:token-exchange" \
  -d "subject_token=$TOKEN" \
  -d "audience=mcp-server-client" | jq -r .access_token)

# Decode and check
echo $TE_TOKEN | cut -d. -f2 | base64 -d | jq .
```

**Must have**: `legacy_name` (added during exchange)

### Test 3: Start Server

```bash
npm run build
cd test-harness
start-phase3-server.bat
```

**Expected**: Server starts without errors

### Test 4: Run Integration Tests

```bash
npm test phase3-integration
```

**Expected**: 15/15 tests pass

---

## Why Tests Are Failing

### Test Failures Breakdown

| Test | Error | Root Cause |
|------|-------|------------|
| INT-001 (11 tests) | "MCP initialize failed: Internal Server Error" | Missing `sub` claim → session creation fails |
| INT-002 | "expected undefined to be defined" | Missing `roles` claim |
| INT-003/004 | Type assertion errors | Missing `roles` claim (undefined array) |

### The Server IS Working

- ✅ Code is correct
- ✅ Configuration schema is valid
- ✅ Test logic is sound
- ❌ **Keycloak is not returning required claims**

---

## Two-Stage Authorization Model

Phase 3 tests validate the two-stage authorization model:

### Stage 1: MCP Tool Access
- **Token**: Requestor JWT
- **Purpose**: Authenticate user to MCP server
- **Claims Used**: `sub`, `preferred_username`, `roles`
- **Authorization**: Can user access this MCP tool?

### Stage 2: Downstream Resource Access
- **Token**: TE-JWT (Token Exchange result)
- **Purpose**: Authorize access to downstream resource (SQL Server)
- **Claims Used**: `legacy_name`, `roles` (may differ from requestor)
- **Authorization**: What privileges does user have on SQL Server?

**Key Principle**: `legacy_name` only appears in TE-JWT, never in requestor JWT.

---

## Next Steps

1. **Fix Keycloak** (30 minutes)
   - Follow steps in [QUICK-FIX-KEYCLOAK.md](QUICK-FIX-KEYCLOAK.md)

2. **Verify Claims** (5 minutes)
   - Test requestor JWT has `sub`, `preferred_username`, `roles`
   - Test TE-JWT has `legacy_name`

3. **Run Tests** (5 minutes)
   - `npm test phase3-integration`
   - Expected: 15/15 pass

---

## Related Documentation

- **Detailed Root Cause**: [PHASE3-ROOT-CAUSE.md](PHASE3-ROOT-CAUSE.md)
- **Detailed Diagnostics**: [PHASE3-TEST-DIAGNOSTICS.md](PHASE3-TEST-DIAGNOSTICS.md)
- **Step-by-Step Fix Guide**: [QUICK-FIX-KEYCLOAK.md](QUICK-FIX-KEYCLOAK.md)
- **Test Requirements**: [../Docs/unified-oauth-progress.md](../Docs/unified-oauth-progress.md#phase-3)

---

**Status**: Environment configuration issue (not code issue)
**Action Required**: Configure Keycloak to return required JWT claims
**Estimated Time**: 30-45 minutes
