# Quick Start Guide

Get started with the MCP OAuth Framework in 15 minutes. This guide covers the essentials for building a working OAuth-secured MCP server.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Simplest Setup (Recommended)](#simplest-setup-recommended)
- [Manual Wiring Setup](#manual-wiring-setup)
- [Configuration](#configuration)
- [Testing Your Server](#testing-your-server)
- [Common Issues](#common-issues)

---

## Prerequisites

Before starting, ensure you have:

1. **Node.js 18+** installed (`node --version`)
2. **An OAuth 2.1/OIDC Identity Provider** (Keycloak, Auth0, Okta, Azure AD, etc.)
3. **JWKS endpoint URL** from your IDP (e.g., `https://auth.example.com/.well-known/jwks.json`)
4. **Audience value** for your MCP server (configured in IDP, e.g., `mcp-server-api`)

---

## Installation

### Option 1: Install from npm (Production)

```bash
npm install fastmcp-oauth-obo
```

### Option 2: Clone from source (Development)

```bash
git clone https://github.com/your-org/MCP-Oauth.git
cd MCP-Oauth
npm install
npm run build
```

---

## Simplest Setup (Recommended)

Use the `MCPOAuthServer` wrapper for minimal boilerplate (19 lines of code).

### Step 1: Create Configuration File

Create `config/unified-config.json`:

```json
{
  "auth": {
    "trustedIDPs": [
      {
        "issuer": "https://auth.example.com",
        "jwksUri": "https://auth.example.com/.well-known/jwks.json",
        "audience": "mcp-server-api",
        "algorithms": ["RS256"],
        "claimMappings": {
          "legacyUsername": "preferred_username",
          "roles": "roles",
          "scopes": "scope"
        }
      }
    ],
    "roleMappings": {
      "admin": ["admin", "administrator"],
      "user": ["user", "member"],
      "guest": ["guest"],
      "defaultRole": "guest"
    }
  },
  "mcp": {
    "serverName": "My OAuth MCP Server",
    "version": "1.0.0",
    "transport": "httpStream",
    "port": 3000
  }
}
```

**Key Configuration Points:**
- `issuer`: Must match the `iss` claim in your JWTs
- `jwksUri`: HTTPS endpoint with your IDP's public keys
- `audience`: Must match the `aud` claim in your JWTs
- `algorithms`: Only RS256 or ES256 (never HS256!)

### Step 2: Create Server File

Create `server.ts`:

```typescript
import { MCPOAuthServer } from 'fastmcp-oauth-obo';

async function main() {
  // Create server with config path
  const server = new MCPOAuthServer('./config/unified-config.json');

  // Start server (automatically initializes AuthenticationService)
  await server.start({
    transportType: 'httpStream',
    httpStream: { port: 3000, endpoint: '/mcp' },
    stateless: true
  });

  console.log('🚀 MCP OAuth Server running on http://localhost:3000/mcp');

  // Graceful shutdown
  process.on('SIGINT', async () => {
    await server.stop();
    process.exit(0);
  });
}

main().catch(console.error);
```

### Step 3: Run Server

```bash
npx tsx server.ts
```

**Expected output:**
```
[ConfigManager] Loaded config: ./config/unified-config.json
[AuthenticationService] Initializing with 1 trusted IDP(s)
[JWTValidator] Initialized: https://auth.example.com
✓ AuthenticationService initialized (JWKS keys downloaded)
[MCPOAuthServer] Started on port 3000
🚀 MCP OAuth Server running on http://localhost:3000/mcp
```

**That's it!** Your OAuth-secured MCP server is running. The `MCPOAuthServer` wrapper handles:
- ✅ Configuration loading
- ✅ CoreContext initialization
- ✅ **AuthenticationService initialization (downloads JWKS keys)**
- ✅ Tool registration
- ✅ Graceful shutdown

---

## Manual Wiring Setup

For advanced use cases requiring full control over component initialization.

### Step 1: Create Configuration

Same as [Simplest Setup Step 1](#step-1-create-configuration-file).

### Step 2: Create Server with Manual Wiring

Create `server-manual.ts`:

```typescript
import {
  ConfigManager,
  ConfigOrchestrator,
  MCPAuthMiddleware,
  getAllToolFactories
} from 'fastmcp-oauth-obo';
import { FastMCP } from 'fastmcp';

async function main() {
  // 1. Load configuration
  const configManager = new ConfigManager();
  await configManager.loadConfig('./config/unified-config.json');

  // 2. Build CoreContext
  const orchestrator = new ConfigOrchestrator({
    configManager,
    enableAudit: true
  });

  const coreContext = await orchestrator.buildCoreContext();

  // ⚠️ CRITICAL: Initialize AuthenticationService
  // This downloads JWKS keys from your IDP. Without this step,
  // JWT validation will fail with "JWT validator not initialized" error.
  await coreContext.authService.initialize();

  console.log('✓ AuthenticationService initialized (JWKS keys downloaded)');

  // 3. Create FastMCP with authentication middleware
  const middleware = new MCPAuthMiddleware(coreContext.authService);

  const server = new FastMCP({
    name: 'My MCP Server',
    version: '1.0.0',
    authenticate: middleware.authenticate.bind(middleware)
  });

  // 4. Register tools using factories
  const toolFactories = getAllToolFactories();

  for (const factory of toolFactories) {
    const tool = factory(coreContext);
    server.addTool({
      name: tool.name,
      description: tool.schema.description || tool.name,
      parameters: tool.schema,
      execute: tool.handler,
      canAccess: tool.canAccess
    });
  }

  console.log(`✓ Registered ${toolFactories.length} tools`);

  // 5. Start server
  await server.start({
    transportType: 'httpStream',
    httpStream: { port: 3000, endpoint: '/mcp' },
    stateless: true
  });

  console.log('🚀 MCP Server running on http://localhost:3000/mcp');

  // 6. Graceful shutdown
  process.on('SIGINT', async () => {
    await ConfigOrchestrator.destroyCoreContext(coreContext);
    process.exit(0);
  });
}

main().catch(console.error);
```

### Step 3: Run Server

```bash
npx tsx server-manual.ts
```

---

## Configuration

### Keycloak Configuration Example

```json
{
  "auth": {
    "trustedIDPs": [
      {
        "issuer": "https://keycloak.example.com/realms/myrealm",
        "discoveryUrl": "https://keycloak.example.com/realms/myrealm/.well-known/openid-configuration",
        "jwksUri": "https://keycloak.example.com/realms/myrealm/protocol/openid-connect/certs",
        "audience": "mcp-server",
        "claimMappings": {
          "legacyUsername": "preferred_username",
          "roles": "realm_access.roles",
          "scopes": "scope"
        }
      }
    ]
  }
}
```

### Auth0 Configuration Example

```json
{
  "auth": {
    "trustedIDPs": [
      {
        "issuer": "https://your-tenant.auth0.com/",
        "jwksUri": "https://your-tenant.auth0.com/.well-known/jwks.json",
        "audience": "https://your-api-identifier",
        "claimMappings": {
          "legacyUsername": "https://your-namespace.com/legacy_username",
          "roles": "https://your-namespace.com/roles",
          "scopes": "scope"
        }
      }
    ]
  }
}
```

### Azure AD Configuration Example

```json
{
  "auth": {
    "trustedIDPs": [
      {
        "issuer": "https://login.microsoftonline.com/{tenant-id}/v2.0",
        "jwksUri": "https://login.microsoftonline.com/{tenant-id}/discovery/v2.0/keys",
        "audience": "api://{client-id}",
        "claimMappings": {
          "legacyUsername": "upn",
          "roles": "roles",
          "scopes": "scp"
        }
      }
    ]
  }
}
```

---

## Testing Your Server

### Get a JWT Token from Your IDP

**Keycloak Example:**
```bash
TOKEN=$(curl -X POST "https://keycloak.example.com/realms/myrealm/protocol/openid-connect/token" \
  -d "client_id=myclient" \
  -d "client_secret=secret" \
  -d "grant_type=client_credentials" \
  -d "scope=openid profile" | jq -r '.access_token')
```

**Auth0 Example:**
```bash
TOKEN=$(curl -X POST "https://your-tenant.auth0.com/oauth/token" \
  -H "Content-Type: application/json" \
  -d '{
    "client_id": "YOUR_CLIENT_ID",
    "client_secret": "YOUR_CLIENT_SECRET",
    "audience": "https://your-api-identifier",
    "grant_type": "client_credentials"
  }' | jq -r '.access_token')
```

### Test the `user-info` Tool

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "user-info",
      "arguments": {}
    },
    "id": 1
  }'
```

**Expected response:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "status": "success",
    "data": {
      "userId": "user@example.com",
      "username": "user@example.com",
      "legacyUsername": "user",
      "role": "user",
      "customRoles": [],
      "permissions": ["read", "write"],
      "scopes": ["openid", "profile"]
    }
  },
  "id": 1
}
```

### Test the `health-check` Tool

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "health-check",
      "arguments": { "service": "all" }
    },
    "id": 2
  }'
```

---

## Common Issues

### Issue 1: "JWT validator not initialized" Error

**Symptom:**
```
[MCPAuthMiddleware] ❌ Authentication error (statusCode: 500):
JWT validator not initialized. Call initialize() first.
```

**Cause:** The `AuthenticationService` hasn't downloaded JWKS keys from your IDP.

**Solution (Manual Wiring):**
```typescript
const coreContext = await orchestrator.buildCoreContext();

// ⚠️ Add this line:
await coreContext.authService.initialize();
```

**Solution (MCPOAuthServer):** This is automatic. If you see this error with `MCPOAuthServer`, check that `await server.start()` completed successfully.

---

### Issue 2: "Failed to fetch JWKS" Error

**Symptom:**
```
[JWTValidator] Failed to fetch JWKS from https://auth.example.com/.well-known/jwks.json
Error: getaddrinfo ENOTFOUND auth.example.com
```

**Causes:**
1. JWKS endpoint URL is incorrect
2. IDP is not reachable from server's network
3. Firewall blocking outbound HTTPS requests

**Solution:**
```bash
# Test connectivity from server
curl https://auth.example.com/.well-known/jwks.json

# Expected output: JSON with "keys" array
{
  "keys": [
    {
      "kty": "RSA",
      "use": "sig",
      "kid": "...",
      "n": "...",
      "e": "AQAB"
    }
  ]
}
```

---

### Issue 3: "Invalid JWT signature" Error

**Symptom:**
```
[JWTValidator] JWT validation failed: signature verification failed
```

**Causes:**
1. JWT signed with wrong key (IDP misconfiguration)
2. JWKS endpoint returned wrong public keys
3. JWT algorithm mismatch (HS256 vs RS256)

**Solution:**
```bash
# Decode JWT to check algorithm and key ID
echo "$TOKEN" | jwt decode -

# Check header.alg (must be RS256 or ES256)
# Check header.kid (must exist in JWKS)
```

---

### Issue 4: "Invalid audience" Error

**Symptom:**
```
[JWTValidator] JWT validation failed: unexpected "aud" claim value
```

**Cause:** JWT's `aud` claim doesn't include your MCP server's audience value.

**Solution:**
1. Check JWT's audience:
   ```bash
   echo "$TOKEN" | jwt decode - | jq .payload.aud
   ```

2. Update configuration to match:
   ```json
   {
     "auth": {
       "trustedIDPs": [{
         "audience": "your-actual-audience-value"
       }]
     }
   }
   ```

3. Or update IDP to include MCP server in audience

---

### Issue 5: Tool Not Visible to Client

**Symptom:** Tool exists but doesn't appear in `tools/list` response.

**Causes:**
1. User lacks required role (visibility filtering)
2. Tool not registered (`server.registerTool()` missing)
3. `canAccess()` function returns false

**Solution (Debug visibility):**
```typescript
const tool = createDelegationTool('my-api', {
  // ...
  canAccess: (mcpContext) => {
    console.log('[DEBUG] Tool visibility check:', {
      authenticated: !!mcpContext.session,
      userRole: mcpContext.session?.role,
      requiredRoles: ['user', 'admin']
    });
    return auth.hasAnyRole(mcpContext, ['user', 'admin']);
  }
}, coreContext);
```

---

## Next Steps

Now that your server is running:

1. **Add Custom Delegation Modules** - See [EXTENDING.md](EXTENDING.md)
2. **Configure SQL Delegation** - See [README.md](../README.md#sql-delegation)
3. **Enable Token Exchange** - See [CLAUDE.md](../CLAUDE.md#token-exchange-architecture)
4. **Review API Documentation** - See [API-REFERENCE.md](API-REFERENCE.md)

**Questions?** Check [TROUBLESHOOTING.md](TROUBLESHOOTING.md) or open an issue on GitHub.
