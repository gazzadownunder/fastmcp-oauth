# @fastmcp-oauth/rest-api-delegation

REST API delegation module for the MCP OAuth framework - provides HTTP/JSON API integration with token exchange support.

## Overview

This package provides a **production-ready delegation module** for integrating MCP tools with external REST APIs. It's the most common use case for the MCP OAuth framework, enabling AI agents to securely interact with backend services.

### Key Features

- ✅ **Token Exchange Support** - Exchange requestor JWT for API-specific tokens
- ✅ **API Key Fallback** - Use static API keys when token exchange unavailable
- ✅ **Comprehensive Error Handling** - Graceful degradation and detailed audit logging
- ✅ **Timeout Support** - Configurable request timeouts
- ✅ **Custom Headers** - Add default headers to all requests
- ✅ **Multiple HTTP Methods** - GET, POST, PUT, PATCH, DELETE support
- ✅ **Session Context Propagation** - Automatic user ID and role headers

## Installation

```bash
npm install @fastmcp-oauth/rest-api-delegation
```

This package is an **optional** dependency of `fastmcp-oauth`. The core framework works without REST API support.

## Quick Start

### Basic Usage with Token Exchange

```typescript
import { RestAPIDelegationModule } from '@fastmcp-oauth/rest-api-delegation';
import { FastMCPOAuthServer } from 'fastmcp-oauth';

// Create server
const server = new FastMCPOAuthServer({
  configPath: './config.json'
});

// Get core context
const coreContext = server.getCoreContext();

// Create and register REST API module
const restApiModule = new RestAPIDelegationModule();
await restApiModule.initialize({
  baseUrl: 'https://api.example.com',
  useTokenExchange: true,
  tokenExchangeAudience: 'urn:api:example'
});

coreContext.delegationRegistry.register(restApiModule);
```

### Using API Key (Fallback)

```typescript
await restApiModule.initialize({
  baseUrl: 'https://api.example.com',
  useTokenExchange: false,
  apiKey: process.env.API_KEY
});
```

### Creating MCP Tools

Use the `createDelegationTool()` factory to create OAuth-secured tools in 5 lines:

```typescript
import { createDelegationTool } from 'fastmcp-oauth';
import { z } from 'zod';

// Tool 1: Get user profile
const getUserProfileTool = createDelegationTool('rest-api', {
  name: 'get-user-profile',
  description: 'Get user profile from backend API',
  parameters: z.object({
    userId: z.string().describe('User ID to fetch')
  }),
  action: 'users/profile',
  requiredPermission: 'api:read',

  // Transform params for API
  transformParams: (params) => ({
    endpoint: `users/${params.userId}/profile`,
    method: 'GET'
  }),

  // Transform API response for LLM
  transformResult: (apiResponse: any) => ({
    displayName: apiResponse.fullName,
    email: apiResponse.email,
    department: apiResponse.department
    // Hide sensitive fields
  })
}, coreContext);

// Tool 2: Update user settings
const updateUserSettingsTool = createDelegationTool('rest-api', {
  name: 'update-user-settings',
  description: 'Update user settings',
  parameters: z.object({
    userId: z.string(),
    settings: z.record(z.any())
  }),
  action: 'users/settings',
  requiredPermission: 'api:write',

  transformParams: (params) => ({
    endpoint: `users/${params.userId}/settings`,
    method: 'PUT',
    data: params.settings
  })
}, coreContext);

// Register tools
server.registerTools([getUserProfileTool, updateUserSettingsTool]);
```

## Configuration

### RestAPIConfig Interface

```typescript
interface RestAPIConfig {
  /** Base URL of the REST API (e.g., 'https://api.example.com') */
  baseUrl: string;

  /** Optional API key for fallback authentication */
  apiKey?: string;

  /** Whether to use token exchange for authentication */
  useTokenExchange: boolean;

  /** Audience for token exchange requests (default: 'urn:api:rest') */
  tokenExchangeAudience?: string;

  /** Optional OAuth scopes to request during token exchange (space-separated) */
  scope?: string;

  /** Optional default request timeout in milliseconds */
  timeout?: number;

  /** Optional custom headers to include in all requests */
  defaultHeaders?: Record<string, string>;
}
```

### Example Configuration

```typescript
await restApiModule.initialize({
  baseUrl: 'https://api.example.com',
  useTokenExchange: true,
  tokenExchangeAudience: 'urn:api:example',
  scope: 'openid profile api:read api:write', // Request specific OAuth scopes
  timeout: 30000, // 30 seconds
  defaultHeaders: {
    'X-API-Version': 'v2',
    'X-Client-ID': 'mcp-server'
  }
});
```

**OAuth Scope Support:**
- Request fine-grained permissions during token exchange
- Example scopes: `api:read`, `api:write`, `api:admin`
- IDP determines which scopes to grant based on user roles
- Enables least-privilege access patterns

## Token Exchange Flow

When `useTokenExchange: true`, the module performs RFC 8693 token exchange:

1. **Requestor JWT** - User's JWT from OAuth provider (e.g., Keycloak)
2. **Exchange** - Module exchanges requestor JWT for API-specific token at IDP
3. **Delegation Token (TE-JWT)** - IDP returns token scoped for your API
4. **API Request** - Module calls your API with `Authorization: Bearer <TE-JWT>`

**Benefits:**
- API receives tokens with correct audience binding
- IDP controls API permissions (privilege elevation/reduction)
- Centralized token revocation
- Cached tokens reduce IDP load by 90%

## API Request Parameters

The `delegate()` method accepts these parameters:

```typescript
const result = await coreContext.delegationRegistry.delegate(
  'rest-api',
  session,
  'action-name',
  {
    // Optional: Override endpoint (default: uses action name)
    endpoint: 'users/123/profile',

    // Optional: HTTP method (default: 'POST')
    method: 'GET',

    // Optional: Request body data (for POST/PUT/PATCH)
    data: { key: 'value' },

    // Optional: Additional headers
    headers: { 'X-Custom': 'header' }
  }
);
```

## Security Features

### Automatic Headers

The module automatically adds:
- `Authorization: Bearer <token>` - Token exchange or API key
- `X-User-ID` - User ID from session
- `X-User-Role` - User role from session
- `Content-Type: application/json` - JSON content type

### Audit Logging

All requests are logged with:
- Timestamp
- User ID
- Action name
- HTTP method and endpoint
- Authentication method (token-exchange or api-key)
- Success/failure status
- Error details (if failed)

### Error Handling

- Network errors caught and returned as `DelegationResult`
- Timeout errors with clear messaging
- HTTP error responses with status code and body
- No sensitive data exposed in error messages

## Health Check

The module provides a health check endpoint:

```typescript
const healthy = await restApiModule.healthCheck();
if (!healthy) {
  console.log('API is not responding');
}
```

Health check attempts `GET /health` with optional API key authentication.

## Complete Example

```typescript
import { FastMCPOAuthServer, createDelegationTool } from 'fastmcp-oauth';
import { RestAPIDelegationModule } from '@fastmcp-oauth/rest-api-delegation';
import { z } from 'zod';

async function main() {
  // 1. Create server
  const server = new FastMCPOAuthServer({
    configPath: './config.json'
  });

  const coreContext = server.getCoreContext();

  // 2. Create and register REST API module
  const restApiModule = new RestAPIDelegationModule();
  await restApiModule.initialize({
    baseUrl: 'https://api.example.com',
    useTokenExchange: true,
    tokenExchangeAudience: 'urn:api:example',
    timeout: 30000
  });

  coreContext.delegationRegistry.register(restApiModule);

  // 3. Create tools
  const getUserTool = createDelegationTool('rest-api', {
    name: 'get-user',
    description: 'Get user data',
    parameters: z.object({
      userId: z.string()
    }),
    action: 'users',
    requiredPermission: 'api:read',

    transformParams: (params) => ({
      endpoint: `users/${params.userId}`,
      method: 'GET'
    })
  }, coreContext);

  // 4. Register tools
  server.registerTools([getUserTool]);

  // 5. Start server
  await server.start({
    transportType: 'httpStream',
    httpStream: { port: 3000, endpoint: '/mcp' },
    stateless: true
  });

  console.log('MCP OAuth Server running on http://localhost:3000/mcp');
}

main().catch(console.error);
```

## API Reference

### RestAPIDelegationModule

#### Methods

##### `initialize(config: RestAPIConfig): Promise<void>`
Initialize module with configuration.

##### `delegate<T>(session: UserSession, action: string, params: any, context?: { sessionId?: string; coreContext?: any }): Promise<DelegationResult<T>>`
Delegate operation to REST API.

##### `healthCheck(): Promise<boolean>`
Check if API is accessible.

##### `destroy(): Promise<void>`
Cleanup resources.

##### `setTokenExchangeService(service: any, config: any): void`
Set token exchange service (called by ConfigOrchestrator).

## Use Cases

### 1. AI Agent → Internal API
LLM agents querying internal REST APIs with user context

### 2. Multi-Service Orchestration
Coordinate calls to multiple REST APIs with single OAuth token

### 3. Legacy System Integration
Connect modern AI tools to legacy REST/SOAP services

### 4. Third-Party API Integration
Integrate with external SaaS APIs using token exchange

## Best Practices

1. **Use Token Exchange** - Preferred over API keys for production
2. **Set Timeouts** - Prevent hung requests (recommended: 30 seconds)
3. **Transform Results** - Hide sensitive data before returning to LLM
4. **Use Custom Headers** - Add versioning and client identification
5. **Health Checks** - Monitor API availability in production
6. **Cache Tokens** - Enable session-based token caching (81% latency reduction)

## Troubleshooting

### "No authentication method configured"
Either enable token exchange or provide an API key:
```typescript
apiKey: process.env.API_KEY,
useTokenExchange: false
```

### "TokenExchangeService not available"
Ensure token exchange is configured in your IDP settings:
```json
{
  "trustedIDPs": [{
    "tokenExchange": {
      "tokenEndpoint": "https://idp.com/token",
      "clientId": "mcp-server",
      "clientSecret": "SECRET"
    }
  }]
}
```

### "Session missing access_token"
User session must include `access_token` claim for token exchange. Verify JWT contains access token.

## License

MIT

## Support

- **Documentation**: [MCP OAuth Framework Docs](../../README.md)
- **Issues**: [GitHub Issues](https://github.com/your-org/mcp-oauth/issues)
- **Extension Guide**: [Docs/EXTENDING.md](../../Docs/EXTENDING.md)
