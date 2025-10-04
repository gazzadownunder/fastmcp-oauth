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
import type {
  JWTPayload,
  IDPConfig,
  ValidationContext,
} from './jwt-validator.js';
import { RoleMapper } from './role-mapper.js';
import type { RoleMappingConfig } from './role-mapper.js';
import { SessionManager } from './session-manager.js';
import type { PermissionConfig } from './session-manager.js';
import { AuditService } from './audit-service.js';

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Authentication configuration
 */
export interface AuthConfig {
  /** Trusted IDP configurations for JWT validation */
  idpConfigs: IDPConfig[];

  /** Role mapping configuration (optional) */
  roleMappings?: RoleMappingConfig;

  /** Permission mapping configuration (optional) */
  permissions?: PermissionConfig;
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
 * Flow:
 * 1. Validate JWT (throws on invalid token)
 * 2. Map roles (never throws, returns result)
 * 3. Create session (with versioning)
 * 4. Check for rejection (UNASSIGNED_ROLE)
 * 5. Log to audit service (with source field)
 * 6. Return result (doesn't throw on rejected)
 *
 * Usage:
 * ```typescript
 * const auth = new AuthenticationService(config, auditService);
 * await auth.initialize();
 *
 * const result = await auth.authenticate(token);
 * if (result.rejected) {
 *   // Handle rejected session
 * } else {
 *   // Session is valid
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
    this.sessionManager = new SessionManager(config.permissions);
    this.auditService = auditService ?? new AuditService(); // Null Object Pattern
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
   * Authenticate user from JWT token
   *
   * CRITICAL: Does NOT throw on role mapping failures
   * - Invalid JWT: throws (security validation failed)
   * - Role mapping fails: returns rejected=true (graceful degradation)
   *
   * @param token - JWT token string
   * @param context - Optional validation context
   * @returns Authentication result (never throws on role mapping failure)
   * @throws SecurityError if JWT validation fails
   */
  async authenticate(
    token: string,
    context?: Partial<ValidationContext>
  ): Promise<AuthenticationResult> {
    try {
      // Step 1: Validate JWT (may throw on invalid token)
      const validationResult = await this.jwtValidator.validateJWT(
        token,
        context
      );

      // Step 2: Map roles (Enhancement v0.2: never throws, returns result)
      // Extract roles from claims based on IDP claim mapping
      const idpConfig = this.config.idpConfigs[0]; // TODO: Support multi-IDP
      const rolesClaimPath = idpConfig.claimMappings.roles;
      const rolesFromClaims = validationResult.claims[rolesClaimPath];

      console.log('[AuthenticationService] Role extraction:', {
        rolesClaimPath,
        rolesFromClaims,
        rolesType: typeof rolesFromClaims,
        isArray: Array.isArray(rolesFromClaims),
        allClaimsKeys: Object.keys(validationResult.claims)
      });

      // Let RoleMapper handle validation - pass raw value
      // If it's a string, convert to array; otherwise pass as-is for validation
      const rolesInput = typeof rolesFromClaims === 'string'
        ? [rolesFromClaims] // String -> single-element array
        : rolesFromClaims; // Pass as-is (array, undefined, null, number, etc.)

      console.log('[AuthenticationService] Roles input to RoleMapper:', rolesInput);

      const roleResult: RoleMapperResult = this.roleMapper.determineRoles(
        rolesInput as string[] // Type assertion - RoleMapper will validate
      );

      console.log('[AuthenticationService] RoleMapper result:', roleResult);

      // Step 3: Create session
      const session = this.sessionManager.createSession(
        validationResult.payload,
        roleResult
      );

      // Step 4: Enhancement v0.2 - Check if role is UNASSIGNED (GAP #1)
      const rejected = session.role === UNASSIGNED_ROLE;
      const rejectionReason = rejected
        ? roleResult.failureReason || 'No matching roles found'
        : undefined;

      // Step 5: Enhancement v0.2 - Log to AuditService
      // MANDATORY (GAP #3): Include source field
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
        userId: undefined, // Unknown - JWT validation failed
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
   * Update configuration (affects role mapping and permissions)
   *
   * @param config - Partial configuration to update
   */
  updateConfig(config: Partial<AuthConfig>): void {
    if (config.roleMappings) {
      this.roleMapper.updateConfig(config.roleMappings);
    }
    if (config.permissions) {
      this.sessionManager.updateConfig(config.permissions);
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
