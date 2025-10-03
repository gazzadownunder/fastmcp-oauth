/**
 * MCP Layer Types
 *
 * This module defines types for the MCP integration layer.
 *
 * ARCHITECTURAL RULES:
 * - CoreContext is IMPORTED from '../core/index.js' (NOT defined here)
 * - This enforces one-way dependency: Core → Delegation → MCP
 *
 * @see Phase 3.2 of refactor.md
 */

import type { z } from 'zod';
import type { CoreContext } from '../core/index.js'; // MANDATORY: Import (not define)
import type { UserSession } from '../core/types.js';

// ============================================================================
// LLM Response Standards (GAP #5)
// ============================================================================

/**
 * Standardized success response for LLM consumption
 *
 * All tools MUST return this format on success to provide consistent
 * responses that LLMs can reliably parse.
 *
 * @example
 * ```typescript
 * return {
 *   status: 'success',
 *   data: { recordCount: 42, records: [...] }
 * };
 * ```
 */
export interface LLMSuccessResponse<T = any> {
  status: 'success';
  data: T;
}

/**
 * Standardized failure response for LLM consumption
 *
 * All tools MUST catch OAuthSecurityError and convert to this format
 * to provide human-readable error messages for LLMs.
 *
 * Error Codes:
 * - UNAUTHENTICATED: Missing or invalid authentication
 * - INSUFFICIENT_PERMISSIONS: User lacks required permissions
 * - INVALID_INPUT: Invalid parameters provided
 * - DELEGATION_FAILED: Delegation operation failed
 * - INTERNAL_ERROR: Unexpected server error
 *
 * @example
 * ```typescript
 * return {
 *   status: 'failure',
 *   code: 'INSUFFICIENT_PERMISSIONS',
 *   message: 'You do not have permission to execute queries. Required permission: sql:query'
 * };
 * ```
 */
export interface LLMFailureResponse {
  status: 'failure';
  code: string;
  message: string;
}

/**
 * Union type for all LLM responses
 */
export type LLMResponse<T = any> = LLMSuccessResponse<T> | LLMFailureResponse;

// ============================================================================
// Tool Handler Types (GAP #12)
// ============================================================================

/**
 * MCP Context provided to tool handlers
 *
 * Contains the authenticated user session for authorization checks.
 * Tools receive this context from the MCP middleware after authentication.
 */
export interface MCPContext {
  session: UserSession;
}

/**
 * Generic tool handler signature
 *
 * All MCP tools MUST use this signature for consistent parameter passing
 * and context injection.
 *
 * @template P - Parameter type (validated by Zod schema)
 * @template R - Return type (typically LLMResponse)
 *
 * @example
 * ```typescript
 * const myToolHandler: ToolHandler<MyParams, LLMResponse> = async (params, context) => {
 *   // Access authenticated session
 *   const { session } = context;
 *
 *   // Perform operation
 *   const result = await doSomething(params, session);
 *
 *   return {
 *     status: 'success',
 *     data: result
 *   };
 * };
 * ```
 */
export type ToolHandler<P = any, R = LLMResponse> = (
  params: P,
  context: MCPContext
) => Promise<R>;

// ============================================================================
// Tool Registration Types
// ============================================================================

/**
 * Tool registration metadata
 *
 * Defines a single MCP tool with its schema, handler, and optional access checks.
 */
export interface ToolRegistration<P = any, R = LLMResponse> {
  /** Tool name (unique identifier) */
  name: string;

  /** Tool description for LLM */
  description: string;

  /** Zod schema for parameter validation */
  schema: z.ZodObject<any>;

  /** Tool handler function */
  handler: ToolHandler<P, R>;

  /**
   * Optional contextual access check
   *
   * Allows tools to perform fine-grained authorization based on the request context.
   * Return false to deny access before handler execution.
   *
   * @example
   * ```typescript
   * accessCheck: (context) => {
   *   // Only allow admins to access this tool
   *   return context.session.role === 'admin';
   * }
   * ```
   */
  accessCheck?: (context: MCPContext) => boolean;
}

/**
 * Tool factory function
 *
 * Creates tool registrations with injected CoreContext dependency.
 * This pattern enables dependency injection for tools.
 *
 * @param context - CoreContext containing all core services
 * @returns Tool registration ready for MCP server
 *
 * @example
 * ```typescript
 * export const createSqlTool: ToolFactory = (context) => ({
 *   name: 'sql-delegate',
 *   description: 'Execute SQL on behalf of user',
 *   schema: sqlParamsSchema,
 *   handler: async (params, mcpContext) => {
 *     // Access injected services from CoreContext
 *     const result = await context.delegationRegistry.delegate(
 *       'sql',
 *       mcpContext.session,
 *       'query',
 *       params
 *     );
 *     return { status: 'success', data: result };
 *   }
 * });
 * ```
 */
export type ToolFactory = (context: CoreContext) => ToolRegistration;

// ============================================================================
// MCP Configuration Types
// ============================================================================

/**
 * OAuth configuration for MCP server
 *
 * Extends FastMCP configuration with OAuth-specific settings.
 */
export interface MCPOAuthConfig {
  /** Server name */
  name: string;

  /** Server version */
  version: string;

  /** OAuth metadata (issuer, JWKS URI, etc.) */
  oauth?: {
    issuer: string;
    jwksUri: string;
    tokenEndpoint?: string;
    authorizationEndpoint?: string;
  };

  /** Transport type */
  transport?: 'stdio' | 'sse' | 'http-stream';

  /** Port (for http-stream transport) */
  port?: number;
}

/**
 * MCP server start options
 */
export interface MCPStartOptions {
  /** Path to configuration file */
  configPath?: string;

  /** Transport type override */
  transport?: 'stdio' | 'sse' | 'http-stream';

  /** Port override (for http-stream) */
  port?: number;
}

// ============================================================================
// Re-exports
// ============================================================================

/**
 * NOTE: CoreContext is NOT re-exported here.
 *
 * This is intentional to enforce the architectural rule that CoreContext
 * must be imported from 'src/core/index.js' (not from 'src/mcp/index.js').
 *
 * This prevents circular dependencies and enforces one-way dependency flow:
 * Core → Delegation → MCP
 *
 * @see GAP #Architecture in Mandatory Design Checklist
 */
