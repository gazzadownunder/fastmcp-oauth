# Phase 3 Test Scripts - Updated for Email-Based Usernames

**Date:** 2025-10-09
**Update:** Test user credentials changed to email format

---

## Summary of Changes

All Phase 3 test scripts have been updated to use **email-based usernames** (`user@test.local`) instead of simple usernames.

### Files Updated

1. ✅ **[verify-keycloak-setup.bat](verify-keycloak-setup.bat)** - Verification script
2. ✅ **[phase3-integration-tests.ts](phase3-integration-tests.ts)** - Integration test suite
3. ✅ **[phase3-performance-tests.ts](phase3-performance-tests.ts)** - Performance test suite

---

## Updated Test User Credentials

### User: alice
```
Username: alice@test.local (changed from: alice)
Email:    alice@test.local
Password: Test123!
Attributes:
  - legacy_name: ALICE_ADMIN
Roles (Requestor JWT): user
Roles (TE-JWT): admin
Purpose: Privilege elevation testing
```

### User: bob
```
Username: bob@test.local (changed from: bob)
Email:    bob@test.local
Password: Test123!
Attributes:
  - legacy_name: BOB_USER
Roles (Requestor JWT): admin
Roles (TE-JWT): read
Purpose: Privilege reduction testing
```

### User: charlie
```
Username: charlie@test.local (changed from: charlie)
Email:    charlie@test.local
Password: Test123!
Attributes:
  - legacy_name: CHARLIE_USER
Roles: user (both JWTs)
Purpose: Same privilege level testing
```

### User: dave
```
Username: dave@test.local (changed from: dave)
Email:    dave@test.local
Password: Test123!
Attributes: NONE (no legacy_name attribute)
Purpose: Error handling for missing claims
```

### User: loadtest
```
Username: loadtest@test.local (changed from: loadtest)
Email:    loadtest@test.local
Password: LoadTest123!
Attributes:
  - legacy_name: LOADTEST_USER
Roles: user
Purpose: Performance and load testing
```

---

## Keycloak User Setup Checklist

For each user in Keycloak Admin Console (`http://localhost:8080/admin`):

### Step 1: Create User
1. Go to: **Users** → **Add user**
2. Set **Username:** `alice@test.local` (email format)
3. Set **Email:** `alice@test.local`
4. **Email verified:** Yes
5. Click **Create**

### Step 2: Set Password
1. Select user → **Credentials** tab
2. Click **Set password**
3. Password: `Test123!`
4. **Temporary:** No (disable temporary password)
5. Click **Save**

### Step 3: Add Attributes
1. Select user → **Attributes** tab
2. Click **Add an attribute**
3. Key: `legacyUsername`
4. Value: `ALICE_ADMIN` (or appropriate legacy name)
5. Click **Save**

**Note:** User `dave@test.local` should NOT have the `legacyUsername` attribute (for error testing).

### Step 4: Assign Roles
1. Select user → **Role mapping** tab
2. Click **Assign role**
3. Select appropriate roles (user, admin, etc.)
4. Click **Assign**

---

## Verification Commands

### Quick Test: Authenticate alice@test.local

```bash
curl -X POST "http://localhost:8080/realms/mcp_security/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=mcp-oauth" \
  -d "client_secret=JUUA5xCJDQZdreWgEFYvfAqjJnGdTXXA" \
  -d "username=alice@test.local" \
  -d "password=Test123!" \
  -d "grant_type=password"
```

**Expected:** JSON response with `access_token`

### Run Verification Script

```batch
cd test-harness
verify-keycloak-setup.bat
```

**Expected Output:**
```
================================================================
 Keycloak Configuration Verification
================================================================

Step 1: Testing Keycloak connectivity...
[OK] Keycloak is running on http://localhost:8080

Step 2: Testing user authentication (alice@test.local)...
[OK] User alice@test.local authenticated successfully

Step 3: Testing user authentication (bob@test.local)...
[OK] User bob@test.local authenticated successfully

Step 4: Testing user authentication (charlie@test.local)...
[OK] User charlie@test.local authenticated successfully

Step 5: Testing user authentication (loadtest@test.local)...
[OK] User loadtest@test.local authenticated successfully

================================================================
 Verification Complete!
================================================================
```

---

## Environment Variables (Optional)

You can override default usernames using environment variables:

```bash
# Windows (cmd)
set LOAD_TEST_USERNAME=loadtest@test.local

# Windows (PowerShell)
$env:LOAD_TEST_USERNAME="loadtest@test.local"

# Linux/Mac
export LOAD_TEST_USERNAME=loadtest@test.local
```

---

## Integration Tests Usage

The integration tests will now authenticate users with email-based usernames:

```typescript
// From phase3-integration-tests.ts
const TEST_USERS = {
  alice: { username: 'alice@test.local', password: 'Test123!', legacyName: 'ALICE_ADMIN' },
  bob: { username: 'bob@test.local', password: 'Test123!', legacyName: 'BOB_USER' },
  charlie: { username: 'charlie@test.local', password: 'Test123!', legacyName: 'CHARLIE_USER' },
  dave: { username: 'dave@test.local', password: 'Test123!', legacyName: null },
};
```

---

## Performance Tests Usage

The performance tests will use the load test user:

```typescript
// From phase3-performance-tests.ts
const LOAD_TEST_USER = {
  username: 'loadtest@test.local',
  password: 'LoadTest123!',
};
```

---

## Common Issues After Update

### Issue: "User not found" errors

**Cause:** Users created with simple username (e.g., `alice`) instead of email format

**Fix:**
1. Delete existing users in Keycloak (if any)
2. Create new users with email-based usernames: `alice@test.local`
3. Ensure **Email** field matches **Username** field

### Issue: "Invalid credentials" errors

**Cause:** Password not set correctly or set as temporary

**Fix:**
1. Go to user → Credentials tab
2. Set password: `Test123!`
3. Ensure **Temporary** is set to **No**
4. Click **Save password**

---

## Next Steps

After verifying all users are configured:

1. ✅ **Run verification script:**
   ```batch
   cd test-harness
   verify-keycloak-setup.bat
   ```

2. ✅ **Build project:**
   ```batch
   npm run build
   ```

3. ✅ **Start Phase 3 server:**
   ```batch
   cd test-harness
   start-phase3-server.bat
   ```

4. ✅ **Run Phase 3 tests:**
   ```batch
   npm run test:phase3
   npm run test:phase3:performance
   ```

---

## Summary

**What Changed:**
- All test scripts now use email format for usernames
- Username pattern: `<name>@test.local`
- Keycloak users must be created with email-based usernames

**What to Do:**
1. Create/update users in Keycloak with email usernames
2. Set passwords (not temporary)
3. Add `legacyUsername` attribute (except dave)
4. Run verification script to confirm

**Files Updated:**
- verify-keycloak-setup.bat ✅
- phase3-integration-tests.ts ✅
- phase3-performance-tests.ts ✅

---

**Document Status:** 🟢 Complete
**Last Updated:** 2025-10-09
