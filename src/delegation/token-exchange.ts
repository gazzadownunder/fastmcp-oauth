/**
 * Token Exchange Service (RFC 8693)
 *
 * Implements OAuth 2.0 Token Exchange for on-behalf-of (OBO) delegation.
 * Exchanges subject tokens for delegation tokens with appropriate claims.
 *
 * Security Features:
 * - Optional encrypted token caching (Phase 2)
 * - HTTPS-only token endpoints
 * - Comprehensive audit logging
 * - Error sanitization
 *
 * Architecture: Core → Delegation → MCP
 * Delegation layer CAN import from Core, but NOT from MCP
 *
 * @see https://datatracker.ietf.org/doc/html/rfc8693
 */

import type { AuditEntry } from '../core/index.js';
import type {
  TokenExchangeParams,
  TokenExchangeResult,
  TokenExchangeConfig,
  DelegationTokenClaims,
} from './types.js';
import { EncryptedTokenCache } from './encrypted-token-cache.js';
import { createSecurityError } from '../utils/errors.js';

// ============================================================================
// Token Exchange Service
// ============================================================================

/**
 * TokenExchangeService - Token exchange with optional encrypted caching
 *
 * Exchanges subject tokens (from user authentication) for delegation tokens
 * (TE-JWT) that can be used by delegation modules.
 *
 * Phase 1: Stateless (cache disabled)
 * Phase 2: Per-module config (shared service, config passed per-call)
 *
 * Usage (Phase 2 - Per-Module):
 * ```typescript
 * // Create shared service (no config)
 * const service = new TokenExchangeService(auditService);
 *
 * // Delegation modules call with their own config
 * const result = await service.performExchange({
 *   requestorJWT: userJWT,
 *   audience: 'sql-delegation',
 *   tokenEndpoint: 'https://idp.example.com/token',
 *   clientId: 'mcp-oauth',
 *   clientSecret: 'secret'
 * });
 * ```
 */
export class TokenExchangeService {
  private auditService: any; // Will be typed as AuditService once implemented
  private caches: Map<string, EncryptedTokenCache> = new Map();

  /**
   * Constructor - Phase 2: No config required (shared service)
   *
   * @param auditService - Audit service for logging
   */
  constructor(auditService?: any) {
    this.auditService = auditService;
  }

  /**
   * Perform RFC 8693 token exchange (with optional caching)
   *
   * Phase 2: Config passed per-call (not in constructor)
   *
   * @param params - Token exchange parameters (includes all config)
   * @returns Exchange result with TE-JWT or error
   */
  async performExchange(params: TokenExchangeParams): Promise<TokenExchangeResult> {
    const startTime = Date.now();

    try {
      // Validate parameters
      this.validateParams(params);

      // Get or create cache for this module (if caching enabled)
      const cache = this.getOrCreateCache(params);
      let sessionId = params.sessionId;

      // Phase 2: Auto-generate session ID from JWT if not provided (stateless mode support)
      // This enables caching in stateless OAuth mode where no explicit session ID exists
      const requestorJWT = params.requestorJWT || params.subjectToken;
      if (!sessionId && cache && requestorJWT) {
        const jwtSubject = this.extractSubjectFromJWT(requestorJWT);
        if (jwtSubject) {
          // activateSession generates sessionId from JWT hash and returns it
          sessionId = cache.activateSession(requestorJWT, jwtSubject);
          console.log(
            '[TokenExchange] Auto-generated session ID from JWT for stateless mode:',
            sessionId.substring(0, 16) + '...'
          );
        }
      }

      // Phase 2: Check cache first (if enabled and session available)
      if (cache && sessionId) {
        // In stateful mode, activate session if not already active
        // In stateless mode, session was already activated above
        if (params.sessionId && requestorJWT) {
          const jwtSubject = this.extractSubjectFromJWT(requestorJWT);
          if (jwtSubject) {
            cache.activateSession(requestorJWT, jwtSubject);
          }
        }

        // Generate cache key from audience
        const cacheKey = `te:${params.audience}`;

        // Try to get from cache
        console.log('[TokenExchange] Checking cache for delegation token:', {
          sessionId,
          cacheKey,
        });
        const cachedToken = cache.get(sessionId, cacheKey, requestorJWT);
        if (cachedToken) {
          // Cache hit!
          console.log('[TokenExchange] CACHE HIT - using cached delegation token');
          return {
            success: true,
            accessToken: cachedToken,
            tokenType: 'Bearer',
            issuedTokenType: 'urn:ietf:params:oauth:token-type:access_token',
          };
        }
        console.log('[TokenExchange] Cache miss - will request new token from IDP');
      }

      // Build RFC 8693 request body
      const requestBody = this.buildRequestBody(params);
      const subjectToken = params.requestorJWT || params.subjectToken;
      console.log('[TokenExchange] Making token exchange request to IDP:', {
        tokenEndpoint: params.tokenEndpoint,
        audience: params.audience,
        clientId: params.clientId,
        subjectTokenLength: subjectToken?.length,
      });

      // Make POST request to IDP token endpoint
      const response = await fetch(params.tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams(requestBody).toString(),
      });

      console.log('[TokenExchange] IDP response status:', response.status);

      // Parse response
      const responseData = (await response.json()) as Record<string, any>;
      console.log('[TokenExchange] IDP response data:', {
        hasAccessToken: !!responseData.access_token,
        tokenType: responseData.token_type,
        expiresIn: responseData.expires_in,
        error: responseData.error,
        errorDescription: responseData.error_description,
      });

      // Handle success
      if (response.ok && responseData.access_token) {
        console.log('[TokenExchange] Token exchange SUCCESS - received delegation token');

        const result: TokenExchangeResult = {
          success: true,
          accessToken: responseData.access_token,
          issuedTokenType:
            responseData.issued_token_type || 'urn:ietf:params:oauth:token-type:access_token',
          tokenType: responseData.token_type || 'Bearer',
          expiresIn: responseData.expires_in,
          scope: responseData.scope,
          refreshToken: responseData.refresh_token,
        };

        // Phase 2: Store in cache (if enabled and session available)
        // Note: sessionId may be explicit (stateful) or auto-generated from JWT (stateless)
        if (cache && sessionId && responseData.expires_in) {
          const cacheKey = `te:${params.audience}`;
          const expiresAt = Math.floor(Date.now() / 1000) + responseData.expires_in;
          const storeRequestorJWT = params.requestorJWT || params.subjectToken;

          if (storeRequestorJWT) {
            cache.set(sessionId, cacheKey, responseData.access_token, storeRequestorJWT, expiresAt);
            console.log('[TokenExchange] Stored delegation token in cache:', {
              sessionId: sessionId.substring(0, 16) + '...',
              cacheKey,
              expiresAt,
            });
          }
        }

        // Audit success
        await this.logAudit({
          timestamp: new Date(),
          source: 'delegation:token-exchange',
          action: 'token_exchange',
          success: true,
          metadata: {
            audience: params.audience,
            tokenEndpoint: params.tokenEndpoint,
            durationMs: Date.now() - startTime,
            cacheEnabled: !!cache,
          },
        });

        return result;
      }

      // Handle error response
      const result: TokenExchangeResult = {
        success: false,
        error: responseData.error || 'unknown_error',
        errorDescription: responseData.error_description || `HTTP ${response.status}`,
      };

      // Audit failure
      await this.logAudit({
        timestamp: new Date(),
        source: 'delegation:token-exchange',
        action: 'token_exchange',
        success: false,
        error: result.error,
        reason: result.errorDescription,
        metadata: {
          audience: params.audience,
          tokenEndpoint: params.tokenEndpoint,
          httpStatus: response.status,
          durationMs: Date.now() - startTime,
        },
      });

      return result;
    } catch (error) {
      // Handle network/fetch errors
      const errorMessage = error instanceof Error ? error.message : 'Token exchange failed';

      await this.logAudit({
        timestamp: new Date(),
        source: 'delegation:token-exchange',
        action: 'token_exchange',
        success: false,
        error: errorMessage,
        metadata: {
          audience: params.audience,
          tokenEndpoint: params.tokenEndpoint,
          durationMs: Date.now() - startTime,
        },
      });

      return {
        success: false,
        error: 'request_failed',
        errorDescription: errorMessage,
      };
    }
  }

  /**
   * Decode delegation token claims (without verification)
   *
   * WARNING: This method only decodes the JWT payload, it does NOT verify
   * the signature. Token verification should be done by delegation modules
   * if needed.
   *
   * @param token - TE-JWT token
   * @returns Decoded claims
   */
  decodeTokenClaims(token: string): DelegationTokenClaims | null {
    try {
      // Split JWT into parts
      const parts = token.split('.');
      if (parts.length !== 3) {
        return null;
      }

      // Decode payload (base64url)
      const payload = parts[1];
      const decoded = Buffer.from(payload, 'base64url').toString('utf-8');
      const claims = JSON.parse(decoded);

      return claims as DelegationTokenClaims;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get cache metrics (Phase 2)
   *
   * @returns Combined cache metrics from all modules
   */
  getCacheMetrics() {
    const allMetrics = Array.from(this.caches.values()).map((cache) => cache.getMetrics());
    if (allMetrics.length === 0) return null;

    // Aggregate metrics
    return allMetrics.reduce((acc, metrics) => ({
      hits: acc.hits + metrics.hits,
      misses: acc.misses + metrics.misses,
      decryptionFailures: acc.decryptionFailures + metrics.decryptionFailures,
      activeSessions: acc.activeSessions + metrics.activeSessions,
      totalEntries: acc.totalEntries + metrics.totalEntries,
      memoryUsageBytes: acc.memoryUsageBytes + metrics.memoryUsageBytes,
    }));
  }

  /**
   * Heartbeat for session keep-alive (Phase 2)
   *
   * @param sessionId - Session ID
   */
  heartbeat(sessionId: string): void {
    this.caches.forEach((cache) => cache.heartbeat(sessionId));
  }

  /**
   * Clear session cache (Phase 2)
   *
   * @param sessionId - Session ID
   */
  clearSession(sessionId: string): void {
    this.caches.forEach((cache) => cache.clearSession(sessionId));
  }

  /**
   * Destroy service and cleanup resources
   */
  destroy(): void {
    this.caches.forEach((cache) => cache.destroy());
    this.caches.clear();
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Get or create cache for a module
   *
   * Phase 2: Each module can have its own cache configuration
   *
   * @param params - Token exchange parameters with cache config
   * @returns Cache instance or null if caching disabled
   */
  private getOrCreateCache(params: TokenExchangeParams): EncryptedTokenCache | null {
    // Check if caching is enabled for this module
    if (!params.cache?.enabled) {
      return null;
    }

    // Use audience as cache key (each module/audience gets its own cache)
    const cacheKey = params.audience || 'default';

    // Return existing cache or create new one
    if (!this.caches.has(cacheKey)) {
      this.caches.set(cacheKey, new EncryptedTokenCache(params.cache, this.auditService));
    }

    return this.caches.get(cacheKey)!;
  }

  /**
   * Extract subject from JWT (for cache ownership)
   *
   * @param jwt - JWT token
   * @returns Subject or null
   */
  private extractSubjectFromJWT(jwt: string): string | null {
    try {
      const parts = jwt.split('.');
      if (parts.length !== 3) return null;

      const payload = parts[1];
      const decoded = Buffer.from(payload, 'base64url').toString('utf-8');
      const claims = JSON.parse(decoded);

      return claims.sub || null;
    } catch {
      return null;
    }
  }

  /**
   * Validate exchange parameters
   *
   * Phase 2: Config now in params (not constructor)
   */
  private validateParams(params: TokenExchangeParams): void {
    // Validate required token parameter
    const subjectToken = params.requestorJWT || params.subjectToken;
    if (!subjectToken) {
      throw createSecurityError(
        'TOKEN_EXCHANGE_INVALID_REQUEST',
        'Subject token (requestorJWT or subjectToken) is required',
        400
      );
    }

    // Validate required config parameters
    if (!params.tokenEndpoint) {
      throw createSecurityError(
        'TOKEN_EXCHANGE_CONFIG_INVALID',
        'Token exchange config missing tokenEndpoint',
        400
      );
    }

    if (!params.clientId || !params.clientSecret) {
      throw createSecurityError(
        'TOKEN_EXCHANGE_CONFIG_INVALID',
        'Token exchange config missing clientId or clientSecret',
        400
      );
    }

    // Allow HTTP in development/test mode only
    const isDev = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
    if (!isDev && !params.tokenEndpoint.startsWith('https://')) {
      throw createSecurityError(
        'TOKEN_EXCHANGE_INSECURE',
        'Token endpoint must use HTTPS in production',
        400
      );
    }

    if (!params.audience) {
      throw createSecurityError('TOKEN_EXCHANGE_INVALID_REQUEST', 'Audience is required', 400);
    }
  }

  /**
   * Build RFC 8693 request body
   */
  private buildRequestBody(params: TokenExchangeParams): Record<string, string> {
    // Use requestorJWT if provided (Phase 2), otherwise subjectToken (backward compat)
    const subjectToken = params.requestorJWT || params.subjectToken;

    const body: Record<string, string> = {
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: subjectToken,
      // Default to access_token type (RFC 8693) - required by Keycloak and most IDPs
      subject_token_type:
        params.subjectTokenType || 'urn:ietf:params:oauth:token-type:access_token',
      audience: params.audience,
      client_id: params.clientId,
      client_secret: params.clientSecret,
    };

    if (params.requestedTokenType) {
      body.requested_token_type = params.requestedTokenType;
    }

    if (params.resource) {
      body.resource = params.resource;
    }

    // RFC 8693: Optional scope parameter (space-separated list)
    if (params.scope) {
      body.scope = params.scope;
    }

    return body;
  }

  /**
   * Log audit entry (Null Object Pattern)
   */
  private async logAudit(entry: AuditEntry): Promise<void> {
    if (this.auditService && typeof this.auditService.log === 'function') {
      try {
        await this.auditService.log(entry);
      } catch (error) {
        // Silently fail - audit logging should never crash the service
        console.error('Failed to log audit entry:', error);
      }
    }
  }
}
