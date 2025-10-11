/**
 * MCP Tool Factories
 *
 * Exports all tool factory functions for registration with MCP server.
 *
 * @see Phase 3.5 of refactor.md
 */

import { createSqlDelegateTool } from './sql-delegate.js';
import { createHealthCheckTool } from './health-check.js';
import { createUserInfoTool } from './user-info.js';
import { createSQLWriteTool } from './sql-write.js';
import { createSQLReadTool } from './sql-read.js';
import { createSqlSchemaTool } from './sql-schema.js';
import { createSqlTableDetailsTool } from './sql-table-details.js';
import type { ToolFactory } from '../types.js';

export { createSqlDelegateTool } from './sql-delegate.js';
export { createHealthCheckTool } from './health-check.js';
export { createUserInfoTool } from './user-info.js';
export { createSQLWriteTool } from './sql-write.js';
export { createSQLReadTool } from './sql-read.js';
export { createSqlSchemaTool } from './sql-schema.js';
export { createSqlTableDetailsTool } from './sql-table-details.js';

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
    createSqlSchemaTool,
    createSqlTableDetailsTool,
    createHealthCheckTool,
    createUserInfoTool,
    createSQLWriteTool,
    createSQLReadTool,
  ];
}

/**
 * Legacy export for backward compatibility
 *
 * @deprecated Use getAllToolFactories() instead
 */
export const ALL_TOOL_FACTORIES = getAllToolFactories();
