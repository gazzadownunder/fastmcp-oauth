import { jwtVerify, createRemoteJWKSet, JWTPayload as JoseJWTPayload } from 'jose';
import { configManager } from '../config/manager.js';
import type { JWTPayload, ValidationContext, UserSession, SecurityError, AuditEntry } from '../types/index.js';
import { createSecurityError, OAuthSecurityError } from '../utils/errors.js';

export class JWTValidator {
  private jwksSets: Map<string, ReturnType<typeof createRemoteJWKSet>> = new Map();
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const config = configManager.getConfig();

    // Initialize JWKS resolvers for all trusted IDPs
    for (const idp of config.trustedIDPs) {
      try {
        const jwks = createRemoteJWKSet(new URL(idp.jwksUri), {
          timeoutDuration: 5000,
          cooldownDuration: 30000,
          cacheMaxAge: 600000, // 10 minutes
        });

        this.jwksSets.set(idp.issuer, jwks);
      } catch (error) {
        throw new Error(`Failed to initialize JWKS for IDP ${idp.issuer}: ${error}`);
      }
    }

    this.initialized = true;
  }

  async validateJWT(token: string, context: Partial<ValidationContext> = {}): Promise<{
    payload: JWTPayload;
    session: UserSession;
    auditEntry: AuditEntry;
  }> {
    if (!this.initialized) {
      await this.initialize();
    }

    const auditEntry: AuditEntry = {
      timestamp: new Date(),
      userId: '',
      action: 'jwt_validation',
      resource: 'authentication',
      success: false,
    };

    try {
      // Basic format validation
      this.validateTokenFormat(token);

      // Decode header to get issuer
      const { issuer, audience } = await this.extractClaims(token);
      auditEntry.userId = issuer;

      // Get IDP configuration
      console.log(`[JWT VALIDATOR] Checking if issuer is trusted: ${issuer}`);
      const idpConfig = configManager.getTrustedIDP(issuer);
      if (!idpConfig) {
        console.error(`[JWT VALIDATOR] ✗ UNTRUSTED ISSUER: ${issuer}`);
        throw createSecurityError('UNTRUSTED_ISSUER', `Untrusted issuer: ${issuer}`, 401);
      }
      console.log(`[JWT VALIDATOR] ✓ Issuer is trusted`);

      // Get JWKS resolver
      console.log(`[JWT VALIDATOR] Looking up JWKS for issuer...`);
      const jwks = this.jwksSets.get(issuer);
      if (!jwks) {
        console.error(`[JWT VALIDATOR] ✗ JWKS not found for issuer: ${issuer}`);
        throw createSecurityError('JWKS_NOT_FOUND', `JWKS not found for issuer: ${issuer}`, 500);
      }
      console.log(`[JWT VALIDATOR] ✓ JWKS found`);

      // Prepare validation context
      const validationContext: ValidationContext = {
        expectedIssuer: issuer,
        expectedAudiences: Array.isArray(audience) ? audience : [audience],
        clockTolerance: context.clockTolerance ?? idpConfig.security.clockTolerance,
        maxTokenAge: context.maxTokenAge ?? idpConfig.security.maxTokenAge,
      };

      console.log(`[JWT VALIDATOR] Validation context:`);
      console.log(`  - Expected issuer: ${validationContext.expectedIssuer}`);
      console.log(`  - Expected audiences: ${JSON.stringify(validationContext.expectedAudiences)}`);
      console.log(`  - Clock tolerance: ${validationContext.clockTolerance}s`);
      console.log(`  - Max token age: ${validationContext.maxTokenAge}s`);

      // Verify JWT signature and claims
      console.log(`[JWT VALIDATOR] Verifying JWT signature and claims...`);
      const { payload } = await jwtVerify(token, jwks, {
        issuer: validationContext.expectedIssuer,
        audience: validationContext.expectedAudiences,
        algorithms: idpConfig.algorithms,
        clockTolerance: validationContext.clockTolerance,
        maxTokenAge: validationContext.maxTokenAge,
      });
      console.log(`[JWT VALIDATOR] ✓ JWT signature and basic claims verified`);

      // Additional security validations
      console.log(`[JWT VALIDATOR] Performing additional security validations...`);
      console.log(`[JWT VALIDATOR]   Checking azp (authorized party) claim...`);
      this.validateSecurityRequirements(payload, idpConfig);
      console.log(`[JWT VALIDATOR] ✓ Additional security validations passed`);

      // Create user session from JWT payload
      console.log(`[JWT VALIDATOR] Creating user session from JWT payload...`);
      const session = this.createUserSession(payload, idpConfig);
      auditEntry.userId = session.userId;
      auditEntry.legacyUsername = session.legacyUsername;
      auditEntry.success = true;
      console.log(`[JWT VALIDATOR] ✓ User session created`);

      return {
        payload: payload as JWTPayload,
        session,
        auditEntry,
      };
    } catch (error) {
      auditEntry.error = error instanceof Error ? error.message : 'Unknown error';

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

  private async extractClaims(token: string): Promise<{ issuer: string; audience: string | string[] }> {
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

  private validateSecurityRequirements(payload: JoseJWTPayload, idpConfig: any): void {
    const now = Math.floor(Date.now() / 1000);

    // Check azp claim (critical for OAuth 2.1 security)
    const azp = (payload as any).azp;
    console.log(`[JWT VALIDATOR]   - azp claim: ${azp || 'NOT PRESENT'}`);
    console.log(`[JWT VALIDATOR]   - Expected audience: ${idpConfig.audience}`);

    if (azp) {
      // CRITICAL: azp must match the expected audience for this service
      // This prevents token substitution attacks where a token for one service
      // is used to access another service
      if (azp !== idpConfig.audience) {
        console.error(`[JWT VALIDATOR] ✗ AZP MISMATCH: Token azp='${azp}' does not match expected audience='${idpConfig.audience}'`);
        console.error(`[JWT VALIDATOR]   This token was issued for a different client and cannot be used here`);
        throw createSecurityError(
          'AZP_MISMATCH',
          `Token authorized party '${azp}' does not match expected audience '${idpConfig.audience}'`,
          403
        );
      }
      console.log(`[JWT VALIDATOR]   ✓ azp claim matches expected audience`);
    } else {
      console.warn(`[JWT VALIDATOR]   ⚠ WARNING: azp claim not present in token (this is acceptable for some token types)`);
    }

    // RFC 8725 validations
    console.log(`[JWT VALIDATOR]   Checking temporal claims (nbf, iat, exp)...`);
    if (idpConfig.security.requireNbf && !payload.nbf) {
      console.error(`[JWT VALIDATOR] ✗ MISSING NBF: Token missing not-before claim`);
      throw createSecurityError('MISSING_NBF', 'Token missing not-before claim', 400);
    }

    if (payload.nbf && payload.nbf > now + idpConfig.security.clockTolerance) {
      console.error(`[JWT VALIDATOR] ✗ TOKEN NOT YET VALID: nbf=${payload.nbf}, now=${now}`);
      throw createSecurityError('TOKEN_NOT_YET_VALID', 'Token not yet valid', 401);
    }

    // Validate token age
    if (payload.iat && (now - payload.iat) > idpConfig.security.maxTokenAge) {
      const age = now - payload.iat;
      console.error(`[JWT VALIDATOR] ✗ TOKEN TOO OLD: age=${age}s, max=${idpConfig.security.maxTokenAge}s`);
      throw createSecurityError('TOKEN_TOO_OLD', 'Token exceeds maximum age', 401);
    }

    // Additional security checks
    if (payload.exp && payload.exp < now - idpConfig.security.clockTolerance) {
      console.error(`[JWT VALIDATOR] ✗ TOKEN EXPIRED: exp=${payload.exp}, now=${now}`);
      throw createSecurityError('TOKEN_EXPIRED', 'Token has expired', 401);
    }

    console.log(`[JWT VALIDATOR]   ✓ All temporal claims valid`);
  }

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

  private createUserSession(payload: JoseJWTPayload, idpConfig: any): UserSession {
    const claimMappings = idpConfig.claimMappings;

    // Extract mapped claims (support nested paths like "realm_access.roles")
    const legacyUsername = this.getNestedClaim(payload, claimMappings.legacyUsername) as string;
    const roles = this.getNestedClaim(payload, claimMappings.roles) as string | string[];
    const scopes = this.getNestedClaim(payload, claimMappings.scopes) as string | string[];
    const userId = this.getNestedClaim(payload, claimMappings.userId || 'sub') as string;
    const username = this.getNestedClaim(payload, claimMappings.username || 'preferred_username') as string;

    if (!legacyUsername) {
      throw createSecurityError(
        'MISSING_LEGACY_USERNAME',
        `Missing required claim: ${claimMappings.legacyUsername}`,
        400
      );
    }

    if (!userId) {
      throw createSecurityError(
        'MISSING_USER_ID',
        `Missing required claim: ${claimMappings.userId || 'sub'}`,
        400
      );
    }

    // Determine user role from roles claim
    const roleArray = Array.isArray(roles) ? roles : [roles].filter(Boolean);
    const primaryRole = this.determinePrimaryRole(roleArray);

    // Convert scopes to array
    const scopeArray = Array.isArray(scopes) ? scopes :
                      typeof scopes === 'string' ? scopes.split(' ') : [];

    return {
      userId,
      username: username || userId,
      legacyUsername,
      role: primaryRole,
      permissions: scopeArray,
      scopes: scopeArray,
      claims: payload as Record<string, unknown>,
    };
  }

  private determinePrimaryRole(roles: string[]): 'admin' | 'user' | 'guest' {
    if (roles.includes('admin') || roles.includes('administrator')) {
      return 'admin';
    }
    if (roles.includes('user') || roles.length > 0) {
      return 'user';
    }
    return 'guest';
  }

  // Rate limiting and security monitoring
  async validateWithRateLimit(
    token: string,
    clientId: string,
    context: Partial<ValidationContext> = {}
  ): Promise<{ payload: JWTPayload; session: UserSession; auditEntry: AuditEntry }> {
    // TODO: Implement rate limiting logic here
    // For now, delegate to standard validation
    return this.validateJWT(token, context);
  }

  // Cleanup resources
  destroy(): void {
    this.jwksSets.clear();
    this.initialized = false;
  }
}

export const jwtValidator = new JWTValidator();