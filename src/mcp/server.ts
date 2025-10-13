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

    // DelegationRegistry.register() takes only the module parameter
    // The module's .name property is used as the registration key
    await this.coreContext.delegationRegistry.register(module);
    console.log(`[MCP OAuth Server] Registered delegation module: ${name}`);
  }

  /**
   * Build OAuth configuration for FastMCP
   *
   * Generates RFC 8414 Authorization Server Metadata and RFC 9728 Protected Resource Metadata
   * from the trusted IDP configuration.
   *
   * @param port - Server port for resource URL
   * @returns OAuth configuration object or { enabled: false } if no IDPs configured
   *
   * @private
   */
  private buildOAuthConfig(port: number): any {
    if (!this.coreContext) {
      return { enabled: false };
    }

    const authConfig = this.coreContext.configManager.getAuthConfig();
    const delegationConfig = this.coreContext.configManager.getDelegationConfig();
    const mcpConfig = this.coreContext.configManager.getMCPConfig();
    const primaryIDP = authConfig.trustedIDPs[0];

    if (!primaryIDP) {
      console.log('[MCP OAuth Server] No trusted IDPs configured, OAuth metadata disabled');
      return { enabled: false };
    }

    const serverUrl = process.env.SERVER_URL || `http://localhost:${port}`;

    console.log('[MCP OAuth Server] Building OAuth configuration...');
    console.log(`[MCP OAuth Server]   Primary IDP: ${primaryIDP.issuer}`);
    console.log(`[MCP OAuth Server]   Resource URL: ${serverUrl}`);

    // Build base config
    const oauthConfig: any = {
      enabled: true,
      authorizationServer: {
        issuer: primaryIDP.issuer,
        authorizationEndpoint: `${primaryIDP.issuer}/protocol/openid-connect/auth`,
        tokenEndpoint: `${primaryIDP.issuer}/protocol/openid-connect/token`,
        jwksUri: primaryIDP.jwksUri,
        responseTypesSupported: ['code'],
        grantTypesSupported: ['authorization_code', 'refresh_token'],
        codeChallengeMethodsSupported: ['S256'],
        scopesSupported: ['openid', 'profile', 'email'],
        tokenEndpointAuthMethodsSupported: ['client_secret_basic', 'client_secret_post'],
      },
      protectedResource: {
        resource: serverUrl,
        authorizationServers: authConfig.trustedIDPs.map((idp) => idp.issuer),
        scopesSupported: this.extractSupportedScopes(delegationConfig),
        bearerMethodsSupported: ['header'],
        resourceSigningAlgValuesSupported: primaryIDP.algorithms || ['RS256', 'ES256'],
        resourceDocumentation: `${serverUrl}/docs`,
        // MCP HTTP with SSE transport supports both JSON-RPC and SSE streaming
        acceptTypesSupported: ['application/json', 'text/event-stream'],
      },
    };

    // Add oauth_endpoints if explicitly configured in mcp.oauth.oauth_endpoints
    // This allows explicit control when multiple IDPs are configured
    console.log('[MCP OAuth Server] DEBUG - mcpConfig.oauth:', JSON.stringify(mcpConfig?.oauth, null, 2));
    if (mcpConfig?.oauth?.oauth_endpoints) {
      oauthConfig.oauth_endpoints = mcpConfig.oauth.oauth_endpoints;
      console.log('[MCP OAuth Server]   OAuth endpoints (explicit): ' +
        `${mcpConfig.oauth.oauth_endpoints.authorization_endpoint}`);
    } else {
      console.log('[MCP OAuth Server]   WARNING: No oauth_endpoints configured in mcp.oauth');
    }

    console.log('[MCP OAuth Server] DEBUG - Final oauthConfig:', JSON.stringify(oauthConfig, null, 2));
    return oauthConfig;
  }

  /**
   * Extract supported scopes from MCP configuration
   *
   * Reads scopes from mcp.oauth.scopes configuration array.
   * If not configured, returns empty array.
   *
   * @param delegationConfig - Delegation configuration object (unused, kept for compatibility)
   * @returns Array of supported scope strings
   *
   * @private
   */
  private extractSupportedScopes(delegationConfig: any): string[] {
    const mcpConfig = this.configManager.getMCPConfig();

    // Return configured scopes or empty array if not configured
    return mcpConfig?.oauth?.scopes || [];
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

    // 6. Determine transport and port (needed for OAuth config)
    const transport = options.transport || mcpConfig?.transport || 'httpStream';
    const port = options.port || mcpConfig?.port || 3000;

    // 7. Create FastMCP server
    const serverName = mcpConfig?.serverName || 'MCP OAuth Server';
    const serverVersion = mcpConfig?.version || '2.0.0';

    console.log(`[MCP OAuth Server] Creating FastMCP server: ${serverName} v${serverVersion}`);
    this.mcpServer = new FastMCP({
      name: serverName,
      version: serverVersion,
      authenticate: authMiddleware.authenticate.bind(authMiddleware),
      oauth: this.buildOAuthConfig(port),
    });

    // 8. Register all tools
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

    // 9. Start server
    console.log('[MCP OAuth Server] Starting FastMCP server...');
    await this.mcpServer.start({
      transportType: transport as any,
      httpStream: transport === 'httpStream' ? { port, endpoint: '/mcp' } : undefined,
      stateless: true, // OAuth requires stateless mode
      logLevel: 'debug', // Increased for troubleshooting
    });

    this.isRunning = true;

    // 10. Log startup summary
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
      console.log(`  OAuth Metadata:   http://localhost:${port}/.well-known/oauth-authorization-server`);
      console.log(`  Resource Metadata: http://localhost:${port}/.well-known/oauth-protected-resource`);
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
