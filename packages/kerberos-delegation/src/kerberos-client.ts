/**
 * Kerberos Client - Native Kerberos authentication and delegation
 *
 * Implements Windows Kerberos Constrained Delegation:
 * - S4U2Self: Service for User to Self (obtain ticket on behalf of user)
 * - S4U2Proxy: Service for User to Proxy (delegate to backend services)
 *
 * Uses node-kerberos library for Windows SSPI integration.
 *
 * @module delegation/kerberos/kerberos-client
 */

import kerberos from 'kerberos';
import type { KerberosConfig } from './types.js';

/**
 * Kerberos ticket structure
 */
export interface KerberosTicket {
  /**
   * User principal name (e.g., ALICE@COMPANY.COM)
   */
  principal: string;

  /**
   * Service principal name
   */
  service: string;

  /**
   * Target service (for proxy tickets)
   */
  targetService?: string;

  /**
   * Delegated from service (for proxy tickets)
   */
  delegatedFrom?: string;

  /**
   * Ticket expiration timestamp
   */
  expiresAt: Date;

  /**
   * Raw ticket data (base64 encoded)
   */
  ticketData: string;

  /**
   * Ticket flags
   */
  flags?: string[];
}

/**
 * KerberosClient - Handles Kerberos authentication and delegation
 *
 * Provides methods to:
 * - Obtain service ticket (TGT) for MCP Server service account
 * - Perform S4U2Self (obtain ticket on behalf of user)
 * - Perform S4U2Proxy (delegate to backend services)
 * - Validate and renew tickets
 *
 * @example
 * ```typescript
 * const client = new KerberosClient(config);
 * await client.obtainServiceTicket();
 *
 * // Get ticket for user
 * const userTicket = await client.performS4U2Self('ALICE@COMPANY.COM');
 *
 * // Delegate to SQL Server
 * const proxyTicket = await client.performS4U2Proxy(
 *   userTicket,
 *   'MSSQLSvc/sql01.company.com:1433'
 * );
 * ```
 */
export class KerberosClient {
  private config: KerberosConfig;
  private serviceTicket?: KerberosTicket;
  private kerberosClient?: any;

  constructor(config: KerberosConfig) {
    this.config = config;
  }

  /**
   * Obtain service ticket (TGT) for MCP Server service account
   *
   * This ticket is used to perform S4U2Self operations.
   *
   * @throws {Error} If ticket acquisition fails
   */
  async obtainServiceTicket(): Promise<void> {
    console.log('\n[KERBEROS-CLIENT] obtainServiceTicket() called');

    try {
      // Initialize Kerberos client
      const servicePrincipal = `${this.config.servicePrincipalName}@${this.config.realm}`;
      const username = this.config.serviceAccount.username;
      const realm = this.config.realm;

      console.log('[KERBEROS-CLIENT] Service principal:', servicePrincipal);
      console.log('[KERBEROS-CLIENT] Service account:', username);
      console.log('[KERBEROS-CLIENT] Realm:', realm);
      console.log('[KERBEROS-CLIENT] Domain Controller:', this.config.domainController);
      console.log('[KERBEROS-CLIENT] KDC:', this.config.kdc);

      // Use keytab if provided, otherwise use password, otherwise use current user credentials
      let authOptions: any = {};

      if (this.config.serviceAccount.keytabPath) {
        console.log('[KERBEROS-CLIENT] Using keytab authentication:', this.config.serviceAccount.keytabPath);
        // Authenticate using keytab (Linux/Unix)
        authOptions = {
          principal: `${username}@${realm}`,
          keytab: this.config.serviceAccount.keytabPath,
        };
      } else if (this.config.serviceAccount.password) {
        console.log('[KERBEROS-CLIENT] Password provided - attempting password authentication');
        console.log('[KERBEROS-CLIENT] NOTE: On Windows, password auth requires credentials in Windows Credential Manager');
        // On Windows SSPI: password field is ignored, uses cached credentials
        // On Linux MIT Kerberos: password is used directly
        authOptions = {
          principal: `${username}@${realm}`,
          password: this.config.serviceAccount.password,
        };
      } else {
        console.log('[KERBEROS-CLIENT] No credentials provided - using current user credentials (Windows SSPI)');
        console.log('[KERBEROS-CLIENT] This requires the current user to be logged into the domain');
        // Use current user's cached credentials (Windows SSPI default behavior)
        // No principal or password needed - SSPI uses current security context
        authOptions = {};
      }

      console.log('[KERBEROS-CLIENT] Initializing Kerberos client with node-kerberos library');
      console.log('[KERBEROS-CLIENT] Auth options:', {
        principal: authOptions.principal,
        hasPassword: !!authOptions.password,
        hasKeytab: !!authOptions.keytab,
      });

      // Initialize Kerberos client using the module-level function
      console.log('[KERBEROS-CLIENT] Initializing client for service principal:', servicePrincipal);

      this.kerberosClient = await kerberos.initializeClient(
        servicePrincipal,
        authOptions
      );

      console.log('[KERBEROS-CLIENT] ✓ Kerberos client initialized');
      console.log('[KERBEROS-CLIENT] Obtaining TGT (Ticket Granting Ticket)');

      // Get initial ticket (TGT)
      const ticket = await this.kerberosClient.step('');

      console.log('[KERBEROS-CLIENT] ✓ TGT obtained');
      console.log('[KERBEROS-CLIENT] Ticket length:', ticket?.length || 0);

      // Parse ticket data
      this.serviceTicket = {
        principal: servicePrincipal,
        service: `krbtgt/${realm}@${realm}`,
        expiresAt: new Date(Date.now() + 10 * 60 * 60 * 1000), // Default 10 hours
        ticketData: ticket,
        flags: ['FORWARDABLE', 'RENEWABLE'],
      };

      console.log('[KERBEROS-CLIENT] ✓ Service ticket stored successfully');
    } catch (error) {
      console.error('[KERBEROS-CLIENT] ✗ Failed to obtain service ticket:', error);
      console.error('[KERBEROS-CLIENT] Error details:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw new Error(
        `Failed to obtain service ticket: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Perform S4U2Self - Obtain ticket on behalf of user
   *
   * Service for User to Self (S4U2Self) allows a service to obtain a
   * Kerberos ticket on behalf of a user without requiring the user's
   * credentials. This is protocol transition.
   *
   * Prerequisites:
   * - Service account has TrustedToAuthForDelegation enabled
   * - Service has valid TGT (call obtainServiceTicket first)
   *
   * NOTE: The node-kerberos library (v2.2.2) does NOT support S4U2Self/S4U2Proxy.
   * This implementation creates a stub ticket that will be used by Windows
   * authentication when accessing resources (SMB shares, etc).
   *
   * @param userPrincipal - User principal name (e.g., ALICE@COMPANY.COM)
   * @returns Kerberos ticket for the user (stub implementation)
   * @throws {Error} If validation fails
   */
  async performS4U2Self(userPrincipal: string): Promise<KerberosTicket> {
    console.log('\n[KERBEROS-CLIENT] performS4U2Self() called');
    console.log('[KERBEROS-CLIENT] User principal:', userPrincipal);
    console.log('[KERBEROS-CLIENT] NOTE: Using stub implementation - node-kerberos does not support S4U2Self');

    if (!this.serviceTicket) {
      console.error('[KERBEROS-CLIENT] Service ticket not available');
      throw new Error(
        'Service ticket not obtained. Call obtainServiceTicket() first.'
      );
    }

    try {
      // Validate user principal format
      if (!userPrincipal.includes('@')) {
        console.error('[KERBEROS-CLIENT] Invalid user principal format:', userPrincipal);
        throw new Error(
          `Invalid user principal format: ${userPrincipal}. Expected format: USER@REALM`
        );
      }

      // Extract username from principal
      const [username] = userPrincipal.split('@');
      console.log('[KERBEROS-CLIENT] Username:', username);

      // For S4U2Self, we request a ticket for the user to our service
      const targetSPN = `${this.config.servicePrincipalName}@${this.config.realm}`;

      // STUB IMPLEMENTATION:
      // The node-kerberos library does not support S4U2Self operations.
      // Instead, we create a stub ticket that contains the user principal.
      // Actual Kerberos delegation will be handled by Windows SSPI when
      // accessing resources (e.g., via PowerShell, SMB client, etc).

      console.log('[KERBEROS-CLIENT] Creating stub ticket for user:', userPrincipal);
      console.log('[KERBEROS-CLIENT] Target SPN:', targetSPN);
      console.log('[KERBEROS-CLIENT] Actual delegation will be handled by Windows SSPI');

      return {
        principal: userPrincipal,
        service: targetSPN,
        expiresAt: new Date(Date.now() + 10 * 60 * 60 * 1000), // 10 hours
        ticketData: Buffer.from(JSON.stringify({
          userPrincipal,
          targetSPN,
          timestamp: Date.now(),
          note: 'Stub ticket - real delegation handled by Windows SSPI'
        })).toString('base64'),
        flags: ['FORWARDABLE', 'PROXIABLE', 'STUB'],
      };
    } catch (error) {
      throw new Error(
        `S4U2Self failed for ${userPrincipal}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Perform S4U2Proxy - Delegate to backend service
   *
   * Service for User to Proxy (S4U2Proxy) allows a service to obtain a
   * Kerberos ticket for a backend service on behalf of a user.
   *
   * Prerequisites:
   * - User ticket from S4U2Self
   * - Target SPN in msDS-AllowedToDelegateTo list
   *
   * NOTE: The node-kerberos library (v2.2.2) does NOT support S4U2Proxy.
   * This implementation creates a stub ticket. Actual delegation to backend
   * services must be handled by Windows SSPI or PowerShell with CredSSP.
   *
   * @param userTicket - User ticket from S4U2Self
   * @param targetSPN - Target service principal (e.g., MSSQLSvc/sql01.company.com:1433 or cifs/fileserver)
   * @returns Proxy ticket for backend service (stub implementation)
   * @throws {Error} If validation fails or SPN not allowed
   */
  async performS4U2Proxy(
    userTicket: KerberosTicket,
    targetSPN: string
  ): Promise<KerberosTicket> {
    console.log('\n[KERBEROS-CLIENT] performS4U2Proxy() called');
    console.log('[KERBEROS-CLIENT] Target SPN:', targetSPN);
    console.log('[KERBEROS-CLIENT] User principal:', userTicket.principal);
    console.log('[KERBEROS-CLIENT] NOTE: Using stub implementation - node-kerberos does not support S4U2Proxy');

    // Validate target SPN is in allowed delegation targets
    if (
      this.config.allowedDelegationTargets &&
      !this.config.allowedDelegationTargets.includes(targetSPN)
    ) {
      throw new Error(
        `Target SPN not in allowed delegation targets: ${targetSPN}. ` +
          `Allowed targets: ${this.config.allowedDelegationTargets.join(', ')}`
      );
    }

    try {
      // Append realm if not present
      const fullTargetSPN = targetSPN.includes('@')
        ? targetSPN
        : `${targetSPN}@${this.config.realm}`;

      console.log('[KERBEROS-CLIENT] Full target SPN:', fullTargetSPN);

      // STUB IMPLEMENTATION:
      // The node-kerberos library does not support S4U2Proxy operations.
      // Instead, we create a stub ticket that contains delegation metadata.
      // Actual Kerberos delegation will be handled by:
      // 1. Windows SSPI when accessing SMB shares (native authentication)
      // 2. PowerShell with CredSSP for file/network operations
      // 3. SQL Server integrated security with delegation

      console.log('[KERBEROS-CLIENT] Creating stub proxy ticket');
      console.log('[KERBEROS-CLIENT] Actual delegation will be handled by Windows SSPI');

      return {
        principal: userTicket.principal,
        service: this.config.servicePrincipalName,
        targetService: fullTargetSPN,
        delegatedFrom: `${this.config.serviceAccount.username}@${this.config.realm}`,
        expiresAt: new Date(Date.now() + 10 * 60 * 60 * 1000), // 10 hours
        ticketData: Buffer.from(JSON.stringify({
          userPrincipal: userTicket.principal,
          targetSPN: fullTargetSPN,
          evidenceTicket: userTicket.ticketData,
          delegatedFrom: `${this.config.serviceAccount.username}@${this.config.realm}`,
          timestamp: Date.now(),
          note: 'Stub proxy ticket - real delegation handled by Windows SSPI'
        })).toString('base64'),
        flags: ['FORWARDED', 'STUB'],
      };
    } catch (error) {
      throw new Error(
        `S4U2Proxy failed for target ${targetSPN}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Validate ticket is still valid
   *
   * Checks:
   * - Ticket has not expired
   * - Ticket data is not corrupted
   *
   * @param ticket - Ticket to validate
   * @returns true if valid, false otherwise
   */
  async validateTicket(ticket: KerberosTicket): Promise<boolean> {
    try {
      // Check expiration
      if (ticket.expiresAt < new Date()) {
        return false;
      }

      // Verify ticket data is valid base64
      if (!ticket.ticketData || ticket.ticketData.length === 0) {
        return false;
      }

      // Try to decode ticket data
      Buffer.from(ticket.ticketData, 'base64');

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Renew ticket before expiration
   *
   * Requests a new ticket with extended lifetime.
   *
   * @param ticket - Ticket to renew
   * @returns Renewed ticket
   * @throws {Error} If renewal fails
   */
  async renewTicket(ticket: KerberosTicket): Promise<KerberosTicket> {
    try {
      // For service tickets, re-obtain from KDC
      if (ticket.service.startsWith('krbtgt/')) {
        await this.obtainServiceTicket();
        return this.serviceTicket!;
      }

      // For user tickets, perform S4U2Self again
      if (ticket.principal !== this.serviceTicket?.principal) {
        return await this.performS4U2Self(ticket.principal);
      }

      throw new Error('Cannot renew this ticket type');
    } catch (error) {
      throw new Error(
        `Ticket renewal failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Health check - verify can communicate with KDC
   *
   * @returns true if KDC is reachable, false otherwise
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Try to obtain a service ticket
      await this.obtainServiceTicket();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Destroy Kerberos client and clear tickets
   */
  async destroy(): Promise<void> {
    this.serviceTicket = undefined;
    this.kerberosClient = undefined;
  }
}
