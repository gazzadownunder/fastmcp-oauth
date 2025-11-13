# RFC 7591 Dynamic Client Registration - Verification Guide

## Summary

The MCP server now supports RFC 7591 Dynamic Client Registration by exposing the `registration_endpoint` in the `/.well-known/oauth-authorization-server` metadata response.

## Changes Implemented

### 1. Configuration Schema
- **File:** `src/config/schemas/mcp.ts`
- **Change:** Added `registrationEndpoint` field to `OAuthMetadataSchema`
- **Usage:** Configure in the `mcp.oauth` section of your configuration file

### 2. HTTP Server Endpoint
- **File:** `src/mcp/http-server.ts`
- **Change:** Updated `/.well-known/oauth-authorization-server` endpoint to include `registration_endpoint` from configuration
- **Behavior:** If configured, the `registration_endpoint` field will be added to the authorization server metadata response

## Configuration

Add the `registrationEndpoint` to your MCP configuration file:

```json
{
  "mcp": {
    "serverName": "fastmcp-oauth-server",
    "version": "1.0.0",
    "transport": "http-stream",
    "port": 3000,
    "oauth": {
      "registrationEndpoint": "https://auth.company.com/register"
    }
  }
}
```

**Example:** See `test-harness/config/phase3-test-config.json` (line 283)

## Testing Instructions

### Step 1: Stop Current Server

If you have a server running, stop it:
- Press `Ctrl+C` in the terminal where the server is running

### Step 2: Rebuild (If Not Already Done)

```bash
npm run build
```

### Step 3: Start Server

```bash
cd test-harness
start-phase3-server.bat
```

### Step 4: Test the Endpoint

Run the test script:

```bash
node test-harness/test-registration-endpoint.js
```

**Expected Output:**

```
========================================
Testing RFC 7591 Registration Endpoint
========================================

Fetching: http://localhost:3000/.well-known/oauth-authorization-server

Status Code: 200

Authorization Server Metadata:
{
  "issuer": "http://192.168.1.137:8080/realms/mcp_security",
  "authorization_endpoint": "http://192.168.1.137:8080/realms/mcp_security/protocol/openid-connect/auth",
  "token_endpoint": "http://192.168.1.137:8080/realms/mcp_security/protocol/openid-connect/token",
  "jwks_uri": "http://192.168.1.137:8080/realms/mcp_security/protocol/openid-connect/certs",
  "response_types_supported": [
    "code"
  ],
  "grant_types_supported": [
    "authorization_code"
  ],
  "subject_types_supported": [
    "public"
  ],
  "id_token_signing_alg_values_supported": [
    "RS256"
  ],
  "token_endpoint_auth_methods_supported": [
    "client_secret_basic",
    "client_secret_post"
  ],
  "code_challenge_methods_supported": [
    "S256"
  ],
  "scopes_supported": [
    "openid",
    "profile",
    "email"
  ],
  "registration_endpoint": "https://auth.company.com/register"
}

========================================
✅ SUCCESS: registration_endpoint is present
   Value: https://auth.company.com/register
========================================
```

### Step 5: Test with curl (Alternative)

```bash
curl http://localhost:3000/.well-known/oauth-authorization-server | jq .
```

Look for the `registration_endpoint` field in the JSON response.

## Troubleshooting

### Problem: `registration_endpoint` is missing from response

**Cause:** Server is running an old build before the changes were made.

**Solution:**
1. Stop the server (Ctrl+C)
2. Rebuild: `npm run build`
3. Restart server: `cd test-harness && start-phase3-server.bat`
4. Test again

### Problem: Server fails to start

**Cause:** Configuration validation failed.

**Solution:**
- Check that `registrationEndpoint` is a valid HTTPS URL (or HTTP in development mode)
- Review server console logs for detailed error messages

## Production Deployment

### Security Requirements

The `registrationEndpoint` must use HTTPS in production:

```json
{
  "mcp": {
    "oauth": {
      "registrationEndpoint": "https://auth.company.com/register"
    }
  }
}
```

**Note:** HTTP is allowed only when `NODE_ENV=development` or `NODE_ENV=test`

### Optional Field

The `registrationEndpoint` is **optional**. If not configured:
- The field will NOT appear in the authorization server metadata response
- The server will function normally without it
- Clients will not see a registration endpoint (expected behavior for servers that don't support DCR)

## Implementation Details

### Code Flow

1. **Configuration Load:** `ConfigManager` loads and validates the configuration
2. **Schema Validation:** Zod schema validates `registrationEndpoint` format (HTTPS required in production)
3. **Endpoint Handler:** `GET /.well-known/oauth-authorization-server` checks if `mcpConfig.oauth.registrationEndpoint` exists
4. **Conditional Response:** If configured, adds `registration_endpoint` to metadata; otherwise, omits it

### Relevant Files

- **Configuration Schema:** `src/config/schemas/mcp.ts:37-53`
- **HTTP Server:** `src/mcp/http-server.ts:65-98`
- **Test Config:** `test-harness/config/phase3-test-config.json:282-284`
- **Test Script:** `test-harness/test-registration-endpoint.js`

## RFC 7591 Compliance

This implementation follows RFC 7591 OAuth 2.0 Dynamic Client Registration Protocol:

- **Discovery:** Clients can discover the registration endpoint via RFC 8414 Authorization Server Metadata
- **Endpoint URL:** The `registration_endpoint` field advertises where clients can register dynamically
- **Optional Feature:** The field only appears when configured (per RFC 8414 specification)

## Next Steps

After verifying the `registration_endpoint` appears in the response:

1. **Implement Registration Endpoint:** Create a handler for the registration endpoint URL (if not already implemented by your IDP)
2. **Update Client Applications:** Configure MCP clients to use the discovered registration endpoint
3. **Test Dynamic Registration:** Verify clients can successfully register using the advertised endpoint

## References

- RFC 7591: OAuth 2.0 Dynamic Client Registration Protocol
  https://datatracker.ietf.org/doc/html/rfc7591

- RFC 8414: OAuth 2.0 Authorization Server Metadata
  https://datatracker.ietf.org/doc/html/rfc8414
