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
    new Set(authConfig.trustedIDPs.flatMap((idp: any) => idp.algorithms || ['RS256', 'ES256']))
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
  const mcpConfig = coreContext.configManager.getFastMCPConfig();

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
 * Generate WWW-Authenticate header value for 401/403 responses
 *
 * Generates RFC 6750 Bearer format with optional parameters for OAuth error responses
 * - Standard OAuth 2.1 format
 * - Clients use /.well-known/oauth-protected-resource for endpoint discovery
 * - Example (401): `Bearer realm="MCP Server", resource_metadata="http://..."`
 * - Example (403): `Bearer realm="MCP Server", error="insufficient_scope", scope="admin sql:write", resource_metadata="http://..."`
 *
 * @param coreContext - Core context with authentication configuration
 * @param realm - Realm name (typically server name)
 * @param scope - Space-separated list of required scopes (optional, used for 403 insufficient_scope)
 * @param includeProtectedResource - Include authorization_server parameter (default: true, controlled by mcp.oauth.protectedResource config)
 * @param serverUrl - Server URL for resource_metadata parameter (optional)
 * @param error - OAuth error code (e.g., 'insufficient_scope', 'invalid_token') - optional
 * @param errorDescription - Human-readable error description (optional)
 * @returns WWW-Authenticate header value
 *
 * @example
 * ```typescript
 * // 401 Unauthorized (token missing/invalid)
 * const headerValue = generateWWWAuthenticateHeader(coreContext, "MCP Server", undefined, true, serverUrl);
 * // Returns: 'Bearer realm="MCP Server", resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource"'
 *
 * // 403 Forbidden (insufficient scope)
 * const headerValue = generateWWWAuthenticateHeader(
 *   coreContext, "MCP Server", "admin sql:write", true, serverUrl,
 *   "insufficient_scope", "This tool requires admin role"
 * );
 * // Returns: 'Bearer realm="MCP Server", error="insufficient_scope", scope="admin sql:write",
 * //           error_description="This tool requires admin role", resource_metadata="http://..."'
 * ```
 */
export function generateWWWAuthenticateHeader(
  coreContext: CoreContext,
  realm: string,
  scope?: string,
  includeProtectedResource?: boolean,
  serverUrl?: string,
  error?: string,
  errorDescription?: string
): string {
  const authConfig = coreContext.configManager.getAuthConfig();
  const mcpConfig = coreContext.configManager.getFastMCPConfig();

  // Determine if we should include protected resource metadata
  // Priority: explicit parameter > config > default (true)
  const shouldIncludeMetadata =
    includeProtectedResource !== undefined
      ? includeProtectedResource
      : mcpConfig?.oauth?.protectedResource ?? true;

  // Determine server URL for resource_metadata parameter
  // Use provided serverUrl or construct from config
  const resourceMetadataUrl = serverUrl
    ? `${serverUrl}/.well-known/oauth-protected-resource`
    : undefined;

  // Generate Bearer header with optional authorization_server and resource_metadata parameters
  return generateBearerHeader(
    authConfig,
    realm,
    scope,
    shouldIncludeMetadata,
    resourceMetadataUrl,
    error,
    errorDescription
  );
}

/**
 * Generate RFC 6750 Bearer WWW-Authenticate header
 *
 * Per RFC 6750 Section 3, valid parameters are: realm, scope, error, error_description, error_uri
 * Per RFC 9728, resource_metadata parameter provides OAuth Protected Resource Metadata URL
 * Authorization server discovery can happen via /.well-known/oauth-protected-resource (RFC 9728)
 *
 * @param authConfig - Authentication configuration
 * @param realm - Realm name (typically server name)
 * @param scope - Space-separated list of required scopes (optional)
 * @param includeMetadata - Include resource_metadata parameter (default: true)
 * @param resourceMetadataUrl - URL to OAuth Protected Resource Metadata endpoint
 * @param error - OAuth error code (e.g., 'insufficient_scope', 'invalid_token')
 * @param errorDescription - Human-readable error description
 * @returns Bearer header value
 */
function generateBearerHeader(
  authConfig: any,
  realm: string,
  scope?: string,
  includeMetadata: boolean = true,
  resourceMetadataUrl?: string,
  error?: string,
  errorDescription?: string
): string {
  console.log('[OAuth Metadata] generateBearerHeader called with:', {
    realm,
    scope,
    hasScope: !!scope,
    includeMetadata,
    resourceMetadataUrl,
    error,
    errorDescription
  });

  // Build WWW-Authenticate header per RFC 6750 Section 3 and RFC 9728
  // Valid parameters: realm, scope, error, error_description, error_uri, resource_metadata
  // Parameter order per MCP spec: realm, error, scope, error_description, resource_metadata
  const params: string[] = [`realm="${realm}"`];

  // Add error parameter if present (typically for 403 insufficient_scope)
  if (error) {
    params.push(`error="${error}"`);
  }

  // Add scope parameter if present (required scopes for 403 responses)
  if (scope) {
    params.push(`scope="${scope}"`);
  }

  // Add error_description if present
  if (errorDescription) {
    params.push(`error_description="${errorDescription}"`);
  }

  // Include resource_metadata parameter per RFC 9728 (MCP requirement)
  // This is the REQUIRED parameter for mcp-proxy to forward the header
  // Clients use this URL to discover authorization_servers (not included directly per RFC 6750)
  if (includeMetadata && resourceMetadataUrl) {
    params.push(`resource_metadata="${resourceMetadataUrl}"`);
  }

  const header = `Bearer ${params.join(', ')}`;
  console.log('[OAuth Metadata] Generated header:', header);

  return header;
}
