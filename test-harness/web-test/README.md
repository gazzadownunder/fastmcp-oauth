# MCP OAuth Test Console

A comprehensive web-based test interface for testing OAuth 2.1 delegation with Keycloak SSO and the MCP Server.

## Features

✅ **Keycloak SSO Authentication** - Login with your configured Keycloak identity provider
✅ **Manual JWT Import** - Import and test any JWT token without SSO login
✅ **Token Exchange (RFC 8693)** - Exchange subject token for delegated token
✅ **Direct Subject Token Testing** - Skip exchange and test with subject token (validates JWT without exchange)
✅ **JWT Claims Analysis** - View and compare token claims side-by-side
✅ **MCP Server Integration** - Test MCP tools with OAuth authentication
✅ **Real-time Logging** - Track the complete OAuth flow
✅ **azp Validation** - Verify authorized party claims for security

## Setup

### 1. Update Configuration

Edit `config.js` and update these values:

```javascript
const CONFIG = {
    keycloak: {
        url: 'http://localhost:8080',
        realm: 'mcp-security',               // Your Keycloak realm
        clientId: 'contextflow',             // Subject token client
        exchangeClientId: 'mcp-oauth',       // Exchange target client
        exchangeClientSecret: 'your-secret'  // Update this!
    },
    mcp: {
        url: 'http://localhost:3000',
        endpoint: '/mcp'
    }
};
```

### 2. Start MCP Server

```bash
# In the project root
$env:NODE_ENV="development"
$env:CONFIG_PATH="./test-harness/config/keycloak-oauth-only.json"
$env:SERVER_PORT="3000"
npm start
```

### 3. Serve the Web Console

Open a web server in the `web-test` directory:

```bash
# Using Python
cd test-harness/web-test
python -m http.server 8000

# Or using Node.js http-server
npx http-server -p 8000

# Or using PHP
php -S localhost:8000
```

### 4. Open in Browser

Navigate to: http://localhost:8000

## Usage

### Authentication Options

You have **three** ways to authenticate:

#### Option A: Keycloak SSO Login (Full OAuth Flow)

1. Click **"Login with Keycloak SSO"**
2. Complete the SSO authentication flow
3. You'll be redirected back with a Subject Token

#### Option B: Manual JWT Import (Test Any Token)

1. Click **"Manual JWT Import"**
2. Paste your JWT token into the textarea
3. Click **"Import JWT"**

This is useful for:
- Testing tokens from different IDPs
- Testing expired tokens
- Testing tokens with different claims
- Debugging JWT validation issues

#### Option C: Use Existing Token from Browser Storage

If you've previously logged in, the console will automatically detect and use your existing session.

### Step 1: Authenticate

After authenticating (via SSO or manual import), the console will display:
- Your username and email
- Subject Token
- JWT claims including `iss`, `aud`, `azp`, `sub`
- Token expiration status

### Step 2: Choose Token Flow

You have **two** options for connecting to the MCP server:

#### Option A: Full Token Exchange (RFC 8693)

1. Click **"Exchange Token"**
2. The console performs RFC 8693 token exchange
3. Subject Token → Exchanged Token (for `mcp-oauth` client)

The console will display:
- Exchanged Token claims
- Validation of `azp` claim
- Comparison of both tokens side-by-side

#### Option B: Skip Exchange (Use Subject Token Directly)

1. Click **"Skip Exchange (Use Subject Token)"**
2. The console connects directly with the subject token

This is useful for:
- Testing JWT validation without token exchange
- Testing subject tokens with appropriate audience claims
- Debugging authentication issues
- Verifying the MCP server accepts subject tokens

### Step 3: Test MCP Server

Click any of the MCP tool buttons:

- **user-info**: Get authenticated user session information
- **health-check**: Check MCP server and delegation services health
- **sql-delegate**: Test SQL delegation (requires SQL configuration)

The console will:
- Send authenticated requests to MCP server
- Display detailed request/response
- Show authentication debug output from server
- Validate OAuth flow end-to-end

## What to Look For

### ✅ Successful OAuth Flow

```
Subject Token Claims:
{
  "azp": "contextflow",    ← Should match subject client
  "aud": "contextflow",
  "iss": "http://localhost:8080/realms/mcp-security"
}

Exchanged Token Claims:
{
  "azp": "mcp-oauth",      ← Should match target client
  "aud": "mcp-oauth",
  "iss": "http://localhost:8080/realms/mcp-security"
}
```

### ❌ Common Issues

**Token Exchange Fails**
- Check `exchangeClientSecret` in config.js
- Verify token exchange is enabled in Keycloak
- Check Keycloak permissions

**MCP Server Not Responding**
- Verify server is running: `http://localhost:3000/mcp`
- Check NODE_ENV=development for HTTP localhost
- Review server logs for debug output

**Authentication Rejected**
- Check `azp` claim matches expected audience
- Verify issuer is trusted in server config
- Check token hasn't expired

## Security Validation

The console validates critical security requirements:

1. **Subject Token azp** = `contextflow` ✓
2. **Exchanged Token azp** = `mcp-oauth` ✓
3. **Issuer** matches configured Keycloak realm ✓
4. **Token expiration** checked before use ✓

## Debugging

### Enable Debug Logging

The console logs all OAuth operations:
- SSO authentication flow
- Token exchange requests/responses
- MCP server calls
- JWT claim validation

### Server-Side Debugging

The MCP server will log detailed authentication:
```
[AUTH DEBUG] ========== Authentication Request ==========
[AUTH DEBUG] Bearer token extracted successfully
[AUTH DEBUG] JWT Claims:
  - iss (issuer): http://localhost:8080/realms/mcp-security
  - aud (audience): "mcp-oauth"
  - azp (authorized party): mcp-oauth
[JWT VALIDATOR] ✓ Issuer is trusted
[JWT VALIDATOR] ✓ azp claim matches expected audience
[AUTH DEBUG] ✓ JWT validation SUCCESSFUL
```

## Architecture

```
┌─────────────┐      SSO Login      ┌──────────────┐
│   Browser   │ ──────────────────► │  Keycloak    │
│  (Console)  │ ◄────────────────── │    SSO       │
└─────────────┘   Subject Token     └──────────────┘
       │              (contextflow client)
       │
       │         Token Exchange
       │         (RFC 8693)
       │
       ▼
┌──────────────┐
│  Keycloak    │
│  Token       │
│  Exchange    │
└──────────────┘
       │
       │         Exchanged Token
       │         (mcp-oauth client)
       ▼
┌─────────────┐
│ MCP Server  │ ← Validates azp claim
│ localhost   │ ← Checks trusted issuer
│ :3000/mcp   │ ← Creates user session
└─────────────┘
```

## Testing Scenarios

### Scenario 1: Full OAuth Flow (Recommended)
1. Login with Keycloak SSO
2. Exchange token (RFC 8693)
3. Test MCP server with exchanged token
4. ✅ Validates complete OAuth 2.1 delegation pattern

### Scenario 2: Subject Token Validation
1. Login with Keycloak SSO
2. Skip exchange (use subject token directly)
3. Test MCP server with subject token
4. ✅ Validates JWT validation without exchange

### Scenario 3: Manual Token Testing
1. Click "Manual JWT Import"
2. Paste any JWT token
3. Skip exchange or attempt exchange
4. Test MCP server
5. ✅ Validates custom tokens, expired tokens, or tokens from other IDPs

### Scenario 4: Testing Expired Tokens
1. Import an expired JWT manually
2. Observe expiration warning in logs
3. Attempt to connect to MCP
4. ✅ Validates server-side expiration checks

### Scenario 5: Testing azp Claims
1. Import JWT with different `azp` values
2. Test MCP server connection
3. Observe validation success/failure
4. ✅ Validates authorized party (azp) claim enforcement

## Files

- `index.html` - Main test console interface
- `config.js` - Configuration (update this!)
- `app.js` - Application logic and OAuth flow
- `mcp-client.js` - MCP SSE client implementation
- `README.md` - This file

## Next Steps

After successful testing:

1. ✅ OAuth authentication works
2. ✅ Token exchange succeeds
3. ✅ azp claims validated correctly
4. ✅ MCP server accepts exchanged tokens

You can now integrate this OAuth pattern into your production MCP clients!