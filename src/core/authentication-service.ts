/**
 * Authentication Service - Orchestrates JWT Validation, Role Mapping, and Session Creation
 *
 * This is the primary authentication service that coordinates:
 * - JWT validation (JWTValidator)
 * - Role mapping (RoleMapper)
 * - Session creation (SessionManager)
 * - Audit logging (AuditService)
 *
 * CRITICAL POLICIES:
 * - NEVER throws on role mapping failures (returns rejected session)
 * - Source field MUST be 'auth:service' for all audit entries (GAP #3)
 * - Rejected sessions allowed (GAP #1), not thrown as errors
 *
 * @see Phase 1.7 of refactor.md
 */

import { UNASSIGNED_ROLE } from './types.js';
import type { UserSession, AuditEntry, RoleMapperResult } from './types.js';
import { JWTValidator } from './jwt-validator.js';
import type { IDPConfig, ValidationContext } from './jwt-validator.js';
import { RoleMapper } from './role-mapper.js';
import type { RoleMappingConfig } from './role-mapper.js';
import { SessionManager } from './session-manager.js';
import { AuditService } from './audit-service.js';

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Authentication configuration
 *
 * Authorization is role-based from JWT claims, not static permissions.
 *
 * NOTE: Token exchange is NO LONGER configured here (moved to delegation modules).
 * Each delegation module now has its own token exchange configuration.
 * This ensures tool visibility (`canAccess`) is based on requestor JWT roles only.
 *
 * Design Principle:
 * - Requestor JWT → Authenticate user + determine tool visibility
 * - TE-JWT → Delegation modules request on-demand during tool execution
 * - TE-JWT claims → Used only for delegation authorization (SQL permissions, etc.)
 */
export interface AuthConfig {
  /** Trusted IDP configurations for JWT validation */
  idpConfigs: IDPConfig[];

  /** Role mapping configuration (optional) */
  roleMappings?: RoleMappingConfig;
}

/**
 * Authentication result
 */
export interface AuthenticationResult {
  /** User session (may be rejected if role is UNASSIGNED) */
  session: UserSession;

  /** Whether the session was rejected (GAP #1) */
  rejected: boolean;

  /** Reason for rejection if rejected=true */
  rejectionReason?: string;

  /** Audit entry for this authentication attempt */
  auditEntry: AuditEntry;
}

// ============================================================================
// Authentication Service Class
// ============================================================================

/**
 * Authentication Service - Coordinates authentication flow
 *
 * Flow (Simplified - No Token Exchange at Auth Level):
 * 1. Validate requestor JWT (throws on invalid token)
 * 2. Map roles from requestor JWT claims
 * 3. Create session with requestor JWT (stored for delegation modules)
 * 4. Check for rejection (UNASSIGNED_ROLE)
 * 5. Log to audit service (with source field)
 * 6. Return result (doesn't throw on rejected)
 *
 * Token Exchange Design Change:
 * - Token exchange NO LONGER happens during authentication
 * - Delegation modules perform token exchange on-demand during tool execution
 * - Session stores requestor JWT for delegation modules to use
 * - Tool visibility based on requestor JWT roles (correct behavior)
 *
 * Usage:
 * ```typescript
 * const auth = new AuthenticationService(config, auditService);
 * await auth.initialize();
 *
 * // Always specify idpName for requestor JWT validation
 * const result = await auth.authenticate(token, { idpName: 'requestor-jwt' });
 * if (result.rejected) {
 *   // Handle rejected session
 * } else {
 *   // Session has role from requestor JWT (e.g., 'user')
 * }
 * ```
 */
export class AuthenticationService {
  private jwtValidator: JWTValidator;
  private roleMapper: RoleMapper;
  private sessionManager: SessionManager;
  private auditService: AuditService;
  private config: AuthConfig;

  /**
   * Create authentication service
   *
   * @param config - Authentication configuration
   * @param auditService - Optional audit service (Null Object Pattern if not provided)
   */
  constructor(config: AuthConfig, auditService?: AuditService) {
    this.config = config;
    this.jwtValidator = new JWTValidator();
    this.roleMapper = new RoleMapper(config.roleMappings);
    this.sessionManager = new SessionManager();
    this.auditService = auditService ?? new AuditService(); // Null Object Pattern
  }

  /**
   * Get JWT validator (for delegation modules to validate TE-JWTs)
   *
   * Delegation modules need access to the validator to validate TE-JWTs
   * with their module-specific IDP configuration.
   */
  getValidator(): JWTValidator {
    return this.jwtValidator;
  }

  /**
   * Initialize authentication service
   *
   * Must be called before authenticate()
   */
  async initialize(): Promise<void> {
    await this.jwtValidator.initialize(this.config.idpConfigs);
  }

  /**
   * Authenticate user from JWT token (requestor JWT only)
   *
   * CRITICAL: Does NOT throw on role mapping failures
   * - Invalid JWT: throws (security validation failed)
   * - Role mapping fails: returns rejected=true (graceful degradation)
   *
   * Simplified Flow (No Token Exchange):
   * 1. Validate requestor JWT
   * 2. Map roles from requestor JWT claims
   * 3. Create session with requestor JWT (stored for delegation modules)
   * 4. Check for rejection (UNASSIGNED_ROLE)
   * 5. Log to audit service
   * 6. Return result
   *
   * @param token - JWT token string (requestor JWT)
   * @param context - Optional validation context (MUST include idpName: 'requestor-jwt')
   * @returns Authentication result (never throws on role mapping failure)
   * @throws SecurityError if JWT validation fails
   */
  async authenticate(
    token: string,
    context?: Partial<ValidationContext>
  ): Promise<AuthenticationResult> {
    try {
      // Step 1: Validate requestor JWT (may throw on invalid token)
      const validationResult = await this.jwtValidator.validateJWT(token, context);

      console.log('[AuthenticationService] Requestor JWT validated:', {
        userId: validationResult.claims.sub,
        issuer: validationResult.claims.iss,
      });

      // Step 2: Map roles from requestor JWT claims
      // NOTE: We now use the requestor JWT's IDP config for role claim extraction
      //       The idpName in context tells us which IDP config to use
      const idpName = context?.idpName || 'requestor-jwt';
      const idpConfig =
        this.config.idpConfigs.find((idp) => idp.name === idpName) || this.config.idpConfigs[0];
      const rolesClaimPath = idpConfig.claimMappings.roles;
      const rolesFromClaims = validationResult.claims[rolesClaimPath];

      console.log('[AuthenticationService] Role extraction:', {
        idpName,
        rolesClaimPath,
        rolesFromClaims,
        rolesType: typeof rolesFromClaims,
        isArray: Array.isArray(rolesFromClaims),
        sourceToken: 'requestor JWT',
      });

      // Let RoleMapper handle validation - pass raw value
      // String -> single-element array, otherwise pass through (including null/undefined)
      // RoleMapper will validate arrays and reject invalid types
      const rolesInput =
        typeof rolesFromClaims === 'string'
          ? [rolesFromClaims] // String -> single-element array
          : rolesFromClaims; // Pass through: array, null, undefined, or invalid types

      const roleResult: RoleMapperResult = this.roleMapper.determineRoles(
        rolesInput as string[] // Type assertion - RoleMapper will validate
      );

      console.log('[AuthenticationService] RoleMapper result:', roleResult);

      // Step 3: Create session with requestor JWT only
      const session = this.sessionManager.createSession(
        validationResult.payload,
        roleResult,
        token // Store requestor JWT for delegation modules
      );

      console.log('[AuthenticationService] Session created:', {
        sessionId: session.sessionId,
        userId: session.userId,
        role: session.role,
        customRoles: session.customRoles,
        hasRequestorJWT: !!token,
      });

      // Step 4: Check if role is UNASSIGNED (GAP #1)
      const rejected = session.role === UNASSIGNED_ROLE;
      const rejectionReason = rejected
        ? roleResult.failureReason || 'No matching roles found'
        : undefined;

      // Step 5: Log to AuditService (MANDATORY GAP #3: Include source field)
      const auditEntry: AuditEntry = {
        timestamp: new Date(),
        source: 'auth:service', // MANDATORY
        userId: session.userId,
        action: 'authenticate',
        success: !rejected,
        reason: rejectionReason,
        metadata: {
          role: session.role,
          mappingFailed: roleResult.mappingFailed,
        },
      };
      await this.auditService.log(auditEntry);

      // Step 6: Return result (doesn't throw on UNASSIGNED)
      return {
        session,
        rejected,
        rejectionReason,
        auditEntry,
      };
    } catch (error) {
      // Only JWT validation errors throw
      // MANDATORY (GAP #3): Include source field
      const auditEntry: AuditEntry = {
        timestamp: new Date(),
        source: 'auth:service',
        userId: undefined, // Unknown - authentication failed
        action: 'authenticate',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
      await this.auditService.log(auditEntry);
      throw error;
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): AuthConfig {
    return { ...this.config };
  }

  /**
   * Update configuration (affects role mapping)
   *
   * @param config - Partial configuration to update
   */
  updateConfig(config: Partial<AuthConfig>): void {
    if (config.roleMappings) {
      this.roleMapper.updateConfig(config.roleMappings);
    }
    this.config = {
      ...this.config,
      ...config,
    };
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.jwtValidator.destroy();
  }
}
