/**
 * User Info Tool
 *
 * Retrieves authenticated user session information.
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
import { requireAuth } from '../middleware.js';
import { OAuthSecurityError } from '../../utils/errors.js';
import { handleToolError } from '../utils/error-helpers.js';

// ============================================================================
// Tool Schema
// ============================================================================

/**
 * User info parameters schema
 */
const userInfoSchema = z.object({
  includeClaims: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include full JWT claims in response (sensitive fields will be sanitized)'),
});

type UserInfoParams = z.infer<typeof userInfoSchema>;

// ============================================================================
// Tool Factory
// ============================================================================

/**
 * Create user info tool with CoreContext dependency injection
 *
 * This is a ToolFactory that receives CoreContext and returns a ToolRegistration.
 *
 * @param context - CoreContext with all core services
 * @returns Tool registration for user-info tool
 *
 * @example
 * ```typescript
 * // In server setup:
 * const coreContext = await orchestrator.buildCoreContext();
 * const userInfoTool = createUserInfoTool(coreContext);
 * mcpServer.addTool(userInfoTool);
 * ```
 */
export const createUserInfoTool: ToolFactory = (context: CoreContext) => ({
  name: 'user-info',
  description:
    'Get current authenticated user session information including role, permissions, and optional JWT claims.',
  schema: userInfoSchema,

  // Visibility filtering using canAccess (two-tier security)
  // All authenticated users can see this tool
  canAccess: (mcpContext: MCPContext) => {
    return !!(mcpContext.session && !mcpContext.session.rejected);
  },

  handler: async (params: UserInfoParams, mcpContext: MCPContext): Promise<LLMResponse> => {
    try {
      // Require authentication
      requireAuth(mcpContext);

      const session = mcpContext.session;

      console.log('[user-info] Session object:', session);
      console.log('[user-info] Session keys:', Object.keys(session));

      // Build response
      const userInfo: Record<string, any> = {
        userId: session.userId,
        username: session.username,
        role: session.role,
        permissions: session.permissions,
        sessionVersion: session._version,
      };

      // Optional fields (only include if present)
      if (session.legacyUsername) {
        userInfo.legacyUsername = session.legacyUsername;
      }
      if (session.customRoles && session.customRoles.length > 0) {
        userInfo.customRoles = session.customRoles;
      }
      if (session.scopes && session.scopes.length > 0) {
        userInfo.scopes = session.scopes;
      }

      // Include claims if requested (but sanitize sensitive fields)
      if (params.includeClaims && session.claims) {
        const sanitizedClaims = { ...session.claims };

        // Remove sensitive fields
        delete sanitizedClaims.jti; // Remove token ID (prevents token replay attacks)
        delete sanitizedClaims.azp; // Remove authorized party (internal IDP info)

        userInfo.claims = sanitizedClaims;
      }

      // MANDATORY (GAP #5): Return LLMSuccessResponse
      return {
        status: 'success',
        data: userInfo,
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
        'user-info',
        mcpContext,
        context.auditService,
        params
      );
      return errorResponse;
    }
  },
});
