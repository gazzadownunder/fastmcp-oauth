/**
 * Simple MCP OAuth Server Example
 *
 * Demonstrates the simplified MCPOAuthServer API that reduces boilerplate
 * from ~100 lines to just ~20 lines.
 *
 * This example shows:
 * - Minimal server setup with MCPOAuthServer
 * - Configuration loading
 * - Graceful shutdown
 *
 * Compare this with examples/full-mcp-server.ts (127 lines) to see the
 * dramatic reduction in boilerplate code.
 *
 * @see Docs/remediation-plan.md Gap #3 for MCPOAuthServer details
 */

import { FastMCPOAuthServer } from '../src/mcp/server.js';

/**
 * Main function - starts the server
 */
async function main() {
  // Create server instance with config path
  const server = new FastMCPOAuthServer('./config/unified-config.json');

  // Start server (defaults from config, or override here)
  await server.start({
    transport: 'httpStream',
    port: 3000,
  });

  // Graceful shutdown handler
  process.on('SIGINT', async () => {
    console.log('\n[Simple Server] Received SIGINT, shutting down gracefully...');
    await server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n[Simple Server] Received SIGTERM, shutting down gracefully...');
    await server.stop();
    process.exit(0);
  });
}

// Run the server
main().catch((error) => {
  console.error('[Simple Server] Failed to start server:', error);
  process.exit(1);
});

/**
 * Example unified-config.json:
 *
 * {
 *   "auth": {
 *     "trustedIDPs": [{
 *       "issuer": "https://auth.example.com",
 *       "discoveryUrl": "https://auth.example.com/.well-known/oauth-authorization-server",
 *       "jwksUri": "https://auth.example.com/.well-known/jwks.json",
 *       "audience": "mcp-server",
 *       "algorithms": ["RS256", "ES256"],
 *       "claimMappings": {
 *         "legacyUsername": "legacy_sam_account",
 *         "roles": "user_roles",
 *         "scopes": "scopes"
 *       },
 *       "security": {
 *         "clockTolerance": 60,
 *         "maxTokenAge": 3600,
 *         "requireNbf": true
 *       },
 *       "roleMappings": {
 *         "admin": ["admin", "administrator"],
 *         "user": ["user", "member"],
 *         "guest": ["guest"],
 *         "defaultRole": "guest"
 *       }
 *     }],
 *     "audit": {
 *       "enabled": true,
 *       "logAllAttempts": true,
 *       "retentionDays": 90
 *     }
 *   },
 *   "delegation": {
 *     "modules": {
 *       "sql": {
 *         "server": "sql01.company.com",
 *         "database": "legacy_app",
 *         "options": {
 *           "trustedConnection": true,
 *           "encrypt": true
 *         }
 *       }
 *     }
 *   },
 *   "mcp": {
 *     "serverName": "MCP OAuth Server",
 *     "version": "2.0.0",
 *     "transport": "httpStream",
 *     "port": 3000
 *   }
 * }
 */
