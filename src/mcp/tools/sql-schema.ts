/**
 * SQL Schema Tool - Get database schema (tables list)
 *
 * Returns list of tables in the database schema.
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

const sqlSchemaSchema = z.object({
  schemaName: z.string().optional().default('public').describe('Schema name (default: public)'),
});

type SqlSchemaParams = z.infer<typeof sqlSchemaSchema>;

// ============================================================================
// Tool Factory
// ============================================================================

/**
 * SQL Schema Tool - Get list of tables in schema
 *
 * @example
 * ```json
 * {
 *   "schemaName": "public"
 * }
 * ```
 *
 * @returns List of tables with their types
 */
export const createSqlSchemaTool: ToolFactory = (context: CoreContext) => ({
  name: 'sql-schema',
  description:
    'Get list of tables in the database schema. Shows table names and types (BASE TABLE, VIEW, etc.). Requires user or admin role.',
  schema: sqlSchemaSchema,

  // Visibility filtering using canAccess
  canAccess: (mcpContext: MCPContext) => {
    const auth = new Authorization();
    if (!auth.isAuthenticated(mcpContext)) {
      return false;
    }

    // Check if user has user or admin role from JWT
    return auth.hasAnyRole(mcpContext, ['user', 'admin']);
  },

  handler: async (params: SqlSchemaParams, mcpContext: MCPContext): Promise<LLMResponse> => {
    try {
      console.log('[sql-schema] Starting handler', { schemaName: params.schemaName });

      // Require user or admin role
      const auth = new Authorization();
      auth.requireAnyRole(mcpContext, ['user', 'admin']);
      console.log('[sql-schema] Authorization passed');

      // Get delegation module
      const delegationModule = context.delegationRegistry.get('postgresql');
      if (!delegationModule) {
        console.error('[sql-schema] PostgreSQL delegation module not available');
        return {
          status: 'failure',
          code: 'MODULE_NOT_AVAILABLE',
          message: 'PostgreSQL delegation module is not available',
        };
      }
      console.log('[sql-schema] Got PostgreSQL delegation module');

      // Delegate schema query
      console.log(
        '[sql-schema] VERSION: Phase2-Fix-2025-01-06-v3 - Passing CoreContext to delegate()'
      );
      console.log('[sql-schema] DEBUG: context type:', typeof context);
      console.log('[sql-schema] DEBUG: context keys:', Object.keys(context));
      console.log('[sql-schema] DEBUG: has tokenExchangeService?', !!context.tokenExchangeService);
      console.log(
        '[sql-schema] DEBUG: tokenExchangeService type:',
        typeof context.tokenExchangeService
      );
      console.log('[sql-schema] Calling delegationModule.delegate with action: schema');

      const result = await delegationModule.delegate(
        mcpContext.session,
        'schema',
        { schemaName: params.schemaName },
        {
          sessionId: mcpContext.session.sessionId,
          coreContext: context, // Pass CoreContext for TokenExchangeService access
        }
      );
      console.log('[sql-schema] Delegation result:', {
        success: result.success,
        dataLength: result.data
          ? Array.isArray(result.data)
            ? result.data.length
            : 'not-array'
          : 'no-data',
      });

      if (!result.success) {
        console.error('[sql-schema] Delegation failed:', result.error);
        return {
          status: 'failure',
          code: 'DELEGATION_ERROR',
          message: result.error || 'Schema query failed',
        };
      }

      // Format response
      const tables = result.data as Array<{ table_name: string; table_type: string }>;
      console.log('[sql-schema] Formatting response with', tables.length, 'tables');

      return {
        status: 'success',
        data: {
          schema: params.schemaName,
          tableCount: tables.length,
          tables: tables.map((t) => ({
            name: t.table_name,
            type: t.table_type,
          })),
        },
      };
    } catch (error) {
      console.error('[sql-schema] Caught error:', error);
      return handleToolError(error, 'sql-schema', mcpContext, context.auditService, params);
    }
  },
});
