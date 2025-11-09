/**
 * REST API Tools Factory
 *
 * Creates REST API delegation tools for multiple API instances.
 * Allows defining tools with custom prefixes (e.g., API1, API2) for different REST APIs.
 *
 * Usage:
 * ```typescript
 * const api1Tools = createRESTAPIToolsForModule('api1', 'rest-api1');
 * const api2Tools = createRESTAPIToolsForModule('api2', 'rest-api2');
 * ```
 */

import { z } from 'zod';
import type { CoreContext } from '../../core/index.js';
import type { ToolFactory, LLMResponse, MCPContext } from '../types.js';
import { Authorization } from '../authorization.js';
import { OAuthSecurityError } from '../../utils/errors.js';
import { handleToolError } from '../utils/error-helpers.js';

/**
 * Configuration for REST API tools factory
 */
export interface RESTAPIToolsConfig {
  /** Tool name prefix (e.g., 'api1', 'api2') */
  toolPrefix: string;
  /** Delegation module name (e.g., 'rest-api1', 'rest-api2') */
  moduleName: string;
  /** Description suffix for tools (optional) */
  descriptionSuffix?: string;
}

/**
 * Create REST API delegation tool for a specific REST API module
 *
 * @param toolPrefix - Tool name prefix (e.g., 'api1', 'api2')
 * @param moduleName - Delegation module name (e.g., 'rest-api1', 'rest-api2')
 * @param descriptionSuffix - Optional suffix for tool descriptions
 * @returns Tool factory for rest-api-delegate tool
 */
export function createRESTAPIDelegateToolForModule(
  toolPrefix: string,
  moduleName: string,
  descriptionSuffix?: string
): ToolFactory {
  const restApiDelegateSchema = z.object({
    endpoint: z.string().describe('API endpoint path (e.g., "users/123/profile")'),
    method: z
      .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
      .default('POST')
      .describe('HTTP method'),
    data: z.record(z.any()).optional().describe('Request body data (for POST/PUT/PATCH)'),
    query: z.record(z.string()).optional().describe('Query parameters (for GET requests)'),
    headers: z.record(z.string()).optional().describe('Additional request headers'),
  });

  type RestApiDelegateParams = z.infer<typeof restApiDelegateSchema>;

  return (context: CoreContext) => ({
    name: `${toolPrefix}-delegate`,
    description: `Make HTTP requests to external REST API on behalf of the authenticated user. Supports GET, POST, PUT, PATCH, DELETE operations with token exchange authentication. Requires user or admin role.${descriptionSuffix ? ' ' + descriptionSuffix : ''}`,
    schema: restApiDelegateSchema,

    canAccess: (mcpContext: MCPContext) => {
      const auth = new Authorization();
      if (!auth.isAuthenticated(mcpContext)) {
        return false;
      }
      return auth.hasAnyRole(mcpContext, ['user', 'admin']);
    },

    handler: async (
      params: RestApiDelegateParams,
      mcpContext: MCPContext
    ): Promise<LLMResponse> => {
      try {
        const auth = new Authorization();
        auth.requireAnyRole(mcpContext, ['user', 'admin']);

        const result = await context.delegationRegistry.delegate(
          moduleName,
          mcpContext.session,
          'api-request',
          {
            endpoint: params.endpoint,
            method: params.method,
            data: params.data,
            query: params.query,
            headers: params.headers,
          },
          {
            sessionId: mcpContext.session.sessionId,
            coreContext: context,
          }
        );

        if (!result.success) {
          return {
            status: 'failure',
            code: 'DELEGATION_FAILED',
            message: result.error || 'REST API delegation failed',
          };
        }

        return {
          status: 'success',
          data: result.data,
        };
      } catch (error) {
        if (error instanceof OAuthSecurityError || (error as any).code) {
          const secError = error as OAuthSecurityError;
          return {
            status: 'failure',
            code: secError.code || 'INTERNAL_ERROR',
            message: secError.message,
          };
        }

        const errorResponse = await handleToolError(
          error,
          `${toolPrefix}-delegate`,
          mcpContext,
          context.auditService,
          params
        );
        return errorResponse;
      }
    },
  });
}

/**
 * Create REST API health check tool for a specific REST API module
 *
 * @param toolPrefix - Tool name prefix (e.g., 'api1', 'api2')
 * @param moduleName - Delegation module name (e.g., 'rest-api1', 'rest-api2')
 * @param descriptionSuffix - Optional suffix for tool descriptions
 * @returns Tool factory for rest-api-health tool
 */
export function createRESTAPIHealthToolForModule(
  toolPrefix: string,
  moduleName: string,
  descriptionSuffix?: string
): ToolFactory {
  const restApiHealthSchema = z.object({});

  type RestApiHealthParams = z.infer<typeof restApiHealthSchema>;

  return (context: CoreContext) => ({
    name: `${toolPrefix}-health`,
    description: `Check health status of the REST API backend. Returns connectivity status and response time. Requires user or admin role.${descriptionSuffix ? ' ' + descriptionSuffix : ''}`,
    schema: restApiHealthSchema,

    canAccess: (mcpContext: MCPContext) => {
      const auth = new Authorization();
      if (!auth.isAuthenticated(mcpContext)) {
        return false;
      }
      return auth.hasAnyRole(mcpContext, ['user', 'admin']);
    },

    handler: async (params: RestApiHealthParams, mcpContext: MCPContext): Promise<LLMResponse> => {
      try {
        const auth = new Authorization();
        auth.requireAnyRole(mcpContext, ['user', 'admin']);

        const delegationModule = context.delegationRegistry.get(moduleName);
        if (!delegationModule) {
          return {
            status: 'failure',
            code: 'MODULE_NOT_AVAILABLE',
            message: `REST API delegation module '${moduleName}' is not available`,
          };
        }

        const startTime = Date.now();
        const isHealthy = await delegationModule.healthCheck();
        const responseTime = Date.now() - startTime;

        return {
          status: 'success',
          data: {
            healthy: isHealthy,
            responseTime: `${responseTime}ms`,
            module: moduleName,
            status: isHealthy ? 'ok' : 'unavailable',
          },
        };
      } catch (error) {
        return handleToolError(
          error,
          `${toolPrefix}-health`,
          mcpContext,
          context.auditService,
          params
        );
      }
    },
  });
}

/**
 * Create all REST API tools for a specific REST API module
 *
 * @param config - REST API tools configuration
 * @returns Array of tool factories (delegate, health)
 *
 * @example
 * ```typescript
 * const api1Tools = createRESTAPIToolsForModule({
 *   toolPrefix: 'api1',
 *   moduleName: 'rest-api1',
 *   descriptionSuffix: '(Internal API)'
 * });
 *
 * const api2Tools = createRESTAPIToolsForModule({
 *   toolPrefix: 'api2',
 *   moduleName: 'rest-api2',
 *   descriptionSuffix: '(Partner API)'
 * });
 * ```
 */
export function createRESTAPIToolsForModule(config: RESTAPIToolsConfig): ToolFactory[] {
  return [
    createRESTAPIDelegateToolForModule(
      config.toolPrefix,
      config.moduleName,
      config.descriptionSuffix
    ),
    createRESTAPIHealthToolForModule(
      config.toolPrefix,
      config.moduleName,
      config.descriptionSuffix
    ),
  ];
}
