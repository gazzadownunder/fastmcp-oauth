/**
 * Delegation Module Base Types
 *
 * Defines the interface for pluggable delegation modules.
 * Modules implement specific delegation strategies (SQL, Kerberos, etc.)
 *
 * Architecture: Core → Delegation → MCP
 * Delegation layer CAN import from Core, but NOT from MCP
 *
 * @see Phase 2.1 of refactor.md
 */

import type { UserSession, AuditEntry } from '../core/index.js';

// ============================================================================
// Delegation Module Interface
// ============================================================================

/**
 * DelegationModule interface - All delegation modules must implement this
 *
 * A delegation module handles a specific delegation strategy:
 * - SQL: EXECUTE AS USER delegation to SQL Server
 * - Kerberos: S4U2Self/S4U2Proxy delegation for Windows services
 * - Custom: Any other delegation mechanism
 *
 * Critical Design:
 * - Modules create AuditEntry objects (auditTrail)
 * - DelegationRegistry logs the auditTrail
 * - Modules don't need direct AuditService injection
 *
 * Usage:
 * ```typescript
 * const module = new SQLDelegationModule();
 * await module.initialize(config);
 * const result = await module.delegate(session, 'query', { sql: 'SELECT ...' });
 * ```
 */
export interface DelegationModule {
  /** Unique module name (e.g., 'sql', 'kerberos') */
  readonly name: string;

  /** Module type category (e.g., 'database', 'auth', 'custom') */
  readonly type: string;

  /**
   * Initialize the module with configuration
   *
   * @param config - Module-specific configuration
   * @throws Error if initialization fails
   */
  initialize(config: any): Promise<void>;

  /**
   * Delegate an action on behalf of a user session
   *
   * @param session - Authenticated user session
   * @param action - Action to perform (module-specific, e.g., 'query', 'procedure')
   * @param params - Action parameters (module-specific)
   * @param context - Optional context with sessionId and CoreContext for advanced features
   * @returns Delegation result with audit trail
   *
   * **Phase 2 Enhancement:** CoreContext injection enables custom modules to use
   * the framework's TokenExchangeService for downstream API token exchange.
   *
   * @example Using TokenExchangeService
   * ```typescript
   * async delegate(session, action, params, context) {
   *   // Exchange requestor JWT for API-specific token
   *   const apiToken = await context?.coreContext?.tokenExchangeService?.performExchange({
   *     requestorJWT: session.claims.rawPayload,
   *     audience: 'urn:api:myservice',
   *     scope: 'api:read'
   *   });
   *
   *   // Use exchanged token for downstream API
   *   const response = await fetch('https://api.internal.com/data', {
   *     headers: { 'Authorization': `Bearer ${apiToken}` }
   *   });
   * }
   * ```
   */
  delegate<T = unknown>(
    session: UserSession,
    action: string,
    params: any,
    context?: {
      /** Session ID for token caching */
      sessionId?: string;
      /** CoreContext for accessing framework services (TokenExchangeService, etc.) */
      coreContext?: any; // Using 'any' to avoid circular dependency with Core layer
    }
  ): Promise<DelegationResult<T>>;

  /**
   * Validate that a session has access to this module
   *
   * @param session - User session to validate
   * @returns true if session has access, false otherwise
   */
  validateAccess(session: UserSession): Promise<boolean>;

  /**
   * Check module health
   *
   * @returns true if module is healthy, false otherwise
   */
  healthCheck(): Promise<boolean>;

  /**
   * Clean up resources
   */
  destroy(): Promise<void>;
}

// ============================================================================
// Delegation Result Type
// ============================================================================

/**
 * Result of a delegation operation
 *
 * CRITICAL: Modules create the auditTrail, Registry logs it
 * This separation ensures modules don't need AuditService injection
 *
 * @template T - Type of the result data
 */
export interface DelegationResult<T = unknown> {
  /** Whether the delegation succeeded */
  success: boolean;

  /** Result data (only present if success=true) */
  data?: T;

  /** Error message (only present if success=false) */
  error?: string;

  /**
   * Audit trail for this delegation attempt
   *
   * MANDATORY (GAP #3): Must include source field
   * Module creates this, Registry logs it to AuditService
   */
  auditTrail: AuditEntry;
}

// ============================================================================
// Module Configuration Types
// ============================================================================

/**
 * Base configuration for all delegation modules
 */
export interface DelegationModuleConfig {
  /** Whether this module is enabled */
  enabled?: boolean;

  /** Module-specific configuration */
  [key: string]: any;
}
