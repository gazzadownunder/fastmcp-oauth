/**
 * Kerberos delegation module - Production implementation
 *
 * This module provides Kerberos Constrained Delegation support using:
 * - S4U2Self: Service for User to Self (obtain ticket on behalf of user)
 * - S4U2Proxy: Service for User to Proxy (act on behalf of user to backend services)
 *
 * @module delegation/kerberos
 */

import type { DelegationModule, DelegationResult } from '../base.js';
import type { UserSession, AuditEntry } from '../../core/index.js';
import type { KerberosConfig, KerberosParams } from './types.js';
import { KerberosClient } from './kerberos-client.js';
import { TicketCache } from './ticket-cache.js';

/**
 * Kerberos delegation module
 *
 * @example
 * ```typescript
 * const kerberos = new KerberosDelegationModule();
 * await kerberos.initialize(config);
 *
 * const result = await kerberos.delegate(session, 's4u2self', {
 *   action: 's4u2self',
 *   userPrincipalName: 'ALICE@COMPANY.COM'
 * });
 * ```
 */
export class KerberosDelegationModule implements DelegationModule {
  /**
   * Module name
   */
  public readonly name = 'kerberos';

  /**
   * Module type
   */
  public readonly type = 'authentication';

  private config?: KerberosConfig;
  private client?: KerberosClient;
  private ticketCache?: TicketCache;

  /**
   * Initialize Kerberos delegation module
   *
   * @param config - Kerberos configuration
   * @throws {Error} If initialization fails
   */
  async initialize(config: KerberosConfig): Promise<void> {
    console.log('\n[KERBEROS-MODULE] Initializing Kerberos delegation module');
    console.log('[KERBEROS-MODULE] Configuration:', {
      domainController: config.domainController,
      realm: config.realm,
      servicePrincipalName: config.servicePrincipalName,
      kdc: config.kdc,
      enableS4U2Self: config.enableS4U2Self,
      enableS4U2Proxy: config.enableS4U2Proxy,
      allowedDelegationTargetsCount: config.allowedDelegationTargets?.length || 0,
      ticketCacheEnabled: config.ticketCache?.enabled !== false,
    });

    this.config = config;

    // Initialize Kerberos client
    console.log('[KERBEROS-MODULE] Creating Kerberos client');
    this.client = new KerberosClient(config);

    // Initialize ticket cache if enabled
    if (config.ticketCache?.enabled !== false) {
      console.log('[KERBEROS-MODULE] Initializing ticket cache:', {
        ttlSeconds: config.ticketCache?.ttlSeconds ?? 3600,
        renewThresholdSeconds: config.ticketCache?.renewThresholdSeconds ?? 300,
      });
      this.ticketCache = new TicketCache({
        enabled: true,
        ttlSeconds: config.ticketCache?.ttlSeconds ?? 3600,
        renewThresholdSeconds: config.ticketCache?.renewThresholdSeconds ?? 300,
        maxEntriesPerSession: 10,
        sessionTimeoutMs: 15 * 60 * 1000,
      });
    }

    // Obtain service ticket (TGT) for the MCP Server service account
    try {
      console.log('[KERBEROS-MODULE] Obtaining service ticket (TGT)');
      await this.client.obtainServiceTicket();
      console.log('[KERBEROS-MODULE] ✓ Service ticket obtained successfully');
    } catch (error) {
      console.error('[KERBEROS-MODULE] ✗ Failed to obtain service ticket:', error);
      throw new Error(
        `Failed to initialize Kerberos module: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Perform Kerberos delegation
   *
   * NEW ARCHITECTURE (Phase 3): Token exchange happens BEFORE this method is called!
   * - AuthenticationService performs token exchange during authentication
   * - TE-JWT claims (including legacy_name) are validated and stored in UserSession
   * - This method uses pre-validated claims from session.legacyUsername
   * - No token exchange happens here anymore
   *
   * @param session - User session (with pre-validated TE-JWT claims)
   * @param action - Delegation action (s4u2self, s4u2proxy)
   * @param params - Action parameters
   * @returns Delegation result with ticket
   */
  async delegate<T>(
    session: UserSession,
    action: string,
    params: KerberosParams
  ): Promise<DelegationResult<T>> {
    console.log('\n[KERBEROS-MODULE] delegate() called');
    console.log('[KERBEROS-MODULE] Action:', action);
    console.log('[KERBEROS-MODULE] Session:', {
      userId: session.userId,
      legacyUsername: session.legacyUsername,
      sessionId: session.sessionId,
      hasDelegationToken: !!session.delegationToken,
      hasCustomClaims: !!session.customClaims,
    });
    console.log('[KERBEROS-MODULE] Params:', params);

    // Validate user has legacy_username claim (should be pre-validated by AuthenticationService)
    if (!session.legacyUsername) {
      console.error('[KERBEROS-MODULE] Missing legacy_username claim in session');
      console.error('[KERBEROS-MODULE] This should have been validated during authentication!');
      const auditEntry: AuditEntry = {
        timestamp: new Date(),
        userId: session.userId,
        action: `kerberos:${action}`,
        success: false,
        reason: 'User session missing legacy_username claim (authentication validation failed)',
        metadata: { params },
        source: 'delegation:kerberos',
      };

      return {
        success: false,
        error: 'User session missing legacy_username claim for Kerberos delegation',
        auditTrail: auditEntry,
      };
    }

    // Use pre-validated legacy_username from session (populated by AuthenticationService)
    const effectiveLegacyUsername = session.legacyUsername;
    console.log('[KERBEROS-MODULE] Using pre-validated legacy_username from session:', effectiveLegacyUsername);

    // Build user principal name
    const userPrincipal = `${effectiveLegacyUsername}@${this.config!.realm}`;
    console.log('[KERBEROS-MODULE] User principal:', userPrincipal);

    try {
      let result: any;

      console.log('[KERBEROS-MODULE] Executing action:', action);

      switch (action) {
        case 's4u2self':
          result = await this.performS4U2Self(session, userPrincipal);
          break;

        case 's4u2proxy':
          result = await this.performS4U2Proxy(session, userPrincipal, params);
          break;

        case 'obtain-ticket':
          // Alias for s4u2self
          result = await this.performS4U2Self(session, userPrincipal);
          break;

        default:
          const auditEntry: AuditEntry = {
            timestamp: new Date(),
            userId: session.userId,
            action: `kerberos:${action}`,
            success: false,
            reason: `Unsupported action: ${action}`,
            metadata: { params },
            source: 'delegation:kerberos',
          };

          return {
            success: false,
            error: `Unsupported Kerberos action: ${action}. Supported: s4u2self, s4u2proxy`,
            auditTrail: auditEntry,
          };
      }

      console.log('[KERBEROS-MODULE] Action completed successfully:', {
        hasResult: !!result,
        cached: result?.cached,
        hasTicket: !!result?.ticket,
      });

      // Success audit entry
      const auditEntry: AuditEntry = {
        timestamp: new Date(),
        userId: session.userId,
        action: `kerberos:${action}`,
        success: true,
        metadata: {
          userPrincipal,
          targetSPN: params.targetSPN,
          cached: result.cached,
        },
        source: 'delegation:kerberos',
      };

      console.log('[KERBEROS-MODULE] ✓ Delegation successful');

      return {
        success: true,
        data: result as T,
        auditTrail: auditEntry,
      };
    } catch (error) {
      console.error('[KERBEROS-MODULE] ✗ Delegation failed:', error);
      console.error('[KERBEROS-MODULE] Error details:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });

      const auditEntry: AuditEntry = {
        timestamp: new Date(),
        userId: session.userId,
        action: `kerberos:${action}`,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: { userPrincipal, params },
        source: 'delegation:kerberos',
      };

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Kerberos delegation failed',
        auditTrail: auditEntry,
      };
    }
  }

  /**
   * Perform S4U2Self delegation
   *
   * @param session - User session
   * @param userPrincipal - User principal name
   * @returns Ticket result
   */
  private async performS4U2Self(
    session: UserSession,
    userPrincipal: string
  ): Promise<any> {
    // Check cache first
    let ticket = await this.ticketCache?.get(session.sessionId, userPrincipal);
    let cached = false;

    if (!ticket) {
      // Not in cache, obtain from KDC
      ticket = await this.client!.performS4U2Self(userPrincipal);

      // Cache the ticket
      if (this.ticketCache) {
        await this.ticketCache.set(session.sessionId, userPrincipal, ticket);
      }
    } else {
      cached = true;

      // Check if renewal needed
      const needsRenewal = await this.ticketCache?.needsRenewal(
        session.sessionId,
        userPrincipal
      );

      if (needsRenewal) {
        // Renew ticket in background
        this.client!.performS4U2Self(userPrincipal)
          .then((newTicket) => {
            this.ticketCache?.set(session.sessionId, userPrincipal, newTicket);
          })
          .catch((error) => {
            console.error('Background ticket renewal failed:', error);
          });
      }
    }

    // Update session heartbeat
    await this.ticketCache?.heartbeat(session.sessionId);

    return {
      ticket,
      cached,
    };
  }

  /**
   * Perform S4U2Proxy delegation
   *
   * @param session - User session
   * @param userPrincipal - User principal name
   * @param params - Delegation parameters
   * @returns Proxy ticket result
   */
  private async performS4U2Proxy(
    session: UserSession,
    userPrincipal: string,
    params: KerberosParams
  ): Promise<any> {
    if (!params.targetSPN) {
      throw new Error('targetSPN required for s4u2proxy action');
    }

    // First, get user ticket (S4U2Self)
    const s4u2selfResult = await this.performS4U2Self(session, userPrincipal);
    const userTicket = s4u2selfResult.ticket;

    // Then, perform S4U2Proxy to target service
    const proxyTicket = await this.client!.performS4U2Proxy(
      userTicket,
      params.targetSPN
    );

    return {
      ticket: proxyTicket,
      userTicket,
      cached: s4u2selfResult.cached,
    };
  }

  /**
   * Validate user session has required Kerberos attributes
   *
   * @param session - User session to validate
   * @returns true if user has legacy_username claim
   */
  async validateAccess(session: UserSession): Promise<boolean> {
    return !!session.legacyUsername;
  }

  /**
   * Check Kerberos module health
   *
   * @returns true if KDC is reachable and service ticket valid
   */
  async healthCheck(): Promise<boolean> {
    try {
      if (!this.client) {
        return false;
      }

      return await this.client.healthCheck();
    } catch {
      return false;
    }
  }

  /**
   * Destroy Kerberos module resources
   */
  async destroy(): Promise<void> {
    await this.ticketCache?.destroy();
    await this.client?.destroy();
    this.config = undefined;
    this.client = undefined;
    this.ticketCache = undefined;
  }

  /**
   * Get cache metrics (for monitoring)
   *
   * @returns Ticket cache metrics or undefined if cache disabled
   */
  getCacheMetrics() {
    return this.ticketCache?.getMetrics();
  }
}
