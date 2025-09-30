#!/usr/bin/env node
import OAuthOBOServer from './index-simple.js';

/**
 * Start the OAuth OBO MCP Server with HTTP Stream transport
 * This server provides OAuth delegation to remote MCP clients via /mcp endpoint
 */
async function main() {
  const server = new OAuthOBOServer();

  // Get configuration from environment
  const configPath = process.env.CONFIG_PATH;
  const port = process.env.SERVER_PORT ? parseInt(process.env.SERVER_PORT, 10) : 3000;
  const endpoint = process.env.MCP_ENDPOINT || '/mcp';

  console.log('Starting FastMCP OAuth OBO Server...');
  console.log(`Transport: HTTP Stream`);
  console.log(`Port: ${port}`);
  console.log(`Endpoint: ${endpoint}`);
  console.log(`Config: ${configPath || 'default'}`);

  try {
    await server.start({
      transportType: 'httpStream',
      port,
      endpoint,
      configPath,
    });

    console.log(`\n✓ Server is listening on http://localhost:${port}`);
    console.log(`\nMCP Endpoint:`);
    console.log(`  - ${endpoint}: http://localhost:${port}${endpoint}`);
    console.log(`\nReady to accept OAuth-authenticated MCP requests`);
    console.log(`\nAuthentication: Bearer token required in Authorization header`);
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n\nShutting down server...');
    await server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n\nShutting down server...');
    await server.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});