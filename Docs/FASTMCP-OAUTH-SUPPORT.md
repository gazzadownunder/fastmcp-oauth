# FastMCP OAuth Support Analysis

**Date:** 2025-01-10
**FastMCP Version:** @gazzadownunder/fastmcp@1.0.0
**Source:** https://github.com/punkpeye/fastmcp

---

## Executive Summary

**FastMCP ALREADY HAS BUILT-IN OAUTH SUPPORT!**

FastMCP includes complete support for OAuth 2.1 metadata endpoints including:
- ✅ `/.well-known/oauth-authorization-server` (RFC 8414)
- ✅ `/.well-known/oauth-protected-resource` (RFC 9728)
- ✅ Automatic snake_case conversion for JSON responses
- ✅ Configurable via `oauth` option in FastMCP constructor

**No library modification needed** - we just need to configure it properly!

---

## FastMCP OAuth Configuration Structure

### Complete TypeScript Interface

```typescript
type ServerOptions<T extends FastMCPSessionAuth> = {
  name: string;
  version: string;
  authenticate?: (request: any) => Promise<T | undefined>;

  oauth?: {
    enabled: boolean;

    // Authorization Server Metadata (RFC 8414)
    // Exposed at: /.well-known/oauth-authorization-server
    authorizationServer?: {
      issuer: string;                                  // REQUIRED
      authorizationEndpoint: string;                   // REQUIRED
      tokenEndpoint: string;                           // REQUIRED
      responseTypesSupported: string[];                // REQUIRED

      // Optional fields
      jwksUri?: string;
      scopesSupported?: string[];
      grantTypesSupported?: string[];
      tokenEndpointAuthMethodsSupported?: string[];
      codeChallengeMethodsSupported?: string[];        // PKCE support
      introspectionEndpoint?: string;
      revocationEndpoint?: string;
      registrationEndpoint?: string;
      responseModesSupported?: string[];
      serviceDocumentation?: string;
      opPolicyUri?: string;
      opTosUri?: string;
      uiLocalesSupported?: string[];
      dpopSigningAlgValuesSupported?: string[];
      tokenEndpointAuthSigningAlgValuesSupported?: string[];
    };

    // Protected Resource Metadata (RFC 9728)
    // Exposed at: /.well-known/oauth-protected-resource
    protectedResource?: {
      resource: string;                                // REQUIRED - Resource identifier
      authorizationServers: string[];                  // REQUIRED - Array of IDP URLs

      // Optional fields
      scopesSupported?: string[];
      bearerMethodsSupported?: string[];               // e.g., ["header", "query", "body"]
      resourceSigningAlgValuesSupported?: string[];    // e.g., ["RS256", "ES256"]
      jwksUri?: string;
      resourceName?: string;
      resourceDocumentation?: string;
      serviceDocumentation?: string;
      resourcePolicyUri?: string;
      resourceTosUri?: string;
      authorizationDetailsTypesSupported?: string[];
      dpopSigningAlgValuesSupported?: string[];
      dpopBoundAccessTokensRequired?: boolean;
      tlsClientCertificateBoundAccessTokens?: boolean;

      [key: string]: unknown;  // Extensible for custom fields
    };
  };
};
```

---

## How FastMCP Handles OAuth Endpoints

From the FastMCP source code (line 1299-1327):

```javascript
const oauthConfig = this.#options.oauth;
if (oauthConfig?.enabled && req.method === "GET") {
  const url = new URL(req.url || "", `http://${host}`);

  // Handle /.well-known/oauth-authorization-server
  if (url.pathname === "/.well-known/oauth-authorization-server" &&
      oauthConfig.authorizationServer) {
    const metadata = convertObjectToSnakeCase(
      oauthConfig.authorizationServer
    );
    res.writeHead(200, {
      "Content-Type": "application/json"
    }).end(JSON.stringify(metadata));
    return;
  }

  // Handle /.well-known/oauth-protected-resource
  if (url.pathname === "/.well-known/oauth-protected-resource" &&
      oauthConfig.protectedResource) {
    const metadata = convertObjectToSnakeCase(
      oauthConfig.protectedResource
    );
    res.writeHead(200, {
      "Content-Type": "application/json"
    }).end(JSON.stringify(metadata));
    return;
  }
}
```

**Key Features:**
1. Automatically serves OAuth metadata endpoints
2. Converts camelCase to snake_case for JSON responses (RFC compliance)
3. Only enabled when `oauth.enabled = true`
4. Returns proper HTTP 200 with `Content-Type: application/json`

---

## Example Configuration for Our MCP Server

### Configuration for Keycloak IDP

```typescript
import { FastMCP } from '@gazzadownunder/fastmcp';

const server = new FastMCP({
  name: 'MCP OAuth Server',
  version: '3.1.0',

  // OAuth configuration
  oauth: {
    enabled: true,

    // Authorization Server Metadata (points to Keycloak)
    authorizationServer: {
      issuer: 'http://localhost:8080/realms/mcp_security',
      authorizationEndpoint: 'http://localhost:8080/realms/mcp_security/protocol/openid-connect/auth',
      tokenEndpoint: 'http://localhost:8080/realms/mcp_security/protocol/openid-connect/token',
      jwksUri: 'http://localhost:8080/realms/mcp_security/protocol/openid-connect/certs',
      responseTypesSupported: ['code'],
      grantTypesSupported: ['authorization_code', 'refresh_token'],
      codeChallengeMethodsSupported: ['S256'],  // PKCE with SHA-256
      scopesSupported: ['openid', 'profile', 'email', 'mcp:read', 'mcp:write'],
      tokenEndpointAuthMethodsSupported: ['client_secret_basic', 'client_secret_post'],
    },

    // Protected Resource Metadata (describes this MCP server)
    protectedResource: {
      resource: 'http://localhost:3000',
      authorizationServers: [
        'http://localhost:8080/realms/mcp_security'
      ],
      scopesSupported: [
        'mcp:read',
        'mcp:write',
        'mcp:admin',
        'sql:query',
        'sql:execute',
        'sql:read',
        'sql:write'
      ],
      bearerMethodsSupported: ['header'],
      resourceSigningAlgValuesSupported: ['RS256', 'ES256'],
      resourceDocumentation: 'http://localhost:3000/docs',
    },
  },

  // Authentication function (validates bearer tokens)
  authenticate: async (request) => {
    const authHeader = request.headers['authorization'] || request.headers['Authorization'];
    if (!authHeader) return undefined;

    const token = authHeader.replace(/^Bearer\s+/i, '');
    // Validate token using existing AuthenticationService
    const authResult = await authService.authenticate(token);

    if (authResult.rejected) return undefined;

    return {
      authenticated: true,
      session: authResult.session
    };
  }
});

await server.start({
  transportType: 'httpStream',
  httpStream: { port: 3000, endpoint: '/mcp' },
  stateless: true
});
```

---

## What This Provides

### 1. Authorization Server Metadata Endpoint

**Request:**
```http
GET /.well-known/oauth-authorization-server HTTP/1.1
Host: localhost:3000
```

**Response:**
```json
{
  "issuer": "http://localhost:8080/realms/mcp_security",
  "authorization_endpoint": "http://localhost:8080/realms/mcp_security/protocol/openid-connect/auth",
  "token_endpoint": "http://localhost:8080/realms/mcp_security/protocol/openid-connect/token",
  "jwks_uri": "http://localhost:8080/realms/mcp_security/protocol/openid-connect/certs",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "code_challenge_methods_supported": ["S256"],
  "scopes_supported": ["openid", "profile", "email", "mcp:read", "mcp:write"],
  "token_endpoint_auth_methods_supported": ["client_secret_basic", "client_secret_post"]
}
```

### 2. Protected Resource Metadata Endpoint

**Request:**
```http
GET /.well-known/oauth-protected-resource HTTP/1.1
Host: localhost:3000
```

**Response:**
```json
{
  "resource": "http://localhost:3000",
  "authorization_servers": [
    "http://localhost:8080/realms/mcp_security"
  ],
  "scopes_supported": [
    "mcp:read",
    "mcp:write",
    "mcp:admin",
    "sql:query",
    "sql:execute"
  ],
  "bearer_methods_supported": ["header"],
  "resource_signing_alg_values_supported": ["RS256", "ES256"],
  "resource_documentation": "http://localhost:3000/docs"
}
```

Note: FastMCP automatically converts `authorizationServers` → `authorization_servers`, `bearerMethodsSupported` → `bearer_methods_supported`, etc.

---

## Implementation Steps

### Step 1: Update MCPOAuthServer.start()

Add OAuth configuration when creating FastMCP instance:

```typescript
// In src/mcp/server.ts, modify the FastMCP constructor:

this.mcpServer = new FastMCP({
  name: serverName,
  version: serverVersion,
  authenticate: authMiddleware.authenticate.bind(authMiddleware),

  // ADD THIS:
  oauth: this.buildOAuthConfig(),
});
```

### Step 2: Add buildOAuthConfig() Method

```typescript
private buildOAuthConfig() {
  const authConfig = this.coreContext.configManager.getAuthConfig();
  const delegationConfig = this.coreContext.configManager.getDelegationConfig();
  const mcpConfig = this.coreContext.configManager.getMCPConfig();

  const primaryIDP = authConfig.trustedIDPs[0];
  if (!primaryIDP) {
    return { enabled: false };
  }

  const serverUrl = process.env.SERVER_URL || `http://localhost:${mcpConfig.port || 3000}`;

  return {
    enabled: true,
    authorizationServer: {
      issuer: primaryIDP.issuer,
      authorizationEndpoint: `${primaryIDP.issuer}/protocol/openid-connect/auth`,
      tokenEndpoint: `${primaryIDP.issuer}/protocol/openid-connect/token`,
      jwksUri: primaryIDP.jwksUri,
      responseTypesSupported: ['code'],
      grantTypesSupported: ['authorization_code', 'refresh_token'],
      codeChallengeMethodsSupported: ['S256'],
      scopesSupported: ['openid', 'profile', 'email'],
      tokenEndpointAuthMethodsSupported: ['client_secret_basic', 'client_secret_post'],
    },
    protectedResource: {
      resource: serverUrl,
      authorizationServers: [primaryIDP.issuer],
      scopesSupported: this.extractSupportedScopes(),
      bearerMethodsSupported: ['header'],
      resourceSigningAlgValuesSupported: primaryIDP.algorithms || ['RS256', 'ES256'],
      resourceDocumentation: `${serverUrl}/docs`,
    },
  };
}

private extractSupportedScopes(): string[] {
  const scopes = new Set<string>(['mcp:read', 'mcp:write', 'mcp:admin']);

  const delegationConfig = this.coreContext.configManager.getDelegationConfig();
  if (delegationConfig?.modules?.sql) {
    scopes.add('sql:query');
    scopes.add('sql:execute');
    scopes.add('sql:read');
    scopes.add('sql:write');
  }

  return Array.from(scopes).sort();
}
```

---

## Testing

### Test Authorization Server Metadata

```bash
curl -s http://localhost:3000/.well-known/oauth-authorization-server | jq
```

### Test Protected Resource Metadata

```bash
curl -s http://localhost:3000/.well-known/oauth-protected-resource | jq
```

### Test 401 Response (without this implemented yet)

```bash
curl -v http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

Expected: HTTP 401 with `WWW-Authenticate` header

---

## WWW-Authenticate Header

FastMCP doesn't automatically add `WWW-Authenticate` headers on 401 responses. We need to handle this in our `authenticate` function:

```typescript
authenticate: async (request) => {
  try {
    const authHeader = request.headers['authorization'] || request.headers['Authorization'];

    if (!authHeader) {
      // Return special response that triggers 401 with WWW-Authenticate
      return {
        authenticated: false,
        error: 'Missing Authorization header',
        // FastMCP should add WWW-Authenticate here (needs verification)
      };
    }

    const token = authHeader.replace(/^Bearer\s+/i, '');
    const authResult = await authService.authenticate(token);

    if (authResult.rejected) {
      return {
        authenticated: false,
        error: 'Invalid or expired token',
      };
    }

    return {
      authenticated: true,
      session: authResult.session
    };
  } catch (error) {
    return {
      authenticated: false,
      error: error.message
    };
  }
}
```

---

## Advantages of Using FastMCP's Built-in OAuth

1. **Zero Custom Code** - No need to create Express wrappers or custom HTTP servers
2. **RFC Compliant** - Automatic snake_case conversion for spec compliance
3. **Maintainable** - FastMCP handles endpoint routing and response formatting
4. **Tested** - Part of FastMCP's core functionality
5. **Simple Configuration** - Just pass an object to the constructor

---

## Limitations

1. **WWW-Authenticate Header** - May need to be added manually in authenticate function
2. **Custom Endpoints** - Can't easily add other custom HTTP endpoints beyond OAuth metadata
3. **Configuration Structure** - Must match FastMCP's expected format (camelCase)

---

## Recommendation

**Use FastMCP's built-in OAuth support!**

Steps:
1. Add `buildOAuthConfig()` method to MCPOAuthServer
2. Pass OAuth config to FastMCP constructor
3. Remove custom `oauth-metadata.ts` tool (no longer needed)
4. Remove custom `http-server.ts` (no longer needed)
5. Test endpoints with curl/browser

This is the **simplest and most maintainable** solution that aligns perfectly with the MCP specification.
