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
// Token Exchange Configuration (RFC 8693)
// ============================================================================

/**
 * Token exchange configuration for OAuth 2.0 Token Exchange (RFC 8693)
 *
 * Used by delegation modules for on-behalf-of (OBO) token exchange.
 * Each delegation module can have its own token exchange configuration.
 *
 * Per-Module Design:
 * - Each module specifies which IDP to use for TE-JWT validation
 * - Allows different modules to use different IDPs/audiences
 * - Example: PostgreSQL uses IDP1, MSSQL uses IDP2
 */
export const TokenExchangeConfigSchema = z.object({
  idpName: z
    .string()
    .min(1)
    .describe('IDP name from auth.trustedIDPs to use for TE-JWT validation'),
  tokenEndpoint: z
    .string()
    .url()
    .refine((url) => {
      // Allow HTTP for development/testing environments
      const isDev = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
      return isDev || url.startsWith('https://');
    }, {
      message: 'Token endpoint must use HTTPS (HTTP allowed in development/test)',
    })
    .describe('IDP token endpoint URL (HTTPS required in production)'),
  clientId: z.string().min(1).describe('Client ID for token exchange'),
  clientSecret: z.string().min(1).describe('Client secret for token exchange'),
  audience: z.string().optional().describe('Expected audience for delegation tokens'),
  resource: z.string().optional().describe('Resource identifier'),
  scope: z
    .string()
    .optional()
    .describe('Space-separated list of OAuth scopes (RFC 8693). Examples: "openid profile", "sql:read sql:write"'),
  requiredClaim: z
    .string()
    .optional()
    .describe('Required claim in TE-JWT (e.g., legacy_name, sql_user)'),
  cache: z
    .object({
      enabled: z.boolean().optional().default(false).describe('Enable token caching'),
      ttlSeconds: z.number().int().min(1).optional().default(60).describe('Cache TTL in seconds'),
      sessionTimeoutMs: z
        .number()
        .int()
        .min(1000)
        .optional()
        .default(900000)
        .describe('Session timeout in milliseconds'),
      maxEntriesPerSession: z
        .number()
        .int()
        .min(1)
        .optional()
        .default(10)
        .describe('Max cache entries per session'),
      maxTotalEntries: z
        .number()
        .int()
        .min(1)
        .optional()
        .default(1000)
        .describe('Max total cache entries'),
    })
    .optional()
    .describe('Token caching configuration (Phase 2)'),
});

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
// PostgreSQL Delegation Configuration
// ============================================================================

/**
 * PostgreSQL delegation configuration
 *
 * Used by PostgreSQLDelegationModule for SET ROLE delegation.
 */
export const PostgreSQLConfigSchema = z.object({
  host: z.string().min(1).describe('PostgreSQL hostname or IP'),
  port: z.number().int().min(1).max(65535).optional().default(5432).describe('PostgreSQL port'),
  database: z.string().min(1).describe('Database name'),
  user: z.string().min(1).describe('Service account username'),
  password: z.string().min(1).describe('Service account password'),
  options: z
    .object({
      ssl: z.boolean().optional().default(false).describe('Enable SSL/TLS connection'),
    })
    .passthrough()
    .optional()
    .describe('PostgreSQL connection options'),
  pool: z
    .object({
      max: z.number().int().min(1).optional().default(10).describe('Maximum pool connections'),
      min: z.number().int().min(0).optional().default(0).describe('Minimum pool connections'),
      idleTimeoutMillis: z
        .number()
        .int()
        .min(1000)
        .optional()
        .default(30000)
        .describe('Idle timeout in milliseconds'),
      connectionTimeoutMillis: z
        .number()
        .int()
        .min(1000)
        .optional()
        .default(5000)
        .describe('Connection timeout in milliseconds'),
    })
    .optional()
    .describe('Connection pool settings'),
  tokenExchange: TokenExchangeConfigSchema.optional().describe(
    'Per-module token exchange configuration (performs exchange during delegation)'
  ),
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
  tokenExchange: TokenExchangeConfigSchema.optional().describe(
    'DEPRECATED: Global token exchange configuration (use per-module tokenExchange instead)'
  ),
  sql: SQLConfigSchema.optional().describe('SQL delegation module configuration'),
  kerberos: KerberosConfigSchema.optional().describe('Kerberos delegation module configuration'),
});

// ============================================================================
// TypeScript Types
// ============================================================================

export type TokenExchangeConfig = z.infer<typeof TokenExchangeConfigSchema>;
export type SQLConfig = z.infer<typeof SQLConfigSchema>;
export type PostgreSQLConfig = z.infer<typeof PostgreSQLConfigSchema>;
export type KerberosConfig = z.infer<typeof KerberosConfigSchema>;
export type DelegationConfig = z.infer<typeof DelegationConfigSchema>;
