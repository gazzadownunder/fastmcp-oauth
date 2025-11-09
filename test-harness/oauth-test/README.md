# OAuth Authentication Validator

**Location**: `test-harness/oauth-test/`
**Purpose**: Interactive web-based tool for testing OAuth 2.1 authentication flows and RFC 8693 token exchange
**Created**: 2025-11-09

## Overview

This interactive HTML tool allows you to test the complete OAuth authentication and token exchange flow using your MCP OAuth configuration files. It provides a step-by-step visual interface to:

1. Load and validate MCP OAuth configuration files
2. Authenticate with trusted IDPs using the Resource Owner Password Credentials flow
3. View requestor JWT tokens (raw and decoded)
4. Perform RFC 8693 token exchange for delegation modules
5. View delegated JWT tokens (raw and decoded)

## Features

✅ **Configuration File Loading** - Browse and load any MCP OAuth configuration file
✅ **Multi-IDP Support** - Select from multiple trusted IDPs in your configuration
✅ **IDP Discovery** - Automatically fetches OpenID Connect discovery documents
✅ **OAuth 2.1 Authorization Code Flow** - Proper OAuth with PKCE (no password handling in browser)
✅ **PKCE Security** - SHA-256 code challenge for enhanced security
✅ **JWT Visualization** - Display both raw and decoded JWT tokens
✅ **Token Exchange** - RFC 8693 token exchange for all configured delegation modules
✅ **Copy to Clipboard** - Easy copying of JWT tokens for external use
✅ **Step-by-Step UI** - Visual progress through the authentication flow
✅ **No Backend Required** - Runs entirely in the browser using CORS-enabled IDPs

## Quick Start

### 1. Start the HTTP Server

From the project root:

```bash
npm run oauth-test
```

This starts an HTTP server at `http://localhost:8082/` with CORS enabled.

### 2. Open the OAuth Validator

Navigate to:
```
http://localhost:8082/
```

Or open the file directly in your browser:
```
test-harness/oauth-test/index.html
```

**Note**: The MCP client test interface runs on a separate command:
```bash
npm run mcp-client  # Runs on http://localhost:8081/
```

### 3. Load Configuration File

Click "Choose File" and select an MCP OAuth configuration file, such as:
- `test-harness/config/phase3-test-config.json`
- `test-harness/config/v2-keycloak-token-exchange.json`
- Any custom configuration file

### 4. Authenticate

1. Select a trusted IDP from the dropdown
2. Click "🔑 Redirect to IDP Login"
3. You will be redirected to your IDP's login page
4. Enter your credentials at the IDP
5. After successful authentication, you'll be redirected back with your JWT token
6. View your requestor JWT token (both raw and decoded)

### 5. Perform Token Exchange

1. Select a delegation module (SQL, Kerberos, or custom)
2. The tool automatically performs RFC 8693 token exchange
3. View the delegated JWT token (both raw and decoded)
4. Optionally exchange for another module

## Configuration Requirements

The tool requires an MCP OAuth configuration file with the following structure:

```json
{
  "auth": {
    "trustedIDPs": [
      {
        "name": "Keycloak Local",
        "issuer": "http://localhost:8080/realms/mcp-realm",
        "discoveryUrl": "http://localhost:8080/realms/mcp-realm/.well-known/openid-configuration",
        "clientId": "mcp-oauth",
        "clientSecret": "optional-secret",
        "scope": "openid profile",
        "_note": "clientId is required for OAuth flow. If not specified, 'audience' will be used as fallback."
      }
    ]
  },
  "delegation": {
    "sql": {
      "tokenExchange": {
        "tokenEndpoint": "http://localhost:8080/realms/mcp-realm/protocol/openid-connect/token",
        "clientId": "mcp-oauth",
        "clientSecret": "your-client-secret",
        "audience": "urn:sql:database"
      }
    }
  }
}
```

### Important Configuration Fields

**`clientId` vs `audience`:**

- **`clientId`**: The OAuth client identifier used for the authorization flow. This is the client registered in your IDP that users will authenticate through.
- **`audience`**: The intended recipient of the JWT token (used for token validation). This may be different from the clientId.

**Configuration Behavior:**
- If `clientId` is present, it will be used for OAuth authorization requests
- If `clientId` is missing, the tool will fallback to using `audience` as the clientId
- If neither is present, an error will be thrown
- `clientSecret` is **optional** - only required for confidential clients

**Public Client (Recommended - No Secret):**
```json
{
  "clientId": "mcp-oauth",        // OAuth client for user authentication
  "audience": "mcp-oauth",        // Expected audience in JWT token
  "scope": "openid profile"       // OAuth scopes
  // No clientSecret - PKCE provides security
}
```

**Confidential Client (With Secret):**
```json
{
  "clientId": "mcp-oauth",        // OAuth client for user authentication
  "clientSecret": "your-secret",  // Client secret (confidential clients only)
  "audience": "mcp-server-api",   // Expected audience in JWT token
  "scope": "openid profile"
}
```

## Supported Delegation Modules

The tool automatically detects and displays delegation modules with token exchange configuration:

### SQL Delegation
```json
"delegation": {
  "sql": {
    "tokenExchange": {
      "tokenEndpoint": "...",
      "clientId": "mcp-oauth",
      "clientSecret": "secret",
      "audience": "urn:sql:database"
    }
  }
}
```

### Kerberos Delegation
```json
"delegation": {
  "kerberos": {
    "tokenExchange": {
      "tokenEndpoint": "...",
      "clientId": "mcp-oauth",
      "clientSecret": "secret",
      "audience": "urn:kerberos:service"
    }
  }
}
```

### Custom Delegation Modules
```json
"delegation": {
  "modules": {
    "myapi": {
      "name": "My API Delegation",
      "description": "Exchange token for My API access",
      "tokenExchange": {
        "tokenEndpoint": "...",
        "clientId": "mcp-oauth",
        "clientSecret": "secret",
        "audience": "urn:api:myservice"
      }
    }
  }
}
```

## Authentication Flow

### Step 1: Configuration Loading
1. User selects a configuration file
2. Tool parses and validates the JSON
3. Extracts trusted IDPs
4. Displays configuration summary

### Step 2: User Authentication (OAuth 2.1 Authorization Code with PKCE)
1. User selects an IDP from the list
2. Tool fetches OpenID Connect discovery document
3. Displays IDP details (issuer, authorization endpoint, token endpoint, etc.)
4. User clicks "Redirect to IDP Login"
5. Tool generates PKCE parameters:
   - `code_verifier`: Random 128-character string
   - `code_challenge`: SHA-256 hash of code_verifier (base64url encoded)
   - `state`: Random 32-character string for CSRF protection
6. Tool redirects to IDP authorization endpoint:
   ```
   GET /authorize?
   response_type=code&
   client_id={clientId}&
   redirect_uri={redirectUri}&
   scope=openid profile&
   state={state}&
   code_challenge={codeChallenge}&
   code_challenge_method=S256
   ```
7. User authenticates at IDP's login page
8. IDP redirects back with authorization code
9. Tool validates state parameter and exchanges code for tokens:
   ```
   POST /token
   Content-Type: application/x-www-form-urlencoded

   grant_type=authorization_code
   code={authorizationCode}
   redirect_uri={redirectUri}
   client_id={clientId}
   code_verifier={codeVerifier}
   ```
10. IDP returns access token (requestor JWT)
11. Tool decodes and displays JWT

### Step 3: Token Exchange (RFC 8693)
1. Tool lists all delegation modules with token exchange configured
2. User selects a module
3. Tool sends POST request to token endpoint:
   ```
   POST /token
   Content-Type: application/x-www-form-urlencoded

   grant_type=urn:ietf:params:oauth:grant-type:token-exchange
   subject_token={requestorJWT}
   subject_token_type=urn:ietf:params:oauth:token-type:access_token
   client_id={clientId}
   client_secret={clientSecret}
   audience={audience}
   ```
4. IDP returns exchanged access token (delegated JWT)
5. Tool decodes and displays JWT

## JWT Decoding

The tool decodes JWT tokens and displays:

### Standard Claims
- `iss` - Issuer
- `sub` - Subject (user ID)
- `aud` - Audience
- `azp` - Authorized party (client ID)
- `exp` - Expiration time (with human-readable timestamp)
- `iat` - Issued at (with human-readable timestamp)
- `nbf` - Not before (with human-readable timestamp)

### Custom Claims
- `legacy_sam_account` - Legacy username for SQL delegation
- `realm_access.roles` - User roles
- `permissions` - User permissions
- Any other custom claims in your configuration

## Keycloak Client Configuration

For the OAuth test tool to work, your Keycloak client **must** be configured correctly:

### Public Client Setup (Recommended)

1. **Client Type**: Public
   - Go to: Keycloak Admin → Clients → `mcp-oauth` → Settings
   - **Client authentication**: OFF (this makes it a public client)

2. **PKCE Configuration**:
   - Scroll to "Advanced Settings"
   - **Proof Key for Code Exchange (PKCE) Code Challenge Method**: S256

3. **Valid Redirect URIs**:
   - Add: `http://localhost:8082/*` (or your test tool URL)
   - Save changes

4. **Standard Flow**:
   - **Standard Flow Enabled**: ON
   - **Direct Access Grants**: ON (if using password flow for testing)

### Verification Checklist

✅ Client authentication: **OFF** (public client)
✅ PKCE Code Challenge Method: **S256**
✅ Valid Redirect URIs: Includes test tool URL
✅ Standard Flow Enabled: **ON**

### Troubleshooting

**Error: `unauthorized_client` or `invalid_client`**
- Client is likely configured as CONFIDENTIAL (needs secret)
- Set "Client authentication" to OFF in Keycloak

**Error: `invalid_grant` (PKCE validation failed)**
- PKCE may not be enabled or using wrong method
- Set "PKCE Code Challenge Method" to S256

## CORS Considerations

**Important**: This tool makes direct requests to your IDP from the browser. Your IDP must be configured to allow CORS requests from the origin where this tool is hosted.

### Keycloak CORS Configuration

For Keycloak, configure CORS in the client settings:

1. Navigate to your realm → Clients → (your client)
2. Go to "Settings" tab
3. Scroll to "Web Origins"
4. Add: `http://localhost:8081` (or your server origin)
5. Save

Alternatively, add `*` for testing (not recommended for production).

### Production Deployment

For production use, consider:
1. Hosting this tool on the same origin as your IDP
2. Using a backend proxy to avoid CORS issues
3. Implementing proper CORS policies on your IDP

## Security Considerations

✅ **Production-Ready OAuth Flow**

- **Authorization Code with PKCE**: Uses the recommended OAuth 2.1 flow
- **No Password Handling**: User credentials never pass through the web app
- **CSRF Protection**: State parameter validates redirect authenticity
- **Code Challenge**: SHA-256 PKCE prevents authorization code interception
- **Client Secrets**: Only exposed for public clients (confidential clients should use backend)
- **HTTPS**: Always use HTTPS in production
- **Token Storage**: Tokens stored in memory only (not persisted to localStorage)

## Troubleshooting

### "Failed to fetch discovery document"
- **Cause**: IDP is not accessible or discovery URL is incorrect
- **Solution**: Verify IDP is running and discovery URL is correct

### "CORS error"
- **Cause**: IDP does not allow CORS requests from your origin
- **Solution**: Configure CORS on your IDP (see above)

### "Authentication failed (401)"
- **Cause**: Invalid credentials or client configuration
- **Solution**: Verify username, password, and client credentials

### "Token exchange failed (400)"
- **Cause**: Invalid token exchange configuration
- **Solution**: Verify clientId, clientSecret, and audience are correct

### "Invalid JWT format"
- **Cause**: Response is not a valid JWT
- **Solution**: Check IDP response format and ensure access_token is returned

## Example Configuration Files

### Minimal Configuration
```json
{
  "auth": {
    "trustedIDPs": [
      {
        "name": "Test IDP",
        "issuer": "https://auth.example.com",
        "discoveryUrl": "https://auth.example.com/.well-known/openid-configuration",
        "clientId": "test-client"
      }
    ]
  }
}
```

### Full Configuration with Token Exchange
```json
{
  "auth": {
    "trustedIDPs": [
      {
        "name": "Keycloak Local",
        "issuer": "http://192.168.1.137:8080/realms/mcp_security",
        "discoveryUrl": "http://192.168.1.137:8080/realms/mcp_security/.well-known/openid-configuration",
        "clientId": "contextflow",
        "clientSecret": "test-secret",
        "audience": "mcp-oauth",
        "algorithms": ["RS256"],
        "scope": "openid profile"
      }
    ]
  },
  "delegation": {
    "sql": {
      "enabled": true,
      "tokenExchange": {
        "idpConfig": {
          "name": "sql-delegation",
          "issuer": "http://192.168.1.137:8080/realms/mcp_security",
          "discoveryUrl": "http://192.168.1.137:8080/realms/mcp_security/.well-known/openid-configuration",
          "tokenExchange": {
            "tokenEndpoint": "http://192.168.1.137:8080/realms/mcp_security/protocol/openid-connect/token",
            "clientId": "mcp-oauth",
            "clientSecret": "delegation-secret",
            "audience": "urn:sql:database",
            "scope": "sql:read sql:write"
          }
        }
      }
    }
  }
}
```

## Features Roadmap

Completed:
- [x] Authorization Code flow with PKCE support
- [x] CSRF protection with state parameter
- [x] Secure token handling (no passwords in browser)

Future enhancements could include:
- [ ] Multiple token exchange requests in sequence
- [ ] Token validation and expiration warnings
- [ ] Export test results as JSON
- [ ] Dark mode toggle
- [ ] Token refresh flow testing
- [ ] Support for multiple redirect URIs

## References

- **RFC 8693**: OAuth 2.0 Token Exchange - https://datatracker.ietf.org/doc/html/rfc8693
- **OpenID Connect Discovery**: https://openid.net/specs/openid-connect-discovery-1_0.html
- **MCP OAuth Documentation**: [../../Docs/oauth2 implementation.md](../../Docs/oauth2 implementation.md)
- **Test Harness Documentation**: [../README.md](../README.md)

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review the MCP OAuth documentation
3. Check Keycloak logs for authentication errors
4. Enable browser DevTools console for debugging

---

**Version**: 1.0
**Last Updated**: 2025-11-09
**Compatibility**: MCP OAuth Framework v3.0+
