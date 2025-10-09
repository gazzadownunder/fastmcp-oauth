# Quick Fix: Keycloak Configuration for Phase 3 Tests

**Time Required**: 15-30 minutes
**Difficulty**: Easy (UI-based configuration)
**Impact**: Fixes 13/13 Phase 3 test failures

---

## Prerequisites

- ✅ Keycloak running on http://localhost:8080
- ✅ Realm `mcp_security` exists
- ✅ Client `mcp-oauth` exists with secret `9DQjCpm4D9wbzXxHa1ki51PhBbyxOXrg`
- ✅ Test users created: `alice@test.local`, `bob@test.local`, `charlie@test.local`, `dave@test.local`
- ✅ Admin access to Keycloak Admin Console

---

## Step 1: Enable Standard User Claims (5 minutes)

### 1.1 Navigate to Client Scopes

1. Go to Keycloak Admin Console: http://localhost:8080
2. Login with admin credentials
3. Select Realm: **mcp_security**
4. Navigate to: **Clients** → **mcp-oauth**
5. Click **Client scopes** tab
6. Click on **mcp-oauth-dedicated** (or the dedicated scope for this client)

### 1.2 Enable Built-in Mappers

In the **Mappers** tab, ensure these mappers are enabled:

| Mapper Name | Token Claim Name | Status |
|-------------|------------------|--------|
| username | `preferred_username` | ✅ Should exist |
| client roles | (various) | ✅ Should exist |

If missing, add them:

**Add username mapper**:
- Click **Add mapper** → **By configuration** → **User Property**
- **Name**: `username`
- **Property**: `username`
- **Token Claim Name**: `preferred_username`
- **Claim JSON Type**: `String`
- **Add to ID token**: ✅
- **Add to access token**: ✅
- **Add to userinfo**: ✅
- Click **Save**

---

## Step 2: Add Flat Roles Claim (5 minutes)

Currently, roles are nested in `realm_access.roles`. Tests expect flat `roles` array.

### 2.1 Add Realm Roles Mapper

1. In **mcp-oauth-dedicated** scope → **Mappers** tab
2. Click **Add mapper** → **By configuration** → **User Realm Role**
3. Configure:
   - **Name**: `flat-realm-roles`
   - **Token Claim Name**: `roles`
   - **Claim JSON Type**: `JSON` (this creates an array)
   - **Add to ID token**: ✅
   - **Add to access token**: ✅
   - **Add to userinfo**: ❌ (not needed)
4. Click **Save**

**Expected JWT result**:
```json
{
  "roles": ["user", "admin", "offline_access", "uma_authorization"],
  ...
}
```

---

## Step 3: Configure Token Exchange for `legacy_name` Claim (10 minutes)

**IMPORTANT**: The `legacy_name` claim should **ONLY** appear in the **TE-JWT** (Token Exchange JWT), not in the initial requestor JWT. This is a key part of the two-stage authorization model.

### 3.1 Enable Token Exchange (Keycloak 22+)

Token Exchange must be enabled at the realm level and configured between clients.

1. Navigate to: **Realm Settings** → **Security defenses**
2. Scroll to **Token Exchange** section (Keycloak 22+ only)
3. Ensure **Token Exchange enabled**: ✅ (if option exists)

**Note**: In Keycloak 22+, token exchange is enabled by default. In older versions, you may need to enable it via CLI.

### 3.2 Configure Token Exchange Client

The **mcp-server-client** (or dedicated token exchange client) performs token exchange on behalf of users.

1. Navigate to: **Clients** → **mcp-server-client** (create if doesn't exist)
2. **Settings** tab:
   - **Client ID**: `mcp-server-client`
   - **Client authentication**: ON (confidential client)
   - **Service accounts roles**: ON (for token exchange)
3. **Credentials** tab:
   - Note the **Client Secret** (or generate new one)
4. **Service account roles** tab:
   - Assign role: **token-exchange** (realm-management client)

### 3.3 Add Token Exchange Permission

Allow `mcp-oauth` client to exchange tokens for `mcp-server-client`:

1. Navigate to: **Clients** → **mcp-server-client** → **Permissions** tab
2. Enable **Permissions enabled**: ✅
3. Click **token-exchange** permission
4. Add client `mcp-oauth` to allowed clients list

### 3.4 Add User Attribute Mapper (TE-JWT Only)

Configure mapper to include `legacy_name` in **exchanged tokens only**:

1. Navigate to: **Clients** → **mcp-server-client** → **Client scopes** tab
2. Click on **mcp-server-client-dedicated** scope
3. Click **Mappers** tab
4. Click **Add mapper** → **By configuration** → **User Attribute**
5. Configure:
   - **Name**: `legacy-name-mapper`
   - **User Attribute**: `legacyName` (attribute name in user profile)
   - **Token Claim Name**: `legacy_name` (claim name in JWT)
   - **Claim JSON Type**: `String`
   - **Add to ID token**: ❌ (not needed)
   - **Add to access token**: ✅ (TE-JWT is an access token)
   - **Add to userinfo**: ❌
   - **Multivalued**: ❌
6. Click **Save**

**Key Point**: This mapper is on **mcp-server-client** scope, so `legacy_name` only appears in tokens minted for mcp-server-client (i.e., TE-JWT).

### 3.5 Add User Attributes

For each test user, add the `legacyName` attribute:

1. Navigate to: **Users** → Search for user → Click username
2. Click **Attributes** tab
3. Click **Add attribute**
4. Set:
   - **Key**: `legacyName`
   - **Value**: (see table below)
5. Click **Save**

| User | legacyName Value | Purpose |
|------|------------------|---------|
| `alice@test.local` | `ALICE_ADMIN` | Privilege elevation test |
| `bob@test.local` | `BOB_USER` | Privilege reduction test |
| `charlie@test.local` | `CHARLIE_USER` | Same privilege test |
| `dave@test.local` | **(leave empty)** | Missing claim test |

**Expected JWT results**:

**Requestor JWT** (initial login - NO legacy_name):
```json
{
  "sub": "...",
  "preferred_username": "alice@test.local",
  "roles": ["user"],
  // NO legacy_name here!
}
```

**TE-JWT** (after token exchange - HAS legacy_name):
```json
{
  "sub": "...",
  "preferred_username": "alice@test.local",
  "legacy_name": "ALICE_ADMIN",  // ← Only in TE-JWT!
  "roles": ["admin", "sql:write"],
  "act": { "sub": "mcp-server-client" }
}
```

---

## Step 4: Add `sub` Claim (Usually Auto-Included)

The `sub` (subject) claim should be automatically included by Keycloak. If missing:

### 4.1 Verify User ID Mapper

1. In **mcp-oauth-dedicated** scope → **Mappers** tab
2. Look for mapper with **Token Claim Name**: `sub`
3. If missing, add:
   - **Mapper Type**: User Property
   - **Name**: `user-id`
   - **Property**: `id`
   - **Token Claim Name**: `sub`
   - **Claim JSON Type**: `String`
   - **Add to ID token**: ✅
   - **Add to access token**: ✅

---

## Step 5: Enable Direct Access Grants (2 minutes)

Tests use password grant type (direct access).

1. Navigate to: **Clients** → **mcp-oauth**
2. Click **Settings** tab
3. Scroll to **Capability config** section
4. Ensure these are **ON**:
   - ✅ **Direct access grants**
   - ✅ **Standard flow**
   - ✅ **Service accounts roles** (optional, for token exchange)
5. Click **Save**

---

## Step 6: Assign Roles to Test Users (5 minutes)

Ensure each test user has appropriate realm roles:

1. Navigate to: **Users** → Search for user → Click username
2. Click **Role mapping** tab
3. Click **Assign role**
4. Select **Filter by realm roles**
5. Assign roles according to test requirements:

| User | Realm Roles | Client Roles (mcp-oauth) | Purpose |
|------|-------------|-------------------------|---------|
| alice@test.local | `user` | `mcp-oauth-admin` | Admin privileges |
| bob@test.local | `admin` | `mcp-oauth-read` | Read-only |
| charlie@test.local | `user` | `mcp-oauth-read`, `mcp-oauth-write` | Standard user |
| dave@test.local | `guest` | (none) | Unmapped role |

**Note**: Create client roles if they don't exist:
1. Navigate to: **Clients** → **mcp-oauth** → **Roles** tab
2. Click **Create role**
3. Add: `mcp-oauth-admin`, `mcp-oauth-read`, `mcp-oauth-write`

---

## Step 7: Verification (5 minutes)

### 7.1 Get New Token

```bash
curl -X POST http://localhost:8080/realms/mcp_security/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=mcp-oauth" \
  -d "client_secret=9DQjCpm4D9wbzXxHa1ki51PhBbyxOXrg" \
  -d "username=alice@test.local" \
  -d "password=Test123!" \
  -d "grant_type=password" \
  | jq -r .access_token > token.txt
```

### 7.2 Decode and Inspect JWT

```bash
cat token.txt | cut -d. -f2 | base64 -d 2>/dev/null | jq .
```

### 7.3 Verify Required Claims

**Expected output** for **Requestor JWT** (alice@test.local):
```json
{
  "exp": 1759995000,
  "iat": 1759994700,
  "jti": "...",
  "iss": "http://localhost:8080/realms/mcp_security",
  "aud": ["mcp-oauth"],
  "sub": "550e8400-e29b-41d4-a716-446655440000",   // ✅ PRESENT
  "typ": "Bearer",
  "azp": "mcp-oauth",
  "sid": "...",
  "preferred_username": "alice@test.local",        // ✅ PRESENT
  "roles": ["user", "offline_access", "uma_authorization"], // ✅ PRESENT
  "scope": ""
  // ❌ NO legacy_name - this is correct for requestor JWT!
}
```

**Requestor JWT Checklist**:
- ✅ `sub` present (user ID)
- ✅ `preferred_username` present (username)
- ✅ `roles` present as array (realm roles)
- ❌ `legacy_name` **should NOT be present** (only in TE-JWT)

### 7.4 Test Token Exchange (Verify TE-JWT)

To verify `legacy_name` appears in TE-JWT, perform token exchange:

```bash
REQUESTOR_TOKEN=$(cat token.txt)

# Perform token exchange
TE_RESPONSE=$(curl -s -X POST http://localhost:8080/realms/mcp_security/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=mcp-oauth" \
  -d "client_secret=9DQjCpm4D9wbzXxHa1ki51PhBbyxOXrg" \
  -d "grant_type=urn:ietf:params:oauth:grant-type:token-exchange" \
  -d "subject_token=$REQUESTOR_TOKEN" \
  -d "subject_token_type=urn:ietf:params:oauth:token-type:access_token" \
  -d "requested_token_type=urn:ietf:params:oauth:token-type:access_token" \
  -d "audience=mcp-server-client")

# Extract and decode TE-JWT
echo $TE_RESPONSE | jq -r .access_token | cut -d. -f2 | base64 -d 2>/dev/null | jq .
```

**Expected TE-JWT output**:
```json
{
  "exp": 1759995000,
  "iat": 1759994700,
  "sub": "550e8400-e29b-41d4-a716-446655440000",
  "preferred_username": "alice@test.local",
  "legacy_name": "ALICE_ADMIN",                    // ✅ NOW PRESENT
  "roles": ["admin", "sql:write"],                 // ✅ May differ from requestor
  "aud": ["mcp-server-client"],                    // ✅ Different audience
  "act": {                                         // ✅ Actor claim
    "sub": "mcp-oauth"
  }
}
```

**TE-JWT Checklist**:
- ✅ `legacy_name` **is present** (added during token exchange)
- ✅ `aud` includes target audience (mcp-server-client)
- ✅ `act` claim present (indicates on-behalf-of delegation)
- ✅ `roles` may differ from requestor JWT (privilege elevation/reduction)

If all checks pass, proceed to Step 8.

---

## Step 8: Test Server Authentication (5 minutes)

### 8.1 Build Project

```bash
npm run build
```

### 8.2 Start Test Server

```bash
cd test-harness
start-phase3-server.bat
```

**Expected output**:
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
✓     All modules registered successfully

═══════════════════════════════════════════════════════════
  Server Ready
═══════════════════════════════════════════════════════════
```

### 8.3 Test MCP Initialize (in new terminal)

```bash
TOKEN=$(cat token.txt)

curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "jsonrpc": "2.0",
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {"name": "test-client", "version": "1.0"}
    },
    "id": 1
  }'
```

**Expected response** (HTTP 200):
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2024-11-05",
    "capabilities": { ... },
    "serverInfo": {
      "name": "MCP OAuth Phase 3 Test Server (Cache Enabled)",
      "version": "3.0.0"
    }
  }
}
```

**If you get HTTP 500**: Check server logs for authentication errors. Claims may still be missing.

---

## Step 9: Run Integration Tests (2 minutes)

```bash
# Stop server (Ctrl+C in server terminal)

# Run tests (tests will fail if server is running - they expect to start it)
npm test phase3-integration
```

**Expected output**:
```
✓ test-harness/phase3-integration.test.ts (15) 45s
  ✓ Phase 3: Integration Tests (15)
    ✓ INT-001: Full End-to-End Flow (2)
      ✓ should complete full flow: Request → JWT validation → Tool dispatch → Token exchange → SQL delegation
      ✓ should perform token exchange and SQL delegation
    ✓ INT-002: Two-Stage Authorization (2)
      ✓ should validate requestor JWT for MCP access
      ✓ should use TE-JWT for downstream resource access
    ... (11 more tests)

Test Files  1 passed (1)
     Tests  15 passed (15)
```

---

## Troubleshooting

### Issue: `sub` claim still missing

**Solution**: Check if User ID mapper exists in **Mappers** → Look for `sub` token claim name.

### Issue: `roles` is nested `realm_access.roles`

**Solution**: Ensure you created the **User Realm Role** mapper with **Token Claim Name** = `roles` (not `realm_access.roles`).

**Alternative**: Update config to use nested path:
```json
"claimMappings": {
  "roles": "realm_access.roles"  // ← Change this in phase3-test-config.json
}
```

### Issue: `legacy_name` claim missing

**Solution**:
1. Verify mapper exists: **Mappers** → Check for `legacy-name-mapper`
2. Verify user attribute exists: **Users** → alice → **Attributes** → Check `legacyName` = `ALICE_ADMIN`
3. Get fresh token (old tokens don't update)

### Issue: Server still returns HTTP 500

**Symptom**: Server logs show:
```
Error: Cannot create session: missing required claim 'sub'
```

**Solution**: All claims must be present. Go back to verification step and decode JWT to check.

---

## Alternative: Hardcoded Claims (For Quick Testing)

If you want to test quickly without setting up user attributes, use hardcoded claims:

### Hardcoded legacy_name Mapper

1. **Mappers** → **Add mapper** → **Hardcoded claim**
2. Configure:
   - **Name**: `hardcoded-legacy-name`
   - **Token Claim Name**: `legacy_name`
   - **Claim value**: `TEST_USER`
   - **Claim JSON Type**: `String`
   - **Add to access token**: ✅

**Note**: This gives all users the same legacy name. Not suitable for privilege elevation tests.

---

## Success Criteria

✅ JWT includes all required claims:
- `sub` (user ID)
- `preferred_username` (username)
- `legacy_name` (custom claim)
- `roles` (flat array of roles)

✅ Server starts successfully (no HTTP 500 errors)

✅ MCP initialize call succeeds (HTTP 200 response)

✅ Phase 3 integration tests pass (15/15 tests)

---

## Next Steps

After Keycloak is configured and tests pass:

1. **Export Realm Configuration**:
   - Keycloak → Realm Settings → Action → Partial export
   - Export: Clients, Users, Roles
   - Save to: `test-harness/config/keycloak-realm-export.json`

2. **Document Custom Setup**:
   - Create screenshots of mapper configuration
   - Add to `Docs/keycloak-setup-guide.md`

3. **Consider Docker Compose**:
   - Pre-configured Keycloak container
   - Import realm on startup
   - One-command test environment

---

## Related Documentation

- **Root Cause Analysis**: [PHASE3-ROOT-CAUSE.md](PHASE3-ROOT-CAUSE.md)
- **Detailed Diagnostics**: [PHASE3-TEST-DIAGNOSTICS.md](PHASE3-TEST-DIAGNOSTICS.md)
- **Test Requirements**: [../Docs/unified-oauth-progress.md](../Docs/unified-oauth-progress.md)

---

**Estimated Time**: 15-30 minutes (first time), 5 minutes (subsequent setups with export/import)

**Difficulty**: ⭐⭐⚪⚪⚪ (Easy - UI-based, no coding)

**Impact**: 🎯 Fixes all Phase 3 test failures
