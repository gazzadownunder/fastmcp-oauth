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

  /** Roles claim path in TE-JWT (default: 'roles') */
  rolesClaim?: string;

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

  /**
   * Per-module token exchange configuration (Phase 2)
   *
   * When configured, the module will perform token exchange to obtain
   * TE-JWT with delegation-specific claims (e.g., legacy_name for PostgreSQL).
   *
   * Token exchange happens on-demand during delegate() method execution,
   * NOT during authentication.
   */
  tokenExchange?: TokenExchangeConfig;
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
  private tokenExchangeConfig: TokenExchangeConfig | null = null;

  /**
   * Initialize PostgreSQL connection pool
   *
   * Per-Module Token Exchange (Phase 2):
   * - Token exchange config comes from config.tokenExchange (not injected separately)
   * - Token exchange happens on-demand in delegate() method
   * - TokenExchangeService can be injected via context parameter in delegate()
   *
   * @param config - PostgreSQL configuration (includes optional tokenExchange)
   * @throws Error if connection fails
   */
  async initialize(config: PostgreSQLConfig): Promise<void> {
    console.log('[PostgreSQLModule] VERSION: Phase2-Fix-2025-01-06-v3 - Per-module token exchange implementation');

    if (this.isConnected) {
      return; // Already initialized
    }

    this.config = config;

    // Store token exchange config if provided (Phase 2: Per-module config)
    if (config.tokenExchange) {
      this.tokenExchangeConfig = config.tokenExchange;
      console.log('[PostgreSQLModule] Token exchange enabled with IDP:', config.tokenExchange.idpName);
    }

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

    // PHASE 2: Per-Module Token Exchange (on-demand)
    console.log('[PostgreSQLModule] delegate() VERSION: Phase2-Fix-2025-01-06-v3');
    let effectiveLegacyUsername = session.legacyUsername;
    let teRoles: string[] = []; // Roles extracted from TE-JWT (if token exchange used)

    // Attempt token exchange if configured
    if (this.tokenExchangeConfig) {
      try {
        // DEBUG: Log what we received in context
        console.log('[PostgreSQLModule] DEBUG: context type:', typeof context);
        console.log('[PostgreSQLModule] DEBUG: context is null?', context === null);
        console.log('[PostgreSQLModule] DEBUG: context is undefined?', context === undefined);
        console.log('[PostgreSQLModule] DEBUG: context keys:', context ? Object.keys(context) : 'N/A');
        console.log('[PostgreSQLModule] DEBUG: has coreContext?', !!context?.coreContext);
        console.log('[PostgreSQLModule] DEBUG: coreContext keys:', context?.coreContext ? Object.keys(context.coreContext) : 'N/A');
        console.log('[PostgreSQLModule] DEBUG: has tokenExchangeService?', !!context?.coreContext?.tokenExchangeService);
        console.log('[PostgreSQLModule] DEBUG: tokenExchangeService type:', typeof context?.coreContext?.tokenExchangeService);

        // Get TokenExchangeService from context (injected by ConfigOrchestrator)
        const tokenExchangeService = context?.coreContext?.tokenExchangeService as TokenExchangeService | undefined;

        if (!tokenExchangeService) {
          console.error('[PostgreSQLModule] ERROR: TokenExchangeService not available - dumping context structure');
          console.error('[PostgreSQLModule] ERROR: Full context:', JSON.stringify(context, null, 2));
          return {
            success: false,
            error: 'Token exchange configured but TokenExchangeService not available in context',
            auditTrail: {
              timestamp: new Date(),
              source: 'delegation:postgresql',
              userId: session.userId,
              action: `postgresql_delegation:${action}`,
              success: false,
              reason: 'TokenExchangeService not in context',
            },
          };
        }

        // Get requestor JWT from session (Phase 2: stored during authentication)
        const requestorJWT = session.requestorJWT;

        console.log('[PostgreSQLModule] DEBUG: requestorJWT from session:', {
          exists: !!requestorJWT,
          type: typeof requestorJWT,
          length: requestorJWT?.length,
          first50chars: requestorJWT?.substring(0, 50),
        });

        if (!requestorJWT) {
          console.error('[PostgreSQLModule] ERROR: Session is missing requestorJWT');
          console.error('[PostgreSQLModule] ERROR: Session keys:', Object.keys(session));
          console.error('[PostgreSQLModule] ERROR: Session dump:', JSON.stringify(session, null, 2));
          return {
            success: false,
            error: 'Session missing requestorJWT (required for token exchange)',
            auditTrail: {
              timestamp: new Date(),
              source: 'delegation:postgresql',
              userId: session.userId,
              action: `postgresql_delegation:${action}`,
              success: false,
              reason: 'Missing requestorJWT in session',
            },
          };
        }

        console.log('[PostgreSQLModule] Performing token exchange:', {
          idpName: this.tokenExchangeConfig.idpName,
          audience: this.tokenExchangeConfig.audience,
          userId: session.userId,
          requestorJWTLength: requestorJWT.length,
        });

        // Perform token exchange to get TE-JWT
        const exchangeResult = await tokenExchangeService.performExchange({
          requestorJWT,
          subjectTokenType: 'urn:ietf:params:oauth:token-type:access_token',
          audience: this.tokenExchangeConfig.audience || 'postgresql-delegation',
          tokenEndpoint: this.tokenExchangeConfig.tokenEndpoint,
          clientId: this.tokenExchangeConfig.clientId,
          clientSecret: this.tokenExchangeConfig.clientSecret,
          cache: this.tokenExchangeConfig.cache,
          sessionId: context?.sessionId, // For token caching
        });

        if (!exchangeResult.success || !exchangeResult.accessToken) {
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
              source: 'delegation:postgresql',
              userId: session.userId,
              action: `postgresql_delegation:${action}`,
              success: false,
              reason: `TE-JWT missing ${requiredClaim} claim`,
            },
          };
        }

        // Use claim value as legacy username
        effectiveLegacyUsername = claimValue as string;

        // Extract roles from TE-JWT (may be in 'roles', 'user_roles', or other claim)
        const rolesClaimPath = this.tokenExchangeConfig.rolesClaim || 'roles';
        teRoles = (Array.isArray(teClaims?.[rolesClaimPath])
          ? teClaims[rolesClaimPath]
          : []) as string[];

        console.log('[PostgreSQLModule] Token exchange successful:', {
          legacyUsername: effectiveLegacyUsername,
          roles: teRoles,
          rolesClaimPath,
          idpName: this.tokenExchangeConfig.idpName,
        });
      } catch (error) {
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
    }

    // Fallback: Check if legacy username exists (for configs without token exchange)
    if (!effectiveLegacyUsername) {
      return {
        success: false,
        error: 'Unable to determine legacy username for PostgreSQL delegation (configure tokenExchange or provide legacyUsername in JWT)',
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
            tokenExchangeUsed: !!this.tokenExchangeConfig,
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
            tokenExchangeUsed: !!this.tokenExchangeConfig,
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
