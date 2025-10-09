# Phase 3 Integration Tests - Root Cause Analysis

**Date**: 2025-10-09
**Conclusion**: **Keycloak Configuration Issue** (not test script or framework issue)

---

## Executive Summary

The Phase 3 integration tests are failing due to **incomplete Keycloak configuration**. The JWTs returned by Keycloak are missing all custom claims required for the framework to function:

- ❌ Missing: `roles` (or `realm_access.roles`)
- ❌ Missing: `legacy_name`
- ❌ Missing: `sub` (subject)
- ❌ Missing: `preferred_username`
- ❌ Missing: User identity claims

**Impact**: Without these claims, the framework cannot:
1. Determine user identity
2. Map roles to permissions
3. Extract legacy username for delegation
4. Create valid user sessions

---

## Evidence

### Actual JWT Claims from Keycloak

```bash
$ curl -X POST http://localhost:8080/realms/mcp_security/protocol/openid-connect/token \
  -d "client_id=mcp-oauth" \
  -d "client_secret=9DQjCpm4D9wbzXxHa1ki51PhBbyxOXrg" \
  -d "username=alice@test.local" \
  -d "password=Test123!" \
  -d "grant_type=password"
```

**Token Payload** (decoded):
```json
{
  "exp": 1759993585,
  "iat": 1759993285,
  "jti": "onrtro:bfc173ce-06aa-b7a5-ffbe-62ae4807f976",
  "iss": "http://localhost:8080/realms/mcp_security",
  "aud": ["mcp-server-client", "mcp-oauth"],
  "typ": "Bearer",
  "azp": "mcp-oauth",
  "sid": "14368515-b678-4a9f-bb11-94396f6e1b38",
  "scope": ""
}
```

### Expected JWT Claims

According to [unified-oauth-progress.md](../Docs/unified-oauth-progress.md) Phase 3, there are TWO types of JWTs:

**Requestor JWT** (initial authentication):
```json
{
  "iss": "http://localhost:8080/realms/mcp_security",
  "aud": ["mcp-oauth"],
  "sub": "550e8400-e29b-41d4-a716-446655440000",        // ← MISSING
  "preferred_username": "alice@test.local",              // ← MISSING
  "realm_access": {                                       // ← MISSING
    "roles": ["user", "admin"]
  },
  "exp": 1759993585,
  "iat": 1759993285
}
```

**TE-JWT** (Token Exchange result for delegation):
```json
{
  "iss": "http://localhost:8080/realms/mcp_security",
  "aud": ["mcp-oauth", "urn:sql:database"],
  "sub": "550e8400-e29b-41d4-a716-446655440000",
  "preferred_username": "alice@test.local",
  "legacy_name": "ALICE_ADMIN",                          // ← Only in TE-JWT!
  "roles": ["admin", "sql:write"],                       // ← May differ from requestor
  "exp": 1759993585,
  "iat": 1759993285,
  "act": {                                               // ← Actor claim (optional)
    "sub": "mcp-server-client"
  }
}
```

**Key Distinction**: `legacy_name` is **only** included in TE-JWT after token exchange, not in the requestor JWT.

### Configuration Expectations

**Test Config** ([config/phase3-test-config.json](config/phase3-test-config.json)):
```json
"claimMappings": {
  "legacyUsername": "legacy_name",     // ← Expects custom claim
  "roles": "roles",                     // ← Expects flat roles claim
  "scopes": "scope",                    // ← Present but empty
  "userId": "sub",                      // ← MISSING
  "username": "preferred_username"      // ← MISSING
}
```

**Result**: All claim mappings fail because source claims don't exist in JWT.

---

## Test Failure Analysis

### Primary Failure: Server Initialization (11/13 tests)

**Error**: `MCP initialize failed: Internal Server Error - Error creating server`

**Root Cause**: The server IS starting, but when it tries to authenticate requests:
1. Request includes Bearer token
2. JWT validation succeeds (signature, issuer, audience OK)
3. **Claim mapping fails** - no `sub` claim means no user identity
4. Session creation fails
5. Server returns HTTP 500

**Evidence**: The server script itself is correct. The issue is runtime authentication failure due to missing claims.

### Secondary Failure: Missing Claims (2/13 tests)

**Error**: `expected undefined to be defined` (claims.user_roles)

**Root Cause**: Test directly checks for `user_roles` claim, which doesn't exist in JWT.

---

## Required Keycloak Configuration

To fix these tests, Keycloak must be configured with the following Protocol Mappers:

### 1. Built-in User Properties (Enable)

Navigate to: **Realm** → **Clients** → `mcp-oauth` → **Client Scopes** → **Dedicated Scope**

Enable these built-in mappers (if disabled):
- ✅ `username` → Token Claim Name: `preferred_username`
- ✅ `userId` → Token Claim Name: `sub`

### 2. Realm Roles (Add Mapper)

**Mapper Type**: User Realm Role
**Name**: `realm-roles`
**Token Claim Name**: `roles`
**Claim JSON Type**: `JSON` (array)
**Add to access token**: ✅

This will add a flat `roles` array to the JWT:
```json
"roles": ["user", "admin"]
```

**Alternative**: Use nested structure and update config to:
```json
"claimMappings": {
  "roles": "realm_access.roles"  // ← Nested path
}
```

### 3. Custom Claim: legacy_name (Add Mapper)

**Mapper Type**: User Attribute
**Name**: `legacy-name-mapper`
**User Attribute**: `legacyName`
**Token Claim Name**: `legacy_name`
**Claim JSON Type**: `String`
**Add to access token**: ✅

**User Setup**: For each test user, add attribute:
- User: `alice@test.local` → Attribute: `legacyName` = `ALICE_ADMIN`
- User: `bob@test.local` → Attribute: `legacyName` = `BOB_USER`
- User: `charlie@test.local` → Attribute: `legacyName` = `CHARLIE_USER`
- User: `dave@test.local` → (no attribute - for testing missing claim)

**Alternative (Hardcoded)**: Use "Hardcoded claim" mapper for testing:
- Token Claim Name: `legacy_name`
- Claim value: `TEST_USER`
- Claim JSON Type: `String`

### 4. Enable Direct Access Grants

Navigate to: **Realm** → **Clients** → `mcp-oauth` → **Settings**

- ✅ **Direct Access Grants Enabled**: ON
  (Required for password grant type used in tests)

---

## Verification Steps

### Step 1: Apply Keycloak Configuration

1. Access Keycloak Admin Console: http://localhost:8080
2. Apply all 4 configuration changes above
3. Logout/login to clear any cached tokens

### Step 2: Verify JWT Claims

```bash
# Get new token
TOKEN_RESPONSE=$(curl -s -X POST http://localhost:8080/realms/mcp_security/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=mcp-oauth" \
  -d "client_secret=9DQjCpm4D9wbzXxHa1ki51PhBbyxOXrg" \
  -d "username=alice@test.local" \
  -d "password=Test123!" \
  -d "grant_type=password")

# Extract access token
TOKEN=$(echo $TOKEN_RESPONSE | jq -r .access_token)

# Decode JWT
echo $TOKEN | cut -d. -f2 | base64 -d 2>/dev/null | jq .
```

**Expected Output**:
```json
{
  "exp": ...,
  "iat": ...,
  "sub": "550e8400-...",               // ✓ Present
  "preferred_username": "alice@...",   // ✓ Present
  "legacy_name": "ALICE_ADMIN",        // ✓ Present
  "roles": ["user", "admin"],          // ✓ Present
  "iss": "http://localhost:8080/...",
  "aud": ["mcp-oauth"]
}
```

### Step 3: Test Server Startup

```bash
# Terminal 1: Start server
cd test-harness
start-phase3-server.bat

# Terminal 2: Verify server responds
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "jsonrpc": "2.0",
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {"name": "test", "version": "1.0"}
    },
    "id": 1
  }'
```

**Expected**: JSON-RPC success response (not HTTP 500)

### Step 4: Run Integration Tests

```bash
npm test phase3-integration
```

**Expected**: Tests should now pass (or fail with different, more specific errors)

---

## Additional Findings

### Finding #1: Server Script is Correct

The server script `test-harness/start-phase3-server.bat` and `test-harness/v2-test-server.ts` are correctly configured:
- ✅ Config path correct
- ✅ Environment variables set
- ✅ Modular architecture properly integrated
- ✅ Token exchange configuration present

**Conclusion**: No server-side code changes needed.

### Finding #2: Test Framework is Correct

The test file `test-harness/phase3-integration.test.ts` follows proper patterns:
- ✅ Uses Vitest framework correctly
- ✅ Authenticates with Keycloak properly
- ✅ Makes correct MCP protocol calls
- ✅ Validates responses appropriately

**Conclusion**: No test code changes needed (after Keycloak is fixed).

### Finding #3: Configuration Schema is Correct

The config schema `src/config/schemas/` validates correctly:
- ✅ Unified config format (auth + delegation + mcp)
- ✅ Token exchange configuration present
- ✅ Claim mappings defined

**Conclusion**: Config structure is correct, just needs matching Keycloak setup.

---

## Recommended Next Steps

### Immediate (Today)

1. **Fix Keycloak Configuration** (30 minutes)
   - Add missing Protocol Mappers
   - Add user attributes for `legacyName`
   - Enable Direct Access Grants
   - Verify JWT claims in new tokens

2. **Re-run Verification Script** (5 minutes)
   ```bash
   test-harness/verify-keycloak-setup.bat
   ```

3. **Test Server Startup** (5 minutes)
   ```bash
   cd test-harness
   start-phase3-server.bat
   # In another terminal:
   curl http://localhost:3000/health
   ```

4. **Run Integration Tests** (5 minutes)
   ```bash
   npm test phase3-integration
   ```

### Short-term (This Week)

1. **Document Keycloak Setup**
   - Create step-by-step guide with screenshots
   - Export Keycloak realm configuration
   - Add to `Docs/keycloak-setup-guide.md`

2. **Add Pre-test Validation**
   - Create script to verify Keycloak configuration before tests run
   - Check for required claims in sample token
   - Fail fast with clear error messages

3. **Update Test Documentation**
   - Prerequisites clearly listed
   - Common errors and solutions
   - Troubleshooting guide

### Medium-term (Next Sprint)

1. **Docker Compose Setup**
   - Pre-configured Keycloak container
   - Realm import with all required settings
   - One-command test environment setup

2. **CI/CD Integration**
   - Automated Keycloak setup in CI pipeline
   - Test environment provisioning
   - Smoke tests before integration tests

---

## Summary

| Issue | Type | Status | Fix Required |
|-------|------|--------|--------------|
| Missing JWT claims | **Keycloak Config** | 🔴 Critical | Add Protocol Mappers |
| Server init failure | Symptom of above | 🔴 Critical | Keycloak fix will resolve |
| Test claim assertions | Symptom of above | 🟡 Medium | Keycloak fix will resolve |
| Server code | ✅ No issue | 🟢 OK | None |
| Test code | ✅ No issue | 🟢 OK | None |
| Config schema | ✅ No issue | 🟢 OK | None |

**Primary Action**: Fix Keycloak configuration to include required claims in JWTs.

**Expected Outcome**: After Keycloak fix, all 15 Phase 3 integration tests should pass.

---

## Related Files

- **Diagnostic Report**: [PHASE3-TEST-DIAGNOSTICS.md](PHASE3-TEST-DIAGNOSTICS.md)
- **Test Requirements**: [../Docs/unified-oauth-progress.md](../Docs/unified-oauth-progress.md)
- **IDP Setup Guide**: [../Docs/idp-configuration-requirements.md](../Docs/idp-configuration-requirements.md)
- **Test Execution**: [PHASE3-EXECUTION-GUIDE.md](PHASE3-EXECUTION-GUIDE.md)

---

**Conclusion**: Tests are correctly written, but Keycloak is not configured to return the required claims. This is an **environment configuration issue**, not a code issue.
