# FastMCP OAuth OBO Test Harness

Comprehensive test suite for validating OAuth 2.1 On-Behalf-Of (OBO) delegation with Keycloak IDP.

## Overview

This test harness validates the complete OAuth delegation flow:
1. **Phase 1**: User authentication → Subject Token (Client: `contextflow`)
2. **Phase 2**: Token Exchange (RFC 8693) → Delegated Token (Client: `mcp-oauth`)
3. **Phase 3**: Resource Server validation → SQL delegation with correct token

## Prerequisites

### Required Services
- ✅ **Keycloak** running at `localhost:8080`
- ✅ **Realm configured** (see `Docs/oauth2 details.docx`)
- ✅ **Client "contextflow"** configured (Subject Token issuer)
- ✅ **Client "mcp-oauth"** configured with token exchange enabled
- ✅ **Test users** with `legacy_sam_account` attribute
- ✅ **SQL Server** (Docker or existing instance)
- ✅ **Node.js 18+** installed

### Keycloak Configuration

Your Keycloak instance should have (as per `Docs/oauth2 details.docx`):

1. **Realm**: Custom realm (e.g., `mcp-realm`)
2. **Client 1 (`contextflow`)**:
   - Client Type: Public or Confidential
   - Grant Types: Authorization Code, Password (for testing)
   - Audience: Should include `mcp-oauth`

3. **Client 2 (`mcp-oauth`)**:
   - Client Type: Confidential (required)
   - Grant Types: Token Exchange enabled
   - Service Account: Enabled
   - Audience: `mcp-oauth`

4. **User Attributes**:
   - Custom attribute: `legacy_sam_account`
   - Mapped to JWT claims via client scopes

5. **Client Scopes**:
   - Map `legacy_sam_account` → `legacy_sam_account` claim
   - Map roles → `realm_access.roles`

## Quick Start

### 1. Configure Environment

```bash
cd test-harness
cp config/test.env.example config/test.env
```

Edit `config/test.env` with your Keycloak details:

```bash
# Keycloak Configuration
KEYCLOAK_URL=http://localhost:8080
KEYCLOAK_REALM=your-realm-name
KEYCLOAK_CLIENT_ID_CONTEXTFLOW=contextflow
KEYCLOAK_CLIENT_ID_MCP=mcp-oauth
KEYCLOAK_CLIENT_SECRET_MCP=your-secret-here

# Test User (must exist in Keycloak with legacy_sam_account attribute)
TEST_USER_USERNAME=testuser
TEST_USER_PASSWORD=test123
TEST_ADMIN_USERNAME=adminuser
TEST_ADMIN_PASSWORD=admin123

# SQL Server
SQL_SERVER=localhost
SQL_DATABASE=test_legacy_app
SQL_USER=sa
SQL_PASSWORD=YourStrong@Passw0rd

# MCP Server
MCP_SERVER_URL=http://localhost:3000
```

### 2. Build the Framework

```bash
cd ..
npm install
npm run build
```

### 3. Verify Keycloak Setup

```bash
cd test-harness
chmod +x scripts/*.sh  # On Linux/Mac
./scripts/verify-keycloak.sh
```

This checks:
- ✓ Keycloak server reachable
- ✓ Realm exists
- ✓ JWKS endpoint accessible
- ✓ Token exchange supported
- ✓ Clients can authenticate

### 4. Start SQL Server (Optional)

If you don't have SQL Server, use Docker:

```bash
./scripts/start-sql-server.sh
```

This starts SQL Server 2022 with:
- Test database: `test_legacy_app`
- Test users for EXECUTE AS: `TESTDOMAIN\testuser`, `TESTDOMAIN\adminuser`
- Sample data

### 5. Start MCP Server

In a separate terminal:

```bash
cd ..
CONFIG_PATH=./test-harness/config/keycloak-with-sql.json npm start
```

### 6. Run Complete Test Suite

```bash
cd test-harness
./scripts/run-all-tests.sh
```

Or run tests step-by-step:

```bash
# Step 1: Get Subject Token
./scripts/1-get-subject-token.sh

# Step 2: Exchange Token (RFC 8693)
./scripts/2-exchange-token.sh

# Step 3: Test MCP Tools
./scripts/3-test-mcp-tools.sh
```

## Test Scenarios

### Automated Test Scripts

| Script | Description | Tests |
|--------|-------------|-------|
| `verify-keycloak.sh` | Verify Keycloak configuration | Realm, clients, JWKS, token exchange |
| `1-get-subject-token.sh` | Obtain Subject Token | User auth, token format, claims |
| `2-exchange-token.sh` | Token exchange (RFC 8693) | Exchange flow, azp claim validation |
| `3-test-mcp-tools.sh` | Test MCP tools | Tool access, SQL delegation, security |
| `run-all-tests.sh` | Complete test suite | All of the above |

### TypeScript Test Scenarios

| Scenario | File | Critical Test |
|----------|------|---------------|
| Scenario 4 | `scenario-4-azp-security.ts` | **azp Claim Security** ✓ CRITICAL |

**Scenario 4 is the MOST IMPORTANT test** - it verifies:
- ✓ Subject Token (azp: contextflow) is **REJECTED**
- ✓ Exchanged Token (azp: mcp-oauth) is **ACCEPTED**
- ✓ SQL delegation only works with exchanged token

This prevents privilege escalation attacks.

## Key Security Validations

### 1. azp Claim Validation (CRITICAL)

The framework MUST validate the `azp` (Authorized Party) claim:

```typescript
// Subject Token (from contextflow client)
{
  "iss": "http://localhost:8080/realms/mcp-realm",
  "aud": ["contextflow", "mcp-oauth"],
  "azp": "contextflow",  // ← This identifies the client
  "sub": "user-id",
  "legacy_sam_account": "TESTDOMAIN\\testuser"
}

// Exchanged Token (from mcp-oauth client via token exchange)
{
  "iss": "http://localhost:8080/realms/mcp-realm",
  "aud": ["mcp-oauth"],
  "azp": "mcp-oauth",  // ← This proves delegation
  "sub": "user-id",
  "legacy_sam_account": "TESTDOMAIN\\testuser"
}
```

**Resource Server Logic**:
```typescript
// MUST check azp claim
if (token.azp !== "mcp-oauth") {
  throw new Error("Token not issued for this service");
}
```

### 2. Audience Validation

The framework validates the `aud` (Audience) claim:
- Subject Token: `aud` should include both `contextflow` and `mcp-oauth`
- Exchanged Token: `aud` should be `mcp-oauth`

### 3. JWT Signature Validation

All tokens are validated against Keycloak's JWKS endpoint:
- Algorithm: RS256 (Keycloak default)
- Public key from: `http://localhost:8080/realms/{realm}/protocol/openid-connect/certs`

### 4. Token Expiration

Tokens have limited lifetime (typically 5-60 minutes).

## Configuration Files

### Keycloak Configuration

**`config/keycloak-localhost.json`** - Basic configuration:
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

**`config/keycloak-with-sql.json`** - With SQL Server:
- Includes all Keycloak config above
- Plus SQL Server connection details

### Environment Variables

See `config/test.env.example` for all available settings.

## SQL Server Testing

### Test Database Structure

```sql
-- Users table
CREATE TABLE Users (
  id INT PRIMARY KEY,
  username NVARCHAR(100),
  email NVARCHAR(255),
  department NVARCHAR(100),
  legacy_sam_account NVARCHAR(255)
);

-- Test users for EXECUTE AS
CREATE USER [TESTDOMAIN\testuser] WITHOUT LOGIN;
CREATE USER [TESTDOMAIN\adminuser] WITHOUT LOGIN;

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON Users TO [TESTDOMAIN\testuser];
GRANT ALL ON Users TO [TESTDOMAIN\adminuser];

-- Grant IMPERSONATE permission
GRANT IMPERSONATE ON USER::[TESTDOMAIN\testuser] TO [sa];
```

### SQL Delegation Testing

```bash
# Test SQL delegation
curl -X POST http://localhost:3000/mcp/tools/sql-delegate \
  -H "Authorization: Bearer $EXCHANGED_TOKEN" \
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
  "data": [
    {"delegated_user": "TESTDOMAIN\\testuser"}
  ],
  "legacyUser": "TESTDOMAIN\\testuser"
}
```

## Troubleshooting

### Keycloak Issues

**Error: "Invalid credentials"**
- Check username/password in `test.env`
- Verify user exists in Keycloak realm
- Check if user has `legacy_sam_account` attribute

**Error: "Token exchange not supported"**
- Enable token exchange on `mcp-oauth` client
- Check client is Confidential type
- Verify client secret is correct

**Error: "Invalid audience"**
- Check `contextflow` client scope configuration
- Ensure `mcp-oauth` is included in audience
- Review client mappers for `aud` claim

### SQL Server Issues

**Error: "Cannot connect to SQL Server"**
- Check if container is running: `docker ps`
- Verify port 1433 is not in use
- Check password meets complexity requirements

**Error: "EXECUTE AS failed"**
- Verify user exists: `SELECT * FROM sys.database_principals WHERE name LIKE 'TESTDOMAIN\%'`
- Check IMPERSONATE permissions: `SELECT * FROM sys.database_permissions WHERE permission_name = 'IMPERSONATE'`
- Verify `sa` has IMPERSONATE permission

**Error: "User not found for EXECUTE AS"**
- The `legacy_sam_account` from JWT must match SQL user name
- Create user: `CREATE USER [TESTDOMAIN\username] WITHOUT LOGIN`

### MCP Server Issues

**Error: "MCP server not reachable"**
- Start server: `CONFIG_PATH=./test-harness/config/keycloak-with-sql.json npm start`
- Check port 3000 is not in use
- Review server logs for errors

**Error: "JWT validation failed"**
- Verify Keycloak is running
- Check JWKS endpoint is accessible
- Review `issuer` and `jwksUri` in config match Keycloak URLs

## Token Files

The test scripts generate token files:
- `.subject-token` - Subject Token from contextflow client
- `.exchanged-token` - Delegated Token from mcp-oauth client

**⚠️ Security**: These files contain sensitive tokens. Delete after testing:
```bash
rm .subject-token .exchanged-token
```

## Manual Testing with curl

### Get Subject Token
```bash
source config/test.env
curl -X POST "${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token" \
  -d "grant_type=password" \
  -d "client_id=${KEYCLOAK_CLIENT_ID_CONTEXTFLOW}" \
  -d "username=${TEST_USER_USERNAME}" \
  -d "password=${TEST_USER_PASSWORD}" \
  | jq .
```

### Exchange Token
```bash
SUBJECT_TOKEN=$(cat .subject-token)
curl -X POST "${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token" \
  -u "${KEYCLOAK_CLIENT_ID_MCP}:${KEYCLOAK_CLIENT_SECRET_MCP}" \
  -d "grant_type=urn:ietf:params:oauth:grant-type:token-exchange" \
  -d "subject_token=${SUBJECT_TOKEN}" \
  -d "subject_token_type=urn:ietf:params:oauth:token-type:access_token" \
  -d "audience=mcp-oauth" \
  | jq .
```

### Call MCP Tools
```bash
EXCHANGED_TOKEN=$(cat .exchanged-token)
curl -X POST http://localhost:3000/mcp/tools/user-info \
  -H "Authorization: Bearer ${EXCHANGED_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{}' | jq .
```

## Directory Structure

```
test-harness/
├── config/                    # Configuration files
│   ├── keycloak-localhost.json
│   ├── keycloak-with-sql.json
│   └── test.env (create from test.env.example)
├── keycloak-reference/        # Keycloak documentation
├── scripts/                   # Test scripts
│   ├── verify-keycloak.sh     # Verify setup
│   ├── 1-get-subject-token.sh # Get token
│   ├── 2-exchange-token.sh    # Exchange token
│   ├── 3-test-mcp-tools.sh    # Test tools
│   ├── start-sql-server.sh    # Start SQL
│   ├── stop-sql-server.sh     # Stop SQL
│   └── run-all-tests.sh       # Run all
├── sql-setup/                 # SQL Server setup
│   ├── docker-compose.yml
│   ├── init-test-db.sql
│   ├── create-test-users.sql
│   └── sample-data.sql
├── test-clients/              # TypeScript utilities
│   └── utils/
│       ├── keycloak-helper.ts
│       └── mcp-tool-caller.ts
├── test-scenarios/            # Test scenarios
│   └── scenario-4-azp-security.ts (CRITICAL)
└── README.md                  # This file
```

## Next Steps

1. **Review Keycloak Configuration**: Ensure `Docs/oauth2 details.docx` is fully implemented
2. **Run Test Suite**: Execute `./scripts/run-all-tests.sh`
3. **Verify Security**: Run `scenario-4-azp-security.ts` specifically
4. **Test with Real Users**: Create additional test users in Keycloak
5. **Test SQL Delegation**: Execute real queries against your legacy database
6. **Review Audit Logs**: Check MCP server audit trail

## References

- **OAuth 2.0 Token Exchange**: RFC 8693
- **JWT Security**: RFC 8725
- **OpenID Connect**: https://openid.net/specs/openid-connect-core-1_0.html
- **Keycloak Documentation**: https://www.keycloak.org/docs/latest/
- **Project Documentation**: `../Docs/oauth2 implementation.md`
- **Keycloak Setup**: `../Docs/oauth2 details.docx`

## Support

For issues with:
- **Test Harness**: Review this README and troubleshooting section
- **Keycloak Configuration**: See `Docs/oauth2 details.docx`
- **Framework Implementation**: See `../CLAUDE.md` and `../README.md`