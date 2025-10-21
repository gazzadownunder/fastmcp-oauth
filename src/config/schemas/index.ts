/**
 * Unified Configuration Schema
 *
 * Combines all layer configurations (Core, Delegation, MCP) into a single
 * unified configuration schema for the entire application.
 *
 * @see Phase 4.1 of refactor.md
 */

import { z } from 'zod';
import { CoreAuthConfigSchema, type CoreAuthConfig } from './core.js';
import { DelegationConfigSchema, type DelegationConfig } from './delegation.js';
import { MCPConfigSchema, type MCPConfig } from './mcp.js';

// ============================================================================
// Re-exports from Layer Schemas
// ============================================================================

// Core layer exports
export {
  RoleMappingSchema,
  ClaimMappingsSchema,
  SecurityConfigSchema,
  IDPConfigSchema,
  RateLimitConfigSchema,
  AuditConfigSchema,
  CoreAuthConfigSchema,
  type RoleMapping,
  type ClaimMappings,
  type SecurityConfig,
  type IDPConfig,
  type RateLimitConfig,
  type AuditConfig,
  type CoreAuthConfig,
} from './core.js';

// Delegation layer exports
export {
  SQLConfigSchema,
  KerberosConfigSchema,
  DelegationConfigSchema,
  type SQLConfig,
  type KerberosConfig,
  type DelegationConfig,
} from './delegation.js';

// MCP layer exports
export {
  OAuthMetadataSchema,
  ToolEnablementSchema,
  MCPConfigSchema,
  type OAuthMetadata,
  type ToolEnablement,
  type MCPConfig,
} from './mcp.js';

// ============================================================================
// Unified Configuration Schema
// ============================================================================

/**
 * Unified configuration schema
 *
 * Combines Core, Delegation, and MCP layer configurations.
 *
 * Structure:
 * - `auth`: Core authentication configuration (REQUIRED)
 * - `delegation`: Delegation module configuration (OPTIONAL)
 * - `mcp`: MCP server configuration (OPTIONAL)
 *
 * @example
 * ```json
 * {
 *   "auth": {
 *     "trustedIDPs": [...],
 *     "rateLimiting": {...},
 *     "audit": {...}
 *   },
 *   "delegation": {
 *     "sql": {...},
 *     "kerberos": {...}
 *   },
 *   "mcp": {
 *     "serverName": "mcp-oauth-server",
 *     "transport": "http-stream",
 *     "port": 3000
 *   }
 * }
 * ```
 */
export const UnifiedConfigSchema = z.object({
  auth: CoreAuthConfigSchema.describe('Core authentication configuration (REQUIRED)'),
  delegation: DelegationConfigSchema.optional().describe('Delegation module configuration'),
  mcp: MCPConfigSchema.optional().describe('MCP server configuration'),
});

/**
 * Unified configuration type
 */
export type UnifiedConfig = z.infer<typeof UnifiedConfigSchema>;

/**
 * Partial unified config for backward compatibility
 *
 * Allows loading configs that only have Core layer configuration.
 */
export const PartialUnifiedConfigSchema = z.object({
  auth: CoreAuthConfigSchema,
  delegation: DelegationConfigSchema.optional(),
  mcp: MCPConfigSchema.optional(),
});

/**
 * Legacy configuration schema (for migration)
 *
 * This is the old flat configuration structure that needs to be migrated
 * to the new unified structure.
 */
export const LegacyConfigSchema = z.object({
  trustedIDPs: z.array(z.any()).min(1),
  rateLimiting: z.any().optional(),
  audit: z.any().optional(),
  permissions: z.any().optional(), // Permissions may exist in legacy format
  sql: z.any().optional(),
  kerberos: z.any().optional(),
});

export type LegacyConfig = z.infer<typeof LegacyConfigSchema>;

// ============================================================================
// Config Type Guards
// ============================================================================

/**
 * Check if config is legacy format
 *
 * Legacy config has trustedIDPs at top level.
 * New config has trustedIDPs under auth.trustedIDPs.
 */
export function isLegacyConfig(config: unknown): config is LegacyConfig {
  if (typeof config !== 'object' || config === null) {
    return false;
  }

  const obj = config as Record<string, unknown>;

  // Legacy config has trustedIDPs at top level
  // New config has trustedIDPs under auth.trustedIDPs
  return 'trustedIDPs' in obj && !('auth' in obj);
}

/**
 * Check if config is unified format
 */
export function isUnifiedConfig(config: unknown): config is UnifiedConfig {
  if (typeof config !== 'object' || config === null) {
    return false;
  }

  const obj = config as Record<string, unknown>;

  // Unified config has auth at top level
  return 'auth' in obj;
}

// ============================================================================
// Default Configurations
// ============================================================================

/**
 * Default Core authentication configuration
 *
 * Minimal configuration for development/testing.
 */
export const DEFAULT_CORE_AUTH_CONFIG: Partial<CoreAuthConfig> = {
  rateLimiting: {
    maxRequests: 100,
    windowMs: 900000, // 15 minutes
  },
  audit: {
    enabled: true,
    logAllAttempts: true,
    logFailedAttempts: true,
    retentionDays: 90,
  },
};

/**
 * Default MCP configuration
 *
 * Minimal configuration for development/testing.
 */
export const DEFAULT_MCP_CONFIG: MCPConfig = {
  serverName: 'mcp-oauth-server',
  version: '1.0.0',
  transport: 'http-stream',
  port: 3000,
  enabledTools: {
    'sql-delegate': true,
    'health-check': true,
    'user-info': true,
    'audit-log': false,
    'kerberos-list-directory': false,
    'kerberos-read-file': false,
    'kerberos-file-info': false,
    'sql-read': false,
    'sql-write': false,
    'sql-schema': false,
    'sql-table-details': false,
    'oauth-metadata': false,
  },
};
