import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Helper utilities for interacting with Keycloak IDP
 */

export interface KeycloakConfig {
  url: string;
  realm: string;
  clientIdContextflow: string;
  clientIdMcp: string;
  clientSecretMcp: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

export interface JWTClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat: number;
  azp?: string;
  legacy_sam_account?: string;
  realm_access?: {
    roles: string[];
  };
  [key: string]: any;
}

export class KeycloakHelper {
  private config: KeycloakConfig;

  constructor(config: KeycloakConfig) {
    this.config = config;
  }

  /**
   * Load configuration from test.env file
   */
  static loadFromEnv(envPath: string = '../config/test.env'): KeycloakHelper {
    const envContent = readFileSync(join(__dirname, envPath), 'utf8');
    const env: Record<string, string> = {};

    envContent.split('\n').forEach(line => {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) {
        env[match[1].trim()] = match[2].trim();
      }
    });

    return new KeycloakHelper({
      url: env.KEYCLOAK_URL || 'http://localhost:8080',
      realm: env.KEYCLOAK_REALM || 'mcp-security',
      clientIdContextflow: env.KEYCLOAK_CLIENT_ID_CONTEXTFLOW || 'contextflow',
      clientIdMcp: env.KEYCLOAK_CLIENT_ID_MCP || 'mcp-oauth',
      clientSecretMcp: env.KEYCLOAK_CLIENT_SECRET_MCP || '',
    });
  }

  /**
   * Get token endpoint URL
   */
  getTokenEndpoint(): string {
    return `${this.config.url}/realms/${this.config.realm}/protocol/openid-connect/token`;
  }

  /**
   * Get JWKS endpoint URL
   */
  getJwksEndpoint(): string {
    return `${this.config.url}/realms/${this.config.realm}/protocol/openid-connect/certs`;
  }

  /**
   * Obtain Subject Token using Resource Owner Password Credentials
   * (for testing only - not recommended for production)
   */
  async getSubjectToken(username: string, password: string): Promise<string> {
    const params = new URLSearchParams({
      grant_type: 'password',
      client_id: this.config.clientIdContextflow,
      username,
      password,
      scope: 'openid profile email',
    });

    const response = await fetch(this.getTokenEndpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to get subject token: ${JSON.stringify(error)}`);
    }

    const tokenResponse: TokenResponse = await response.json();
    return tokenResponse.access_token;
  }

  /**
   * Exchange Subject Token for Delegated Token (RFC 8693)
   */
  async exchangeToken(subjectToken: string, audience: string = 'mcp-oauth'): Promise<string> {
    const params = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: subjectToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      audience,
      requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    });

    const credentials = Buffer.from(
      `${this.config.clientIdMcp}:${this.config.clientSecretMcp}`
    ).toString('base64');

    const response = await fetch(this.getTokenEndpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`,
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to exchange token: ${JSON.stringify(error)}`);
    }

    const tokenResponse: TokenResponse = await response.json();
    return tokenResponse.access_token;
  }

  /**
   * Decode JWT without verification (for inspection only)
   */
  static decodeToken(token: string): JWTClaims {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format');
    }

    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(payload);
  }

  /**
   * Verify JWKS endpoint is accessible
   */
  async verifyJwksEndpoint(): Promise<boolean> {
    try {
      const response = await fetch(this.getJwksEndpoint());
      if (!response.ok) return false;

      const jwks = await response.json();
      return jwks.keys && Array.isArray(jwks.keys) && jwks.keys.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Get OpenID configuration
   */
  async getOpenIdConfiguration(): Promise<any> {
    const url = `${this.config.url}/realms/${this.config.realm}/.well-known/openid-configuration`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error('Failed to fetch OpenID configuration');
    }

    return response.json();
  }
}