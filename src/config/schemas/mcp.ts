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
 */
export const OAuthMetadataSchema = z.object({
  issuer: z.string().url().describe('OAuth issuer URL'),
  jwksUri: z.string().url().describe('JWKS endpoint URL'),
  tokenEndpoint: z.string().url().optional().describe('Token endpoint URL'),
  authorizationEndpoint: z.string().url().optional().describe('Authorization endpoint URL'),
  supportedGrantTypes: z
    .array(z.string())
    .optional()
    .default(['urn:ietf:params:oauth:grant-type:token-exchange'])
    .describe('Supported OAuth 2.1 grant types'),
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
