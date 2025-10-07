/**
 * MCP Authorization Helpers
 *
 * Provides both soft (boolean) and hard (throwing) authorization checks.
 *
 * Usage Patterns:
 * 1. Hard checks (throw on failure) - Use in tool handlers:
 *    - requireAuth() - Ensures user is authenticated
 *    - requireRole() - Ensures user has specific role
 *    - requireAnyRole() - Ensures user has at least one of multiple roles
 *    - requirePermission() - Ensures user has specific permission
 *
 * 2. Soft checks (return boolean) - Use in canAccess() implementations:
 *    - isAuthenticated() - Check if user is authenticated
 *    - hasRole() - Check if user has specific role
 *    - hasAnyRole() - Check if user has any of multiple roles
 *    - hasAllRoles() - Check if user has all of multiple roles
 *    - hasPermission() - Check if user has specific permission
 *    - hasAnyPermission() - Check if user has any of multiple permissions
 *    - hasAllPermissions() - Check if user has all of multiple permissions
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
 * auth.requireAnyRole(context, ['admin', 'moderator']);
 *
 * // Require specific permission
 * auth.requirePermission(context, 'sql:query');
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
 *   // Regular users can read
 *   return action === 'read';
 * }
 *
 * // Check permission
 * if (auth.hasPermission(context, 'sql:query')) {
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
    const allUserRoles = [
      context.session.role,
      ...(context.session.customRoles || [])
    ];

    // Check if user has all required roles
    return roles.every(role => allUserRoles.includes(role));
  }

  /**
   * Check if session has specific permission
   *
   * @param context - MCP context
   * @param permission - Required permission (e.g., 'sql:query')
   * @returns True if session has the permission
   */
  hasPermission(context: MCPContext, permission: string): boolean {
    if (!this.isAuthenticated(context)) {
      return false;
    }

    return context.session.permissions.includes(permission);
  }

  /**
   * Check if session has any of the specified permissions
   *
   * Useful for OR logic: "sql:query OR sql:execute OR sql:admin"
   *
   * @param context - MCP context
   * @param permissions - Array of acceptable permissions
   * @returns True if session has at least one of the permissions
   *
   * @example
   * ```typescript
   * // Allow if user has any SQL permission
   * if (auth.hasAnyPermission(context, ['sql:query', 'sql:execute', 'sql:admin'])) {
   *   return true;
   * }
   * ```
   */
  hasAnyPermission(context: MCPContext, permissions: string[]): boolean {
    if (!this.isAuthenticated(context)) {
      return false;
    }

    return permissions.some(permission =>
      context.session.permissions.includes(permission)
    );
  }

  /**
   * Check if session has all of the specified permissions
   *
   * Useful for AND logic: "sql:query AND sql:execute"
   *
   * @param context - MCP context
   * @param permissions - Array of required permissions
   * @returns True if session has all of the permissions
   *
   * @example
   * ```typescript
   * // Require both read and write permissions
   * if (auth.hasAllPermissions(context, ['sql:query', 'sql:execute'])) {
   *   return true;
   * }
   * ```
   */
  hasAllPermissions(context: MCPContext, permissions: string[]): boolean {
    if (!this.isAuthenticated(context)) {
      return false;
    }

    return permissions.every(permission =>
      context.session.permissions.includes(permission)
    );
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
      const userRoles = [
        context.session.role,
        ...(context.session.customRoles || [])
      ];
      throw createSecurityError(
        'INSUFFICIENT_PERMISSIONS',
        `This tool requires all of these roles: ${roles.join(', ')}. Your roles: ${userRoles.join(', ')}`,
        403
      );
    }
  }

  /**
   * Require specific permission for a tool handler
   *
   * Throws an error if the session does not have the required permission.
   *
   * @param context - MCP context
   * @param requiredPermission - Required permission (e.g., 'sql:query')
   * @throws {OAuthSecurityError} If session lacks required permission
   */
  requirePermission(context: MCPContext, requiredPermission: string): void {
    this.requireAuth(context);

    if (!context.session.permissions.includes(requiredPermission)) {
      throw createSecurityError(
        'INSUFFICIENT_PERMISSIONS',
        `This tool requires the '${requiredPermission}' permission. Your permissions: ${context.session.permissions.join(', ')}`,
        403
      );
    }
  }

  /**
   * Require any of the specified permissions for a tool handler
   *
   * Throws an error if the session does not have at least one of the permissions.
   *
   * @param context - MCP context
   * @param permissions - Array of acceptable permissions
   * @throws {OAuthSecurityError} If session lacks all permissions
   *
   * @example
   * ```typescript
   * // Require any SQL permission
   * auth.requireAnyPermission(context, ['sql:query', 'sql:execute', 'sql:admin']);
   * ```
   */
  requireAnyPermission(context: MCPContext, permissions: string[]): void {
    this.requireAuth(context);

    if (!this.hasAnyPermission(context, permissions)) {
      throw createSecurityError(
        'INSUFFICIENT_PERMISSIONS',
        `This tool requires one of these permissions: ${permissions.join(', ')}. Your permissions: ${context.session.permissions.join(', ')}`,
        403
      );
    }
  }

  /**
   * Require all of the specified permissions for a tool handler
   *
   * Throws an error if the session does not have all of the permissions.
   *
   * @param context - MCP context
   * @param permissions - Array of required permissions
   * @throws {OAuthSecurityError} If session lacks any permission
   *
   * @example
   * ```typescript
   * // Require both read and write permissions
   * auth.requireAllPermissions(context, ['sql:query', 'sql:execute']);
   * ```
   */
  requireAllPermissions(context: MCPContext, permissions: string[]): void {
    this.requireAuth(context);

    if (!this.hasAllPermissions(context, permissions)) {
      throw createSecurityError(
        'INSUFFICIENT_PERMISSIONS',
        `This tool requires all of these permissions: ${permissions.join(', ')}. Your permissions: ${context.session.permissions.join(', ')}`,
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

/**
 * Require specific permission for a tool handler
 *
 * @deprecated Use Authorization class instance methods instead
 * @param context - MCP context
 * @param requiredPermission - Required permission (e.g., 'sql:query')
 * @throws {OAuthSecurityError} If session lacks required permission
 */
export function requirePermission(context: MCPContext, requiredPermission: string): void {
  const auth = new Authorization();
  auth.requirePermission(context, requiredPermission);
}
