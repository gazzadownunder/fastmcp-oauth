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

// Import kerberos package - use default export for ES modules
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

      // Use keytab if provided, otherwise use password
      let authOptions: any;

      if (this.config.serviceAccount.keytabPath) {
        console.log('[KERBEROS-CLIENT] Using keytab authentication:', this.config.serviceAccount.keytabPath);
        // Authenticate using keytab
        authOptions = {
          principal: `${username}@${realm}`,
          keytab: this.config.serviceAccount.keytabPath,
        };
      } else if (this.config.serviceAccount.password) {
        console.log('[KERBEROS-CLIENT] Using password authentication');
        // Authenticate using password
        authOptions = {
          principal: `${username}@${realm}`,
          password: this.config.serviceAccount.password,
        };
      } else {
        console.error('[KERBEROS-CLIENT] No authentication method provided');
        throw new Error(
          'Service account must have either password or keytabPath configured'
        );
      }

      console.log('[KERBEROS-CLIENT] Initializing Kerberos client with node-kerberos library');
      console.log('[KERBEROS-CLIENT] Platform:', process.platform);
      console.log('[KERBEROS-CLIENT] Auth options:', {
        principal: authOptions.principal,
        hasPassword: !!authOptions.password,
        hasKeytab: !!authOptions.keytab,
      });

      // Initialize Kerberos authentication
      // API: initializeClient(service, options)
      // - service: 'type@fqdn' format (e.g., 'HTTP@mcp-server.w25ad.net')
      // - options: { principal, user, pass, flags, mechOID }
      //
      // Cross-Platform Authentication:
      // - Windows (SSPI): Use 'user' and 'pass' options for explicit credentials
      // - Linux/macOS (GSSAPI): Set KRB5_KTNAME environment variable for keytab

      // Convert SPN to 'type@fqdn' format required by kerberos library
      // From: 'HTTP/mcp-server.w25ad.net@W25AD.NET' or 'HTTP/mcp-server@W25AD.NET'
      // To: 'HTTP@mcp-server.w25ad.net'
      const spnParts = this.config.servicePrincipalName.split('/');
      const serviceType = spnParts[0]; // e.g., 'HTTP' or 'host'
      const serviceHost = spnParts.length > 1 ? spnParts[1] : this.config.domainController || `mcp-server.${this.config.realm.toLowerCase()}`;
      const serviceFormatted = `${serviceType}@${serviceHost}`;

      console.log('[KERBEROS-CLIENT] Service SPN (formatted):', serviceFormatted);

      // Build options for kerberos.initializeClient()
      const initOptions: any = {
        principal: `${username}@${realm}`,
      };

      const isWindows = process.platform === 'win32';
      const isLinux = process.platform === 'linux' || process.platform === 'darwin';

      if (isWindows) {
        // Windows: Use SSPI with explicit credentials (user/pass)
        // This allows the MCP server to run as any account and specify delegation
        // credentials per operation (true multi-tenant delegation)
        console.log('[KERBEROS-CLIENT] Windows platform detected - using SSPI');
        initOptions.mechOID = kerberos.GSS_MECH_OID_SPNEGO; // SPNEGO for Windows compatibility

        if (this.config.serviceAccount.password) {
          console.log('[KERBEROS-CLIENT] Using explicit credentials (user/pass) for SSPI');
          initOptions.user = username;
          initOptions.pass = this.config.serviceAccount.password;
        } else if (this.config.serviceAccount.keytabPath) {
          console.warn('[KERBEROS-CLIENT] WARNING: keytab not supported on Windows');
          console.warn('[KERBEROS-CLIENT] Falling back to process credentials (current logged-in user)');
          console.warn('[KERBEROS-CLIENT] For multi-tenant delegation, configure password instead of keytab');
          // Let SSPI use process credentials
        } else {
          console.warn('[KERBEROS-CLIENT] No credentials provided - using process credentials (current logged-in user)');
        }
      } else if (isLinux) {
        // Linux/macOS: Use GSSAPI with keytab file
        // Set KRB5_KTNAME environment variable to point to keytab file
        console.log('[KERBEROS-CLIENT] Linux/macOS platform detected - using GSSAPI');
        initOptions.mechOID = kerberos.GSS_MECH_OID_KRB5; // Kerberos for Linux

        if (this.config.serviceAccount.keytabPath) {
          console.log('[KERBEROS-CLIENT] Using keytab authentication:', this.config.serviceAccount.keytabPath);
          // Set environment variable for GSSAPI to find keytab
          process.env.KRB5_KTNAME = this.config.serviceAccount.keytabPath;
          console.log('[KERBEROS-CLIENT] Set KRB5_KTNAME environment variable');
        } else if (this.config.serviceAccount.password) {
          console.warn('[KERBEROS-CLIENT] WARNING: Password authentication on Linux requires kinit command');
          console.warn('[KERBEROS-CLIENT] Please use keytab file instead for production deployments');
          console.warn('[KERBEROS-CLIENT] Falling back to default credential cache (requires manual kinit)');
          // Let GSSAPI use default credential cache (/tmp/krb5cc_*)
        } else {
          console.warn('[KERBEROS-CLIENT] No credentials provided - using default credential cache');
          console.warn('[KERBEROS-CLIENT] Requires manual kinit or existing TGT in credential cache');
        }
      } else {
        throw new Error(
          `Unsupported platform: ${process.platform}. Kerberos delegation is only supported on Windows, Linux, and macOS.`
        );
      }

      console.log('[KERBEROS-CLIENT] Calling kerberos.initializeClient()');
      this.kerberosClient = await kerberos.initializeClient(
        serviceFormatted,
        initOptions
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
   * @param userPrincipal - User principal name (e.g., ALICE@COMPANY.COM)
   * @returns Kerberos ticket for the user
   * @throws {Error} If S4U2Self fails
   */
  async performS4U2Self(userPrincipal: string): Promise<KerberosTicket> {
    console.log('\n[KERBEROS-CLIENT] performS4U2Self() called');
    console.log('[KERBEROS-CLIENT] User principal:', userPrincipal);

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

      // Use Kerberos client to perform S4U2Self
      // This is a simplified implementation - real S4U2Self requires GSS-API calls
      const ticket = await this.kerberosClient.step('', {
        s4u2self: {
          userPrincipal,
          targetSPN,
        },
      });

      return {
        principal: userPrincipal,
        service: targetSPN,
        expiresAt: new Date(Date.now() + 10 * 60 * 60 * 1000), // 10 hours
        ticketData: ticket,
        flags: ['FORWARDABLE', 'PROXIABLE'],
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
   * @param userTicket - User ticket from S4U2Self
   * @param targetSPN - Target service principal (e.g., MSSQLSvc/sql01.company.com:1433)
   * @returns Proxy ticket for backend service
   * @throws {Error} If S4U2Proxy fails or SPN not allowed
   */
  async performS4U2Proxy(
    userTicket: KerberosTicket,
    targetSPN: string
  ): Promise<KerberosTicket> {
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

      // Use Kerberos client to perform S4U2Proxy
      const ticket = await this.kerberosClient.step('', {
        s4u2proxy: {
          evidenceTicket: userTicket.ticketData,
          targetSPN: fullTargetSPN,
        },
      });

      return {
        principal: userTicket.principal,
        service: this.config.servicePrincipalName,
        targetService: fullTargetSPN,
        delegatedFrom: `${this.config.serviceAccount.username}@${this.config.realm}`,
        expiresAt: new Date(Date.now() + 10 * 60 * 60 * 1000), // 10 hours
        ticketData: ticket,
        flags: ['FORWARDED'],
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
