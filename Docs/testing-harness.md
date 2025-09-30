# OAuth OBO Testing Harness Documentation

**Location**: `test-harness/`
**Purpose**: External test suite for validating OAuth 2.1 On-Behalf-Of delegation with Keycloak IDP
**Status**: Complete and ready for testing
**Created**: 2025-09-30

## Overview

The testing harness provides a comprehensive, external test environment for validating the FastMCP OAuth OBO framework's OAuth delegation functionality without modifying any source code. It integrates with a real Keycloak instance at `localhost:8080` to test the complete RFC 8693 token exchange flow.

## Key Features

✅ **Real Keycloak Integration** - Uses actual Keycloak @ localhost:8080, no mocking
✅ **Complete OAuth Flow Testing** - Validates all three phases of delegation
✅ **Critical Security Validation** - Tests azp claim security (Subject vs Exchanged tokens)
✅ **SQL Delegation Testing** - Tests EXECUTE AS USER with real tokens
✅ **Zero Source Changes** - All test code is external to `src/`
✅ **Automated & Manual** - Scripts + TypeScript test scenarios
✅ **Docker SQL Server** - Isolated test database environment
✅ **Comprehensive Documentation** - Step-by-step guides included

## Directory Structure

```
test-harness/
├── config/                          # Configuration files
│   ├── keycloak-localhost.json      # Basic Keycloak config
│   ├── keycloak-with-sql.json       # Keycloak + SQL config
│   └── test.env.example             # Environment variables template
├── keycloak-reference/              # Keycloak documentation
│   └── KEYCLOAK-SETUP.md           # Detailed setup guide
├── scripts/                         # Bash test scripts
│   ├── verify-keycloak.sh          # Verify Keycloak config
│   ├── 1-get-subject-token.sh      # Get Subject Token
│   ├── 2-exchange-token.sh         # Exchange token (RFC 8693)
│   ├── 3-test-mcp-tools.sh         # Test MCP tools
│   ├── start-sql-server.sh         # Start SQL Docker
│   ├── stop-sql-server.sh          # Stop SQL Docker
│   └── run-all-tests.sh            # Complete test suite
├── sql-setup/                       # SQL Server setup
│   ├── docker-compose.yml          # SQL 2022 container
│   ├── init-test-db.sql            # Database creation
│   ├── create-test-users.sql       # EXECUTE AS users
│   └── sample-data.sql             # Test data
├── test-clients/                    # TypeScript utilities
│   └── utils/
│       ├── keycloak-helper.ts      # Keycloak API wrapper
│       └── mcp-tool-caller.ts      # MCP tool caller
├── test-scenarios/                  # Test scenarios
│   └── scenario-4-azp-security.ts  # CRITICAL security test
├── README.md                        # Complete documentation
├── QUICKSTART.md                    # 10-minute quick start
├── TESTING.md                       # Testing guide
├── FILES.md                         # File inventory
└── package.json                     # Dependencies
```

**Total Files**: 28 files created

## Prerequisites

From `Docs/oauth2 details.docx`, your Keycloak instance should have:

### Keycloak Configuration

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

## Quick Start

### 1. Configure Environment (2 minutes)

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

### 2. Verify Setup (1 minute)

```bash
./scripts/verify-keycloak.sh
```

### 3. Run Tests (5 minutes)

```bash
./scripts/run-all-tests.sh
```

See [test-harness/QUICKSTART.md](../test-harness/QUICKSTART.md) for complete quick start guide.

## OAuth Delegation Flow (What Gets Tested)

### Phase 1: Subject Token Acquisition

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

### Phase 2: Token Exchange (RFC 8693)

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

### Phase 3: Resource Server Validation

**Script**: `scripts/3-test-mcp-tools.sh`

```
Exchanged Token → MCP Server → Validates azp claim → Performs SQL delegation
```

**Critical Security Check**:
- Subject Token (azp: contextflow) → **REJECTED** ✓
- Exchanged Token (azp: mcp-oauth) → **ACCEPTED** ✓

## Critical Security Test

**File**: `test-scenarios/scenario-4-azp-security.ts`

This is the **MOST IMPORTANT** test in the harness. It validates the core security requirement:

```typescript
// Test 1: Subject Token must be REJECTED
await mcpCaller.userInfo(subjectToken);
// Expected: HTTP 401/403 - Token rejected

// Test 2: Exchanged Token must be ACCEPTED
await mcpCaller.userInfo(exchangedToken);
// Expected: HTTP 200 - Token accepted

// Test 3: SQL delegation only works with exchanged token
await mcpCaller.sqlDelegate('query', exchangedToken, {...});
// Expected: Success

// Test 4: SQL delegation fails with subject token
await mcpCaller.sqlDelegate('query', subjectToken, {...});
// Expected: Rejected
```

Run with:
```bash
npx tsx test-scenarios/scenario-4-azp-security.ts
```

## Test Scenarios Covered

| Scenario | Script/File | What It Tests |
|----------|-------------|---------------|
| Keycloak Verification | `verify-keycloak.sh` | Realm, clients, JWKS, token exchange support |
| Subject Token | `1-get-subject-token.sh` | User auth, token format, claims, azp=contextflow |
| Token Exchange | `2-exchange-token.sh` | RFC 8693 flow, azp=mcp-oauth validation |
| MCP Tools | `3-test-mcp-tools.sh` | Tool access, user-info, health-check, SQL delegation |
| azp Security | `scenario-4-azp-security.ts` | Subject token rejection, exchanged token acceptance |
| SQL Delegation | `3-test-mcp-tools.sh` | EXECUTE AS USER, parameterized queries, permissions |
| Complete Flow | `run-all-tests.sh` | All of the above |

## SQL Server Testing

The test harness includes a complete SQL Server 2022 test environment:

**Start SQL Server**:
```bash
./scripts/start-sql-server.sh
```

**What Gets Created**:
- Database: `test_legacy_app`
- Tables: `Users`, `Documents`, `AuditLog`
- SQL Users: `[TESTDOMAIN\testuser]`, `[TESTDOMAIN\adminuser]`, `[TESTDOMAIN\guestuser]`
- Permissions: IMPERSONATE granted to sa
- Sample data: Test users and documents

**Test SQL Delegation**:
```bash
curl -X POST http://localhost:3000/mcp/tools/sql-delegate \
  -H "Authorization: Bearer $(cat .exchanged-token)" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "query",
    "sql": "SELECT CURRENT_USER AS delegated_user",
    "params": {}
  }'
```

Expected result:
```json
{
  "success": true,
  "data": [{"delegated_user": "TESTDOMAIN\\testuser"}],
  "legacyUser": "TESTDOMAIN\\testuser"
}
```

## Integration with Main Project

The test harness is completely external to the main project source:

```bash
# Build main project
cd <project-root>
npm run build

# Start MCP server with test configuration
CONFIG_PATH=./test-harness/config/keycloak-with-sql.json npm start

# Run tests (in separate terminal)
cd test-harness
./scripts/run-all-tests.sh
```

No source code modifications required!

## Configuration Files

### Basic Configuration: keycloak-localhost.json

Points to your Keycloak instance:
```json
{
  "trustedIDPs": [{
    "issuer": "http://localhost:8080/realms/mcp-realm",
    "jwksUri": "http://localhost:8080/realms/mcp-realm/protocol/openid-connect/certs",
    "audience": "mcp-oauth",
    "algorithms": ["RS256"],
    "claimMappings": {
      "legacyUsername": "legacy_sam_account",
      "roles": "realm_access.roles",
      "scopes": "scope"
    }
  }]
}
```

### With SQL: keycloak-with-sql.json

Includes SQL Server configuration for delegation testing.

## Generated Files (Gitignored)

During testing, these files are created:

- `.subject-token` - Subject Token from contextflow client
- `.exchanged-token` - Delegated Token from mcp-oauth client
- `config/test.env` - Your environment configuration

**⚠️ Security**: These contain sensitive JWTs. They are automatically gitignored. Delete after testing:
```bash
rm .subject-token .exchanged-token
```

## Key Documentation Files

| File | Purpose |
|------|---------|
| `test-harness/README.md` | Complete documentation (comprehensive) |
| `test-harness/QUICKSTART.md` | 10-minute quick start guide |
| `test-harness/TESTING.md` | Testing guide with common scenarios |
| `test-harness/FILES.md` | Inventory of all files |
| `test-harness/keycloak-reference/KEYCLOAK-SETUP.md` | Detailed Keycloak configuration |

## Troubleshooting

### Common Issues

**"Token exchange not supported"**
- Enable token exchange on `mcp-oauth` client
- Verify client is Confidential type
- Check Service Accounts is enabled

**"Missing legacy_sam_account"**
- Verify user has attribute in Keycloak
- Check client scope includes mapper
- Verify mapper is set to "Add to access token"

**"Subject token was accepted" (SECURITY ISSUE)**
- This indicates azp claim validation is not working
- Check MCP server is using correct configuration
- Review JWT validation logic in `src/middleware/jwt-validator.ts`

See [test-harness/README.md](../test-harness/README.md#troubleshooting) for complete troubleshooting guide.

## Success Criteria

All tests pass when you see:

```
✓ Keycloak verification passed (6/6 checks)
✓ Subject token obtained successfully
✓ Token exchange successful
✓ Subject token REJECTED by resource server
✓ Exchanged token ACCEPTED by resource server
✓ SQL delegation successful
✓ All security tests passed
```

## Alignment with Project Documentation

The test harness implements testing for:

- **RFC 8693 Token Exchange**: As documented in `Docs/oauth2 implementation.md`
- **azp Claim Validation**: Critical security requirement from OAuth delegation flow
- **SQL Delegation**: As implemented in `src/services/sql-delegator.ts`
- **JWT Security**: RFC 8725 compliance from `src/middleware/jwt-validator.ts`

## Maintenance

### When to Update

- **Keycloak config changes**: Update `keycloak-reference/KEYCLOAK-SETUP.md`
- **New test scenarios**: Add to `test-scenarios/`
- **New MCP tools**: Update `test-clients/utils/mcp-tool-caller.ts`
- **Configuration changes**: Update `config/*.json` files

### Running in CI/CD

The test harness can be automated:

```bash
# In CI pipeline
cd test-harness
./scripts/verify-keycloak.sh || exit 1
./scripts/run-all-tests.sh || exit 1
```

## Future Enhancements

Potential additions to the test harness:

1. **Kerberos Testing**: When Kerberos delegation is implemented
2. **Performance Tests**: Load testing with multiple concurrent tokens
3. **Security Scanning**: Automated vulnerability scanning
4. **Additional Scenarios**: More edge cases and error conditions
5. **Postman Collection**: Pre-configured API testing collection

## References

- **Test Harness Documentation**: [test-harness/README.md](../test-harness/README.md)
- **Quick Start Guide**: [test-harness/QUICKSTART.md](../test-harness/QUICKSTART.md)
- **Keycloak Setup**: [test-harness/keycloak-reference/KEYCLOAK-SETUP.md](../test-harness/keycloak-reference/KEYCLOAK-SETUP.md)
- **OAuth Flow**: [oauth2 implementation.md](oauth2 implementation.md)
- **Framework Architecture**: [../CLAUDE.md](../CLAUDE.md)
- **Project README**: [../README.md](../README.md)

## Summary

The OAuth OBO testing harness provides a complete, production-ready test environment for validating the OAuth delegation framework. It tests the most critical security requirement (azp claim validation) and the complete end-to-end delegation flow with real Keycloak integration and SQL Server delegation.

**Total Files**: 28 files
**Setup Time**: 2-3 minutes
**Test Time**: 5-10 minutes
**Critical Test**: azp claim validation (scenario-4)

Ready to use immediately with your existing Keycloak configuration at `localhost:8080`.