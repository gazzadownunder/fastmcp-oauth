# Phase 1 Token Exchange Testing Guide

This guide explains how to test the Phase 1 Token Exchange implementation using the test harness.

## Overview

Phase 1 implements **stateless token exchange** where the MCP server performs RFC 8693 token exchange on every SQL delegation request:

1. Client authenticates with Keycloak → receives Subject Token (ST-JWT)
2. Client calls `sql-delegate` tool with Subject Token
3. MCP server extracts Subject Token from Authorization header
4. **MCP server performs token exchange** → receives Delegation Token (TE-JWT)
5. MCP server decodes TE-JWT to extract `legacy_name`, `roles`, `permissions`
6. MCP server executes SQL with delegated credentials

## Prerequisites

### 1. Keycloak Setup

Ensure Keycloak is running at `http://localhost:8080` with:
- Realm: `mcp_security`
- Client: `contextflow` (for user authentication)
- Client: `mcp-oauth` (for token exchange, with secret: `JUUA5xCJDQZdreWgEFYvfAqjJnGdTXXA`)
- Test user with `legacy_name` claim

### 2. Configuration

Use the Phase 1 test configuration:

```bash
export CONFIG_PATH=./test-harness/config/v2-keycloak-token-exchange.json
```

This config includes:
- `delegation.tokenExchange` - Token exchange configuration
- `delegation.modules.sql` - SQL delegation module
- Keycloak IDP at localhost:8080

### 3. Build the Project

```bash
npm run build
```

## Testing Methods

### Method 1: Web Test Harness (Recommended)

**Start the MCP server with token exchange:**

```bash
# Set environment
export NODE_ENV=development
export CONFIG_PATH=./test-harness/config/v2-keycloak-token-exchange.json
export SERVER_PORT=3000

# Start server
node dist/test-harness/v2-test-server.js
```

**Expected console output:**

```
═══════════════════════════════════════════════════════════
  MCP OAuth v2 Test Server - New Modular Framework
═══════════════════════════════════════════════════════════
Environment:     development
Config:          ./test-harness/config/v2-keycloak-token-exchange.json
Port:            3000
Transport:       http-stream
═══════════════════════════════════════════════════════════

[1/3] Creating MCPOAuthServer...
      Config path: /path/to/test-harness/config/v2-keycloak-token-exchange.json
✓     Server instance created

[2/3] Starting MCP server...
      Loading config, building CoreContext, registering tools...
✓     Server started successfully

[3/3] Checking for delegation modules...
      SQL delegation module detected in config
      Token exchange detected in config
      Token endpoint: http://localhost:8080/realms/mcp_security/protocol/openid-connect/token
      Client ID: mcp-oauth
      Audience: mcp-oauth
✓     Token exchange service initialized
✓     SQL delegation module registered

═══════════════════════════════════════════════════════════
  Server Ready - Press Ctrl+C to stop
═══════════════════════════════════════════════════════════
```

**Open web test interface:**

```bash
# In a new terminal, start Keycloak (if not running)
# Then open browser to:
http://localhost/test-harness/web-test/
```

**Test Flow:**

1. Click **Login** → authenticate with Keycloak
2. Click **Exchange Token** → perform client-side token exchange (optional for comparison)
3. Click **Initialize MCP** → connect to MCP server
4. Click **Call SQL Delegate** → triggers server-side Phase 1 token exchange

**Expected behavior:**

- MCP server logs show token exchange activity
- Audit logs show `tokenExchangeUsed: true` metadata
- SQL delegation succeeds with `legacy_name` from TE-JWT

### Method 2: Direct curl Testing

**Get a Subject Token from Keycloak:**

```bash
curl -X POST http://localhost:8080/realms/mcp_security/protocol/openid-connect/token \
  -d "client_id=contextflow" \
  -d "client_secret=YOUR_SECRET" \
  -d "username=testuser" \
  -d "password=password" \
  -d "grant_type=password" \
  | jq -r '.access_token' > subject_token.txt
```

**Call sql-delegate with Subject Token:**

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(cat subject_token.txt)" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "sql-delegate",
      "arguments": {
        "action": "query",
        "sql": "SELECT CURRENT_USER AS current_user, SESSION_USER AS session_user",
        "params": {}
      }
    },
    "id": 1
  }'
```

**Expected response:**

```json
{
  "jsonrpc": "2.0",
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"status\":\"success\",\"data\":[{\"current_user\":\"DOMAIN\\\\legacyuser\",\"session_user\":\"DOMAIN\\\\legacyuser\"}]}"
      }
    ]
  },
  "id": 1
}
```

**Check server audit logs** (in server console or audit service):

```json
{
  "timestamp": "2025-10-08T...",
  "source": "delegation:sql",
  "userId": "user123",
  "action": "sql_delegation:query",
  "success": true,
  "metadata": {
    "legacyUsername": "DOMAIN\\legacyuser",
    "action": "query",
    "tokenExchangeUsed": true
  }
}
```

## Verification Checklist

- [ ] Server starts with token exchange configuration loaded
- [ ] Token exchange service is initialized (console output)
- [ ] SQL delegation tool accepts Subject Token
- [ ] Server performs token exchange in background (Phase 1)
- [ ] TE-JWT is decoded to extract `legacy_name`
- [ ] SQL executes with correct delegated user context
- [ ] Audit logs show `tokenExchangeUsed: true`
- [ ] No token caching occurs (stateless)

## Troubleshooting

### Token Exchange Fails

**Symptom:** `Token exchange failed: invalid_grant`

**Solution:**
- Verify Keycloak client `mcp-oauth` has correct secret
- Check Subject Token is valid and not expired
- Verify `audience` in config matches Keycloak client

### Missing legacy_name Claim

**Symptom:** `TE-JWT missing legacy_name claim (required for SQL delegation)`

**Solution:**
- Configure Keycloak to include `legacy_name` in exchanged token
- Add client scope mapping in Keycloak for `mcp-oauth` client
- Verify token mapper in Keycloak realm

### SQL Delegation Fails

**Symptom:** `Session missing legacyUsername (required for SQL delegation)`

**Solution:**
- Enable token exchange in config
- Verify `delegation.tokenExchange` section exists
- Check TokenExchangeService is injected into SQL module

## Performance Notes

**Phase 1 Characteristics:**
- **Stateless**: No caching, every request triggers token exchange
- **Performance**: ~100-200ms overhead per request (IDP roundtrip)
- **Security**: Fresh token for every operation
- **Next Phase**: Phase 2 will add session-scoped caching to reduce IDP load

## Next Steps

After validating Phase 1:

1. **Phase 2**: Implement TokenCache with session-scoped TTL
2. **Phase 3**: Add middleware for automatic token attachment
3. **Phase 4**: Performance testing and optimization
4. **Phase 5**: Production deployment

## Test Coverage

Phase 1 includes comprehensive unit tests:

```bash
npm test token-exchange
```

**Coverage:**
- 99% statement coverage
- 88% branch coverage
- 100% function coverage
- 18 test cases covering all scenarios
