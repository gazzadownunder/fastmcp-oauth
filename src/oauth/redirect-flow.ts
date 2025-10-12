/**
 * OAuth 2.1 Authorization Code Flow with PKCE
 *
 * This module implements the OAuth 2.1 authorization code flow with PKCE (RFC 7636)
 * for clients that cannot obtain bearer tokens upfront (e.g., browser-based MCP clients).
 *
 * Flow:
 * 1. Client calls /oauth/authorize → Redirects to IDP with PKCE challenge
 * 2. User authenticates at IDP
 * 3. IDP redirects to /oauth/callback with authorization code
 * 4. Server exchanges code for access token using PKCE verifier
 * 5. Client receives access token to use as bearer token for MCP requests
 *
 * Security Features:
 * - PKCE (Proof Key for Code Exchange) prevents authorization code interception
 * - State parameter prevents CSRF attacks
 * - Redirect URI allowlist prevents open redirects
 * - Authorization code single-use enforcement
 * - Session timeout (5 minutes default)
 */

import crypto from 'crypto';
import { AuditService } from '../core/audit-service.js';
import type { AuditEntry } from '../core/types.js';

/**
 * OAuth redirect configuration
 */
export interface OAuthRedirectConfig {
  enabled: boolean;
  authorizeEndpoint: string; // IDP authorize URL
  tokenEndpoint: string; // IDP token exchange URL
  clientId: string;
  clientSecret?: string; // Optional for public clients
  pkce: {
    enabled: boolean; // Always true in OAuth 2.1
    method: 'S256'; // Only SHA-256 supported
  };
  redirectUris: string[]; // Allowlist of valid redirect URIs
  callbackPath: string; // Default: /oauth/callback
  sessionTTL: number; // Session timeout in seconds (default: 300 = 5 minutes)
  defaultScopes: string[]; // Default: ['openid', 'profile']
}

/**
 * OAuth session stored temporarily during authorization flow
 */
interface OAuthSession {
  sessionId: string;
  codeVerifier: string; // PKCE code verifier
  codeChallenge: string; // PKCE code challenge
  state: string; // CSRF protection state parameter
  redirectUri: string; // Original redirect URI
  scopes: string[]; // Requested scopes
  createdAt: number; // Timestamp (ms)
  expiresAt: number; // Expiry timestamp (ms)
}

/**
 * Authorization request parameters
 */
export interface AuthorizeParams {
  redirectUri: string;
  scopes?: string[];
  state?: string; // Optional client-provided state
}

/**
 * Authorization URL result
 */
export interface AuthorizeResult {
  authorizeUrl: string;
  state: string; // Generated or provided state
  sessionId: string;
}

/**
 * Callback request parameters
 */
export interface CallbackParams {
  code: string; // Authorization code from IDP
  state: string; // State parameter from IDP
  sessionId: string; // Session ID from client
}

/**
 * Token exchange result
 */
export interface TokenExchangeResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  tokenType: string;
  scope?: string;
}

/**
 * OAuth 2.1 Redirect Flow Handler
 *
 * Implements authorization code flow with PKCE for browser-based clients.
 * Maintains temporary sessions for PKCE code verifiers and state validation.
 */
export class OAuthRedirectFlow {
  private sessions: Map<string, OAuthSession> = new Map();
  private cleanupInterval?: NodeJS.Timeout;

  constructor(
    private config: OAuthRedirectConfig,
    private auditService: AuditService | null = null
  ) {
    // Start session cleanup interval (runs every minute)
    this.cleanupInterval = setInterval(() => this.cleanupExpiredSessions(), 60000);
  }

  /**
   * Generate authorization URL for user to authenticate at IDP
   *
   * @param params Authorization request parameters
   * @returns Authorization URL, state, and session ID
   */
  async authorize(params: AuthorizeParams): Promise<AuthorizeResult> {
    // Validate redirect URI against allowlist
    if (!this.config.redirectUris.includes(params.redirectUri)) {
      this.audit('oauth_authorize_rejected', false, {
        reason: 'Invalid redirect URI',
        redirectUri: params.redirectUri,
      });
      throw new Error('Invalid redirect URI - not in allowlist');
    }

    // Generate PKCE code verifier and challenge
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = await this.generateCodeChallenge(codeVerifier);

    // Generate session ID and state parameter
    const sessionId = this.generateSessionId();
    const state = params.state || this.generateState();

    // Create OAuth session
    const session: OAuthSession = {
      sessionId,
      codeVerifier,
      codeChallenge,
      state,
      redirectUri: params.redirectUri,
      scopes: params.scopes || this.config.defaultScopes,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.config.sessionTTL * 1000,
    };

    this.sessions.set(sessionId, session);

    // Build authorization URL
    const authorizeUrl = this.buildAuthorizeUrl(session);

    this.audit('oauth_authorize_initiated', true, {
      sessionId,
      redirectUri: params.redirectUri,
      scopes: session.scopes,
    });

    return {
      authorizeUrl,
      state,
      sessionId,
    };
  }

  /**
   * Handle callback from IDP and exchange authorization code for access token
   *
   * @param params Callback parameters from IDP redirect
   * @returns Access token and metadata
   */
  async callback(params: CallbackParams): Promise<TokenExchangeResult> {
    // Retrieve OAuth session
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      this.audit('oauth_callback_failed', false, {
        reason: 'Session not found',
        sessionId: params.sessionId,
      });
      throw new Error('OAuth session not found or expired');
    }

    // Validate session not expired
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(params.sessionId);
      this.audit('oauth_callback_failed', false, {
        reason: 'Session expired',
        sessionId: params.sessionId,
      });
      throw new Error('OAuth session expired');
    }

    // Validate state parameter (CSRF protection)
    if (params.state !== session.state) {
      this.audit('oauth_callback_failed', false, {
        reason: 'State mismatch (CSRF)',
        sessionId: params.sessionId,
      });
      throw new Error('Invalid state parameter - possible CSRF attack');
    }

    try {
      // Exchange authorization code for access token
      const tokenResult = await this.exchangeCodeForToken(params.code, session);

      // Delete session (authorization code is single-use)
      this.sessions.delete(params.sessionId);

      this.audit('oauth_callback_success', true, {
        sessionId: params.sessionId,
        expiresIn: tokenResult.expiresIn,
      });

      return tokenResult;
    } catch (error) {
      this.audit('oauth_callback_failed', false, {
        reason: 'Token exchange failed',
        sessionId: params.sessionId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Generate PKCE code verifier (43-128 characters, base64url encoded random string)
   *
   * @returns Code verifier string
   */
  private generateCodeVerifier(): string {
    // Generate 32 random bytes (43 characters base64url encoded)
    const buffer = crypto.randomBytes(32);
    return this.base64UrlEncode(buffer);
  }

  /**
   * Generate PKCE code challenge from code verifier using SHA-256
   *
   * @param verifier Code verifier string
   * @returns Code challenge string
   */
  private async generateCodeChallenge(verifier: string): Promise<string> {
    // SHA-256 hash of code verifier
    const hash = crypto.createHash('sha256').update(verifier).digest();
    return this.base64UrlEncode(hash);
  }

  /**
   * Generate unique session ID
   *
   * @returns Session ID string
   */
  private generateSessionId(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Generate random state parameter for CSRF protection
   *
   * @returns State string
   */
  private generateState(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Base64url encode a buffer (URL-safe base64 without padding)
   *
   * @param buffer Buffer to encode
   * @returns Base64url encoded string
   */
  private base64UrlEncode(buffer: Buffer): string {
    return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  /**
   * Build authorization URL with PKCE parameters
   *
   * @param session OAuth session
   * @returns Authorization URL
   */
  private buildAuthorizeUrl(session: OAuthSession): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: session.redirectUri,
      scope: session.scopes.join(' '),
      state: session.state,
      code_challenge: session.codeChallenge,
      code_challenge_method: this.config.pkce.method,
    });

    return `${this.config.authorizeEndpoint}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token using PKCE
   *
   * @param code Authorization code from IDP
   * @param session OAuth session containing PKCE verifier
   * @returns Token exchange result
   */
  private async exchangeCodeForToken(
    code: string,
    session: OAuthSession
  ): Promise<TokenExchangeResult> {
    // Build token exchange request
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: session.redirectUri,
      client_id: this.config.clientId,
      code_verifier: session.codeVerifier, // PKCE verifier
    });

    // Add client secret if provided (confidential clients)
    if (this.config.clientSecret) {
      body.append('client_secret', this.config.clientSecret);
    }

    // Make token exchange request
    const response = await fetch(this.config.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token exchange failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in || 3600,
      tokenType: data.token_type || 'Bearer',
      scope: data.scope,
    };
  }

  /**
   * Clean up expired OAuth sessions
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      if (now > session.expiresAt) {
        this.sessions.delete(sessionId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.audit('oauth_session_cleanup', true, {
        cleanedCount,
        remainingSessions: this.sessions.size,
      });
    }
  }

  /**
   * Get session metrics
   */
  getMetrics(): {
    activeSessions: number;
    oldestSessionAge: number;
  } {
    const now = Date.now();
    let oldestSessionAge = 0;

    for (const session of this.sessions.values()) {
      const age = now - session.createdAt;
      if (age > oldestSessionAge) {
        oldestSessionAge = age;
      }
    }

    return {
      activeSessions: this.sessions.size,
      oldestSessionAge: Math.floor(oldestSessionAge / 1000), // Convert to seconds
    };
  }

  /**
   * Audit log helper
   */
  private audit(action: string, success: boolean, metadata: Record<string, any>): void {
    if (!this.auditService) return;

    const entry: AuditEntry = {
      timestamp: new Date(),
      action,
      userId: metadata.sessionId || 'anonymous',
      resource: 'oauth_redirect',
      success,
      metadata,
    };

    this.auditService.log(entry);
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    this.sessions.clear();
  }
}
