# MCP OAuth Test Console

A comprehensive web-based test interface for testing OAuth 2.1 delegation with Keycloak SSO and the MCP Server.

## Features

✅ **Keycloak SSO Authentication** - Login with your configured Keycloak identity provider
✅ **Token Exchange (RFC 8693)** - Exchange subject token for delegated token
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

### Step 1: Authenticate with SSO

1. Click **"Login with Keycloak SSO"**
2. Complete the SSO authentication flow
3. You'll be redirected back with a Subject Token

The console will display:
- Your username and email
- Subject Token (from `contextflow` client)
- JWT claims including `iss`, `aud`, `azp`, `sub`

### Step 2: Exchange Token

1. Click **"Exchange Token"**
2. The console performs RFC 8693 token exchange
3. Subject Token → Exchanged Token (for `mcp-oauth` client)

The console will display:
- Exchanged Token claims
- Validation of `azp` claim
- Comparison of both tokens side-by-side

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

## Files

- `index.html` - Main test console interface
- `config.js` - Configuration (update this!)
- `app.js` - Application logic and OAuth flow
- `README.md` - This file

## Next Steps

After successful testing:

1. ✅ OAuth authentication works
2. ✅ Token exchange succeeds
3. ✅ azp claims validated correctly
4. ✅ MCP server accepts exchanged tokens

You can now integrate this OAuth pattern into your production MCP clients!