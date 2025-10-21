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
import { AuditService } from './audit-service.js';

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Token exchange configuration (RFC 8693)
 */
export interface TokenExchangeConfig {
  /** Token endpoint URL for token exchange */
  tokenEndpoint: string;

  /** Client ID for token exchange */
  clientId: string;

  /** Client secret for token exchange */
  clientSecret: string;

  /** Audience for delegation token */
  audience?: string;

  /** Required claim in TE-JWT (e.g., 'legacy_name') */
  requiredClaim?: string;
}

/**
 * Authentication configuration
 *
 * Authorization is role-based from JWT claims, not static permissions.
 */
export interface AuthConfig {
  /** Trusted IDP configurations for JWT validation */
  idpConfigs: IDPConfig[];

  /** Role mapping configuration (optional) */
  roleMappings?: RoleMappingConfig;

  /** Token exchange configuration (optional, for Kerberos/SQL delegation) */
  tokenExchange?: TokenExchangeConfig;
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
 * Token Exchange Service interface (for dependency injection)
 *
 * This interface allows Core layer to depend on Delegation layer via abstraction,
 * without directly importing TokenExchangeService (which is in Delegation layer).
 */
export interface ITokenExchangeService {
  performExchange(params: {
    subjectToken: string;
    subjectTokenType?: string;
    audience: string;
    tokenEndpoint: string;
    clientId: string;
    clientSecret: string;
  }, sessionId?: string, jwtSubject?: string): Promise<{
    success: boolean;
    accessToken?: string;
    error?: string;
    errorDescription?: string;
  }>;

  decodeTokenClaims(token: string): any | null;
}

/**
 * Authentication Service - Coordinates authentication flow
 *
 * Flow (with token exchange):
 * 1. Validate requestor JWT (throws on invalid token)
 * 2. (Optional) Perform token exchange to get TE-JWT
 * 3. Validate TE-JWT has required claims (e.g., legacy_name)
 * 4. Map roles from TE-JWT (or requestor JWT if no exchange)
 * 5. Create session with TE-JWT claims (with versioning)
 * 6. Check for rejection (UNASSIGNED_ROLE)
 * 7. Log to audit service (with source field)
 * 8. Return result (doesn't throw on rejected)
 *
 * Usage:
 * ```typescript
 * const auth = new AuthenticationService(config, auditService, tokenExchangeService);
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
  private tokenExchangeService?: ITokenExchangeService;

  /**
   * Create authentication service
   *
   * @param config - Authentication configuration
   * @param auditService - Optional audit service (Null Object Pattern if not provided)
   * @param tokenExchangeService - Optional token exchange service (for delegation)
   */
  constructor(
    config: AuthConfig,
    auditService?: AuditService,
    tokenExchangeService?: ITokenExchangeService
  ) {
    this.config = config;
    this.jwtValidator = new JWTValidator();
    this.roleMapper = new RoleMapper(config.roleMappings);
    this.sessionManager = new SessionManager();
    this.auditService = auditService ?? new AuditService(); // Null Object Pattern
    this.tokenExchangeService = tokenExchangeService;
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
   * Flow with Token Exchange:
   * 1. Validate requestor JWT
   * 2. (Optional) Perform token exchange to get TE-JWT
   * 3. Validate TE-JWT has required claims (e.g., legacy_name)
   * 4. Map roles from TE-JWT (or requestor JWT if no exchange)
   * 5. Create session with TE-JWT claims
   *
   * @param token - JWT token string (requestor JWT)
   * @param context - Optional validation context
   * @returns Authentication result (never throws on role mapping failure)
   * @throws SecurityError if JWT validation or token exchange fails
   */
  async authenticate(
    token: string,
    context?: Partial<ValidationContext>
  ): Promise<AuthenticationResult> {
    try {
      // Step 1: Validate requestor JWT (may throw on invalid token)
      const validationResult = await this.jwtValidator.validateJWT(
        token,
        context
      );

      console.log('[AuthenticationService] Requestor JWT validated:', {
        userId: validationResult.claims.sub,
        issuer: validationResult.claims.iss,
      });

      // Step 2: Token Exchange (if configured)
      let delegationToken: string | undefined;
      let delegationClaims: Record<string, unknown> | undefined;
      let effectiveClaims: Record<string, unknown> = validationResult.claims; // Default to requestor JWT claims

      if (this.config.tokenExchange && this.tokenExchangeService) {
        console.log('[AuthenticationService] Token exchange configured - performing exchange BEFORE session creation');

        const exchangeResult = await this.tokenExchangeService.performExchange({
          subjectToken: token,
          subjectTokenType: 'urn:ietf:params:oauth:token-type:access_token',
          audience: this.config.tokenExchange.audience || 'delegation',
          tokenEndpoint: this.config.tokenExchange.tokenEndpoint,
          clientId: this.config.tokenExchange.clientId,
          clientSecret: this.config.tokenExchange.clientSecret,
        });

        if (!exchangeResult.success || !exchangeResult.accessToken) {
          console.error('[AuthenticationService] Token exchange FAILED:', exchangeResult.error);
          throw new Error(`Token exchange failed: ${exchangeResult.errorDescription || exchangeResult.error}`);
        }

        console.log('[AuthenticationService] Token exchange SUCCESS');

        // Decode TE-JWT to extract delegation claims
        delegationToken = exchangeResult.accessToken;
        delegationClaims = this.tokenExchangeService.decodeTokenClaims(delegationToken);

        console.log('[AuthenticationService] TE-JWT claims:', {
          sub: delegationClaims?.sub,
          legacy_name: delegationClaims?.legacy_name,
          roles: delegationClaims?.roles,
        });

        // Step 3: Validate TE-JWT has required claim (if specified)
        if (this.config.tokenExchange.requiredClaim) {
          const requiredClaim = this.config.tokenExchange.requiredClaim;
          if (!delegationClaims || !delegationClaims[requiredClaim]) {
            console.error(`[AuthenticationService] TE-JWT missing required claim: ${requiredClaim}`);
            throw new Error(`TE-JWT missing required claim for delegation: ${requiredClaim}`);
          }
          console.log(`[AuthenticationService] ✓ TE-JWT has required claim '${requiredClaim}':`, delegationClaims[requiredClaim]);
        }

        // Use TE-JWT claims for role mapping (NOT requestor JWT claims)
        effectiveClaims = delegationClaims!;
      } else {
        console.log('[AuthenticationService] Token exchange NOT configured - using requestor JWT claims');
      }

      // Step 4: Map roles from effective claims (TE-JWT or requestor JWT)
      const idpConfig = this.config.idpConfigs[0]; // TODO: Support multi-IDP
      const rolesClaimPath = idpConfig.claimMappings.roles;
      const rolesFromClaims = effectiveClaims[rolesClaimPath];

      console.log('[AuthenticationService] Role extraction:', {
        rolesClaimPath,
        rolesFromClaims,
        rolesType: typeof rolesFromClaims,
        isArray: Array.isArray(rolesFromClaims),
        sourceToken: delegationToken ? 'TE-JWT' : 'requestor JWT',
      });

      // Let RoleMapper handle validation - pass raw value
      const rolesInput = typeof rolesFromClaims === 'string'
        ? [rolesFromClaims] // String -> single-element array
        : rolesFromClaims; // Pass as-is (array, undefined, null, number, etc.)

      const roleResult: RoleMapperResult = this.roleMapper.determineRoles(
        rolesInput as string[] // Type assertion - RoleMapper will validate
      );

      console.log('[AuthenticationService] RoleMapper result:', roleResult);

      // Step 5: Create session with TE-JWT claims (if available)
      const session = this.sessionManager.createSession(
        validationResult.payload,
        roleResult,
        token, // Original requestor JWT (for future token exchange)
        delegationToken, // TE-JWT (if exchange was performed)
        delegationClaims // TE-JWT claims (for delegation modules)
      );

      console.log('[AuthenticationService] Session created:', {
        sessionId: session.sessionId,
        userId: session.userId,
        legacyUsername: session.legacyUsername,
        role: session.role,
        hasRequestorJWT: !!session.claims?.access_token,
        hasDelegationToken: !!session.delegationToken,
        hasDelegationClaims: !!session.customClaims,
      });

      // Step 6: Check if role is UNASSIGNED (GAP #1)
      const rejected = session.role === UNASSIGNED_ROLE;
      const rejectionReason = rejected
        ? roleResult.failureReason || 'No matching roles found'
        : undefined;

      // Step 7: Log to AuditService (MANDATORY GAP #3: Include source field)
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
          tokenExchange: delegationToken ? 'performed' : 'skipped',
        },
      };
      await this.auditService.log(auditEntry);

      // Step 8: Return result (doesn't throw on UNASSIGNED)
      return {
        session,
        rejected,
        rejectionReason,
        auditEntry,
      };
    } catch (error) {
      // Only JWT validation and token exchange errors throw
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
