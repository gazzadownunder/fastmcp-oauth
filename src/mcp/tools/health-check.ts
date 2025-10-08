/**
 * Health Check Tool
 *
 * Checks delegation service health status.
 *
 * CRITICAL (GAP #4, #5, #12):
 * - All errors converted to LLMFailureResponse (GAP #4)
 * - Success returns LLMSuccessResponse (GAP #5)
 * - Uses ToolHandler<P,R> and MCPContext types (GAP #12)
 *
 * @see Phase 3.5 of refactor.md
 */

import { z } from 'zod';
import type { CoreContext } from '../../core/index.js';
import type { ToolFactory, LLMResponse, MCPContext } from '../types.js';
import { Authorization } from '../authorization.js';
import { OAuthSecurityError } from '../../utils/errors.js';
import { handleToolError } from '../utils/error-helpers.js';

// ============================================================================
// Tool Schema
// ============================================================================

/**
 * Health check parameters schema
 */
const healthCheckSchema = z.object({
  service: z
    .enum(['sql', 'kerberos', 'all'])
    .optional()
    .default('all')
    .describe('Service to check (sql, kerberos, or all)'),
});

type HealthCheckParams = z.infer<typeof healthCheckSchema>;

// ============================================================================
// Tool Factory
// ============================================================================

/**
 * Create health check tool with CoreContext dependency injection
 *
 * This is a ToolFactory that receives CoreContext and returns a ToolRegistration.
 *
 * @param context - CoreContext with all core services
 * @returns Tool registration for health-check tool
 *
 * @example
 * ```typescript
 * // In server setup:
 * const coreContext = await orchestrator.buildCoreContext();
 * const healthTool = createHealthCheckTool(coreContext);
 * mcpServer.addTool(healthTool);
 * ```
 */
export const createHealthCheckTool: ToolFactory = (context: CoreContext) => ({
  name: 'health-check',
  description:
    'Check delegation service health status. Requires authenticated user with user or admin role.',
  schema: healthCheckSchema,

  // Visibility filtering using canAccess (two-tier security)
  canAccess: (mcpContext: MCPContext) => {
    // Only show to authenticated users with user or admin role
    const auth = new Authorization();
    return auth.hasAnyRole(mcpContext, ['admin', 'user']);
  },

  handler: async (
    params: HealthCheckParams,
    mcpContext: MCPContext
  ): Promise<LLMResponse> => {
    try {
      // Require authentication
      const auth = new Authorization();
      auth.requireAuth(mcpContext);

      // Check all services (default to 'all' if not specified)
      if (!params.service || params.service === 'all') {
        const modules = context.delegationRegistry.list();
        const results: Record<string, boolean> = {};

        for (const module of modules) {
          results[module.name] = await module.healthCheck();
        }

        // MANDATORY (GAP #5): Return LLMSuccessResponse
        return {
          status: 'success',
          data: {
            healthy: Object.values(results).every((r) => r),
            modules: results,
            timestamp: new Date().toISOString(),
          },
        };
      }

      // Check specific service
      const module = context.delegationRegistry.get(params.service);
      if (!module) {
        return {
          status: 'failure',
          code: 'MODULE_NOT_FOUND',
          message: `Delegation module '${params.service}' not found or not registered`,
        };
      }

      const healthy = await module.healthCheck();

      // MANDATORY (GAP #5): Return LLMSuccessResponse
      return {
        status: 'success',
        data: {
          healthy,
          service: params.service,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      // SECURITY (SEC-3): Handle security and non-security errors differently
      if (error instanceof OAuthSecurityError || (error as any).code) {
        // Security error: Return specific error code for user guidance
        const secError = error as OAuthSecurityError;
        return {
          status: 'failure',
          code: secError.code || 'INTERNAL_ERROR',
          message: secError.message,
        };
      }

      // SECURITY (SEC-3): Non-security error - mask technical details
      // Logs full error to audit, returns generic message to client
      const errorResponse = await handleToolError(
        error,
        'health-check',
        mcpContext,
        context.auditService,
        params
      );
      return errorResponse;
    }
  },
});
