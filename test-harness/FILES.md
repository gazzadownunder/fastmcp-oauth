# Test Harness Files

Complete list of all files created in the test harness.

## Configuration Files (3)

- `config/keycloak-localhost.json` - Basic Keycloak configuration
- `config/keycloak-with-sql.json` - Keycloak + SQL Server configuration
- `config/test.env.example` - Environment variables template (copy to test.env)

## Scripts (7)

- `scripts/verify-keycloak.sh` - Verify Keycloak configuration
- `scripts/1-get-subject-token.sh` - Get Subject Token from contextflow client
- `scripts/2-exchange-token.sh` - Exchange token using mcp-oauth client (RFC 8693)
- `scripts/3-test-mcp-tools.sh` - Test MCP tools with exchanged token
- `scripts/start-sql-server.sh` - Start SQL Server Docker container
- `scripts/stop-sql-server.sh` - Stop SQL Server Docker container
- `scripts/run-all-tests.sh` - Run complete test suite

## SQL Server Setup (4)

- `sql-setup/docker-compose.yml` - SQL Server 2022 container configuration
- `sql-setup/init-test-db.sql` - Create test database and tables
- `sql-setup/create-test-users.sql` - Create SQL users for EXECUTE AS
- `sql-setup/sample-data.sql` - Insert test data

## Test Client Utilities (2)

- `test-clients/utils/keycloak-helper.ts` - Keycloak API wrapper
- `test-clients/utils/mcp-tool-caller.ts` - MCP server tool caller

## Test Scenarios (1)

- `test-scenarios/scenario-4-azp-security.ts` - **CRITICAL** azp claim validation test

## Documentation (5)

- `README.md` - Complete test harness documentation
- `QUICKSTART.md` - Quick start guide (10 minutes)
- `TESTING.md` - Testing guide and common scenarios
- `keycloak-reference/KEYCLOAK-SETUP.md` - Detailed Keycloak configuration guide
- `FILES.md` - This file

## Build Configuration (3)

- `package.json` - Test harness dependencies
- `tsconfig.json` - TypeScript configuration
- `.gitignore` - Ignore token files and test.env

## Total: 28 Files Created

## Key Files for Getting Started

1. **Setup**: `config/test.env.example` → copy to `test.env` and configure
2. **Verify**: `scripts/verify-keycloak.sh` - check Keycloak is configured
3. **Quick Start**: `QUICKSTART.md` - 10-minute guide
4. **Full Docs**: `README.md` - complete documentation
5. **Critical Test**: `test-scenarios/scenario-4-azp-security.ts` - security validation

## Files You Create During Testing

- `.subject-token` - Subject Token from contextflow (gitignored)
- `.exchanged-token` - Delegated Token from mcp-oauth (gitignored)
- `config/test.env` - Your environment configuration (gitignored)

**⚠️ Security**: Token files contain sensitive JWTs. They are gitignored and should be deleted after testing:
```bash
rm .subject-token .exchanged-token
```

## Usage Flow

```
1. Copy test.env.example → test.env
2. Edit test.env with Keycloak details
3. Run verify-keycloak.sh
4. Run 1-get-subject-token.sh
5. Run 2-exchange-token.sh
6. Run 3-test-mcp-tools.sh
   OR
   Run run-all-tests.sh (does steps 3-6)
```

## File Relationships

```
Configuration:
  test.env → All scripts
  keycloak-localhost.json → MCP server config
  keycloak-with-sql.json → MCP server config (includes SQL)

Token Flow:
  1-get-subject-token.sh → .subject-token
  .subject-token → 2-exchange-token.sh → .exchanged-token
  .exchanged-token → 3-test-mcp-tools.sh
  .exchanged-token → scenario-4-azp-security.ts

SQL Setup:
  docker-compose.yml → SQL Server container
  init-test-db.sql → Creates database
  create-test-users.sql → Creates EXECUTE AS users
  sample-data.sql → Inserts test data

TypeScript:
  keycloak-helper.ts → Token acquisition/exchange
  mcp-tool-caller.ts → MCP tool invocation
  scenario-4-azp-security.ts → Uses both utilities
```

## Integration with Main Project

These files are in `test-harness/` directory and do NOT modify the main project source code in `src/`.

To use with the main project:
```bash
# Build main project
cd ..
npm run build

# Start server with test configuration
CONFIG_PATH=./test-harness/config/keycloak-with-sql.json npm start

# Run tests (in separate terminal)
cd test-harness
./scripts/run-all-tests.sh
```

## Maintenance

Update these files when:
- Keycloak configuration changes → Update `keycloak-reference/KEYCLOAK-SETUP.md`
- New test scenarios added → Add to `test-scenarios/`
- New MCP tools added → Update `test-clients/utils/mcp-tool-caller.ts`
- Configuration changes → Update `config/*.json` files