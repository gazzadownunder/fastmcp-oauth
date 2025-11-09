# Testing Documentation

**Framework Version**: v3.0
**Test Suite**: 23 test files, 447 tests passing ✅
**Status**: Production-ready
**Last Updated**: 2025-11-09

## Overview

The MCP OAuth framework includes two comprehensive testing approaches:

1. **Automated Test Suite** (`tests/`) - Unit and integration tests with vitest
2. **External Testing Harness** (`test-harness/`) - Real-world Keycloak integration tests

Both test suites validate the complete OAuth 2.1 On-Behalf-Of (OBO) delegation flow, RFC 8693 token exchange, and security requirements.

---

## Part 1: Automated Test Suite

### Test Statistics

```
Test Files:  23 passed (23)
Tests:       447 passed (447)
Duration:    ~6.5s
Coverage:    >90% across all modules
```

### Test Structure

```
tests/
├── unit/                           # Unit tests (isolated component testing)
│   ├── core/                       # Core authentication tests
│   │   ├── audit-service.test.ts           (20 tests)
│   │   ├── authentication-service.test.ts  (20 tests) ✅ Security regression fixed
│   │   ├── jwt-validator.test.ts           (30 tests)
│   │   ├── role-mapper.test.ts             (35 tests)
│   │   ├── session-manager.test.ts         (21 tests)
│   │   └── validators.test.ts              (16 tests)
│   ├── delegation/                 # Delegation layer tests
│   │   ├── encrypted-token-cache.test.ts   (29 tests)
│   │   ├── token-exchange.test.ts          (18 tests)
│   │   ├── registry.test.ts                (tests)
│   │   └── kerberos/
│   │       └── kerberos-module.test.ts     (14 tests)
│   ├── mcp/                        # MCP layer tests
│   │   ├── middleware.test.ts              (14 tests)
│   │   ├── server.test.ts                  (tests)
│   │   └── tools/
│   │       ├── health-check.test.ts        (18 tests)
│   │       └── user-info.test.ts           (20 tests)
│   └── config/                     # Configuration tests
│       ├── migrate.test.ts                 (tests)
│       └── schemas.test.ts                 (tests)
├── integration/                    # Integration tests (multi-component)
│   ├── core/
│   │   └── standalone.test.ts              (17 tests)
│   ├── delegation/
│   │   └── standalone.test.ts              (tests)
│   ├── mcp/
│   │   └── standalone.test.ts              (15 tests)
│   ├── phase1-extension.test.ts            (12 tests)
│   ├── phase2-corecontext-injection.test.ts (8 tests)
│   └── phase4-modularity.test.ts           (15 tests)
└── src/mcp/__tests__/              # In-source tests
    └── authorization.test.ts               (32 tests)
```

### Running Tests

#### All Tests
```bash
npm test                    # Run all tests with watch mode
npm test -- --run           # Run once without watch
```

#### Specific Test Categories
```bash
npm run test:unit           # Unit tests only (tests/unit/)
npm test -- jwt-validator   # Run specific test file
npm test -- --coverage      # Run with coverage report
```

#### Phase-Specific Tests
```bash
npm run test:phase3             # Phase 3 integration tests
npm run test:phase3:performance # Phase 3 performance tests
npm run test:sql                # SQL delegation tests
```

### Key Test Scenarios

#### 1. Authentication Service Tests (20 tests)

**File**: `tests/unit/core/authentication-service.test.ts`

**Critical Tests**:
- ✅ **GAP #1: Rejection Policy** - Invalid role claims result in rejection (not default role)
  - `null` role claims → `UNASSIGNED_ROLE` + `rejected: true`
  - `undefined` role claims → `UNASSIGNED_ROLE` + `rejected: true`
  - Invalid types (`123`, `false`) → `UNASSIGNED_ROLE` + `rejected: true`
  - Empty array `[]` → `defaultRole` ("guest") + `rejected: false`

- ✅ **GAP #3: Audit Source Field** - All audit entries include `source: "auth:service"`

- ✅ **Role Array Extraction** - Handles various role claim formats
  - String roles converted to arrays
  - Missing claims properly rejected
  - Array roles processed correctly

**Recent Fix (2025-11-09)**:
- Fixed security regression where `null`/`undefined` role claims were incorrectly granted guest access
- Now properly rejects invalid/malformed tokens with `UNASSIGNED_ROLE`

#### 2. Role Mapper Tests (35 tests)

**File**: `tests/unit/core/role-mapper.test.ts`

**Critical Tests**:
- ✅ **Never Throws Policy** - RoleMapper NEVER throws exceptions on any input
- ✅ **UNASSIGNED_ROLE Return** - Returns `UNASSIGNED_ROLE` for invalid inputs
- ✅ **Default Configuration** - Correctly maps admin/user/guest roles
- ✅ **Custom Roles** - Supports custom role definitions beyond standard roles
- ✅ **rejectUnmappedRoles Policy** - Optionally rejects unmapped roles

#### 3. JWT Validator Tests (30 tests)

**File**: `tests/unit/core/jwt-validator.test.ts`

**RFC 8725 Compliance Tests**:
- ✅ Algorithm validation (only RS256, ES256 allowed)
- ✅ Issuer (`iss`) validation
- ✅ Audience (`aud`) validation
- ✅ Expiration (`exp`) validation
- ✅ Not-before (`nbf`) validation
- ✅ Clock tolerance handling (max 5 minutes)
- ✅ JWKS fetching and caching
- ✅ Key rotation support

#### 4. Token Exchange Tests (18 tests)

**File**: `tests/unit/delegation/token-exchange.test.ts`

**RFC 8693 Token Exchange Tests**:
- ✅ Successful token exchange flow
- ✅ Claim extraction from TE-JWT (sub, aud, exp, legacy_name, roles, permissions)
- ✅ HTTPS-only enforcement for token endpoints
- ✅ Audit logging (success/failure)
- ✅ Error sanitization (no sensitive data leakage)
- ✅ Per-IDP configuration

#### 5. Encrypted Token Cache Tests (29 tests)

**File**: `tests/unit/delegation/encrypted-token-cache.test.ts`

**Security Tests**:
- ✅ Session-specific encryption keys (256-bit AES-GCM)
- ✅ AAD binding to requestor JWT (prevents impersonation)
- ✅ Automatic invalidation on JWT refresh
- ✅ TTL synchronization with token expiration
- ✅ Heartbeat-based session cleanup
- ✅ **Attack scenario tests**:
  - Impersonation attack (different JWT → decryption failure)
  - Replay attack (stolen ciphertext useless)
  - Spoofing attack (forged entry fails AAD validation)
  - Session key compromise (still requires JWT hash)

#### 6. MCP Middleware Tests (14 tests)

**File**: `tests/unit/mcp/middleware.test.ts`

**Critical Tests**:
- ✅ **GAP #1: Dual Rejection Checks**
  - Checks both `authResult.rejected` AND `session.rejected`
  - Prevents timing attacks where role is revoked after session creation
- ✅ Token extraction from Authorization header
- ✅ 401 response for missing/invalid tokens
- ✅ 403 response for rejected sessions

#### 7. Phase Integration Tests

**Phase 1: Extension API** (12 tests)
- ✅ Custom tool registration (`registerTool()`)
- ✅ Batch tool registration (`registerTools()`)
- ✅ Custom delegation module integration

**Phase 2: CoreContext Injection** (8 tests)
- ✅ CoreContext built with `satisfies CoreContext` operator (GAP #11)
- ✅ All services injected via CoreContext
- ✅ Type-safe dependency injection

**Phase 4: Modularity** (15 tests)
- ✅ Core framework independence (no SQL dependencies)
- ✅ Optional delegation packages (`@mcp-oauth/sql-delegation`, `@mcp-oauth/kerberos-delegation`)
- ✅ Zero delegation dependencies in core

### Test Configuration

**Framework**: Vitest v2.1.9
**Test Runner**: vitest
**Coverage Tool**: vitest coverage (c8)
**Timeout**: 2 minutes per test file

**vitest.config.ts**:
```typescript
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 120000,
    hookTimeout: 30000,
    coverage: {
      provider: 'c8',
      reporter: ['text', 'json', 'html'],
      exclude: ['**/node_modules/**', '**/dist/**', '**/*.test.ts']
    }
  }
});
```

### Critical Security Tests

#### Rejection Policy (GAP #1)

**What**: Invalid or missing role claims must result in rejection, not default role assignment

**Why**: Prevents malformed/malicious tokens from gaining access

**Test Scenarios**:
```typescript
// Scenario 1: null role claim (malicious/tampered token)
{ user_roles: null }
→ Expected: role: "unassigned", rejected: true ✅

// Scenario 2: Missing role claim (IDP misconfiguration)
{ /* no user_roles */ }
→ Expected: role: "unassigned", rejected: true ✅

// Scenario 3: Invalid type (corrupted token)
{ user_roles: 123 }
→ Expected: role: "unassigned", rejected: true ✅

// Scenario 4: Empty array (valid JWT, no roles)
{ user_roles: [] }
→ Expected: role: "guest", rejected: false ✅
```

**Implementation**: [src/core/authentication-service.ts:208-210](../src/core/authentication-service.ts#L208)

#### Audit Source Field (GAP #3)

**What**: All audit entries must include `source` field for traceability

**Why**: Enables security monitoring and incident response

**Test Scenarios**:
```typescript
// Success case
await authService.authenticate(validToken);
→ auditEntry.source === "auth:service" ✅

// Rejection case
await authService.authenticate(invalidRolesToken);
→ auditEntry.source === "auth:service" ✅
→ auditEntry.success === false ✅
```

---

## Part 2: External Testing Harness

**Location**: `test-harness/`
**Purpose**: Real-world OAuth flow testing with Keycloak IDP
**Status**: Complete and ready for testing
**Created**: 2025-09-30

### Overview

The testing harness provides an external test environment for validating the complete RFC 8693 token exchange flow with a real Keycloak instance. It integrates with Keycloak at `localhost:8080` to test the complete OAuth delegation functionality without modifying source code.

### Key Features

✅ **Real Keycloak Integration** - Uses actual Keycloak @ localhost:8080, no mocking
✅ **Complete OAuth Flow Testing** - Validates all three phases of delegation
✅ **Critical Security Validation** - Tests azp claim security (Subject vs Exchanged tokens)
✅ **SQL Delegation Testing** - Tests EXECUTE AS USER with real tokens
✅ **Zero Source Changes** - All test code is external to `src/`
✅ **Automated & Manual** - Scripts + TypeScript test scenarios
✅ **Docker SQL Server** - Isolated test database environment
✅ **Comprehensive Documentation** - Step-by-step guides included

### Directory Structure

```
test-harness/
├── config/                          # Configuration files
│   ├── keycloak-localhost.json      # Basic Keycloak config
│   ├── keycloak-oauth-only.json     # OAuth-only config
│   ├── v2-keycloak-oauth-only.json  # v2 OAuth config
│   ├── v2-keycloak-token-exchange.json # Token exchange config
│   ├── phase3-test-config.json      # Phase 3 integration config
│   └── test.env.example             # Environment variables template
├── keycloak-reference/              # Keycloak documentation
│   └── KEYCLOAK-SETUP.md           # Detailed setup guide
├── scripts/                         # Bash test scripts
│   ├── verify-keycloak.sh          # Verify Keycloak config
│   ├── 1-get-subject-token.sh      # Get Subject Token
│   ├── 2-exchange-token.sh         # Exchange token (RFC 8693)
│   ├── 3-test-mcp-tools.sh         # Test MCP tools
│   └── run-all-tests.sh            # Complete test suite
├── phase3-integration.test.ts       # Phase 3 integration tests
├── phase3-performance.test.ts       # Phase 3 performance tests
├── sql-delegation.test.ts           # SQL delegation tests
├── start-phase3-server.bat          # Windows server start script
└── README.md                        # Complete documentation
```

### Prerequisites

#### Keycloak Configuration

From `Docs/oauth2 details.docx`, your Keycloak instance should have:

1. **Realm**: Custom realm (e.g., `mcp-realm`)

2. **Client 1 - "contextflow"** (User Authentication):
   - Type: Public or Confidential
   - Grant Types: Authorization Code, Password (testing)
   - Audience: Must include `mcp-oauth`
   - Purpose: Issues Subject Tokens

3. **Client 2 - "mcp-oauth"** (Token Exchange):
   - Type: Confidential (required)
   - Client Authentication: ON
   - Service Accounts: Enabled
   - Grant Types: Token Exchange (RFC 8693)
   - Purpose: Performs token exchange

4. **User Attributes**:
   - Custom attribute: `legacy_sam_account`
   - Mapped to JWT claims via client scopes
   - Value format: `TESTDOMAIN\username`

5. **Test Users**:
   - `testuser` with password and `legacy_sam_account` attribute
   - `adminuser` with password and `legacy_sam_account` attribute

### Quick Start

#### 1. Configure Environment (2 minutes)

```bash
cd test-harness
cp config/test.env.example config/test.env
```

Edit `test.env` with your Keycloak details:
```bash
KEYCLOAK_REALM=your-realm-name
KEYCLOAK_CLIENT_SECRET_MCP=your-mcp-oauth-secret
TEST_USER_USERNAME=testuser
TEST_USER_PASSWORD=test123
```

#### 2. Verify Setup (1 minute)

```bash
./scripts/verify-keycloak.sh
```

#### 3. Run Tests (5 minutes)

```bash
./scripts/run-all-tests.sh
```

### OAuth Delegation Flow (What Gets Tested)

#### Phase 1: Subject Token Acquisition

**Script**: `scripts/1-get-subject-token.sh`

```
User → Keycloak → Subject Token
Client: contextflow
Grant: password (for testing)
```

**Subject Token Claims**:
```json
{
  "iss": "http://localhost:8080/realms/mcp-realm",
  "aud": ["contextflow", "mcp-oauth"],
  "azp": "contextflow",  // ← Identifies original client
  "sub": "user-uuid",
  "legacy_sam_account": "TESTDOMAIN\\testuser",
  "realm_access": {
    "roles": ["user", "sql_access"]
  }
}
```

#### Phase 2: Token Exchange (RFC 8693)

**Script**: `scripts/2-exchange-token.sh`

```
Subject Token → Keycloak Token Exchange Endpoint → Delegated Token
Client: mcp-oauth
Grant: urn:ietf:params:oauth:grant-type:token-exchange
```

**Exchanged Token Claims**:
```json
{
  "iss": "http://localhost:8080/realms/mcp-realm",
  "aud": ["mcp-oauth"],
  "azp": "mcp-oauth",  // ← Proves delegation!
  "sub": "user-uuid",
  "legacy_sam_account": "TESTDOMAIN\\testuser",
  "realm_access": {
    "roles": ["user", "sql_access"]
  }
}
```

#### Phase 3: Resource Server Validation

**Script**: `scripts/3-test-mcp-tools.sh`

```
Exchanged Token → MCP Server → Validates azp claim → Performs SQL delegation
```

**Critical Security Check**:
- Subject Token (azp: contextflow) → **REJECTED** ✓
- Exchanged Token (azp: mcp-oauth) → **ACCEPTED** ✓

### Phase 3 Integration Tests

**File**: `test-harness/phase3-integration.test.ts`

**What It Tests**:
- ✅ Token exchange with real Keycloak
- ✅ MCP tool access with exchanged tokens
- ✅ SQL delegation with EXECUTE AS USER
- ✅ Role-based authorization
- ✅ Error handling and rejection scenarios

**Run Tests**:
```bash
npm run test:phase3
```

### Phase 3 Performance Tests

**File**: `test-harness/phase3-performance.test.ts`

**What It Tests**:
- ✅ Token exchange latency (<300ms)
- ✅ Cache hit rates (>85%)
- ✅ Concurrent request handling
- ✅ Memory usage under load

**Run Tests**:
```bash
npm run test:phase3:performance
```

---

## Test Coverage Summary

### By Layer

| Layer | Test Files | Test Count | Coverage |
|-------|-----------|------------|----------|
| Core | 6 files | 142 tests | >95% |
| Delegation | 4 files | 61 tests | >90% |
| MCP | 5 files | 99 tests | >90% |
| Integration | 6 files | 67 tests | >85% |
| Config | 2 files | - | >90% |
| Authorization | 1 file | 32 tests | >95% |
| **Total** | **23 files** | **447 tests** | **>90%** |

### Critical Security Coverage

| Security Requirement | Test File | Status |
|---------------------|-----------|--------|
| Invalid role claim rejection (GAP #1) | authentication-service.test.ts | ✅ Fixed |
| Audit source field (GAP #3) | authentication-service.test.ts | ✅ Pass |
| Dual rejection checks (GAP #1) | middleware.test.ts | ✅ Pass |
| Never-throw RoleMapper | role-mapper.test.ts | ✅ Pass |
| RFC 8725 JWT validation | jwt-validator.test.ts | ✅ Pass |
| RFC 8693 token exchange | token-exchange.test.ts | ✅ Pass |
| AES-256-GCM encryption | encrypted-token-cache.test.ts | ✅ Pass |
| AAD binding (impersonation) | encrypted-token-cache.test.ts | ✅ Pass |
| azp claim validation | phase3-integration.test.ts | ✅ Pass |

---

## Continuous Integration

### GitHub Actions (Recommended)

```yaml
name: Test Suite
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run build
      - run: npm test -- --run
      - run: npm run test:coverage
```

### Local Pre-Commit Hook

```bash
#!/bin/sh
# .git/hooks/pre-commit
npm test -- --run || exit 1
```

---

## Troubleshooting

### Common Test Failures

**1. "Cannot find module" errors**
```bash
# Solution: Rebuild project
npm run build
```

**2. "Test timeout" errors**
```bash
# Solution: Increase timeout in vitest.config.ts
testTimeout: 180000  # 3 minutes
```

**3. "Connection refused" in phase3 tests**
```bash
# Solution: Ensure Keycloak is running
docker ps | grep keycloak
```

**4. "ECONNREFUSED localhost:3000"**
```bash
# Solution: Start MCP server first
npm start
```

### Test Debugging

**Enable verbose logging**:
```bash
DEBUG=* npm test -- jwt-validator
```

**Run single test**:
```bash
npm test -- -t "should reject invalid role claims"
```

**Generate coverage report**:
```bash
npm test -- --coverage
open coverage/index.html
```

---

## References

### Automated Test Suite
- **Test Files**: [tests/](../tests/)
- **Test Configuration**: [vitest.config.ts](../vitest.config.ts)
- **Package Scripts**: [package.json](../package.json)

### External Testing Harness
- **Test Harness Documentation**: [test-harness/README.md](../test-harness/README.md)
- **Quick Start Guide**: [test-harness/QUICKSTART.md](../test-harness/QUICKSTART.md)
- **Keycloak Setup**: [test-harness/keycloak-reference/KEYCLOAK-SETUP.md](../test-harness/keycloak-reference/KEYCLOAK-SETUP.md)

### Project Documentation
- **OAuth Flow**: [oauth2 implementation.md](oauth2 implementation.md)
- **Framework Architecture**: [../CLAUDE.md](../CLAUDE.md)
- **Project README**: [../README.md](../README.md)

---

## Summary

The MCP OAuth framework includes comprehensive testing at all levels:

✅ **447 automated tests** covering unit, integration, and security scenarios
✅ **>90% code coverage** across all modules
✅ **External test harness** for real-world Keycloak integration
✅ **Security regression fixes** (2025-11-09) - Invalid role claims now properly rejected
✅ **CI/CD ready** with fast test execution (~6.5s)
✅ **Production-ready** with full test coverage of critical security requirements

**Test Execution Time**: 6.5 seconds
**Total Test Count**: 447 tests
**Pass Rate**: 100% ✅
**Last Verified**: 2025-11-09
