/**
 * Kerberos Delegation Configuration Schema
 *
 * Defines configuration for Kerberos Constrained Delegation (KCD).
 * Supports Windows Active Directory S4U2Self and S4U2Proxy delegation.
 *
 * @module config/schemas/kerberos
 */

import { z } from 'zod';

// ============================================================================
// Kerberos Configuration Schema
// ============================================================================

/**
 * Service account configuration
 */
export const KerberosServiceAccountSchema = z
  .object({
    username: z.string().min(1).describe('Service account username (e.g., svc-mcp-server)'),
    password: z.string().optional().describe('Service account password (if not using keytab)'),
    keytabPath: z
      .string()
      .optional()
      .describe('Path to keytab file (for Linux, alternative to password)'),
  })
  .refine((data) => data.password || data.keytabPath, {
    message: 'Either password or keytabPath must be provided',
  });

/**
 * Ticket cache configuration
 */
export const KerberosTicketCacheSchema = z.object({
  enabled: z.boolean().optional().default(true).describe('Enable ticket caching'),
  ttlSeconds: z
    .number()
    .min(60)
    .max(86400)
    .optional()
    .default(3600)
    .describe('Ticket cache TTL in seconds (default: 1 hour)'),
  renewThresholdSeconds: z
    .number()
    .min(30)
    .max(3600)
    .optional()
    .default(300)
    .describe('Renew tickets within this many seconds before expiration (default: 5 minutes)'),
  maxEntriesPerSession: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .default(10)
    .describe('Maximum cached tickets per session'),
  sessionTimeoutMs: z
    .number()
    .min(60000)
    .max(3600000)
    .optional()
    .default(900000)
    .describe('Session timeout in milliseconds (default: 15 minutes)'),
});

/**
 * Kerberos configuration schema
 */
export const KerberosConfigSchema = z.object({
  enabled: z.boolean().optional().default(false).describe('Enable Kerberos delegation module'),
  domainController: z
    .string()
    .min(1)
    .describe(
      'Active Directory domain controller FQDN or IP (e.g., dc.company.com or 192.168.1.25)'
    ),
  servicePrincipalName: z
    .string()
    .min(1)
    .describe('Service Principal Name for MCP Server (e.g., HTTP/mcp-server.company.com)'),
  realm: z
    .string()
    .min(1)
    .toUpperCase()
    .describe('Kerberos realm (uppercase domain, e.g., COMPANY.COM)'),
  kdc: z
    .string()
    .optional()
    .describe('KDC address with port (defaults to domainController:88, e.g., dc.company.com:88)'),
  enableS4U2Self: z
    .boolean()
    .optional()
    .default(true)
    .describe('Enable Service for User to Self (protocol transition)'),
  enableS4U2Proxy: z
    .boolean()
    .optional()
    .default(true)
    .describe('Enable Service for User to Proxy (delegation to backend services)'),
  allowedDelegationTargets: z
    .array(z.string())
    .optional()
    .default([])
    .describe('Allowed SPNs for S4U2Proxy delegation (e.g., ["MSSQLSvc/sql01.company.com:1433"])'),
  serviceAccount: KerberosServiceAccountSchema.describe('Service account credentials'),
  ticketCache: KerberosTicketCacheSchema.optional().describe('Ticket cache configuration'),
});

// ============================================================================
// TypeScript Types
// ============================================================================

export type KerberosServiceAccount = z.infer<typeof KerberosServiceAccountSchema>;
export type KerberosTicketCacheConfig = z.infer<typeof KerberosTicketCacheSchema>;
export type KerberosConfig = z.infer<typeof KerberosConfigSchema>;

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate Kerberos configuration
 *
 * Ensures:
 * - Service account has either password or keytab
 * - Realm is uppercase
 * - Delegation targets are valid SPNs
 *
 * @param config - Raw configuration object
 * @returns Validated Kerberos configuration
 * @throws {z.ZodError} If validation fails
 */
export function validateKerberosConfig(config: unknown): KerberosConfig {
  return KerberosConfigSchema.parse(config);
}

/**
 * Create default Kerberos configuration
 *
 * @returns Default configuration with Kerberos disabled
 */
export function createDefaultKerberosConfig(): KerberosConfig {
  return {
    enabled: false,
    domainController: '',
    servicePrincipalName: '',
    realm: '',
    enableS4U2Self: true,
    enableS4U2Proxy: true,
    allowedDelegationTargets: [],
    serviceAccount: {
      username: '',
    },
  };
}
