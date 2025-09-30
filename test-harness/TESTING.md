# OAuth OBO Testing Guide

Quick reference for testing the OAuth delegation flow.

## Prerequisites Checklist

- [ ] Keycloak running at `localhost:8080`
- [ ] Realm configured (see `keycloak-reference/KEYCLOAK-SETUP.md`)
- [ ] Clients configured: `contextflow` and `mcp-oauth`
- [ ] Test users created with `legacy_sam_account` attribute
- [ ] `config/test.env` configured with Keycloak details
- [ ] MCP framework built (`npm run build` from parent directory)
- [ ] SQL Server running (optional: use `./scripts/start-sql-server.sh`)

## Quick Test (5 minutes)

```bash
# 1. Verify Keycloak configuration
./scripts/verify-keycloak.sh

# 2. Run complete test suite
./scripts/run-all-tests.sh
```

## Step-by-Step Test (10 minutes)

```bash
# 1. Get Subject Token from Keycloak (contextflow client)
./scripts/1-get-subject-token.sh
# Creates: .subject-token
# Token has: azp="contextflow", aud=["contextflow", "mcp-oauth"]

# 2. Exchange for Delegated Token (mcp-oauth client)
./scripts/2-exchange-token.sh
# Creates: .exchanged-token
# Token has: azp="mcp-oauth", aud=["mcp-oauth"]

# 3. Test MCP tools (in separate terminal, start MCP server first)
CONFIG_PATH=./test-harness/config/keycloak-with-sql.json npm start

# 4. Run tool tests
./scripts/3-test-mcp-tools.sh
```

## Critical Security Test

**azp Claim Validation** (MOST IMPORTANT):

```bash
# Run the critical security test
npx tsx test-scenarios/scenario-4-azp-security.ts
```

This verifies:
- ✓ Subject Token (azp: contextflow) is REJECTED
- ✓ Exchanged Token (azp: mcp-oauth) is ACCEPTED

## Manual Token Inspection

### Decode Subject Token
```bash
cat .subject-token | cut -d'.' -f2 | base64 -d | jq .
```

Expected:
```json
{
  "azp": "contextflow",
  "aud": ["contextflow", "mcp-oauth"],
  "legacy_sam_account": "TESTDOMAIN\\testuser"
}
```

### Decode Exchanged Token
```bash
cat .exchanged-token | cut -d'.' -f2 | base64 -d | jq .
```

Expected:
```json
{
  "azp": "mcp-oauth",
  "aud": ["mcp-oauth"],
  "legacy_sam_account": "TESTDOMAIN\\testuser"
}
```

## Common Test Scenarios

### Test SQL Delegation
```bash
EXCHANGED_TOKEN=$(cat .exchanged-token)
curl -X POST http://localhost:3000/mcp/tools/sql-delegate \
  -H "Authorization: Bearer ${EXCHANGED_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "query",
    "sql": "SELECT CURRENT_USER AS delegated_user, SYSTEM_USER AS system_user",
    "params": {}
  }' | jq .
```

### Test with Different User Roles
```bash
# Admin user
TEST_USER_USERNAME=adminuser TEST_USER_PASSWORD=admin123 ./scripts/1-get-subject-token.sh
./scripts/2-exchange-token.sh
./scripts/3-test-mcp-tools.sh
```

### Test Error Scenarios
```bash
# Try with expired token
# Wait for token to expire (check exp claim), then:
./scripts/3-test-mcp-tools.sh
# Should get 401 Unauthorized

# Try with wrong audience
# Manually modify token or use wrong client
# Should get 403 Forbidden
```

## Cleanup

```bash
# Remove token files
rm .subject-token .exchanged-token

# Stop SQL Server
./scripts/stop-sql-server.sh
```

## Troubleshooting Quick Fixes

### "Keycloak not reachable"
```bash
# Check Keycloak is running
curl http://localhost:8080
```

### "Token exchange failed"
```bash
# Verify mcp-oauth client has token exchange enabled
# Check client secret is correct in test.env
./scripts/verify-keycloak.sh
```

### "Missing legacy_sam_account"
```bash
# Check user attribute in Keycloak
# User → Attributes → legacy_sam_account should be set
```

### "SQL delegation failed"
```bash
# Verify SQL user exists
docker exec -it test-sql-server /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "YourStrong@Passw0rd" -C -Q "SELECT name FROM sys.database_principals WHERE name LIKE 'TESTDOMAIN%'"

# Check IMPERSONATE permission
docker exec -it test-sql-server /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "YourStrong@Passw0rd" -C -Q "SELECT * FROM sys.database_permissions WHERE permission_name = 'IMPERSONATE'"
```

## Success Criteria

All tests pass when:
- ✓ Keycloak verification passes (all 6 checks)
- ✓ Subject token obtained successfully
- ✓ Token exchange successful with correct azp claim
- ✓ Subject token REJECTED by resource server
- ✓ Exchanged token ACCEPTED by resource server
- ✓ SQL delegation works with exchanged token
- ✓ Audit log contains all operations

## Next Steps After Testing

1. Review audit logs: `curl -X POST http://localhost:3000/mcp/tools/audit-log -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"limit": 50}' | jq .`
2. Test with production Keycloak instance
3. Test with real SQL Server database
4. Implement additional test scenarios
5. Set up continuous integration testing

## Reference

- Full documentation: `README.md`
- Keycloak setup: `keycloak-reference/KEYCLOAK-SETUP.md`
- OAuth flow: `../Docs/oauth2 implementation.md`