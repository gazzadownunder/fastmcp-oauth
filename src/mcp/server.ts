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
 * const server = new FastMCPOAuthServer('./config/unified-config.json');
 * await server.start({ transport: 'httpStream', port: 3000 });
 * ```
 */

import { FastMCP } from 'fastmcp';
import { ConfigManager } from '../config/manager.js';
import { ConfigOrchestrator } from './orchestrator.js';
import { FastMCPAuthMiddleware } from './middleware.js';
import {
  getAllToolFactories,
  createSQLToolsForModule,
  createRESTAPIToolsForModule,
} from './tools/index.js';
import type { CoreContext } from '../core/index.js';
import type { FastMCPStartOptions, FastMCPContext, ToolRegistration } from './types.js';
import type { DelegationModule } from '../delegation/base.js';
import type { ToolFactory } from './types.js';

/**
 * MCP OAuth Server
 *
 * Provides a simplified API for setting up an OAuth-enabled FastMCP server.
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
export class FastMCPOAuthServer {
  private configManager: ConfigManager;
  private orchestrator: ConfigOrchestrator;
  private coreContext?: CoreContext;
  private mcpServer?: FastMCP;
  private configPath: string;
  private isRunning = false;

  /**
   * Create a new FastMCP OAuth server
   *
   * @param configPath - Path to unified configuration file
   *
   * @example
   * ```typescript
   * const server = new FastMCPOAuthServer('./config/unified-config.json');
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
          `[FastMCP OAuth Server] Audit overflow: ${entries.length} entries discarded. ` +
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
    console.log(`[FastMCP OAuth Server] Registered delegation module: ${name}`);
  }

  /**
   * Register a custom MCP tool
   *
   * Allows developers to register custom tools with the MCP server after initialization.
   * This is the primary API for extending the framework with custom functionality.
   *
   * **Note:** Tools can be registered before OR after calling start(). If registered after
   * start(), the tool will be immediately available.
   *
   * @param tool - Tool registration object (from createDelegationTool or manual creation)
   *
   * @throws {Error} If server is not initialized (CoreContext is null)
   *
   * @example
   * ```typescript
   * import { createDelegationTool } from 'fastmcp-oauth';
   *
   * // Create custom tool using factory
   * const myTool = createDelegationTool('mymodule', {
   *   name: 'my-custom-tool',
   *   description: 'My custom delegation tool',
   *   requiredPermission: 'mymodule:execute',
   *   action: 'execute',
   *   parameters: z.object({ param: z.string() })
   * }, server.getCoreContext());
   *
   * // Register the tool
   * server.registerTool(myTool);
   * ```
   *
   * @see createDelegationTool for easy tool creation
   * @see Framework-update.md Phase 1.2
   */
  registerTool(tool: ToolRegistration): void {
    if (!this.coreContext) {
      throw new Error(
        'Cannot register tool before server initialization. ' +
          'CoreContext must be created first. Call start() or ensure configuration is loaded.'
      );
    }

    if (!this.mcpServer) {
      throw new Error(
        'Cannot register tool before server start. ' +
          'Call start() first to initialize the FastMCP server.'
      );
    }

    console.log(`[FastMCP OAuth Server] Registering custom tool: ${tool.name}`);

    this.mcpServer.addTool({
      name: tool.name,
      description: tool.description,
      parameters: tool.schema,
      canAccess: tool.canAccess as any,
      execute: async (args, context) => {
        // Extract UserSession from FastMCP context
        const fastmcpSession = (context as any).session;
        const mcpContext: FastMCPContext = {
          session: fastmcpSession?.session || fastmcpSession,
        };

        // Call tool handler
        const result = await tool.handler(args, mcpContext);

        // Convert LLMResponse to MCP protocol format
        if ('data' in result) {
          // Success response
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result.data, null, 2),
              },
            ],
          };
        } else {
          // Failure response
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
  }

  /**
   * Register multiple custom MCP tools at once
   *
   * Convenience method for registering multiple tools in a single call.
   *
   * @param tools - Array of tool registration objects
   *
   * @throws {Error} If server is not initialized
   *
   * @example
   * ```typescript
   * import { createDelegationTools } from 'fastmcp-oauth';
   *
   * // Create multiple tools for same module
   * const tools = createDelegationTools('myapi', [
   *   {
   *     name: 'api-get',
   *     description: 'GET request',
   *     requiredPermission: 'api:read',
   *     action: 'get',
   *     parameters: z.object({ endpoint: z.string() })
   *   },
   *   {
   *     name: 'api-post',
   *     description: 'POST request',
   *     requiredPermission: 'api:write',
   *     action: 'post',
   *     parameters: z.object({ endpoint: z.string(), body: z.any() })
   *   }
   * ], server.getCoreContext());
   *
   * // Register all tools at once
   * server.registerTools(tools);
   * ```
   *
   * @see registerTool for registering a single tool
   * @see Framework-update.md Phase 1.3
   */
  registerTools(tools: ToolRegistration[]): void {
    console.log(`[FastMCP OAuth Server] Registering ${tools.length} custom tools...`);
    for (const tool of tools) {
      this.registerTool(tool);
    }
    console.log(`[FastMCP OAuth Server] ✓ Successfully registered ${tools.length} custom tools`);
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
    const mcpConfig = this.coreContext.configManager.getMCPConfig();
    const primaryIDP = authConfig.trustedIDPs[0];

    if (!primaryIDP) {
      console.log('[FastMCP OAuth Server] No trusted IDPs configured, OAuth metadata disabled');
      return { enabled: false };
    }

    const serverUrl = process.env.SERVER_URL || `http://localhost:${port}`;

    console.log('[FastMCP OAuth Server] Building OAuth configuration...');
    console.log(`[FastMCP OAuth Server]   Primary IDP: ${primaryIDP.issuer}`);
    console.log(`[FastMCP OAuth Server]   Resource URL: ${serverUrl}`);

    // Check if protected resource metadata should be included
    // Default: true (enabled by default, must be explicitly disabled)
    const includeProtectedResource = mcpConfig?.oauth?.protectedResource ?? true;
    console.log(
      `[FastMCP OAuth Server]   Protected Resource Metadata: ${includeProtectedResource ? 'enabled' : 'disabled'}`
    );

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
    };

    // Add registration_endpoint if configured (RFC 7591 Dynamic Client Registration)
    if (mcpConfig?.oauth?.registrationEndpoint) {
      oauthConfig.authorizationServer.registrationEndpoint = mcpConfig.oauth.registrationEndpoint;
    }

    // Conditionally include protected resource metadata based on configuration
    if (includeProtectedResource) {
      oauthConfig.protectedResource = {
        resource: serverUrl,
        authorizationServers: authConfig.trustedIDPs.map((idp: any) => idp.issuer),
        scopesSupported: this.extractSupportedScopes(),
        bearerMethodsSupported: ['header'],
        resourceSigningAlgValuesSupported: primaryIDP.algorithms || ['RS256', 'ES256'],
        resourceDocumentation: `${serverUrl}/docs`,
        // MCP HTTP with SSE transport supports both JSON-RPC and SSE streaming
        acceptTypesSupported: ['application/json', 'text/event-stream'],
      };
    }

    // Add oauth_endpoints if explicitly configured in mcp.oauth.oauth_endpoints
    // This allows explicit control when multiple IDPs are configured
    console.log(
      '[FastMCP OAuth Server] DEBUG - mcpConfig.oauth:',
      JSON.stringify(mcpConfig?.oauth, null, 2)
    );
    if (mcpConfig?.oauth?.oauth_endpoints) {
      oauthConfig.oauth_endpoints = mcpConfig.oauth.oauth_endpoints;
      console.log(
        '[FastMCP OAuth Server]   OAuth endpoints (explicit): ' +
          `${mcpConfig.oauth.oauth_endpoints.authorization_endpoint}`
      );
    } else {
      console.log('[FastMCP OAuth Server]   WARNING: No oauth_endpoints configured in mcp.oauth');
    }

    console.log(
      '[FastMCP OAuth Server] DEBUG - Final oauthConfig:',
      JSON.stringify(oauthConfig, null, 2)
    );
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
  private extractSupportedScopes(): string[] {
    const mcpConfig = this.configManager.getMCPConfig();

    // Return configured scopes or empty array if not configured
    return mcpConfig?.oauth?.scopes || [];
  }

  /**
   * Start the FastMCP OAuth server
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
  async start(options: FastMCPStartOptions = {}): Promise<void> {
    if (this.isRunning) {
      throw new Error('Server is already running. Call stop() first.');
    }

    console.log('[FastMCP OAuth Server] Starting server...');

    // 1. Load configuration
    console.log(`[FastMCP OAuth Server] Loading configuration from: ${this.configPath}`);
    await this.configManager.loadConfig(this.configPath);
    const mcpConfig = this.configManager.getMCPConfig();

    // 2. Build CoreContext (services created but NOT initialized yet)
    console.log('[FastMCP OAuth Server] Building CoreContext...');
    this.coreContext = await this.orchestrator.buildCoreContext();

    // 3. Initialize AuthenticationService (CRITICAL: fetch JWKS before validation)
    console.log('[FastMCP OAuth Server] Initializing AuthenticationService (fetching JWKS)...');
    await this.coreContext.authService.initialize();
    console.log('[FastMCP OAuth Server] ✓ AuthenticationService initialized');

    // 4. Validate CoreContext (MANDATORY GAP #8: validate AFTER initialization)
    console.log('[FastMCP OAuth Server] Validating CoreContext...');
    ConfigOrchestrator.validateCoreContext(this.coreContext);
    console.log('[FastMCP OAuth Server] ✓ CoreContext validated');

    // 5. Create authentication middleware with CoreContext (required for WWW-Authenticate header generation)
    const authMiddleware = new FastMCPAuthMiddleware(
      this.coreContext.authService,
      this.coreContext
    );

    // 6. Determine transport and port (needed for OAuth config)
    const transport = options.transport || mcpConfig?.transport || 'httpStream';
    const port = options.port || mcpConfig?.port || 3000;

    // 7. Create FastMCP server
    const serverName = mcpConfig?.serverName || 'MCP OAuth Server';
    const serverVersion = (mcpConfig?.version || '2.0.0') as `${number}.${number}.${number}`;

    console.log(`[FastMCP OAuth Server] Creating FastMCP server: ${serverName} v${serverVersion}`);

    this.mcpServer = new FastMCP({
      name: serverName,
      version: serverVersion,
      authenticate: authMiddleware.authenticate.bind(authMiddleware) as any,
      oauth: this.buildOAuthConfig(port),
    });

    // 8. Auto-register tools from delegation.modules if toolPrefix is configured
    const delegationConfig = this.configManager.getDelegationConfig();
    const autoRegisterTools: ToolFactory[] = [];

    if (delegationConfig?.modules) {
      console.log('[FastMCP OAuth Server] Checking for modules with toolPrefix configuration...');

      for (const [moduleName, moduleConfig] of Object.entries(delegationConfig.modules)) {
        // Get toolPrefix from module config or use defaultToolPrefix
        const toolPrefix = (moduleConfig as any).toolPrefix || delegationConfig.defaultToolPrefix;

        if (!toolPrefix) {
          console.log(
            `[FastMCP OAuth Server]   Module "${moduleName}" has no toolPrefix - skipping auto-registration`
          );
          continue; // Skip modules without toolPrefix (manual registration required)
        }

        // Detect module type and create appropriate tools
        let tools: ToolFactory[] = [];

        if (moduleName.startsWith('postgresql') || moduleName.startsWith('mssql')) {
          // SQL module (PostgreSQL or MSSQL)
          console.log(
            `[FastMCP OAuth Server]   Auto-registering SQL tools for "${moduleName}" with prefix "${toolPrefix}"`
          );
          const descriptionSuffix =
            (moduleConfig as any)._comment || `(${(moduleConfig as any).database})`;
          tools = createSQLToolsForModule({
            toolPrefix,
            moduleName,
            descriptionSuffix,
          });
        } else if (moduleName.startsWith('rest-api')) {
          // REST API module
          console.log(
            `[FastMCP OAuth Server]   Auto-registering REST API tools for "${moduleName}" with prefix "${toolPrefix}"`
          );
          const descriptionSuffix =
            (moduleConfig as any)._comment || `(${(moduleConfig as any).baseUrl})`;
          tools = createRESTAPIToolsForModule({
            toolPrefix,
            moduleName,
            descriptionSuffix,
          });
        } else if (moduleName.startsWith('kerberos')) {
          // Kerberos module (file browsing)
          console.log(
            `[FastMCP OAuth Server]   Kerberos module "${moduleName}" detected with prefix "${toolPrefix}"`
          );
          console.warn(
            `[FastMCP OAuth Server]   ⚠ Kerberos tool auto-registration not yet implemented - use manual registration`
          );
          // Note: Kerberos file browsing tools use prefix for list/read/info tools
          // Implementation depends on kerberos-file-browse.ts refactoring
        } else {
          console.warn(
            `[FastMCP OAuth Server]   Unknown module type: "${moduleName}" - skipping auto-registration`
          );
        }

        if (tools.length > 0) {
          console.log(
            `[FastMCP OAuth Server]   ✓ Created ${tools.length} tool(s) for "${moduleName}"`
          );
          autoRegisterTools.push(...tools);
        }
      }
    }

    console.log(
      `[FastMCP OAuth Server] Auto-registration created ${autoRegisterTools.length} tool factories`
    );

    // 9. Register enabled tools
    // Check if custom SQL tools (sql1-, sql2-, etc.) will be registered later
    // If so, exclude default SQL tools to prevent duplicates
    const enabledTools = mcpConfig?.enabledTools || {};
    const enabledToolNames = Object.keys(enabledTools);
    const hasCustomSqlTools = enabledToolNames.some(
      (name) => /^sql\d+-/.test(name) // Matches sql1-, sql2-, etc.
    );

    // Also check if auto-registered tools include SQL tools
    const hasAutoRegisteredSqlTools = autoRegisterTools.some((factory) => {
      const tool = factory(this.coreContext!);
      return (
        tool.name.endsWith('-delegate') ||
        tool.name.endsWith('-schema') ||
        tool.name.endsWith('-table-details')
      );
    });

    console.log(`[FastMCP OAuth Server] Checking for custom SQL tools...`);
    console.log(`[FastMCP OAuth Server]   Enabled tool names:`, enabledToolNames);
    console.log(`[FastMCP OAuth Server]   Has custom SQL tools:`, hasCustomSqlTools);
    console.log(
      `[FastMCP OAuth Server]   Has auto-registered SQL tools:`,
      hasAutoRegisteredSqlTools
    );

    const toolFactories = getAllToolFactories({
      excludeSqlTools: hasCustomSqlTools || hasAutoRegisteredSqlTools,
    });

    console.log(`[FastMCP OAuth Server] Found ${toolFactories.length} available tools`);
    if (hasCustomSqlTools) {
      console.log(
        `[FastMCP OAuth Server] ✓ Custom SQL tools detected - excluding default SQL tools`
      );
    }
    if (hasAutoRegisteredSqlTools) {
      console.log(
        `[FastMCP OAuth Server] ✓ Auto-registered SQL tools detected - excluding default SQL tools`
      );
    }
    console.log(`[FastMCP OAuth Server] Enabled tools config:`, enabledTools);

    // 10. Register auto-generated tools first
    let registeredCount = 0;
    for (const factory of autoRegisterTools) {
      const toolReg = factory(this.coreContext!);
      console.log(`[FastMCP OAuth Server] Registering auto-generated tool: ${toolReg.name}`);
      registeredCount++;

      this.mcpServer.addTool({
        name: toolReg.name,
        description: toolReg.description,
        parameters: toolReg.schema,
        canAccess: toolReg.canAccess as any,
        execute: async (args, context) => {
          const fastmcpSession = (context as any).session;
          const mcpContext: FastMCPContext = {
            session: fastmcpSession?.session || fastmcpSession,
          };

          const result = await toolReg.handler(args, mcpContext);

          if ('data' in result) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result.data, null, 2),
                },
              ],
            };
          } else {
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
    }

    // 11. Register standard tool factories
    for (const factory of toolFactories) {
      const toolReg = factory(this.coreContext);

      // Check if tool is enabled in config
      // If enabledTools config is empty ({}), register all tools (backward compatibility)
      // If tool is explicitly in config, use that value
      // If tool is not in config but config has other tools, skip it (opt-in mode)
      const isEnabled = enabledTools[toolReg.name as keyof typeof enabledTools];
      const hasAnyToolsConfigured = Object.keys(enabledTools).length > 0;

      if (isEnabled === false) {
        console.log(`[FastMCP OAuth Server] Skipping disabled tool: ${toolReg.name}`);
        continue;
      }

      if (isEnabled === true) {
        console.log(`[FastMCP OAuth Server] Registering tool: ${toolReg.name}`);
        registeredCount++;
      } else if (!hasAnyToolsConfigured) {
        // No tools configured at all - register everything (backward compatibility)
        console.log(`[FastMCP OAuth Server] Registering tool (no filter): ${toolReg.name}`);
        registeredCount++;
      } else {
        // Tools are configured but this one isn't listed - skip it
        console.log(`[FastMCP OAuth Server] Skipping unconfigured tool: ${toolReg.name}`);
        continue;
      }

      this.mcpServer.addTool({
        name: toolReg.name,
        description: toolReg.description,
        parameters: toolReg.schema,
        canAccess: toolReg.canAccess as any, // FastMCP's canAccess API
        execute: async (args, context) => {
          // FastMCP provides: { authenticated: true, session: UserSession }
          // Extract the actual UserSession from the wrapper
          const fastmcpSession = (context as any).session;
          const mcpContext: FastMCPContext = {
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
    }

    const totalAvailableTools = toolFactories.length + autoRegisterTools.length;
    console.log(
      `[FastMCP OAuth Server] Successfully registered ${registeredCount} of ${totalAvailableTools} available tools`
    );
    console.log(
      `[FastMCP OAuth Server]   Auto-registered: ${autoRegisterTools.length}, Standard: ${registeredCount - autoRegisterTools.length}`
    );

    // 12. Start server
    console.log('[FastMCP OAuth Server] Starting FastMCP server...');
    await this.mcpServer.start({
      transportType: transport as any,
      httpStream:
        transport === 'httpStream'
          ? {
              host: '0.0.0.0', // Bind to all network interfaces (allows remote connections)
              port,
              endpoint: '/mcp',
              stateless: true, // OAuth requires stateless mode
            }
          : undefined,
    });

    this.isRunning = true;

    // 13. Log startup summary
    console.log('\n' + '='.repeat(60));
    console.log('[FastMCP OAuth Server] ✓ Server started successfully');
    console.log('='.repeat(60));
    console.log(`  Server Name:      ${serverName}`);
    console.log(`  Version:          ${serverVersion}`);
    console.log(`  Transport:        ${transport}`);
    if (transport === 'httpStream') {
      console.log(`  Host:             0.0.0.0 (all network interfaces)`);
      console.log(`  Port:             ${port}`);
      console.log(`  Endpoint:         /mcp`);
      console.log(`  URL (local):      http://localhost:${port}/mcp`);
      console.log(`  URL (network):    http://<server-ip>:${port}/mcp`);
      console.log(
        `  OAuth Metadata:   http://localhost:${port}/.well-known/oauth-authorization-server`
      );
      console.log(
        `  Resource Metadata: http://localhost:${port}/.well-known/oauth-protected-resource`
      );
    }
    console.log(`  Authentication:   OAuth 2.1 with JWT`);
    console.log(`  Tools Registered: ${registeredCount}`);
    console.log(`  - Auto-registered: ${autoRegisterTools.length}`);
    console.log(`  - Standard tools: ${registeredCount - autoRegisterTools.length}`);
    console.log(`  Audit Logging:    ${this.coreContext.auditService ? 'Enabled' : 'Disabled'}`);
    console.log('='.repeat(60) + '\n');
  }

  /**
   * Stop the FastMCP OAuth server
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
      console.log('[FastMCP OAuth Server] Server is not running');
      return;
    }

    console.log('[FastMCP OAuth Server] Stopping server...');

    // 1. Stop FastMCP server
    if (this.mcpServer) {
      await this.mcpServer.stop();
      console.log('[FastMCP OAuth Server] ✓ FastMCP server stopped');
    }

    // 2. Destroy CoreContext
    if (this.coreContext) {
      await ConfigOrchestrator.destroyCoreContext(this.coreContext);
      console.log('[FastMCP OAuth Server] ✓ CoreContext destroyed');
    }

    // 3. Clear state
    this.coreContext = undefined;
    this.mcpServer = undefined;
    this.isRunning = false;

    console.log('[FastMCP OAuth Server] ✓ Server stopped');
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
      throw new Error('CoreContext not initialized. Call start() first.');
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

// Legacy export for backward compatibility (will be deprecated)
export const MCPOAuthServer = FastMCPOAuthServer;
