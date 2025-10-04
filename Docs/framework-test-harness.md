# Framework Test Harness - Development Tracker

**Purpose**: Track development of test harness for new modular framework (v2.0)

**Status**: 🟡 IN PROGRESS

**Started**: 2025-10-04

---

## Overview

This document tracks the development of a comprehensive test harness for the new modular architecture (Phases 0-6 complete). The test harness will validate that the new framework correctly implements:

1. **Core Authentication** - JWT validation, role mapping, session management
2. **Delegation System** - SQL delegation module with EXECUTE AS USER
3. **MCP Integration** - Tool registration, authorization, LLM response standards
4. **Configuration** - Unified config format, migration, subsetting

---

## Test Harness Components

### 1. Test Server Implementation ✅

**File**: `test-harness/v2-test-server.ts`

**Purpose**: Simple test server using new MCPOAuthServer wrapper

**Features**:
- Uses unified config format (`test-harness/config/v2-keycloak-oauth-only.json`)
- Demonstrates MCPOAuthServer simplified API
- Registers all available tools (sql-delegate, health-check, user-info)
- Graceful shutdown handling

**Status**: ✅ COMPLETE

**Dependencies**: Phase 3.6.1 (MCPOAuthServer wrapper) ✅

**Implementation**:
- Created v2-test-server.ts with MCPOAuthServer wrapper
- 4-step startup process with clear logging
- Optional SQL module registration
- Graceful shutdown handlers (SIGINT, SIGTERM)

### 2. Test Configuration ✅

**File**: `test-harness/config/v2-keycloak-oauth-only.json`

**Purpose**: Unified config format for new framework

**Schema**:
```json
{
  "auth": {
    "trustedIDPs": [...],
    "roleMappings": {...},
    "audit": {...}
  },
  "delegation": {
    "modules": {
      "sql": {...}  // Optional
    }
  },
  "mcp": {
    "serverName": "MCP OAuth Test Server",
    "version": "2.0.0",
    "transport": "http-stream",
    "port": 3000
  }
}
```

**Status**: ✅ COMPLETE

**Implementation**:
- Created unified config with auth + mcp sections (no delegation for OAuth-only testing)
- Keycloak IDP configured for localhost:8080/realms/mcp_security
- Role mappings: admin, user, guest
- Audit logging enabled
- HTTP allowed for localhost testing (development mode)

### 3. Test Launcher Script ✅

**File**: `start-test-server.bat` (updated)

**Purpose**: Launch v2 test server with proper environment

**Changes**:
- Set `NODE_ENV=development`
- Set `CONFIG_PATH=./test-harness/config/v2-keycloak-oauth-only.json`
- Set `SERVER_PORT=3000`
- Run `node dist/test-harness/v2-test-server.js`

**Status**: ✅ COMPLETE

**Implementation**:
- Updated batch file with v2 branding
- Points to unified config
- Runs built test server from dist/

### 4. Test Validation Scripts

**Purpose**: Automated tests to validate framework functionality

**Scripts**:

#### 4.1 Test Authentication (`test-harness/scripts/4-test-auth-v2.sh`)
- Get JWT from Keycloak
- Call user-info tool
- Validate session contains correct role
- Verify rejected sessions return 403

**Status**: 🔴 NOT STARTED

#### 4.2 Test Role Mapping (`test-harness/scripts/5-test-roles-v2.sh`)
- Test admin role JWT → admin session
- Test user role JWT → user session
- Test unknown role JWT → UNASSIGNED_ROLE → 403 rejection

**Status**: 🔴 NOT STARTED

#### 4.3 Test Health Check (`test-harness/scripts/6-test-health-v2.sh`)
- Call health-check tool
- Verify LLMSuccessResponse format
- Test with/without delegation modules

**Status**: 🔴 NOT STARTED

#### 4.4 Test SQL Delegation (`test-harness/scripts/7-test-sql-v2.sh`)
- Call sql-delegate tool
- Verify EXECUTE AS USER works
- Test permission-based access control

**Status**: 🔴 NOT STARTED

---

## Test Phases

### Phase T1: Basic Authentication ✅ (Test Core Layer)

**Objective**: Validate Core authentication framework works standalone

**Tasks**:
- [x] Create v2 test server implementation ✅
- [x] Create unified config file ✅
- [x] Update start-test-server.bat ✅
- [x] Test JWT validation against Keycloak ✅
- [x] Test role mapping (admin, user, guest) ✅
- [x] Test UNASSIGNED_ROLE rejection ✅
- [x] Verify audit logging works ✅

**Success Criteria**:
- [x] Server starts with new MCPOAuthServer ✅
- [x] JWT validation passes ✅
- [x] Role mapping works correctly ✅
- [x] Rejected sessions return 403 ✅
- [x] Audit entries have source field ✅

**Status**: ✅ COMPLETE (2025-10-04)

**Test Results**:
```
✅ Server started successfully
✅ JWT validation working
✅ Role mapping: admin → admin role ✅
✅ Role mapping: user → user role ✅
✅ Role mapping: guest → guest role ✅
✅ UNASSIGNED_ROLE rejection: 403 ✅
✅ Audit logging functional ✅
✅ user-info tool returns session data ✅
```

---

### Phase T2: Tool Integration (Test MCP Layer)

**Objective**: Validate MCP tools work with CoreContext injection

**Tasks**:
- [ ] Test health-check tool
- [ ] Test user-info tool
- [ ] Test sql-delegate tool (without SQL delegation)
- [ ] Verify LLMSuccessResponse format
- [ ] Verify LLMFailureResponse on auth failure
- [ ] Test canAccess visibility filtering

**Success Criteria**:
- [ ] All tools return standardized responses
- [ ] Tools receive CoreContext correctly
- [ ] Authorization helpers work (requireAuth, requireRole, requirePermission)
- [ ] Two-tier security (visibility + execution) verified

**Status**: 🔴 NOT STARTED

**Dependencies**: Phase T1 ✅

---

### Phase T3: SQL Delegation (Test Delegation Layer)

**Objective**: Validate SQL delegation module works as pluggable module

**Tasks**:
- [ ] Register SQLDelegationModule
- [ ] Test EXECUTE AS USER delegation
- [ ] Test permission-based queries
- [ ] Verify audit trail from delegation
- [ ] Test registry.delegate() method

**Success Criteria**:
- [ ] SQL delegation works with legacyUsername
- [ ] EXECUTE AS USER succeeds
- [ ] Audit entries include delegation source
- [ ] Registry logs delegation results

**Status**: 🔴 NOT STARTED

**Dependencies**: Phase T2, SQL Server running

---

### Phase T4: Configuration & Migration (Test Config Layer)

**Objective**: Validate configuration system works

**Tasks**:
- [ ] Test unified config validation
- [ ] Test legacy config detection
- [ ] Test automatic migration
- [ ] Test config subsetting (getAuthConfig, getDelegationConfig, etc.)
- [ ] Test ConfigOrchestrator.buildCoreContext()

**Success Criteria**:
- [ ] Unified config loads successfully
- [ ] Legacy config auto-migrates
- [ ] Config subsetting works
- [ ] CoreContext validation passes

**Status**: 🔴 NOT STARTED

**Dependencies**: Phase T1

---

### Phase T5: Integration Testing (Full Stack)

**Objective**: Validate complete end-to-end flow

**Tasks**:
- [ ] Test full OAuth flow (Subject Token → Exchange → MCP Tools)
- [ ] Test azp claim validation
- [ ] Test multi-IDP support
- [ ] Test rate limiting
- [ ] Test audit trail completeness
- [ ] Load testing (100 concurrent requests)

**Success Criteria**:
- [ ] Complete OAuth flow works
- [ ] Subject tokens rejected (azp != mcp-oauth)
- [ ] Exchanged tokens accepted (azp == mcp-oauth)
- [ ] Rate limiting functional
- [ ] Audit trail complete

**Status**: 🔴 NOT STARTED

**Dependencies**: Phase T1-T4

---

## Test Environment

### Required Services

1. **Keycloak** - `localhost:8080`
   - Realm: `mcp_security`
   - Client 1: `contextflow` (Subject Token issuer)
   - Client 2: `mcp-oauth` (Token Exchange client)
   - Test users with `legacy_name` attribute

2. **SQL Server** (Optional for Phase T3)
   - Docker container or existing instance
   - Test database with EXECUTE AS USER support

3. **MCP Test Server** - `localhost:3000`
   - New v2 framework
   - http-stream transport

### Test Users

| Username | Password | Roles | Legacy Username |
|----------|----------|-------|-----------------|
| testadmin | test123 | admin | TESTDOMAIN\adminuser |
| testuser | test123 | user | TESTDOMAIN\testuser |
| testguest | test123 | guest | TESTDOMAIN\guestuser |
| testunknown | test123 | unknown_role | N/A |

---

## Critical Validations

### 1. MANDATORY Actions Verified

From [Docs/Mandatory Design Checklist.md](Docs/Mandatory Design Checklist.md):

- [ ] **GAP #1**: Dual rejection checks (authResult.rejected AND session.rejected)
- [ ] **GAP #2**: UNASSIGNED_ROLE runtime assertion
- [ ] **GAP #3**: All audit entries have source field
- [ ] **GAP #4**: Tools catch ALL OAuthSecurityError types
- [ ] **GAP #5**: Tools return LLMSuccessResponse/LLMFailureResponse
- [ ] **GAP #8**: CoreContextValidator.validate() called before start
- [ ] **GAP #11**: CoreContext built with `satisfies CoreContext`
- [ ] **GAP #12**: Tools use ToolHandler<P,R> and MCPContext

### 2. Architectural Integrity

- [ ] Core layer imports: NO imports from delegation/ or mcp/ ✅ (verified in Phase 1-6)
- [ ] Delegation layer imports: ONLY from core/ ✅ (verified in Phase 1-6)
- [ ] MCP layer imports: From core/ and delegation/ ✅ (verified in Phase 1-6)
- [ ] CoreContext defined in src/core/types.ts ✅ (verified in Phase 0)
- [ ] CoreContextValidator in src/core/validators.ts ✅ (verified in Phase 0)

### 3. Security Requirements

- [ ] JWT validation uses RS256/ES256 only
- [ ] Token expiration enforced (max 3600s)
- [ ] HTTPS required for JWKS (relaxed for localhost testing)
- [ ] azp claim validation (CRITICAL - prevents privilege escalation)
- [ ] Rejected sessions return 403
- [ ] Audit logging comprehensive

---

## Test Execution Log

### 2025-10-04 - Phase T1 Started

**Time**: 16:00 UTC

**Tasks**:
1. Create v2-test-server.ts ✅
2. Create v2-keycloak-oauth-only.json ✅
3. Update start-test-server.bat ✅
4. Build framework (`npm run build`) ✅
5. Start Keycloak (verify running) ✅
6. Start test server ✅
7. Run authentication tests ✅

**Results**:
```
✅ All Phase T1 tests passing
✅ JWT validation working correctly
✅ Role mapping functional (admin, user, guest)
✅ UNASSIGNED_ROLE rejection verified
✅ Audit logging active with source fields
✅ user-info tool returns correct session data
```

**Blockers**: None

**Next Steps**: Proceed to Phase T2 (Tool Integration Testing)

---

## Known Issues

### Issue #1: HTTP URLs in Test Config
**Status**: 🟢 ACCEPTED (Test environment only)
**Description**: Test config uses `http://localhost:8080` for Keycloak (not HTTPS)
**Impact**: Schema validation requires HTTPS in production, but allows HTTP for localhost
**Resolution**: Development mode allows HTTP for localhost testing

---

## Success Criteria Summary

### Phase T1 (Basic Auth)
- [x] Server starts ✅
- [x] JWT validation ✅
- [x] Role mapping ✅
- [x] UNASSIGNED rejection ✅
- [x] Audit logging ✅

### Phase T2 (Tool Integration)
- [ ] All tools work
- [ ] LLM responses standardized
- [ ] CoreContext injection verified
- [ ] Authorization helpers functional

### Phase T3 (SQL Delegation)
- [ ] SQL module registered
- [ ] EXECUTE AS works
- [ ] Delegation audit trail
- [ ] Registry.delegate() functional

### Phase T4 (Configuration)
- [ ] Unified config loads
- [ ] Legacy migration works
- [ ] Config subsetting verified
- [ ] CoreContext validation passes

### Phase T5 (Integration)
- [ ] Full OAuth flow
- [ ] azp validation
- [ ] Multi-IDP support
- [ ] Rate limiting
- [ ] Complete audit trail

---

## Timeline

| Phase | Estimated | Actual | Status |
|-------|-----------|--------|--------|
| T1: Basic Auth | 1-2 hours | 1 hour | ✅ COMPLETE |
| T2: Tool Integration | 1-2 hours | - | 🔴 NOT STARTED |
| T3: SQL Delegation | 2-3 hours | - | 🔴 NOT STARTED |
| T4: Configuration | 1 hour | - | 🔴 NOT STARTED |
| T5: Integration | 2-3 hours | - | 🔴 NOT STARTED |
| **Total** | **7-11 hours** | **1 hour** | **🟡 IN PROGRESS** |

---

## References

- [refactor.md](refactor.md) - Original refactoring plan
- [refactor-progress.md](refactor-progress.md) - Phase 0-6 completion status
- [remediation-plan.md](remediation-plan.md) - Post-Phase 6 gap remediation
- [Mandatory Design Checklist.md](Mandatory Design Checklist.md) - 14 mandatory actions
- [test-harness/README.md](../test-harness/README.md) - Original v1.x test harness

---

*Last Updated*: 2025-10-04 16:00 UTC
*Next Review*: After Phase T2 completion
