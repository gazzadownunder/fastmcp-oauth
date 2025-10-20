/**
 * SQL Delegation Tool
 *
 * Executes SQL operations on behalf of authenticated users using
 * the delegation module system.
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
 * SQL delegation parameters schema
 */
const sqlDelegateSchema = z.object({
  action: z.enum(['query']).describe('SQL operation type (PostgreSQL only supports query)'),
  sql: z.string().describe('SQL query string with positional parameters ($1, $2, etc.)'),
  params: z
    .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional()
    .describe('Array of parameter values (for PostgreSQL $1, $2, etc.)'),
  resource: z.string().optional().default('postgresql-database').describe('Resource identifier'),
});

type SqlDelegateParams = z.infer<typeof sqlDelegateSchema>;

// ============================================================================
// Tool Factory
// ============================================================================

/**
 * Create SQL delegation tool with CoreContext dependency injection
 *
 * This is a ToolFactory that receives CoreContext and returns a ToolRegistration.
 *
 * @param context - CoreContext with all core services
 * @returns Tool registration for sql-delegate tool
 *
 * @example
 * ```typescript
 * // In server setup:
 * const coreContext = await orchestrator.buildCoreContext();
 * const sqlTool = createSqlDelegateTool(coreContext);
 * mcpServer.addTool(sqlTool);
 * ```
 */
export const createSqlDelegateTool: ToolFactory = (context: CoreContext) => ({
  name: 'sql-delegate',
  description:
    'Execute PostgreSQL queries on behalf of the authenticated user using their delegated role. Use positional parameters ($1, $2, etc.). Requires user or admin role.',
  schema: sqlDelegateSchema,

  // Visibility filtering using canAccess (two-tier security)
  canAccess: (mcpContext: MCPContext) => {
    // Only show to authenticated users with user or admin role
    const auth = new Authorization();
    if (!auth.isAuthenticated(mcpContext)) {
      return false;
    }

    // Check if user has user or admin role from JWT
    return auth.hasAnyRole(mcpContext, ['user', 'admin']);
  },

  handler: async (params: SqlDelegateParams, mcpContext: MCPContext): Promise<LLMResponse> => {
    try {
      // Require user or admin role
      const auth = new Authorization();
      auth.requireAnyRole(mcpContext, ['user', 'admin']);

      // Validate action-specific parameters
      if (params.action === 'query' && !params.sql) {
        return {
          status: 'failure',
          code: 'INVALID_INPUT',
          message: 'The "sql" parameter is required for query action',
        };
      }

      // Delegate to PostgreSQL module via DelegationRegistry
      const result = await context.delegationRegistry.delegate(
        'postgresql', // module name
        mcpContext.session, // authenticated session
        params.action, // delegation action
        {
          sql: params.sql,
          params: params.params,
          resource: params.resource,
        }
      );

      // Check delegation result
      if (!result.success) {
        return {
          status: 'failure',
          code: 'DELEGATION_FAILED',
          message: result.error || 'SQL delegation failed',
        };
      }

      // MANDATORY (GAP #5): Return LLMSuccessResponse
      return {
        status: 'success',
        data: result.data,
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
        'sql-delegate',
        mcpContext,
        context.auditService,
        params
      );
      return errorResponse;
    }
  },
});
