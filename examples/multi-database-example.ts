#!/usr/bin/env node
/**
 * Multi-Database PostgreSQL Example
 *
 * Demonstrates how to set up multiple PostgreSQL database connections
 * with separate SQL tools (sql1-, sql2-, etc.)
 *
 * This example shows:
 * - Registering multiple PostgreSQL delegation modules
 * - Creating SQL tools with different prefixes for each database
 * - Dynamic tool registration based on configuration
 *
 * Configuration file should define multiple postgresql modules:
 * - postgresql1 -> sql1-delegate, sql1-schema, sql1-table-details
 * - postgresql2 -> sql2-delegate, sql2-schema, sql2-table-details
 * - postgresqlN -> sqlN-delegate, sqlN-schema, sqlN-table-details
 *
 * Usage:
 *   npm run build
 *   CONFIG_PATH=./test-harness/config/dual-postgresql-config.json node dist/examples/multi-database-example.js
 */

import { FastMCPOAuthServer } from '../src/mcp/server.js';
import { PostgreSQLDelegationModule } from '@fastmcp-oauth/sql-delegation';
import { createSQLToolsForModule } from '../src/mcp/tools/sql-tools-factory.js';

const CONFIG_PATH = process.env.CONFIG_PATH || './test-harness/config/dual-postgresql-config.json';
const SERVER_PORT = parseInt(process.env.SERVER_PORT || '3000', 10);

console.log('═══════════════════════════════════════════════════════════');
console.log('  Multi-Database PostgreSQL Example');
console.log('═══════════════════════════════════════════════════════════');
console.log(`Config:          ${CONFIG_PATH}`);
console.log(`Port:            ${SERVER_PORT}`);
console.log('═══════════════════════════════════════════════════════════\n');

async function main() {
  let server: MCPOAuthServer | null = null;

  try {
    // 1. Create and start MCP OAuth server
    console.log('[1/2] Creating and starting MCP OAuth server...');
    server = new FastMCPOAuthServer(CONFIG_PATH);
    await server.start({
      transport: 'httpStream',
      port: SERVER_PORT,
    });
    console.log('✓     Server started\n');

    const coreContext = server.getCoreContext();
    const delegationConfig = coreContext.configManager.getDelegationConfig();

    // 2. Register PostgreSQL modules dynamically
    console.log('[2/2] Registering PostgreSQL delegation modules...');

    const postgresModules = Object.keys(delegationConfig?.modules || {}).filter(
      key => key.startsWith('postgresql')
    );

    if (postgresModules.length === 0) {
      console.error('❌ No PostgreSQL modules found in configuration!');
      console.error('   Please ensure config has delegation.modules.postgresql1, postgresql2, etc.');
      process.exit(1);
    }

    console.log(`      Found ${postgresModules.length} PostgreSQL module(s) in config\n`);

    for (const moduleName of postgresModules) {
      const moduleConfig = delegationConfig.modules[moduleName];
      console.log(`   Registering: ${moduleName}`);

      // Create and initialize PostgreSQL module
      // CRITICAL: Pass moduleName to constructor so each instance has unique name
      const pgModule = new PostgreSQLDelegationModule(moduleName);
      console.log(`      → Connecting to ${moduleConfig.database}@${moduleConfig.host}:${moduleConfig.port}`);
      await pgModule.initialize(moduleConfig);

      // Register module with DelegationRegistry
      await server.registerDelegationModule(moduleName, pgModule);
      console.log(`      → Module registered`);

      // Create SQL tools for this module
      const toolPrefix = moduleName === 'postgresql' ? 'sql' : moduleName.replace('postgresql', 'sql');
      const descriptionSuffix = moduleConfig._comment ? `(${moduleConfig._comment})` : '';

      console.log(`      → Creating SQL tools with prefix '${toolPrefix}'`);
      const sqlTools = createSQLToolsForModule({
        toolPrefix,
        moduleName,
        descriptionSuffix,
      });

      // Register tools with MCP server
      server.registerTools(sqlTools.map(factory => factory(coreContext)));
      console.log(`      → Registered ${sqlTools.length} tools: ${toolPrefix}-delegate, ${toolPrefix}-schema, ${toolPrefix}-table-details`);

      // Log token exchange config if present
      if (moduleConfig.tokenExchange) {
        console.log(`      → Token exchange enabled (audience: ${moduleConfig.tokenExchange.audience})`);
      }

      console.log('');
    }

    console.log('═══════════════════════════════════════════════════════════');
    console.log('  Server Ready');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log('Available SQL Tools:\n');
    for (const moduleName of postgresModules) {
      const toolPrefix = moduleName === 'postgresql' ? 'sql' : moduleName.replace('postgresql', 'sql');
      const moduleConfig = delegationConfig.modules[moduleName];
      const dbLabel = moduleConfig._comment || `${moduleConfig.database}@${moduleConfig.host}`;

      console.log(`${toolPrefix.toUpperCase()} Tools (${dbLabel}):`);
      console.log(`  • ${toolPrefix}-delegate      - Execute SQL queries`);
      console.log(`  • ${toolPrefix}-schema        - Get list of tables`);
      console.log(`  • ${toolPrefix}-table-details - Get column details`);
      console.log('');
    }

    console.log('Example Requests:\n');
    console.log('# List all tools:');
    console.log('curl -X POST http://localhost:3000/mcp \\');
    console.log('  -H "Authorization: Bearer $JWT" \\');
    console.log('  -d \'{"jsonrpc":"2.0","method":"tools/list","id":1}\'\n');

    console.log('# Query primary database (SQL1):');
    console.log('curl -X POST http://localhost:3000/mcp \\');
    console.log('  -H "Authorization: Bearer $JWT" \\');
    console.log('  -d \'{"jsonrpc":"2.0","method":"tools/call","params":{"name":"sql1-delegate","arguments":{"action":"query","sql":"SELECT version()","params":[]}},"id":2}\'\n');

    console.log('# Query secondary database (SQL2):');
    console.log('curl -X POST http://localhost:3000/mcp \\');
    console.log('  -H "Authorization: Bearer $JWT" \\');
    console.log('  -d \'{"jsonrpc":"2.0","method":"tools/call","params":{"name":"sql2-delegate","arguments":{"action":"query","sql":"SELECT current_database()","params":[]}},"id":3}\'\n');

    console.log('Press Ctrl+C to stop...\n');

    // Keep server running
    await new Promise(() => {});

  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n\n${signal} received - shutting down...`);
    if (server) {
      await server.stop();
      console.log('Server stopped\n');
    }
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
