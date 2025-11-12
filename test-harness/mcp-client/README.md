# MCP OAuth Integration Test Client

A comprehensive web-based test client for validating the MCP OAuth framework with Keycloak authentication.

## 🎯 Purpose

This test client validates the complete OAuth 2.1 + MCP integration workflow:

1. **Authentication** - Obtain access token from Keycloak IDP
2. **MCP Interaction** - Call MCP server tools with proper authentication

## 📋 Prerequisites

### Running Services

1. **OAuth Identity Provider (IDP)** - OAuth 2.1 compliant authorization server
   - Default configuration uses Keycloak on `localhost:8080`
   - Realm, client ID, and endpoints configurable in [config.js](config.js)
   - Must support authorization code flow with PKCE and/or password grant
   - Test user configured with appropriate roles

2. **MCP OAuth Server** - MCP server with OAuth authentication
   - Default configuration uses `localhost:3000`
   - Endpoint and protocol version configurable in [config.js](config.js)
   - Server must accept tokens from the configured IDP

**Note**: All IDP and server URLs, realms, client IDs, and endpoints are fully configurable in [config.js](config.js). The defaults shown above are examples only.

### Test User

Default test credentials (configurable in [config.js](config.js)):
- Username: `alice@test.local`
- Password: `Test123!`

**Note**: Test user credentials must exist in your configured IDP with appropriate roles and claims.

## 🚀 Usage

### Step 1: Open the Client

```bash
# Navigate to the test client directory
cd test-harness/mcp-client

# Open index.html in a web browser
# You can use a simple HTTP server or open directly
```

**Recommended**: Use a local HTTP server to avoid CORS issues:

```bash
# Option 1: Use npm script (recommended - from project root)
npm run test:mcp-client

# Option 2: Python 3
python -m http.server 8000

# Option 3: Node.js (if you have http-server installed)
npx http-server -p 8000

# Then navigate to: http://localhost:8000
```

**Note**: The `npm run test:mcp-client` script automatically starts an HTTP server on port 8000 and serves the test client from the `test-harness/mcp-client` directory.

### Step 2: Authenticate

Choose one of **five** authentication methods. Each method demonstrates a different OAuth 2.1 flow or discovery mechanism:

---

#### Option A: 🔑 Password Grant Flow
**Purpose:** Direct IDP login using pre-configured credentials

**OAuth Flow:** Resource Owner Password Credentials Grant (RFC 6749 Section 4.3)

**How it Works:**
1. Click **"🔑 Password Grant"**
2. Client directly submits username/password to token endpoint
3. Returns access token immediately (no browser redirect)
4. JWT claims displayed in the right panel

**Use Cases:**
- Quick testing without browser redirects
- Automated testing scripts
- Development with known test credentials

**Technical Details:**
- Uses `grant_type=password`
- Requires client credentials (`client_id` + `client_secret`)
- Direct POST to `/token` endpoint
- No PKCE required (server-to-server flow)

---

#### Option B: 🌐 SSO Redirect Flow
**Purpose:** Standard browser-based OAuth flow with IDP login page

**OAuth Flow:** Authorization Code Flow with PKCE (RFC 7636)

**How it Works:**
1. Click **"🌐 SSO Redirect"**
2. Browser redirects to Keycloak login page
3. User enters credentials: `alice@test.local` / `Test123!`
4. IDP redirects back with authorization code
5. Client exchanges code for access token (with PKCE verification)

**Use Cases:**
- Realistic production-like OAuth flow
- Testing SSO scenarios
- Multi-step authentication testing
- PKCE validation

**Technical Details:**
- Uses `response_type=code`
- PKCE code challenge/verifier (SHA-256)
- Two-step process: code → token
- Requires `redirect_uri` configuration

---

#### Option C: 🔗 MCP OAuth Discovery
**Purpose:** Standards-compliant MCP protocol OAuth discovery

**OAuth Flow:** Authorization Code Flow with **MCP-specific discovery** (RFC 9728)

**How it Works:**
1. Click **"🔗 MCP OAuth Discovery"**
2. Client fetches `/.well-known/oauth-protected-resource` from MCP server
3. Extracts `authorization_servers` array from metadata
4. Fetches `/.well-known/oauth-authorization-server` from first auth server
5. Redirects to discovered `authorization_endpoint`

**Use Cases:**
- Testing MCP OAuth 2.1 specification compliance
- Validating protected resource metadata
- No hardcoded authorization URLs needed
- Production MCP client behavior

**Technical Details:**
- Follows MCP OAuth 2.1 spec for discovery
- Fetches RFC 9728 protected resource metadata
- Discovers authorization endpoint dynamically
- Uses PKCE (same as SSO flow after discovery)

**Discovery Endpoints:**
```
1. GET /.well-known/oauth-protected-resource
   → { authorization_servers: ["https://auth.example.com"] }

2. GET https://auth.example.com/.well-known/oauth-authorization-server
   → { authorization_endpoint: "...", token_endpoint: "..." }

3. Redirect to authorization_endpoint
```

---

#### Option D: 🔍 Inspector-Style Auth
**Purpose:** MCP Inspector compatibility with direct auth server discovery

**OAuth Flow:** Authorization Code Flow with **direct authorization server metadata discovery**

**How it Works:**
1. Click **"🔍 Inspector-Style Auth"**
2. Send MCP `initialize` request (expects 401 Unauthorized)
   - Validates `WWW-Authenticate` header is present (confirms OAuth is configured)
   - Header contents are **not parsed or used** (discovery happens via well-known endpoints)
3. **Discovery:** Fetch `/.well-known/oauth-authorization-server` (RFC 8414) directly from MCP server
   - Treats MCP server as the authorization server
   - Extracts authorization and token endpoints
   - Redirects to authorization endpoint

**Use Cases:**
- Testing MCP Inspector compatibility
- Servers that don't implement protected resource metadata
- Direct authorization server discovery (no protected resource intermediary)
- Simplified discovery for backwards compatibility

**Technical Details:**
- Skips protected resource metadata entirely
- Goes directly to authorization server metadata on MCP server
- Simpler than MCP OAuth Discovery (Option C)
- Uses PKCE (same as other flows)

**Discovery Flow:**
```
Step 1 (Validation):
  POST /mcp (initialize request without auth)
  → Expect: 401 Unauthorized
  → Validate: WWW-Authenticate header present (confirms OAuth enabled)
  → Note: Header contents NOT used for discovery

Step 2 (Direct Discovery):
  GET /.well-known/oauth-authorization-server (from MCP server)
  → Extract authorization_endpoint and token_endpoint
  → Redirect to authorization_endpoint
```

---

#### Option E: 📋 Manual JWT Import
**Purpose:** Import externally-obtained JWT for testing

**OAuth Flow:** None (bypass authentication)

**How it Works:**
1. Click **"Manual JWT Import"**
2. Paste a valid JWT token from external source
3. Click **"Import JWT"**
4. Token decoded and validated client-side
5. Access token set directly (no IDP interaction)

**Use Cases:**
- Testing with tokens from Postman, curl, etc.
- Debugging specific token scenarios
- Testing token expiration/validation
- Importing tokens from other authentication systems

**Technical Details:**
- Client-side JWT decoding only
- No server validation (validation happens on MCP requests)
- Useful for testing malformed tokens
- No refresh token support

---

### Option F: 🎯 MCP Client Compliant

**What it does:** Implements MCP Protocol 2.3.2 OAuth discovery flow with protected resource metadata and fallback.

**How it works (MCP Protocol 2.3.2):**

1. **MCP Initialize Request:** Attempts MCP initialize without authentication
   - Method: `POST /mcp` with `initialize` request
   - Expected: HTTP 401 Unauthorized response

2. **Check WWW-Authenticate Header:** Examines response for OAuth metadata
   - Header: `WWW-Authenticate: Bearer ...`
   - Looks for: `resource_metadata="<url>"` parameter

3. **Extract resource_metadata URL:** Parses the resource_metadata parameter
   - Extracts the URL to protected resource metadata document
   - If parameter missing, proceeds to well-known URI fallback

4. **Primary Discovery - Protected Resource Metadata (RFC 9728):**
   - **Priority 1:** Use `resource_metadata` URL from WWW-Authenticate header (if present)
   - **Priority 2:** Try `${MCP_SERVER}/.well-known/oauth-protected-resource/mcp` (MCP-specific)
   - **Priority 3:** Try `${MCP_SERVER}/.well-known/oauth-protected-resource` (standard RFC 9728)
   - Extracts `authorization_servers` array and fetches authorization server metadata

5. **Fallback Discovery - Authorization Server Metadata (RFC 8414):**
   - If all protected resource attempts fail, try direct auth server metadata
   - URL: `${MCP_SERVER}/.well-known/oauth-authorization-server`
   - Standard: RFC 8414 (OAuth 2.0 Authorization Server Metadata)

6. **Authorization:** Redirects to discovered authorization endpoint with PKCE

7. **Token Exchange:** Exchanges authorization code for access token at discovered token endpoint

**When to use:**
- Production MCP clients requiring full MCP Protocol 2.3.2 compliance
- Testing MCP server OAuth implementation end-to-end
- Validating both protected resource and fallback discovery paths
- Maximum compatibility across different MCP server configurations

**Technical Details:**
- OAuth Flow: Authorization Code Flow with PKCE (RFC 7636)
- Discovery: MCP initialize → WWW-Authenticate → RFC 9728 → RFC 8414 fallback
- PKCE: Required (S256 code challenge)
- Redirect: Yes (to discovered authorization endpoint)
- Token Storage: sessionStorage with discovered endpoint fallback
- Scope: Configurable (default: `email openid`)
- Compliance: MCP Protocol 2.3.2 (full spec)

---

### Authentication Method Comparison

| Method | OAuth Flow | Discovery Mechanism | PKCE | Redirect | Use Case | Complexity |
|--------|------------|---------------------|------|----------|----------|------------|
| **🔑 Password Grant** | Resource Owner Password | None (hardcoded endpoints) | ❌ | ❌ | Quick testing | ⭐ Low |
| **🌐 SSO Redirect** | Authorization Code | None (hardcoded endpoints) | ✅ | ✅ | Production OAuth | ⭐⭐ Medium |
| **🔗 MCP OAuth** | Authorization Code | RFC 9728 Protected Resource | ✅ | ✅ | MCP spec compliance | ⭐⭐⭐ High |
| **🔍 Inspector-Style** | Authorization Code | RFC 8414 Auth Server (Direct) | ✅ | ✅ | Inspector compatibility | ⭐⭐ Medium |
| **🎯 MCP Client** | Authorization Code | MCP 2.3.2 (Init → WWW-Auth → RFC 9728 → RFC 8414) | ✅ | ✅ | Full MCP compliance | ⭐⭐⭐⭐ Advanced |
| **📋 Manual JWT** | None (bypass) | N/A | ❌ | ❌ | Token debugging | ⭐ Low |

**Key Differences:**

- **Password Grant:** Direct credentials → token (no discovery, no redirect)
- **SSO Redirect:** Hardcoded IDP URL → authorization code flow (production-like)
- **MCP OAuth Discovery:** Fetches protected resource metadata → discovers auth server → redirects
- **Inspector-Style:** Fetches auth server metadata directly → redirects (no protected resource attempt)
- **MCP Client Compliant:** MCP initialize request → checks WWW-Authenticate → tries protected resource → falls back to auth server → redirects (full MCP Protocol 2.3.2)
- **Manual JWT:** Paste token directly (bypass all OAuth flows)

**When to Use Each:**

- **Password Grant:** Development, automated tests, quick iterations
- **SSO Redirect:** Realistic OAuth testing, SSO validation
- **MCP OAuth Discovery:** Validate MCP OAuth 2.1 spec compliance with protected resource metadata
- **Inspector-Style:** Test Inspector compatibility, servers without protected resource metadata
- **MCP Client Compliant:** Production deployments, maximum compatibility, spec-compliant clients
- **Manual JWT:** Debug specific tokens, test edge cases

---

### Step 3: Initialize MCP Session

1. Click **"Initialize MCP Session"**
2. Sends `initialize` request to MCP server with Bearer token
3. Session ID returned (if stateful mode)
4. Server info displayed in response panel

### Step 4: List Available Tools

1. Click **"📋 List Available Tools"**
2. Retrieves all tools from MCP server
3. Tool buttons become enabled
4. Available tools displayed in response panel

### Step 5: Call MCP Tools

Click any tool button to invoke it:

- **user-info** - Get current user session information (shows authenticated user details)
- **health-check** - Check delegation service health (verifies SQL/Kerberos connections)
- **sql-delegate** - Execute test SQL query (requires SQL delegation configured)
- **audit-log** - Retrieve audit log entries (admin role required)

## 📊 UI Components

### Authentication Panel (Step 1)
- **Status Badge** - Shows authentication state (Not Authenticated / Authenticated)
- **Login Buttons** - Password grant or SSO redirect
- **Manual JWT** - Import token directly for testing
- **User Info** - Displays username, email, access token
- **JWT Claims** - Full token claims JSON (right panel)

### MCP Interaction Panel (Step 2)
- **Status Badge** - Shows MCP connection state
- **Initialize Button** - Start MCP session with Bearer auth
- **List Tools Button** - Discover available tools
- **Tool Buttons** - Invoke specific tools
- **Response Display** - Pretty-printed JSON responses

### Activity Log Panel
- **Timestamped Entries** - All operations logged with timestamps
- **Color-Coded Levels** - Info (blue), Success (green), Error (red), Warning (orange)
- **Clear Button** - Reset log display
- **Auto-scroll** - Automatically scrolls to latest entry

## 🔍 Testing Scenarios

### Scenario 1: Password Grant → MCP Tools
```
1. Click "Password Grant"
2. Click "Initialize MCP Session"
3. Click "List Available Tools"
4. Click "Call: user-info"
```

**Expected**: User info returned showing authenticated session with roles and claims

### Scenario 2: SSO Redirect → SQL Delegation
```
1. Click "SSO Redirect"
2. Login at Keycloak (alice@test.local / Test123!)
3. Click "Initialize MCP Session"
4. Click "List Available Tools"
5. Click "Call: sql-delegate"
```

**Expected**: SQL query executed on behalf of user (shows delegated user and current context)

### Scenario 3: Manual JWT → Health Check
```
1. Click "Manual JWT Import"
2. Paste valid JWT token
3. Click "Import JWT"
4. Click "Initialize MCP Session"
5. Click "Call: health-check"
```

**Expected**: Health check returns service status (SQL/Kerberos connectivity)

### Scenario 4: Admin Tool Access
```
1. Authenticate (any method) with admin role
2. Click "Initialize MCP Session"
3. Click "Call: audit-log"
```

**Expected**: Audit log returned (if user has admin role) OR 403 Forbidden (if not admin)

## 🔧 Configuration

Edit [config.js](config.js) to customize:

### OAuth Settings
```javascript
oauth: {
  realm: 'mcp_security',
  authEndpoint: 'http://localhost:8080/realms/mcp_security/protocol/openid-connect/auth',
  tokenEndpoint: 'http://localhost:8080/realms/mcp_security/protocol/openid-connect/token',
  clientId: 'mcp-oauth',
  clientSecret: '9DQjCpm4D9wbzXxHa1ki51PhBbyxOXrg',
  // ...
}
```

### MCP Server Settings
```javascript
mcp: {
  baseUrl: 'http://localhost:3000',
  endpoint: '/mcp',
  protocolVersion: '2024-11-05',
  // ...
}
```

### Test User Credentials
```javascript
testUser: {
  username: 'alice@test.local',
  password: 'Test123!'
}
```

### Scope Configuration

Each authentication method can use different OAuth scopes:

```javascript
scopes: {
  password: 'email openid',           // Password grant flow
  sso: 'email openid',                // SSO redirect (authorization code)
  mcpOAuth: 'email openid',           // MCP OAuth discovery
  inspector: 'email openid'           // Inspector-style OAuth
}
```

**Common Scope Configurations:**

- **Basic OIDC**: `'email openid'` - Email and user ID claims
- **Full Profile**: `'email openid profile'` - Adds name, picture, etc.
- **Custom MCP Scopes**: `'email openid mcp:read mcp:write'` - MCP-specific permissions
- **API-Specific**: `'email openid sql:query sql:execute'` - Resource-specific scopes

**Note**: For Inspector-style OAuth, scopes are only included if `inspector.useDefaultScopes` is set to `false`. When `true`, the IDP's default scopes are used.

**Example - Different Scopes per Method:**
```javascript
scopes: {
  password: 'email openid profile',              // More info for testing
  sso: 'email openid mcp:read mcp:write',       // Production-like scopes
  mcpOAuth: 'email openid',                      // Minimal scopes
  inspector: 'email openid offline_access'       // Inspector with refresh token
}
```

### Inspector-Style OAuth Configuration

**Special Settings for Inspector-Style Authentication:**

```javascript
oauth: {
  // ... other OAuth settings ...

  inspector: {
    enabled: true,                    // Enable Inspector-style auth button
    useDefaultScopes: false           // Control scope parameter behavior
  }
}
```

**`inspector.enabled`** (boolean):
- **`true`**: Inspector-style auth button is available
- **`false`**: Button is hidden and feature is disabled

**`inspector.useDefaultScopes`** (boolean):
- **`false`** (recommended): Include `scope` parameter with value from `scopes.inspector`
  - Allows explicit scope control for testing
  - Example: `scope=email openid mcp:read`
- **`true`**: Omit `scope` parameter from authorization request
  - IDP uses its default scopes
  - Useful for testing IDP default behavior
  - Example: Authorization request has no `scope` parameter

**When to Use `useDefaultScopes: true`:**
- Testing IDP default scope behavior
- Debugging scope-related issues
- Replicating exact Inspector behavior (which may omit scopes in certain configurations)

**When to Use `useDefaultScopes: false`:**
- Explicit scope testing
- Custom MCP scope validation
- Production-like scope requests

## 🐛 Troubleshooting

### Authentication Fails

**Problem**: "Login failed: invalid_client"

**Solution**: Verify Keycloak client secret in [config.js](config.js) matches server configuration

### MCP Initialization Fails

**Problem**: "MCP initialization failed: HTTP 401"

**Solution**:
- Verify MCP server is running on localhost:3000
- Check that token is valid and not expired
- Ensure server configuration accepts the token issuer
- Verify `trustedIDPs` configuration in server config matches Keycloak realm

### Tool Call Returns 403 Forbidden

**Problem**: "Tool call error: Forbidden"

**Solution**:
- Check user has required role (e.g., admin for audit-log)
- Verify role mappings in server configuration
- Inspect JWT claims to confirm roles are present
- Check `roleMappings` section in server config

### SQL Delegation Fails

**Problem**: "Tool 'sql-delegate' failed: Delegation error"

**Solution**:
- Verify SQL Server is configured and accessible
- Check that user has `legacy_sam_account` or `legacy_name` claim in JWT
- Ensure SQL delegation module is enabled in server config
- Verify SQL connection string and credentials

### CORS Errors

**Problem**: "CORS policy: No 'Access-Control-Allow-Origin' header"

**Solution**:
- Serve client from HTTP server (not `file://` protocol)
- Verify MCP server CORS configuration allows origin
- Check browser console for specific CORS error details
- Ensure `mcp-proxy` CORS headers are configured correctly

## 📝 Log Analysis

### Info Messages (Blue)
- Operation started (e.g., "Starting Password Grant flow...")
- Request sent (e.g., "Sending initialize request")
- Configuration loaded

### Success Messages (Green)
- Authentication successful
- MCP session initialized
- Tool call completed
- Token imported successfully

### Error Messages (Red)
- Authentication failed
- HTTP error responses (401, 403, 500)
- Invalid tokens
- Network errors

### Warning Messages (Orange)
- Deprecated features
- Non-critical issues
- Configuration warnings

## 🔐 Security Notes

1. **Never use in production** - Test credentials hardcoded in config
2. **HTTP vs HTTPS** - Localhost uses HTTP (production should use HTTPS)
3. **Token Display** - Full tokens visible in UI (for debugging only)
4. **Browser Storage** - No tokens stored in localStorage/sessionStorage
5. **Log Sanitization** - Full error messages logged (disable in production)

## 📚 Related Documentation

- [Phase 3 Test Harness](../phase3-integration.test.ts) - Integration tests
- [Phase 3 Test Config](../config/phase3-test-config.json) - Server configuration
- [CLAUDE.md](../../CLAUDE.md) - Framework architecture
- [OAuth 2.1 Implementation](../../Docs/oauth2%20implementation.md) - OAuth details

## 🎓 Learning Resources

### OAuth 2.1 Flows
- Password Grant: [RFC 6749 Section 4.3](https://datatracker.ietf.org/doc/html/rfc6749#section-4.3)
- Authorization Code: [RFC 6749 Section 4.1](https://datatracker.ietf.org/doc/html/rfc6749#section-4.1)

### MCP Protocol
- [MCP Specification](https://modelcontextprotocol.io)
- [JSON-RPC 2.0](https://www.jsonrpc.org/specification)

## 📞 Support

For issues or questions:
1. Check the Activity Log for error details
2. Review browser console (F12) for JavaScript errors
3. Verify all prerequisites are running (Keycloak + MCP server)
4. Check server logs (MCP server + Keycloak)
5. Refer to troubleshooting section above

## 🔄 Workflow Summary

```
┌─────────────────────────────────────────────────────────────────────┐
│                      MCP OAuth Test Client                          │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ↓
┌─────────────────────────────────────────────────────────────────────┐
│  Step 1: Authentication (choose one of 5 methods)                   │
│                                                                      │
│  🔑 Password Grant - Direct credentials → token                     │
│  🌐 SSO Redirect - Browser redirect → IDP login → code → token     │
│  🔗 MCP OAuth Discovery - Fetch metadata → discover → redirect      │
│  🔍 Inspector-Style - Fallback discovery → redirect                 │
│  📋 Manual JWT - Paste token directly                               │
│                                                                      │
│  Result: Access token (JWT) obtained and displayed                  │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ↓
┌─────────────────────────────────────────────────────────────────────┐
│  Step 2: MCP Session Initialization                                 │
│  - Send initialize request with Bearer token                        │
│  - MCP server validates JWT signature                               │
│  - Extract user claims (userId, roles, permissions)                 │
│  - Session created (stateful) or stateless auth                     │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ↓
┌─────────────────────────────────────────────────────────────────────┐
│  Step 3: Tool Discovery & Invocation                                │
│  - List available tools from server                                 │
│  - Tool visibility filtered by user permissions                     │
│  - Call tools with Bearer auth on each request                      │
│  - Server enforces role-based access control                        │
│  - Results displayed in response panel                              │
└─────────────────────────────────────────────────────────────────────┘
```

### Discovery Flow Comparison

**MCP OAuth Discovery (Option C):**
```
Client → GET /.well-known/oauth-protected-resource (MCP server)
       → Extract authorization_servers[0]
       → GET {auth_server}/.well-known/oauth-authorization-server
       → Redirect to authorization_endpoint
```

**Inspector-Style Discovery (Option D):**
```
Client → POST /mcp (initialize without auth)
       → Receive 401 Unauthorized
       → Validate WWW-Authenticate header present
       → (Header contents NOT parsed)

       → GET /.well-known/oauth-authorization-server (MCP server)
       → Extract authorization_endpoint and token_endpoint
       → Redirect to authorization_endpoint
```

**Key Differences:**
- **MCP OAuth Discovery** uses protected resource metadata (RFC 9728) to discover authorization server
- **MCP OAuth Discovery** two-step process: protected resource → auth server metadata
- **Inspector-Style** validates OAuth is enabled via 401 + WWW-Authenticate header check first
- **Inspector-Style** goes directly to authorization server metadata (RFC 8414) - simpler, one-step discovery
- **Inspector-Style** treats MCP server as the authorization server (no separate auth server URL)

## 💡 Tips

### Authentication Method Selection
- **Use Password Grant** for quick testing - No redirect, immediate results
- **Use SSO Redirect** for realistic production flow - Tests full OAuth authorization code flow
- **Use MCP OAuth Discovery** to validate spec compliance - Tests RFC 9728 protected resource metadata
- **Use Inspector-Style** for compatibility testing - Tests MCP Inspector fallback discovery
- **Use Manual JWT** for token debugging - Import tokens from external tools

### Testing Best Practices
- **Watch the Activity Log** - Shows exactly what's happening at each step
- **Check JWT Claims** - Verify roles and custom claims are present in decoded token
- **Test with different users** - Verify role-based access control works correctly
- **Compare discovery methods** - See how MCP OAuth vs Inspector-Style differ
- **Test fallback behavior** - Temporarily disable protected resource metadata to test Inspector fallback
- **Validate scopes** - Check which scopes are requested vs granted in token

### Debugging OAuth Issues
- **Check browser console (F12)** for detailed OAuth flow logs
- **Inspect redirect URLs** to see authorization parameters
- **Verify PKCE parameters** (code_challenge, code_verifier) in logs
- **Compare discovery responses** between MCP OAuth and Inspector-Style
- **Test with `protectedResource: false`** in server config to disable protected resource metadata (Inspector-Style will still work)
