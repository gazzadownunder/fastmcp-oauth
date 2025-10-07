/**
 * Role Mapper - Role Determination with Failure Policy
 *
 * This module maps JWT roles to application roles with a critical safety policy:
 * NEVER throws exceptions - always returns a result with failure information.
 *
 * On failure, returns UNASSIGNED_ROLE instead of throwing, allowing the
 * authentication flow to continue and handle the rejection gracefully.
 *
 * @see Phase 1.5 of refactor.md
 */

import { UNASSIGNED_ROLE, ROLE_ADMIN, ROLE_USER, ROLE_GUEST } from './types.js';
import type { RoleMapperResult } from './types.js';

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Role mapping configuration
 */
export interface RoleMappingConfig {
  /** Roles that map to admin */
  adminRoles?: string[];

  /** Roles that map to user */
  userRoles?: string[];

  /** Roles that map to guest */
  guestRoles?: string[];

  /** Custom role mappings (e.g., { "analyst": ["data_analyst", "business_analyst"] }) */
  customRoles?: Record<string, string[]>;

  /** Default role if no matches found (defaults to 'guest') */
  defaultRole?: string;

  /**
   * Reject authentication if JWT contains roles that don't match any mapping
   *
   * When true: Returns UNASSIGNED_ROLE with mappingFailed=true if no roles match
   * When false: Falls back to defaultRole if no roles match (default behavior)
   *
   * Default: false (use defaultRole for unmapped roles)
   */
  rejectUnmappedRoles?: boolean;
}

// ============================================================================
// Role Mapper Class
// ============================================================================

/**
 * Role Mapper - Determines user roles from JWT claims
 *
 * CRITICAL SAFETY POLICY:
 * - NEVER throws exceptions
 * - Returns UNASSIGNED_ROLE on any error
 * - Sets mappingFailed flag with failure reason
 * - Allows graceful handling of role mapping failures
 *
 * Priority order: admin > user > guest > custom > default
 *
 * Usage:
 * ```typescript
 * const mapper = new RoleMapper(config);
 * const result = mapper.determineRoles(['user', 'admin']);
 * if (result.mappingFailed) {
 *   // Handle failure (result.primaryRole === UNASSIGNED_ROLE)
 * }
 * ```
 */
export class RoleMapper {
  private config: RoleMappingConfig;

  constructor(config?: RoleMappingConfig) {
    this.config = {
      adminRoles: config?.adminRoles || ['admin', 'administrator'],
      userRoles: config?.userRoles || ['user'],
      guestRoles: config?.guestRoles || [],
      customRoles: config?.customRoles || {},
      defaultRole: config?.defaultRole || ROLE_GUEST,
      rejectUnmappedRoles: config?.rejectUnmappedRoles || false,
    };
  }

  /**
   * Determine roles from JWT roles claim
   *
   * CRITICAL: This method NEVER throws exceptions. All errors are caught
   * and converted to UNASSIGNED_ROLE with failure information.
   *
   * Priority order:
   * 1. Admin roles (highest priority)
   * 2. User roles
   * 3. Guest roles
   * 4. Custom roles
   * 5. Default role (if no matches)
   *
   * @param roles - Array of roles from JWT
   * @returns Result with primary role, custom roles, and failure info
   */
  determineRoles(roles: string[]): RoleMapperResult {
    console.log('[RoleMapper] determineRoles called with:', roles);
    console.log('[RoleMapper] Config:', {
      adminRoles: this.config.adminRoles,
      userRoles: this.config.userRoles,
      guestRoles: this.config.guestRoles,
      customRoles: this.config.customRoles,
      defaultRole: this.config.defaultRole
    });

    try {
      // Validate input
      if (!Array.isArray(roles)) {
        console.log('[RoleMapper] Invalid input: not an array');
        return {
          primaryRole: UNASSIGNED_ROLE,
          customRoles: [],
          mappingFailed: true,
          failureReason: 'Invalid input: roles must be an array',
        };
      }

      // Filter out null/undefined values
      const validRoles = roles.filter(r => typeof r === 'string' && r.length > 0);
      console.log('[RoleMapper] Valid roles after filtering:', validRoles);

      if (validRoles.length === 0) {
        console.log('[RoleMapper] No valid roles, using default:', this.config.defaultRole);
        // No valid roles - use default
        return {
          primaryRole: this.config.defaultRole || ROLE_GUEST,
          customRoles: [],
          mappingFailed: false,
        };
      }

      // Check priority order
      const primaryRole = this.determinePrimaryRole(validRoles);
      console.log('[RoleMapper] Primary role determined:', primaryRole);

      // Check if role mapping failed due to rejectUnmappedRoles
      if (primaryRole === UNASSIGNED_ROLE && this.config.rejectUnmappedRoles) {
        console.log('[RoleMapper] Rejecting authentication - unmapped roles:', validRoles);
        return {
          primaryRole: UNASSIGNED_ROLE,
          customRoles: [],
          mappingFailed: true,
          failureReason: `No role mappings found for JWT roles: ${validRoles.join(', ')}. Authentication rejected by rejectUnmappedRoles policy.`,
        };
      }

      const customRoles = this.determineCustomRoles(validRoles, primaryRole);
      console.log('[RoleMapper] Custom roles determined:', customRoles);

      return {
        primaryRole,
        customRoles,
        mappingFailed: false,
      };
    } catch (error) {
      // CRITICAL: Catch ALL errors and return UNASSIGNED_ROLE
      console.log('[RoleMapper] Error during role mapping:', error);
      return {
        primaryRole: UNASSIGNED_ROLE,
        customRoles: [],
        mappingFailed: true,
        failureReason: error instanceof Error ? error.message : 'Unknown error during role mapping',
      };
    }
  }

  /**
   * Determine primary role based on priority order
   *
   * Returns UNASSIGNED_ROLE if rejectUnmappedRoles=true and no roles match
   */
  private determinePrimaryRole(roles: string[]): string {
    // Priority 1: Admin roles
    if (this.config.adminRoles?.some(adminRole => roles.includes(adminRole))) {
      return ROLE_ADMIN;
    }

    // Priority 2: User roles
    if (this.config.userRoles?.some(userRole => roles.includes(userRole))) {
      return ROLE_USER;
    }

    // Priority 3: Guest roles
    if (this.config.guestRoles?.some(guestRole => roles.includes(guestRole))) {
      return ROLE_GUEST;
    }

    // Priority 4: Custom roles (first match wins)
    if (this.config.customRoles) {
      for (const [customRoleName, customRoleValues] of Object.entries(this.config.customRoles)) {
        if (customRoleValues.some(value => roles.includes(value))) {
          return customRoleName;
        }
      }
    }

    // No matches - check rejectUnmappedRoles setting
    if (this.config.rejectUnmappedRoles) {
      // Reject unmapped roles - return UNASSIGNED_ROLE to trigger authentication failure
      return UNASSIGNED_ROLE;
    }

    // Use default role as fallback
    return this.config.defaultRole || ROLE_GUEST;
  }

  /**
   * Determine custom roles (all matches except the primary role)
   */
  private determineCustomRoles(roles: string[], primaryRole: string): string[] {
    const customRoles: string[] = [];

    if (!this.config.customRoles) {
      return customRoles;
    }

    for (const [customRoleName, customRoleValues] of Object.entries(this.config.customRoles)) {
      // Skip if this is the primary role
      if (customRoleName === primaryRole) {
        continue;
      }

      // Check if any JWT roles match this custom role
      if (customRoleValues.some(value => roles.includes(value))) {
        customRoles.push(customRoleName);
      }
    }

    return customRoles;
  }

  /**
   * Get the current configuration
   */
  getConfig(): RoleMappingConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<RoleMappingConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }
}
