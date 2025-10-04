#!/usr/bin/env node
/**
 * v2 Test Server - New Modular Framework
 *
 * Purpose: Test harness for validating the new modular architecture (v2.0)
 *
 * Features:
 * - Uses MCPOAuthServer wrapper (simplified API)
 * - Unified config format (auth + delegation + mcp)
 * - All available tools registered (sql-delegate, health-check, user-info)
 * - Graceful shutdown handling
 *
 * Usage:
 *   npm run build
 *   node dist/test-harness/v2-test-server.js
 *
 * Environment:
 *   NODE_ENV=development
 *   CONFIG_PATH=./test-harness/config/v2-keycloak-oauth-only.json
 *   SERVER_PORT=3000
 */

import { MCPOAuthServer } from '../src/mcp/server.js';
import { SQLDelegationModule } from '../src/delegation/sql/sql-module.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration - Set NODE_ENV FIRST for schema validation
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'development';
}

const CONFIG_PATH = process.env.CONFIG_PATH || './test-harness/config/v2-keycloak-oauth-only.json';
const SERVER_PORT = parseInt(process.env.SERVER_PORT || '3000', 10);
const NODE_ENV = process.env.NODE_ENV;

console.log('═══════════════════════════════════════════════════════════');
console.log('  MCP OAuth v2 Test Server - New Modular Framework');
console.log('═══════════════════════════════════════════════════════════');
console.log(`Environment:     ${NODE_ENV}`);
console.log(`Config:          ${CONFIG_PATH}`);
console.log(`Port:            ${SERVER_PORT}`);
console.log(`Transport:       http-stream`);
console.log('═══════════════════════════════════════════════════════════\n');

async function main() {
  let server: MCPOAuthServer | null = null;

  try {
    // Step 1: Create server with config path
    console.log('[1/3] Creating MCPOAuthServer...');
    const configPath = path.resolve(process.cwd(), CONFIG_PATH);
    console.log(`      Config path: ${configPath}`);

    server = new MCPOAuthServer(configPath);
    console.log('✓     Server instance created\n');

    // Step 2: Start server (this initializes CoreContext)
    console.log('[2/3] Starting MCP server...');
    console.log('      Loading config, building CoreContext, registering tools...');
    await server.start({
      transport: 'httpStream', // Fixed: use camelCase not kebab-case
      port: SERVER_PORT
    });
    console.log(`✓     Server started successfully\n`);

    // Step 3: Register delegation modules (AFTER start, optional)
    console.log('[3/3] Checking for delegation modules...');

    const coreContext = server.getCoreContext();
    const delegationConfig = coreContext.configManager.getDelegationConfig();

    if (delegationConfig?.modules?.sql) {
      console.log('      SQL delegation module detected in config');
      const sqlModule = new SQLDelegationModule();
      await server.registerDelegationModule('sql', sqlModule);
      console.log('✓     SQL delegation module registered\n');
    } else {
      console.log('      No delegation modules configured (OAuth-only mode)\n');
    }

    console.log('═══════════════════════════════════════════════════════════');
    console.log('  Server Ready - Press Ctrl+C to stop');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log('Available Tools:');
    console.log('  • health-check  - Check delegation service health');
    console.log('  • user-info     - Get current user session info');
    if (delegationConfig?.modules?.sql) {
      console.log('  • sql-delegate  - Execute SQL on behalf of user');
    }
    console.log('');

    console.log('Test Commands:');
    console.log('  1. Get JWT from Keycloak (see test-harness/scripts/)');
    console.log('  2. Call user-info tool:');
    console.log('     curl -X POST http://localhost:3000/mcp \\');
    console.log('       -H "Authorization: Bearer $TOKEN" \\');
    console.log('       -d \'{"method":"tools/call","params":{"name":"user-info","arguments":{}}}\'');
    console.log('');

    // Keep the process alive (FastMCP doesn't block on httpStream transport)
    // This prevents the server from exiting immediately
    await new Promise(() => {}); // Never resolves - keeps process alive until SIGINT/SIGTERM

  } catch (error) {
    console.error('\n❌ Server startup failed:\n');

    if (error instanceof Error) {
      console.error(`   Error: ${error.message}`);

      if (error.stack && NODE_ENV === 'development') {
        console.error('\n   Stack trace:');
        console.error(error.stack.split('\n').map(line => `   ${line}`).join('\n'));
      }
    } else {
      console.error(`   Unknown error: ${String(error)}`);
    }

    console.error('\nCommon Issues:');
    console.error('  • Config file not found - check CONFIG_PATH');
    console.error('  • Invalid config format - verify JSON schema');
    console.error('  • Port in use - check SERVER_PORT');
    console.error('  • Keycloak not reachable - verify JWKS endpoint');
    console.error('');

    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n\n${signal} received - shutting down gracefully...`);

    if (server) {
      try {
        console.log('  • Stopping MCP server...');
        await server.stop();
        console.log('  • Server stopped\n');
        console.log('Goodbye!\n');
        process.exit(0);
      } catch (error) {
        console.error('  • Error during shutdown:', error);
        process.exit(1);
      }
    } else {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Run server
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
