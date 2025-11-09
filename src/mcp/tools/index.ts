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
import { createSqlSchemaTool } from './sql-schema.js';
import { createSqlTableDetailsTool } from './sql-table-details.js';
// NOTE: kerberos-delegate is NOT exported - it's an internal implementation detail
// Kerberos delegation happens automatically when file browsing tools are called
import {
  createListDirectoryTool,
  createReadFileTool,
  createFileInfoTool,
} from './kerberos-file-browse.js';
import type { ToolFactory } from '../types.js';

export { createSqlDelegateTool } from './sql-delegate.js';
export { createHealthCheckTool } from './health-check.js';
export { createUserInfoTool } from './user-info.js';
export { createSqlSchemaTool } from './sql-schema.js';
export { createSqlTableDetailsTool } from './sql-table-details.js';
// NOTE: kerberos-delegate is NOT exported - see comment above
export {
  createListDirectoryTool,
  createReadFileTool,
  createFileInfoTool,
} from './kerberos-file-browse.js';

// Export SQL tools factory for multi-database support
export {
  createSQLToolsForModule,
  createSqlDelegateToolForModule,
  createSqlSchemaToolForModule,
  createSqlTableDetailsToolForModule,
} from './sql-tools-factory.js';
export type { SQLToolsConfig } from './sql-tools-factory.js';

// Export REST API tools factory for multi-API support
export {
  createRESTAPIToolsForModule,
  createRESTAPIDelegateToolForModule,
  createRESTAPIHealthToolForModule,
} from './rest-api-tools-factory.js';
export type { RESTAPIToolsConfig } from './rest-api-tools-factory.js';

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
 *
 * @param options - Options for filtering tool factories
 * @param options.excludeSqlTools - Exclude default SQL tools (use when registering custom SQL tools)
 */
export function getAllToolFactories(options?: { excludeSqlTools?: boolean }): ToolFactory[] {
  const sqlTools = options?.excludeSqlTools
    ? []
    : [createSqlDelegateTool, createSqlSchemaTool, createSqlTableDetailsTool];

  console.log(
    `[getAllToolFactories] excludeSqlTools=${options?.excludeSqlTools}, including ${sqlTools.length} SQL tools`
  );

  return [
    ...sqlTools,
    createHealthCheckTool,
    createUserInfoTool,
    // NOTE: kerberos-delegate is NOT included - delegation happens automatically
    createListDirectoryTool,
    createReadFileTool,
    createFileInfoTool,
  ];
}

/**
 * Legacy export for backward compatibility
 *
 * @deprecated Use getAllToolFactories() instead
 */
export const ALL_TOOL_FACTORIES = getAllToolFactories();
