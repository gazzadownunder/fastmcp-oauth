/**
 * Configuration Module - Public API
 *
 * Exports configuration management, schemas, and migration utilities.
 *
 * @see Phase 4.4 of refactor.md
 */

// ============================================================================
// Configuration Manager
// ============================================================================

export { ConfigManager, configManager } from './manager.js';

// ============================================================================
// Unified Schemas (New Modular Format)
// ============================================================================

export {
  // Layer Schemas
  CoreAuthConfigSchema,
  DelegationConfigSchema,
  MCPConfigSchema,

  // Unified Schema
  UnifiedConfigSchema,
  PartialUnifiedConfigSchema,

  // Component Schemas
  RoleMappingSchema,
  ClaimMappingsSchema,
  SecurityConfigSchema,
  IDPConfigSchema,
  RateLimitConfigSchema,
  AuditConfigSchema,
  SQLConfigSchema,
  KerberosConfigSchema,
  OAuthMetadataSchema,
  ToolEnablementSchema,

  // Type Guards
  isLegacyConfig,
  isUnifiedConfig,

  // Defaults
  DEFAULT_CORE_AUTH_CONFIG,
  DEFAULT_MCP_CONFIG,

  // Types
  type UnifiedConfig,
  type CoreAuthConfig,
  type DelegationConfig,
  type MCPConfig,
  type RoleMapping,
  type ClaimMappings,
  type SecurityConfig,
  type IDPConfig,
  type RateLimitConfig,
  type AuditConfig,
  type SQLConfig,
  type KerberosConfig,
  type OAuthMetadata,
  type ToolEnablement,
  type LegacyConfig,
} from './schemas/index.js';

// ============================================================================
// Migration Utilities
// ============================================================================

export {
  migrateConfig,
  migrateConfigData,
  analyzeMigration,
  migratePartialConfig,
  type MigrationReport,
} from './migrate.js';

// ============================================================================
// Legacy Exports (Backward Compatibility)
// ============================================================================

/**
 * @deprecated Use UnifiedConfigSchema instead
 */
export { OAuthOBOConfigSchema, type OAuthOBOConfig } from './schema.js';

/**
 * @deprecated Environment schema moved to schemas/index.ts
 */
export { EnvironmentSchema, type Environment } from './schema.js';

// ============================================================================
// IMPORTANT: Migration Notice
// ============================================================================

/**
 * MIGRATION GUIDE:
 *
 * The configuration format has been updated to support modular architecture.
 *
 * OLD FORMAT (Flat):
 * ```json
 * {
 *   "trustedIDPs": [...],
 *   "rateLimiting": {...},
 *   "audit": {...},
 *   "sql": {...},
 *   "kerberos": {...}
 * }
 * ```
 *
 * NEW FORMAT (Layered):
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
 *     "serverName": "...",
 *     "transport": "...",
 *     "port": ...
 *   }
 * }
 * ```
 *
 * AUTOMATIC MIGRATION:
 * ConfigManager automatically detects and migrates legacy configs.
 *
 * MANUAL MIGRATION:
 * ```typescript
 * import { migrateConfig } from './config/index.js';
 * const newConfig = migrateConfig(oldConfig);
 * ```
 */
