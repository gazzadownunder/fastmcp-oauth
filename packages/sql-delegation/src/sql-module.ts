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
import type { UserSession, AuditEntry } from 'mcp-oauth-framework/core';
import type { DelegationModule, DelegationResult } from 'mcp-oauth-framework/delegation';
import type { TokenExchangeService } from 'mcp-oauth-framework/delegation';
import { createSecurityError } from 'mcp-oauth-framework/core';

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Per-module token exchange configuration
 */
export interface TokenExchangeConfig {
  /** IDP name from auth.trustedIDPs to use for TE-JWT validation */
  idpName: string;

  /** Token exchange endpoint URL */
  tokenEndpoint: string;

  /** Client ID for token exchange */
  clientId: string;

  /** Client secret for token exchange */
  clientSecret: string;

  /** Expected audience for TE-JWT */
  audience?: string;

  /** Required claim in TE-JWT (e.g., legacy_name) */
  requiredClaim?: string;

  /** Token cache configuration */
  cache?: {
    enabled?: boolean;
    ttlSeconds?: number;
    sessionTimeoutMs?: number;
    maxEntriesPerSession?: number;
    maxTotalEntries?: number;
  };
}

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

  /**
   * Per-module token exchange configuration (Phase 2)
   *
   * When configured, the module will perform token exchange to obtain
   * TE-JWT with delegation-specific claims (e.g., legacy_name for SQL).
   *
   * Token exchange happens on-demand during delegate() method execution,
   * NOT during authentication.
   */
  tokenExchange?: TokenExchangeConfig;
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
 * **Multi-Instance Support:**
 * Multiple SQL Server modules can be registered with different names (e.g., 'sql1', 'sql2').
 * Each instance has independent configuration, connection pool, and token exchange settings.
 *
 * @example Single instance
 * ```typescript
 * const sqlModule = new SQLDelegationModule();
 * await sqlModule.initialize(config);
 * const result = await sqlModule.delegate(session, 'query', {
 *   sql: 'SELECT * FROM table WHERE id = @id',
 *   params: { id: 123 }
 * });
 * ```
 *
 * @example Multiple instances
 * ```typescript
 * const sql1 = new SQLDelegationModule('sql1');
 * await sql1.initialize({ server: 'db1.company.com', ... });
 *
 * const sql2 = new SQLDelegationModule('sql2');
 * await sql2.initialize({ server: 'db2.company.com', ... });
 * ```
 */
export class SQLDelegationModule implements DelegationModule {
  readonly name: string;
  readonly type = 'database';

  private pool: sql.ConnectionPool | null = null;
  private config: SQLConfig | null = null;
  private isConnected = false;
  private tokenExchangeService: TokenExchangeService | null = null;
  private tokenExchangeConfig: TokenExchangeConfig | null = null;

  /**
   * Create a new SQL Server delegation module
   *
   * @param name - Module name (e.g., 'sql', 'sql1', 'sql2')
   *               Defaults to 'sql' for backward compatibility
   */
  constructor(name: string = 'sql') {
    this.name = name;
  }

  /**
   * Initialize SQL connection pool
   *
   * Per-Module Token Exchange (Phase 2):
   * - Token exchange config comes from config.tokenExchange (not injected separately)
   * - Token exchange happens on-demand in delegate() method
   * - TokenExchangeService can be injected via context parameter in delegate()
   *
   * @param config - SQL Server configuration (includes optional tokenExchange)
   * @throws Error if connection fails
   */
  async initialize(config: SQLConfig): Promise<void> {
    if (this.isConnected) {
      return; // Already initialized
    }

    this.config = config;

    // Store token exchange config if provided (Phase 2: Per-module config)
    if (config.tokenExchange) {
      this.tokenExchangeConfig = config.tokenExchange;
      console.log(`[SQLModule:${this.name}] Token exchange enabled with IDP:`, config.tokenExchange.idpName);
    }

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
   * Per-Module Token Exchange (Phase 2):
   * - Gets TokenExchangeService from context.coreContext
   * - Uses session.requestorJWT (not session.claims.access_token)
   * - Validates TE-JWT with module's specific IDP (idpName)
   *
   * @param session - User session with requestorJWT
   * @param action - Action type: 'query', 'procedure', 'function'
   * @param params - Action parameters
   * @param context - Context with sessionId and coreContext
   * @returns Delegation result with audit trail
   */
  async delegate<T = unknown>(
    session: UserSession,
    action: string,
    params: any,
    context?: { sessionId?: string; coreContext?: any }
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
            source: `delegation:${this.name}`,
            userId: session.userId,
            action: `${this.name}_delegation:${action}`,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        };
      }
    }

    // PHASE 2: Per-Module Token Exchange (on-demand)
    let effectiveLegacyUsername = session.legacyUsername;

    // Attempt token exchange if configured
    if (this.tokenExchangeConfig) {
      try {
        // Get TokenExchangeService from context (injected by ConfigOrchestrator)
        const tokenExchangeService = context?.coreContext?.tokenExchangeService as TokenExchangeService | undefined;

        if (!tokenExchangeService) {
          return {
            success: false,
            error: 'Token exchange configured but TokenExchangeService not available in context',
            auditTrail: {
              timestamp: new Date(),
              source: `delegation:${this.name}`,
              userId: session.userId,
              action: `${this.name}_delegation:${action}`,
              success: false,
              reason: 'TokenExchangeService not in context',
            },
          };
        }

        // Get requestor JWT from session (Phase 2: stored during authentication)
        const requestorJWT = session.requestorJWT;

        if (!requestorJWT) {
          return {
            success: false,
            error: 'Session missing requestorJWT (required for token exchange)',
            auditTrail: {
              timestamp: new Date(),
              source: `delegation:${this.name}`,
              userId: session.userId,
              action: `${this.name}_delegation:${action}`,
              success: false,
              reason: 'Missing requestorJWT in session',
            },
          };
        }

        console.log('[SQLModule] Performing token exchange:', {
          idpName: this.tokenExchangeConfig.idpName,
          audience: this.tokenExchangeConfig.audience,
          userId: session.userId,
        });

        // Perform token exchange to get TE-JWT
        const exchangeResult = await tokenExchangeService.performExchange({
          requestorJWT,
          subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt',
          audience: this.tokenExchangeConfig.audience || 'sql-delegation',
          tokenEndpoint: this.tokenExchangeConfig.tokenEndpoint,
          clientId: this.tokenExchangeConfig.clientId,
          clientSecret: this.tokenExchangeConfig.clientSecret,
          sessionId: context?.sessionId, // For token caching
        });

        if (!exchangeResult.success || !exchangeResult.accessToken) {
          return {
            success: false,
            error: `Token exchange failed: ${exchangeResult.errorDescription || exchangeResult.error}`,
            auditTrail: {
              timestamp: new Date(),
              source: `delegation:${this.name}`,
              userId: session.userId,
              action: `${this.name}_delegation:${action}`,
              success: false,
              reason: `Token exchange error: ${exchangeResult.error}`,
            },
          };
        }

        // Decode TE-JWT to extract delegation claims
        const teClaims = tokenExchangeService.decodeTokenClaims(exchangeResult.accessToken);

        // Validate required claim if configured
        const requiredClaim = this.tokenExchangeConfig.requiredClaim || 'legacy_name';
        const claimValue = teClaims?.[requiredClaim];

        if (!claimValue) {
          return {
            success: false,
            error: `TE-JWT missing required claim: ${requiredClaim}`,
            auditTrail: {
              timestamp: new Date(),
              source: `delegation:${this.name}`,
              userId: session.userId,
              action: `${this.name}_delegation:${action}`,
              success: false,
              reason: `TE-JWT missing ${requiredClaim} claim`,
            },
          };
        }

        // Use claim value as legacy username
        effectiveLegacyUsername = claimValue as string;

        console.log('[SQLModule] Token exchange successful:', {
          legacyUsername: effectiveLegacyUsername,
          idpName: this.tokenExchangeConfig.idpName,
        });
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Token exchange failed',
          auditTrail: {
            timestamp: new Date(),
            source: `delegation:${this.name}`,
            userId: session.userId,
            action: `sql_delegation:${action}`,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        };
      }
    }

    // Fallback: Check if legacy username exists (for configs without token exchange)
    if (!effectiveLegacyUsername) {
      return {
        success: false,
        error: 'Unable to determine legacy username for SQL delegation (configure tokenExchange or provide legacyUsername in JWT)',
        auditTrail: {
          timestamp: new Date(),
          source: `delegation:${this.name}`,
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
              source: `delegation:${this.name}`,
              userId: session.userId,
              action: `${this.name}_delegation:${action}`,
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
          source: `delegation:${this.name}`,
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
          source: `delegation:${this.name}`,
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
