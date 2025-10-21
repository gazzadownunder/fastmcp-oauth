/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728)
 *
 * MCP servers act as OAuth 2.1 Resource Servers and must advertise
 * their OAuth configuration to clients.
 *
 * Spec: https://datatracker.ietf.org/doc/html/rfc9728
 * MCP Spec: https://modelcontextprotocol.io/specification/draft/basic/authorization
 */

import type { CoreContext } from '../core/types.js';

/**
 * OAuth 2.0 Protected Resource Metadata
 *
 * Per RFC 9728, resource servers must advertise:
 * - Resource identifier
 * - Authorization server(s) that issue tokens for this resource
 * - Bearer token methods supported
 * - Signing algorithms supported
 */
export interface ProtectedResourceMetadata {
  /** Resource server identifier (typically the server URL) */
  resource: string;

  /** Authorization servers that issue tokens for this resource */
  authorization_servers: string[];

  /** Bearer token transmission methods supported */
  bearer_methods_supported: string[];

  /** JWT signing algorithms supported for token validation */
  resource_signing_alg_values_supported: string[];

  /** OAuth scopes supported by this resource server (optional) */
  scopes_supported?: string[];

  /** Documentation URL for this resource server (optional) */
  resource_documentation?: string;
}

/**
 * Generate OAuth Protected Resource Metadata for MCP server
 *
 * This metadata informs MCP clients:
 * 1. Which authorization servers issue valid tokens
 * 2. How to send bearer tokens (Authorization header)
 * 3. Which signing algorithms are accepted
 * 4. What scopes are available
 *
 * @param coreContext - Core context with authentication configuration
 * @param serverUrl - Base URL of this MCP server (e.g., "https://mcp.example.com")
 * @returns Protected resource metadata object
 *
 * @example
 * ```typescript
 * const metadata = generateProtectedResourceMetadata(
 *   coreContext,
 *   "https://mcp-server.example.com"
 * );
 *
 * // Returns:
 * // {
 * //   resource: "https://mcp-server.example.com",
 * //   authorization_servers: ["https://auth.example.com"],
 * //   bearer_methods_supported: ["header"],
 * //   resource_signing_alg_values_supported: ["RS256", "ES256"],
 * //   scopes_supported: ["mcp:read", "mcp:write"]
 * // }
 * ```
 */
export function generateProtectedResourceMetadata(
  coreContext: CoreContext,
  serverUrl: string
): ProtectedResourceMetadata {
  const authConfig = coreContext.configManager.getAuthConfig();

  // Extract all authorization server issuers from trusted IDPs
  const authorizationServers = authConfig.trustedIDPs.map((idp: any) => idp.issuer);

  // Extract all supported signing algorithms from trusted IDPs
  const supportedAlgorithms = Array.from(
    new Set(
      authConfig.trustedIDPs.flatMap((idp: any) => idp.algorithms || ['RS256', 'ES256'])
    )
  );

  return {
    resource: serverUrl,
    authorization_servers: authorizationServers,
    bearer_methods_supported: ['header'], // MCP uses Authorization: Bearer header
    resource_signing_alg_values_supported: supportedAlgorithms as string[],
    scopes_supported: extractSupportedScopes(coreContext),
    resource_documentation: `${serverUrl}/docs`,
  };
}

/**
 * Extract supported scopes from MCP server configuration
 *
 * Scopes represent permissions that can be granted via OAuth tokens.
 * These are read from the MCP oauth.scopes configuration array.
 *
 * If no scopes are configured, returns an empty array (scopes will not be
 * included in the metadata).
 *
 * @param coreContext - Core context
 * @returns Array of supported scope strings
 */
function extractSupportedScopes(coreContext: CoreContext): string[] {
  const mcpConfig = coreContext.configManager.getMCPConfig();

  // Debug logging
  console.log('[OAuth Metadata] extractSupportedScopes called');
  console.log('[OAuth Metadata] mcpConfig:', JSON.stringify(mcpConfig, null, 2));
  console.log('[OAuth Metadata] oauth.scopes:', mcpConfig?.oauth?.scopes);

  // Return configured scopes or empty array if not configured
  const scopes = mcpConfig?.oauth?.scopes || [];
  console.log('[OAuth Metadata] Returning scopes:', scopes);
  return scopes;
}

/**
 * Generate WWW-Authenticate header value for 401 responses
 *
 * Generates RFC 6750 Bearer format with authorization_server parameter
 * - Standard OAuth 2.1 format
 * - Clients use /.well-known/oauth-protected-resource for endpoint discovery
 * - Example: `Bearer realm="MCP Server", authorization_server="https://auth.example.com"`
 *
 * @param coreContext - Core context with authentication configuration
 * @param realm - Realm name (typically server name)
 * @param scope - Space-separated list of required scopes (optional)
 * @returns WWW-Authenticate header value
 *
 * @example
 * ```typescript
 * const headerValue = generateWWWAuthenticateHeader(coreContext, "MCP Server");
 * // Returns: 'Bearer realm="MCP Server", authorization_server="https://auth.example.com"'
 * ```
 */
export function generateWWWAuthenticateHeader(
  coreContext: CoreContext,
  realm: string,
  scope?: string
): string {
  const authConfig = coreContext.configManager.getAuthConfig();

  // Always use Bearer format (RFC 6750 + RFC 9728)
  return generateBearerHeader(authConfig, realm, scope);
}

/**
 * Generate RFC 6750 Bearer WWW-Authenticate header
 *
 * Standard OAuth 2.1 Bearer format with authorization_server parameter.
 * Clients should use /.well-known/oauth-protected-resource for endpoint discovery.
 *
 * @param authConfig - Authentication configuration
 * @param realm - Realm name
 * @param scope - Space-separated list of required scopes (optional)
 * @returns Bearer header value
 */
function generateBearerHeader(
  authConfig: any,
  realm: string,
  scope?: string
): string {
  // Use first trusted IDP as primary authorization server
  const authServer = authConfig.trustedIDPs[0]?.issuer || 'unknown';

  // Build WWW-Authenticate header per RFC 6750 Section 3
  const params: string[] = [`realm="${realm}"`, `authorization_server="${authServer}"`];

  if (scope) {
    params.push(`scope="${scope}"`);
  }

  return `Bearer ${params.join(', ')}`;
}
