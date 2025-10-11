/**
 * Session Manager - Session Creation and Migration
 *
 * This module manages UserSession creation and migration with critical safety policies:
 * - Support version-based migration for backward compatibility (GAP #6)
 * - Track rejection status for audit trail (GAP #1)
 * - Role-based authorization from JWT claims (no static permissions)
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

// ============================================================================
// Session Manager Class
// ============================================================================

/**
 * Session Manager - Creates and migrates user sessions
 *
 * CRITICAL SAFETY POLICIES:
 * - Version-based migration for backward compatibility (GAP #6)
 * - Rejection tracking for audit trail (GAP #1)
 * - Role-based authorization from JWT claims (no static permissions)
 *
 * Usage:
 * ```typescript
 * const manager = new SessionManager();
 * const session = manager.createSession(jwtPayload, roleResult);
 * if (session.rejected) {
 *   // Handle rejected session
 * }
 * ```
 */
export class SessionManager {
  private readonly SESSION_VERSION = 1; // Current schema version

  constructor() {
    // No configuration needed - roles come from JWT claims
  }

  /**
   * Create a user session from JWT payload and role mapping result
   *
   * @param jwtPayload - JWT payload with user claims
   * @param roleResult - Role mapping result
   * @returns UserSession with versioning and rejection tracking
   */
  createSession(
    jwtPayload: JWTPayload,
    roleResult: RoleMapperResult,
    accessToken?: string
  ): UserSession {
    // Convert scopes to array
    const scopes = Array.isArray(jwtPayload.scopes)
      ? jwtPayload.scopes
      : typeof jwtPayload.scopes === 'string'
        ? jwtPayload.scopes.split(' ')
        : [];

    // Build session with versioning (role-based authorization)
    const session: UserSession = {
      _version: this.SESSION_VERSION, // MANDATORY (GAP #6)
      userId: jwtPayload.sub,
      username: jwtPayload.preferred_username || jwtPayload.username || jwtPayload.sub,
      legacyUsername: jwtPayload.legacy_sam_account,
      role: roleResult.primaryRole,
      customRoles: roleResult.customRoles,
      scopes,
      claims: {
        ...jwtPayload,
        // Store original access token for token exchange (RFC 8693)
        // This is the subject token that will be exchanged for delegation tokens
        access_token: accessToken,
      },
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
   * - v0 → v1: Add _version, rejected fields
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

      // Remove legacy permissions field if present
      if ('permissions' in rawSession) {
        delete rawSession.permissions;
      }
    }

    // Future migrations would go here
    // if (sessionVersion < 2) { ... }

    return rawSession as UserSession;
  }

  /**
   * Get the current session schema version
   */
  getSessionVersion(): number {
    return this.SESSION_VERSION;
  }
}
