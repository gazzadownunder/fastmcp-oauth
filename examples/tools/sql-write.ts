/**
 * SQL Write Tool (Test Tool for Permission Visibility)
 *
 * A test tool that is only visible to users with the 'write' custom role.
 * This demonstrates role-based access control via canAccess filtering.
 *
 * @see Phase 3.5 of refactor.md
 */

import { z } from 'zod';
import type { CoreContext } from '../../core/index.js';
import type { ToolFactory, LLMResponse, MCPContext } from '../types.js';
import { Authorization } from '../authorization.js';

// ============================================================================
// Tool Schema
// ============================================================================

const sqlWriteSchema = z.object({
  testParam: z.string().optional().describe('Optional test parameter'),
});

type SQLWriteParams = z.infer<typeof sqlWriteSchema>;

// ============================================================================
// Tool Factory
// ============================================================================

/**
 * Create SQL Write tool with CoreContext dependency injection
 *
 * This is a test tool to verify role-based visibility filtering.
 * Only visible to users with 'write' in customRoles array.
 */
export const createSQLWriteTool: ToolFactory = (context: CoreContext) => ({
  name: 'SQL_Write',
  description: 'SQL Write operations (requires write permission)',
  schema: sqlWriteSchema,

  // Visibility filtering: Only show to users with 'write' custom role
  canAccess: (mcpContext: MCPContext) => {
    const auth = new Authorization();
    // Check if user has 'write' role (either primary or custom)
    return auth.hasRole(mcpContext, 'write');
  },

  handler: async (params: SQLWriteParams, mcpContext: MCPContext): Promise<LLMResponse> => {
    try {
      // Require authentication
      const auth = new Authorization();
      auth.requireAuth(mcpContext);

      const session = mcpContext.session;

      // Return test response
      return {
        status: 'success',
        data: {
          tool: 'SQL_Write',
          message: 'This tool is only visible to users with write permission',
          userId: session.userId,
          role: session.role,
          customRoles: session.customRoles,
        },
      };
    } catch (error) {
      return {
        status: 'failure',
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'An unexpected error occurred',
      };
    }
  },
});
