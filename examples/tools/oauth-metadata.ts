/**
 * OAuth Metadata Tool
 *
 * Returns OAuth 2.0 Protected Resource Metadata (RFC 9728) via MCP tool.
 *
 * This is a workaround because FastMCP doesn't expose the Express app
 * for adding custom HTTP endpoints. Clients can call this tool to discover
 * OAuth configuration.
 *
 * This tool does NOT require authentication (pre-auth discovery).
 */

import { z } from 'zod';
import { generateProtectedResourceMetadata } from '../oauth-metadata.js';
import type { CoreContext } from '../../core/types.js';
import type { ToolFactory, ToolRegistration, MCPContext, LLMResponse } from '../types.js';

/**
 * OAuth metadata tool input schema (no parameters required)
 */
const OAuthMetadataInputSchema = z.object({});

type OAuthMetadataInput = z.infer<typeof OAuthMetadataInputSchema>;

/**
 * OAuth Metadata Tool Factory
 *
 * Creates the oauth-metadata tool with dependency injection.
 *
 * @param coreContext - Core context with services
 * @returns Tool registration
 */
export const createOAuthMetadataTool: ToolFactory = (coreContext: CoreContext): ToolRegistration => {
  return {
    name: 'oauth-metadata',
    description: 'Get OAuth 2.0 Protected Resource Metadata (RFC 9728). Returns authorization server locations, supported scopes, and bearer token methods. This tool does not require authentication.',
    schema: OAuthMetadataInputSchema,

    // No authentication required (this is pre-auth discovery)
    canAccess: () => true,

    handler: async (args: OAuthMetadataInput, context: MCPContext): Promise<LLMResponse> => {
      try {
        // Generate metadata (assuming localhost:3000 for server URL)
        // In production, this should come from configuration
        const serverUrl = process.env.SERVER_URL || 'http://localhost:3000';
        const metadata = generateProtectedResourceMetadata(coreContext, serverUrl);

        return {
          status: 'success',
          data: metadata,
        };
      } catch (error) {
        return {
          status: 'failure',
          code: 'metadata_generation_failed',
          message: error instanceof Error ? error.message : 'Failed to generate OAuth metadata',
        };
      }
    },
  };
};
