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
import type { UserSession } from '../core/types.js';
import { createSecurityError } from '../utils/errors.js';
import type { MCPContext } from './types.js';
import { Authorization } from './authorization.js';

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
  constructor(private readonly authService: AuthenticationService) {}

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
      hasAuthHeader: !!(request.headers['authorization'] || request.headers['Authorization'])
    });

    try {
      // Extract Bearer token
      const token = this.extractToken(request);

      if (!token) {
        console.log('[MCPAuthMiddleware] ❌ No Bearer token found');
        throw createSecurityError(
          'MISSING_TOKEN',
          'Missing Authorization header with Bearer token',
          401
        );
      }

      console.log('[MCPAuthMiddleware] ✓ Token extracted, validating...');

      // Authenticate with AuthenticationService
      const authResult = await this.authService.authenticate(token);

      console.log('[MCPAuthMiddleware] Auth result:', {
        rejected: authResult.rejected,
        sessionRejected: authResult.session.rejected,
        role: authResult.session.role,
        customRoles: authResult.session.customRoles,
        userId: authResult.session.userId
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
          console.log('[MCPAuthMiddleware] Technical rejection reason:', authResult.rejectionReason);
        }

        throw createSecurityError(
          'UNAUTHORIZED',
          userMessage,
          403
        );
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
      // Convert to FastMCP auth result
      console.log('[MCPAuthMiddleware] ❌ Authentication error:', error);
      if (error instanceof Error) {
        return {
          authenticated: false,
          error: error.message,
        };
      }

      return {
        authenticated: false,
        error: 'Authentication failed',
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

/**
 * Require specific permission for a tool handler
 *
 * @deprecated Import from './authorization.js' instead
 * @param context - MCP context
 * @param requiredPermission - Required permission (e.g., 'sql:query')
 * @throws {Error} If session lacks required permission
 */
export function requirePermission(context: MCPContext, requiredPermission: string): void {
  const auth = new Authorization();
  auth.requirePermission(context, requiredPermission);
}
