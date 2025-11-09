/**
 * SQL Table Details Tool - Get table column information
 *
 * Returns detailed column information for a specific table.
 * Requires user or admin role.
 */

import { z } from 'zod';
import { Authorization } from '../authorization.js';
import type { MCPContext, ToolFactory, LLMResponse } from '../types.js';
import type { CoreContext } from '../../core/types.js';
import { handleToolError } from '../utils/error-helpers.js';

// ============================================================================
// Schema
// ============================================================================

const sqlTableDetailsSchema = z.object({
  tableName: z.string().min(1).describe('Table name to get details for'),
  schemaName: z.string().optional().default('public').describe('Schema name (default: public)'),
});

type SqlTableDetailsParams = z.infer<typeof sqlTableDetailsSchema>;

// ============================================================================
// Tool Factory
// ============================================================================

/**
 * SQL Table Details Tool - Get column information for a table
 *
 * @example
 * ```json
 * {
 *   "tableName": "users",
 *   "schemaName": "public"
 * }
 * ```
 *
 * @returns Column details (name, type, nullable, default)
 */
export const createSqlTableDetailsTool: ToolFactory = (context: CoreContext) => ({
  name: 'sql-table-details',
  description:
    'Get detailed column information for a specific table. Shows column names, data types, nullable status, and defaults. Requires user or admin role.',
  schema: sqlTableDetailsSchema,

  // Visibility filtering using canAccess
  canAccess: (mcpContext: MCPContext) => {
    const auth = new Authorization();
    if (!auth.isAuthenticated(mcpContext)) {
      return false;
    }

    // Check if user has user or admin role from JWT
    return auth.hasAnyRole(mcpContext, ['user', 'admin']);
  },

  handler: async (params: SqlTableDetailsParams, mcpContext: MCPContext): Promise<LLMResponse> => {
    try {
      console.log('[sql-table-details] Starting handler', {
        tableName: params.tableName,
        schemaName: params.schemaName,
      });

      // Require user or admin role
      const auth = new Authorization();
      auth.requireAnyRole(mcpContext, ['user', 'admin']);
      console.log('[sql-table-details] Authorization passed');

      // Get delegation module
      const delegationModule = context.delegationRegistry.get('postgresql');
      if (!delegationModule) {
        console.error('[sql-table-details] PostgreSQL delegation module not available');
        return {
          status: 'failure',
          code: 'MODULE_NOT_AVAILABLE',
          message: 'PostgreSQL delegation module is not available',
        };
      }
      console.log('[sql-table-details] Got PostgreSQL delegation module');

      // Delegate table details query
      console.log(
        '[sql-table-details] Calling delegationModule.delegate with action: table-details'
      );
      const result = await delegationModule.delegate(
        mcpContext.session,
        'table-details',
        {
          tableName: params.tableName,
          schemaName: params.schemaName,
        },
        {
          sessionId: mcpContext.session.sessionId,
          coreContext: context, // Pass CoreContext for TokenExchangeService access
        }
      );
      console.log('[sql-table-details] Delegation result:', {
        success: result.success,
        dataLength: result.data
          ? Array.isArray(result.data)
            ? result.data.length
            : 'not-array'
          : 'no-data',
      });

      if (!result.success) {
        console.error('[sql-table-details] Delegation failed:', result.error);
        return {
          status: 'failure',
          code: 'DELEGATION_ERROR',
          message: result.error || 'Table details query failed',
        };
      }

      // Format response
      const columns = result.data as Array<{
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_default: string | null;
        character_maximum_length: number | null;
      }>;

      console.log('[sql-table-details] Formatting response with', columns.length, 'columns');

      return {
        status: 'success',
        data: {
          table: params.tableName,
          schema: params.schemaName,
          columnCount: columns.length,
          columns: columns.map((c) => ({
            name: c.column_name,
            type: c.data_type,
            nullable: c.is_nullable === 'YES',
            default: c.column_default,
            maxLength: c.character_maximum_length,
          })),
        },
      };
    } catch (error) {
      console.error('[sql-table-details] Caught error:', error);
      return handleToolError(error, 'sql-table-details', mcpContext, context.auditService, params);
    }
  },
});
