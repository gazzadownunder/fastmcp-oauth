/**
 * Delegation Module Configuration Schema
 *
 * Defines configuration for the Delegation layer (Phase 2).
 * This config is used by DelegationRegistry and delegation modules (SQL, Kerberos, etc.).
 *
 * @see Phase 4.1 of refactor.md
 */

import { z } from 'zod';

// ============================================================================
// SQL Delegation Configuration
// ============================================================================

/**
 * SQL Server connection configuration
 *
 * Used by SQLDelegationModule for EXECUTE AS USER delegation.
 */
export const SQLConfigSchema = z.object({
  server: z.string().min(1).describe('SQL Server hostname or IP'),
  database: z.string().min(1).describe('Database name'),
  options: z
    .object({
      trustedConnection: z
        .boolean()
        .optional()
        .default(true)
        .describe('Use Windows integrated authentication'),
      encrypt: z.boolean().optional().default(true).describe('Encrypt connection (TLS)'),
      enableArithAbort: z.boolean().optional().default(true).describe('Enable ARITHABORT'),
      trustServerCertificate: z
        .boolean()
        .optional()
        .default(false)
        .describe('Trust server certificate (dev only)'),
    })
    .passthrough()
    .describe('SQL Server connection options'),
});

// ============================================================================
// Kerberos Delegation Configuration
// ============================================================================

/**
 * Kerberos constrained delegation configuration
 *
 * Used by KerberosDelegationModule for S4U2Self/S4U2Proxy delegation.
 */
export const KerberosConfigSchema = z.object({
  serviceAccount: z
    .string()
    .min(1)
    .describe('Service account for Kerberos delegation (e.g., svc_mcp_oauth)'),
  keytabPath: z
    .string()
    .min(1)
    .describe('Path to service account keytab file'),
  realm: z.string().min(1).describe('Kerberos realm (e.g., COMPANY.COM)'),
  kdc: z.string().min(1).describe('Key Distribution Center (KDC) hostname'),
  allowedSpns: z
    .array(z.string())
    .optional()
    .describe('Allowed Service Principal Names for delegation'),
});

// ============================================================================
// Delegation Module Registry Configuration
// ============================================================================

/**
 * Delegation configuration schema
 *
 * This is the configuration for the Delegation layer (Phase 2).
 * Used by DelegationRegistry to configure delegation modules.
 */
export const DelegationConfigSchema = z.object({
  modules: z
    .record(z.any())
    .optional()
    .describe('Delegation module configurations keyed by module name'),
  sql: SQLConfigSchema.optional().describe('SQL delegation module configuration'),
  kerberos: KerberosConfigSchema.optional().describe('Kerberos delegation module configuration'),
});

// ============================================================================
// TypeScript Types
// ============================================================================

export type SQLConfig = z.infer<typeof SQLConfigSchema>;
export type KerberosConfig = z.infer<typeof KerberosConfigSchema>;
export type DelegationConfig = z.infer<typeof DelegationConfigSchema>;
