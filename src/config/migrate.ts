/**
 * Configuration Migration Utility
 *
 * Migrates old flat configuration format to new unified configuration format.
 *
 * Old format:
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
 * New format:
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
 * @see Phase 4.3 of refactor.md
 */

import type { LegacyConfig, UnifiedConfig, CoreAuthConfig, DelegationConfig, MCPConfig } from './schemas/index.js';
import { UnifiedConfigSchema, DEFAULT_MCP_CONFIG } from './schemas/index.js';

// ============================================================================
// Migration Functions
// ============================================================================

/**
 * Migrate old flat configuration to unified configuration
 *
 * @param oldConfig - Legacy flat configuration
 * @returns Migrated unified configuration
 * @throws {Error} If migration fails or result is invalid
 *
 * @example
 * ```typescript
 * const oldConfig = {
 *   trustedIDPs: [...],
 *   rateLimiting: {...},
 *   sql: {...}
 * };
 *
 * const newConfig = migrateConfig(oldConfig);
 * // {
 * //   auth: { trustedIDPs: [...], rateLimiting: {...} },
 * //   delegation: { sql: {...} },
 * //   mcp: { ... defaults ... }
 * // }
 * ```
 */
export function migrateConfig(oldConfig: LegacyConfig): UnifiedConfig {
  try {
    // Build auth configuration from old top-level fields
    const authConfig: CoreAuthConfig = {
      trustedIDPs: oldConfig.trustedIDPs,
      rateLimiting: oldConfig.rateLimiting,
      audit: oldConfig.audit,
    };

    // Build delegation configuration if delegation modules exist
    let delegationConfig: DelegationConfig | undefined;
    if (oldConfig.sql || oldConfig.kerberos) {
      delegationConfig = {
        modules: {
          ...(oldConfig.sql && { sql: oldConfig.sql }),
          ...(oldConfig.kerberos && { kerberos: oldConfig.kerberos }),
        },
      };
    }

    // Build unified configuration
    const unifiedConfig: UnifiedConfig = {
      auth: authConfig,
      delegation: delegationConfig,
      mcp: DEFAULT_MCP_CONFIG,
    };

    // Validate the migrated configuration
    const validated = UnifiedConfigSchema.parse(unifiedConfig);

    return validated;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Configuration migration failed: ${error.message}`);
    }
    throw new Error('Configuration migration failed: Unknown error');
  }
}

/**
 * Migrate configuration file in-place
 *
 * Reads old config, migrates it, and returns the new format.
 * Does NOT write to disk - caller must save the result.
 *
 * @param configData - Raw config data (parsed JSON)
 * @returns Migrated unified configuration
 *
 * @example
 * ```typescript
 * const oldData = JSON.parse(fs.readFileSync('config.json', 'utf-8'));
 * const newData = migrateConfigData(oldData);
 * fs.writeFileSync('config-new.json', JSON.stringify(newData, null, 2));
 * ```
 */
export function migrateConfigData(configData: unknown): UnifiedConfig {
  // Validate input is an object
  if (typeof configData !== 'object' || configData === null) {
    throw new Error('Configuration must be an object');
  }

  const config = configData as Record<string, unknown>;

  // Check if already in new format
  if ('auth' in config) {
    // Already migrated, just validate
    return UnifiedConfigSchema.parse(config);
  }

  // Check if in old format
  if ('trustedIDPs' in config) {
    // Migrate from old format
    return migrateConfig(config as LegacyConfig);
  }

  throw new Error('Unrecognized configuration format');
}

/**
 * Create migration report
 *
 * Analyzes configuration and reports what changes would be made.
 *
 * @param oldConfig - Legacy configuration
 * @returns Migration report
 */
export interface MigrationReport {
  needsMigration: boolean;
  changes: string[];
  warnings: string[];
}

export function analyzeMigration(config: unknown): MigrationReport {
  if (typeof config !== 'object' || config === null) {
    return {
      needsMigration: false,
      changes: [],
      warnings: ['Configuration is not an object'],
    };
  }

  const obj = config as Record<string, unknown>;

  // Already in new format
  if ('auth' in obj) {
    return {
      needsMigration: false,
      changes: [],
      warnings: [],
    };
  }

  // Old format - needs migration
  if ('trustedIDPs' in obj) {
    const changes: string[] = [];
    const warnings: string[] = [];

    changes.push('Move trustedIDPs to auth.trustedIDPs');

    if ('rateLimiting' in obj) {
      changes.push('Move rateLimiting to auth.rateLimiting');
    }

    if ('audit' in obj) {
      changes.push('Move audit to auth.audit');
    }

    if ('sql' in obj) {
      changes.push('Move sql to delegation.sql');
    }

    if ('kerberos' in obj) {
      changes.push('Move kerberos to delegation.kerberos');
    }

    changes.push('Add default MCP configuration');

    return {
      needsMigration: true,
      changes,
      warnings,
    };
  }

  return {
    needsMigration: false,
    changes: [],
    warnings: ['Unrecognized configuration format'],
  };
}

/**
 * Migration helper for partial configs
 *
 * Migrates configs that may not have all layers.
 *
 * @param oldConfig - Partial legacy configuration
 * @returns Migrated configuration with defaults for missing layers
 */
export function migratePartialConfig(oldConfig: Partial<LegacyConfig>): UnifiedConfig {
  // Must have at least trustedIDPs
  if (!oldConfig.trustedIDPs || oldConfig.trustedIDPs.length === 0) {
    throw new Error('Configuration must have at least one trusted IDP');
  }

  // Build full legacy config with defaults
  const fullLegacyConfig: LegacyConfig = {
    trustedIDPs: oldConfig.trustedIDPs,
    rateLimiting: oldConfig.rateLimiting,
    audit: oldConfig.audit,
    sql: oldConfig.sql,
    kerberos: oldConfig.kerberos,
  };

  return migrateConfig(fullLegacyConfig);
}
