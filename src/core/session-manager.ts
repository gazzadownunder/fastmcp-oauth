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

import { randomUUID } from 'node:crypto';
import { UNASSIGNED_ROLE } from './types.js';
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
  [key: string]: unknown; // Additional claims
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
   * Per-Module Token Exchange Design (Phase 2):
   * - Session created from requestor JWT only (no token exchange at auth level)
   * - Requestor JWT stored for delegation modules to use
   * - Delegation modules perform token exchange on-demand during tool execution
   *
   * @param jwtPayload - JWT payload with user claims (from requestor JWT)
   * @param roleResult - Role mapping result (from requestor JWT roles)
   * @param requestorJWT - Original requestor JWT string (for delegation modules)
   * @returns UserSession with versioning and rejection tracking
   */
  createSession(
    jwtPayload: JWTPayload,
    roleResult: RoleMapperResult,
    requestorJWT?: string
  ): UserSession {
    // Convert scopes to array
    const scopes = Array.isArray(jwtPayload.scopes)
      ? jwtPayload.scopes
      : typeof jwtPayload.scopes === 'string'
        ? jwtPayload.scopes.split(' ')
        : [];

    // Generate unique session ID
    const sessionId = randomUUID();

    // Build session with versioning (role-based authorization from requestor JWT)
    const session: UserSession = {
      _version: this.SESSION_VERSION, // MANDATORY (GAP #6)
      sessionId, // Unique session ID for caching and tracking
      userId: jwtPayload.sub,
      username: jwtPayload.preferred_username || jwtPayload.username || jwtPayload.sub,
      // Legacy username from requestor JWT (optional)
      // NOTE: TE-JWT may contain different legacy_name for delegation
      legacyUsername: jwtPayload.legacy_sam_account,
      role: roleResult.primaryRole,
      customRoles: roleResult.customRoles,
      scopes,
      claims: {
        ...jwtPayload,
      },
      rejected: roleResult.primaryRole === UNASSIGNED_ROLE, // MANDATORY (GAP #1)
      // Store requestor JWT for delegation modules to perform token exchange
      requestorJWT,
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  migrateSession(rawSession: any): UserSession {
    const sessionVersion = rawSession._version || 0;

    // Apply migrations based on version
    if (sessionVersion < 1) {
      // Migration to v1: Add _version, rejected fields
      rawSession._version = 1;

      // Add rejected field if missing
      if (rawSession.role === UNASSIGNED_ROLE && !('rejected' in rawSession)) {
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
