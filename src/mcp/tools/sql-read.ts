/**
 * SQL Read Tool (Test Tool for Permission Visibility)
 *
 * A test tool that is only visible to users with the 'read' custom role.
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

const sqlReadSchema = z.object({
  testParam: z.string().optional().describe('Optional test parameter'),
});

type SQLReadParams = z.infer<typeof sqlReadSchema>;

// ============================================================================
// Tool Factory
// ============================================================================

/**
 * Create SQL Read tool with CoreContext dependency injection
 *
 * This is a test tool to verify role-based visibility filtering.
 * Only visible to users with 'read' in customRoles array OR 'write' role.
 */
export const createSQLReadTool: ToolFactory = (context: CoreContext) => ({
  name: 'SQL_Read',
  description: 'SQL Read operations (requires read or write permission)',
  schema: sqlReadSchema,

  // Visibility filtering: Only show to users with 'read' or 'write' role
  canAccess: (mcpContext: MCPContext) => {
    const auth = new Authorization();
    if (!auth.isAuthenticated(mcpContext)) {
      return false;
    }

    // Check if user has 'read' or 'write' role (either primary or custom)
    return auth.hasAnyRole(mcpContext, ['read', 'write']);
  },

  handler: async (params: SQLReadParams, mcpContext: MCPContext): Promise<LLMResponse> => {
    try {
      // Require authentication
      const auth = new Authorization();
      auth.requireAuth(mcpContext);

      const session = mcpContext.session;

      // Return test response
      return {
        status: 'success',
        data: {
          tool: 'SQL_Read',
          message: 'This tool is only visible to users with read or write permission',
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
