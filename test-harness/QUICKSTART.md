# Quick Start Guide - OAuth OBO Testing

**Goal**: Test OAuth delegation with your Keycloak instance at `localhost:8080` in under 10 minutes.

## 1. Configure Environment (2 minutes)

```bash
cd test-harness
cp config/test.env.example config/test.env
```

Edit `config/test.env`:
```bash
# Update these values from your Keycloak (see Docs/oauth2 details.docx)
KEYCLOAK_REALM=your-realm-name
KEYCLOAK_CLIENT_SECRET_MCP=your-mcp-oauth-secret

# Update test user credentials
TEST_USER_USERNAME=testuser
TEST_USER_PASSWORD=test123
```

## 2. Verify Keycloak (1 minute)

```bash
./scripts/verify-keycloak.sh
```

Expected output:
```
✓ PASS: Keycloak server is reachable
✓ PASS: Realm 'your-realm' exists
✓ PASS: JWKS endpoint accessible
✓ PASS: Client 'contextflow' can obtain tokens
✓ PASS: Client 'mcp-oauth' credentials are valid
```

If any checks fail, see [KEYCLOAK-SETUP.md](keycloak-reference/KEYCLOAK-SETUP.md).

## 3. Build Framework (1 minute)

```bash
cd ..
npm install
npm run build
```

## 4. Run Tests (5 minutes)

### Option A: Automated (recommended)

```bash
cd test-harness
./scripts/run-all-tests.sh
```

### Option B: Step-by-step

```bash
# Terminal 1: Start SQL Server (optional)
./scripts/start-sql-server.sh

# Terminal 2: Start MCP Server
cd ..
CONFIG_PATH=./test-harness/config/keycloak-with-sql.json npm start

# Terminal 3: Run tests
cd test-harness
./scripts/1-get-subject-token.sh
./scripts/2-exchange-token.sh
./scripts/3-test-mcp-tools.sh
```

## 5. Verify Security (1 minute)

**Critical Test - azp Claim Validation**:

```bash
npx tsx test-scenarios/scenario-4-azp-security.ts
```

Expected:
```
✓ PASS: Subject token correctly rejected
✓ PASS: Exchanged token correctly accepted
✓ PASS: SQL delegation successful with exchanged token
✓ PASS: SQL delegation correctly rejected subject token

✓ ALL SECURITY TESTS PASSED
```

## Success!

You've successfully tested:
- ✅ OAuth authentication flow
- ✅ RFC 8693 token exchange
- ✅ azp claim security validation
- ✅ SQL delegation

## What Just Happened?

1. **Phase 1**: You authenticated as a user and got a **Subject Token**
   - Client: `contextflow`
   - Token has: `azp: "contextflow"`

2. **Phase 2**: You exchanged it for a **Delegated Token**
   - Client: `mcp-oauth`
   - Token has: `azp: "mcp-oauth"`

3. **Phase 3**: The MCP server validated the token
   - Subject Token → REJECTED (wrong azp)
   - Delegated Token → ACCEPTED (correct azp)
   - SQL ran as: `TESTDOMAIN\testuser`

## Next Steps

- Read [README.md](README.md) for detailed documentation
- Review [KEYCLOAK-SETUP.md](keycloak-reference/KEYCLOAK-SETUP.md) for configuration details
- See [TESTING.md](TESTING.md) for additional test scenarios
- Check `../Docs/oauth2 implementation.md` for OAuth flow details

## Troubleshooting

### "Keycloak verification failed"
→ Check Keycloak is running: `curl http://localhost:8080`
→ Verify realm name in `test.env` matches Keycloak

### "Token exchange not supported"
→ Ensure `mcp-oauth` client has:
  - Client authentication: ON
  - Service accounts: Enabled
  - Token exchange permission configured

### "Missing legacy_sam_account"
→ Check user has attribute set in Keycloak:
  - User → Attributes → `legacy_sam_account` = `TESTDOMAIN\testuser`

### "SQL delegation failed"
→ Start SQL Server: `./scripts/start-sql-server.sh`
→ Or configure your SQL Server in `test.env`

## Cleanup

```bash
# Remove token files (contain sensitive data)
rm .subject-token .exchanged-token

# Stop SQL Server
./scripts/stop-sql-server.sh
```

## Need Help?

- Full documentation: [README.md](README.md)
- Keycloak setup: [keycloak-reference/KEYCLOAK-SETUP.md](keycloak-reference/KEYCLOAK-SETUP.md)
- Framework docs: [../CLAUDE.md](../CLAUDE.md)