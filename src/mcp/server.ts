/**
 * MCP OAuth Server
 *
 * High-level wrapper for FastMCP with OAuth authentication and delegation.
 *
 * Simplifies server setup by providing a single class that orchestrates:
 * - Configuration loading and validation
 * - CoreContext creation and validation
 * - Authentication middleware setup
 * - Tool registration with dependency injection
 * - Server lifecycle management
 *
 * @example
 * ```typescript
 * const server = new MCPOAuthServer('./config/unified-config.json');
 * await server.start({ transport: 'httpStream', port: 3000 });
 * ```
 */

import { FastMCP } from 'fastmcp';
import { ConfigManager } from '../config/manager.js';
import { ConfigOrchestrator } from './orchestrator.js';
import { MCPAuthMiddleware } from './middleware.js';
import { getAllToolFactories } from './tools/index.js';
import type { CoreContext } from '../core/index.js';
import type { MCPStartOptions, MCPContext } from './types.js';
import type { DelegationModule } from '../delegation/base.js';

/**
 * MCP OAuth Server
 *
 * Provides a simplified API for setting up an OAuth-enabled MCP server.
 *
 * Features:
 * - Automatic configuration loading and validation
 * - CoreContext creation with all services
 * - Built-in authentication middleware
 * - Tool registration with dependency injection
 * - Lifecycle management (start/stop)
 * - Custom delegation module support
 *
 * @see remediation-plan.md Gap #3 for implementation details
 */
export class MCPOAuthServer {
  private configManager: ConfigManager;
  private orchestrator: ConfigOrchestrator;
  private coreContext?: CoreContext;
  private mcpServer?: FastMCP;
  private configPath: string;
  private isRunning: boolean = false;

  /**
   * Create a new MCP OAuth server
   *
   * @param configPath - Path to unified configuration file
   *
   * @example
   * ```typescript
   * const server = new MCPOAuthServer('./config/unified-config.json');
   * ```
   */
  constructor(configPath: string) {
    this.configPath = configPath;
    this.configManager = new ConfigManager();
    this.orchestrator = new ConfigOrchestrator({
      configManager: this.configManager,
      enableAudit: true,
      onAuditOverflow: (entries) => {
        console.warn(
          `[MCP OAuth Server] Audit overflow: ${entries.length} entries discarded. ` +
          'Consider implementing persistent storage for audit logs.'
        );
      },
    });
  }

  /**
   * Register a custom delegation module
   *
   * This allows you to add custom delegation strategies beyond the built-in
   * SQL and Kerberos modules.
   *
   * @param name - Module name (e.g., 'sql', 'kerberos', 'ldap')
   * @param module - DelegationModule implementation
   *
   * @throws {Error} If server is not initialized (call start() first)
   *
   * @example
   * ```typescript
   * const sqlModule = new SQLDelegationModule(sqlConfig);
   * await server.registerDelegationModule('sql', sqlModule);
   * ```
   */
  async registerDelegationModule(name: string, module: DelegationModule): Promise<void> {
    if (!this.coreContext) {
      throw new Error(
        'Cannot register delegation module before server initialization. ' +
        'Call start() first, or register modules in the start callback.'
      );
    }

    await this.coreContext.delegationRegistry.register(name, module);
    console.log(`[MCP OAuth Server] Registered delegation module: ${name}`);
  }

  /**
   * Start the MCP OAuth server
   *
   * This will:
   * 1. Load and validate configuration
   * 2. Build and validate CoreContext
   * 3. Set up authentication middleware
   * 4. Register all tools with dependency injection
   * 5. Start the FastMCP server
   *
   * @param options - Server start options (transport, port, etc.)
   *
   * @example
   * ```typescript
   * // Start with default settings from config
   * await server.start();
   *
   * // Start with custom transport and port
   * await server.start({ transport: 'httpStream', port: 3000 });
   *
   * // Start with stdio transport
   * await server.start({ transport: 'stdio' });
   * ```
   */
  async start(options: MCPStartOptions = {}): Promise<void> {
    if (this.isRunning) {
      throw new Error('Server is already running. Call stop() first.');
    }

    console.log('[MCP OAuth Server] Starting server...');

    // 1. Load configuration
    console.log(`[MCP OAuth Server] Loading configuration from: ${this.configPath}`);
    await this.configManager.loadConfig(this.configPath);
    const mcpConfig = this.configManager.getMCPConfig();

    // 2. Build CoreContext (services created but NOT initialized yet)
    console.log('[MCP OAuth Server] Building CoreContext...');
    this.coreContext = await this.orchestrator.buildCoreContext();

    // 3. Initialize AuthenticationService (CRITICAL: fetch JWKS before validation)
    console.log('[MCP OAuth Server] Initializing AuthenticationService (fetching JWKS)...');
    await this.coreContext.authService.initialize();
    console.log('[MCP OAuth Server] ✓ AuthenticationService initialized');

    // 4. Validate CoreContext (MANDATORY GAP #8: validate AFTER initialization)
    console.log('[MCP OAuth Server] Validating CoreContext...');
    ConfigOrchestrator.validateCoreContext(this.coreContext);
    console.log('[MCP OAuth Server] ✓ CoreContext validated');

    // 5. Create authentication middleware
    const authMiddleware = new MCPAuthMiddleware(this.coreContext.authService);

    // 6. Create FastMCP server
    const serverName = mcpConfig?.serverName || 'MCP OAuth Server';
    const serverVersion = mcpConfig?.version || '2.0.0';

    console.log(`[MCP OAuth Server] Creating FastMCP server: ${serverName} v${serverVersion}`);
    this.mcpServer = new FastMCP({
      name: serverName,
      version: serverVersion,
      authenticate: authMiddleware.authenticate.bind(authMiddleware),
    });

    // 7. Register all tools
    const toolFactories = getAllToolFactories();
    console.log(`[MCP OAuth Server] Registering ${toolFactories.length} tools...`);

    for (const factory of toolFactories) {
      const toolReg = factory(this.coreContext);

      this.mcpServer.addTool({
        name: toolReg.name,
        description: toolReg.description,
        parameters: toolReg.schema,
        canAccess: toolReg.canAccess as any, // FastMCP's canAccess API
        execute: async (args, context) => {
          // FastMCP provides: { authenticated: true, session: UserSession }
          // Extract the actual UserSession from the wrapper
          const fastmcpSession = (context as any).session;
          const mcpContext: MCPContext = {
            session: fastmcpSession?.session || fastmcpSession,
          };

          // Call tool handler (returns LLMResponse with { status, data } or { status, code, message })
          const result = await toolReg.handler(args, mcpContext);

          // Convert LLMResponse to MCP protocol format
          // FastMCP expects: { content: [{ type: 'text', text: string }] }
          if ('data' in result) {
            // Success response: serialize data as JSON string
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result.data, null, 2),
                },
              ],
            };
          } else {
            // Failure response: return error details as JSON string
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      error: result.code,
                      message: result.message,
                    },
                    null,
                    2
                  ),
                },
              ],
              isError: true,
            };
          }
        },
      });

      console.log(`[MCP OAuth Server]   ✓ Registered tool: ${toolReg.name}`);
    }

    console.log(`[MCP OAuth Server] ✓ Registered ${toolFactories.length} tools`);

    // 8. Start server
    const transport = options.transport || mcpConfig?.transport || 'httpStream';
    const port = options.port || mcpConfig?.port || 3000;

    console.log('[MCP OAuth Server] Starting FastMCP server...');
    await this.mcpServer.start({
      transportType: transport as any,
      httpStream: transport === 'httpStream' ? { port, endpoint: '/mcp' } : undefined,
      stateless: true, // OAuth requires stateless mode
      logLevel: 'debug', // Increased for troubleshooting
    });

    this.isRunning = true;

    // 9. Log startup summary
    console.log('\n' + '='.repeat(60));
    console.log('[MCP OAuth Server] ✓ Server started successfully');
    console.log('='.repeat(60));
    console.log(`  Server Name:      ${serverName}`);
    console.log(`  Version:          ${serverVersion}`);
    console.log(`  Transport:        ${transport}`);
    if (transport === 'httpStream') {
      console.log(`  Port:             ${port}`);
      console.log(`  Endpoint:         /mcp`);
      console.log(`  URL:              http://localhost:${port}/mcp`);
    }
    console.log(`  Authentication:   OAuth 2.1 with JWT`);
    console.log(`  Tools Registered: ${toolFactories.length}`);
    console.log(`  Audit Logging:    ${this.coreContext.auditService ? 'Enabled' : 'Disabled'}`);
    console.log('='.repeat(60) + '\n');
  }

  /**
   * Stop the MCP OAuth server
   *
   * This will:
   * 1. Stop the FastMCP server
   * 2. Destroy the CoreContext and cleanup resources
   * 3. Clear all internal state
   *
   * @example
   * ```typescript
   * // Graceful shutdown
   * process.on('SIGINT', async () => {
   *   console.log('\nShutting down...');
   *   await server.stop();
   *   process.exit(0);
   * });
   * ```
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      console.log('[MCP OAuth Server] Server is not running');
      return;
    }

    console.log('[MCP OAuth Server] Stopping server...');

    // 1. Stop FastMCP server
    if (this.mcpServer) {
      await this.mcpServer.close();
      console.log('[MCP OAuth Server] ✓ FastMCP server stopped');
    }

    // 2. Destroy CoreContext
    if (this.coreContext) {
      await ConfigOrchestrator.destroyCoreContext(this.coreContext);
      console.log('[MCP OAuth Server] ✓ CoreContext destroyed');
    }

    // 3. Clear state
    this.coreContext = undefined;
    this.mcpServer = undefined;
    this.isRunning = false;

    console.log('[MCP OAuth Server] ✓ Server stopped');
  }

  /**
   * Get the CoreContext
   *
   * Provides access to core services for advanced use cases.
   *
   * @returns CoreContext with all core services
   * @throws {Error} If server is not initialized
   *
   * @example
   * ```typescript
   * const context = server.getCoreContext();
   * const auditEntries = context.auditService.getEntries();
   * ```
   */
  getCoreContext(): CoreContext {
    if (!this.coreContext) {
      throw new Error(
        'CoreContext not initialized. Call start() first.'
      );
    }
    return this.coreContext;
  }

  /**
   * Check if server is running
   *
   * @returns true if server is running, false otherwise
   */
  isServerRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get server configuration
   *
   * @returns Configuration manager instance
   */
  getConfigManager(): ConfigManager {
    return this.configManager;
  }
}
