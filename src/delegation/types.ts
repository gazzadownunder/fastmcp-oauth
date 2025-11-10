/**
 * Delegation Layer Types
 *
 * Type definitions for token exchange and delegation modules.
 * This file extends the base delegation types with token exchange capabilities.
 *
 * Architecture: Core → Delegation → MCP
 * Delegation layer CAN import from Core, but NOT from MCP
 */

// ============================================================================
// Token Exchange Types (RFC 8693)
// ============================================================================

/**
 * Parameters for RFC 8693 token exchange request
 *
 * @see https://datatracker.ietf.org/doc/html/rfc8693
 */
export interface TokenExchangeParams {
  /** The requestor's JWT (subject token) */
  subjectToken: string;

  /** Alias for subjectToken (backward compatibility) */
  requestorJWT?: string;

  /** Type of the subject token (urn:ietf:params:oauth:token-type:jwt) */
  subjectTokenType: string;

  /** Target audience for the exchanged token */
  audience: string;

  /** IDP token endpoint URL */
  tokenEndpoint: string;

  /** Client ID for token exchange */
  clientId: string;

  /** Client secret for token exchange */
  clientSecret: string;

  /** Optional: Requested token type (defaults to access_token) */
  requestedTokenType?: string;

  /** Optional: Resource identifier */
  resource?: string;

  /** Optional: Scope for the exchanged token */
  scope?: string;

  /** Optional: Session ID for caching */
  sessionId?: string;

  /** Optional: Cache configuration */
  cache?: {
    /** Whether cache is enabled (default: false) */
    enabled?: boolean;

    /** Cache TTL in seconds (default: 60) */
    ttlSeconds?: number;

    /** Session timeout in milliseconds (default: 900000 = 15 min) */
    sessionTimeoutMs?: number;

    /** Max entries per session (default: 10) */
    maxEntriesPerSession?: number;

    /** Max total entries across all sessions (default: 1000) */
    maxTotalEntries?: number;
  };
}

/**
 * Result of a token exchange operation
 */
export interface TokenExchangeResult {
  /** Whether the exchange succeeded */
  success: boolean;

  /** The exchanged delegation token (TE-JWT) */
  accessToken?: string;

  /** Type of the issued token */
  issuedTokenType?: string;

  /** Token type (usually "Bearer") */
  tokenType?: string;

  /** Expiration time in seconds */
  expiresIn?: number;

  /** Optional: Scope granted */
  scope?: string;

  /** Optional: Refresh token */
  refreshToken?: string;

  /** Error code if exchange failed */
  error?: string;

  /** Error description if exchange failed */
  errorDescription?: string;
}

/**
 * Parsed claims from a delegation token (TE-JWT)
 *
 * These claims are extracted from the exchanged token and used by
 * delegation modules for authorization decisions.
 */
export interface DelegationTokenClaims {
  /** Subject (user ID) */
  sub: string;

  /** Audience (must match expected audience) */
  aud: string | string[];

  /** Issuer */
  iss: string;

  /** Expiration time (Unix timestamp) */
  exp: number;

  /** Issued at (Unix timestamp) */
  iat: number;

  /** Not before (Unix timestamp) */
  nbf?: number;

  /** Legacy username for SQL Server delegation (custom claim) */
  legacy_name?: string;

  /** Roles in the delegation context (custom claim) */
  roles?: string[];

  /** Permissions in the delegation context (custom claim) */
  permissions?: string[];

  /** Authorized party (client that obtained the token) */
  azp?: string;

  /** Actor claim (contains original subject details) */
  act?: {
    sub: string;
    [key: string]: any;
  };

  /** Raw claims for extensibility */
  [key: string]: any;
}

/**
 * Configuration for token exchange
 */
export interface TokenExchangeConfig {
  /** IDP token endpoint URL */
  tokenEndpoint: string;

  /** Client ID for token exchange */
  clientId: string;

  /** Client secret for token exchange */
  clientSecret: string;

  /** Expected audience for delegation tokens */
  audience?: string;

  /** Optional: Resource identifier */
  resource?: string;

  /**
   * Optional: Space-separated list of OAuth scopes to request (RFC 8693)
   * Examples: "openid profile", "sql:read sql:write", "read write"
   */
  scope?: string;

  /** Optional: Cache configuration */
  cache?: {
    /** Whether cache is enabled (default: false) */
    enabled?: boolean;

    /** Cache TTL in seconds (default: 60) */
    ttlSeconds?: number;

    /** Session timeout in milliseconds (default: 900000 = 15 min) */
    sessionTimeoutMs?: number;

    /** Max entries per session (default: 10) */
    maxEntriesPerSession?: number;

    /** Max total entries across all sessions (default: 1000) */
    maxTotalEntries?: number;
  };
}
