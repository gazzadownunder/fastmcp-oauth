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

export type { DelegationModule, DelegationResult, DelegationModuleConfig } from './base.js';

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
// SQL Delegation Module - Moved to @mcp-oauth/sql-delegation package
// ============================================================================
// SQL delegation is now available as a separate optional package:
// npm install @mcp-oauth/sql-delegation
//
// This demonstrates the framework's modularity - SQL support is NOT required
// for the core framework to function.

// ============================================================================
// Kerberos Delegation Module - Moved to @mcp-oauth/kerberos-delegation package
// ============================================================================
// Kerberos delegation is now available as a separate optional package:
// npm install @mcp-oauth/kerberos-delegation
//
// This demonstrates the framework's modularity - Kerberos support is NOT required
// for the core framework to function.
