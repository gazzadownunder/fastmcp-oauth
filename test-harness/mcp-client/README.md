# MCP OAuth Integration Test Client

A comprehensive web-based test client for validating the MCP OAuth framework with Keycloak authentication.

## 🎯 Purpose

This test client validates the complete OAuth 2.1 + MCP integration workflow:

1. **Authentication** - Obtain access token from Keycloak IDP
2. **MCP Interaction** - Call MCP server tools with proper authentication

## 📋 Prerequisites

### Running Services

1. **Keycloak IDP** - Running on `localhost:8080`
   - Realm: `mcp_security`
   - Client: `mcp-oauth`
   - Test user configured with appropriate roles

2. **MCP OAuth Server** - Running on `localhost:3000`
   - Endpoint: `/mcp`
   - Configuration: Server must accept tokens from Keycloak

### Test User

- Username: `alice@test.local`
- Password: `Test123!`

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
# Python 3
python -m http.server 8000

# Node.js (if you have http-server installed)
npx http-server -p 8000

# Then navigate to: http://localhost:8000
```

### Step 2: Authenticate

Choose one of three authentication methods:

#### Option A: Password Grant Flow
1. Click **"🔑 Password Grant"**
2. Automatically authenticates as `alice@test.local`
3. Access token displayed immediately
4. JWT claims shown in the right panel

#### Option B: SSO Redirect Flow
1. Click **"🌐 SSO Redirect"**
2. Redirected to Keycloak login page
3. Enter credentials: `alice@test.local` / `Test123!`
4. Redirected back with access token

#### Option C: Manual JWT Import
1. Click **"Manual JWT Import"**
2. Paste a valid JWT token (from another source)
3. Click **"Import JWT"**
4. Access token set directly

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
┌─────────────────────────────────────────────────────────┐
│                   MCP OAuth Test Client                 │
└─────────────────────────────────────────────────────────┘
                           │
                           ↓
┌─────────────────────────────────────────────────────────┐
│  Step 1: Authentication (Password/SSO/Manual JWT)       │
│  - User authenticates with Keycloak                     │
│  - Receives access token (JWT)                          │
│  - Token claims displayed in UI                         │
└─────────────────────────────────────────────────────────┘
                           │
                           ↓
┌─────────────────────────────────────────────────────────┐
│  Step 2: MCP Session Initialization                     │
│  - Sends initialize request with Bearer token           │
│  - MCP server validates JWT                             │
│  - Session created (stateful) or stateless auth         │
└─────────────────────────────────────────────────────────┘
                           │
                           ↓
┌─────────────────────────────────────────────────────────┐
│  Step 3: Tool Discovery & Invocation                    │
│  - List available tools from server                     │
│  - Call tools with Bearer auth on each request          │
│  - Results displayed in response panel                  │
└─────────────────────────────────────────────────────────┘
```

## 💡 Tips

- **Use Password Grant for quick testing** - No redirect, immediate results
- **Use SSO for realistic flow** - Tests full OAuth authorization code flow
- **Watch the Activity Log** - Shows exactly what's happening at each step
- **Check JWT Claims** - Verify roles and custom claims are present
- **Test with different users** - Verify role-based access control works
