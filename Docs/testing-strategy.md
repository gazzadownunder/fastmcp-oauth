# Testing Strategy

This document explains the testing approach for the FastMCP OAuth On-Behalf-Of (OBO) Framework and how each test type fits into the development and release cycle.

## Table of Contents

- [Overview](#overview)
- [Test Categories](#test-categories)
- [Test Scripts Reference](#test-scripts-reference)
- [Development Workflow](#development-workflow)
- [CI/CD Integration](#cicd-integration)
- [Test Environment Setup](#test-environment-setup)

---

## Overview

The framework uses a **layered testing strategy** that mirrors the modular architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                    Testing Pyramid                          │
│                                                             │
│  E2E (Manual)         │ Manual testing with real IDPs      │
│  ──────────────────────────────────────────────────────────┤
│  Integration Tests    │ test:integration, test:performance │
│  ──────────────────────────────────────────────────────────┤
│  Unit Tests           │ test, test:unit, test:coverage     │
│  ──────────────────────────────────────────────────────────┤
│  Type Checking        │ typecheck                          │
│  ──────────────────────────────────────────────────────────┤
│  Linting/Formatting   │ lint, format                       │
└─────────────────────────────────────────────────────────────┘
```

**Test Configuration Files:**
- `vitest.config.ts` - Unit tests (fast, isolated, no external dependencies)
- `vitest.integration.config.ts` - Integration tests (requires running server + IDP)

---

## Test Categories

### 1. Type Checking

**Command:** `npm run typecheck`

**What it does:**
- Runs TypeScript compiler (`tsc --noEmit`) to validate types across entire codebase
- Checks all workspaces (core framework + optional packages)
- No code generation, only type validation

**When to run:**
- ✅ **Before every commit** - Catch type errors early
- ✅ **During development** - IDE integration provides real-time feedback
- ✅ **CI/CD pipeline** - Required check before merge

**Use case:**
```bash
# Quick type check before committing
npm run typecheck
```

**Why it matters:**
- TypeScript provides compile-time safety
- Prevents runtime errors from type mismatches
- Documents API contracts through interfaces
- Ensures layered architecture compliance (no circular dependencies)

---

### 2. Linting & Formatting

**Commands:**
- `npm run lint` - Check code style violations
- `npm run lint:fix` - Auto-fix linting issues
- `npm run format` - Format code with Prettier

**What it does:**
- ESLint checks TypeScript code against style rules
- Prettier enforces consistent code formatting
- Catches potential bugs (unused variables, unreachable code)

**When to run:**
- ✅ **Pre-commit hook** - Automatically format before commit
- ✅ **Code review** - Ensure consistent style across team
- ✅ **CI/CD pipeline** - Enforce code quality standards

**Use case:**
```bash
# Before committing code
npm run lint:fix
npm run format
```

---

### 3. Unit Tests

**Commands:**
- `npm test` - Run all unit tests (watch mode)
- `npm run test:unit` - Run only `tests/unit/**` directory
- `npm run test:coverage` - Generate coverage report

**What it does:**
- Tests individual functions/classes in isolation
- Uses mocks for external dependencies (no real IDP, SQL, etc.)
- Fast execution (<5 seconds for full suite)
- Coverage target: >80% for core framework

**Test structure:**
```
tests/unit/
├── config/          # Configuration schema validation
│   ├── schemas.test.ts       # Zod schema validation
│   └── migrate.test.ts       # Config migration logic
├── core/            # Core authentication framework
│   ├── jwt-validator.test.ts       # JWT validation (RFC 8725)
│   ├── authentication-service.test.ts
│   ├── session-manager.test.ts
│   ├── role-mapper.test.ts
│   ├── audit-service.test.ts
│   └── validators.test.ts
├── delegation/      # Token exchange & caching
│   ├── token-exchange.test.ts
│   ├── encrypted-token-cache.test.ts
│   ├── registry.test.ts
│   └── kerberos/kerberos-module.test.ts
└── mcp/             # FastMCP integration
    ├── middleware.test.ts
    ├── server.test.ts
    ├── tools/
    │   ├── user-info.test.ts
    │   └── health-check.test.ts
    └── __tests__/authorization.test.ts
```

**When to run:**
- ✅ **During development (watch mode)** - `npm test`
- ✅ **Before committing** - Verify changes don't break existing code
- ✅ **After bug fix** - Add regression test
- ✅ **CI/CD pipeline** - Required for merge

**Use case:**
```bash
# Development workflow (watch mode)
npm test

# Run tests for specific file
npm test jwt-validator

# Generate coverage report
npm run test:coverage
```

**Coverage reports:**
- HTML report: `coverage/index.html`
- Text summary in terminal
- JSON report for CI tools

**Excluded from unit tests (per vitest.config.ts):**
- `tests/unit/jwt-validator.test.ts` (legacy v1.x - deprecated)
- `tests/integration/basic-functionality.test.ts` (legacy v1.x)
- Integration tests (run separately)

---

### 4. Integration Tests

**Commands:**
- `npm run test:integration` - End-to-end flow tests
- `npm run test:performance` - Performance benchmarks
- `npm run test:sql` - SQL delegation tests (optional)

**What it does:**
- Tests **running server** with real external dependencies
- Validates full OAuth flow: Client → IDP → MCP Server → Resource
- Requires Keycloak IDP + test users configured
- Slower execution (30-120 seconds per suite)

**Prerequisites:**
1. **Build the project:**
   ```bash
   npm run build
   ```

2. **Start MCP Server:**
   ```bash
   npm start
   # Server runs on http://localhost:3000
   ```

3. **Keycloak IDP must be running:**
   - Configured per [Docs/idp-configuration-requirements.md](../Docs/idp-configuration-requirements.md)
   - Test users: alice, bob, charlie, dave
   - Clients: `mcp-oauth` (public), `mcp-server-client` (confidential)

4. **Run tests:**
   ```bash
   npm run test:integration
   npm run test:performance
   ```

**Safety checks:**
- Tests verify server is running before execution
- Clear error messages if prerequisites are missing
- Fail fast if IDP is unreachable

#### 4a. Integration Tests (`test:integration`)

**File:** `test-harness/integration.test.ts`

**Test suite:**
```
INT-001: Full End-to-End Flow
  ✅ Request → JWT validation → Tool dispatch

INT-002: JWT Claims Validation
  ✅ Validate requestor JWT structure
  ✅ Verify required OIDC claims

INT-003: Role Mapping
  ✅ Map JWT roles to application roles
  ✅ Handle multiple role assignments

INT-004: MCP Tool Access Control
  ✅ Authenticated access to user-info tool
  ✅ Health check tool accessibility

INT-005: Session Management
  ✅ Multiple concurrent tool calls
  ✅ Repeated calls with same token

Error Handling:
  ✅ Expired token rejection
  ✅ Invalid token rejection
```

**When to run:**
- ✅ **Before release** - Validate full OAuth flow
- ✅ **After configuration changes** - Ensure IDP integration works
- ✅ **CI/CD staging environment** - E2E validation

#### 4b. Performance Tests (`test:performance`)

**File:** `test-harness/performance.test.ts`

**Test suite:**
```
PERF-001: Token Exchange Latency (Cache Disabled)
  Target: p50 <150ms, p99 <300ms
  Measures: IDP round-trip time

PERF-002: Cache Hit Latency (Cache Enabled)
  Target: p50 <50ms, p99 <100ms
  Measures: Encrypted token cache performance

PERF-003: Cache Hit Rate Measurement
  Target: >85% cache hit rate with 60s TTL

PERF-004: Latency Reduction with Cache
  Target: >50% latency reduction (local IDP)
  Target: >80% reduction (remote IDP)

LOAD-001: Concurrent Requests (Fresh Tokens)
  50 concurrent requests with unique tokens
  Target: <5s for concurrent MCP requests

LOAD-002: Concurrent Requests (Shared Token)
  200 concurrent requests with shared token
  Target: <2s (validates cache efficiency)

LOAD-003: Memory Usage Monitoring
  Server health metrics collection

LOAD-004: CPU Usage Monitoring
  Server-side CPU tracking

LOAD-005: Cache Eviction Under Pressure
  LRU eviction when size limits reached

LOAD-006: IDP Failure Handling
  Graceful degradation when IDP unavailable
```

**When to run:**
- ✅ **Before release** - Validate performance targets
- ✅ **After optimization** - Measure improvements
- ✅ **Capacity planning** - Understand scalability limits
- ⚠️ **NOT in CI/CD** - Performance tests are too variable for automated pass/fail

**Use case:**
```bash
# Run performance benchmarks
npm run test:performance

# Results show latency percentiles
# PERF-001: p50=120ms, p95=200ms, p99=280ms ✅
```

#### 4c. SQL Delegation Tests (`test:sql`)

**File:** `test-harness/sql-delegation.test.ts`

**What it does:**
- Tests SQL Server delegation module (`@fastmcp-oauth/sql-delegation`)
- Requires SQL Server + `EXECUTE AS USER` permissions
- Optional - only for projects using SQL delegation

**Prerequisites:**
- SQL Server with test database
- Service account with impersonation permissions
- Install SQL delegation package:
  ```bash
  npm install @fastmcp-oauth/sql-delegation
  ```

**When to run:**
- ✅ **Before using SQL delegation** - Validate SQL configuration
- ✅ **After SQL schema changes** - Ensure delegation still works
- ⚠️ **Not required for core framework** - Optional package

---

### 5. Build Tests

**Commands:**
- `npm run build` - Build core + packages
- `npm run build:core` - Build core framework only
- `npm run build:packages` - Build optional packages only
- `npm run dev` - Watch mode (auto-rebuild on changes)

**What it does:**
- Compiles TypeScript to JavaScript (ESNext modules)
- Generates type declarations (`.d.ts` files)
- Bundles with `tsup` (esbuild-based)
- Validates module resolution

**When to run:**
- ✅ **Before starting server** - Ensure latest code is built
- ✅ **Before running integration tests** - Tests use built code
- ✅ **CI/CD pipeline** - Build artifacts for deployment

**Output:**
```
dist/
├── src/
│   ├── index.js              # Main export
│   ├── index.d.ts            # Type declarations
│   ├── core/                 # Core layer
│   ├── delegation/           # Delegation layer
│   ├── mcp/                  # MCP layer
│   └── config/               # Configuration
└── start-server.js           # Server entry point
```

**Build validation:**
- TypeScript compilation succeeds
- No type errors
- Module imports resolve correctly
- All exports are valid

---

### 6. Manual Testing Tools

**Commands:**
- `npm run test:mcp-client` - MCP client test UI (port 8081)
- `npm run test:oauth-ui` - OAuth test UI (port 8082)

**What it does:**
- Serves HTML/JS test clients for manual testing
- Interactive OAuth flow testing
- MCP tool invocation UI

**Use case:**
```bash
# Terminal 1: Start MCP server
npm start

# Terminal 2: Start test UI
npm run test:oauth-ui

# Open browser: http://localhost:8082
# Test OAuth flow interactively
```

**When to use:**
- ✅ **Debugging OAuth flow** - See token exchange in action
- ✅ **Manual QA** - Validate UI integration
- ✅ **Demo/Presentation** - Show OAuth workflow

---

## Test Scripts Reference

| Script | Purpose | Speed | Dependencies | CI/CD | Dev Workflow |
|--------|---------|-------|--------------|-------|--------------|
| `typecheck` | Type validation | ⚡ Fast | None | ✅ Always | ✅ Pre-commit |
| `lint` | Code style check | ⚡ Fast | None | ✅ Always | ✅ Pre-commit |
| `lint:fix` | Auto-fix style | ⚡ Fast | None | ❌ No | ✅ Pre-commit |
| `format` | Code formatting | ⚡ Fast | None | ❌ No | ✅ Pre-commit |
| `test` | Unit tests (watch) | ⚡ Fast | None | ❌ No | ✅ Always |
| `test:unit` | Unit tests (run) | ⚡ Fast | None | ✅ Always | ✅ Pre-commit |
| `test:coverage` | Coverage report | 🐢 Medium | None | ✅ Nightly | ⚠️ Weekly |
| `test:integration` | E2E integration | 🐢 Slow | Server + IDP | ✅ Staging | ⚠️ Pre-release |
| `test:performance` | Performance benchmarks | 🐌 Very Slow | Server + IDP | ❌ No | ⚠️ Pre-release |
| `test:sql` | SQL delegation | 🐢 Slow | Server + SQL | ❌ No | ⚠️ If using SQL |
| `build` | Compile TypeScript | 🐢 Medium | None | ✅ Always | ✅ Pre-start |
| `dev` | Watch mode build | 🔄 Continuous | None | ❌ No | ✅ Development |
| `start` | Run server | 🔄 Long-running | Build output | ❌ No | ✅ Integration tests |
| `clean` | Remove build artifacts | ⚡ Fast | None | ❌ No | ⚠️ Troubleshooting |

**Legend:**
- ⚡ Fast: <5 seconds
- 🐢 Medium: 5-30 seconds
- 🐌 Slow: 30-120 seconds
- 🔄 Continuous: Long-running process

---

## Development Workflow

### Daily Development Cycle

```bash
# 1. Start development session
npm run dev              # Watch mode (auto-rebuild on changes)

# 2. Write code + tests
npm test                 # Unit tests in watch mode

# 3. Before committing
npm run typecheck        # Validate types
npm run lint:fix         # Fix style issues
npm run format           # Format code
npm run test:unit        # Run all unit tests

# 4. Commit changes
git add .
git commit -m "feat: add new feature"
```

### Pre-Commit Checklist

```bash
✅ npm run typecheck      # No type errors
✅ npm run lint           # No linting errors
✅ npm run test:unit      # All unit tests pass
✅ Code formatted         # Prettier applied
✅ New tests added        # Coverage maintained
```

### Pre-Release Checklist

```bash
# 1. Clean build
npm run clean
npm run build

# 2. Unit tests + coverage
npm run test:coverage
# Verify coverage: >80% for core framework

# 3. Start server
npm start
# Wait for server to start...

# 4. Integration tests (new terminal)
npm run test:integration

# 5. Performance validation
npm run test:performance

# 6. (Optional) SQL delegation tests
npm run test:sql

# 7. Manual smoke test
npm run test:oauth-ui
# Open http://localhost:8082 and test OAuth flow

# 8. Update CHANGELOG.md

# 9. Tag release
git tag v2.0.1
git push --tags
```

### Bug Fix Workflow

```bash
# 1. Write failing test
npm test bug-name       # Watch mode for specific test

# 2. Fix bug
# Edit code...

# 3. Verify fix
npm test bug-name       # Test should pass

# 4. Regression test
npm run test:unit       # All tests pass
npm run test:coverage   # Coverage maintained

# 5. Commit with test
git commit -m "fix: resolve issue #123"
```

### Feature Development Workflow

```bash
# 1. Create feature branch
git checkout -b feature/new-delegation-module

# 2. Scaffold module (optional)
npm run mcp-oauth-scaffold

# 3. Write tests first (TDD)
# Create tests/unit/delegation/my-module.test.ts
npm test my-module      # Watch mode

# 4. Implement feature
# Create src/delegation/my-module.ts
npm run dev             # Auto-rebuild

# 5. Integration test
npm run build
npm start
npm run test:integration

# 6. Document
# Update Docs/EXTENDING.md

# 7. Merge to main
git checkout main
git merge feature/new-delegation-module
```

---

## CI/CD Integration

### Recommended Pipeline Stages

#### Stage 1: Fast Feedback (< 2 minutes)

```yaml
# .github/workflows/ci.yml (example)
- name: Type Check
  run: npm run typecheck

- name: Lint
  run: npm run lint

- name: Unit Tests
  run: npm run test:unit
```

**Purpose:** Catch syntax errors, type errors, unit test failures early

**Trigger:** Every push, every PR

#### Stage 2: Coverage Check (2-5 minutes)

```yaml
- name: Test Coverage
  run: npm run test:coverage

- name: Upload Coverage
  uses: codecov/codecov-action@v3
  with:
    files: ./coverage/coverage-final.json
```

**Purpose:** Ensure code coverage standards are met

**Trigger:** PR to main, nightly builds

#### Stage 3: Build Validation (2-5 minutes)

```yaml
- name: Build Core
  run: npm run build:core

- name: Build Packages
  run: npm run build:packages

- name: Verify Exports
  run: node -e "require('./dist/index.js')"
```

**Purpose:** Ensure build artifacts are valid

**Trigger:** PR to main, release tags

#### Stage 4: Integration Tests (Staging Only, 5-10 minutes)

```yaml
# Staging environment with Keycloak
- name: Start Test Server
  run: npm start &

- name: Wait for Server
  run: sleep 10

- name: Integration Tests
  run: npm run test:integration
  env:
    KEYCLOAK_URL: ${{ secrets.KEYCLOAK_URL }}
    MCP_SERVER_URL: http://localhost:3000
```

**Purpose:** Validate full OAuth flow with real IDP

**Trigger:** PR to main (staging environment), release candidates

**Note:** Requires Keycloak instance in staging environment

#### Stage 5: Performance Benchmarks (Optional, 10-20 minutes)

```yaml
# Only run on release branches
- name: Performance Tests
  run: npm run test:performance
  if: startsWith(github.ref, 'refs/tags/v')

- name: Archive Results
  uses: actions/upload-artifact@v3
  with:
    name: performance-results
    path: performance-results.json
```

**Purpose:** Track performance regressions over releases

**Trigger:** Release tags only (not every commit)

---

## Test Environment Setup

### Local Development Environment

**Required:**
- Node.js 18+ (`node --version`)
- npm 8+ (`npm --version`)

**Installation:**
```bash
# Clone repository
git clone https://github.com/your-org/mcp-oauth.git
cd mcp-oauth

# Install dependencies
npm install

# Build project
npm run build

# Run unit tests
npm test
```

### Integration Test Environment

**Required:**
- Keycloak IDP (or compatible OAuth 2.1 server)
- Test users and clients configured
- Network access to IDP from test machine

**Setup:**
1. **Start Keycloak:**
   ```bash
   docker run -p 8080:8080 \
     -e KEYCLOAK_ADMIN=admin \
     -e KEYCLOAK_ADMIN_PASSWORD=admin \
     quay.io/keycloak/keycloak:latest start-dev
   ```

2. **Configure Keycloak:**
   - Follow [Docs/idp-configuration-requirements.md](../Docs/idp-configuration-requirements.md)
   - Create realm: `mcp_security`
   - Create users: alice, bob, charlie, dave
   - Create clients: `mcp-oauth` (public), `mcp-server-client` (confidential)

3. **Configure environment:**
   ```bash
   export KEYCLOAK_URL=http://localhost:8080
   export KEYCLOAK_REALM=mcp_security
   export MCP_SERVER_URL=http://localhost:3000
   ```

4. **Run tests:**
   ```bash
   # Terminal 1: Start server
   npm start

   # Terminal 2: Run integration tests
   npm run test:integration
   ```

### SQL Delegation Test Environment (Optional)

**Required:**
- SQL Server or PostgreSQL
- Database with test users
- Impersonation permissions configured

**Setup:**
1. **Install SQL delegation package:**
   ```bash
   npm install @fastmcp-oauth/sql-delegation
   ```

2. **Configure SQL Server:**
   ```sql
   -- Create test users
   CREATE USER ALICE_ADMIN WITHOUT LOGIN;
   CREATE USER BOB_USER WITHOUT LOGIN;

   -- Grant impersonation
   GRANT IMPERSONATE ON USER::ALICE_ADMIN TO [service-account];
   GRANT IMPERSONATE ON USER::BOB_USER TO [service-account];
   ```

3. **Configure MCP server:**
   ```json
   {
     "sql": {
       "server": "localhost",
       "database": "test_db",
       "user": "service-account",
       "password": "***",
       "options": { "encrypt": true }
     }
   }
   ```

4. **Run SQL tests:**
   ```bash
   npm run test:sql
   ```

---

## Best Practices

### For Framework Developers

1. **Write tests before code (TDD)**
   - Unit test → Implementation → Integration test

2. **Maintain >80% coverage**
   - Check with `npm run test:coverage`
   - Focus on critical paths (authentication, delegation)

3. **Run full test suite before PR**
   ```bash
   npm run typecheck && npm run test:unit && npm run test:integration
   ```

4. **Add regression tests for bugs**
   - Every bug fix should include a test

5. **Document complex tests**
   - Explain WHY, not just WHAT

### For Module Developers (Extensions)

1. **Test your module in isolation**
   - Create `packages/my-module/tests/`
   - Mock core framework dependencies

2. **Test integration with core framework**
   - Create integration test in `test-harness/`
   - Test with real CoreContext

3. **Provide test utilities**
   - Export mocks for downstream users
   - Example: `@fastmcp-oauth/testing`

4. **Document test requirements**
   - List external dependencies (databases, APIs)
   - Provide Docker Compose for test environment

### For End Users (Consuming Framework)

1. **Run integration tests before production**
   ```bash
   npm run test:integration
   ```

2. **Monitor performance in staging**
   ```bash
   npm run test:performance
   ```

3. **Test failover scenarios**
   - IDP outage
   - SQL connection loss
   - Network timeouts

4. **Validate configuration**
   ```bash
   npm run mcp-oauth-validate config.json
   ```

---

## Troubleshooting

### Unit Tests Failing

**Check:**
- `npm install` completed successfully
- `npm run build` succeeds
- No TypeScript errors: `npm run typecheck`

**Common issues:**
- Outdated dependencies: `npm install`
- Build artifacts stale: `npm run clean && npm run build`

### Integration Tests Failing

**Error: "MCP Server not running"**
- Start server: `npm start`
- Wait for "Server listening on port 3000"

**Error: "Keycloak IDP not accessible"**
- Check Keycloak is running: `curl http://localhost:8080`
- Verify realm exists: `http://localhost:8080/realms/mcp_security`

**Error: "Failed to get access token"**
- Check test user credentials
- Verify client configuration (public vs confidential)
- Check Keycloak logs for errors

### Performance Tests Failing

**Latency targets not met:**
- Check network latency to IDP
- Local IDP has lower targets (<50% reduction)
- Remote IDP has higher targets (>80% reduction)

**Cache hit rate low:**
- Check token TTL configuration
- Verify cache is enabled in config
- Check server logs for cache eviction

---

## Summary

| Test Type | Speed | When to Run | Purpose |
|-----------|-------|-------------|---------|
| `typecheck` | ⚡ Fast | Every commit | Catch type errors |
| `lint` | ⚡ Fast | Every commit | Enforce code style |
| `test:unit` | ⚡ Fast | Every commit | Validate logic |
| `test:coverage` | 🐢 Medium | Weekly / PR | Ensure coverage |
| `test:integration` | 🐢 Slow | Before release | Validate E2E flow |
| `test:performance` | 🐌 Very Slow | Before release | Validate performance |
| `test:sql` | 🐢 Slow | If using SQL | Validate delegation |

**Recommended Development Cycle:**
1. `npm run dev` (watch mode build)
2. `npm test` (watch mode unit tests)
3. `npm run typecheck` (before commit)
4. `npm run test:integration` (before release)

**CI/CD Pipeline:**
1. Fast feedback: `typecheck` + `lint` + `test:unit` (< 2 min)
2. Coverage check: `test:coverage` (< 5 min)
3. Build validation: `build` (< 5 min)
4. Integration tests: `test:integration` (staging only, < 10 min)
5. Performance benchmarks: `test:performance` (release tags only, < 20 min)

---

**Related Documentation:**
- [CLAUDE.md](../CLAUDE.md) - Framework overview
- [Docs/EXTENDING.md](../Docs/EXTENDING.md) - Module development guide
- [Docs/idp-configuration-requirements.md](../Docs/idp-configuration-requirements.md) - IDP setup
- [test-harness/README.md](../test-harness/README.md) - Integration test setup
