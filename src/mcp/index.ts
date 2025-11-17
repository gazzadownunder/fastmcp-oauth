/**
 * MCP Layer - Public API
 *
 * This module exports the public API for the MCP integration layer.
 *
 * ARCHITECTURAL RULE (MANDATORY):
 * - CoreContext is NOT re-exported here
 * - Consumers must import CoreContext from '../core/index.js'
 * - This enforces one-way dependency: Core → Delegation → MCP
 *
 * @see Phase 3.7 of refactor.md
 */

// ============================================================================
// Types
// ============================================================================

export type {
  // LLM Response Standards (GAP #5)
  LLMSuccessResponse,
  LLMFailureResponse,
  LLMResponse,

  // Tool Handler Types (GAP #12)
  FastMCPContext,
  ToolHandler,

  // Tool Registration
  ToolRegistration,
  ToolFactory,

  // Configuration
  FastMCPOAuthConfig,
  FastMCPStartOptions,

  // Legacy types (backward compatibility)
  FastMCPContext as MCPContext,
  FastMCPOAuthConfig as MCPOAuthConfig,
  FastMCPStartOptions as MCPStartOptions,
} from './types.js';

// FastMCP Types (re-export from middleware)
export type { FastMCPRequest, FastMCPAuthResult } from './middleware.js';

// ============================================================================
// Middleware & Authorization
// ============================================================================

export {
  FastMCPAuthMiddleware,
  MCPAuthMiddleware,
  requireAuth,
  requireRole,
} from './middleware.js';
export { Authorization } from './authorization.js';

// ============================================================================
// Orchestrator
// ============================================================================

export { ConfigOrchestrator } from './orchestrator.js';
export type { OrchestratorOptions } from './orchestrator.js';

// ============================================================================
// FastMCP OAuth Server (High-Level API)
// ============================================================================

export { FastMCPOAuthServer, MCPOAuthServer } from './server.js';

// ============================================================================
// OAuth Metadata (RFC 8414, RFC 7591, RFC 9728)
// ============================================================================

export type { AuthorizationServerMetadata, ProtectedResourceMetadata } from './oauth-metadata.js';

export {
  generateProtectedResourceMetadata,
  generateWWWAuthenticateHeader,
  fetchAuthorizationServerMetadata,
  getAuthorizationServerMetadata,
} from './oauth-metadata.js';

// ============================================================================
// Tool Factories
// ============================================================================

export { createSqlDelegateTool, getAllToolFactories, ALL_TOOL_FACTORIES } from './tools/index.js';

// ============================================================================
// Generic Delegation Tool Factory (Framework Extension API)
// ============================================================================

export {
  createDelegationTool,
  createDelegationTools,
  type DelegationToolConfig,
} from './tools/delegation-tool-factory.js';

// ============================================================================
// IMPORTANT: CoreContext is NOT re-exported
// ============================================================================

/**
 * NOTE: CoreContext is exported from 'src/core/index.ts' (not re-exported here).
 *
 * This is intentional to enforce the architectural rule that CoreContext
 * must be imported from the Core layer, not from the MCP layer.
 *
 * This prevents circular dependencies and enforces one-way dependency flow:
 * Core → Delegation → MCP
 *
 * To use CoreContext:
 * ```typescript
 * import type { CoreContext } from '../core/index.js';
 * // OR
 * import type { CoreContext } from '@/core/index.js';
 * ```
 *
 * @see GAP #Architecture in Mandatory Design Checklist
 * @see Phase 3.7 validation checklist
 */
