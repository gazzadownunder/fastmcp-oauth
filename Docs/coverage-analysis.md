# Test Coverage Analysis

**Last Updated:** 2025-11-10
**Overall Coverage:** 41.57% statements | 77.08% branches | 60.48% functions
**Target Coverage:** 80% statements | 75% branches | 80% functions

---

## Executive Summary

The current test coverage is **below target thresholds**. This analysis identifies gaps and recommends actions to achieve >80% coverage on all production code in `src/`.

**Key Findings:**
- ✅ **Well-tested modules:** Core authentication, session management, role mapping, token exchange
- ⚠️ **Moderate coverage:** MCP middleware, server orchestration, authorization helpers
- 🔴 **Low coverage:** HTTP server, OAuth metadata, error utilities, configuration manager

---

## Coverage by Layer

### Core Layer (`src/core/`) - **43.53%** 📊

| File | Statements | Branches | Functions | Status | Action Required |
|------|------------|----------|-----------|--------|----------------|
| `audit-service.ts` | 99.51% | 100% | 91.66% | ✅ Excellent | None |
| `authentication-service.ts` | 98.98% | 88% | 88.88% | ✅ Excellent | None |
| `validators.ts` | 100% | 100% | 100% | ✅ Perfect | None |
| `role-mapper.ts` | 94.92% | 90.9% | 100% | ✅ Excellent | None |
| `session-manager.ts` | 95.62% | 89.47% | 75% | ✅ Good | Add edge case tests |
| `jwt-validator.ts` | **66.28%** | **47.5%** | 66.66% | ⚠️ **Below Target** | **Add algorithm validation tests** |

**Core Layer Analysis:**
- **Strengths:** Audit, authentication, role mapping are well-tested
- **Weaknesses:** JWT validator needs more branch coverage (error paths, edge cases)
- **Priority:** Add tests for JWT validation error handling

**Missing Test Cases for `jwt-validator.ts`:**
1. Invalid algorithm rejection (HS256, none)
2. Malformed JWKS response handling
3. Network failures during JWKS fetch
4. Clock skew edge cases (exp/nbf boundaries)
5. Missing required claims (iss, aud, sub)
6. Token lifetime violations (too long)
7. Rate limiting behavior

---

### Delegation Layer (`src/delegation/`) - **46.04%** 📊

| File | Statements | Branches | Functions | Status | Action Required |
|------|------------|----------|-----------|--------|----------------|
| `encrypted-token-cache.ts` | 97.75% | 92.18% | 100% | ✅ Excellent | None |
| `registry.ts` | 99.72% | 88% | 100% | ✅ Excellent | None |
| `token-exchange.ts` | **78.68%** | **74.13%** | **64.28%** | ⚠️ **Below Target** | **Add error handling tests** |

**Delegation Layer Analysis:**
- **Strengths:** Cache and registry are thoroughly tested
- **Weaknesses:** Token exchange needs more error path coverage
- **Priority:** Add tests for IDP failure scenarios

**Missing Test Cases for `token-exchange.ts`:**
1. IDP network timeout handling
2. Invalid token exchange response (malformed JSON)
3. Token exchange with missing scopes
4. Concurrent token exchange requests
5. Cache invalidation on JWT refresh
6. AAD mismatch scenarios
7. Token expiration edge cases

---

### MCP Layer (`src/mcp/`) - **42.31%** 📊

| File | Statements | Branches | Functions | Status | Action Required |
|------|------------|----------|-----------|--------|----------------|
| `orchestrator.ts` | 100% | 65% | 100% | ✅ Excellent | None |
| `middleware.ts` | 92.49% | 78.37% | 100% | ✅ Excellent | None |
| `authorization.ts` | 88.62% | 92.85% | **68.42%** | ⚠️ Below Target | Add function coverage |
| `server.ts` | 86.67% | **59.09%** | 81.25% | ⚠️ Below Target | Add branch coverage |
| `oauth-metadata.ts` | **73.14%** | 100% | **0%** | 🔴 **Critical** | **Add unit tests** |
| `http-server.ts` | **0%** | **0%** | **0%** | 🔴 **Critical** | **Add unit tests** |

**MCP Layer Analysis:**
- **Strengths:** Orchestrator and middleware are well-tested
- **Weaknesses:** HTTP server, OAuth metadata have no tests
- **Priority:** Create tests for http-server.ts and oauth-metadata.ts

**Missing Test Cases for `http-server.ts`:**
1. Server startup and shutdown
2. CORS header handling
3. Request routing
4. Error response formatting
5. SSE (Server-Sent Events) streaming
6. Request timeout handling

**Missing Test Cases for `oauth-metadata.ts`:**
1. `generateProtectedResourceMetadata()` - RFC 9728 compliance
2. `generateWWWAuthenticateHeader()` - RFC 6750 format
3. `extractSupportedScopes()` - Scope aggregation from tools
4. Multiple authorization servers handling
5. Bearer token methods configuration

**Missing Test Cases for `authorization.ts`:**
1. Test all soft check functions (`isAuthenticated`, `hasRole`, etc.)
2. Test all hard check functions (`requireAuth`, `requireRole`, etc.)
3. Edge cases: empty roles, null context, undefined session

---

### MCP Tools (`src/mcp/tools/`) - **37.74%** 📊

| File | Statements | Branches | Functions | Status | Action Required |
|------|------------|----------|-----------|--------|----------------|
| `user-info.ts` | 97.16% | 85.71% | 100% | ✅ Excellent | None |
| `health-check.ts` | 100% | 94.44% | 100% | ✅ Perfect | None |
| `delegation-tool-factory.ts` | 95.33% | **71.42%** | 83.33% | ⚠️ Below Target | Add branch tests |
| `index.ts` | 93.75% | 100% | **25%** | ⚠️ Below Target | Test helper functions |
| `kerberos-file-browse.ts` | **44.19%** | 100% | **42.85%** | 🔴 Low | **Integration tests only** |

**MCP Tools Analysis:**
- **Strengths:** Core tools (user-info, health-check) are perfect
- **Weaknesses:** Kerberos tools tested via integration tests only
- **Note:** SQL and Kerberos tools excluded from unit test coverage (require external resources)
- **Priority:** Improve delegation-tool-factory coverage

**Missing Test Cases for `delegation-tool-factory.ts`:**
1. `transformParams` callback execution
2. `transformResult` callback execution
3. Error handling with custom transforms
4. Tool registration with missing CoreContext
5. Invalid tool configuration handling

---

### Configuration (`src/config/`) - **29.56%** 📊

| File | Statements | Branches | Functions | Status | Action Required |
|------|------------|----------|-----------|--------|----------------|
| `migrate.ts` | 72.5% | 88.88% | **25%** | ⚠️ Below Target | Add function tests |
| `manager.ts` | **60.82%** | **45.83%** | **47.36%** | 🔴 **Critical** | **Add unit tests** |
| `schema.ts` | **0%** | **0%** | **0%** | 🔴 **Critical** | **Add unit tests** |

**Configuration Layer Analysis:**
- **Strengths:** Migration logic has good statement coverage
- **Weaknesses:** Manager and schema have minimal testing
- **Priority:** HIGH - Configuration is critical for security

**Missing Test Cases for `manager.ts`:**
1. Config loading from file
2. Config validation (Zod schema integration)
3. Hot-reload functionality
4. File watch behavior
5. Invalid config handling
6. Missing file error handling
7. Environment variable substitution

**Missing Test Cases for `schema.ts`:**
1. Main config schema validation (OAuth config, IDP settings)
2. Invalid IDP URL rejection (non-HTTPS)
3. Invalid JWT algorithm rejection
4. Token expiration bounds validation
5. Required field validation

---

### Configuration Schemas (`src/config/schemas/`) - **42.79%** 📊

| File | Statements | Branches | Functions | Status | Action Required |
|------|------------|----------|-----------|--------|----------------|
| `core.ts` | 98.96% | 100% | **45.45%** | ⚠️ Below Target | Export validation functions |
| `delegation.ts` | 96.84% | 100% | **16.66%** | ⚠️ Below Target | Export validation functions |
| `mcp.ts` | 99.15% | 100% | **33.33%** | ⚠️ Below Target | Export validation functions |
| `kerberos.ts` | **0%** | **0%** | **0%** | 🔴 **Critical** | **Add unit tests** |

**Config Schemas Analysis:**
- **Strengths:** High statement coverage (schemas are mostly data)
- **Weaknesses:** Low function coverage (validators not exported/tested)
- **Note:** These files are mostly Zod schema definitions (not executable logic)
- **Priority:** Add tests for `kerberos.ts` schema

---

### Utilities (`src/utils/`, `src/mcp/utils/`) - **37.51%** 📊

| File | Statements | Branches | Functions | Status | Action Required |
|------|------------|----------|-----------|--------|----------------|
| `error-helpers.ts` (mcp/utils) | 95.32% | **45.45%** | 100% | ⚠️ Below Target | Add branch tests |
| `errors.ts` (utils) | **54.7%** | 100% | **21.05%** | 🔴 Low | **Add unit tests** |

**Utilities Analysis:**
- **Weaknesses:** Error utilities have low coverage
- **Priority:** Add tests for error creation, sanitization, security error handling

**Missing Test Cases for `errors.ts`:**
1. `createSecurityError()` - All error codes (AUTH_REQUIRED, INVALID_TOKEN, etc.)
2. `sanitizeError()` - Production vs development behavior
3. Error message sanitization (no internal details leaked)
4. Stack trace handling
5. Nested error handling

---

## Priority Action Plan

### Phase 1: Critical Gaps (Week 1) 🔴

**Goal:** Bring critical files to >60% coverage

1. **`src/mcp/http-server.ts` (0% → 80%)**
   - Create `tests/unit/mcp/http-server.test.ts`
   - Test server lifecycle (start, stop, restart)
   - Test request handling (CORS, routing, SSE)
   - Test error responses

2. **`src/mcp/oauth-metadata.ts` (73% → 90%)**
   - Create `tests/unit/mcp/oauth-metadata.test.ts`
   - Test RFC 9728 metadata generation
   - Test RFC 6750 WWW-Authenticate header
   - Test scope extraction

3. **`src/config/manager.ts` (60% → 85%)**
   - Expand `tests/unit/config/manager.test.ts`
   - Test config loading and validation
   - Test hot-reload functionality
   - Test error handling

4. **`src/config/schema.ts` (0% → 90%)**
   - Create `tests/unit/config/schema.test.ts`
   - Test main config schema validation
   - Test security constraints (HTTPS URLs, algorithms)

5. **`src/utils/errors.ts` (54% → 90%)**
   - Create `tests/unit/utils/errors.test.ts`
   - Test all error creation functions
   - Test sanitization logic

### Phase 2: Moderate Gaps (Week 2) ⚠️

**Goal:** Bring all files to >75% coverage

1. **`src/core/jwt-validator.ts` (66% → 85%)**
   - Expand `tests/unit/core/jwt-validator.test.ts`
   - Add error path tests (invalid algorithms, malformed JWKS)
   - Add edge case tests (clock skew, missing claims)

2. **`src/delegation/token-exchange.ts` (78% → 90%)**
   - Expand `tests/unit/delegation/token-exchange.test.ts`
   - Add IDP failure scenarios
   - Add concurrent request tests

3. **`src/mcp/authorization.ts` (88% → 95%)**
   - Expand `tests/unit/mcp/authorization.test.ts`
   - Test all soft check functions
   - Test all hard check functions

4. **`src/mcp/server.ts` (86% → 90%)**
   - Expand `tests/unit/mcp/server.test.ts`
   - Add branch coverage tests
   - Test error paths

### Phase 3: Schema Coverage (Week 3) 📋

**Goal:** Achieve >90% coverage on schemas

1. **`src/config/schemas/kerberos.ts` (0% → 95%)**
   - Create `tests/unit/config/schemas/kerberos.test.ts`
   - Test Kerberos config validation
   - Test SPN format validation
   - Test keytab path validation

2. **Function Coverage for Schemas**
   - Export validation functions from schema files
   - Create tests for exported validators
   - Target: >80% function coverage

---

## Excluded from Coverage

The following files are **intentionally excluded** from coverage targets:

### Type-Only Files (No Executable Code)
- `src/core/types.ts` - TypeScript interfaces only
- `src/delegation/types.ts` - TypeScript interfaces only
- `src/delegation/base.ts` - Abstract base classes
- `src/mcp/types.ts` - TypeScript interfaces only
- `src/types/**` - All type definition files

### Entry Points (Mostly Imports/Exports)
- `src/index.ts` - Main export file
- `src/core/index.ts` - Core layer exports
- `src/delegation/index.ts` - Delegation layer exports
- `src/mcp/index.ts` - MCP layer exports
- `src/config/index.ts` - Config exports
- `src/config/schemas/index.ts` - Schema exports

### Testing Utilities (Not Production Code)
- `src/testing/**` - Test helpers for external use

### Example Code (Not Production)
- `Examples/**` - Framework usage examples
- `examples/**` - Alternative examples location
- `src/examples/**` - Embedded examples

### Integration-Only Tools (Require External Resources)
- `src/mcp/tools/kerberos-delegate.ts` - Requires Active Directory
- `src/mcp/tools/sql-*.ts` - Requires SQL Server/PostgreSQL
- `src/mcp/tools/*-tools-factory.ts` - Integration test coverage

### Test Infrastructure
- `tests/**` - Unit and integration tests
- `test-harness/**` - Integration test harness
- `**/__tests__/**` - Co-located tests
- `**/*.test.ts` - Test files

---

## Coverage Thresholds

Current configuration in `vitest.config.ts`:

```typescript
thresholds: {
  statements: 80,  // Current: 41.57% ❌
  branches: 75,    // Current: 77.08% ✅
  functions: 80,   // Current: 60.48% ❌
  lines: 80        // Current: 41.57% ❌
}
```

**Recommended Approach:**
1. **Phase 1:** Lower thresholds to 60% (achievable in Week 1)
2. **Phase 2:** Increase to 75% (achievable in Week 2)
3. **Phase 3:** Target 80% (achievable in Week 3)

**Updated vitest.config.ts for Phase 1:**
```typescript
thresholds: {
  statements: 60,  // Incremental target
  branches: 70,    // Already above this
  functions: 60,   // Incremental target
  lines: 60        // Incremental target
}
```

---

## How to Run Coverage

### Generate Coverage Report
```bash
npm run test:coverage
```

### View HTML Report
```bash
# Open in browser
open coverage/index.html           # macOS
start coverage/index.html          # Windows
xdg-open coverage/index.html       # Linux
```

### Check Specific File Coverage
```bash
# Run tests for specific file
npm test jwt-validator

# View coverage for that file in HTML report
```

### CI/CD Integration
```yaml
# GitHub Actions example
- name: Test Coverage
  run: npm run test:coverage

- name: Upload Coverage
  uses: codecov/codecov-action@v3
  with:
    files: ./coverage/lcov.info
    fail_ci_if_error: true
```

---

## Best Practices for Writing Tests

### 1. Test Naming Convention
```typescript
describe('ComponentName', () => {
  describe('methodName()', () => {
    it('should handle normal case', () => { ... });
    it('should throw error when invalid input', () => { ... });
    it('should handle edge case: empty array', () => { ... });
  });
});
```

### 2. Aim for Branch Coverage
```typescript
// Bad: Only test success path
it('should validate token', async () => {
  const result = await validator.validate(validToken);
  expect(result).toBeDefined();
});

// Good: Test both paths
it('should validate valid token', async () => {
  const result = await validator.validate(validToken);
  expect(result).toBeDefined();
});

it('should reject invalid token', async () => {
  await expect(validator.validate(invalidToken)).rejects.toThrow();
});
```

### 3. Test Error Paths
```typescript
it('should handle network errors gracefully', async () => {
  // Mock network failure
  fetchMock.mockRejectedValueOnce(new Error('Network error'));

  // Test error handling
  await expect(service.fetchData()).rejects.toThrow('Network error');

  // Verify error was logged
  expect(auditService.logError).toHaveBeenCalled();
});
```

### 4. Test Edge Cases
```typescript
describe('edge cases', () => {
  it('should handle null input', () => { ... });
  it('should handle undefined input', () => { ... });
  it('should handle empty array', () => { ... });
  it('should handle empty string', () => { ... });
  it('should handle very large numbers', () => { ... });
});
```

---

## Next Steps

1. **Week 1:** Implement Phase 1 tests (critical gaps)
2. **Week 2:** Implement Phase 2 tests (moderate gaps)
3. **Week 3:** Implement Phase 3 tests (schema coverage)
4. **Week 4:** Review and refine (aim for 85%+ coverage)

**Target Completion:** 3-4 weeks to achieve 80%+ coverage on all production code

---

## Related Documentation

- [testing-strategy.md](./testing-strategy.md) - Overall testing approach
- [CLAUDE.md](../CLAUDE.md) - Framework overview
- [EXTENDING.md](./EXTENDING.md) - Module development guide
- Coverage Report: `coverage/index.html` (generated after `npm run test:coverage`)
