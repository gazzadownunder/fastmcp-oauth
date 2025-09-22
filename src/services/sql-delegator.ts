import sql from 'mssql';
import { configManager } from '../config/manager.js';
import type { DelegationModule, DelegationResult, UserSession, AuditEntry } from '../types/index.js';
import { SecurityErrors, createSecurityError } from '../utils/errors.js';

export class SQLDelegator implements DelegationModule {
  readonly type = 'sql' as const;
  private pool: sql.ConnectionPool | null = null;
  private isConnected = false;

  async initialize(): Promise<void> {
    if (this.isConnected) return;

    const sqlConfig = configManager.getDelegationConfig('sql') as any;

    try {
      const connectionConfig: sql.config = {
        server: sqlConfig.server,
        database: sqlConfig.database,
        options: {
          ...sqlConfig.options,
          trustServerCertificate: false, // Security: Always verify certificates
          encrypt: true, // Security: Always encrypt connections
        },
        pool: {
          max: 10,
          min: 0,
          idleTimeoutMillis: 30000,
        },
        connectionTimeout: 5000,
        requestTimeout: 30000,
      };

      this.pool = new sql.ConnectionPool(connectionConfig);
      await this.pool.connect();
      this.isConnected = true;
    } catch (error) {
      throw createSecurityError(
        'SQL_CONNECTION_FAILED',
        `Failed to initialize SQL connection: ${error}`,
        500
      );
    }
  }

  async delegate<T>(
    legacyUsername: string,
    action: string,
    parameters: Record<string, unknown>
  ): Promise<DelegationResult<T>> {
    if (!this.isConnected || !this.pool) {
      await this.initialize();
    }

    const auditEntry: AuditEntry = {
      timestamp: new Date(),
      userId: legacyUsername,
      legacyUsername,
      action: `sql_delegation:${action}`,
      resource: parameters.resource as string || 'unknown',
      success: false,
    };

    try {
      // Validate input parameters
      this.validateDelegationParameters(legacyUsername, action, parameters);

      // Create new request for this delegation
      const request = this.pool!.request();

      let result: any;

      // Execute with proper impersonation
      try {
        // Step 1: Begin impersonation
        await this.beginImpersonation(request, legacyUsername);

        // Step 2: Execute the delegated action
        result = await this.executeDelegatedAction(request, action, parameters);

        // Step 3: End impersonation
        await this.endImpersonation(request);

        auditEntry.success = true;

        return {
          success: true,
          data: result,
          auditTrail: auditEntry,
        };
      } catch (actionError) {
        // Always attempt to revert impersonation on error
        try {
          await this.endImpersonation(request);
        } catch (revertError) {
          // Log revert error but don't mask the original error
          console.error('Failed to revert SQL impersonation:', revertError);
        }

        throw actionError;
      }
    } catch (error) {
      auditEntry.error = error instanceof Error ? error.message : 'Unknown error';

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        auditTrail: auditEntry,
      };
    }
  }

  async validateAccess(context: UserSession): Promise<boolean> {
    // Check if user has SQL delegation permissions
    const requiredScopes = ['sql:delegate', 'legacy:access'];
    const hasRequiredScope = requiredScopes.some(scope =>
      context.scopes?.includes(scope) || context.permissions?.includes(scope)
    );

    if (!hasRequiredScope) {
      return false;
    }

    // Additional role-based validation
    if (context.role === 'guest') {
      return false;
    }

    // Validate legacy username is present
    if (!context.legacyUsername) {
      return false;
    }

    return true;
  }

  private validateDelegationParameters(
    legacyUsername: string,
    action: string,
    parameters: Record<string, unknown>
  ): void {
    // Validate legacy username format (prevent injection)
    if (!this.isValidSQLIdentifier(legacyUsername)) {
      throw SecurityErrors.DELEGATION_FAILED('SQL', 'Invalid legacy username format');
    }

    // Validate action is allowed
    const allowedActions = ['query', 'procedure', 'function'];
    if (!allowedActions.includes(action)) {
      throw SecurityErrors.DELEGATION_FAILED('SQL', `Action not allowed: ${action}`);
    }

    // Validate required parameters
    if (action === 'query' && !parameters.sql) {
      throw SecurityErrors.DELEGATION_FAILED('SQL', 'Missing SQL query parameter');
    }

    if (action === 'procedure' && !parameters.procedure) {
      throw SecurityErrors.DELEGATION_FAILED('SQL', 'Missing procedure name parameter');
    }
  }

  private async beginImpersonation(request: sql.Request, legacyUsername: string): Promise<void> {
    // Security: Use parameterized query to prevent injection
    const impersonateQuery = 'EXECUTE AS USER = @username;';
    request.input('username', sql.NVarChar, legacyUsername);
    await request.query(impersonateQuery);
  }

  private async endImpersonation(request: sql.Request): Promise<void> {
    await request.query('REVERT;');
  }

  private async executeDelegatedAction(
    request: sql.Request,
    action: string,
    parameters: Record<string, unknown>
  ): Promise<any> {
    switch (action) {
      case 'query':
        return this.executeQuery(request, parameters);

      case 'procedure':
        return this.executeProcedure(request, parameters);

      case 'function':
        return this.executeFunction(request, parameters);

      default:
        throw SecurityErrors.DELEGATION_FAILED('SQL', `Unsupported action: ${action}`);
    }
  }

  private async executeQuery(request: sql.Request, parameters: Record<string, unknown>): Promise<any> {
    const { sql: query, params } = parameters;

    if (typeof query !== 'string') {
      throw SecurityErrors.DELEGATION_FAILED('SQL', 'Query must be a string');
    }

    // Security: Prevent dangerous operations
    this.validateQuerySafety(query);

    // Add parameters if provided
    if (params && typeof params === 'object') {
      for (const [key, value] of Object.entries(params as Record<string, any>)) {
        this.addParameterToRequest(request, key, value);
      }
    }

    const result = await request.query(query);
    return result.recordset;
  }

  private async executeProcedure(request: sql.Request, parameters: Record<string, unknown>): Promise<any> {
    const { procedure, params } = parameters;

    if (typeof procedure !== 'string') {
      throw SecurityErrors.DELEGATION_FAILED('SQL', 'Procedure name must be a string');
    }

    // Validate procedure name format
    if (!this.isValidSQLIdentifier(procedure)) {
      throw SecurityErrors.DELEGATION_FAILED('SQL', 'Invalid procedure name format');
    }

    // Add parameters if provided
    if (params && typeof params === 'object') {
      for (const [key, value] of Object.entries(params as Record<string, any>)) {
        this.addParameterToRequest(request, key, value);
      }
    }

    const result = await request.execute(procedure);
    return result.recordset;
  }

  private async executeFunction(request: sql.Request, parameters: Record<string, unknown>): Promise<any> {
    const { functionName, params } = parameters;

    if (typeof functionName !== 'string') {
      throw SecurityErrors.DELEGATION_FAILED('SQL', 'Function name must be a string');
    }

    // Validate function name format
    if (!this.isValidSQLIdentifier(functionName)) {
      throw SecurityErrors.DELEGATION_FAILED('SQL', 'Invalid function name format');
    }

    // Build function call query
    const paramPlaceholders = params && typeof params === 'object' ?
      Object.keys(params as Record<string, any>).map(key => `@${key}`).join(', ') : '';

    const functionQuery = `SELECT dbo.${functionName}(${paramPlaceholders}) AS result;`;

    // Add parameters if provided
    if (params && typeof params === 'object') {
      for (const [key, value] of Object.entries(params as Record<string, any>)) {
        this.addParameterToRequest(request, key, value);
      }
    }

    const result = await request.query(functionQuery);
    return result.recordset;
  }

  private addParameterToRequest(request: sql.Request, key: string, value: any): void {
    // Determine SQL type based on value type
    if (typeof value === 'string') {
      request.input(key, sql.NVarChar, value);
    } else if (typeof value === 'number') {
      if (Number.isInteger(value)) {
        request.input(key, sql.Int, value);
      } else {
        request.input(key, sql.Float, value);
      }
    } else if (typeof value === 'boolean') {
      request.input(key, sql.Bit, value);
    } else if (value instanceof Date) {
      request.input(key, sql.DateTime, value);
    } else {
      // Default to NVarChar for other types
      request.input(key, sql.NVarChar, String(value));
    }
  }

  private validateQuerySafety(query: string): void {
    const normalizedQuery = query.toLowerCase().trim();

    // Prevent dangerous operations
    const dangerousPatterns = [
      /\b(drop|create|alter|truncate)\s+/i,
      /\b(grant|revoke)\s+/i,
      /\b(shutdown|backup|restore)\s+/i,
      /xp_cmdshell/i,
      /sp_configure/i,
      /openrowset/i,
      /opendatasource/i,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(normalizedQuery)) {
        throw SecurityErrors.DELEGATION_FAILED('SQL', 'Query contains prohibited operations');
      }
    }

    // Prevent nested EXECUTE AS
    if (/execute\s+as/i.test(normalizedQuery)) {
      throw SecurityErrors.DELEGATION_FAILED('SQL', 'Nested EXECUTE AS not allowed');
    }
  }

  private isValidSQLIdentifier(identifier: string): boolean {
    // SQL Server identifier validation
    // Allow alphanumeric, underscore, and @ symbol for parameters
    return /^[a-zA-Z][a-zA-Z0-9_@]*$/.test(identifier) && identifier.length <= 128;
  }

  async destroy(): Promise<void> {
    if (this.pool) {
      await this.pool.close();
      this.pool = null;
      this.isConnected = false;
    }
  }

  // Health check method
  async healthCheck(): Promise<boolean> {
    if (!this.isConnected || !this.pool) {
      return false;
    }

    try {
      const request = this.pool.request();
      await request.query('SELECT 1 AS healthy');
      return true;
    } catch {
      return false;
    }
  }
}

export const sqlDelegator = new SQLDelegator();