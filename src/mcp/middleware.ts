/**
 * MCP Authentication Middleware
 *
 * Handles OAuth authentication for MCP requests with dual rejection checks.
 *
 * CRITICAL SECURITY (GAP #1):
 * - Performs dual rejection checks (authResult.rejected AND session.rejected)
 * - Prevents timing attacks by checking both fields
 *
 * @see Phase 3.3 of refactor.md
 */

import type { AuthenticationService } from '../core/authentication-service.js';
import type { UserSession, CoreContext } from '../core/types.js';
import { createSecurityError, OAuthSecurityError } from '../utils/errors.js';
import type { MCPContext } from './types.js';
import { Authorization } from './authorization.js';
import { generateWWWAuthenticateHeader } from './oauth-metadata.js';

// ============================================================================
// FastMCP Request Context (Placeholder)
// ============================================================================

/**
 * FastMCP request context
 *
 * TODO: Replace with actual FastMCP types when available
 */
export interface FastMCPRequest {
  headers: Record<string, string | string[] | undefined>;
  method?: string;
  path?: string;
}

/**
 * FastMCP authentication result
 */
export interface FastMCPAuthResult {
  authenticated: boolean;
  session?: UserSession;
  error?: string;
  statusCode?: number; // HTTP status code for error responses
  wwwAuthenticate?: string; // WWW-Authenticate header value for 401 responses
}

// ============================================================================
// MCP Authentication Middleware
// ============================================================================

/**
 * MCP Authentication Middleware
 *
 * Authenticates incoming MCP requests using Bearer tokens.
 *
 * Features:
 * - Extracts Bearer token from Authorization header
 * - Validates token using AuthenticationService
 * - Performs dual rejection checks (GAP #1)
 * - Returns FastMCP-compatible authentication result
 *
 * @example
 * ```typescript
 * const middleware = new MCPAuthMiddleware(authService);
 * const authResult = await middleware.authenticate(request);
 *
 * if (!authResult.authenticated) {
 *   throw new Error(authResult.error);
 * }
 *
 * // Use authenticated session
 * const session = authResult.session;
 * ```
 */
export class MCPAuthMiddleware {
  constructor(
    private readonly authService: AuthenticationService,
    private readonly coreContext?: CoreContext
  ) {}

  /**
   * Authenticate a FastMCP request
   *
   * @param request - FastMCP request with Authorization header
   * @returns Authentication result with session if successful
   * @throws {OAuthSecurityError} If authentication fails or session is rejected
   */
  async authenticate(request: FastMCPRequest): Promise<FastMCPAuthResult> {
    console.log('[MCPAuthMiddleware] Authenticating request:', {
      method: request.method,
      path: request.path,
      hasAuthHeader: !!(request.headers['authorization'] || request.headers['Authorization']),
    });

    try {
      // Extract Bearer token
      const token = this.extractToken(request);

      if (!token) {
        console.log('[MCPAuthMiddleware] ❌ No Bearer token found');
        throw createSecurityError(
          'MISSING_TOKEN',
          'Unauthorized: Missing Authorization header with Bearer token',
          401
        );
      }

      console.log('[MCPAuthMiddleware] ✓ Token extracted, validating...');

      // Authenticate with AuthenticationService
      // CRITICAL: Always use "requestor-jwt" IDP for middleware authentication
      // This ensures the correct IDP is used when JWT has multiple audiences
      const authResult = await this.authService.authenticate(token, {
        idpName: 'requestor-jwt',
      });

      console.log('[MCPAuthMiddleware] Auth result:', {
        rejected: authResult.rejected,
        sessionRejected: authResult.session.rejected,
        role: authResult.session.role,
        customRoles: authResult.session.customRoles,
        userId: authResult.session.userId,
      });

      // CRITICAL (GAP #1): Dual rejection check
      // Check 1: authResult.rejected (from AuthenticationService)
      if (authResult.rejected) {
        console.log('[MCPAuthMiddleware] ❌ Auth result rejected:', authResult.rejectionReason);

        // Translate technical role mapping errors to user-friendly authorization errors
        // Note: Must include "Unauthorized" keyword for mcp-proxy to detect as auth error
        let userMessage = 'Unauthorized: User has no valid roles assigned';

        // Log technical details for debugging
        if (authResult.rejectionReason) {
          console.log(
            '[MCPAuthMiddleware] Technical rejection reason:',
            authResult.rejectionReason
          );
        }

        throw createSecurityError('UNAUTHORIZED', userMessage, 403);
      }

      // Check 2: session.rejected (from UserSession)
      // This prevents timing attacks by ensuring both rejection flags are checked
      if (authResult.session.rejected) {
        console.log('[MCPAuthMiddleware] ❌ Session rejected - unassigned role');
        throw createSecurityError(
          'UNAUTHORIZED',
          'Unauthorized: User has no valid roles assigned',
          403
        );
      }

      // Authentication successful
      console.log('[MCPAuthMiddleware] ✓ Authentication successful');
      return {
        authenticated: true,
        session: authResult.session,
      };
    } catch (error) {
      // Generate WWW-Authenticate header for 401 responses
      let wwwAuthenticate: string | undefined;
      if (this.coreContext && error instanceof OAuthSecurityError && error.statusCode === 401) {
        try {
          wwwAuthenticate = generateWWWAuthenticateHeader(
            this.coreContext,
            'MCP Server',
            undefined // TODO: Extract required scopes from error
          );
        } catch (headerError) {
          console.error(
            '[MCPAuthMiddleware] Failed to generate WWW-Authenticate header:',
            headerError
          );
          // Fallback to basic header if generation fails
          wwwAuthenticate = 'Bearer realm="MCP Server"';
        }
      }

      // Convert to FastMCP auth result with statusCode and WWW-Authenticate header
      if (error instanceof OAuthSecurityError) {
        console.log(
          '[MCPAuthMiddleware] ❌ Authentication error (statusCode: ' + error.statusCode + '):',
          error.message
        );
        return {
          authenticated: false,
          error: error.message,
          statusCode: error.statusCode,
          wwwAuthenticate: wwwAuthenticate,
        };
      }

      // For unknown errors, convert to FastMCP auth result
      console.log('[MCPAuthMiddleware] ❌ Unknown authentication error:', error);
      if (error instanceof Error) {
        return {
          authenticated: false,
          error: error.message,
          statusCode: 500,
        };
      }

      return {
        authenticated: false,
        error: 'Authentication failed',
        statusCode: 500,
      };
    }
  }

  /**
   * Extract Bearer token from Authorization header
   *
   * @param request - FastMCP request
   * @returns Bearer token or null if not found
   *
   * @example
   * Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...
   * Returns: eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...
   */
  private extractToken(request: FastMCPRequest): string | null {
    const authHeader = request.headers['authorization'] || request.headers['Authorization'];

    if (!authHeader) {
      return null;
    }

    // Handle array of values (take first)
    const headerValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;

    if (!headerValue) {
      return null;
    }

    // Extract Bearer token
    const bearerMatch = /^Bearer\s+(.+)$/i.exec(headerValue);
    if (!bearerMatch) {
      return null;
    }

    return bearerMatch[1];
  }

  /**
   * Create MCP context from authenticated session
   *
   * Helper method to convert FastMCP auth result to MCPContext.
   *
   * @param authResult - Authentication result
   * @returns MCP context with session
   * @throws {Error} If authentication failed
   */
  createContext(authResult: FastMCPAuthResult): MCPContext {
    if (!authResult.authenticated || !authResult.session) {
      throw new Error(authResult.error || 'Authentication required');
    }

    return {
      session: authResult.session,
    };
  }
}

// ============================================================================
// Helper Functions (Backward Compatibility)
// ============================================================================

/**
 * Require authentication for a tool handler
 *
 * @deprecated Import from './authorization.js' instead
 * @param context - MCP context
 * @throws {Error} If session is rejected
 */
export function requireAuth(context: MCPContext): void {
  const auth = new Authorization();
  auth.requireAuth(context);
}

/**
 * Require specific role for a tool handler
 *
 * @deprecated Import from './authorization.js' instead
 * @param context - MCP context
 * @param requiredRole - Required role ('admin', 'user', etc.)
 * @throws {Error} If session lacks required role
 */
export function requireRole(context: MCPContext, requiredRole: string): void {
  const auth = new Authorization();
  auth.requireRole(context, requiredRole);
}
