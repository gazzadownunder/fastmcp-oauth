/**
 * @fastmcp-oauth/sql-delegation - SQL delegation module package
 *
 * Provides PostgreSQL and SQL Server delegation capabilities for the MCP OAuth framework.
 * This is a reference implementation demonstrating how to build delegation modules.
 *
 * @module @fastmcp-oauth/sql-delegation
 */

export { PostgreSQLDelegationModule } from './postgresql-module.js';
export { SQLDelegationModule } from './sql-module.js';
export type { PostgreSQLConfig } from './postgresql-module.js';
export type { SQLConfig } from './sql-module.js';
