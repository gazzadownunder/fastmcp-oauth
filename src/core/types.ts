/**
 * Core Authentication Framework Types
 *
 * This module contains type definitions for the standalone authentication framework.
 * These types do NOT depend on MCP or delegation layers.
 *
 * Architectural Rule: Core → Delegation → MCP
 * Files in src/core/ MUST NOT import from src/delegation/ or src/mcp/
 */

// ============================================================================
// Role Constants
// ============================================================================

/**
 * Special role assigned when role mapping fails.
 * Sessions with this role have empty permissions and are rejected.
 */
export const UNASSIGNED_ROLE = 'unassigned';

export const ROLE_ADMIN = 'admin';
export const ROLE_USER = 'user';
export const ROLE_GUEST = 'guest';

// ============================================================================
// Core Context (Dependency Injection Container)
// ============================================================================

/**
 * CoreContext provides dependency injection for all framework components.
 *
 * ARCHITECTURAL NOTE: This interface is defined in the Core layer (not MCP)
 * to prevent circular dependencies. The one-way dependency flow is:
 * Core → Delegation → MCP
 *
 * The DelegationRegistry reference is a forward type reference only - no
 * runtime import is needed from the delegation layer.
 *
 * @see Phase 0.2 of refactor.md for architectural rationale
 */
export interface CoreContext {
  /** Authentication service for JWT validation and session management */
  authService: any; // Will be typed as AuthenticationService once implemented

  /** Audit service for centralized logging (Null Object Pattern) */
  auditService: any; // Will be typed as AuditService once implemented

  /** Delegation registry for pluggable delegation modules */
  delegationRegistry: any; // Forward reference - typed later

  /** Configuration manager for config orchestration */
  configManager: any; // Will be typed as ConfigManager once implemented
}

// ============================================================================
// Audit Types
// ============================================================================

/**
 * AuditEntry represents a single audit log entry.
 *
 * MANDATORY (GAP #3): All audit entries MUST include a source field
 * to track the origin of the entry for audit trail integrity.
 *
 * SECURITY (SEC-1): Trust boundary fields prevent malicious delegation modules
 * from hiding successful operations or faking failures.
 */
export interface AuditEntry {
  /** Timestamp when the event occurred */
  timestamp: Date;

  /** MANDATORY: Origin of the audit entry (e.g., 'auth:service', 'delegation:sql') */
  source: string;

  /** User ID associated with the event (if applicable) */
  userId?: string;

  /** Action that was performed */
  action: string;

  /** Whether the action succeeded */
  success: boolean;

  /** Human-readable reason for the result */
  reason?: string;

  /** Error message if the action failed */
  error?: string;

  /** Additional metadata about the event */
  metadata?: Record<string, unknown>;

  // ============================================================================
  // Trust Boundary Fields (SEC-1: Trust Boundary Violation Prevention)
  // ============================================================================

  /**
   * What the delegation module reported as success status.
   * This field captures the module's claim about operation success.
   * SECURITY: Used to detect discrepancies with registryVerifiedSuccess.
   */
  moduleReportedSuccess?: boolean;

  /**
   * What the DelegationRegistry independently verified as success status.
   * This field captures the registry's ground truth observation.
   * SECURITY: Registry verifies result.success directly, not trusting module.
   */
  registryVerifiedSuccess?: boolean;

  /**
   * Independent timestamp recorded by the registry.
   * SECURITY: Prevents module from manipulating event timing.
   */
  registryTimestamp?: Date;

  /**
   * Optional: Cryptographic hash of critical audit fields for tamper detection.
   * SECURITY: Can be used to detect post-logging modifications.
   */
  integrityHash?: string;
}

// ============================================================================
// Authentication Types
// ============================================================================

/**
 * Authentication configuration
 */
export interface AuthConfig {
  // TODO: Define in Phase 1.2
  trustedIDPs?: any[];
  rateLimiting?: any;
  audit?: any;
  roleMappings?: any;
}

/**
 * UserSession represents an authenticated user session.
 *
 * MANDATORY (GAP #1): rejected field tracks session rejection status
 * MANDATORY (GAP #6): _version field enables backward-compatible migrations
 */
export interface UserSession {
  /** MANDATORY (GAP #6): Schema version for backward-compatible migrations */
  _version: number;

  /** Unique user identifier */
  userId: string;

  /** Username */
  username: string;

  /** Legacy SAM account name (for Windows delegation) */
  legacyUsername?: string;

  /** Primary role (can be UNASSIGNED_ROLE if mapping fails) */
  role: string;

  /** Additional custom roles */
  customRoles?: string[];

  /** Permissions granted to this session */
  /** CRITICAL: MUST be empty array [] if role is UNASSIGNED_ROLE */
  permissions: string[];

  /** OAuth scopes */
  scopes?: string[];

  /** Raw JWT claims */
  claims?: Record<string, unknown>;

  /** MANDATORY (GAP #1): True if session was rejected due to role mapping failure */
  rejected?: boolean;
}

/**
 * Result of an authentication attempt
 */
export interface AuthenticationResult {
  /** User session (may have UNASSIGNED_ROLE) */
  session: UserSession;

  /** True if session was rejected (role === UNASSIGNED_ROLE) */
  rejected: boolean;

  /** Reason for rejection if rejected === true */
  rejectionReason?: string;

  /** Audit entry for this authentication attempt */
  auditEntry: AuditEntry;
}

/**
 * Result of role mapping operation
 */
export interface RoleMapperResult {
  /** Primary role (will be UNASSIGNED_ROLE on failure) */
  primaryRole: string;

  /** Custom roles */
  customRoles: string[];

  /** True if mapping encountered an error */
  mappingFailed: boolean;

  /** Error details if mapping failed */
  failureReason?: string;
}

/**
 * Role mapper interface
 *
 * CRITICAL: determineRoles() NEVER throws exceptions
 * Returns UNASSIGNED_ROLE on failure instead
 */
export interface RoleMapper {
  /**
   * Determine roles from JWT roles claim.
   *
   * NEVER throws - always returns result with mappingFailed flag
   */
  determineRoles(roles: string[], config?: any): RoleMapperResult;
}
