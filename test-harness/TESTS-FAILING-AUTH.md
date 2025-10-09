# Phase 3 Tests Failing - Authentication Issue

**Status:** Tests running but failing on authentication
**Error:** `Failed to get access token: Unauthorized`
**Date:** 2025-10-09

---

## Current Situation ✅

**Good news - Tests are now running!**

```
✓ test-harness/phase3-integration.test.ts
  Phase 3: Integration Tests (15 tests)
    ❌ Failed on authentication
```

This is **expected** - the test infrastructure is working, but Keycloak authentication needs to be configured.

---

## The Error

```
Error: Failed to get access token: Unauthorized
 ❯ getAccessToken test-harness/phase3-integration.test.ts:63:11
```

**What this means:**
The tests are trying to authenticate with Keycloak using:
- Client: `mcp-oauth`
- Secret: `JUUA5xCJDQZdreWgEFYvfAqjJnGdTXXA`
- User: `alice@test.local`
- Password: `Test123!`

But Keycloak is rejecting the credentials.

---

## Diagnostic Steps

### Step 1: Test Keycloak Authentication

Run the diagnostic script:

```batch
cd test-harness
test-keycloak-auth.bat
```

This will show you exactly what Keycloak is responding with.

**Look for these responses:**

#### Success (What you want to see):
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 300
}
```

#### Invalid Client (Wrong secret):
```json
{
  "error": "unauthorized_client",
  "error_description": "Invalid client or Invalid client credentials"
}
```

**Fix:** Get correct secret from Keycloak Admin → Clients → mcp-oauth → Credentials

#### Invalid Grant (User/password wrong):
```json
{
  "error": "invalid_grant",
  "error_description": "Invalid user credentials"
}
```

**Fix:** Verify user exists and password is correct

---

## Common Issues and Fixes

### Issue 1: Wrong Client Secret

**Symptom:** `unauthorized_client` or `Invalid client credentials`

**Fix:**
1. Open Keycloak Admin Console: http://localhost:8080/admin
2. Go to: **Clients** → **mcp-oauth**
3. Click **Credentials** tab
4. Copy the **Client Secret**
5. Update in **TWO places**:
   - `test-harness/config/phase3-test-config.json` (line 56)
   - `test-harness/phase3-integration.test.ts` (line 38)

### Issue 2: Direct Access Grants Not Enabled

**Symptom:** `unauthorized_client` or `Grant type not enabled`

**Fix:**
1. Keycloak Admin → **Clients** → **mcp-oauth**
2. **Settings** tab
3. Find: **Direct Access Grants Enabled**
4. Turn **ON**
5. Click **Save**

**Why needed:** Tests use password grant type (for automation), which requires this setting.

### Issue 3: User Doesn't Exist

**Symptom:** `invalid_grant` or `Invalid user credentials`

**Fix:**
1. Keycloak Admin → **Users** → View all users
2. Search for: `alice@test.local`
3. If not found, create user:
   - Username: `alice@test.local`
   - Email: `alice@test.local`
   - Email verified: Yes

### Issue 4: Wrong Password

**Symptom:** `invalid_grant` or `Invalid user credentials`

**Fix:**
1. Keycloak Admin → **Users** → Select `alice@test.local`
2. **Credentials** tab
3. Click **Set password**
4. Password: `Test123!`
5. **Temporary:** No (important!)
6. Click **Save**

### Issue 5: User Disabled or Locked

**Symptom:** `invalid_grant` or `Account disabled`

**Fix:**
1. Keycloak Admin → **Users** → Select user
2. **Details** tab
3. **Enabled:** Yes
4. **Email verified:** Yes
5. Click **Save**

---

## Quick Fix Checklist

Use this checklist to fix authentication:

- [ ] **Keycloak is running** - `curl http://localhost:8080` works
- [ ] **Realm exists** - `mcp_security` realm is configured
- [ ] **Client exists** - `mcp-oauth` client is configured
- [ ] **Client secret correct** - Get from Keycloak and update in config
- [ ] **Direct Access Grants ON** - Required for password grant
- [ ] **User exists** - `alice@test.local` user is created
- [ ] **Password set** - `Test123!` and NOT temporary
- [ ] **User enabled** - User account is active

---

## Testing Authentication Manually

### Option 1: Use test script (Recommended)

```batch
cd test-harness
test-keycloak-auth.bat
```

### Option 2: Use curl directly

```bash
curl -X POST "http://localhost:8080/realms/mcp_security/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=mcp-oauth" \
  -d "client_secret=JUUA5xCJDQZdreWgEFYvfAqjJnGdTXXA" \
  -d "username=alice@test.local" \
  -d "password=Test123!" \
  -d "grant_type=password"
```

**Success looks like:**
```json
{
  "access_token": "eyJhbGci...",
  "token_type": "Bearer",
  "expires_in": 300
}
```

---

## After Fixing Authentication

Once authentication works, run tests again:

```batch
npm run test:phase3
```

**Expected:** Tests should start passing!

```
✓ INT-001: Full End-to-End Flow
✓ INT-002: Two-Stage Authorization
... etc
```

---

## Current Test Configuration

The tests are using these credentials (from [phase3-integration.test.ts](phase3-integration.test.ts)):

```typescript
const CLIENT_CREDENTIALS = {
  mcpOAuth: {
    clientId: 'mcp-oauth',
    clientSecret: 'JUUA5xCJDQZdreWgEFYvfAqjJnGdTXXA',  // ⚠️ Update if wrong
  },
};

const TEST_USERS = {
  alice: {
    username: 'alice@test.local',  // ⚠️ Must exist in Keycloak
    password: 'Test123!',           // ⚠️ Must be correct
    legacyName: 'ALICE_ADMIN'
  },
  // ... more users
};
```

---

## Summary

**Status:** ✅ Tests are running (infrastructure working!)
**Issue:** ❌ Keycloak authentication not configured
**Next Step:** Fix Keycloak credentials using checklist above

**Once authentication works, Phase 3 testing can begin!**

---

**Document Status:** 🟡 Troubleshooting Guide
**Last Updated:** 2025-10-09
