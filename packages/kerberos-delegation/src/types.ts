/**
 * Kerberos delegation module types
 * @module delegation/kerberos/types
 */

import type { DelegationModuleConfig } from '../base.js';

/**
 * Service account configuration for Kerberos authentication
 */
export interface ServiceAccountConfig {
  /**
   * Service account username
   * @example "svc-mcp-server"
   */
  username: string;

  /**
   * Service account password (Windows SSPI)
   * @example "ServicePassword123!"
   */
  password?: string;

  /**
   * Path to keytab file (Linux/Unix GSSAPI)
   * @example "/etc/keytabs/svc-mcp-server.keytab"
   */
  keytabPath?: string;
}

/**
 * Kerberos delegation configuration
 */
export interface KerberosConfig extends DelegationModuleConfig {
  /**
   * Active Directory domain controller
   * @example "dc.company.com"
   */
  domainController: string;

  /**
   * Service Principal Name (SPN) for delegation
   * @example "HTTP/webapp.company.com"
   */
  servicePrincipalName: string;

  /**
   * Kerberos realm (typically uppercase domain)
   * @example "COMPANY.COM"
   */
  realm: string;

  /**
   * Service account credentials for Kerberos authentication
   * Required for obtaining service tickets (TGT)
   */
  serviceAccount: ServiceAccountConfig;

  /**
   * Key Distribution Center (KDC) address
   * @example "kdc.company.com:88"
   */
  kdc?: string;

  /**
   * Enable S4U2Self (Service for User to Self)
   * Allows service to obtain ticket on behalf of user
   */
  enableS4U2Self?: boolean;

  /**
   * Enable S4U2Proxy (Service for User to Proxy)
   * Allows service to act on behalf of user to backend services
   */
  enableS4U2Proxy?: boolean;

  /**
   * Allowed delegation targets (SPNs that can be delegated to)
   * @example ["MSSQLSvc/sql01.company.com:1433", "HTTP/api.company.com"]
   */
  allowedDelegationTargets?: string[];

  /**
   * Ticket cache configuration
   */
  ticketCache?: {
    enabled?: boolean;
    ttlSeconds?: number;
    renewThresholdSeconds?: number;
  };
}

/**
 * Kerberos delegation action types
 */
export type KerberosAction =
  | 'obtain-ticket'
  | 's4u2self'
  | 's4u2proxy'
  | 'validate-ticket';

/**
 * Kerberos delegation parameters
 */
export interface KerberosParams {
  /**
   * Action to perform
   */
  action: KerberosAction;

  /**
   * Target service principal name (for s4u2proxy)
   */
  targetSPN?: string;

  /**
   * User principal name (for s4u2self)
   */
  userPrincipalName?: string;

  /**
   * Kerberos ticket (for validate-ticket)
   */
  ticket?: string;
}
