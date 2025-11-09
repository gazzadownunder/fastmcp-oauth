/**
 * Audit Service - Centralized Logging with Null Object Pattern
 *
 * This service provides write-only audit logging with overflow handling.
 * It follows the Null Object Pattern - works without configuration.
 *
 * MANDATORY (GAP #7): Supports onOverflow callback for audit trail integrity
 *
 * @see Phase 1.3 of refactor.md
 */

import { AuditEntry } from './types.js';

// ============================================================================
// Interfaces
// ============================================================================

/**
 * Configuration for the Audit Service
 */
export interface AuditServiceConfig {
  /** Whether audit logging is enabled (default: false) */
  enabled?: boolean;

  /** Whether to log all attempts, not just failures (default: true) */
  logAllAttempts?: boolean;

  /** Retention period in days (informational only for in-memory storage) */
  retentionDays?: number;

  /** Custom storage implementation (default: InMemoryAuditStorage) */
  storage?: AuditStorage;

  /** MANDATORY (GAP #7): Callback invoked when storage reaches capacity */
  onOverflow?: (entries: AuditEntry[]) => void;
}

/**
 * Storage interface for audit entries
 *
 * CRITICAL: This is a WRITE-ONLY API. No query methods to prevent O(n)
 * performance issues. Querying must be backed by indexed persistence.
 */
export interface AuditStorage {
  /**
   * Log a single audit entry
   *
   * @param entry - The audit entry to log
   */
  log(entry: AuditEntry): Promise<void> | void;
}

// ============================================================================
// In-Memory Storage Implementation
// ============================================================================

/**
 * Default in-memory audit storage with overflow handling
 *
 * MANDATORY (GAP #7): Calls onOverflow callback before discarding entries
 */
class InMemoryAuditStorage implements AuditStorage {
  private entries: AuditEntry[] = [];
  private readonly maxEntries: number;
  private onOverflow?: (entries: AuditEntry[]) => void;

  constructor(maxEntries: number = 10000, onOverflow?: (entries: AuditEntry[]) => void) {
    this.maxEntries = maxEntries;
    this.onOverflow = onOverflow;
  }

  log(entry: AuditEntry): void {
    this.entries.push(entry);

    // MANDATORY (GAP #7): Check for overflow
    if (this.entries.length > this.maxEntries) {
      // Call onOverflow with ALL entries before discarding
      if (this.onOverflow) {
        this.onOverflow([...this.entries]); // Pass copy to prevent mutation
      }

      // Remove oldest entry
      this.entries.shift();
    }
  }

  /**
   * Get all entries (for testing only - not exposed via AuditService)
   * @internal
   */
  getEntries(): AuditEntry[] {
    return [...this.entries];
  }

  /**
   * Clear all entries (for testing only)
   * @internal
   */
  clear(): void {
    this.entries = [];
  }
}

// ============================================================================
// Audit Service (Null Object Pattern)
// ============================================================================

/**
 * Centralized audit logging service
 *
 * Features:
 * - Null Object Pattern: Works without configuration (no crashes)
 * - Write-only API: No query methods (prevents O(n) performance issues)
 * - Overflow handling: Callbacks for audit trail integrity
 * - Optional persistence: Custom storage implementations supported
 *
 * Usage:
 * ```typescript
 * // Disabled by default (Null Object Pattern)
 * const audit = new AuditService();
 * await audit.log({ ... }); // No-op
 *
 * // Enabled with overflow callback
 * const audit = new AuditService({
 *   enabled: true,
 *   onOverflow: (entries) => {
 *     // Flush to external storage
 *     await externalStorage.bulkInsert(entries);
 *   }
 * });
 * ```
 */
export class AuditService {
  private enabled: boolean;
  private storage: AuditStorage;

  /**
   * Creates a new AuditService
   *
   * @param config - Optional configuration (defaults to disabled)
   */
  constructor(config?: AuditServiceConfig) {
    this.enabled = config?.enabled ?? false;

    // Initialize storage
    if (config?.storage) {
      this.storage = config.storage;
    } else {
      // Default in-memory storage with overflow callback
      this.storage = new InMemoryAuditStorage(
        10000, // Max 10k entries
        config?.onOverflow
      );
    }
  }

  /**
   * Log an audit entry
   *
   * CRITICAL: All audit entries MUST include a source field (GAP #3)
   *
   * @param entry - The audit entry to log
   */
  async log(entry: AuditEntry): Promise<void> {
    // Null Object Pattern: No-op if disabled
    if (!this.enabled) {
      return;
    }

    // Validate source field (MANDATORY GAP #3)
    if (!entry.source) {
      throw new Error(
        'CRITICAL: AuditEntry missing required field: source. ' +
          'All audit entries must include a source field for audit trail integrity.'
      );
    }

    // Validate timestamp
    if (!entry.timestamp) {
      entry.timestamp = new Date();
    }

    // Log to storage
    await this.storage.log(entry);
  }

  /**
   * Check if audit logging is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get internal storage (for testing only)
   * @internal
   */
  _getStorage(): AuditStorage {
    return this.storage;
  }
}

// ============================================================================
// Exports
// ============================================================================

export { InMemoryAuditStorage };
