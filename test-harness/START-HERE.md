# Phase 3 Integration & Performance Testing - START HERE

**Status:** 🟢 Ready for Execution
**Last Updated:** 2025-10-09
**Important:** All test scripts updated for email-based usernames

---

## Quick Summary

✅ **Phase 3 infrastructure is complete and ready to run!**

All test files, configurations, and documentation have been prepared. Test scripts have been updated to use email-based usernames (`user@test.local`).

---

## What You Need to Do Before Testing

### 1. Verify Keycloak Client Secret ⚠️ IMPORTANT

The test scripts are currently showing "Invalid client credentials". You need to:

1. **Get the correct client secret from Keycloak:**
   - Open Keycloak Admin Console: http://localhost:8080/admin
   - Navigate to: **Clients** → **mcp-oauth**
   - Click on **Credentials** tab
   - Copy the **Client Secret** value

2. **Update the test configuration:**
   - Open: `test-harness/config/phase3-test-config.json`
   - Find: `"delegation" → "tokenExchange" → "clientSecret"`
   - Replace with the actual secret from Keycloak

3. **Update verification script (optional but recommended):**
   - Open: `test-harness/verify-keycloak-setup.bat`
   - Find line 30: `client_secret=JUUA5xCJDQZdreWgEFYvfAqjJnGdTXXA`
   - Replace with actual secret

### 2. Verify/Create Keycloak Test Users

Create these 5 users in Keycloak with **email-based usernames**:

| Username | Email | Password | legacy_name Attribute |
|----------|-------|----------|----------------------|
| alice@test.local | alice@test.local | Test123! | ALICE_ADMIN |
| bob@test.local | bob@test.local | Test123! | BOB_USER |
| charlie@test.local | charlie@test.local | Test123! | CHARLIE_USER |
| dave@test.local | dave@test.local | Test123! | (none - for error test) |
| loadtest@test.local | loadtest@test.local | LoadTest123! | LOADTEST_USER |

**Important Notes:**
- Username and Email must match
- Email verified: Yes
- Password Temporary: No
- All users need the `legacyUsername` attribute (except dave)

**See detailed setup instructions:** [PHASE3-UPDATED-USERNAMES.md](PHASE3-UPDATED-USERNAMES.md)

---

## Step-by-Step Execution

### Step 1: Update Client Secret (5 minutes)

```batch
# 1. Get secret from Keycloak Admin Console
# 2. Edit: test-harness/config/phase3-test-config.json
# 3. Update the clientSecret value
```

### Step 2: Verify Keycloak Users (15 minutes)

Follow instructions in [PHASE3-UPDATED-USERNAMES.md](PHASE3-UPDATED-USERNAMES.md) to create/verify users.

### Step 3: Run Verification Script (2 minutes)

```batch
cd test-harness
verify-keycloak-setup.bat
```

**Expected:** All 5 users authenticate successfully

**If it fails:**
- Check client secret is correct
- Verify users exist with email-based usernames
- Confirm passwords are set (not temporary)

### Step 4: Build Project (2 minutes)

```batch
cd ..
npm run build
```

**Expected:** Successful build, `dist/` directory populated

### Step 5: Start MCP Server (Terminal 1)

```batch
cd test-harness
start-phase3-server.bat
```

**Watch for:**
```
✓ Token exchange service initialized
✓ Cache enabled with TTL: 60s
✓ Server listening on port 3000
```

### Step 6: Run Integration Tests (Terminal 2 - 30-60 minutes)

```batch
npm run test:phase3
```

**Expected:** 12/12 tests pass

### Step 7: Run Performance Tests (Terminal 2 - 60-120 minutes)

```batch
npm run test:phase3:performance
```

**Expected:** All performance targets met

---

## Documentation Files (In Order of Use)

### Essential Reading
1. **[START-HERE.md](START-HERE.md)** (This file) - Quick start guide
2. **[PHASE3-UPDATED-USERNAMES.md](PHASE3-UPDATED-USERNAMES.md)** - User setup with email format ⭐ **READ THIS**
3. **[PHASE3-README.md](PHASE3-README.md)** - Comprehensive overview

### Reference Guides
4. **[PHASE3-EXECUTION-GUIDE.md](PHASE3-EXECUTION-GUIDE.md)** - Detailed execution guide
5. **[PHASE3-CHECKLIST.md](PHASE3-CHECKLIST.md)** - Step-by-step checklist
6. **[PHASE3-TESTING-GUIDE.md](PHASE3-TESTING-GUIDE.md)** - Testing procedures

### Test Files
- **[phase3-integration-tests.ts](phase3-integration-tests.ts)** - Integration test source
- **[phase3-performance-tests.ts](phase3-performance-tests.ts)** - Performance test source

### Configuration
- **[config/phase3-test-config.json](config/phase3-test-config.json)** - Server config (cache enabled)

### Scripts
- **[verify-keycloak-setup.bat](verify-keycloak-setup.bat)** - Pre-flight check ⭐ **RUN THIS FIRST**
- **[start-phase3-server.bat](start-phase3-server.bat)** - Start test server
- **[run-phase3-tests.bat](run-phase3-tests.bat)** - Run all tests

---

## Test Coverage

**Integration Tests (12 tests):**
- ✓ End-to-end OAuth flow
- ✓ Token exchange with real IDP
- ✓ Two-stage authorization
- ✓ Privilege elevation/reduction
- ✓ Cache behavior validation
- ✓ JWT refresh scenarios

**Performance Tests (10 tests):**
- ✓ Token exchange latency benchmarks
- ✓ Cache hit latency benchmarks
- ✓ Cache hit rate validation
- ✓ Load testing (100+ concurrent sessions)
- ✓ Memory/CPU monitoring

**Total Test Time:** 2-4 hours

---

## Expected Results

### Success Criteria
- ✅ All 22 tests pass
- ✅ Cache hit rate >85%
- ✅ Latency reduction >80%
- ✅ Token exchange p50 <150ms
- ✅ Cache hit p50 <50ms
- ✅ 100 concurrent sessions stable

---

## Troubleshooting

### "Invalid client or Invalid client credentials"

**Current Issue:** This is the error you're seeing now

**Solution:**
1. Get actual client secret from Keycloak Admin
2. Update `test-harness/config/phase3-test-config.json`
3. Update `test-harness/verify-keycloak-setup.bat`
4. Re-run verification script

### "User not found"

**Cause:** Users created with simple username instead of email format

**Solution:**
1. Create users with email-based usernames: `alice@test.local`
2. Set Email field to match Username field
3. Follow guide in [PHASE3-UPDATED-USERNAMES.md](PHASE3-UPDATED-USERNAMES.md)

### "Direct Access Grants not enabled"

**Cause:** Client mcp-oauth not configured for password grant type

**Solution:**
1. Keycloak Admin → Clients → mcp-oauth → Settings
2. **Direct Access Grants Enabled:** Turn ON
3. Click **Save**

---

## Current Status

### What's Complete ✅
- Phase 3 test infrastructure created
- Integration test suite (12 tests)
- Performance test suite (10 tests)
- Configuration files (cache enabled/disabled)
- Execution scripts and documentation
- **Updated for email-based usernames**

### What's Needed from You ⚠️
1. **Get correct client secret from Keycloak** (5 min)
2. **Update configuration files** (2 min)
3. **Verify/create test users** (15 min)
4. **Run verification script** (2 min)
5. **Execute Phase 3 tests** (2-4 hours)

---

## Next Actions (In Order)

```
1. ✅ Open Keycloak Admin Console
   → http://localhost:8080/admin

2. ✅ Get client secret
   → Clients → mcp-oauth → Credentials tab → Copy secret

3. ✅ Update phase3-test-config.json
   → Replace clientSecret value

4. ✅ Verify test users exist
   → Users → Check for alice@test.local, bob@test.local, etc.
   → See PHASE3-UPDATED-USERNAMES.md for details

5. ✅ Run verification script
   → cd test-harness
   → verify-keycloak-setup.bat
   → All 5 users should authenticate successfully

6. ✅ Build and test
   → npm run build
   → cd test-harness && start-phase3-server.bat
   → npm run test:phase3
```

---

## Support

**If you get stuck:**
- Check [PHASE3-UPDATED-USERNAMES.md](PHASE3-UPDATED-USERNAMES.md) for user setup
- Review [PHASE3-EXECUTION-GUIDE.md](PHASE3-EXECUTION-GUIDE.md) for detailed steps
- Verify Keycloak is running: `curl http://localhost:8080`
- Ensure client secret is correct in configuration

---

## Phase 3 Deliverables

After successful execution:
1. ✅ Test results documented
2. ✅ Performance metrics recorded
3. ✅ Screenshots/logs saved
4. ✅ Progress document updated
5. ✅ Git commit created with results

---

**Ready to Begin?** → Start with [PHASE3-UPDATED-USERNAMES.md](PHASE3-UPDATED-USERNAMES.md)

**Questions about setup?** → See [PHASE3-EXECUTION-GUIDE.md](PHASE3-EXECUTION-GUIDE.md)

**Ready to run tests?** → Follow steps above

---

**Document Status:** 🟢 Current
**Last Updated:** 2025-10-09
**Phase Progress:** Phase 1 ✅ | Phase 2 ✅ | **Phase 3 🟡 Ready** | Phase 4 ⬜ | Phase 5 ⬜
