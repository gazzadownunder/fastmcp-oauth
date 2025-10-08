# Phase 3 Integration & Performance Testing Guide

**Version:** 1.0
**Created:** 2025-01-08
**Purpose:** Complete guide for running Phase 3 integration and performance tests

---

## Overview

Phase 3 testing validates the complete OAuth & Token Exchange framework with real Keycloak IDP, including:
- End-to-end token exchange flows
- Two-stage authorization (MCP + downstream)
- Encrypted token cache performance
- Load testing (1000+ concurrent sessions)
- Security validation

---

## Prerequisites

### 1. Keycloak Configuration

**IMPORTANT:** Keycloak must be fully configured before running tests.

See [Docs/idp-configuration-requirements.md](../Docs/idp-configuration-requirements.md) for complete setup instructions.

**Quick Checklist:**
- [ ] Keycloak 24.0+ running on http://localhost:8080
- [ ] Realm `mcp_security` created
- [ ] Client `mcp-oauth` configured with mappers
- [ ] Client `mcp-server-client` configured with token exchange permissions
- [ ] Test users created: alice, bob, charlie, dave, loadtest
- [ ] Token exchange manually tested and working

### 2. MCP Server Configuration

Create test configuration file: `test-harness/config/phase3-test-config.json`

```json
{
  "trustedIDPs": [
    {
      "issuer": "http://localhost:8080/realms/mcp_security",
      "discoveryUrl": "http://localhost:8080/realms/mcp_security/.well-known/openid-configuration",
      "jwksUri": "http://localhost:8080/realms/mcp_security/protocol/openid-connect/certs",
      "audience": "mcp-oauth",
      "algorithms": ["RS256"],
      "claimMappings": {
        "legacyUsername": "legacy_sam_account",
        "roles": "user_roles",
        "scopes": "authorized_scopes"
      },
      "security": {
        "clockTolerance": 60,
        "maxTokenAge": 3600,
        "requireNbf": true
      }
    }
  ],
  "roleMappings": {
    "admin": ["admin", "administrator"],
    "user": ["user", "member"],
    "guest": ["guest"],
    "defaultRole": "guest",
    "rejectUnmappedRoles": false
  },
  "delegation": {
    "tokenExchange": {
      "tokenEndpoint": "http://localhost:8080/realms/mcp_security/protocol/openid-connect/token",
      "clientId": "mcp-server-client",
      "clientSecret": "<YOUR_MCP_SERVER_CLIENT_SECRET>",
      "audience": "mcp-server-client",
      "cache": {
        "enabled": true,
        "ttlSeconds": 60,
        "sessionTimeoutMs": 900000,
        "maxEntriesPerSession": 10,
        "maxTotalEntries": 1000
      }
    },
    "sql": {
      "server": "localhost",
      "database": "test_db",
      "options": {
        "encrypt": true,
        "trustServerCertificate": true
      }
    }
  },
  "audit": {
    "logAllAttempts": true,
    "retentionDays": 90
  }
}
```

### 3. Environment Variables

Create `.env.test` file:

```bash
# Keycloak Configuration
KEYCLOAK_URL=http://localhost:8080
KEYCLOAK_REALM=mcp_security

# MCP Server
MCP_SERVER_URL=http://localhost:3000

# Client Credentials
MCP_OAUTH_CLIENT_ID=mcp-oauth
MCP_OAUTH_CLIENT_SECRET=JUUA5xCJDQZdreWgEFYvfAqjJnGdTXXA

# Load Test User
LOAD_TEST_USERNAME=loadtest
LOAD_TEST_PASSWORD=LoadTest123!

# SQL Server (if using SQL delegation)
SQL_SERVER=localhost
SQL_DATABASE=test_db
SQL_USER=sa
SQL_PASSWORD=YourStrong!Passw0rd
```

---

## Running Tests

### 1. Start MCP Server

**Terminal 1:**
```bash
# Set environment variables
export CONFIG_PATH=./test-harness/config/phase3-test-config.json
export SERVER_PORT=3000

# Start server
npm start
```

Wait for server to start:
```
✅ MCP OAuth Server started on http://localhost:3000
✅ Configuration loaded from ./test-harness/config/phase3-test-config.json
✅ Token exchange enabled with cache: true
```

### 2. Run Integration Tests

**Terminal 2:**
```bash
# Run all integration tests
npm run test:phase3

# Run with environment file
source .env.test && npm run test:phase3

# Run specific test suite
npm run test:phase3 -- -t "INT-001"
```

**Expected Output:**
```
✓ Phase 3: Integration Tests (12)
  ✓ INT-001: Full End-to-End Flow (2)
  ✓ INT-002: Two-Stage Authorization (2)
  ✓ INT-003: Privilege Elevation (1)
  ✓ INT-004: Privilege Reduction (1)
  ✓ INT-005: Cache Hit Rate (1)
  ✓ INT-006: No Cache (1)
  ✓ INT-007: JWT Refresh During Session (1)
  ✓ INT-008: Multiple Audiences (1)
  ✓ Error Handling (3)

Test Files  1 passed (1)
     Tests  12 passed (12)
```

### 3. Run Performance Tests

**Terminal 2:**
```bash
# Run all performance tests
npm run test:phase3:performance

# With environment variables
source .env.test && npm run test:phase3:performance
```

**Expected Output:**
```
✓ Phase 3: Performance Benchmarks (4)
  ✓ PERF-001: Token Exchange Latency (Cache Disabled)
    Min: 142.31ms
    P50: 165.42ms
    P99: 287.91ms
  ✓ PERF-002: Cache Hit Latency (Cache Enabled)
    Min: 8.21ms
    P50: 12.45ms
    P99: 45.67ms
  ✓ PERF-003: Cache Hit Rate
    Total calls: 200
    Cache hits: 178
    Cache hit rate: 89.0%
  ✓ PERF-004: Latency Reduction
    Average latency (no cache): 175.23ms
    Average latency (with cache): 15.67ms
    Latency reduction: 91.1%

✓ Phase 3: Load & Stress Tests (6)
  ✓ LOAD-001: 100 concurrent sessions (cache disabled)
    Total time: 8.45s
    Throughput: 118.3 calls/sec
  ✓ LOAD-002: 100 concurrent sessions (cache enabled)
    Total time: 2.12s
    Throughput: 471.7 calls/sec
```

---

## Test Scenarios

### Integration Tests (INT-xxx)

| Test ID | Description | Duration | Pass Criteria |
|---------|-------------|----------|---------------|
| INT-001 | Full end-to-end flow | 30s | No errors, valid responses |
| INT-002 | Two-stage authorization | 10s | Correct JWT usage |
| INT-003 | Privilege elevation (Alice: user → admin) | 5s | Admin operations succeed |
| INT-004 | Privilege reduction (Bob: admin → read-only) | 5s | Write operations restricted |
| INT-005 | Cache hit rate (20 calls) | 30s | >85% cache hits |
| INT-006 | No cache (20 calls) | 30s | Consistent latency |
| INT-007 | JWT refresh invalidates cache | 30s | New token forces re-exchange |
| INT-008 | Multiple audiences per session | 10s | Independent caching |
| INT-009 | Session timeout cleanup | Manual | Keys destroyed |
| INT-010 | Hot-reload configuration | Manual | Cache toggle works |

### Performance Tests (PERF-xxx)

| Test ID | Description | Target | Pass Criteria |
|---------|-------------|--------|---------------|
| PERF-001 | Token exchange latency (no cache) | p50<150ms, p99<300ms | Meets targets |
| PERF-002 | Cache hit latency | p50<1ms, p99<2ms | Fast cache reads |
| PERF-003 | Cache hit rate (200 calls) | >85% | Effective caching |
| PERF-004 | Latency reduction | >80% | Significant improvement |

### Load Tests (LOAD-xxx)

| Test ID | Description | Target | Pass Criteria |
|---------|-------------|--------|---------------|
| LOAD-001 | 100 sessions × 10 calls (no cache) | <10s total | Handles load |
| LOAD-002 | 100 sessions × 10 calls (with cache) | <3s total | Cache improves throughput |
| LOAD-003 | Memory usage (10K sessions) | <50MB growth | No leaks |
| LOAD-004 | CPU usage during cache ops | <5% overhead | Efficient caching |
| LOAD-005 | Cache eviction under pressure | Graceful | LRU eviction works |
| LOAD-006 | IDP failure handling | All complete | Graceful degradation |

---

## Troubleshooting

### Test Failures

#### "Failed to get access token: 401 Unauthorized"

**Cause:** Keycloak credentials incorrect or user not found

**Fix:**
1. Verify user exists: Keycloak Admin → Users → Search
2. Check password is correct: `Test123!`
3. Verify client secret in `.env.test` matches Keycloak

#### "MCP call failed: 401 Unauthorized"

**Cause:** JWT validation failed on MCP server

**Fix:**
1. Check Keycloak is running: `curl http://localhost:8080`
2. Verify JWKS endpoint accessible: `curl http://localhost:8080/realms/mcp_security/protocol/openid-connect/certs`
3. Check server logs for JWT validation errors

#### "Token exchange failed: 403 Forbidden"

**Cause:** Token exchange permissions not configured

**Fix:**
1. Navigate to Keycloak: Clients → `mcp-server-client` → Permissions
2. Enable "Permissions Enabled"
3. Configure token-exchange policy (allow `mcp-oauth`)

#### "Missing legacy_name claim"

**Cause:** User attribute or mapper not configured

**Fix:**
1. Check user has `legacyUsername` attribute
2. Verify `mcp-server-client` has mapper: `legacyUsername` → `legacy_name`

### Performance Issues

#### Cache hit rate <85%

**Possible Causes:**
- TTL too short (tokens expiring before reuse)
- Different queries creating unique cache keys
- JWT refreshing too frequently

**Fix:**
- Increase `ttlSeconds` to 120 or 300
- Use same query for cache hit rate tests
- Check token lifetime in Keycloak

#### Latency targets not met

**Possible Causes:**
- Network latency to Keycloak
- SQL Server performance issues
- CPU/memory constraints

**Fix:**
- Run Keycloak locally (not remote)
- Optimize SQL queries
- Increase server resources

---

## Manual Testing

### Test Token Exchange with curl

```bash
# Step 1: Get Subject Token
SUBJECT_TOKEN=$(curl -s -X POST \
  http://localhost:8080/realms/mcp_security/protocol/openid-connect/token \
  -d "client_id=mcp-oauth" \
  -d "client_secret=JUUA5xCJDQZdreWgEFYvfAqjJnGdTXXA" \
  -d "username=alice" \
  -d "password=Test123!" \
  -d "grant_type=password" | jq -r '.access_token')

echo "Subject Token acquired"

# Step 2: Perform Token Exchange
DELEGATION_TOKEN=$(curl -s -X POST \
  http://localhost:8080/realms/mcp_security/protocol/openid-connect/token \
  -d "client_id=mcp-server-client" \
  -d "client_secret=<YOUR_SECRET>" \
  -d "grant_type=urn:ietf:params:oauth:grant-type:token-exchange" \
  -d "subject_token=${SUBJECT_TOKEN}" \
  -d "subject_token_type=urn:ietf:params:oauth:token-type:access_token" \
  -d "audience=mcp-server-client" | jq -r '.access_token')

echo "Delegation Token acquired"

# Step 3: Decode tokens
echo "Subject Token Claims:"
echo $SUBJECT_TOKEN | jwt decode -

echo "Delegation Token Claims:"
echo $DELEGATION_TOKEN | jwt decode -

# Step 4: Call MCP Server
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SUBJECT_TOKEN}" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "user-info",
      "arguments": {}
    },
    "id": 1
  }' | jq .
```

---

## Long-Running Tests

### 24-Hour Memory Leak Test

**Purpose:** Verify no memory leaks with 10,000 sessions

**Setup:**
```bash
# Terminal 1: Start server with monitoring
export CONFIG_PATH=./test-harness/config/phase3-test-config.json
node --inspect dist/index.js
```

**Terminal 2: Run load generator**
```bash
# Create load generation script
cat > load-generator.sh <<'EOF'
#!/bin/bash
for i in {1..10000}; do
  TOKEN=$(curl -s -X POST http://localhost:8080/realms/mcp_security/protocol/openid-connect/token \
    -d "client_id=mcp-oauth" \
    -d "client_secret=JUUA5xCJDQZdreWgEFYvfAqjJnGdTXXA" \
    -d "username=loadtest" \
    -d "password=LoadTest123!" \
    -d "grant_type=password" | jq -r '.access_token')

  curl -s -X POST http://localhost:3000/mcp \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"sql-delegate","arguments":{"action":"query","sql":"SELECT 1","params":{}}},"id":1}' > /dev/null

  if [ $((i % 100)) -eq 0 ]; then
    echo "Completed $i sessions"
  fi

  sleep 1
done
EOF

chmod +x load-generator.sh
./load-generator.sh
```

**Monitor Memory:**
```bash
# Watch memory usage
watch -n 5 'ps aux | grep node | grep -v grep'

# Or use Chrome DevTools
# Navigate to chrome://inspect
# Click "inspect" on Node process
# Take heap snapshots periodically
```

**Pass Criteria:**
- Memory usage remains stable (<100MB growth over 24 hours)
- No heap snapshots show retained objects growing
- Server remains responsive

---

## Reporting Results

### Test Summary Template

```markdown
# Phase 3 Test Results

**Date:** 2025-01-08
**Tester:** [Your Name]
**Environment:** Development

## Integration Tests
- Total: 12 tests
- Passed: 12
- Failed: 0
- Duration: 3m 45s

## Performance Tests
- Token Exchange Latency (p50): 165ms ✅ (target: <150ms)
- Token Exchange Latency (p99): 287ms ✅ (target: <300ms)
- Cache Hit Latency (p50): 12ms ✅ (target: <50ms)
- Cache Hit Rate: 89% ✅ (target: >85%)
- Latency Reduction: 91% ✅ (target: >80%)

## Load Tests
- 100 concurrent sessions (no cache): 8.45s ✅ (target: <10s)
- 100 concurrent sessions (cache): 2.12s ✅ (target: <3s)
- Throughput: 471 calls/sec

## Issues Found
- None

## Recommendations
- All tests passing
- Ready for Phase 4 (Documentation & Production Readiness)
```

---

## Next Steps

After completing Phase 3 tests:

1. ✅ Review test results and verify all targets met
2. ✅ Document any issues found
3. ✅ Update [Docs/unified-oauth-progress.md](../Docs/unified-oauth-progress.md)
4. ✅ Mark Phase 3 deliverables as completed
5. ✅ Create git commit for Phase 3 completion
6. ✅ Proceed to Phase 4: Documentation & Production Readiness
