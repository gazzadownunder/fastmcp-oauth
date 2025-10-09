# Phase 3 Quick Start Guide

**Last Updated:** 2025-10-09
**Status:** 🟢 Ready to Execute

---

## Before You Start ⚠️

### 1. Update Keycloak Client Secret (REQUIRED)

The test scripts are showing "Invalid client credentials". You need to update the client secret:

**Steps:**
1. Open Keycloak Admin: http://localhost:8080/admin
2. Navigate to: **Clients** → **mcp-oauth** → **Credentials** tab
3. Copy the **Client Secret**
4. Edit: `test-harness/config/phase3-test-config.json`
5. Find line 56: `"clientSecret": "JUUA5xCJDQZdreWgEFYvfAqjJnGdTXXA"`
6. Replace with the actual secret from Keycloak
7. Save the file

**Also update in verification script (optional):**
- Edit: `test-harness/verify-keycloak-setup.bat`
- Line 30: Replace `JUUA5xCJDQZdreWgEFYvfAqjJnGdTXXA` with actual secret

### 2. Verify Test Users (Email Format)

Ensure these users exist in Keycloak with **email-based usernames**:

| Username | Password | Attribute: legacyUsername |
|----------|----------|---------------------------|
| alice@test.local | Test123! | ALICE_ADMIN |
| bob@test.local | Test123! | BOB_USER |
| charlie@test.local | Test123! | CHARLIE_USER |
| dave@test.local | Test123! | (none - for error testing) |
| loadtest@test.local | LoadTest123! | LOADTEST_USER |

**See detailed setup:** [test-harness/PHASE3-UPDATED-USERNAMES.md](test-harness/PHASE3-UPDATED-USERNAMES.md)

---

## Quick Start (3 Easy Steps)

### Step 1: Build and Verify (5 minutes)

**Run from ROOT directory:**

```batch
cd "c:\Users\gazza\Local Documents\GitHub\MCP Services\MCP-Oauth"
build-and-test-phase3.bat
```

This script will:
- ✅ Build the project from root directory
- ✅ Verify all 5 Keycloak users authenticate successfully
- ✅ Tell you if there are any issues to fix

**If verification fails:**
- Update client secret in config/phase3-test-config.json
- Check users exist with email format (alice@test.local)
- Ensure passwords are not temporary

### Step 2: Start Test Server (Terminal 1)

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

**Keep this terminal open!**

### Step 3: Run Tests (Terminal 2)

**Option A: Run all tests automatically**
```batch
cd test-harness
run-phase3-tests.bat
```

**Option B: Run tests separately**
```batch
# From ROOT directory
cd "c:\Users\gazza\Local Documents\GitHub\MCP Services\MCP-Oauth"

# Integration tests (30-60 min)
npm run test:phase3

# Performance tests (60-120 min)
npm run test:phase3:performance
```

---

## Directory Structure (Important!)

```
MCP-Oauth/                              ← ROOT (build from here!)
├── build-and-test-phase3.bat           ← NEW: All-in-one script
├── package.json                        ← Has build & test scripts
├── dist/                               ← Created after build
│   └── test-harness/
│       └── v2-test-server.js
└── test-harness/                       ← Start server from here
    ├── config/
    │   └── phase3-test-config.json     ← UPDATE CLIENT SECRET HERE
    ├── verify-keycloak-setup.bat
    ├── start-phase3-server.bat
    └── run-phase3-tests.bat
```

---

## Common Mistakes to Avoid ❌

### ❌ Mistake 1: Building from test-harness
```batch
cd test-harness
npm run build  # ERROR: Missing script: "build"
```

**✅ Correct:** Build from ROOT
```batch
cd "c:\Users\gazza\Local Documents\GitHub\MCP Services\MCP-Oauth"
npm run build
```

### ❌ Mistake 2: Forgetting to update client secret
```
Error: "Invalid client or Invalid client credentials"
```

**✅ Fix:** Get secret from Keycloak and update in:
- `test-harness/config/phase3-test-config.json` (line 56)

### ❌ Mistake 3: Using simple usernames instead of email
```
Users: alice, bob, charlie  # Wrong!
```

**✅ Correct:** Use email format
```
Users: alice@test.local, bob@test.local, charlie@test.local
```

---

## File Reference

### Scripts (Run These)
- **[build-and-test-phase3.bat](build-and-test-phase3.bat)** - Build + verify (ROOT)
- **[test-harness/start-phase3-server.bat](test-harness/start-phase3-server.bat)** - Start server
- **[test-harness/run-phase3-tests.bat](test-harness/run-phase3-tests.bat)** - Run all tests

### Documentation
- **[test-harness/START-HERE.md](test-harness/START-HERE.md)** - Comprehensive guide
- **[test-harness/PHASE3-UPDATED-USERNAMES.md](test-harness/PHASE3-UPDATED-USERNAMES.md)** - User setup
- **[test-harness/BUILD-AND-START.md](test-harness/BUILD-AND-START.md)** - Build instructions
- **[test-harness/PHASE3-CHECKLIST.md](test-harness/PHASE3-CHECKLIST.md)** - Execution checklist

### Configuration
- **[test-harness/config/phase3-test-config.json](test-harness/config/phase3-test-config.json)** ⚠️ **UPDATE SECRET HERE**

---

## Troubleshooting

### Issue: "Invalid client or Invalid client credentials"

**Current Status:** This is likely the issue you're experiencing

**Root Cause:** Client secret in config doesn't match Keycloak

**Solution:**
1. Get secret from Keycloak Admin Console (Clients → mcp-oauth → Credentials)
2. Update `test-harness/config/phase3-test-config.json` line 56
3. Re-run `build-and-test-phase3.bat`

### Issue: "User not found"

**Root Cause:** Users created with simple username (alice) instead of email (alice@test.local)

**Solution:**
1. In Keycloak, create users with email-based usernames
2. Set Username = Email = `alice@test.local`
3. Follow guide: [test-harness/PHASE3-UPDATED-USERNAMES.md](test-harness/PHASE3-UPDATED-USERNAMES.md)

### Issue: "Missing script: build"

**Root Cause:** Running `npm run build` from test-harness directory

**Solution:**
```batch
cd "c:\Users\gazza\Local Documents\GitHub\MCP Services\MCP-Oauth"
npm run build
```

Or use the all-in-one script:
```batch
build-and-test-phase3.bat
```

---

## Success Criteria

After running all tests, you should see:

✅ **Integration Tests:** 12/12 pass
✅ **Performance Tests:** All targets met
✅ **Cache Hit Rate:** >85%
✅ **Latency Reduction:** >80%
✅ **Load Tests:** 100+ concurrent sessions stable

---

## Next Actions Checklist

- [ ] Update client secret in `test-harness/config/phase3-test-config.json`
- [ ] Verify users exist in Keycloak (alice@test.local, bob@test.local, etc.)
- [ ] Run `build-and-test-phase3.bat` from ROOT directory
- [ ] Fix any issues reported by verification script
- [ ] Start server: `cd test-harness && start-phase3-server.bat`
- [ ] Run tests: `npm run test:phase3` (from ROOT)
- [ ] Document results
- [ ] Create Phase 3 git commit

---

## Estimated Time

- **Setup (first time):** 20-30 minutes
- **Build & verify:** 5 minutes
- **Integration tests:** 30-60 minutes
- **Performance tests:** 60-120 minutes
- **Total:** 2-4 hours

---

**Ready to begin?** Run `build-and-test-phase3.bat` from the root directory!

**Need help?** See [test-harness/START-HERE.md](test-harness/START-HERE.md) for detailed guidance.

---

**Document Status:** 🟢 Current
**Last Updated:** 2025-10-09
