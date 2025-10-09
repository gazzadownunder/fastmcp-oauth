/**
 * JWT Validator - Core Authentication (JWT Validation Only)
 *
 * This module handles ONLY JWT validation and claim extraction.
 * Role mapping has been moved to RoleMapper (separation of concerns).
 *
 * Extracted from src/middleware/jwt-validator.ts in Phase 1.4
 *
 * @see Phase 1.4 of refactor.md
 */

import { jwtVerify, createRemoteJWKSet, JWTPayload as JoseJWTPayload } from 'jose';
import { createSecurityError, OAuthSecurityError } from '../utils/errors.js';

// ============================================================================
// Types
// ============================================================================

/**
 * JWT payload after validation
 */
export interface JWTPayload extends JoseJWTPayload {
  // Standard claims
  sub: string;
  iss: string;
  aud: string | string[];
  exp: number;
  nbf?: number;
  iat?: number;
  azp?: string;

  // Custom claims (flexible)
  [key: string]: unknown;
}

/**
 * IDP configuration for JWT validation
 */
export interface IDPConfig {
  issuer: string;
  jwksUri: string;
  audience: string;
  algorithms: string[];
  claimMappings: {
    userId?: string;
    username?: string;
    legacyUsername: string;
    roles: string;
    scopes?: string;
  };
  security: {
    clockTolerance: number;
    maxTokenAge: number;
    requireNbf: boolean;
  };
}

/**
 * Validation context for customizing validation behavior
 */
export interface ValidationContext {
  expectedIssuer: string;
  expectedAudiences: string[];
  clockTolerance: number;
  maxTokenAge: number;
}

/**
 * Result of JWT validation
 */
export interface JWTValidationResult {
  payload: JWTPayload;
  claims: Record<string, unknown>;
}

// ============================================================================
// JWT Validator Class
// ============================================================================

/**
 * JWT Validator - Validates JWT tokens against trusted IDPs
 *
 * Responsibilities:
 * - JWT signature verification
 * - Claim validation (iss, aud, exp, nbf, etc.)
 * - RFC 8725 security validations
 * - JWKS resolution and caching
 *
 * NOT responsible for:
 * - Role mapping (handled by RoleMapper)
 * - Session creation (handled by SessionManager)
 * - Audit logging (handled by AuditService)
 */
export class JWTValidator {
  private jwksSets: Map<string, ReturnType<typeof createRemoteJWKSet>> = new Map();
  private idpConfigs: Map<string, IDPConfig> = new Map();
  private initialized = false;

  /**
   * Initialize JWT validator with IDP configurations
   *
   * @param idpConfigs - Array of trusted IDP configurations
   */
  async initialize(idpConfigs: IDPConfig[]): Promise<void> {
    if (this.initialized) return;

    for (const idp of idpConfigs) {
      try {
        const jwks = createRemoteJWKSet(new URL(idp.jwksUri), {
          timeoutDuration: 5000,
          cooldownDuration: 30000,
          cacheMaxAge: 600000, // 10 minutes
        });

        this.jwksSets.set(idp.issuer, jwks);
        this.idpConfigs.set(idp.issuer, idp);
      } catch (error) {
        throw new Error(`Failed to initialize JWKS for IDP ${idp.issuer}: ${error}`);
      }
    }

    this.initialized = true;
  }

  /**
   * Validate a JWT token
   *
   * @param token - JWT token to validate
   * @param context - Optional validation context
   * @returns Validation result with payload and extracted claims
   * @throws {OAuthSecurityError} If validation fails
   */
  async validateJWT(
    token: string,
    context?: Partial<ValidationContext>
  ): Promise<JWTValidationResult> {
    if (!this.initialized) {
      throw createSecurityError(
        'VALIDATOR_NOT_INITIALIZED',
        'JWT validator not initialized. Call initialize() first.',
        500
      );
    }

    try {
      // Basic format validation
      this.validateTokenFormat(token);

      // Extract issuer and audience from token
      const { issuer, audience } = await this.extractClaims(token);

      // Get IDP configuration
      const idpConfig = this.idpConfigs.get(issuer);
      if (!idpConfig) {
        throw createSecurityError(
          'UNTRUSTED_ISSUER',
          `Untrusted issuer: ${issuer}`,
          401
        );
      }

      // Get JWKS resolver
      const jwks = this.jwksSets.get(issuer);
      if (!jwks) {
        throw createSecurityError(
          'JWKS_NOT_FOUND',
          `JWKS not found for issuer: ${issuer}`,
          500
        );
      }

      // Prepare validation context
      const validationContext: ValidationContext = {
        expectedIssuer: issuer,
        expectedAudiences: Array.isArray(audience) ? audience : [audience],
        clockTolerance: context?.clockTolerance ?? idpConfig.security.clockTolerance,
        maxTokenAge: context?.maxTokenAge ?? idpConfig.security.maxTokenAge,
      };

      // Verify JWT signature and claims
      const { payload } = await jwtVerify(token, jwks, {
        issuer: validationContext.expectedIssuer,
        audience: validationContext.expectedAudiences,
        algorithms: idpConfig.algorithms,
        clockTolerance: validationContext.clockTolerance,
        maxTokenAge: validationContext.maxTokenAge,
      });

      // Additional security validations
      this.validateSecurityRequirements(payload, idpConfig);

      // Extract claims using IDP mapping configuration
      const claims = this.extractMappedClaims(payload, idpConfig);

      return {
        payload: payload as JWTPayload,
        claims,
      };
    } catch (error) {
      if (error instanceof OAuthSecurityError || (error as any).code) {
        throw error;
      }

      // Wrap unexpected errors
      throw createSecurityError(
        'JWT_VALIDATION_FAILED',
        'JWT validation failed',
        401,
        { originalError: error instanceof Error ? error.message : 'Unknown error' }
      );
    }
  }

  /**
   * Validate token format (3 base64url parts)
   */
  private validateTokenFormat(token: string): void {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw createSecurityError('INVALID_TOKEN_FORMAT', 'Invalid JWT format', 400);
    }

    // Validate each part is valid base64url
    for (const part of parts) {
      if (!/^[A-Za-z0-9_-]+$/.test(part)) {
        throw createSecurityError('INVALID_TOKEN_ENCODING', 'Invalid JWT encoding', 400);
      }
    }
  }

  /**
   * Extract issuer and audience from token (without signature verification)
   */
  private async extractClaims(token: string): Promise<{
    issuer: string;
    audience: string | string[];
  }> {
    try {
      const [, payloadPart] = token.split('.');
      const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString());

      if (!payload.iss) {
        throw createSecurityError('MISSING_ISSUER', 'Missing issuer claim', 400);
      }

      if (!payload.aud) {
        throw createSecurityError('MISSING_AUDIENCE', 'Missing audience claim', 400);
      }

      return {
        issuer: payload.iss,
        audience: payload.aud,
      };
    } catch (error) {
      if (error instanceof OAuthSecurityError) {
        throw error;
      }
      throw createSecurityError('INVALID_TOKEN_PAYLOAD', 'Invalid JWT payload', 400);
    }
  }

  /**
   * Validate security requirements (RFC 8725, azp claim, etc.)
   */
  private validateSecurityRequirements(payload: JoseJWTPayload, idpConfig: IDPConfig): void {
    const now = Math.floor(Date.now() / 1000);

    // Check azp claim (critical for OAuth 2.1 security)
    const azp = (payload as any).azp;
    if (azp && azp !== idpConfig.audience) {
      throw createSecurityError(
        'AZP_MISMATCH',
        'Token authorized party claim is invalid',
        403
      );
    }

    // RFC 8725 validations
    if (idpConfig.security.requireNbf && !payload.nbf) {
      throw createSecurityError('MISSING_NBF', 'Token missing not-before claim', 400);
    }

    if (payload.nbf && payload.nbf > now + idpConfig.security.clockTolerance) {
      throw createSecurityError('TOKEN_NOT_YET_VALID', 'Token not yet valid', 401);
    }

    // Validate token age
    if (payload.iat && now - payload.iat > idpConfig.security.maxTokenAge) {
      throw createSecurityError('TOKEN_TOO_OLD', 'Token exceeds maximum age', 401);
    }

    // Additional security checks
    if (payload.exp && payload.exp < now - idpConfig.security.clockTolerance) {
      throw createSecurityError('TOKEN_EXPIRED', 'Token has expired', 401);
    }
  }

  /**
   * Extract claims using IDP mapping configuration
   */
  private extractMappedClaims(payload: JoseJWTPayload, idpConfig: IDPConfig): Record<string, unknown> {
    const claimMappings = idpConfig.claimMappings;

    // Extract mapped claims (support nested paths)
    const claims: Record<string, unknown> = {
      userId: this.getNestedClaim(payload, claimMappings.userId || 'sub'),
      username: this.getNestedClaim(payload, claimMappings.username || 'preferred_username'),
      legacyUsername: this.getNestedClaim(payload, claimMappings.legacyUsername),
      roles: this.getNestedClaim(payload, claimMappings.roles),
      scopes: this.getNestedClaim(payload, claimMappings.scopes || 'scope'),
      rawPayload: payload,
    };

    // Validate required claims
    // NOTE: legacyUsername is OPTIONAL in requestor JWT
    // It is only required in TE-JWT (Token Exchange result) for delegation
    // The delegation module will validate it when needed

    if (!claims.userId) {
      throw createSecurityError(
        'MISSING_USER_ID',
        `Missing required claim: ${claimMappings.userId || 'sub'}`,
        400
      );
    }

    return claims;
  }

  /**
   * Get nested claim value (supports dot notation like "realm_access.roles")
   */
  private getNestedClaim(payload: JoseJWTPayload, path: string): any {
    const parts = path.split('.');
    let value: any = payload;

    for (const part of parts) {
      if (value && typeof value === 'object') {
        value = value[part];
      } else {
        return undefined;
      }
    }

    return value;
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.jwksSets.clear();
    this.idpConfigs.clear();
    this.initialized = false;
  }
}
