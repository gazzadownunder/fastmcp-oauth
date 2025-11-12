/**
 * Multi-REST-API Example
 *
 * Demonstrates how to configure and use multiple REST API backends with the MCP OAuth framework.
 * This example shows:
 * - Registering multiple REST API modules with different configurations
 * - Using createRESTAPIToolsForModule() factory for multi-instance support
 * - Token exchange vs API key authentication
 * - Independent configuration per API instance
 *
 * Use Case: Your organization has multiple backend APIs - internal, partner, and legacy -
 * each requiring different authentication and accessed through separate tool sets.
 */

import { FastMCPOAuthServer } from '../src/mcp/server.js';
import { RestAPIDelegationModule } from '@fastmcp-oauth/rest-api-delegation';
import { createRESTAPIToolsForModule } from '../src/mcp/tools/rest-api-tools-factory.js';

async function main() {
  console.log('='.repeat(80));
  console.log('Multi-REST-API Example - Multiple Backend API Integration');
  console.log('='.repeat(80));
  console.log('');

  // Step 1: Create MCP OAuth Server
  const server = new FastMCPOAuthServer({
    configPath: './test-harness/config/multi-rest-api-config.json',
  });

  await server.start();
  console.log('[Example] ✓ Server started');

  // Step 2: Get CoreContext
  const coreContext = server.getCoreContext();
  const delegationConfig = coreContext.configManager.getDelegationConfig();

  // Step 3: Discover and register REST API modules
  const restApiModules = Object.keys(delegationConfig?.modules || {}).filter(
    key => key.startsWith('rest-api')
  );

  console.log(`[Example] Found ${restApiModules.length} REST API module(s) in configuration\n`);

  for (const moduleName of restApiModules) {
    const moduleConfig = delegationConfig.modules[moduleName];

    console.log(`[${moduleName}] Registering module...`);
    console.log(`[${moduleName}]   Base URL: ${moduleConfig.baseUrl}`);
    console.log(`[${moduleName}]   Auth Mode: ${moduleConfig.useTokenExchange ? 'Token Exchange' : 'API Key'}`);

    // Create and initialize module with unique name
    const apiModule = new RestAPIDelegationModule(moduleName);
    await apiModule.initialize(moduleConfig);
    await server.registerDelegationModule(moduleName, apiModule);

    // Create tools with unique prefix
    const toolPrefix = moduleName.replace('rest-api', 'api');
    const descriptionSuffix = moduleConfig._comment || '';

    const apiTools = createRESTAPIToolsForModule({
      toolPrefix,
      moduleName,
      descriptionSuffix,
    });

    server.registerTools(apiTools.map(factory => factory(coreContext)));

    console.log(`[${moduleName}] ✓ Registered ${apiTools.length} tools with prefix '${toolPrefix}-'`);
    console.log('');
  }

  // Step 4: Summary
  console.log('='.repeat(80));
  console.log('Registered MCP Tools:');
  console.log('='.repeat(80));

  const toolSummary = [
    { module: 'rest-api1', prefix: 'api1-', description: 'Internal API (Token Exchange)' },
    { module: 'rest-api2', prefix: 'api2-', description: 'Partner API (Token Exchange)' },
    { module: 'rest-api3', prefix: 'api3-', description: 'Legacy API (API Key)' },
  ];

  toolSummary.forEach(({ module, prefix, description }) => {
    console.log(`\n${module} (${description}):`);
    console.log(`  ✓ ${prefix}delegate - Make HTTP requests to API`);
    console.log(`  ✓ ${prefix}health - Check API health status`);
  });

  console.log('\n' + '='.repeat(80));
  console.log('Example Usage:');
  console.log('='.repeat(80));

  console.log(`
1. Call Internal API (api1-delegate):
   curl -X POST http://localhost:3000/mcp \\
     -H "Authorization: Bearer \$JWT" \\
     -H "Content-Type: application/json" \\
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

2. Call Partner API (api2-delegate):
   curl -X POST http://localhost:3000/mcp \\
     -H "Authorization: Bearer \$JWT" \\
     -H "Content-Type: application/json" \\
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

3. Call Legacy API (api3-delegate):
   curl -X POST http://localhost:3000/mcp \\
     -H "Authorization: Bearer \$JWT" \\
     -H "Content-Type: application/json" \\
     -d '{
       "jsonrpc": "2.0",
       "method": "tools/call",
       "params": {
         "name": "api3-delegate",
         "arguments": {
           "endpoint": "legacy/query",
           "method": "POST",
           "data": {"query": "SELECT * FROM legacy_table"}
         }
       },
       "id": 3
     }'

4. Check API Health (api1-health):
   curl -X POST http://localhost:3000/mcp \\
     -H "Authorization: Bearer \$JWT" \\
     -H "Content-Type: application/json" \\
     -d '{
       "jsonrpc": "2.0",
       "method": "tools/call",
       "params": {
         "name": "api1-health",
         "arguments": {}
       },
       "id": 4
     }'
`);

  console.log('='.repeat(80));
  console.log('Key Features Demonstrated:');
  console.log('='.repeat(80));
  console.log('1. Multi-instance support - Each API has independent configuration');
  console.log('2. Flexible authentication - Token exchange for modern APIs, API keys for legacy');
  console.log('3. Tool factory pattern - Automatic tool generation with unique prefixes');
  console.log('4. Independent token exchange - Each API can use different IDP audiences');
  console.log('5. Tool isolation - Each API has its own delegate and health check tools');

  console.log('\n' + '='.repeat(80));
  console.log('Configuration Pattern:');
  console.log('='.repeat(80));
  console.log(`
{
  "delegation": {
    "modules": {
      "rest-api1": {
        "baseUrl": "https://internal-api.company.com",
        "useTokenExchange": true,
        "tokenExchangeAudience": "urn:api:internal"
      },
      "rest-api2": {
        "baseUrl": "https://partner-api.example.com",
        "useTokenExchange": true,
        "tokenExchangeAudience": "urn:api:partner"
      },
      "rest-api3": {
        "baseUrl": "https://legacy.company.com",
        "useTokenExchange": false,
        "apiKey": "LEGACY_API_KEY"
      }
    }
  }
}
`);

  console.log('='.repeat(80));
  console.log('Server Status: Running');
  console.log('='.repeat(80));
  console.log('Press Ctrl+C to stop\n');

  // Keep server running
  process.on('SIGINT', async () => {
    console.log('\n\nShutting down server...');
    process.exit(0);
  });
}

// Run example if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Error running example:', error);
    process.exit(1);
  });
}
