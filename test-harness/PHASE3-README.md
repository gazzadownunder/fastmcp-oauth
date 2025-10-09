# Phase 3 Integration & Performance Testing - README

**Status:** 🟡 Ready for Execution (Pending User Setup)
**Created:** 2025-10-09
**Phase:** 3 of 5 (Integration & Performance Testing)

---

## Quick Summary

Phase 3 test infrastructure has been **fully prepared** and is ready for execution. All test files, configurations, and documentation are in place.

**What's Ready:**
- ✅ Integration test suite (12 automated tests)
- ✅ Performance benchmark suite (4 test categories)
- ✅ Load testing suite (6 test scenarios)
- ✅ Phase 3 configuration files (cache enabled/disabled)
- ✅ Execution scripts and verification tools
- ✅ Comprehensive documentation

**What's Needed from You:**
- ⚠️ Verify Keycloak test users are created with correct attributes
- ⚠️ Update client secrets in configuration files
- ⚠️ Set user roles as specified in test plan

---

## Files Created for Phase 3

### Configuration
1. **[config/phase3-test-config.json](config/phase3-test-config.json)**
   - Cache enabled: true
   - TTL: 60 seconds
   - Ready for integration and performance testing

### Test Suites
2. **[phase3-integration-tests.ts](phase3-integration-tests.ts)**
   - 12 integration tests (INT-001 to INT-010)
   - Tests: end-to-end flow, cache behavior, privilege elevation/reduction

3. **[phase3-performance-tests.ts](phase3-performance-tests.ts)**
   - 4 performance benchmarks (PERF-001 to PERF-004)
   - 6 load tests (LOAD-001 to LOAD-006)
   - Validates latency targets and cache effectiveness

### Execution Scripts
4. **[start-phase3-server.bat](start-phase3-server.bat)**
   - Starts MCP server with Phase 3 configuration
   - Sets environment variables automatically

5. **[run-phase3-tests.bat](run-phase3-tests.bat)**
   - Runs complete Phase 3 test suite
   - Integration + Performance tests in sequence

6. **[verify-keycloak-setup.bat](verify-keycloak-setup.bat)**
   - Verifies Keycloak connectivity
   - Tests authentication for all test users
   - Pre-flight check before running full suite

### Documentation
7. **[PHASE3-TESTING-GUIDE.md](PHASE3-TESTING-GUIDE.md)**
   - Complete testing guide with examples
   - Troubleshooting section
   - Manual test procedures

8. **[PHASE3-CHECKLIST.md](PHASE3-CHECKLIST.md)**
   - Step-by-step execution checklist
   - Pre-test verification items
   - Results documentation template

9. **[PHASE3-EXECUTION-GUIDE.md](PHASE3-EXECUTION-GUIDE.md)** ⭐ **START HERE**
   - Executive summary of Phase 3 status
   - Keycloak user setup requirements
   - Quick start guide
   - Troubleshooting

10. **[PHASE3-README.md](PHASE3-README.md)** (This file)
    - High-level overview
    - Next actions
    - Test execution flow

---

## Test Coverage

### Integration Tests (INT-xxx)
```
✓ INT-001: Full end-to-end flow (JWT → Token Exchange → SQL)
✓ INT-002: Two-stage authorization (MCP + Downstream)
✓ INT-003: Privilege elevation (user → admin via TE-JWT)
✓ INT-004: Privilege reduction (admin → read-only via TE-JWT)
✓ INT-005: Cache hit rate validation (>85% target)
✓ INT-006: No cache behavior (stateless operation)
✓ INT-007: JWT refresh invalidates cache
✓ INT-008: Multiple audiences per session
✓ INT-009: Session timeout and cleanup
✓ INT-010: Hot-reload configuration
```

### Performance Benchmarks (PERF-xxx)
```
✓ PERF-001: Token exchange latency (p50<150ms, p99<300ms)
✓ PERF-002: Cache hit latency (p50<50ms, p99<100ms)
✓ PERF-003: Cache hit rate (>85% with 60s TTL)
✓ PERF-004: Latency reduction (>80% with cache)
```

### Load & Stress Tests (LOAD-xxx)
```
✓ LOAD-001: 100 sessions × 10 calls (no cache) - <10s target
✓ LOAD-002: 100 sessions × 10 calls (cache) - <3s target
✓ LOAD-003: Memory usage monitoring
✓ LOAD-004: CPU usage during cache operations
✓ LOAD-005: Cache eviction under pressure (LRU)
✓ LOAD-006: IDP failure handling (graceful degradation)
```

**Total Tests:** 22 (12 integration + 4 performance + 6 load)

---

## Execution Flow

### Step 1: Pre-Flight Check ⚠️ **DO THIS FIRST**

**Read:** [PHASE3-EXECUTION-GUIDE.md](PHASE3-EXECUTION-GUIDE.md)

This guide contains:
- Keycloak user requirements (alice, bob, charlie, dave, loadtest)
- Client configuration requirements
- Client secret update instructions
- Quick verification steps

**Estimated Time:** 15-30 minutes

### Step 2: Verify Keycloak Setup

**Run:**
```batch
cd test-harness
verify-keycloak-setup.bat
```

**This script tests:**
- Keycloak connectivity
- Authentication for all test users
- Client credentials validity

**Expected:** All 5 users authenticate successfully

### Step 3: Build Project

```batch
npm run build
```

**Expected:** Successful build, `dist/` populated

### Step 4: Start Test Server

**Terminal 1:**
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

### Step 5: Run Integration Tests

**Terminal 2:**
```batch
npm run test:phase3
```

**Expected:** 12/12 tests pass in ~30-60 minutes

### Step 6: Run Performance Tests

**Terminal 2:**
```batch
npm run test:phase3:performance
```

**Expected:** All performance targets met in ~60-120 minutes

### Step 7: Document Results

Use [PHASE3-CHECKLIST.md](PHASE3-CHECKLIST.md) to:
- Record test results
- Document performance metrics
- Note any issues found
- Prepare for Phase 3 git commit

---

## Test Environment Requirements

### Keycloak Configuration ✅

**Status:** Keycloak running and configured

- ✅ Running on http://localhost:8080
- ✅ Realm `mcp_security` exists
- ✅ Token exchange grant type supported
- ✅ Client `mcp-oauth` configured
- ⚠️ Test users need verification/creation

### Test Users (Must Be Created)

| User | Password | legacy_name Attribute | Purpose |
|------|----------|---------------------|---------|
| alice | Test123! | ALICE_ADMIN | Privilege elevation test |
| bob | Test123! | BOB_USER | Privilege reduction test |
| charlie | Test123! | CHARLIE_USER | Same privilege test |
| dave | Test123! | (none) | Error handling test |
| loadtest | LoadTest123! | LOADTEST_USER | Performance testing |

**Creation Steps:** See [PHASE3-EXECUTION-GUIDE.md](PHASE3-EXECUTION-GUIDE.md) § "Required Keycloak User Setup"

### Client Secrets (Must Be Updated)

Update in `config/phase3-test-config.json`:
```json
{
  "delegation": {
    "tokenExchange": {
      "clientSecret": "<GET_FROM_KEYCLOAK>"  // Update this!
    }
  }
}
```

**How to Get Secret:**
1. Keycloak Admin → Clients → mcp-oauth → Credentials tab
2. Copy "Secret" value
3. Paste into configuration file

---

## Expected Results

### Success Criteria

- ✅ **Integration Tests:** 12/12 pass
- ✅ **Performance Tests:** All targets met
- ✅ **Cache Hit Rate:** >85% with 60s TTL
- ✅ **Latency Reduction:** >80% with cache enabled
- ✅ **Token Exchange Latency:** p50<150ms, p99<300ms
- ✅ **Cache Hit Latency:** p50<50ms, p99<100ms
- ✅ **Load Tests:** 100+ concurrent sessions stable

### Deliverables

After successful test execution:
1. Test results documented in [PHASE3-CHECKLIST.md](PHASE3-CHECKLIST.md)
2. Performance metrics recorded
3. [Docs/unified-oauth-progress.md](../Docs/unified-oauth-progress.md) updated
4. Phase 3 marked complete
5. Git commit created with results

---

## Troubleshooting

### Problem: verify-keycloak-setup.bat fails with "Invalid client credentials"

**Solution:**
1. Get client secret from Keycloak Admin Console
2. Update `config/phase3-test-config.json`
3. Ensure client `mcp-oauth` has "Direct Access Grants Enabled" = Yes

### Problem: "User not found" errors

**Solution:**
1. Create missing users in Keycloak Admin
2. Follow user creation steps in [PHASE3-EXECUTION-GUIDE.md](PHASE3-EXECUTION-GUIDE.md)
3. Verify `legacy_name` attribute is set

### Problem: "Token exchange failed: 403 Forbidden"

**Solution:**
1. Enable token exchange permissions on `mcp-server-client`
2. Keycloak → Clients → mcp-server-client → Permissions → Enable
3. Create policy allowing `mcp-oauth` to exchange tokens

### Problem: Tests fail with "Missing legacy_name claim"

**Solution:**
1. Add mapper to `mcp-server-client`
2. Mapper type: "User Attribute"
3. User Attribute: `legacyUsername`
4. Token Claim Name: `legacy_name`
5. Add to access token: Yes

---

## Next Steps

### Immediate (Before Running Tests)

1. ⚠️ **Read [PHASE3-EXECUTION-GUIDE.md](PHASE3-EXECUTION-GUIDE.md)** - Complete setup guide
2. ⚠️ **Create Keycloak test users** - Per specifications
3. ⚠️ **Update client secrets** - In phase3-test-config.json
4. ✅ **Run verify-keycloak-setup.bat** - Confirm all users authenticate
5. ✅ **Build project** - npm run build

### Testing (2-4 hours)

6. ✅ **Start server** - test-harness/start-phase3-server.bat
7. ✅ **Run integration tests** - npm run test:phase3
8. ✅ **Run performance tests** - npm run test:phase3:performance
9. ✅ **Document results** - Fill out PHASE3-CHECKLIST.md

### Post-Testing

10. ✅ **Update progress document** - Mark Phase 3 complete
11. ✅ **Create git commit** - With test results and metrics
12. ✅ **Proceed to Phase 4** - Documentation & Production Readiness

---

## Support Resources

### Documentation Files (In Order of Use)
1. **PHASE3-README.md** (This file) - Overview and quick start
2. **PHASE3-EXECUTION-GUIDE.md** - Detailed setup and user creation
3. **PHASE3-CHECKLIST.md** - Step-by-step execution checklist
4. **PHASE3-TESTING-GUIDE.md** - Complete testing guide with examples

### Test Files
- **phase3-integration-tests.ts** - Integration test source code
- **phase3-performance-tests.ts** - Performance test source code

### Configuration
- **config/phase3-test-config.json** - Phase 3 server configuration (cache enabled)
- **config/v2-keycloak-token-exchange.json** - Alternative config (cache disabled)

### Scripts
- **verify-keycloak-setup.bat** - Pre-flight check
- **start-phase3-server.bat** - Start test server
- **run-phase3-tests.bat** - Run all tests

---

## Summary

✅ **Phase 3 Infrastructure:** Complete and ready
⚠️ **User Action Required:** Keycloak user setup (15-30 min)
🎯 **Next Milestone:** Execute Phase 3 tests and document results
📈 **Progress:** Phase 1 ✅ | Phase 2 ✅ | **Phase 3 🟡** | Phase 4 ⬜ | Phase 5 ⬜

**Estimated Time to Complete Phase 3:** 2-4 hours (including setup + testing)

---

**Document Status:** 🟢 Ready for Use
**Last Updated:** 2025-10-09
**Version:** 1.0
