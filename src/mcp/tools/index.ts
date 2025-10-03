/**
 * MCP Tool Factories
 *
 * Exports all tool factory functions for registration with MCP server.
 *
 * @see Phase 3.5 of refactor.md
 */

import { createSqlDelegateTool } from './sql-delegate.js';
import type { ToolFactory } from '../types.js';

export { createSqlDelegateTool } from './sql-delegate.js';

/**
 * Get all available tool factories
 *
 * Use this function to get all tool factories for registration:
 *
 * @example
 * ```typescript
 * import { getAllToolFactories } from './tools/index.js';
 *
 * const factories = getAllToolFactories();
 * for (const factory of factories) {
 *   const tool = factory(coreContext);
 *   mcpServer.addTool(tool);
 * }
 * ```
 */
export function getAllToolFactories(): ToolFactory[] {
  return [
    createSqlDelegateTool,
    // Add more tool factories here as they are created
  ];
}

/**
 * Legacy export for backward compatibility
 *
 * @deprecated Use getAllToolFactories() instead
 */
export const ALL_TOOL_FACTORIES = getAllToolFactories();
