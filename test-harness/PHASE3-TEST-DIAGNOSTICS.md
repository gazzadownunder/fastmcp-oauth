# Phase 3 Integration Test Diagnostics

**Date**: 2025-10-09
**Test Run**: `npm test phase3-integration`
**Result**: 13/15 tests failed
**Primary Issue**: Server initialization failure

---

## Test Results Summary

| Status | Count | Details |
|--------|-------|---------|
| ❌ Failed | 13 | 11 server init errors, 2 config issues |
| ✅ Passed | 2 | INT-010 (hot-reload), Error handling (missing legacy_name) |
| **Total** | **15** | |

---

## Root Cause Analysis

### Issue #1: Server Initialization Failure (CRITICAL)

**Error Message**: `"MCP initialize failed: Internal Server Error - Error creating server"`

**Affected Tests**: 11 out of 13 failures

**Symptoms**:
- Tests attempt to POST to `http://localhost:3000/mcp` with `initialize` method
- Server returns HTTP 500 Internal Server Error
- No server appears to be running on port 3000

**Root Cause**:
The tests expect a **running MCP server** but:
1. No server is started before tests run
2. The test file doesn't include `beforeAll` hook to start server
3. The test assumes manual server startup via `start-phase3-server.bat`

**Evidence**:
```typescript
// test-harness/phase3-integration.test.ts:85-111
async function initializeMCPSession(bearerToken: string): Promise<string> {
  const response = await fetch(`${MCP_SERVER_URL}/mcp`, {  // ← Expects running server
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${bearerToken}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'initialize',  // ← MCP protocol initialization
      ...
    }),
  });
```

**Configuration Check**:
- ✅ Config file exists: `test-harness/config/phase3-test-config.json`
- ✅ Config structure matches v2.0 schema (auth, delegation, mcp sections)
- ✅ Token exchange configuration present
- ✅ Environment variables default to correct values

**Server Script Check**:
- ✅ Server script exists: `test-harness/start-phase3-server.bat`
- ⚠️ Server script uses `node ..\dist\test-harness\v2-test-server.js`
- ⚠️ Server script expects `CONFIG_PATH=./config/phase3-test-config.json` (relative to test-harness/)

---

### Issue #2: Missing JWT Claims (MEDIUM)

**Error Message**: `expected undefined to be defined` (claims.user_roles)

**Affected Tests**: INT-002 (Two-Stage Authorization)

**Symptoms**:
```typescript
// Test expects:
expect(claims.user_roles).toBeDefined();

// But claims.user_roles is undefined
```

**Root Cause**:
The JWT claim mapping in the config expects `"roles": "roles"`, but Keycloak may be returning roles in a different claim:
- Keycloak standard: `realm_access.roles` or `resource_access.<client>.roles`
- Config expects: `roles` (flat claim)

**Evidence from Config**:
```json
"claimMappings": {
  "legacyUsername": "legacy_name",
  "roles": "roles",  // ← Expects flat "roles" claim
  "scopes": "scope",
  "userId": "sub",
  "username": "preferred_username"
}
```

**Keycloak Actual Structure** (typical):
```json
{
  "realm_access": {
    "roles": ["user", "admin"]
  },
  "resource_access": {
    "mcp-oauth": {
      "roles": ["mcp-oauth-read", "mcp-oauth-write"]
    }
  }
}
```

---

### Issue #3: Type Assertion Errors (LOW)

**Error Messages**:
- `the given combination of arguments (undefined and string) is invalid for this assertion`

**Affected Tests**: INT-003, INT-004

**Root Cause**:
Tests use `.toContain()` on undefined arrays:
```typescript
expect(mcpClaims.roles).toContain('user');  // ← roles is undefined
```

This is a **downstream effect** of Issue #2 (missing claims).

---

## Recommended Fixes

### Fix #1: Add Server Lifecycle Management to Tests

**Option A: Manual Server Start (Current Approach)**
Document that users must:
1. Build the project: `npm run build`
2. Start server: `cd test-harness && start-phase3-server.bat`
3. Run tests: `npm test phase3-integration`

**Option B: Automated Server Management (Recommended)**
Add `beforeAll` and `afterAll` hooks to manage server lifecycle:

```typescript
// test-harness/phase3-integration.test.ts
import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';

let serverProcess: ChildProcess | null = null;

beforeAll(async () => {
  console.log('Starting MCP server for integration tests...');

  // Start server in background
  serverProcess = spawn('node', ['dist/test-harness/v2-test-server.js'], {
    env: {
      ...process.env,
      NODE_ENV: 'development',
      CONFIG_PATH: './test-harness/config/phase3-test-config.json',
      SERVER_PORT: '3000'
    },
    stdio: 'pipe'
  });

  // Wait for server to be ready
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Verify server is responding
  const response = await fetch('http://localhost:3000/health');
  if (!response.ok) {
    throw new Error('Server failed to start');
  }

  console.log('✓ Server started successfully');
});

afterAll(async () => {
  if (serverProcess) {
    console.log('Stopping MCP server...');
    serverProcess.kill();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    console.log('✓ Server stopped');
  }
});
```

**Trade-offs**:
- Option A: Simple, requires manual steps
- Option B: Automated, but adds test complexity

---

### Fix #2: Correct Keycloak Claim Mappings

**Update config** to match actual Keycloak token structure:

```json
"claimMappings": {
  "legacyUsername": "legacy_name",
  "roles": "realm_access.roles",  // ← Fix: nested path
  "scopes": "scope",
  "userId": "sub",
  "username": "preferred_username"
}
```

**Alternative**: Configure Keycloak to include flat `roles` claim via Protocol Mapper:
1. Go to Keycloak Admin Console
2. Client: `mcp-oauth` → Client Scopes → Dedicated scope
3. Add Mapper: "User Realm Role" → Token Claim Name: `roles` → Claim JSON Type: `JSON`

---

### Fix #3: Verify Keycloak Configuration

**Required Keycloak Setup**:

1. **Realm**: `mcp_security` exists
2. **Client**: `mcp-oauth` configured with:
   - Client ID: `mcp-oauth`
   - Client Secret: `9DQjCpm4D9wbzXxHa1ki51PhBbyxOXrg`
   - Valid Redirect URIs: `*` (for testing)
   - Direct Access Grants: Enabled (allows password grant for tests)
3. **Test Users** created:
   - `alice@test.local` (password: `Test123!`)
   - `bob@test.local` (password: `Test123!`)
   - `charlie@test.local` (password: `Test123!`)
   - `dave@test.local` (password: `Test123!`)
4. **Custom Claims** via Protocol Mappers:
   - `legacy_name` claim (hardcoded or from user attribute)
   - Flat `roles` claim (if not fixing config)
5. **Token Exchange** enabled (Keycloak 22+ feature)

**Verification Script**: Run `test-harness/verify-keycloak-setup.bat` to check configuration

---

## Immediate Action Plan

### Phase 1: Verify Environment (15 minutes)

1. **Check if Keycloak is running**:
   ```bash
   curl http://localhost:8080/realms/mcp_security/.well-known/openid-configuration
   ```
   Expected: JSON response with realm metadata

2. **Verify test user can authenticate**:
   ```bash
   curl -X POST http://localhost:8080/realms/mcp_security/protocol/openid-connect/token \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "client_id=mcp-oauth" \
     -d "client_secret=9DQjCpm4D9wbzXxHa1ki51PhBbyxOXrg" \
     -d "username=alice@test.local" \
     -d "password=Test123!" \
     -d "grant_type=password"
   ```
   Expected: JSON with `access_token` field

3. **Decode token to check claims**:
   ```bash
   # Paste token at https://jwt.io
   ```
   Verify:
   - `iss` contains `mcp_security`
   - `aud` contains `mcp-oauth`
   - `roles` or `realm_access.roles` present
   - `legacy_name` present

### Phase 2: Fix Configuration (10 minutes)

1. **Update claim mappings** if roles claim is nested:
   ```bash
   # Edit test-harness/config/phase3-test-config.json
   # Change "roles": "roles" to "roles": "realm_access.roles"
   ```

2. **Verify config loads without errors**:
   ```bash
   npm run build
   node -e "import('./dist/config/manager.js').then(m => { const cm = new m.ConfigManager(); cm.loadConfig('./test-harness/config/phase3-test-config.json'); console.log('✓ Config valid'); })"
   ```

### Phase 3: Test Server Startup (10 minutes)

1. **Start server manually**:
   ```bash
   cd test-harness
   start-phase3-server.bat
   ```

2. **Verify server responds**:
   ```bash
   curl http://localhost:3000/health
   ```
   Expected: Health check response

3. **Test authentication**:
   ```bash
   # Get token
   TOKEN=$(curl -s -X POST http://localhost:8080/realms/mcp_security/protocol/openid-connect/token \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "client_id=mcp-oauth" \
     -d "client_secret=9DQjCpm4D9wbzXxHa1ki51PhBbyxOXrg" \
     -d "username=alice@test.local" \
     -d "password=Test123!" \
     -d "grant_type=password" | jq -r .access_token)

   # Test MCP initialize
   curl -X POST http://localhost:3000/mcp \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $TOKEN" \
     -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":1}'
   ```
   Expected: JSON-RPC success response

### Phase 4: Run Tests (5 minutes)

```bash
npm test phase3-integration
```

Expected: Tests should now pass (or fail with more specific errors)

---

## Test Expectations vs Reality

### What Tests Expect:

1. ✅ Keycloak running on `http://localhost:8080`
2. ✅ Realm `mcp_security` configured
3. ✅ Client `mcp-oauth` with correct credentials
4. ⚠️ **MCP server running on `http://localhost:3000`** (MISSING)
5. ⚠️ Flat `roles` claim in JWT (MAY BE MISSING)
6. ✅ Test users with passwords
7. ⚠️ Token exchange enabled in Keycloak (NEEDS VERIFICATION)

### Current Reality:

1. ✅ Config file structure is correct
2. ✅ Server code exists and compiles
3. ❌ Server not started before tests run
4. ⚠️ Keycloak claim structure may not match expectations
5. ⚠️ Token exchange may not be enabled in Keycloak

---

## Next Steps

1. **Immediate**: Run Phase 1-3 of action plan to diagnose environment
2. **Short-term**: Decide on server lifecycle approach (manual vs automated)
3. **Medium-term**: Update test documentation with prerequisites
4. **Long-term**: Consider containerized test environment (Docker Compose)

---

## Related Documentation

- [Unified OAuth Progress](../Docs/unified-oauth-progress.md) - Phase 3 requirements
- [Refactor Progress](../Docs/refactor-progress.md) - Base functionality
- [IDP Configuration Requirements](../Docs/idp-configuration-requirements.md) - Keycloak setup
- [Phase 3 Execution Guide](./PHASE3-EXECUTION-GUIDE.md) - Test execution steps

---

**Status**: Diagnostics complete - Action plan ready for execution
