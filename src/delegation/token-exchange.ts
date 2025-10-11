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
 * Phase 2: Encrypted caching (opt-in via config)
 *
 * Usage:
 * ```typescript
 * const service = new TokenExchangeService(config, auditService);
 * const result = await service.performExchange({
 *   subjectToken: userJWT,
 *   audience: 'sql-delegation',
 *   tokenEndpoint: 'https://idp.example.com/token',
 *   clientId: 'mcp-oauth',
 *   clientSecret: 'secret'
 * });
 * ```
 */
export class TokenExchangeService {
  private config: TokenExchangeConfig;
  private auditService: any; // Will be typed as AuditService once implemented
  private cache: EncryptedTokenCache | null = null;

  constructor(config: TokenExchangeConfig, auditService?: any) {
    this.config = config;
    this.auditService = auditService;
    this.validateConfig();

    // Initialize cache if enabled (Phase 2)
    if (config.cache?.enabled) {
      this.cache = new EncryptedTokenCache(config.cache, auditService);
    }
  }

  /**
   * Perform RFC 8693 token exchange (with optional caching)
   *
   * @param params - Token exchange parameters
   * @param sessionId - Optional session ID for caching (Phase 2)
   * @param jwtSubject - Optional JWT subject for cache ownership validation
   * @returns Exchange result with TE-JWT or error
   */
  async performExchange(
    params: TokenExchangeParams,
    sessionId?: string,
    jwtSubject?: string
  ): Promise<TokenExchangeResult> {
    const startTime = Date.now();

    try {
      // Validate parameters
      this.validateParams(params);

      // Phase 2: Check cache first (if enabled and session provided)
      if (this.cache && sessionId) {
        // Activate session if not already active
        if (jwtSubject) {
          this.cache.activateSession(params.subjectToken, jwtSubject);
        }

        // Generate cache key from audience
        const cacheKey = `te:${params.audience}`;

        // Try to get from cache
        console.log('[TokenExchange] Checking cache for delegation token:', { sessionId, cacheKey });
        const cachedToken = this.cache.get(sessionId, cacheKey, params.subjectToken);
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
      console.log('[TokenExchange] Making token exchange request to IDP:', {
        tokenEndpoint: params.tokenEndpoint,
        audience: params.audience,
        clientId: params.clientId,
        subjectTokenLength: params.subjectToken.length,
      });

      // Make POST request to IDP token endpoint
      const response = await fetch(params.tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: new URLSearchParams(requestBody).toString(),
      });

      console.log('[TokenExchange] IDP response status:', response.status);

      // Parse response
      const responseData = await response.json();
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
          issuedTokenType: responseData.issued_token_type || 'urn:ietf:params:oauth:token-type:access_token',
          tokenType: responseData.token_type || 'Bearer',
          expiresIn: responseData.expires_in,
          scope: responseData.scope,
          refreshToken: responseData.refresh_token,
        };

        // Phase 2: Store in cache (if enabled and session provided)
        if (this.cache && sessionId && responseData.expires_in) {
          const cacheKey = `te:${params.audience}`;
          const expiresAt = Math.floor(Date.now() / 1000) + responseData.expires_in;

          this.cache.set(
            sessionId,
            cacheKey,
            responseData.access_token,
            params.subjectToken,
            expiresAt
          );
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
            cacheEnabled: !!this.cache,
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
   * @returns Cache metrics or null if caching disabled
   */
  getCacheMetrics() {
    return this.cache?.getMetrics() ?? null;
  }

  /**
   * Heartbeat for session keep-alive (Phase 2)
   *
   * @param sessionId - Session ID
   */
  heartbeat(sessionId: string): void {
    this.cache?.heartbeat(sessionId);
  }

  /**
   * Clear session cache (Phase 2)
   *
   * @param sessionId - Session ID
   */
  clearSession(sessionId: string): void {
    this.cache?.clearSession(sessionId);
  }

  /**
   * Destroy service and cleanup resources
   */
  destroy(): void {
    this.cache?.destroy();
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Validate configuration
   */
  private validateConfig(): void {
    if (!this.config.tokenEndpoint) {
      throw createSecurityError(
        'TOKEN_EXCHANGE_CONFIG_INVALID',
        'Token exchange config missing tokenEndpoint',
        500
      );
    }

    // Allow HTTP in development/test mode only
    const isDev = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
    if (!isDev && !this.config.tokenEndpoint.startsWith('https://')) {
      throw createSecurityError(
        'TOKEN_EXCHANGE_INSECURE',
        'Token endpoint must use HTTPS in production',
        500
      );
    }

    if (!this.config.clientId || !this.config.clientSecret) {
      throw createSecurityError(
        'TOKEN_EXCHANGE_CONFIG_INVALID',
        'Token exchange config missing clientId or clientSecret',
        500
      );
    }
  }

  /**
   * Validate exchange parameters
   */
  private validateParams(params: TokenExchangeParams): void {
    if (!params.subjectToken) {
      throw createSecurityError(
        'TOKEN_EXCHANGE_INVALID_REQUEST',
        'Subject token is required',
        400
      );
    }

    // Allow HTTP in development/test mode only (same as validateConfig)
    const isDev = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
    if (!isDev && !params.tokenEndpoint.startsWith('https://')) {
      throw createSecurityError(
        'TOKEN_EXCHANGE_INSECURE',
        'Token endpoint must use HTTPS in production',
        400
      );
    }

    if (!params.audience) {
      throw createSecurityError(
        'TOKEN_EXCHANGE_INVALID_REQUEST',
        'Audience is required',
        400
      );
    }
  }

  /**
   * Build RFC 8693 request body
   */
  private buildRequestBody(params: TokenExchangeParams): Record<string, string> {
    const body: Record<string, string> = {
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: params.subjectToken,
      // Default to access_token type (RFC 8693) - required by Keycloak and most IDPs
      subject_token_type: params.subjectTokenType || 'urn:ietf:params:oauth:token-type:access_token',
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
