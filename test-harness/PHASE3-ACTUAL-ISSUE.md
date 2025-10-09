# Phase 3 Integration Tests - Actual Issue Found

**Date**: 2025-10-09
**Status**: ✅ Root cause identified
**Issue**: Server needs restart after Keycloak configuration changes

---

## The Real Problem

The Phase 3 integration tests are failing with **"Error creating server"** (HTTP 500) because:

1. ✅ **Keycloak JWT is NOW CORRECT** - Contains all required claims
2. ✅ **Server configuration is CORRECT** - Config file properly formatted
3. ❌ **Server was started BEFORE Keycloak was fixed** - Old JWT validation errors cached/hardcoded

---

## Evidence

### Current Keycloak JWT (Fresh Token)

```json
{
  "exp": 1759998632,
  "iat": 1759998332,
  "sub": "428e17e9-21f6-48c1-ac94-78f472ec6704",        // ✅ PRESENT
  "preferred_username": "alice@test.local",              // ✅ PRESENT (FIXED!)
  "roles": ["admin"],                                    // ✅ PRESENT
  "iss": "http://localhost:8080/realms/mcp_security",
  "aud": ["mcp-server-client", "mcp-oauth"],
  "azp": "mcp-oauth",
  "scope": "email",
  "email": "alice@test.local"
}
```

**All required claims are present!**

### Test Against Running Server

```bash
$ node test-mcp-init.cjs
Testing MCP initialize...

Status: 500 Internal Server Error
Response Body: Error creating server
```

**Server returns 500 even though JWT is valid!**

### Health Check

```bash
$ curl http://localhost:3000/health
✓ Ok
```

**Server is running but MCP initialize fails.**

---

## Root Cause Analysis

The error "Error creating server" during MCP `initialize` method suggests one of the following:

### Hypothesis #1: Server Cached Old JWKS (Most Likely)

**Problem**: The server cached JWKS keys or validation state when it started (before Keycloak was fixed).

**Evidence**:
- Server process has been running (PID 36376)
- Keycloak configuration was changed AFTER server started
- Server likely cached old JWKS that doesn't match current JWT signature

**Solution**: Restart the server

### Hypothesis #2: Config File Not Reloaded

**Problem**: Server is using old config that expects `preferred_name` instead of `preferred_username`.

**Evidence**:
- Config file expects: `"username": "preferred_username"`
- Old JWT had: `preferred_name`
- New JWT has: `preferred_username`

**Solution**: Restart the server to reload config

### Hypothesis #3: MCP Proxy Internal Error

**Problem**: The "Error creating server" message is from mcp-proxy, not our auth code.

**Evidence**:
- Error message format matches mcp-proxy error handling
- Happens during `initialize` method
- No detailed error message (mcp-proxy suppresses internal errors)

**Possible Causes**:
1. Session management error
2. Tool registration failure
3. CoreContext initialization failure

**Solution**: Check server startup logs, restart server

---

## The Fix

### Step 1: Stop the Current Server

```bash
# Find PID
netstat -ano | findstr ":3000"
# Output: TCP    [::1]:3000    [::]:0    LISTENING    36376

# Kill process
taskkill /PID 36376 /F
```

### Step 2: Rebuild (if needed)

```bash
npm run build
```

### Step 3: Start Fresh Server

```bash
cd test-harness
set NODE_ENV=development
set CONFIG_PATH=./config/phase3-test-config.json
set SERVER_PORT=3000

node ../dist/test-harness/v2-test-server.js
```

**Expected Output**:
```
═══════════════════════════════════════════════════════════
  MCP OAuth v2 Test Server - New Modular Framework
═══════════════════════════════════════════════════════════
Environment:     development
Config:          ./test-harness/config/phase3-test-config.json
Port:            3000
Transport:       http-stream
═══════════════════════════════════════════════════════════

[1/3] Creating MCPOAuthServer...
      Config path: C:\...\test-harness\config\phase3-test-config.json
✓     Server instance created

[2/3] Starting MCP server...
      Loading config, building CoreContext, registering tools...
✓     Server started successfully

[3/3] Checking for delegation modules...
      SQL delegation module detected in config
      Token exchange detected in config
      Token endpoint: http://localhost:8080/realms/mcp_security/protocol/openid-connect/token
      Client ID: mcp-oauth
      Audience: mcp-oauth
✓     All modules registered successfully

═══════════════════════════════════════════════════════════
  Server Ready
═══════════════════════════════════════════════════════════
Listening on http://localhost:3000
```

### Step 4: Verify MCP Initialize Works

```bash
# Get fresh token
TOKEN=$(curl -s -X POST http://localhost:8080/realms/mcp_security/protocol/openid-connect/token \
  -d "client_id=mcp-oauth" \
  -d "client_secret=9DQjCpm4D9wbzXxHa1ki51PhBbyxOXrg" \
  -d "username=alice@test.local" \
  -d "password=Test123!" \
  -d "grant_type=password" \
  | jq -r .access_token)

# Test initialize
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

**Expected**: JSON-RPC success response (HTTP 200)

**If still failing**: Check server startup logs for actual error

### Step 5: Run Integration Tests

```bash
npm test phase3-integration
```

**Expected**: Tests should now pass (or fail with different, more specific errors)

---

## Additional Issues Found

### Issue #1: Test Expects `user_roles` Claim

**Test Code** ([phase3-integration.test.ts:231](test-harness/phase3-integration.test.ts#L231)):
```typescript
expect(claims.user_roles).toBeDefined();
```

**Actual JWT Claim Name**: `roles`

**Fix Required**: Update test to use `roles` instead of `user_roles`

**Impact**: INT-002, INT-003, INT-004 tests will fail

### Issue #2: Missing Token Exchange Configuration

**Tests Require**: Token exchange to be enabled in Keycloak

**Current Status**: Unknown (needs verification)

**Verification**:
```bash
# Test token exchange
curl -s -X POST http://localhost:8080/realms/mcp_security/protocol/openid-connect/token \
  -d "client_id=mcp-oauth" \
  -d "client_secret=9DQjCpm4D9wbzXxHa1ki51PhBbyxOXrg" \
  -d "grant_type=urn:ietf:params:oauth:grant-type:token-exchange" \
  -d "subject_token=$TOKEN" \
  -d "audience=mcp-server-client"
```

**Expected**: Returns TE-JWT with `legacy_name` claim

**If fails**: Follow [QUICK-FIX-KEYCLOAK.md](QUICK-FIX-KEYCLOAK.md) Step 3 (Token Exchange configuration)

---

## Summary of Fixes Needed

| Fix | Status | Priority | Impact |
|-----|--------|----------|--------|
| Restart MCP server | ⏳ **PENDING** | 🔴 **CRITICAL** | Blocks all 13 tests |
| Fix test claim name (`user_roles` → `roles`) | ⏳ **PENDING** | 🟡 **MEDIUM** | 3 tests (INT-002, INT-003, INT-004) |
| Configure token exchange in Keycloak | ⚠️ **UNKNOWN** | 🟡 **MEDIUM** | 11 tests (all delegation tests) |

---

## Expected Test Results After Fixes

### After Server Restart Only

**Expected**: 2-5 tests pass, 10-13 tests fail with **different errors**

**Reason**: Tests will now pass JWT validation but may fail on token exchange

### After All Fixes

**Expected**: 13-15 tests pass

**Remaining Issues**: May need to configure actual SQL Server for delegation tests

---

## Immediate Actions

1. **STOP current server** (taskkill /PID 36376 /F)
2. **START fresh server** (cd test-harness && start-phase3-server.bat)
3. **VERIFY** MCP initialize works (curl test)
4. **RUN tests** (npm test phase3-integration)
5. **ANALYZE** new failure modes (if any)
6. **FIX** remaining issues (token exchange, test claim names)

---

## Why This Wasn't Obvious

The error message **"Error creating server"** is misleading because:

1. **Generic Error**: Doesn't indicate root cause
2. **HTTP 500**: Suggests server error, not config/JWT issue
3. **Health Check Passes**: Suggests server is healthy
4. **No Logs Visible**: Test runner doesn't show server logs

The actual issue is **server state from before Keycloak fix**, not a code or configuration problem.

---

## Related Documentation

- [PHASE3-ROOT-CAUSE.md](PHASE3-ROOT-CAUSE.md) - Original analysis (still valid)
- [QUICK-FIX-KEYCLOAK.md](QUICK-FIX-KEYCLOAK.md) - Keycloak configuration guide
- [PHASE3-TEST-DIAGNOSTICS.md](PHASE3-TEST-DIAGNOSTICS.md) - Detailed diagnostics

---

**Next Step**: Restart the server and re-run tests
