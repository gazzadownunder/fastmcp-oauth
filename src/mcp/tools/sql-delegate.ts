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
import { requirePermission } from '../middleware.js';
import { OAuthSecurityError } from '../../utils/errors.js';

// ============================================================================
// Tool Schema
// ============================================================================

/**
 * SQL delegation parameters schema
 */
const sqlDelegateSchema = z.object({
  action: z.enum(['query', 'procedure', 'function']).describe('SQL operation type'),
  sql: z.string().optional().describe('SQL query string (for query action)'),
  procedure: z.string().optional().describe('Stored procedure name (for procedure action)'),
  functionName: z.string().optional().describe('Function name (for function action)'),
  params: z.record(z.any()).optional().describe('Parameters for query/procedure/function'),
  resource: z.string().optional().default('sql-database').describe('Resource identifier'),
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
    'Execute SQL operations (query, stored procedure, or function) on behalf of the authenticated user using their legacy Windows credentials. Requires sql:query, sql:procedure, or sql:function permission.',
  schema: sqlDelegateSchema,

  // Visibility filtering using canAccess (two-tier security)
  canAccess: (mcpContext: MCPContext) => {
    // Only show to authenticated users with sql permissions
    if (!mcpContext.session || mcpContext.session.rejected) {
      return false;
    }

    // Check if user has ANY sql permission (sql:query, sql:procedure, or sql:function)
    return mcpContext.session.permissions.some(p => p.startsWith('sql:'));
  },

  handler: async (params: SqlDelegateParams, mcpContext: MCPContext): Promise<LLMResponse> => {
    try {
      // Require appropriate permission based on action
      const requiredPermission = `sql:${params.action}`;
      requirePermission(mcpContext, requiredPermission);

      // Validate action-specific parameters
      if (params.action === 'query' && !params.sql) {
        return {
          status: 'failure',
          code: 'INVALID_INPUT',
          message: 'The "sql" parameter is required for query action',
        };
      }

      if (params.action === 'procedure' && !params.procedure) {
        return {
          status: 'failure',
          code: 'INVALID_INPUT',
          message: 'The "procedure" parameter is required for procedure action',
        };
      }

      if (params.action === 'function' && !params.functionName) {
        return {
          status: 'failure',
          code: 'INVALID_INPUT',
          message: 'The "functionName" parameter is required for function action',
        };
      }

      // Delegate to SQL module via DelegationRegistry
      const result = await context.delegationRegistry.delegate(
        'sql', // module name
        mcpContext.session, // authenticated session
        params.action, // delegation action
        {
          sql: params.sql,
          procedure: params.procedure,
          functionName: params.functionName,
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
      // MANDATORY (GAP #4): Catch ALL OAuthSecurityError and convert to LLMFailureResponse
      if (error instanceof OAuthSecurityError || (error as any).code) {
        const secError = error as OAuthSecurityError;
        return {
          status: 'failure',
          code: secError.code || 'INTERNAL_ERROR',
          message: secError.message,
        };
      }

      // Handle unexpected errors
      return {
        status: 'failure',
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'An unexpected error occurred',
      };
    }
  },
});
