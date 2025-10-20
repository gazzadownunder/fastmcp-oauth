/**
 * Kerberos Delegation MCP Tool
 *
 * Provides MCP tools for Kerberos Constrained Delegation (S4U2Self/S4U2Proxy).
 * Enables obtaining Kerberos tickets on behalf of users for legacy Windows authentication.
 *
 * @module mcp/tools/kerberos-delegate
 */

import { z } from 'zod';
import type { CoreContext } from '../../core/types.js';
import type { ToolFactory, LLMResponse, MCPContext } from '../types.js';
import { Authorization } from '../authorization.js';
import { OAuthSecurityError } from '../../utils/errors.js';
import { handleToolError } from '../utils/error-helpers.js';

// ============================================================================
// Tool Schemas
// ============================================================================

/**
 * Kerberos delegation tool parameter schema
 */
const KerberosDelegateSchema = z.object({
  action: z
    .enum(['obtain-ticket', 's4u2self', 's4u2proxy'])
    .describe('Delegation action to perform'),
  targetSPN: z
    .string()
    .optional()
    .describe(
      'Target service principal name (required for s4u2proxy, e.g., cifs/192.168.1.25, HOST/fileserver.w25ad.net)'
    ),
  resource: z.string().optional().default('kerberos').describe('Resource identifier'),
});

type KerberosDelegateParams = z.infer<typeof KerberosDelegateSchema>;

// ============================================================================
// Tool Factory
// ============================================================================

/**
 * Create Kerberos delegation MCP tool
 *
 * Provides access to Kerberos Constrained Delegation features:
 * - S4U2Self: Obtain ticket on behalf of user
 * - S4U2Proxy: Delegate to backend services
 *
 * Requires:
 * - User authentication (bearer token)
 * - legacy_username claim in JWT
 * - Kerberos module enabled in configuration
 *
 * @param context - Core context with delegation registry
 * @returns MCP tool definition
 *
 * @example
 * ```typescript
 * // Register tool
 * const tool = createKerberosDelegateTool(context);
 * mcp.addTool(tool);
 *
 * // Client usage - Obtain ticket (S4U2Self)
 * POST /mcp
 * {
 *   "method": "tools/call",
 *   "params": {
 *     "name": "kerberos-delegate",
 *     "arguments": {
 *       "action": "s4u2self"
 *     }
 *   }
 * }
 *
 * // Client usage - Delegate to file server (S4U2Proxy)
 * POST /mcp
 * {
 *   "method": "tools/call",
 *   "params": {
 *     "name": "kerberos-delegate",
 *     "arguments": {
 *       "action": "s4u2proxy",
 *       "targetSPN": "cifs/192.168.1.25"
 *     }
 *   }
 * }
 * ```
 */
export const createKerberosDelegateTool: ToolFactory = (context: CoreContext) => ({
  name: 'kerberos-delegate',
  description:
    'Obtain Kerberos tickets on behalf of users for legacy Windows authentication. ' +
    'Supports S4U2Self (obtain user ticket) and S4U2Proxy (delegate to backend services like file servers).',
  schema: KerberosDelegateSchema,

  // Visibility filtering using canAccess
  canAccess: (mcpContext: MCPContext) => {
    const auth = new Authorization();
    // Only show to authenticated users
    // Note: We do NOT check if Kerberos module is registered here because
    // modules are registered AFTER tools during server startup
    return auth.isAuthenticated(mcpContext);
  },

  handler: async (params: KerberosDelegateParams, mcpContext: MCPContext): Promise<LLMResponse> => {
    try {
      // DEBUG: Log incoming request
      console.log('\n[KERBEROS-DELEGATE] Tool called');
      console.log('[KERBEROS-DELEGATE] Parameters:', JSON.stringify(params, null, 2));
      console.log('[KERBEROS-DELEGATE] Session:', {
        userId: mcpContext.session?.userId,
        legacyUsername: mcpContext.session?.legacyUsername,
        roles: mcpContext.session?.roles,
      });

      // Require authentication
      const auth = new Authorization();
      auth.requireAuth(mcpContext);

      // NOTE: We do NOT check for legacy_username in requestor JWT here
      // The KerberosDelegationModule will perform token exchange to obtain
      // a delegation JWT containing the legacy_name claim

      // Validate action-specific requirements
      if (params.action === 's4u2proxy' && !params.targetSPN) {
        console.error('[KERBEROS-DELEGATE] Missing targetSPN for s4u2proxy');
        return {
          status: 'failure',
          code: 'INVALID_INPUT',
          message: 'The "targetSPN" parameter is required for s4u2proxy action',
        };
      }

      // Check if Kerberos module is registered
      if (!context.delegationRegistry) {
        console.error('[KERBEROS-DELEGATE] Delegation registry not available');
        return {
          status: 'failure',
          code: 'MODULE_NOT_FOUND',
          message: 'Delegation registry not available',
        };
      }

      const kerberosModule = context.delegationRegistry.getModule('kerberos');
      if (!kerberosModule) {
        console.error('[KERBEROS-DELEGATE] Kerberos module not registered');
        return {
          status: 'failure',
          code: 'MODULE_NOT_FOUND',
          message:
            'Kerberos delegation module not available. ' +
            'Ensure kerberos.enabled=true in configuration and module initialized successfully.',
        };
      }

      console.log('[KERBEROS-DELEGATE] Calling delegation registry with action:', params.action);

      // Build user principal from legacy_username and realm
      const realm = (kerberosModule as any).config?.realm || 'UNKNOWN';
      const userPrincipal = `${mcpContext.session.legacyUsername}@${realm}`;

      console.log('[KERBEROS-DELEGATE] User principal:', userPrincipal);
      console.log('[KERBEROS-DELEGATE] Target SPN:', params.targetSPN || 'N/A');

      // Call delegation module
      const result = await kerberosModule.delegate(mcpContext.session, params.action, {
        userPrincipal,
        targetSPN: params.targetSPN,
        resource: params.resource,
      });

      console.log('[KERBEROS-DELEGATE] Delegation result:', {
        success: result.success,
        hasData: !!result.data,
        error: result.error,
      });

      // Check delegation result
      if (!result.success) {
        console.error('[KERBEROS-DELEGATE] Delegation failed:', result.error);
        return {
          status: 'failure',
          code: 'DELEGATION_FAILED',
          message: result.error || 'Kerberos delegation failed',
        };
      }

      // Extract ticket data from result
      const ticketData: any = result.data;

      console.log('[KERBEROS-DELEGATE] Ticket data:', {
        hasTicket: !!ticketData?.ticket,
        cached: ticketData?.cached,
        principal: ticketData?.ticket?.principal,
        expiresAt: ticketData?.ticket?.expiresAt,
      });

      // Build response
      const response: any = {
        success: true,
        action: params.action,
        userPrincipal,
        legacyUsername: mcpContext.session.legacyUsername,
        realm,
        cached: ticketData?.cached ?? false,
      };

      // Add ticket information
      if (ticketData?.ticket) {
        response.ticket = {
          principal: ticketData.ticket.principal,
          service: ticketData.ticket.service,
          expiresAt: ticketData.ticket.expiresAt,
          flags: ticketData.ticket.flags,
        };

        // Add target info for S4U2Proxy
        if (ticketData.ticket.targetService) {
          response.ticket.targetService = ticketData.ticket.targetService;
          response.ticket.delegatedFrom = ticketData.ticket.delegatedFrom;
          response.targetSPN = params.targetSPN;
        }
      }

      console.log('[KERBEROS-DELEGATE] Success - returning response');

      // Log success to audit
      context.auditService?.log({
        timestamp: new Date(),
        userId: mcpContext.session.userId,
        action: 'kerberos-delegate',
        resource: params.targetSPN || 'user-ticket',
        success: true,
        metadata: {
          delegationAction: params.action,
          userPrincipal,
          cached: response.cached,
        },
      });

      // MANDATORY: Return LLMSuccessResponse
      return {
        status: 'success',
        data: response,
      };
    } catch (error) {
      console.error('[KERBEROS-DELEGATE] Error:', error);

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
        'kerberos-delegate',
        mcpContext,
        context.auditService,
        params
      );
      return errorResponse;
    }
  },
});
