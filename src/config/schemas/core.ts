/**
 * Core Authentication Configuration Schema
 *
 * Defines configuration for the Core authentication layer (Phase 1).
 * This config is used by AuthenticationService, JWTValidator, RoleMapper, etc.
 *
 * @see Phase 4.1 of refactor.md
 */

import { z } from 'zod';

// ============================================================================
// Shared Base Schemas
// ============================================================================

/**
 * Role mapping configuration
 *
 * Maps JWT claim values to internal roles with fallback defaults.
 */
export const RoleMappingSchema = z
  .object({
    admin: z.array(z.string()).optional().default(['admin', 'administrator']),
    user: z.array(z.string()).optional().default(['user']),
    guest: z.array(z.string()).optional().default([]),
    defaultRole: z.enum(['admin', 'user', 'guest']).optional().default('guest'),
  })
  .passthrough(); // Allow additional custom role mappings

/**
 * Claim mappings for JWT token
 *
 * Maps JWT claim names to internal session fields.
 */
export const ClaimMappingsSchema = z.object({
  legacyUsername: z.string().min(1).describe('Claim containing legacy Windows username'),
  roles: z.string().min(1).describe('Claim containing user roles'),
  scopes: z.string().min(1).describe('Claim containing OAuth scopes'),
  userId: z.string().optional().describe('Claim containing unique user ID (defaults to "sub")'),
  username: z
    .string()
    .optional()
    .describe('Claim containing username (defaults to "preferred_username")'),
});

/**
 * Security configuration for JWT validation
 *
 * RFC 8725 compliant security settings.
 */
export const SecurityConfigSchema = z.object({
  clockTolerance: z
    .number()
    .min(0)
    .max(300)
    .describe('Maximum clock skew tolerance in seconds (max 5 minutes)'),
  maxTokenAge: z
    .number()
    .min(300)
    .max(7200)
    .describe('Maximum token age in seconds (5 minutes to 2 hours)'),
  requireNbf: z.boolean().describe('Require not-before (nbf) claim'),
});

/**
 * Identity Provider (IDP) configuration
 *
 * Configuration for a single trusted OAuth 2.1 identity provider.
 */
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
    )
    .describe('IDP issuer URL'),
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
    )
    .describe('OAuth 2.1 discovery document URL'),
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
    )
    .describe('JSON Web Key Set URI for signature verification'),
  audience: z.string().min(1).describe('Expected audience claim value'),
  algorithms: z
    .array(z.enum(['RS256', 'ES256']))
    .min(1)
    .refine((algs) => algs.includes('RS256') || algs.includes('ES256'), {
      message: 'Must include at least one secure algorithm (RS256 or ES256)',
    })
    .describe('Allowed signature algorithms (RS256, ES256 only)'),
  claimMappings: ClaimMappingsSchema,
  roleMappings: RoleMappingSchema.optional(),
  security: SecurityConfigSchema,
});

/**
 * Rate limiting configuration
 *
 * Protects against brute-force authentication attempts.
 */
export const RateLimitConfigSchema = z.object({
  maxRequests: z.number().min(1).max(10000).describe('Maximum requests per window'),
  windowMs: z
    .number()
    .min(60000)
    .max(3600000)
    .describe('Time window in milliseconds (1 minute to 1 hour)'),
});

/**
 * Audit logging configuration
 *
 * Controls audit trail logging behavior.
 */
export const AuditConfigSchema = z.object({
  enabled: z.boolean().optional().default(true).describe('Enable audit logging'),
  logAllAttempts: z.boolean().describe('Log all authentication attempts (success and failure)'),
  logFailedAttempts: z.boolean().optional().default(true).describe('Log failed attempts'),
  retentionDays: z
    .number()
    .min(1)
    .max(365)
    .describe('Audit log retention period in days'),
});

/**
 * Permission configuration
 *
 * Maps roles to their assigned permissions.
 * SECURITY: Framework does NOT provide defaults - users MUST explicitly configure permissions.
 * SECURITY (SEC-2): Rejects 'unassigned' in customPermissions to prevent config errors.
 */
export const PermissionConfigSchema = z.object({
  adminPermissions: z
    .array(z.string())
    .min(0)
    .describe('Permissions granted to admin role'),
  userPermissions: z
    .array(z.string())
    .min(0)
    .describe('Permissions granted to user role'),
  guestPermissions: z
    .array(z.string())
    .min(0)
    .describe('Permissions granted to guest role'),
  customPermissions: z
    .record(z.array(z.string()))
    .optional()
    .default({})
    .refine(
      (customPerms) => {
        // SECURITY (SEC-2): Prevent 'unassigned' in custom permissions
        // UNASSIGNED_ROLE is a reserved role that must ALWAYS have empty permissions
        // Allowing it in customPermissions could cause runtime assertion failures
        return !Object.keys(customPerms || {}).includes('unassigned');
      },
      {
        message: 'customPermissions must not include "unassigned" key - this is a reserved role with no permissions'
      }
    )
    .describe('Custom role to permissions mapping'),
});

// ============================================================================
// Core Authentication Configuration
// ============================================================================

/**
 * Core authentication configuration schema
 *
 * This is the configuration for the Core layer (Phase 1).
 * Used by AuthenticationService, JWTValidator, RoleMapper, SessionManager, etc.
 */
export const CoreAuthConfigSchema = z.object({
  trustedIDPs: z
    .array(IDPConfigSchema)
    .min(1)
    .describe('List of trusted identity providers'),
  rateLimiting: RateLimitConfigSchema.optional().describe('Rate limiting settings'),
  audit: AuditConfigSchema.optional().describe('Audit logging settings'),
  permissions: PermissionConfigSchema.describe('Role to permission mappings (REQUIRED - no framework defaults)'),
});

// ============================================================================
// TypeScript Types
// ============================================================================

export type RoleMapping = z.infer<typeof RoleMappingSchema>;
export type ClaimMappings = z.infer<typeof ClaimMappingsSchema>;
export type SecurityConfig = z.infer<typeof SecurityConfigSchema>;
export type IDPConfig = z.infer<typeof IDPConfigSchema>;
export type RateLimitConfig = z.infer<typeof RateLimitConfigSchema>;
export type AuditConfig = z.infer<typeof AuditConfigSchema>;
export type PermissionConfig = z.infer<typeof PermissionConfigSchema>;
export type CoreAuthConfig = z.infer<typeof CoreAuthConfigSchema>;
