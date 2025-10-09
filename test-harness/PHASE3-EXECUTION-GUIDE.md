# Phase 3 Integration & Performance Testing - Execution Guide

**Version:** 1.0
**Date:** 2025-10-09
**Status:** Ready for Execution
**Keycloak Status:** ✅ Running and configured with token-exchange support

---

## Executive Summary

Phase 3 validates the complete OAuth & Token Exchange framework with:
- **Real Keycloak IDP** integration
- **Encrypted Token Cache** performance testing
- **End-to-end flows** with two-stage authorization
- **Load testing** up to 1000 concurrent sessions
- **Security validation** of cache cryptographic binding

**Prerequisites Status:**
- ✅ Keycloak running on http://localhost:8080
- ✅ Realm `mcp_security` configured
- ✅ Token exchange grant type supported
- ⚠️ Test users need verification (see User Setup below)

---

## Phase 3 Test Infrastructure (Already Created)

The following files have been created to support Phase 3 testing:

### Configuration Files
- ✅ `test-harness/config/phase3-test-config.json` - Cache enabled config
- ✅ `test-harness/config/v2-keycloak-token-exchange.json` - Cache disabled config

### Test Files
- ✅ `test-harness/phase3-integration-tests.ts` - Integration test suite (INT-001 to INT-010)
- ✅ `test-harness/phase3-performance-tests.ts` - Performance benchmarks (PERF-001 to PERF-004, LOAD-001 to LOAD-006)

### Execution Scripts
- ✅ `test-harness/start-phase3-server.bat` - Start MCP server with Phase 3 config
- ✅ `test-harness/run-phase3-tests.bat` - Run all Phase 3 tests
- ✅ `test-harness/verify-keycloak-setup.bat` - Verify Keycloak configuration

### Documentation
- ✅ `test-harness/PHASE3-TESTING-GUIDE.md` - Complete testing guide
- ✅ `test-harness/PHASE3-CHECKLIST.md` - Execution checklist
- ✅ This file - Execution summary

### NPM Scripts (Already in package.json)
- ✅ `npm run test:phase3` - Run integration tests
- ✅ `npm run test:phase3:performance` - Run performance tests

---

## Required Keycloak User Setup

Before running tests, ensure these users exist in Keycloak realm `mcp_security`:

### User: alice
```
Username: alice
Password: Test123!
Attributes:
  - legacy_name: ALICE_ADMIN
Roles (Requestor): user
Roles (Delegation TE-JWT): admin
Purpose: Test privilege elevation
```

### User: bob
```
Username: bob
Password: Test123!
Attributes:
  - legacy_name: BOB_USER
Roles (Requestor): admin
Roles (Delegation TE-JWT): read
Purpose: Test privilege reduction
```

### User: charlie
```
Username: charlie
Password: Test123!
Attributes:
  - legacy_name: CHARLIE_USER
Roles (Both): user
Purpose: Test same privilege level
```

### User: dave
```
Username: dave
Password: Test123!
Attributes: NONE (no legacy_name)
Purpose: Test error handling for missing claims
```

### User: loadtest
```
Username: loadtest
Password: LoadTest123!
Attributes:
  - legacy_name: LOADTEST_USER
Roles: user
Purpose: Performance and load testing
```

---

## Keycloak Client Configuration Required

### Client: mcp-oauth (Requestor Client)

**Current Status:** ✅ Exists, but credentials need verification

**Required Settings:**
```
Client ID: mcp-oauth
Client Protocol: openid-connect
Access Type: confidential
Standard Flow Enabled: Yes
Direct Access Grants Enabled: Yes (for password grant - testing only)
Service Accounts Enabled: No

Credentials:
  Client Secret: <YOUR_CLIENT_SECRET>
  (Update in phase3-test-config.json)

Mappers:
  - legacy_name (User Attribute → Token Claim)
  - roles (Realm Roles → Token Claim)
```

### Client: mcp-server-client (Token Exchange Client)

**Status:** ⚠️ May need to be created

**Required Settings:**
```
Client ID: mcp-server-client
Client Protocol: openid-connect
Access Type: confidential
Standard Flow Enabled: No
Direct Access Grants Enabled: No
Service Accounts Enabled: Yes

Credentials:
  Client Secret: <YOUR_CLIENT_SECRET>
  (Update in phase3-test-config.json)

Token Exchange Permissions:
  1. Enable "Permissions" tab
  2. Add policy allowing mcp-oauth to exchange tokens
  3. Ensure token-exchange scope is enabled

Mappers (CRITICAL):
  - legacy_name (User Attribute → Token Claim "legacy_name")
  - roles (Realm Roles → Token Claim "roles")
```

**To Enable Token Exchange:**
1. Go to Keycloak Admin Console
2. Clients → mcp-server-client → Permissions
3. Enable "Permissions Enabled"
4. Create policy to allow token exchange from mcp-oauth

---

## Quick Start - Phase 3 Testing

### Step 1: Verify Keycloak Users

You mentioned some roles are not set yet. Here's what to verify in Keycloak Admin Console:

1. **Navigate to:** Keycloak Admin → mcp_security realm → Users
2. **For each user (alice, bob, charlie, dave, loadtest):**
   - Click on user → Attributes tab
   - Verify `legacy_name` attribute exists (except dave)
   - Click Credentials tab → Verify password set
   - Click Role mapping tab → Verify roles assigned

### Step 2: Update Configuration with Correct Secrets

Edit `test-harness/config/phase3-test-config.json`:

```json
{
  "delegation": {
    "tokenExchange": {
      "clientId": "mcp-oauth",
      "clientSecret": "<GET_FROM_KEYCLOAK>",  // Update this
      ...
    }
  }
}
```

**To get client secret:**
1. Keycloak Admin → Clients → mcp-oauth
2. Credentials tab → Copy "Secret"
3. Paste into configuration file

### Step 3: Build Project

```batch
cd "c:\Users\gazza\Local Documents\GitHub\MCP Services\MCP-Oauth"
npm run build
```

**Expected output:**
```
✓ Built successfully
dist/ directory populated
```

### Step 4: Start Phase 3 Server

**Terminal 1:**
```batch
cd test-harness
start-phase3-server.bat
```

**Watch for:**
- ✅ "Token exchange service initialized"
- ✅ "Cache enabled with TTL: 60s"
- ✅ "Server listening on port 3000"

### Step 5: Run Integration Tests

**Terminal 2:**
```batch
cd "c:\Users\gazza\Local Documents\GitHub\MCP Services\MCP-Oauth"
npm run test:phase3
```

**Expected:** 12/12 tests pass

### Step 6: Run Performance Tests

**Terminal 2:**
```batch
npm run test:phase3:performance
```

**Expected:** Performance targets met (see checklist)

---

## Test Execution Sequence

### Phase 3A: Integration Tests (30-60 minutes)

| Test ID | Description | Duration | Critical |
|---------|-------------|----------|----------|
| INT-001 | Full end-to-end flow | 5 min | ✅ Critical |
| INT-002 | Two-stage authorization | 2 min | ✅ Critical |
| INT-003 | Privilege elevation | 2 min | ✅ Critical |
| INT-004 | Privilege reduction | 2 min | ✅ Critical |
| INT-005 | Cache hit rate >85% | 5 min | ✅ Critical |
| INT-006 | No cache behavior | 5 min | Medium |
| INT-007 | JWT refresh invalidates cache | 5 min | ✅ Critical |
| INT-008 | Multiple audiences | 3 min | Medium |
| INT-009 | Session timeout cleanup | Manual | Low |
| INT-010 | Hot-reload config | Manual | Low |

**Total Automated Tests:** 8/10
**Manual Tests:** 2 (INT-009, INT-010)

### Phase 3B: Performance Benchmarks (60-120 minutes)

| Test ID | Metric | Target | Importance |
|---------|--------|--------|------------|
| PERF-001 | Token exchange latency | p50<150ms, p99<300ms | ✅ Critical |
| PERF-002 | Cache hit latency | p50<50ms, p99<100ms | ✅ Critical |
| PERF-003 | Cache hit rate | >85% | ✅ Critical |
| PERF-004 | Latency reduction | >80% | ✅ Critical |

### Phase 3C: Load & Stress Tests (30-60 minutes)

| Test ID | Description | Target | Risk |
|---------|-------------|--------|------|
| LOAD-001 | 100 sessions (no cache) | <10s | Medium |
| LOAD-002 | 100 sessions (cache) | <3s | Medium |
| LOAD-003 | Memory usage monitoring | <50MB growth | Low |
| LOAD-004 | CPU usage | <5% overhead | Low |
| LOAD-005 | Cache eviction | Graceful | Low |
| LOAD-006 | IDP failure handling | Manual | Low |

**Total Test Time:** 2-4 hours (including setup)

---

## Troubleshooting Guide

### Issue: "Invalid client or Invalid client credentials"

**Cause:** Client secret in config doesn't match Keycloak

**Fix:**
1. Get secret from Keycloak: Clients → mcp-oauth → Credentials tab
2. Update `test-harness/config/phase3-test-config.json`
3. Restart MCP server

### Issue: "User not found" or "Invalid credentials"

**Cause:** Test users not created in Keycloak

**Fix:**
1. Keycloak Admin → Users → Add User
2. Set username, password (Credentials tab)
3. Add `legacy_name` attribute (Attributes tab)
4. Assign roles (Role mapping tab)

### Issue: "Token exchange failed: 403 Forbidden"

**Cause:** Token exchange permissions not configured

**Fix:**
1. Keycloak → Clients → mcp-server-client → Permissions
2. Enable "Permissions Enabled"
3. Create policy to allow mcp-oauth to perform token exchange

### Issue: "Missing legacy_name claim in TE-JWT"

**Cause:** Mapper not configured on mcp-server-client

**Fix:**
1. Keycloak → Clients → mcp-server-client → Mappers
2. Add mapper: "User Attribute" type
3. User Attribute: `legacyUsername`
4. Token Claim Name: `legacy_name`
5. Add to access token: Yes

---

## Expected Outcomes

### Integration Tests (INT-xxx)
- ✅ All 12 tests pass
- ✅ End-to-end flow validated
- ✅ Cache hit rate >85%
- ✅ Security features working (privilege elevation/reduction)

### Performance Tests (PERF-xxx)
- ✅ Token exchange latency meets targets
- ✅ Cache provides >80% latency reduction
- ✅ Cache hit latency <50ms (p50)
- ✅ No performance degradation under load

### Load Tests (LOAD-xxx)
- ✅ 100+ concurrent sessions handled
- ✅ Throughput improvement with cache
- ✅ Stable memory usage
- ✅ Graceful degradation on IDP failure

---

## Phase 3 Completion Checklist

After successful test execution:

- [ ] All integration tests pass (12/12)
- [ ] All performance targets met
- [ ] Load tests demonstrate stability
- [ ] Test results documented
- [ ] Screenshots/logs saved
- [ ] `Docs/unified-oauth-progress.md` updated
- [ ] Phase 3 deliverables marked complete
- [ ] Git commit created with test results
- [ ] Ready to proceed to Phase 4

---

## Next Actions for You

Since Keycloak is configured but users may need role setup:

### Action 1: Verify Keycloak User Setup (10 minutes)

1. Open Keycloak Admin Console: http://localhost:8080/admin
2. Login with admin credentials
3. Select `mcp_security` realm
4. Go to Users → View all users
5. For each test user (alice, bob, charlie, dave, loadtest):
   - Verify user exists
   - Check Attributes tab for `legacy_name`
   - Check Role mapping tab for assigned roles
   - If missing, create users per specifications above

### Action 2: Verify Client Secrets (5 minutes)

1. Get `mcp-oauth` client secret:
   - Clients → mcp-oauth → Credentials → Copy secret
2. Update `test-harness/config/phase3-test-config.json`:
   - Find `delegation.tokenExchange.clientSecret`
   - Replace with actual secret

### Action 3: Build and Test (15 minutes)

```batch
# Build project
npm run build

# Terminal 1: Start server
cd test-harness
start-phase3-server.bat

# Terminal 2: Run quick verification
npm run test:phase3 -- -t "INT-001"
```

If INT-001 passes, you're ready for full Phase 3 execution!

---

## Support

For issues during testing:
- Check server logs in Terminal 1
- Review `PHASE3-TESTING-GUIDE.md` for detailed troubleshooting
- Verify Keycloak configuration matches requirements above
- Ensure all users have `legacy_name` attribute set

---

**Document Status:** 🟢 Ready for Use
**Last Updated:** 2025-10-09
**Estimated Completion Time:** 2-4 hours (including setup)
