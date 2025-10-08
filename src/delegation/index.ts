/**
 * Delegation Module Public API
 *
 * This is the public API for the Delegation layer.
 * Follows one-way dependency: Core → Delegation → MCP
 *
 * Delegation CAN import from Core, but NOT from MCP
 *
 * @see Phase 2.4 of refactor.md
 */

// ============================================================================
// Base Types and Interfaces
// ============================================================================

export type {
  DelegationModule,
  DelegationResult,
  DelegationModuleConfig,
} from './base.js';

// ============================================================================
// Token Exchange (RFC 8693)
// ============================================================================

export { TokenExchangeService } from './token-exchange.js';
export { EncryptedTokenCache } from './encrypted-token-cache.js';
export type {
  TokenExchangeParams,
  TokenExchangeResult,
  TokenExchangeConfig,
  DelegationTokenClaims,
} from './types.js';
export type { CacheConfig, CacheMetrics } from './encrypted-token-cache.js';

// ============================================================================
// Delegation Registry
// ============================================================================

export { DelegationRegistry } from './registry.js';

// ============================================================================
// SQL Delegation Module
// ============================================================================

export { SQLDelegationModule } from './sql/sql-module.js';
export type { SQLConfig } from './sql/sql-module.js';

// ============================================================================
// Kerberos Delegation Module (Placeholder)
// ============================================================================

export { KerberosDelegationModule } from "./kerberos/kerberos-module.js";
export type { KerberosConfig, KerberosAction, KerberosParams } from "./kerberos/types.js";
