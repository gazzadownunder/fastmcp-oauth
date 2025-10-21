/**
 * PostgreSQL Delegation Module
 *
 * Implements PostgreSQL delegation using SET ROLE.
 * Provides secure database operations on behalf of delegated users.
 *
 * Security Features:
 * - Parameterized queries only (prevents SQL injection)
 * - Dangerous operation blocking (DROP, ALTER, etc.)
 * - SQL identifier validation
 * - Automatic role reset on error
 * - TLS encryption support
 *
 * @see Phase 2.3 of refactor.md
 */

import pg from 'pg';
const { Pool } = pg;
import type { UserSession, AuditEntry } from '../../core/index.js';
import type { DelegationModule, DelegationResult } from '../base.js';
import type { TokenExchangeService } from '../token-exchange.js';
import { createSecurityError } from '../../utils/errors.js';

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * PostgreSQL Server configuration
 */
export interface PostgreSQLConfig {
  /** PostgreSQL hostname or IP */
  host: string;

  /** PostgreSQL port (default: 5432) */
  port?: number;

  /** Database name */
  database: string;

  /** Service account user */
  user: string;

  /** Service account password */
  password: string;

  /** Connection options */
  options?: {
    /** Enable SSL/TLS encryption */
    ssl?: boolean | {
      rejectUnauthorized?: boolean;
      ca?: string;
      cert?: string;
      key?: string;
    };

    /** Additional pg options */
    [key: string]: any;
  };

  /** Connection pool settings */
  pool?: {
    max?: number;
    min?: number;
    idleTimeoutMillis?: number;
    connectionTimeoutMillis?: number;
  };
}

// ============================================================================
// PostgreSQL Delegation Module
// ============================================================================

/**
 * PostgreSQL Delegation Module - Implements SET ROLE delegation
 *
 * Allows executing PostgreSQL operations on behalf of delegated users using
 * PostgreSQL's SET ROLE feature.
 *
 * Critical Security:
 * - ONLY parameterized queries allowed
 * - Dangerous operations blocked (DROP, CREATE, ALTER, TRUNCATE, etc.)
 * - SQL identifier validation enforced
 * - Role automatically reset on error
 *
 * Usage:
 * ```typescript
 * const pgModule = new PostgreSQLDelegationModule();
 * await pgModule.initialize(config);
 * const result = await pgModule.delegate(session, 'query', {
 *   sql: 'SELECT * FROM table WHERE id = $1',
 *   params: [123]
 * });
 * ```
 */
export class PostgreSQLDelegationModule implements DelegationModule {
  readonly name = 'postgresql';
  readonly type = 'database';

  private pool: pg.Pool | null = null;
  private config: PostgreSQLConfig | null = null;
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
   * Initialize PostgreSQL connection pool
   */
  async initialize(config: PostgreSQLConfig): Promise<void> {
    if (this.isConnected) {
      return; // Already initialized
    }

    this.config = config;

    try {
      this.pool = new Pool({
        host: config.host,
        port: config.port ?? 5432,
        database: config.database,
        user: config.user,
        password: config.password,
        ssl: config.options?.ssl ?? false,
        max: config.pool?.max ?? 10,
        min: config.pool?.min ?? 0,
        idleTimeoutMillis: config.pool?.idleTimeoutMillis ?? 30000,
        connectionTimeoutMillis: config.pool?.connectionTimeoutMillis ?? 5000,
      });

      // Test connection
      const client = await this.pool.connect();
      client.release();
      this.isConnected = true;
    } catch (error) {
      throw createSecurityError(
        'POSTGRESQL_CONNECTION_FAILED',
        `Failed to initialize PostgreSQL connection: ${error instanceof Error ? error.message : error}`,
        500
      );
    }
  }

  /**
   * Delegate PostgreSQL operation on behalf of user
   *
   * **Phase 2 Enhancement:** Now accepts optional context parameter with CoreContext.
   * This enables access to framework services like TokenExchangeService.
   *
   * @param session - User session
   * @param action - Action to perform
   * @param params - Action parameters
   * @param context - Optional context with sessionId and coreContext
   */
  async delegate<T = unknown>(
    session: UserSession,
    action: string,
    params: any,
    context?: {
      sessionId?: string;
      coreContext?: any;
    }
  ): Promise<DelegationResult<T>> {
    // Ensure initialized
    if (!this.isConnected || !this.pool) {
      try {
        if (!this.config) {
          throw new Error('PostgreSQL module not initialized. Call initialize() first.');
        }
        await this.initialize(this.config);
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Initialization failed',
          auditTrail: {
            timestamp: new Date(),
            source: 'delegation:postgresql',
            userId: session.userId,
            action: `postgresql_delegation:${action}`,
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
        error: 'Session missing legacyUsername (required for PostgreSQL delegation)',
        auditTrail: {
          timestamp: new Date(),
          source: 'delegation:postgresql',
          userId: session.userId,
          action: `postgresql_delegation:${action}`,
          success: false,
          reason: 'Missing legacyUsername',
        },
      };
    }

    // PHASE 1: Token Exchange (if configured)
    let effectiveLegacyUsername = session.legacyUsername;
    let teRoles: string[] | undefined = undefined;

    console.log('[PostgreSQL] Token Exchange Check:', {
      hasTokenExchangeService: !!this.tokenExchangeService,
      hasTokenExchangeConfig: !!this.tokenExchangeConfig,
      sessionLegacyUsername: session.legacyUsername,
    });

    if (this.tokenExchangeService) {
      console.log('[PostgreSQL] Token exchange service is configured - attempting token exchange');

      try {
        // Extract JWT from session claims
        const subjectToken = session.claims?.access_token as string | undefined;
        console.log('[PostgreSQL] Extracting subject token from session.claims.access_token:', {
          hasSubjectToken: !!subjectToken,
          subjectTokenLength: subjectToken?.length,
          availableClaimKeys: Object.keys(session.claims || {}),
        });

        if (!subjectToken) {
          console.error('[PostgreSQL] ERROR: No access_token in session claims');
          return {
            success: false,
            error: 'Session missing access_token in claims (required for token exchange)',
            auditTrail: {
              timestamp: new Date(),
              source: 'delegation:postgresql',
              userId: session.userId,
              action: `postgresql_delegation:${action}`,
              success: false,
              reason: 'Missing access_token in session claims',
            },
          };
        }

        // Validate token exchange configuration
        if (!this.tokenExchangeConfig) {
          console.error('[PostgreSQL] ERROR: Token exchange service exists but config is missing');
          return {
            success: false,
            error: 'Token exchange service configured but missing token exchange config',
            auditTrail: {
              timestamp: new Date(),
              source: 'delegation:postgresql',
              userId: session.userId,
              action: `postgresql_delegation:${action}`,
              success: false,
              reason: 'Missing token exchange configuration',
            },
          };
        }

        console.log('[PostgreSQL] Performing token exchange with IDP:', {
          tokenEndpoint: this.tokenExchangeConfig.tokenEndpoint,
          clientId: this.tokenExchangeConfig.clientId,
          audience: this.tokenExchangeConfig.audience || 'postgresql-delegation',
        });

        // Perform token exchange to get TE-JWT
        // Use access_token type (RFC 8693) - Keycloak requires this
        const exchangeResult = await this.tokenExchangeService.performExchange({
          subjectToken,
          subjectTokenType: 'urn:ietf:params:oauth:token-type:access_token',
          audience: this.tokenExchangeConfig.audience || 'postgresql-delegation',
          tokenEndpoint: this.tokenExchangeConfig.tokenEndpoint,
          clientId: this.tokenExchangeConfig.clientId,
          clientSecret: this.tokenExchangeConfig.clientSecret,
        });

        console.log('[PostgreSQL] Token exchange result:', {
          success: exchangeResult.success,
          hasAccessToken: !!exchangeResult.accessToken,
          error: exchangeResult.error,
          errorDescription: exchangeResult.errorDescription,
        });

        if (!exchangeResult.success || !exchangeResult.accessToken) {
          console.error('[PostgreSQL] Token exchange FAILED:', exchangeResult.error);
          return {
            success: false,
            error: `Token exchange failed: ${exchangeResult.errorDescription || exchangeResult.error}`,
            auditTrail: {
              timestamp: new Date(),
              source: 'delegation:postgresql',
              userId: session.userId,
              action: `postgresql_delegation:${action}`,
              success: false,
              reason: `Token exchange error: ${exchangeResult.error}`,
            },
          };
        }

        // Decode TE-JWT to extract delegation claims
        console.log('[PostgreSQL] Decoding delegation token (TE-JWT) to extract claims...');
        const teClaims = this.tokenExchangeService.decodeTokenClaims(exchangeResult.accessToken);
        console.log('[PostgreSQL] Delegation token claims:', {
          sub: teClaims?.sub,
          legacy_name: teClaims?.legacy_name,
          roles: teClaims?.roles,
          aud: teClaims?.aud,
        });

        if (!teClaims || !teClaims.legacy_name) {
          return {
            success: false,
            error: 'TE-JWT missing legacy_name claim (required for PostgreSQL delegation)',
            auditTrail: {
              timestamp: new Date(),
              source: 'delegation:postgresql',
              userId: session.userId,
              action: `postgresql_delegation:${action}`,
              success: false,
              reason: 'TE-JWT missing legacy_name claim',
            },
          };
        }

        // Extract TE-JWT roles for command-level authorization
        teRoles = Array.isArray(teClaims.roles) ? teClaims.roles : [];
        console.log('[PostgreSQL] Extracted TE-JWT roles for command authorization:', { teRoles, action });

        // Determine required role based on action
        const hasReadAccess = teRoles.some((role: string) =>
          ['sql-read', 'sql-write', 'sql-admin', 'admin'].includes(role)
        );

        // Schema and table-details are read operations
        if ((action === 'schema' || action === 'table-details') && !hasReadAccess) {
          return {
            success: false,
            error: "Insufficient permissions to perform this operation.",
            auditTrail: {
              timestamp: new Date(),
              source: 'delegation:postgresql',
              userId: session.userId,
              action: `postgresql_delegation:${action}`,
              success: false,
              reason: `Insufficient permissions: user has roles [${teRoles.join(', ')}], requires sql-read or higher`,
            },
          };
        }

        // Query action - roles will be checked at SQL command level by validateSQL
        if (action === 'query' && !hasReadAccess) {
          return {
            success: false,
            error: "Insufficient permissions to perform this operation.",
            auditTrail: {
              timestamp: new Date(),
              source: 'delegation:postgresql',
              userId: session.userId,
              action: `postgresql_delegation:${action}`,
              success: false,
              reason: `Insufficient permissions: user has roles [${teRoles.join(', ')}], requires sql-read or higher`,
            },
          };
        }

        console.log('[PostgreSQL] Action-level authorization check PASSED:', { action, teRoles });

        // Use legacy_name from TE-JWT for SET ROLE
        effectiveLegacyUsername = teClaims.legacy_name;
        console.log('[PostgreSQL] Token exchange SUCCESS - using legacy_name from TE-JWT:', effectiveLegacyUsername);
      } catch (error) {
        console.error('[PostgreSQL] Token exchange EXCEPTION:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Token exchange failed',
          auditTrail: {
            timestamp: new Date(),
            source: 'delegation:postgresql',
            userId: session.userId,
            action: `postgresql_delegation:${action}`,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        };
      }
    } else {
      console.log('[PostgreSQL] No token exchange service - using session.legacyUsername:', effectiveLegacyUsername);
    }

    // Ensure we have a legacy username at this point
    if (!effectiveLegacyUsername) {
      console.error('[PostgreSQL] ERROR: No effective legacy username available');
      return {
        success: false,
        error: 'Unable to determine legacy username for PostgreSQL delegation',
        auditTrail: {
          timestamp: new Date(),
          source: 'delegation:postgresql',
          userId: session.userId,
          action: `postgresql_delegation:${action}`,
          success: false,
          reason: 'No legacy username available',
        },
      };
    }

    console.log('[PostgreSQL] Proceeding with delegation action:', {
      action,
      effectiveLegacyUsername,
      userId: session.userId,
    });

    // Route to appropriate handler
    try {
      let result: T;

      switch (action) {
        case 'query':
          console.log('[PostgreSQL] Routing to executeQuery handler with roles:', teRoles);
          result = await this.executeQuery(effectiveLegacyUsername, params, teRoles);
          break;

        case 'schema':
          console.log('[PostgreSQL] Routing to getSchema handler');
          result = await this.getSchema(effectiveLegacyUsername, params);
          break;

        case 'table-details':
          result = await this.getTableDetails(effectiveLegacyUsername, params);
          break;

        default:
          return {
            success: false,
            error: `Unknown action: ${action}`,
            auditTrail: {
              timestamp: new Date(),
              source: 'delegation:postgresql',
              userId: session.userId,
              action: `postgresql_delegation:${action}`,
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
          source: 'delegation:postgresql',
          userId: session.userId,
          action: `postgresql_delegation:${action}`,
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
        error: error instanceof Error ? error.message : 'PostgreSQL operation failed',
        auditTrail: {
          timestamp: new Date(),
          source: 'delegation:postgresql',
          userId: session.userId,
          action: `postgresql_delegation:${action}`,
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
   * Validate user has access to PostgreSQL delegation
   */
  async validateAccess(session: UserSession): Promise<boolean> {
    return !!session.legacyUsername;
  }

  /**
   * Health check - verify PostgreSQL connection
   */
  async healthCheck(): Promise<boolean> {
    if (!this.pool || !this.isConnected) {
      return false;
    }

    try {
      const client = await this.pool.connect();
      await client.query('SELECT 1');
      client.release();
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
      await this.pool.end();
      this.pool = null;
      this.isConnected = false;
    }
  }

  // ==========================================================================
  // Private Methods - PostgreSQL Operation Handlers
  // ==========================================================================

  /**
   * Execute SQL query with SET ROLE
   */
  private async executeQuery<T>(
    roleName: string,
    params: { sql: string; params?: any[] },
    teJwtRoles?: string[]
  ): Promise<T> {
    if (!this.pool) {
      throw new Error('PostgreSQL pool not initialized');
    }

    // Validate SQL with role-based authorization
    this.validateSQL(params.sql, teJwtRoles);

    // Validate identifier
    this.validateIdentifier(roleName);

    const client = await this.pool.connect();

    try {
      // Set role
      await client.query(`SET ROLE ${this.escapeIdentifier(roleName)}`);

      // Execute query
      const result = await client.query(params.sql, params.params || []);

      // Reset role
      await client.query('RESET ROLE');

      client.release();

      // For data modification commands (INSERT/UPDATE/DELETE), always return metadata
      // For SELECT and other commands, return rows
      const dataModificationCommands = ['INSERT', 'UPDATE', 'DELETE'];
      if (dataModificationCommands.includes(result.command)) {
        // Return operation metadata for INSERT/UPDATE/DELETE
        return {
          success: true,
          rowCount: result.rowCount || 0,
          command: result.command,
          message: this.getOperationMessage(result.command, result.rowCount || 0),
        } as T;
      } else {
        // For SELECT and other commands, return rows
        return result.rows as T;
      }
    } catch (error) {
      // Ensure role is reset even on error
      try {
        await client.query('RESET ROLE');
      } catch {
        // Ignore reset errors
      }
      client.release();
      throw error;
    }
  }

  /**
   * Generate user-friendly message for SQL operations
   */
  private getOperationMessage(command: string, rowCount: number): string {
    switch (command) {
      case 'INSERT':
        return `Successfully inserted ${rowCount} row${rowCount !== 1 ? 's' : ''}`;
      case 'UPDATE':
        return `Successfully updated ${rowCount} row${rowCount !== 1 ? 's' : ''}`;
      case 'DELETE':
        return `Successfully deleted ${rowCount} row${rowCount !== 1 ? 's' : ''}`;
      default:
        return `Operation completed successfully. Rows affected: ${rowCount}`;
    }
  }

  /**
   * Get database schema (tables list)
   */
  private async getSchema<T>(
    roleName: string,
    params: { schemaName?: string }
  ): Promise<T> {
    if (!this.pool) {
      throw new Error('PostgreSQL pool not initialized');
    }

    this.validateIdentifier(roleName);
    const schemaName = params.schemaName || 'public';
    this.validateIdentifier(schemaName);

    const client = await this.pool.connect();

    try {
      await client.query(`SET ROLE ${this.escapeIdentifier(roleName)}`);

      const result = await client.query(
        `SELECT
          table_name,
          table_type
        FROM information_schema.tables
        WHERE table_schema = $1
        ORDER BY table_name`,
        [schemaName]
      );

      await client.query('RESET ROLE');
      client.release();
      return result.rows as T;
    } catch (error) {
      try {
        await client.query('RESET ROLE');
      } catch {
        // Ignore
      }
      client.release();
      throw error;
    }
  }

  /**
   * Get table details (columns, types, etc.)
   */
  private async getTableDetails<T>(
    roleName: string,
    params: { tableName: string; schemaName?: string }
  ): Promise<T> {
    if (!this.pool) {
      throw new Error('PostgreSQL pool not initialized');
    }

    this.validateIdentifier(roleName);
    this.validateIdentifier(params.tableName);
    const schemaName = params.schemaName || 'public';
    this.validateIdentifier(schemaName);

    const client = await this.pool.connect();

    try {
      await client.query(`SET ROLE ${this.escapeIdentifier(roleName)}`);

      const result = await client.query(
        `SELECT
          column_name,
          data_type,
          is_nullable,
          column_default,
          character_maximum_length
        FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position`,
        [schemaName, params.tableName]
      );

      await client.query('RESET ROLE');
      client.release();
      return result.rows as T;
    } catch (error) {
      try {
        await client.query('RESET ROLE');
      } catch {
        // Ignore
      }
      client.release();
      throw error;
    }
  }

  // ==========================================================================
  // Security Validators
  // ==========================================================================

  /**
   * Validate SQL query based on user roles from TE-JWT
   *
   * Role-based command authorization:
   * - sql-read: SELECT only
   * - sql-write: SELECT, INSERT, UPDATE, DELETE
   * - sql-admin: All commands except dangerous operations
   * - admin: All commands including dangerous operations
   *
   * @param sqlQuery - SQL query to validate
   * @param roles - User roles from TE-JWT (optional, defaults to no restrictions)
   */
  private validateSQL(sqlQuery: string, roles?: string[]): void {
    const upperSQL = sqlQuery.trim().toUpperCase();

    // Extract the primary SQL command (first keyword)
    const commandMatch = upperSQL.match(/^(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE|WITH|EXPLAIN|SHOW|DESCRIBE)/);
    const command = commandMatch ? commandMatch[1] : null;

    if (!command) {
      throw createSecurityError(
        'POSTGRESQL_INVALID_SQL',
        'Unable to determine SQL command type',
        400
      );
    }

    // If roles are provided, enforce role-based access control
    if (roles && roles.length > 0) {
      const hasReadAccess = roles.some((role: string) =>
        ['sql-read', 'sql-write', 'sql-admin', 'admin'].includes(role)
      );
      const hasWriteAccess = roles.some((role: string) =>
        ['sql-write', 'sql-admin', 'admin'].includes(role)
      );
      const hasAdminAccess = roles.some((role: string) =>
        ['sql-admin', 'admin'].includes(role)
      );
      const hasSuperAdminAccess = roles.some((role: string) =>
        ['admin'].includes(role)
      );

      // Define command categories
      const readCommands = ['SELECT', 'WITH', 'EXPLAIN', 'SHOW', 'DESCRIBE'];
      const writeCommands = ['INSERT', 'UPDATE', 'DELETE'];
      const adminCommands = ['CREATE', 'ALTER', 'GRANT', 'REVOKE'];
      const dangerousCommands = ['DROP', 'TRUNCATE'];

      // Check authorization based on command type
      if (readCommands.includes(command)) {
        if (!hasReadAccess) {
          throw createSecurityError(
            'POSTGRESQL_INSUFFICIENT_PERMISSIONS',
            `Insufficient permissions to execute ${command} operation.`,
            403
          );
        }
      } else if (writeCommands.includes(command)) {
        if (!hasWriteAccess) {
          throw createSecurityError(
            'POSTGRESQL_INSUFFICIENT_PERMISSIONS',
            `Insufficient permissions to execute ${command} operation.`,
            403
          );
        }
      } else if (adminCommands.includes(command)) {
        if (!hasAdminAccess) {
          throw createSecurityError(
            'POSTGRESQL_INSUFFICIENT_PERMISSIONS',
            `Insufficient permissions to execute ${command} operation.`,
            403
          );
        }
      } else if (dangerousCommands.includes(command)) {
        if (!hasSuperAdminAccess) {
          throw createSecurityError(
            'POSTGRESQL_DANGEROUS_OPERATION',
            `Insufficient permissions to execute ${command} operation.`,
            403
          );
        }
      } else {
        // Unknown command - require admin access
        if (!hasAdminAccess) {
          throw createSecurityError(
            'POSTGRESQL_UNKNOWN_COMMAND',
            `Insufficient permissions to execute ${command} operation.`,
            403
          );
        }
      }
    } else {
      // No roles provided - fall back to basic dangerous operation blocking (legacy behavior)
      const dangerous = [
        'DROP',
        'CREATE',
        'ALTER',
        'TRUNCATE',
        'GRANT',
        'REVOKE',
      ];

      for (const keyword of dangerous) {
        if (upperSQL.includes(keyword)) {
          throw createSecurityError(
            'POSTGRESQL_DANGEROUS_OPERATION',
            `Dangerous SQL operation blocked: ${keyword}`,
            403
          );
        }
      }
    }
  }

  /**
   * Validate SQL identifier format
   */
  private validateIdentifier(identifier: string): void {
    // PostgreSQL identifier rules: alphanumeric, underscore, starts with letter
    const pattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

    if (!pattern.test(identifier)) {
      throw createSecurityError(
        'POSTGRESQL_INVALID_IDENTIFIER',
        `Invalid PostgreSQL identifier: ${identifier}`,
        400
      );
    }
  }

  /**
   * Escape identifier for PostgreSQL
   */
  private escapeIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
  }
}
