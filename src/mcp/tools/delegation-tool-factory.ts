/**
 * Generic Delegation Tool Factory
 *
 * Provides a factory function for creating MCP tools that delegate to
 * custom delegation modules with minimal boilerplate.
 *
 * Handles all OAuth authentication, authorization, session management,
 * error handling, and audit logging automatically.
 *
 * This is the PRIMARY API for developers extending the framework with
 * custom delegation modules.
 *
 * @see Framework-update.md Phase 1.1
 *
 * @example
 * ```typescript
 * import { createDelegationTool } from 'mcp-oauth-framework';
 * import { z } from 'zod';
 *
 * // Create a tool for your custom delegation module
 * const myTool = createDelegationTool('mymodule', {
 *   name: 'my-legacy-call',
 *   description: 'Call my legacy system on behalf of user',
 *   requiredPermission: 'mylegacy:call',
 *   action: 'execute',
 *   parameters: z.object({
 *     operation: z.string(),
 *     params: z.record(z.any()).optional()
 *   })
 * }, coreContext);
 *
 * // Register with server
 * server.registerTool(myTool);
 * ```
 */

import { z } from 'zod';
import type { CoreContext } from '../../core/index.js';
import type { ToolRegistration, LLMResponse, MCPContext } from '../types.js';
import { Authorization } from '../authorization.js';
import { OAuthSecurityError, createSecurityError } from '../../utils/errors.js';
import { handleToolError } from '../utils/error-helpers.js';
import { generateWWWAuthenticateHeader } from '../oauth-metadata.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for creating a delegation tool
 *
 * @template TParams - Zod schema type for tool parameters
 */
export interface DelegationToolConfig<TParams extends z.ZodType = z.ZodType> {
  /**
   * Tool name (must be unique across all tools)
   *
   * Convention: Use kebab-case (e.g., 'my-legacy-call')
   */
  name: string;

  /**
   * Human-readable description of what the tool does
   *
   * This is shown to users in tool listings and helps LLMs understand
   * when to use this tool.
   */
  description: string;

  /**
   * Required permission for executing this tool (DEPRECATED - use requiredRoles instead)
   *
   * @deprecated The framework now uses role-based access control only.
   *             Use `requiredRoles` instead. This field is ignored.
   *
   * @example 'mylegacy:call', 'api:read', 'sql:query'
   */
  requiredPermission?: string;

  /**
   * Action name to pass to the delegation module's delegate() method
   *
   * @example 'query', 'execute', 'call', 'read'
   */
  action: string;

  /**
   * Zod schema for tool parameters
   *
   * Defines and validates the parameters that can be passed to the tool.
   */
  parameters: TParams;

  /**
   * Optional: Additional roles required to access this tool
   *
   * If specified, user must have at least one of these roles in addition
   * to the required permission.
   *
   * @example ['admin'], ['user', 'developer']
   */
  requiredRoles?: string[];

  /**
   * Optional: Custom visibility check
   *
   * If provided, this function is called in addition to the default
   * permission check to determine if the tool should be visible to the user.
   *
   * @param context - MCP context with user session
   * @returns true if tool should be visible, false otherwise
   */
  canAccess?: (context: MCPContext) => boolean;

  /**
   * Optional: Transform parameters before delegation
   *
   * Use this to modify or enrich parameters before they are passed to
   * the delegation module.
   *
   * @param params - Validated parameters from user
   * @param session - User session
   * @returns Transformed parameters
   */
  transformParams?: (params: z.infer<TParams>, session: any) => any;

  /**
   * Optional: Transform delegation result before returning
   *
   * Use this to modify or filter the result from the delegation module
   * before it is returned to the user.
   *
   * @param result - Result from delegation module
   * @returns Transformed result
   */
  transformResult?: (result: any) => any;
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a generic delegation tool with automatic OAuth handling
 *
 * This factory function creates a fully-featured MCP tool that:
 * - Extracts and validates user session
 * - Checks required permissions and roles
 * - Calls the delegation module via DelegationRegistry
 * - Logs audit trail
 * - Handles errors securely
 * - Returns LLMResponse format
 *
 * **This is the PRIMARY API for extending the framework.**
 *
 * @param moduleName - Name of the delegation module (registered in DelegationRegistry)
 * @param config - Tool configuration
 * @param coreContext - CoreContext with all services
 * @returns ToolRegistration ready to register with MCP server
 *
 * @example
 * ```typescript
 * // Create a REST API delegation tool
 * const apiTool = createDelegationTool('myapi', {
 *   name: 'call-api',
 *   description: 'Call internal API on behalf of user',
 *   requiredPermission: 'api:call',
 *   action: 'execute',
 *   parameters: z.object({
 *     endpoint: z.string(),
 *     method: z.enum(['GET', 'POST', 'PUT', 'DELETE']),
 *     body: z.any().optional()
 *   })
 * }, coreContext);
 *
 * server.registerTool(apiTool);
 * ```
 *
 * @example
 * ```typescript
 * // Create a tool with custom transformations
 * const enrichedTool = createDelegationTool('legacy', {
 *   name: 'legacy-query',
 *   description: 'Query legacy system',
 *   requiredPermission: 'legacy:read',
 *   action: 'query',
 *   parameters: z.object({ query: z.string() }),
 *   transformParams: (params, session) => ({
 *     ...params,
 *     userId: session.userId,
 *     timestamp: new Date().toISOString()
 *   }),
 *   transformResult: (result) => ({
 *     data: result.data,
 *     recordCount: result.data?.length || 0
 *   })
 * }, coreContext);
 * ```
 */
export function createDelegationTool<TParams extends z.ZodType>(
  moduleName: string,
  config: DelegationToolConfig<TParams>,
  coreContext: CoreContext
): ToolRegistration {
  const auth = new Authorization();

  return {
    name: config.name,
    description: config.description,
    schema: config.parameters as any,

    // Two-tier security: Visibility filtering
    canAccess: (mcpContext: MCPContext) => {
      // Must be authenticated
      if (!auth.isAuthenticated(mcpContext)) {
        return false;
      }

      // Check required roles (if specified)
      if (config.requiredRoles && config.requiredRoles.length > 0) {
        if (!auth.hasAnyRole(mcpContext, config.requiredRoles)) {
          return false;
        }
      }

      // Custom visibility check (if provided)
      if (config.canAccess) {
        return config.canAccess(mcpContext);
      }

      return true;
    },

    // Two-tier security: Execution enforcement
    handler: async (params: z.infer<TParams>, mcpContext: MCPContext): Promise<LLMResponse> => {
      try {
        // Require authentication
        auth.requireAuth(mcpContext);

        // Require roles (if specified)
        if (config.requiredRoles && config.requiredRoles.length > 0) {
          auth.requireAnyRole(mcpContext, config.requiredRoles);
        }

        // Transform parameters (if transformer provided)
        const delegationParams = config.transformParams
          ? config.transformParams(params, mcpContext.session)
          : params;

        // Delegate to module via DelegationRegistry
        const result = await coreContext.delegationRegistry.delegate(
          moduleName,
          mcpContext.session,
          config.action,
          delegationParams
        );

        // Check delegation result
        if (!result.success) {
          return {
            status: 'failure',
            code: 'DELEGATION_FAILED',
            message: result.error || `Delegation to ${moduleName} failed`,
          };
        }

        // Transform result (if transformer provided)
        const finalData = config.transformResult
          ? config.transformResult(result.data)
          : result.data;

        // Return success response
        return {
          status: 'success',
          data: finalData,
        };
      } catch (error) {
        // Security errors: Handle 401 and 403 with WWW-Authenticate headers
        if (error instanceof OAuthSecurityError || (error as any).code) {
          const secError = error as OAuthSecurityError;

          // For 403 errors, throw Response with WWW-Authenticate header (MCP spec compliant)
          if (secError.statusCode === 403) {
            // Extract required scopes from error details
            const requiredScopes = (secError.details?.requiredScopes as string[]) || [];
            const scopeString = requiredScopes.join(' ');

            // Get server URL for resource_metadata parameter
            const mcpConfig = coreContext.configManager.getMCPConfig();
            const mcpPort = mcpConfig?.port || 3000;
            const serverUrl = `http://localhost:${mcpPort}`;

            // Generate WWW-Authenticate header per MCP OAuth 2.1 spec
            const wwwAuthenticate = generateWWWAuthenticateHeader(
              coreContext,
              'MCP Server',
              scopeString, // Required scopes (e.g., "admin sql:write")
              undefined, // includeProtectedResource controlled by config
              serverUrl, // Server URL for resource_metadata parameter
              'insufficient_scope', // RFC 6750 error code
              secError.message // Human-readable error description
            );

            console.log('[DelegationToolFactory] ✓ Generated WWW-Authenticate for 403:', wwwAuthenticate);

            // Throw Response object with WWW-Authenticate header
            // mcp-proxy's handleResponseError() (startHTTPServer.ts:72-96) handles this
            const headers = new Headers();
            headers.set('Content-Type', 'application/json');
            headers.set('WWW-Authenticate', wwwAuthenticate);

            const responseBody = JSON.stringify({
              error: {
                code: -32000, // JSON-RPC application error
                message: secError.message,
              },
              id: null,
              jsonrpc: '2.0',
            });

            throw new Response(responseBody, {
              status: 403,
              statusText: 'Forbidden',
              headers,
            });
          }

          // For other security errors (e.g., 401), return as LLMResponse
          // Note: 401 errors are handled at middleware level, not in tool handlers
          return {
            status: 'failure',
            code: secError.code || 'INTERNAL_ERROR',
            message: secError.message,
          };
        }

        // Non-security errors: Mask technical details
        const errorResponse = await handleToolError(
          error,
          config.name,
          mcpContext,
          coreContext.auditService,
          params
        );
        return errorResponse;
      }
    },
  };
}

// ============================================================================
// Convenience Helpers
// ============================================================================

/**
 * Create multiple delegation tools at once
 *
 * Convenience function for creating multiple tools for the same delegation module.
 *
 * @param moduleName - Name of the delegation module
 * @param configs - Array of tool configurations
 * @param coreContext - CoreContext with all services
 * @returns Array of ToolRegistration objects
 *
 * @example
 * ```typescript
 * const tools = createDelegationTools('myapi', [
 *   {
 *     name: 'api-get',
 *     description: 'GET request to API',
 *     requiredPermission: 'api:read',
 *     action: 'get',
 *     parameters: z.object({ endpoint: z.string() })
 *   },
 *   {
 *     name: 'api-post',
 *     description: 'POST request to API',
 *     requiredPermission: 'api:write',
 *     action: 'post',
 *     parameters: z.object({ endpoint: z.string(), body: z.any() })
 *   }
 * ], coreContext);
 *
 * server.registerTools(tools);
 * ```
 */
export function createDelegationTools<TParams extends z.ZodType>(
  moduleName: string,
  configs: DelegationToolConfig<TParams>[],
  coreContext: CoreContext
): ToolRegistration[] {
  return configs.map((config) => createDelegationTool(moduleName, config, coreContext));
}
