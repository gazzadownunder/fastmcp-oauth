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
  MCPContext,
  ToolHandler,

  // Tool Registration
  ToolRegistration,
  ToolFactory,

  // Configuration
  MCPOAuthConfig,
  MCPStartOptions,
} from './types.js';

// FastMCP Types (re-export from middleware)
export type { FastMCPRequest, FastMCPAuthResult } from './middleware.js';

// ============================================================================
// Middleware
// ============================================================================

export { MCPAuthMiddleware, requireAuth, requireRole } from './middleware.js';

// ============================================================================
// Orchestrator
// ============================================================================

export { ConfigOrchestrator } from './orchestrator.js';
export type { OrchestratorOptions } from './orchestrator.js';

// ============================================================================
// MCP OAuth Server (High-Level API)
// ============================================================================

export { MCPOAuthServer } from './server.js';

// ============================================================================
// Tool Factories
// ============================================================================

export { createSqlDelegateTool, getAllToolFactories, ALL_TOOL_FACTORIES } from './tools/index.js';

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
