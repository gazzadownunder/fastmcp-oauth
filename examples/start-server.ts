/**
 * Example: MCP OAuth Server Application Entry Point
 *
 * This demonstrates how developers should use the fastmcp-oauth-obo framework
 * in their own applications.
 *
 * Framework users install the package and import from it:
 *   npm install fastmcp-oauth-obo
 *   import { MCPOAuthServer } from 'fastmcp-oauth-obo';
 *
 * This example uses relative imports during framework development.
 */

import { MCPOAuthServer } from '../src/mcp/server.js';
import { SQLDelegationModule } from '@mcp-oauth/sql-delegation';

async function main() {
  // Get config path from environment or use default
  const configPath = process.env.CONFIG_PATH || './config/oauth-obo-test.json';
  const port = parseInt(process.env.SERVER_PORT || '3000', 10);
  const transport = (process.env.MCP_TRANSPORT || 'httpStream') as 'stdio' | 'sse' | 'httpStream';

  console.log('[Application] Starting MCP OAuth Server...');
  console.log(`  Config: ${configPath}`);
  console.log(`  Port: ${port}`);
  console.log(`  Transport: ${transport}`);
  console.log();

  try {
    // Create server instance with config path
    const server = new MCPOAuthServer(configPath);

    // Start server (this initializes CoreContext)
    await server.start({
      transport,
      port,
    });

    // Register delegation modules AFTER start()
    // (CoreContext must exist before registering modules)
    const sqlModule = new SQLDelegationModule();
    await server.registerDelegationModule('sql', sqlModule);

    console.log(`[Application] Server started successfully on port ${port}`);
    console.log(`[Application] Transport: ${transport}`);

    // Graceful shutdown handlers
    const shutdown = async (signal: string) => {
      console.log(`\n[Application] Received ${signal}, shutting down gracefully...`);
      await server.stop();
      console.log('[Application] Server stopped');
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

  } catch (error) {
    console.error('[Application] Failed to start server:', error);
    process.exit(1);
  }
}

// Run the server
main().catch((error) => {
  console.error('[Application] Unhandled error:', error);
  process.exit(1);
});
