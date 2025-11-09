/**
 * MCP Authorization Helpers
 *
 * Provides role-based authorization checks (no static permissions).
 * Authorization is based on JWT roles, not server-side permission configuration.
 *
 * Usage Patterns:
 * 1. Hard checks (throw on failure) - Use in tool handlers:
 *    - requireAuth() - Ensures user is authenticated
 *    - requireRole() - Ensures user has specific role
 *    - requireAnyRole() - Ensures user has at least one of multiple roles
 *    - requireAllRoles() - Ensures user has all of multiple roles
 *
 * 2. Soft checks (return boolean) - Use in canAccess() implementations:
 *    - isAuthenticated() - Check if user is authenticated
 *    - hasRole() - Check if user has specific role
 *    - hasAnyRole() - Check if user has any of multiple roles
 *    - hasAllRoles() - Check if user has all of multiple roles
 *
 * @example Hard checks (tool handlers)
 * ```typescript
 * const auth = new Authorization();
 *
 * // Require authentication
 * auth.requireAuth(context);
 *
 * // Require specific role
 * auth.requireRole(context, 'admin');
 *
 * // Require any of multiple roles
 * auth.requireAnyRole(context, ['admin', 'user']);
 *
 * // Require all of multiple roles
 * auth.requireAllRoles(context, ['admin', 'auditor']);
 * ```
 *
 * @example Soft checks (canAccess implementations)
 * ```typescript
 * const auth = new Authorization();
 *
 * // Check authentication
 * if (!auth.isAuthenticated(context)) {
 *   return false;
 * }
 *
 * // Check role
 * if (auth.hasRole(context, 'admin')) {
 *   // Admin can do anything
 *   return true;
 * }
 *
 * // Check any of multiple roles
 * if (auth.hasAnyRole(context, ['user', 'guest'])) {
 *   return true;
 * }
 *
 * return false;
 * ```
 *
 * @see Phase 3 of refactor.md
 * @see Gap #4 in refactor-progress.md
 */

import { createSecurityError } from '../utils/errors.js';
import type { MCPContext } from './types.js';

// ============================================================================
// Authorization Class
// ============================================================================

/**
 * Authorization helper class for MCP tools
 *
 * Provides both soft (boolean) and hard (throwing) authorization checks
 * for use in tool handlers and canAccess implementations.
 */
export class Authorization {
  // ==========================================================================
  // Soft Checks (Return Boolean)
  // ==========================================================================

  /**
   * Check if session is authenticated
   *
   * @param context - MCP context
   * @returns True if session exists and is not rejected
   */
  isAuthenticated(context: MCPContext): boolean {
    return !!(context.session && !context.session.rejected);
  }

  /**
   * Check if session has specific role
   *
   * @param context - MCP context
   * @param role - Required role (e.g., 'admin', 'user')
   * @returns True if session has the role
   */
  hasRole(context: MCPContext, role: string): boolean {
    if (!this.isAuthenticated(context)) {
      return false;
    }

    return context.session.role === role;
  }

  /**
   * Check if session has any of the specified roles
   *
   * Useful for OR logic: "admin OR moderator OR user"
   *
   * @param context - MCP context
   * @param roles - Array of acceptable roles
   * @returns True if session has at least one of the roles
   *
   * @example
   * ```typescript
   * // Allow admin, moderator, or user
   * if (auth.hasAnyRole(context, ['admin', 'moderator', 'user'])) {
   *   return true;
   * }
   * ```
   */
  hasAnyRole(context: MCPContext, roles: string[]): boolean {
    if (!this.isAuthenticated(context)) {
      return false;
    }

    return roles.includes(context.session.role);
  }

  /**
   * Check if session has all of the specified roles
   *
   * Useful for AND logic with custom roles: "Must have admin AND auditor"
   *
   * @param context - MCP context
   * @param roles - Array of required roles
   * @returns True if session has all of the roles (checks both role and customRoles)
   *
   * @example
   * ```typescript
   * // Require both admin role AND auditor custom role
   * if (auth.hasAllRoles(context, ['admin', 'auditor'])) {
   *   return true;
   * }
   * ```
   */
  hasAllRoles(context: MCPContext, roles: string[]): boolean {
    if (!this.isAuthenticated(context)) {
      return false;
    }

    // Combine primary role with custom roles
    const allUserRoles = [context.session.role, ...(context.session.customRoles || [])];

    // Check if user has all required roles
    return roles.every((role) => allUserRoles.includes(role));
  }

  // ==========================================================================
  // Hard Checks (Throw on Failure)
  // ==========================================================================

  /**
   * Require authentication for a tool handler
   *
   * Throws an error if the session is not authenticated.
   *
   * @param context - MCP context
   * @throws {OAuthSecurityError} If session is rejected or missing
   */
  requireAuth(context: MCPContext): void {
    if (!this.isAuthenticated(context)) {
      throw createSecurityError(
        'UNAUTHENTICATED',
        'Authentication required to access this tool',
        401
      );
    }
  }

  /**
   * Require specific role for a tool handler
   *
   * Throws an error if the session does not have the required role.
   *
   * @param context - MCP context
   * @param requiredRole - Required role ('admin', 'user', etc.)
   * @throws {OAuthSecurityError} If session lacks required role
   */
  requireRole(context: MCPContext, requiredRole: string): void {
    this.requireAuth(context);

    if (context.session.role !== requiredRole) {
      throw createSecurityError(
        'INSUFFICIENT_PERMISSIONS',
        `This tool requires the '${requiredRole}' role. Your role: ${context.session.role}`,
        403
      );
    }
  }

  /**
   * Require any of the specified roles for a tool handler
   *
   * Throws an error if the session does not have at least one of the roles.
   *
   * @param context - MCP context
   * @param roles - Array of acceptable roles
   * @throws {OAuthSecurityError} If session lacks all required roles
   *
   * @example
   * ```typescript
   * // Require admin OR moderator
   * auth.requireAnyRole(context, ['admin', 'moderator']);
   * ```
   */
  requireAnyRole(context: MCPContext, roles: string[]): void {
    this.requireAuth(context);

    if (!this.hasAnyRole(context, roles)) {
      throw createSecurityError(
        'INSUFFICIENT_PERMISSIONS',
        `This tool requires one of these roles: ${roles.join(', ')}. Your role: ${context.session.role}`,
        403
      );
    }
  }

  /**
   * Require all of the specified roles for a tool handler
   *
   * Throws an error if the session does not have all of the roles.
   *
   * @param context - MCP context
   * @param roles - Array of required roles
   * @throws {OAuthSecurityError} If session lacks any required role
   *
   * @example
   * ```typescript
   * // Require both admin AND auditor custom role
   * auth.requireAllRoles(context, ['admin', 'auditor']);
   * ```
   */
  requireAllRoles(context: MCPContext, roles: string[]): void {
    this.requireAuth(context);

    if (!this.hasAllRoles(context, roles)) {
      const userRoles = [context.session.role, ...(context.session.customRoles || [])];
      throw createSecurityError(
        'INSUFFICIENT_PERMISSIONS',
        `This tool requires all of these roles: ${roles.join(', ')}. Your roles: ${userRoles.join(', ')}`,
        403
      );
    }
  }
}

// ============================================================================
// Standalone Helper Functions (Backward Compatibility)
// ============================================================================

/**
 * Require authentication for a tool handler
 *
 * @deprecated Use Authorization class instance methods instead
 * @param context - MCP context
 * @throws {OAuthSecurityError} If session is rejected
 */
export function requireAuth(context: MCPContext): void {
  const auth = new Authorization();
  auth.requireAuth(context);
}

/**
 * Require specific role for a tool handler
 *
 * @deprecated Use Authorization class instance methods instead
 * @param context - MCP context
 * @param requiredRole - Required role ('admin', 'user', etc.)
 * @throws {OAuthSecurityError} If session lacks required role
 */
export function requireRole(context: MCPContext, requiredRole: string): void {
  const auth = new Authorization();
  auth.requireRole(context, requiredRole);
}
