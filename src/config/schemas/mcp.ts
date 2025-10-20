/**
 * MCP Server Configuration Schema
 *
 * Defines configuration for the MCP layer (Phase 3).
 * This config is used by MCP server, middleware, and tool registration.
 *
 * @see Phase 4.1 of refactor.md
 */

import { z } from 'zod';

// ============================================================================
// MCP Server Configuration
// ============================================================================

/**
 * OAuth metadata configuration
 *
 * Exposes OAuth 2.1 metadata endpoints for client discovery.
 * Scopes defined here will be advertised in the OAuth Protected Resource Metadata.
 *
 * All fields are optional - if not provided, metadata will be derived from trustedIDPs config.
 */
export const OAuthMetadataSchema = z.object({
  issuer: z.string().url().optional().describe('OAuth issuer URL (defaults to first trustedIDP issuer)'),
  jwksUri: z.string().url().optional().describe('JWKS endpoint URL (defaults to first trustedIDP jwksUri)'),
  tokenEndpoint: z.string().url().optional().describe('Token endpoint URL'),
  authorizationEndpoint: z.string().url().optional().describe('Authorization endpoint URL'),
  supportedGrantTypes: z
    .array(z.string())
    .optional()
    .default(['urn:ietf:params:oauth:grant-type:token-exchange'])
    .describe('Supported OAuth 2.1 grant types'),
  scopes: z
    .array(z.string())
    .optional()
    .describe('OAuth scopes to advertise in metadata (e.g., ["mcp:read", "mcp:write", "sql:query"])'),
  wwwAuthenticateFormat: z
    .enum(['bearer', 'mcp_oauth2'])
    .optional()
    .default('bearer')
    .describe('WWW-Authenticate header format: "bearer" (RFC 6750 + RFC 9728) or "mcp_oauth2" (custom format)'),
  oauth_endpoints: z
    .object({
      authorization_endpoint: z.string().url().describe('Authorization endpoint for WWW-Authenticate header'),
      token_endpoint: z.string().url().describe('Token endpoint for WWW-Authenticate header'),
    })
    .optional()
    .describe('OAuth endpoints for mcp_oauth2 WWW-Authenticate header (required when wwwAuthenticateFormat="mcp_oauth2")'),
});

/**
 * Tool enablement configuration
 *
 * Controls which tools are registered with the MCP server.
 */
export const ToolEnablementSchema = z.object({
  'sql-delegate': z.boolean().optional().default(true).describe('Enable SQL delegation tool'),
  'health-check': z.boolean().optional().default(true).describe('Enable health check tool'),
  'user-info': z.boolean().optional().default(true).describe('Enable user info tool'),
  'audit-log': z.boolean().optional().default(false).describe('Enable audit log tool (admin only)'),
  // NOTE: kerberos-delegate is NOT a user-facing tool - delegation happens automatically
  'kerberos-list-directory': z.boolean().optional().default(false).describe('Enable Kerberos file listing tool'),
  'kerberos-read-file': z.boolean().optional().default(false).describe('Enable Kerberos file reading tool'),
  'kerberos-file-info': z.boolean().optional().default(false).describe('Enable Kerberos file info tool'),
  'sql-read': z.boolean().optional().default(false).describe('Enable SQL read tool'),
  'sql-write': z.boolean().optional().default(false).describe('Enable SQL write tool'),
  'sql-schema': z.boolean().optional().default(false).describe('Enable SQL schema tool'),
  'sql-table-details': z.boolean().optional().default(false).describe('Enable SQL table details tool'),
  'oauth-metadata': z.boolean().optional().default(false).describe('Enable OAuth metadata tool'),
});

/**
 * MCP server configuration schema
 *
 * This is the configuration for the MCP layer (Phase 3).
 * Used by MCP server, middleware, and tool registration.
 */
export const MCPConfigSchema = z.object({
  serverName: z.string().min(1).default('mcp-oauth-server').describe('MCP server name'),
  version: z.string().min(1).default('1.0.0').describe('MCP server version'),
  transport: z
    .enum(['stdio', 'sse', 'http-stream'])
    .optional()
    .default('http-stream')
    .describe('Transport protocol'),
  port: z.number().min(1).max(65535).optional().default(3000).describe('Server port (for http-stream)'),
  oauth: OAuthMetadataSchema.optional().describe('OAuth metadata configuration'),
  enabledTools: ToolEnablementSchema.optional().describe('Tool enablement configuration'),
});

// ============================================================================
// TypeScript Types
// ============================================================================

export type OAuthMetadata = z.infer<typeof OAuthMetadataSchema>;
export type ToolEnablement = z.infer<typeof ToolEnablementSchema>;
export type MCPConfig = z.infer<typeof MCPConfigSchema>;
