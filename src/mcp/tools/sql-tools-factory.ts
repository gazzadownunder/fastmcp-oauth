/**
 * SQL Tools Factory
 *
 * Creates SQL delegation tools for multiple PostgreSQL database instances.
 * Allows defining tools with custom prefixes (e.g., SQL1, SQL2) for different databases.
 *
 * Usage:
 * ```typescript
 * const sql1Tools = createSQLToolsForModule('sql1', 'postgresql1');
 * const sql2Tools = createSQLToolsForModule('sql2', 'postgresql2');
 * ```
 */

import { z } from 'zod';
import type { CoreContext } from '../../core/index.js';
import type { ToolFactory, LLMResponse, MCPContext } from '../types.js';
import { Authorization } from '../authorization.js';
import { OAuthSecurityError } from '../../utils/errors.js';
import { handleToolError } from '../utils/error-helpers.js';

/**
 * Configuration for SQL tools factory
 */
export interface SQLToolsConfig {
  /** Tool name prefix (e.g., 'sql1', 'sql2') */
  toolPrefix: string;
  /** Delegation module name (e.g., 'postgresql1', 'postgresql2') */
  moduleName: string;
  /** Description suffix for tools (optional) */
  descriptionSuffix?: string;
}

/**
 * Create SQL delegation tool for a specific PostgreSQL module
 *
 * @param toolPrefix - Tool name prefix (e.g., 'sql1', 'sql2')
 * @param moduleName - Delegation module name (e.g., 'postgresql1', 'postgresql2')
 * @param descriptionSuffix - Optional suffix for tool descriptions
 * @returns Tool factory for sql-delegate tool
 */
export function createSqlDelegateToolForModule(
  toolPrefix: string,
  moduleName: string,
  descriptionSuffix?: string
): ToolFactory {
  const sqlDelegateSchema = z.object({
    action: z.enum(['query']).describe('SQL operation type (PostgreSQL only supports query)'),
    sql: z.string().describe('SQL query string with positional parameters ($1, $2, etc.)'),
    params: z
      .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
      .optional()
      .describe('Array of parameter values (for PostgreSQL $1, $2, etc.)'),
    resource: z.string().optional().default('postgresql-database').describe('Resource identifier'),
  });

  type SqlDelegateParams = z.infer<typeof sqlDelegateSchema>;

  return (context: CoreContext) => ({
    name: `${toolPrefix}-delegate`,
    description:
      `Execute PostgreSQL queries on behalf of the authenticated user using their delegated role. Use positional parameters ($1, $2, etc.). Requires user or admin role.${descriptionSuffix ? ' ' + descriptionSuffix : ''}`,
    schema: sqlDelegateSchema,

    canAccess: (mcpContext: MCPContext) => {
      const auth = new Authorization();
      if (!auth.isAuthenticated(mcpContext)) {
        return false;
      }
      return auth.hasAnyRole(mcpContext, ['user', 'admin']);
    },

    handler: async (params: SqlDelegateParams, mcpContext: MCPContext): Promise<LLMResponse> => {
      try {
        const auth = new Authorization();
        auth.requireAnyRole(mcpContext, ['user', 'admin']);

        if (params.action === 'query' && !params.sql) {
          return {
            status: 'failure',
            code: 'INVALID_INPUT',
            message: 'The "sql" parameter is required for query action',
          };
        }

        const result = await context.delegationRegistry.delegate(
          moduleName,
          mcpContext.session,
          params.action,
          {
            sql: params.sql,
            params: params.params,
            resource: params.resource,
          }
        );

        if (!result.success) {
          return {
            status: 'failure',
            code: 'DELEGATION_FAILED',
            message: result.error || 'SQL delegation failed',
          };
        }

        return {
          status: 'success',
          data: result.data,
        };
      } catch (error) {
        if (error instanceof OAuthSecurityError || (error as any).code) {
          const secError = error as OAuthSecurityError;
          return {
            status: 'failure',
            code: secError.code || 'INTERNAL_ERROR',
            message: secError.message,
          };
        }

        const errorResponse = await handleToolError(
          error,
          `${toolPrefix}-delegate`,
          mcpContext,
          context.auditService,
          params
        );
        return errorResponse;
      }
    },
  });
}

/**
 * Create SQL schema tool for a specific PostgreSQL module
 *
 * @param toolPrefix - Tool name prefix (e.g., 'sql1', 'sql2')
 * @param moduleName - Delegation module name (e.g., 'postgresql1', 'postgresql2')
 * @param descriptionSuffix - Optional suffix for tool descriptions
 * @returns Tool factory for sql-schema tool
 */
export function createSqlSchemaToolForModule(
  toolPrefix: string,
  moduleName: string,
  descriptionSuffix?: string
): ToolFactory {
  const sqlSchemaSchema = z.object({
    schemaName: z.string().optional().default('public').describe('Schema name (default: public)'),
  });

  type SqlSchemaParams = z.infer<typeof sqlSchemaSchema>;

  return (context: CoreContext) => ({
    name: `${toolPrefix}-schema`,
    description:
      `Get list of tables in the database schema. Shows table names and types (BASE TABLE, VIEW, etc.). Requires user or admin role.${descriptionSuffix ? ' ' + descriptionSuffix : ''}`,
    schema: sqlSchemaSchema,

    canAccess: (mcpContext: MCPContext) => {
      const auth = new Authorization();
      if (!auth.isAuthenticated(mcpContext)) {
        return false;
      }
      return auth.hasAnyRole(mcpContext, ['user', 'admin']);
    },

    handler: async (params: SqlSchemaParams, mcpContext: MCPContext): Promise<LLMResponse> => {
      try {
        const auth = new Authorization();
        auth.requireAnyRole(mcpContext, ['user', 'admin']);

        const delegationModule = context.delegationRegistry.get(moduleName);
        if (!delegationModule) {
          return {
            status: 'failure',
            code: 'MODULE_NOT_AVAILABLE',
            message: `PostgreSQL delegation module '${moduleName}' is not available`,
          };
        }

        const result = await delegationModule.delegate(
          mcpContext.session,
          'schema',
          { schemaName: params.schemaName },
          {
            sessionId: mcpContext.session.sessionId,
            coreContext: context,
          }
        );

        if (!result.success) {
          return {
            status: 'failure',
            code: 'DELEGATION_ERROR',
            message: result.error || 'Schema query failed',
          };
        }

        const tables = result.data as Array<{ table_name: string; table_type: string }>;

        return {
          status: 'success',
          data: {
            schema: params.schemaName,
            tableCount: tables.length,
            tables: tables.map(t => ({
              name: t.table_name,
              type: t.table_type,
            })),
          },
        };
      } catch (error) {
        return handleToolError(error, `${toolPrefix}-schema`, mcpContext, context.auditService, params);
      }
    },
  });
}

/**
 * Create SQL table details tool for a specific PostgreSQL module
 *
 * @param toolPrefix - Tool name prefix (e.g., 'sql1', 'sql2')
 * @param moduleName - Delegation module name (e.g., 'postgresql1', 'postgresql2')
 * @param descriptionSuffix - Optional suffix for tool descriptions
 * @returns Tool factory for sql-table-details tool
 */
export function createSqlTableDetailsToolForModule(
  toolPrefix: string,
  moduleName: string,
  descriptionSuffix?: string
): ToolFactory {
  const sqlTableDetailsSchema = z.object({
    tableName: z.string().min(1).describe('Table name to get details for'),
    schemaName: z.string().optional().default('public').describe('Schema name (default: public)'),
  });

  type SqlTableDetailsParams = z.infer<typeof sqlTableDetailsSchema>;

  return (context: CoreContext) => ({
    name: `${toolPrefix}-table-details`,
    description:
      `Get detailed column information for a specific table. Shows column names, data types, nullable status, and defaults. Requires user or admin role.${descriptionSuffix ? ' ' + descriptionSuffix : ''}`,
    schema: sqlTableDetailsSchema,

    canAccess: (mcpContext: MCPContext) => {
      const auth = new Authorization();
      if (!auth.isAuthenticated(mcpContext)) {
        return false;
      }
      return auth.hasAnyRole(mcpContext, ['user', 'admin']);
    },

    handler: async (params: SqlTableDetailsParams, mcpContext: MCPContext): Promise<LLMResponse> => {
      try {
        const auth = new Authorization();
        auth.requireAnyRole(mcpContext, ['user', 'admin']);

        const delegationModule = context.delegationRegistry.get(moduleName);
        if (!delegationModule) {
          return {
            status: 'failure',
            code: 'MODULE_NOT_AVAILABLE',
            message: `PostgreSQL delegation module '${moduleName}' is not available`,
          };
        }

        const result = await delegationModule.delegate(
          mcpContext.session,
          'table-details',
          {
            tableName: params.tableName,
            schemaName: params.schemaName,
          },
          {
            sessionId: mcpContext.session.sessionId,
            coreContext: context,
          }
        );

        if (!result.success) {
          return {
            status: 'failure',
            code: 'DELEGATION_ERROR',
            message: result.error || 'Table details query failed',
          };
        }

        const columns = result.data as Array<{
          column_name: string;
          data_type: string;
          is_nullable: string;
          column_default: string | null;
          character_maximum_length: number | null;
        }>;

        return {
          status: 'success',
          data: {
            table: params.tableName,
            schema: params.schemaName,
            columnCount: columns.length,
            columns: columns.map(c => ({
              name: c.column_name,
              type: c.data_type,
              nullable: c.is_nullable === 'YES',
              default: c.column_default,
              maxLength: c.character_maximum_length,
            })),
          },
        };
      } catch (error) {
        return handleToolError(error, `${toolPrefix}-table-details`, mcpContext, context.auditService, params);
      }
    },
  });
}

/**
 * Create all SQL tools for a specific PostgreSQL module
 *
 * @param config - SQL tools configuration
 * @returns Array of tool factories (delegate, schema, table-details)
 *
 * @example
 * ```typescript
 * const sql1Tools = createSQLToolsForModule({
 *   toolPrefix: 'sql1',
 *   moduleName: 'postgresql1',
 *   descriptionSuffix: '(Primary Database)'
 * });
 *
 * const sql2Tools = createSQLToolsForModule({
 *   toolPrefix: 'sql2',
 *   moduleName: 'postgresql2',
 *   descriptionSuffix: '(Analytics Database)'
 * });
 * ```
 */
export function createSQLToolsForModule(config: SQLToolsConfig): ToolFactory[] {
  return [
    createSqlDelegateToolForModule(config.toolPrefix, config.moduleName, config.descriptionSuffix),
    createSqlSchemaToolForModule(config.toolPrefix, config.moduleName, config.descriptionSuffix),
    createSqlTableDetailsToolForModule(config.toolPrefix, config.moduleName, config.descriptionSuffix),
  ];
}
