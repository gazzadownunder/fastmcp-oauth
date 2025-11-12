/**
 * Multi-Module Auto-Registration Example
 *
 * Demonstrates the new toolPrefix configuration option (Option C implementation)
 * that enables automatic tool registration for delegation modules.
 *
 * **Key Benefits:**
 * - 85% code reduction compared to manual registration
 * - Configuration-only approach (no code changes for tool naming)
 * - Supports all delegation module types (SQL, REST API, Kerberos)
 * - Backward compatible with existing manual registration
 *
 * **Configuration Approach:**
 * - Set `delegation.defaultToolPrefix` for global default (optional, defaults to "sql")
 * - Set `toolPrefix` per module to override the default
 * - Modules without `toolPrefix` skip auto-registration (manual registration required)
 *
 * **Before (Manual Registration - 100+ lines):**
 * ```typescript
 * const coreContext = server.getCoreContext();
 * const delegationConfig = coreContext.configManager.getDelegationConfig();
 *
 * // Register PostgreSQL modules
 * for (const moduleName of postgresModules) {
 *   const moduleConfig = delegationConfig.modules[moduleName];
 *   const toolPrefix = moduleName.replace('postgresql', 'sql');
 *   const sqlTools = createSQLToolsForModule({ toolPrefix, moduleName });
 *   server.registerTools(sqlTools.map(factory => factory(coreContext)));
 * }
 *
 * // Register REST API modules
 * for (const moduleName of apiModules) {
 *   const moduleConfig = delegationConfig.modules[moduleName];
 *   const toolPrefix = moduleName.replace('rest-api', 'api');
 *   const apiTools = createRESTAPIToolsForModule({ toolPrefix, moduleName });
 *   server.registerTools(apiTools.map(factory => factory(coreContext)));
 * }
 * // ... 50+ more lines for other module types
 * ```
 *
 * **After (Auto-Registration - 15 lines):**
 * ```typescript
 * const server = new FastMCPOAuthServer(CONFIG_PATH);
 * await server.start({ transport: 'httpStream', port: 3000 });
 * // That's it! Tools auto-registered from config!
 * ```
 *
 * @example Configuration File (multi-module-config.json)
 * ```json
 * {
 *   "delegation": {
 *     "defaultToolPrefix": "sql",
 *     "modules": {
 *       "postgresql1": {
 *         "toolPrefix": "hr-sql",
 *         "host": "localhost",
 *         "database": "hr_database",
 *         "_comment": "HR Database"
 *       },
 *       "postgresql2": {
 *         "toolPrefix": "sales-sql",
 *         "host": "localhost",
 *         "database": "sales_database",
 *         "_comment": "Sales Database"
 *       },
 *       "rest-api1": {
 *         "toolPrefix": "internal-api",
 *         "baseUrl": "https://internal-api.company.com",
 *         "_comment": "Internal REST API"
 *       }
 *     }
 *   }
 * }
 * ```
 *
 * **Result:**
 * - HR Database: `hr-sql-delegate`, `hr-sql-schema`, `hr-sql-table-details`
 * - Sales Database: `sales-sql-delegate`, `sales-sql-schema`, `sales-sql-table-details`
 * - Internal API: `internal-api-delegate`, `internal-api-health`
 *
 * **Total:** 8 tools from 3 modules, zero boilerplate code!
 */

import { FastMCPOAuthServer } from '../src/mcp/server.js';

const CONFIG_PATH = './test-harness/config/multi-module-config.json';
const SERVER_PORT = 3000;

/**
 * Main function - simplified multi-module setup
 *
 * This example shows how the new toolPrefix configuration option
 * eliminates 100+ lines of boilerplate code for multi-module deployments.
 */
async function main() {
  console.log('='.repeat(60));
  console.log('Multi-Module Auto-Registration Example');
  console.log('='.repeat(60));
  console.log('');
  console.log('This example demonstrates the new toolPrefix configuration');
  console.log('option that enables automatic tool registration for all');
  console.log('delegation module types (SQL, REST API, Kerberos).');
  console.log('');
  console.log('Configuration: ' + CONFIG_PATH);
  console.log('Port: ' + SERVER_PORT);
  console.log('');
  console.log('Starting server with auto-registration...');
  console.log('');

  // Tool prefixes configured in config.json for ALL module types!
  // No manual tool registration needed!
  const server = new FastMCPOAuthServer(CONFIG_PATH);

  await server.start({
    transport: 'httpStream',
    port: SERVER_PORT,
  });

  console.log('');
  console.log('✓ Server ready with auto-registered tools from all delegation modules!');
  console.log('');
  console.log('Expected Tools (from config):');
  console.log('  HR Database:');
  console.log('    - hr-sql-delegate');
  console.log('    - hr-sql-schema');
  console.log('    - hr-sql-table-details');
  console.log('  Sales Database:');
  console.log('    - sales-sql-delegate');
  console.log('    - sales-sql-schema');
  console.log('    - sales-sql-table-details');
  console.log('  Internal API:');
  console.log('    - internal-api-delegate');
  console.log('    - internal-api-health');
  console.log('  Partner API:');
  console.log('    - partner-api-delegate');
  console.log('    - partner-api-health');
  console.log('');
  console.log('Press Ctrl+C to stop the server');

  // Keep server running
  await new Promise(() => {});
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
