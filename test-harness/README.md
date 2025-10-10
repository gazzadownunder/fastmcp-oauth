# Test Harness - Multi-Delegation MCP OAuth Server

This test harness demonstrates the FastMCP OAuth framework with multi-delegation support.

## Architecture Overview

The framework supports **multiple TrustedIDPs** with the same issuer but different audiences, enabling multi-delegation scenarios.

### Multi-IDP Support

- **Requestor JWT** (aud: "mcp-oauth") - Authorizes MCP tool access
- **TE-JWTs** (various audiences) - Provide delegation-specific claims
  - SQL TE-JWT (aud: "urn:sql:database")
  - Kerberos TE-JWT (aud: "urn:kerberos:legacy")
  - API TE-JWT (aud: "urn:api:resource")

### JWT Validation

The framework matches JWTs by **issuer + audience**:
- Same issuer, different audiences = different IDP configs
- Example: Both requestor JWT and SQL TE-JWT from same Keycloak, different audiences

## Running the Test Server

### Start Server

```bash
npm run build

CONFIG_PATH=./test-harness/config/phase3-test-config.json \
SERVER_PORT=3000 \
NODE_ENV=development \
node dist/test-harness/v2-test-server.js
```

### Expected Output

The server will display:
- Multi-IDP configuration (if multiple IDPs detected)
- Available tools
- Test commands

## Phase 1 + Phase 2 Complete ✅

- ✅ Role-based authorization (no static permissions)
- ✅ Multiple TrustedIDPs supported
- ✅ JWT matching by issuer + audience
- ✅ customClaims for delegation constraints
- ✅ Two-tier authorization (primary + secondary)
