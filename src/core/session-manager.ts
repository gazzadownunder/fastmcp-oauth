/**
 * Session Manager - Session Creation and Migration
 *
 * This module manages UserSession creation and migration with critical safety policies:
 * - UNASSIGNED_ROLE sessions MUST have empty permissions array (GAP #2)
 * - Support version-based migration for backward compatibility (GAP #6)
 * - Track rejection status for audit trail (GAP #1)
 *
 * @see Phase 1.6 of refactor.md
 */

import {
  UNASSIGNED_ROLE,
  ROLE_ADMIN,
  ROLE_USER,
  ROLE_GUEST,
} from './types.js';
import type { UserSession, RoleMapperResult } from './types.js';

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * JWT payload interface for session creation
 */
export interface JWTPayload {
  sub: string; // User ID
  username?: string;
  preferred_username?: string;
  legacy_sam_account?: string;
  roles?: string[];
  scopes?: string | string[];
  [key: string]: any; // Additional claims
}

/**
 * Permission mapping configuration
 */
export interface PermissionConfig {
  /** Permissions for admin role */
  adminPermissions?: string[];

  /** Permissions for user role */
  userPermissions?: string[];

  /** Permissions for guest role */
  guestPermissions?: string[];

  /** Custom role to permissions mapping */
  customPermissions?: Record<string, string[]>;
}

// ============================================================================
// Session Manager Class
// ============================================================================

/**
 * Session Manager - Creates and migrates user sessions
 *
 * CRITICAL SAFETY POLICIES:
 * - UNASSIGNED_ROLE sessions MUST have [] permissions (GAP #2)
 * - Runtime assertion enforced on session creation
 * - Version-based migration for backward compatibility (GAP #6)
 * - Rejection tracking for audit trail (GAP #1)
 *
 * Usage:
 * ```typescript
 * const manager = new SessionManager(permissionConfig);
 * const session = manager.createSession(jwtPayload, roleResult);
 * if (session.rejected) {
 *   // Handle rejected session
 * }
 * ```
 */
export class SessionManager {
  private readonly SESSION_VERSION = 1; // Current schema version
  private config: PermissionConfig;

  constructor(config?: PermissionConfig) {
    this.config = {
      adminPermissions: config?.adminPermissions || [
        'read',
        'write',
        'delete',
        'admin',
      ],
      userPermissions: config?.userPermissions || ['read', 'write'],
      guestPermissions: config?.guestPermissions || ['read'],
      customPermissions: config?.customPermissions || {},
    };
  }

  /**
   * Create a user session from JWT payload and role mapping result
   *
   * CRITICAL: Enforces UNASSIGNED_ROLE → [] permissions invariant (GAP #2)
   *
   * @param jwtPayload - JWT payload with user claims
   * @param roleResult - Role mapping result
   * @returns UserSession with versioning and rejection tracking
   * @throws Error if UNASSIGNED_ROLE has non-empty permissions (safety check)
   */
  createSession(
    jwtPayload: JWTPayload,
    roleResult: RoleMapperResult
  ): UserSession {
    // Get permissions based on role (getPermissions handles UNASSIGNED_ROLE safely)
    const permissions = this.getPermissions(roleResult.primaryRole);

    // MANDATORY (GAP #2): Runtime assertion for UNASSIGNED_ROLE
    // This catches configuration bugs where UNASSIGNED_ROLE is incorrectly mapped to permissions
    if (
      roleResult.primaryRole === UNASSIGNED_ROLE &&
      permissions.length > 0
    ) {
      throw new Error(
        'CRITICAL: UNASSIGNED_ROLE must have empty permissions array'
      );
    }

    // Convert scopes to array
    const scopes = Array.isArray(jwtPayload.scopes)
      ? jwtPayload.scopes
      : typeof jwtPayload.scopes === 'string'
        ? jwtPayload.scopes.split(' ')
        : [];

    // Build session with versioning
    const session: UserSession = {
      _version: this.SESSION_VERSION, // MANDATORY (GAP #6)
      userId: jwtPayload.sub,
      username: jwtPayload.preferred_username || jwtPayload.username || jwtPayload.sub,
      legacyUsername: jwtPayload.legacy_sam_account,
      role: roleResult.primaryRole,
      customRoles: roleResult.customRoles,
      permissions,
      scopes,
      claims: jwtPayload,
      rejected: roleResult.primaryRole === UNASSIGNED_ROLE, // MANDATORY (GAP #1)
    };

    return session;
  }

  /**
   * Validate session is not rejected
   *
   * @param session - User session to validate
   * @returns true if session is valid (not UNASSIGNED), false otherwise
   */
  validateSession(session: UserSession): boolean {
    // Reject UNASSIGNED sessions
    return session.role !== UNASSIGNED_ROLE;
  }

  /**
   * Refresh session (placeholder for future implementation)
   *
   * @param session - User session to refresh
   * @returns Refreshed session
   */
  refreshSession(session: UserSession): UserSession {
    // TODO: Implement session refresh logic
    // For now, return the same session with updated timestamp
    return {
      ...session,
    };
  }

  /**
   * Migrate session from older schema version
   *
   * MANDATORY (GAP #6): Version-based migration for backward compatibility
   *
   * This ensures existing serialized sessions from production can be loaded
   * without crashes during deployment.
   *
   * Migration path:
   * - v0 → v1: Add _version, rejected, ensure permissions=[] for UNASSIGNED_ROLE
   *
   * @param rawSession - Raw session object (potentially old schema)
   * @returns Migrated UserSession with current schema
   */
  migrateSession(rawSession: any): UserSession {
    const currentVersion = this.SESSION_VERSION;
    const sessionVersion = rawSession._version || 0;

    // Apply migrations based on version
    if (sessionVersion < 1) {
      // Migration to v1: Add _version, rejected fields
      rawSession._version = 1;

      // Add rejected field if missing
      if (
        rawSession.role === UNASSIGNED_ROLE &&
        !('rejected' in rawSession)
      ) {
        rawSession.rejected = true;
      }

      // Ensure UNASSIGNED_ROLE has empty permissions
      if (
        rawSession.role === UNASSIGNED_ROLE &&
        !rawSession.permissions
      ) {
        rawSession.permissions = [];
      }

      // Ensure permissions array exists for all sessions
      if (!rawSession.permissions) {
        rawSession.permissions =
          rawSession.role === UNASSIGNED_ROLE
            ? []
            : this.getPermissions(rawSession.role);
      }
    }

    // Future migrations would go here
    // if (sessionVersion < 2) { ... }

    return rawSession as UserSession;
  }

  /**
   * Get permissions for a given role
   *
   * @param role - Role name
   * @returns Array of permissions
   */
  private getPermissions(role: string): string[] {
    // Standard roles
    if (role === ROLE_ADMIN) {
      return this.config.adminPermissions || [];
    }
    if (role === ROLE_USER) {
      return this.config.userPermissions || [];
    }
    if (role === ROLE_GUEST) {
      return this.config.guestPermissions || [];
    }

    // Custom roles (checked BEFORE UNASSIGNED_ROLE to allow safety assertion to catch config bugs)
    if (this.config.customPermissions?.[role]) {
      return this.config.customPermissions[role];
    }

    // UNASSIGNED_ROLE must always return empty array
    // This should never be reached if createSession() properly enforces the invariant
    if (role === UNASSIGNED_ROLE) {
      return [];
    }

    // Unknown role - return empty permissions
    return [];
  }

  /**
   * Get the current session schema version
   */
  getSessionVersion(): number {
    return this.SESSION_VERSION;
  }

  /**
   * Update permission configuration
   */
  updateConfig(config: Partial<PermissionConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  /**
   * Get current permission configuration
   */
  getConfig(): PermissionConfig {
    return { ...this.config };
  }
}
