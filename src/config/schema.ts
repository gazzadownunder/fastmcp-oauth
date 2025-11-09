import { z } from 'zod';

// Role mapping configuration for flexible role determination
// Allows custom role keys (e.g., "write", "read", "auditor") in addition to standard roles
export const RoleMappingSchema = z
  .object({
    admin: z.array(z.string()).optional().default(['admin', 'administrator']),
    user: z.array(z.string()).optional().default(['user']),
    guest: z.array(z.string()).optional().default([]),
    defaultRole: z.enum(['admin', 'user', 'guest']).optional().default('guest'),
  })
  .passthrough(); // Allow additional custom role mappings

// Zod schemas for configuration validation
export const ClaimMappingsSchema = z.object({
  legacyUsername: z.string().min(1),
  roles: z.string().min(1),
  scopes: z.string().min(1),
  userId: z.string().optional(),
  username: z.string().optional(),
});

export const SecurityConfigSchema = z.object({
  clockTolerance: z.number().min(0).max(300), // Max 5 minutes tolerance
  maxTokenAge: z.number().min(300).max(7200), // 5 minutes to 2 hours
  requireNbf: z.boolean(),
});

export const IDPConfigSchema = z.object({
  issuer: z
    .string()
    .url()
    .refine(
      (url) => {
        // Allow HTTP for development/testing environments
        const isDev = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
        return isDev || url.startsWith('https://');
      },
      {
        message: 'Issuer must use HTTPS (HTTP allowed in development/test)',
      }
    ),
  discoveryUrl: z
    .string()
    .url()
    .refine(
      (url) => {
        const isDev = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
        return isDev || url.startsWith('https://');
      },
      {
        message: 'Discovery URL must use HTTPS (HTTP allowed in development/test)',
      }
    ),
  jwksUri: z
    .string()
    .url()
    .refine(
      (url) => {
        const isDev = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
        return isDev || url.startsWith('https://');
      },
      {
        message: 'JWKS URI must use HTTPS (HTTP allowed in development/test)',
      }
    ),
  audience: z.string().min(1),
  algorithms: z
    .array(z.enum(['RS256', 'ES256']))
    .min(1)
    .refine((algs) => algs.includes('RS256') || algs.includes('ES256'), {
      message: 'Must include at least one secure algorithm (RS256 or ES256)',
    }),
  claimMappings: ClaimMappingsSchema,
  roleMappings: RoleMappingSchema.optional(),
  security: SecurityConfigSchema,
});

export const RateLimitConfigSchema = z.object({
  maxRequests: z.number().min(1).max(10000),
  windowMs: z.number().min(60000).max(3600000), // 1 minute to 1 hour
});

export const AuditConfigSchema = z.object({
  logAllAttempts: z.boolean(),
  logFailedAttempts: z.boolean(),
  retentionDays: z.number().min(1).max(365),
});

export const KerberosConfigSchema = z.object({
  serviceAccount: z.string().min(1),
  keytabPath: z.string().min(1),
  realm: z.string().min(1),
  kdc: z.string().min(1),
});

export const SQLConfigSchema = z.object({
  server: z.string().min(1),
  database: z.string().min(1),
  options: z
    .object({
      trustedConnection: z.boolean(),
      enableArithAbort: z.boolean(),
    })
    .passthrough(),
});

export const OAuthOBOConfigSchema = z.object({
  trustedIDPs: z.array(IDPConfigSchema).min(1),
  rateLimiting: RateLimitConfigSchema,
  audit: AuditConfigSchema,
  kerberos: KerberosConfigSchema.optional(),
  sql: SQLConfigSchema.optional(),
});

// Environment variable validation
export const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  SERVER_PORT: z.string().regex(/^\d+$/).transform(Number).default('3000'),
  CONFIG_PATH: z.string().optional(),
  SECRETS_PATH: z.string().optional(),
});

export type OAuthOBOConfig = z.infer<typeof OAuthOBOConfigSchema>;
export type Environment = z.infer<typeof EnvironmentSchema>;
