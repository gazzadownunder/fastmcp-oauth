/**
 * SQL Delegation Module
 *
 * Implements SQL Server delegation using EXECUTE AS USER.
 * Provides secure database operations on behalf of legacy users.
 *
 * Security Features:
 * - Parameterized queries only (prevents SQL injection)
 * - Dangerous operation blocking (DROP, ALTER, etc.)
 * - SQL identifier validation
 * - Automatic context reversion on error
 * - TLS encryption required
 *
 * @see Phase 2.3 of refactor.md
 */

import sql from 'mssql';
import type { UserSession, AuditEntry } from '../../core/index.js';
import type { DelegationModule, DelegationResult } from '../base.js';
import type { TokenExchangeService } from '../token-exchange.js';
import { createSecurityError } from '../../utils/errors.js';

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * SQL Server configuration
 */
export interface SQLConfig {
  /** SQL Server hostname or IP */
  server: string;

  /** Database name */
  database: string;

  /** Connection options */
  options?: {
    /** Use Windows trusted connection */
    trustedConnection?: boolean;

    /** Enable TLS encryption (always enabled for security) */
    encrypt?: boolean;

    /** Trust server certificate (should be false in production) */
    trustServerCertificate?: boolean;

    /** Additional mssql options */
    [key: string]: any;
  };

  /** Connection pool settings */
  pool?: {
    max?: number;
    min?: number;
    idleTimeoutMillis?: number;
  };

  /** Connection timeout in milliseconds */
  connectionTimeout?: number;

  /** Request timeout in milliseconds */
  requestTimeout?: number;
}

// ============================================================================
// SQL Delegation Module
// ============================================================================

/**
 * SQL Delegation Module - Implements EXECUTE AS USER delegation
 *
 * Allows executing SQL operations on behalf of legacy users using
 * SQL Server's EXECUTE AS USER feature.
 *
 * Critical Security:
 * - ONLY parameterized queries allowed
 * - Dangerous operations blocked (DROP, CREATE, ALTER, TRUNCATE, etc.)
 * - SQL identifier validation enforced
 * - Context automatically reverted on error
 *
 * Usage:
 * ```typescript
 * const sqlModule = new SQLDelegationModule();
 * await sqlModule.initialize(config);
 * const result = await sqlModule.delegate(session, 'query', {
 *   sql: 'SELECT * FROM table WHERE id = @id',
 *   params: { id: 123 }
 * });
 * ```
 */
export class SQLDelegationModule implements DelegationModule {
  readonly name = 'sql';
  readonly type = 'database';

  private pool: sql.ConnectionPool | null = null;
  private config: SQLConfig | null = null;
  private isConnected = false;
  private tokenExchangeService: TokenExchangeService | null = null;
  private tokenExchangeConfig: {
    tokenEndpoint: string;
    clientId: string;
    clientSecret: string;
    audience?: string;
  } | null = null;

  /**
   * Set token exchange service (optional for Phase 1)
   *
   * @param service - TokenExchangeService instance
   * @param config - Token exchange configuration
   */
  setTokenExchangeService(
    service: TokenExchangeService,
    config: {
      tokenEndpoint: string;
      clientId: string;
      clientSecret: string;
      audience?: string;
    }
  ): void {
    this.tokenExchangeService = service;
    this.tokenExchangeConfig = config;
  }

  /**
   * Initialize SQL connection pool
   *
   * @param config - SQL Server configuration
   * @throws Error if connection fails
   */
  async initialize(config: SQLConfig): Promise<void> {
    if (this.isConnected) {
      return; // Already initialized
    }

    this.config = config;

    try {
      const connectionConfig: sql.config = {
        server: config.server,
        database: config.database,
        options: {
          ...config.options,
          trustServerCertificate: config.options?.trustServerCertificate ?? false,
          encrypt: true, // MANDATORY: Always encrypt connections
        },
        pool: {
          max: config.pool?.max ?? 10,
          min: config.pool?.min ?? 0,
          idleTimeoutMillis: config.pool?.idleTimeoutMillis ?? 30000,
        },
        connectionTimeout: config.connectionTimeout ?? 5000,
        requestTimeout: config.requestTimeout ?? 30000,
      };

      this.pool = new sql.ConnectionPool(connectionConfig);
      await this.pool.connect();
      this.isConnected = true;
    } catch (error) {
      throw createSecurityError(
        'SQL_CONNECTION_FAILED',
        `Failed to initialize SQL connection: ${error instanceof Error ? error.message : error}`,
        500
      );
    }
  }

  /**
   * Delegate SQL operation on behalf of user
   *
   * @param session - User session with legacyUsername
   * @param action - Action type: 'query', 'procedure', 'function'
   * @param params - Action parameters
   * @returns Delegation result with audit trail
   */
  async delegate<T = unknown>(
    session: UserSession,
    action: string,
    params: any
  ): Promise<DelegationResult<T>> {
    // Ensure initialized
    if (!this.isConnected || !this.pool) {
      try {
        if (!this.config) {
          throw new Error('SQL module not initialized. Call initialize() first.');
        }
        await this.initialize(this.config);
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Initialization failed',
          auditTrail: {
            timestamp: new Date(),
            source: 'delegation:sql',
            userId: session.userId,
            action: `sql_delegation:${action}`,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        };
      }
    }

    // Validate legacyUsername exists (fallback for when TE-JWT is not available)
    if (!session.legacyUsername && !this.tokenExchangeService) {
      return {
        success: false,
        error: 'Session missing legacyUsername (required for SQL delegation)',
        auditTrail: {
          timestamp: new Date(),
          source: 'delegation:sql',
          userId: session.userId,
          action: `sql_delegation:${action}`,
          success: false,
          reason: 'Missing legacyUsername',
        },
      };
    }

    // PHASE 1: Token Exchange (if configured)
    let effectiveLegacyUsername = session.legacyUsername;

    if (this.tokenExchangeService) {
      try {
        // Extract JWT from session claims
        const subjectToken = session.claims?.access_token as string | undefined;

        if (!subjectToken) {
          return {
            success: false,
            error: 'Session missing access_token in claims (required for token exchange)',
            auditTrail: {
              timestamp: new Date(),
              source: 'delegation:sql',
              userId: session.userId,
              action: `sql_delegation:${action}`,
              success: false,
              reason: 'Missing access_token in session claims',
            },
          };
        }

        // Validate token exchange configuration
        if (!this.tokenExchangeConfig) {
          return {
            success: false,
            error: 'Token exchange service configured but missing token exchange config',
            auditTrail: {
              timestamp: new Date(),
              source: 'delegation:sql',
              userId: session.userId,
              action: `sql_delegation:${action}`,
              success: false,
              reason: 'Missing token exchange configuration',
            },
          };
        }

        // Perform token exchange to get TE-JWT
        const exchangeResult = await this.tokenExchangeService.performExchange({
          subjectToken,
          subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt',
          audience: this.tokenExchangeConfig.audience || 'sql-delegation',
          tokenEndpoint: this.tokenExchangeConfig.tokenEndpoint,
          clientId: this.tokenExchangeConfig.clientId,
          clientSecret: this.tokenExchangeConfig.clientSecret,
        });

        if (!exchangeResult.success || !exchangeResult.accessToken) {
          return {
            success: false,
            error: `Token exchange failed: ${exchangeResult.errorDescription || exchangeResult.error}`,
            auditTrail: {
              timestamp: new Date(),
              source: 'delegation:sql',
              userId: session.userId,
              action: `sql_delegation:${action}`,
              success: false,
              reason: `Token exchange error: ${exchangeResult.error}`,
            },
          };
        }

        // Decode TE-JWT to extract delegation claims
        const teClaims = this.tokenExchangeService.decodeTokenClaims(exchangeResult.accessToken);

        if (!teClaims || !teClaims.legacy_name) {
          return {
            success: false,
            error: 'TE-JWT missing legacy_name claim (required for SQL delegation)',
            auditTrail: {
              timestamp: new Date(),
              source: 'delegation:sql',
              userId: session.userId,
              action: `sql_delegation:${action}`,
              success: false,
              reason: 'TE-JWT missing legacy_name claim',
            },
          };
        }

        // Use legacy_name from TE-JWT
        effectiveLegacyUsername = teClaims.legacy_name;
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Token exchange failed',
          auditTrail: {
            timestamp: new Date(),
            source: 'delegation:sql',
            userId: session.userId,
            action: `sql_delegation:${action}`,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        };
      }
    }

    // Ensure we have a legacy username at this point
    if (!effectiveLegacyUsername) {
      return {
        success: false,
        error: 'Unable to determine legacy username for SQL delegation',
        auditTrail: {
          timestamp: new Date(),
          source: 'delegation:sql',
          userId: session.userId,
          action: `sql_delegation:${action}`,
          success: false,
          reason: 'No legacy username available',
        },
      };
    }

    // Route to appropriate handler
    try {
      let result: T;

      switch (action) {
        case 'query':
          result = await this.executeQuery(effectiveLegacyUsername, params);
          break;

        case 'procedure':
          result = await this.executeProcedure(effectiveLegacyUsername, params);
          break;

        case 'function':
          result = await this.executeFunction(effectiveLegacyUsername, params);
          break;

        default:
          return {
            success: false,
            error: `Unknown action: ${action}`,
            auditTrail: {
              timestamp: new Date(),
              source: 'delegation:sql',
              userId: session.userId,
              action: `sql_delegation:${action}`,
              success: false,
              reason: `Unknown action type: ${action}`,
            },
          };
      }

      return {
        success: true,
        data: result,
        auditTrail: {
          timestamp: new Date(),
          source: 'delegation:sql',
          userId: session.userId,
          action: `sql_delegation:${action}`,
          success: true,
          metadata: {
            legacyUsername: effectiveLegacyUsername,
            action,
            tokenExchangeUsed: !!this.tokenExchangeService,
          },
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'SQL operation failed',
        auditTrail: {
          timestamp: new Date(),
          source: 'delegation:sql',
          userId: session.userId,
          action: `sql_delegation:${action}`,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          metadata: {
            legacyUsername: effectiveLegacyUsername,
            tokenExchangeUsed: !!this.tokenExchangeService,
          },
        },
      };
    }
  }

  /**
   * Validate user has access to SQL delegation
   *
   * @param session - User session
   * @returns true if user has legacyUsername (required for delegation)
   */
  async validateAccess(session: UserSession): Promise<boolean> {
    return !!session.legacyUsername;
  }

  /**
   * Health check - verify SQL connection
   *
   * @returns true if connected and healthy
   */
  async healthCheck(): Promise<boolean> {
    if (!this.pool || !this.isConnected) {
      return false;
    }

    try {
      const request = this.pool.request();
      await request.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clean up resources
   */
  async destroy(): Promise<void> {
    if (this.pool) {
      await this.pool.close();
      this.pool = null;
      this.isConnected = false;
    }
  }

  // ==========================================================================
  // Private Methods - SQL Operation Handlers
  // ==========================================================================

  /**
   * Execute SQL query with EXECUTE AS USER
   *
   * @param legacyUsername - Legacy SAM account name
   * @param params - Query parameters
   * @returns Query results
   */
  private async executeQuery<T>(
    legacyUsername: string,
    params: { sql: string; params?: Record<string, any> }
  ): Promise<T> {
    if (!this.pool) {
      throw new Error('SQL pool not initialized');
    }

    // Validate SQL
    this.validateSQL(params.sql);

    // Validate identifier
    this.validateIdentifier(legacyUsername);

    const request = this.pool.request();

    try {
      // Set execution context
      await request.query(`EXECUTE AS USER = '${this.escapeSingleQuotes(legacyUsername)}'`);

      // Add parameters
      if (params.params) {
        for (const [key, value] of Object.entries(params.params)) {
          request.input(key, value);
        }
      }

      // Execute query
      const result = await request.query(params.sql);

      // Revert context
      await request.query('REVERT');

      return result.recordset as T;
    } catch (error) {
      // Ensure context is reverted even on error
      try {
        await request.query('REVERT');
      } catch {
        // Ignore revert errors
      }
      throw error;
    }
  }

  /**
   * Execute stored procedure with EXECUTE AS USER
   */
  private async executeProcedure<T>(
    legacyUsername: string,
    params: { procedure: string; params?: Record<string, any> }
  ): Promise<T> {
    if (!this.pool) {
      throw new Error('SQL pool not initialized');
    }

    this.validateIdentifier(legacyUsername);
    this.validateIdentifier(params.procedure);

    const request = this.pool.request();

    try {
      await request.query(`EXECUTE AS USER = '${this.escapeSingleQuotes(legacyUsername)}'`);

      if (params.params) {
        for (const [key, value] of Object.entries(params.params)) {
          request.input(key, value);
        }
      }

      const result = await request.execute(params.procedure);

      await request.query('REVERT');

      return result.recordset as T;
    } catch (error) {
      try {
        await request.query('REVERT');
      } catch {
        // Ignore
      }
      throw error;
    }
  }

  /**
   * Execute scalar function with EXECUTE AS USER
   */
  private async executeFunction<T>(
    legacyUsername: string,
    params: { functionName: string; params?: Record<string, any> }
  ): Promise<T> {
    if (!this.pool) {
      throw new Error('SQL pool not initialized');
    }

    this.validateIdentifier(legacyUsername);
    this.validateIdentifier(params.functionName);

    const request = this.pool.request();

    try {
      await request.query(`EXECUTE AS USER = '${this.escapeSingleQuotes(legacyUsername)}'`);

      if (params.params) {
        for (const [key, value] of Object.entries(params.params)) {
          request.input(key, value);
        }
      }

      const paramList = params.params
        ? Object.keys(params.params)
            .map(k => `@${k}`)
            .join(', ')
        : '';

      const result = await request.query(`SELECT ${params.functionName}(${paramList}) AS result`);

      await request.query('REVERT');

      return result.recordset[0].result as T;
    } catch (error) {
      try {
        await request.query('REVERT');
      } catch {
        // Ignore
      }
      throw error;
    }
  }

  // ==========================================================================
  // Security Validators
  // ==========================================================================

  /**
   * Validate SQL query for dangerous operations
   */
  private validateSQL(sqlQuery: string): void {
    const dangerous = [
      'DROP',
      'CREATE',
      'ALTER',
      'TRUNCATE',
      'xp_cmdshell',
      'sp_executesql',
    ];

    const upperSQL = sqlQuery.toUpperCase();
    for (const keyword of dangerous) {
      if (upperSQL.includes(keyword)) {
        throw createSecurityError(
          'SQL_DANGEROUS_OPERATION',
          `Dangerous SQL operation blocked: ${keyword}`,
          403
        );
      }
    }
  }

  /**
   * Validate SQL identifier format
   */
  private validateIdentifier(identifier: string): void {
    // SQL identifier rules: alphanumeric, underscore, starts with letter
    const pattern = /^[a-zA-Z_][a-zA-Z0-9_\\]*$/;

    if (!pattern.test(identifier)) {
      throw createSecurityError(
        'SQL_INVALID_IDENTIFIER',
        `Invalid SQL identifier: ${identifier}`,
        400
      );
    }
  }

  /**
   * Escape single quotes in string for SQL
   */
  private escapeSingleQuotes(str: string): string {
    return str.replace(/'/g, "''");
  }
}
