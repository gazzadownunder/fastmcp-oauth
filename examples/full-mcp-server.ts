/**
 * Example: Full MCP Server with New Modular Architecture
 *
 * This example demonstrates setting up a complete MCP server using
 * the new modular architecture with Core authentication, SQL delegation,
 * and MCP tools.
 */

import { FastMCP } from '@gazzadownunder/fastmcp';
import {
  ConfigManager,
  type UnifiedConfig
} from '../src/config/index.js';

import {
  AuthenticationService,
  SessionManager,
  JWTValidator,
  RoleMapper,
  AuditService,
  CoreContextValidator,
  type CoreContext
} from '../src/core/index.js';

import {
  DelegationRegistry,
  SQLDelegationModule
} from '../src/delegation/index.js';

import {
  MCPAuthMiddleware,
  ConfigOrchestrator,
  createSqlDelegateTool,
  getAllToolFactories,
  type MCPContext
} from '../src/mcp/index.js';

async function main() {
  // 1. Load configuration
  const configManager = new ConfigManager();
  await configManager.loadConfig('./config/unified-config.json');

  // 2. Build CoreContext using ConfigOrchestrator
  const orchestrator = new ConfigOrchestrator({
    configManager,
    enableAudit: true,
    onAuditOverflow: (entries) => {
      console.log(`Audit overflow: ${entries.length} entries saved to disk`);
      // In production, write to persistent storage
    }
  });

  const coreContext = await orchestrator.buildCoreContext();

  // 3. Validate CoreContext (best practice)
  ConfigOrchestrator.validateCoreContext(coreContext);

  console.log('✓ CoreContext initialized and validated');

  // 3.5. ⚠️ CRITICAL: Initialize AuthenticationService to download JWKS keys
  // This step is REQUIRED for JWT validation. Without it, all authentication will fail.
  await coreContext.authService.initialize();

  console.log('✓ AuthenticationService initialized (JWKS keys downloaded)');

  // 4. Create FastMCP server with authentication middleware
  const mcpMiddleware = new FastMCPAuthMiddleware(coreContext.authService);

  const server = new FastMCP({
    name: 'MCP OAuth Server',
    version: '2.0.0',
    authenticate: mcpMiddleware.authenticate.bind(mcpMiddleware)
  });

  // 5. Register all tools using tool factories
  const toolFactories = getAllToolFactories();

  for (const factory of toolFactories) {
    const toolRegistration = factory(coreContext);

    server.addTool({
      name: toolRegistration.name,
      description: toolRegistration.schema.description || `Tool: ${toolRegistration.name}`,
      parameters: toolRegistration.schema,
      canAccess: toolRegistration.canAccess,  // FastMCP's native canAccess API
      execute: async (args, context) => {
        const mcpContext: MCPContext = {
          session: (context as any).session
        };

        return toolRegistration.handler(args, mcpContext);
      }
    });
  }

  console.log(`✓ Registered ${toolFactories.length} tools`);

  // 6. Start the server
  const mcpConfig = configManager.getMCPConfig();

  await server.start({
    transportType: 'httpStream',
    httpStream: {
      port: mcpConfig?.port || 3000,
      endpoint: '/mcp'
    },
    stateless: true, // OAuth requires stateless mode
    logLevel: 'info'
  });

  console.log('✓ MCP Server started on port', mcpConfig?.port || 3000);
  console.log('  Endpoint: /mcp');
  console.log('  Authentication: OAuth 2.1 with JWT');
  console.log('  Delegation: SQL Server (EXECUTE AS USER)');

  // 7. Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await ConfigOrchestrator.destroyCoreContext(coreContext);
    process.exit(0);
  });
}

// Run the server
main().catch((error) => {
  console.error('Failed to start server:', error);
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
 *       }
 *     }],
 *     "roleMappings": {
 *       "adminRole": "admin",
 *       "userRole": "user",
 *       "guestRole": "guest",
 *       "customRoles": ["developer"]
 *     },
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
 *     "port": 3000,
 *     "enabledTools": ["sql-delegate", "health-check", "user-info"]
 *   }
 * }
 */
