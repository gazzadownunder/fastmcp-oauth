# Multi-REST-API Setup

This guide explains how to configure and use multiple REST API backend instances with the MCP OAuth framework, each with its own set of API tools.

## Overview

The framework supports multiple REST API connections, each registered as a separate delegation module with its own set of tools. This enables scenarios like:

- **Multiple Backend Services** - Internal API, Partner API, Legacy API
- **Different Authentication** - Per-API token exchange with different audiences
- **Environment Separation** - Dev API, Staging API, Production API
- **Microservices Integration** - Multiple services, each with own endpoint

## Architecture

Each REST API module gets:
- **Unique module name** (e.g., `rest-api1`, `rest-api2`, `rest-api3`)
- **Unique tool prefix** (e.g., `api1-`, `api2-`, `api3-`)
- **Independent configuration** and token exchange settings
- **Separate authentication** (token exchange or API key)

```
┌─────────────────────────────────────────────────────────────┐
│                     MCP OAuth Server                         │
└─────────────────────────────────────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
    ┌─────▼─────┐    ┌─────▼─────┐    ┌────▼──────┐
    │   api1-   │    │   api2-   │    │   api3-   │
    │ delegate  │    │ delegate  │    │ delegate  │
    │  health   │    │  health   │    │  health   │
    └─────┬─────┘    └─────┬─────┘    └────┬──────┘
          │                │                │
    ┌─────▼─────┐    ┌─────▼─────┐    ┌────▼──────┐
    │rest-api1  │    │rest-api2  │    │rest-api3  │
    │  Module   │    │  Module   │    │  Module   │
    └─────┬─────┘    └─────┬─────┘    └────┬──────┘
          │                │                │
    ┌─────▼─────┐    ┌─────▼─────┐    ┌────▼──────┐
    │ Internal  │    │  Partner  │    │  Legacy   │
    │   API     │    │    API    │    │    API    │
    └───────────┘    └───────────┘    └───────────┘
```

## Configuration

### Step 1: Define Multiple REST API Modules

In your configuration file (e.g., `multi-rest-api-config.json`):

```json
{
  "delegation": {
    "modules": {
      "rest-api1": {
        "_comment": "INTERNAL API - Main application backend",
        "baseUrl": "https://internal-api.company.com",
        "useTokenExchange": true,
        "tokenExchangeAudience": "urn:api:internal",
        "timeout": 30000,
        "defaultHeaders": {
          "X-API-Version": "v1"
        }
      },
      "rest-api2": {
        "_comment": "PARTNER API - External partner integration",
        "baseUrl": "https://partner-api.example.com",
        "useTokenExchange": true,
        "tokenExchangeAudience": "urn:api:partner",
        "timeout": 60000
      },
      "rest-api3": {
        "_comment": "LEGACY API - Uses API key (no token exchange)",
        "baseUrl": "https://legacy.company.com",
        "useTokenExchange": false,
        "apiKey": "LEGACY_API_KEY_FROM_ENV",
        "timeout": 10000
      }
    }
  },
  "auth": {
    "trustedIDPs": [
      {
        "name": "api-te-jwt",
        "issuer": "https://auth.company.com",
        "jwksUri": "https://auth.company.com/.well-known/jwks.json",
        "audience": "mcp-server-api"
      }
    ]
  }
}
```

### Step 2: Enable Tools in MCP Config

```json
{
  "mcp": {
    "enabledTools": {
      "api1-delegate": true,
      "api1-health": true,
      "api2-delegate": true,
      "api2-health": true,
      "api3-delegate": true,
      "api3-health": true,
      "health-check": true,
      "user-info": true
    }
  }
}
```

### Step 3: Register Modules in Server Code

Example server setup with multiple REST API instances:

```typescript
import { MCPOAuthServer } from '../src/mcp/server.js';
import { RestAPIDelegationModule } from '@mcp-oauth/rest-api-delegation';
import { createRESTAPIToolsForModule } from '../src/mcp/tools/rest-api-tools-factory.js';

// Start server
const server = new MCPOAuthServer({
  configPath: './config/multi-rest-api-config.json',
});

await server.start();
const coreContext = server.getCoreContext();

// Get delegation config
const delegationConfig = coreContext.configManager.getDelegationConfig();

// Register REST API modules dynamically
const restApiModules = Object.keys(delegationConfig?.modules || {}).filter(
  key => key.startsWith('rest-api')
);

for (const moduleName of restApiModules) {
  const moduleConfig = delegationConfig.modules[moduleName];

  // Create and initialize module
  const apiModule = new RestAPIDelegationModule(moduleName);
  await apiModule.initialize(moduleConfig);
  await server.registerDelegationModule(moduleName, apiModule);

  // Create and register API tools
  const toolPrefix = moduleName.replace('rest-api', 'api');
  const descriptionSuffix = moduleConfig._comment || '';

  const apiTools = createRESTAPIToolsForModule({
    toolPrefix,
    moduleName,
    descriptionSuffix,
  });

  server.registerTools(apiTools.map(factory => factory(coreContext)));

  console.log(`✓ Registered ${apiTools.length} tools for '${moduleName}'`);
}
```

## Tool Naming Convention

| Module Name | Tool Prefix | Tools Generated |
|------------|-------------|-----------------|
| `rest-api` | `api` | `api-delegate`, `api-health` |
| `rest-api1` | `api1` | `api1-delegate`, `api1-health` |
| `rest-api2` | `api2` | `api2-delegate`, `api2-health` |
| `rest-apiN` | `apiN` | `apiN-delegate`, `apiN-health` |

## Usage Examples

### Call Internal API (API1)

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "api1-delegate",
      "arguments": {
        "endpoint": "users/123/profile",
        "method": "GET"
      }
    },
    "id": 1
  }'
```

### Call Partner API (API2)

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "api2-delegate",
      "arguments": {
        "endpoint": "orders",
        "method": "POST",
        "data": {
          "customerId": "C123",
          "items": [{"sku": "PROD-001", "quantity": 2}]
        }
      }
    },
    "id": 2
  }'
```

### Call Legacy API with API Key (API3)

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "api3-delegate",
      "arguments": {
        "endpoint": "legacy/query",
        "method": "POST",
        "data": {
          "query": "SELECT * FROM legacy_table WHERE id = 123"
        }
      }
    },
    "id": 3
  }'
```

### Health Check for Specific API

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "api1-health",
      "arguments": {}
    },
    "id": 4
  }'
```

## Advanced: Custom Tool Prefixes

You can customize tool prefixes beyond automatic naming:

```typescript
const apiTools = createRESTAPIToolsForModule({
  toolPrefix: 'internal',      // Custom prefix
  moduleName: 'rest-api1',
  descriptionSuffix: '(Production Backend)',
});

// Generates: internal-delegate, internal-health
```

## Security Considerations

### Per-Module Token Exchange

Each REST API module can have its own token exchange configuration:

- **Different audiences** - Separate authorization scopes per API
- **Different credentials** - Separate service accounts per API
- **Independent caching** - Each module has its own token cache

### Authentication Modes

**Token Exchange (Recommended):**
```json
{
  "rest-api1": {
    "baseUrl": "https://api.example.com",
    "useTokenExchange": true,
    "tokenExchangeAudience": "urn:api:example"
  }
}
```

**API Key Fallback:**
```json
{
  "rest-api2": {
    "baseUrl": "https://legacy.example.com",
    "useTokenExchange": false,
    "apiKey": "LEGACY_API_KEY"
  }
}
```

### Timeout Configuration

Adjust timeouts based on API response characteristics:

- **Internal APIs** - Lower timeout (10-30 seconds)
- **Partner APIs** - Higher timeout (60-120 seconds)
- **Legacy APIs** - Very low timeout (5-10 seconds)

### Custom Headers

Add API-specific headers:

```json
{
  "rest-api1": {
    "baseUrl": "https://api.example.com",
    "defaultHeaders": {
      "X-API-Version": "v2",
      "X-Client-ID": "mcp-server",
      "X-Request-Source": "mcp-oauth-framework"
    }
  }
}
```

## Testing

### Test Configuration

Use the provided test configuration:

```bash
export CONFIG_PATH=./test-harness/config/multi-rest-api-config.json
export SERVER_PORT=3000
npm run build
node dist/test-harness/multi-api-test-server.js
```

### Verify Tools Registration

Check server startup logs:

```
[3/3] Checking for delegation modules...
      Found 3 REST API module(s) in config

      Registering REST API module: rest-api1
      Initializing connection to https://internal-api.company.com...
✓     REST API connection initialized for rest-api1
      Creating API tools with prefix 'api1' for module 'rest-api1'...
✓     Registered 2 API tools for 'rest-api1'

      Registering REST API module: rest-api2
      Initializing connection to https://partner-api.example.com...
✓     REST API connection initialized for rest-api2
      Creating API tools with prefix 'api2' for module 'rest-api2'...
✓     Registered 2 API tools for 'rest-api2'

      Registering REST API module: rest-api3
      Initializing connection to https://legacy.company.com...
✓     REST API connection initialized for rest-api3
      Creating API tools with prefix 'api3' for module 'rest-api3'...
✓     Registered 2 API tools for 'rest-api3'
```

### List Available Tools

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

## Troubleshooting

### Module Not Found Error

**Error:** `REST API delegation module 'rest-api2' is not available`

**Solution:** Ensure the module is registered before tools are created:

```typescript
await server.registerDelegationModule(moduleName, apiModule);
// THEN
server.registerTools(apiTools);
```

### Tool Not Listed

**Error:** Tool doesn't appear in `tools/list` response

**Solution:** Check `mcp.enabledTools` configuration:

```json
{
  "mcp": {
    "enabledTools": {
      "api2-delegate": true  // Must be enabled
    }
  }
}
```

### Connection Timeout

**Error:** `Request timed out after 30000ms`

**Solution:** Increase timeout in module configuration:

```json
{
  "rest-api1": {
    "timeout": 60000  // Increase to 60 seconds
  }
}
```

### Authentication Failed

**Error:** `No authentication method configured`

**Solution:** Ensure either token exchange or API key is configured:

```json
{
  "rest-api1": {
    "useTokenExchange": true,
    // OR
    "apiKey": "YOUR_API_KEY"
  }
}
```

## API Reference

### `createRESTAPIToolsForModule(config)`

Creates REST API tools for a specific REST API module.

**Parameters:**
- `config.toolPrefix` - Tool name prefix (e.g., 'api1', 'api2')
- `config.moduleName` - Delegation module name (e.g., 'rest-api1')
- `config.descriptionSuffix` - Optional suffix for tool descriptions

**Returns:** Array of `ToolFactory` functions

**Example:**

```typescript
import { createRESTAPIToolsForModule } from 'mcp-oauth-framework';

const api1Tools = createRESTAPIToolsForModule({
  toolPrefix: 'api1',
  moduleName: 'rest-api1',
  descriptionSuffix: '(Internal API)'
});

const api2Tools = createRESTAPIToolsForModule({
  toolPrefix: 'api2',
  moduleName: 'rest-api2',
  descriptionSuffix: '(Partner API)'
});

server.registerTools([
  ...api1Tools.map(factory => factory(coreContext)),
  ...api2Tools.map(factory => factory(coreContext))
]);
```

## See Also

- [MULTI-DATABASE-SETUP.md](MULTI-DATABASE-SETUP.md) - Multi-database PostgreSQL setup (similar pattern)
- [EXTENDING.md](EXTENDING.md) - Framework extension patterns
- [NPM-LIBRARY-VERIFICATION.md](NPM-LIBRARY-VERIFICATION.md) - OAuth library verification
- [examples/rest-api-delegation.ts](../examples/rest-api-delegation.ts) - Single REST API example
