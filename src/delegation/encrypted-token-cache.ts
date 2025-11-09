/**
 * Encrypted Token Cache
 *
 * Provides secure session-scoped caching of delegation tokens (TE-JWT) with:
 * - AES-256-GCM encryption with requestor JWT hash as Additional Authenticated Data (AAD)
 * - Automatic invalidation on requestor JWT change (token refresh)
 * - Session-specific encryption keys with secure destruction
 * - TTL synchronization with delegation token expiry
 * - Heartbeat-based session cleanup
 *
 * Security Properties:
 * - Impersonation resistant: Different requestor JWT fails decryption (AAD mismatch)
 * - Replay resistant: Stolen ciphertext useless without exact JWT
 * - Memory safe: Encryption keys zeroed on session cleanup (perfect forward secrecy)
 * - Token binding: Cached token cryptographically bound to requestor JWT
 *
 * Architecture: Core → Delegation → MCP
 * Delegation layer CAN import from Core, but NOT from MCP
 *
 * @see Phase 2 of unified-oauth-progress.md
 */

import crypto from 'crypto';
import type { AuditEntry } from '../core/index.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Cache configuration
 */
export interface CacheConfig {
  /** Enable caching (default: false - opt-in design) */
  enabled?: boolean;

  /** Cache TTL in seconds (default: 60) */
  ttlSeconds?: number;

  /** Session timeout in milliseconds (default: 900000 = 15 min) */
  sessionTimeoutMs?: number;

  /** Max cache entries per session (default: 10) */
  maxEntriesPerSession?: number;

  /** Max total cache entries across all sessions (default: 1000) */
  maxTotalEntries?: number;
}

/**
 * Encrypted cache entry
 */
interface CacheEntry {
  /** Encrypted delegation token (ciphertext) */
  encryptedToken: Buffer;

  /** Initialization vector for AES-GCM */
  iv: Buffer;

  /** Authentication tag from AES-GCM */
  authTag: Buffer;

  /** Hash of requestor JWT (used as AAD) */
  jwtHash: string;

  /** Expiry timestamp (Unix milliseconds) */
  expiresAt: number;

  /** When this entry was created */
  createdAt: number;
}

/**
 * Session metadata
 */
interface SessionMetadata {
  /** Session-specific encryption key (256-bit) */
  encryptionKey: Buffer;

  /** Subject from requestor JWT (for ownership validation) */
  jwtSubject: string;

  /** Last activity timestamp (for heartbeat tracking) */
  lastActive: number;

  /** Cache entries for this session */
  entries: Map<string, CacheEntry>;
}

/**
 * Cache metrics
 */
export interface CacheMetrics {
  /** Total cache hits */
  hits: number;

  /** Total cache misses */
  misses: number;

  /** Decryption failures (AAD mismatch, corrupted data) */
  decryptionFailures: number;

  /** Active sessions */
  activeSessions: number;

  /** Total entries across all sessions */
  totalEntries: number;

  /** Memory usage estimate (bytes) */
  memoryUsageBytes: number;
}

// ============================================================================
// Encrypted Token Cache
// ============================================================================

/**
 * EncryptedTokenCache - Session-scoped encrypted cache for delegation tokens
 *
 * Provides secure caching with automatic invalidation on requestor JWT change.
 *
 * Usage:
 * ```typescript
 * const cache = new EncryptedTokenCache(config, auditService);
 *
 * // Activate session with requestor JWT
 * const sessionId = cache.activateSession(requestorJWT, jwtSubject);
 *
 * // Check cache before token exchange
 * const cached = cache.get(sessionId, cacheKey, requestorJWT);
 * if (cached) {
 *   return cached; // Cache hit
 * }
 *
 * // Perform token exchange...
 * const delegationToken = await exchangeToken();
 *
 * // Store in cache
 * cache.set(sessionId, cacheKey, delegationToken, requestorJWT, expiresAt);
 *
 * // Heartbeat to keep session alive
 * cache.heartbeat(sessionId);
 *
 * // Clear session on logout
 * cache.clearSession(sessionId);
 * ```
 */
export class EncryptedTokenCache {
  private config: Required<CacheConfig>;
  private sessions: Map<string, SessionMetadata>;
  private metrics: CacheMetrics;
  private auditService: any; // Will be typed as AuditService
  private cleanupInterval: NodeJS.Timeout | null = null;

  // AES-256-GCM constants
  private static readonly KEY_LENGTH = 32; // 256 bits
  private static readonly IV_LENGTH = 12; // 96 bits (recommended for GCM)
  private static readonly AUTH_TAG_LENGTH = 16; // 128 bits

  constructor(config: CacheConfig = {}, auditService?: any) {
    // Set defaults (opt-in design - disabled by default)
    this.config = {
      enabled: config.enabled ?? false,
      ttlSeconds: config.ttlSeconds ?? 60,
      sessionTimeoutMs: config.sessionTimeoutMs ?? 900000, // 15 minutes
      maxEntriesPerSession: config.maxEntriesPerSession ?? 10,
      maxTotalEntries: config.maxTotalEntries ?? 1000,
    };

    this.sessions = new Map();
    this.metrics = {
      hits: 0,
      misses: 0,
      decryptionFailures: 0,
      activeSessions: 0,
      totalEntries: 0,
      memoryUsageBytes: 0,
    };

    this.auditService = auditService;

    // Start cleanup interval if enabled
    if (this.config.enabled) {
      this.startCleanupInterval();
    }
  }

  /**
   * Activate a session with requestor JWT
   *
   * Generates a unique session-specific encryption key and initializes session metadata.
   *
   * @param requestorJWT - Subject token from user authentication
   * @param jwtSubject - Subject claim from JWT (for ownership validation)
   * @returns Session ID
   */
  activateSession(requestorJWT: string, jwtSubject: string): string {
    if (!this.config.enabled) {
      return ''; // No-op if cache disabled
    }

    // Generate session ID from JWT hash
    const sessionId = this.hashJWT(requestorJWT);

    // Check if session already exists
    if (this.sessions.has(sessionId)) {
      // Update last active timestamp (heartbeat)
      const session = this.sessions.get(sessionId)!;
      session.lastActive = Date.now();
      return sessionId;
    }

    // Generate session-specific encryption key (256-bit random)
    const encryptionKey = crypto.randomBytes(EncryptedTokenCache.KEY_LENGTH);

    // Create session metadata
    const session: SessionMetadata = {
      encryptionKey,
      jwtSubject,
      lastActive: Date.now(),
      entries: new Map(),
    };

    this.sessions.set(sessionId, session);
    this.metrics.activeSessions = this.sessions.size;

    this.logAudit({
      timestamp: new Date(),
      source: 'delegation:token-cache',
      userId: jwtSubject,
      action: 'session_activated',
      success: true,
      metadata: { sessionId },
    });

    return sessionId;
  }

  /**
   * Store delegation token in cache with encryption
   *
   * @param sessionId - Session ID from activateSession()
   * @param cacheKey - Unique key for this delegation context (e.g., "sql:query")
   * @param delegationToken - TE-JWT to cache
   * @param requestorJWT - Subject token (used as AAD for binding)
   * @param expiresAt - Delegation token expiry (Unix timestamp in seconds)
   */
  set(
    sessionId: string,
    cacheKey: string,
    delegationToken: string,
    requestorJWT: string,
    expiresAt: number
  ): void {
    if (!this.config.enabled) {
      return; // No-op if cache disabled
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      // Session not found - might have been cleaned up
      return;
    }

    // Calculate TTL (minimum of delegation token expiry and configured TTL)
    const configTTL = Date.now() + this.config.ttlSeconds * 1000;
    const tokenExpiry = expiresAt * 1000; // Convert to milliseconds
    const effectiveExpiry = Math.min(configTTL, tokenExpiry);

    // Reject if delegation token already expired
    if (effectiveExpiry <= Date.now()) {
      this.logAudit({
        timestamp: new Date(),
        source: 'delegation:token-cache',
        action: 'cache_set_rejected',
        success: false,
        reason: 'Delegation token already expired',
        metadata: { sessionId, cacheKey },
      });
      return;
    }

    // Enforce maxEntriesPerSession limit
    if (session.entries.size >= this.config.maxEntriesPerSession) {
      // Evict oldest entry
      const oldestKey = Array.from(session.entries.entries()).sort(
        (a, b) => a[1].createdAt - b[1].createdAt
      )[0][0];
      session.entries.delete(oldestKey);
      this.updateMetrics();
    }

    // Enforce maxTotalEntries limit across all sessions
    if (this.metrics.totalEntries >= this.config.maxTotalEntries) {
      // Evict oldest entry across all sessions
      this.evictOldestEntry();
    }

    // Encrypt delegation token
    const jwtHash = this.hashJWT(requestorJWT);
    const encrypted = this.encrypt(delegationToken, session.encryptionKey, jwtHash);

    // Store encrypted entry
    const entry: CacheEntry = {
      encryptedToken: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      jwtHash,
      expiresAt: effectiveExpiry,
      createdAt: Date.now(),
    };

    session.entries.set(cacheKey, entry);
    session.lastActive = Date.now();
    this.updateMetrics();

    this.logAudit({
      timestamp: new Date(),
      source: 'delegation:token-cache',
      action: 'cache_set',
      success: true,
      metadata: {
        sessionId,
        cacheKey,
        expiresAt: new Date(effectiveExpiry).toISOString(),
        ttlSeconds: (effectiveExpiry - Date.now()) / 1000,
      },
    });
  }

  /**
   * Retrieve delegation token from cache with decryption
   *
   * @param sessionId - Session ID
   * @param cacheKey - Cache key
   * @param requestorJWT - Subject token (used for AAD validation)
   * @returns Decrypted delegation token or null if not found/expired/invalid
   */
  get(sessionId: string, cacheKey: string, requestorJWT: string): string | null {
    if (!this.config.enabled) {
      return null; // No-op if cache disabled
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      this.metrics.misses++;
      return null; // Session not found
    }

    const entry = session.entries.get(cacheKey);
    if (!entry) {
      this.metrics.misses++;
      return null; // Entry not found
    }

    // Check expiry
    if (entry.expiresAt <= Date.now()) {
      // Expired - remove and return null
      session.entries.delete(cacheKey);
      this.updateMetrics();
      this.metrics.misses++;
      return null;
    }

    // Validate JWT hash (AAD)
    const jwtHash = this.hashJWT(requestorJWT);
    if (jwtHash !== entry.jwtHash) {
      // JWT changed (token refresh) - invalidate cache entry
      session.entries.delete(cacheKey);
      this.updateMetrics();
      this.metrics.decryptionFailures++;

      this.logAudit({
        timestamp: new Date(),
        source: 'delegation:token-cache',
        action: 'cache_invalidation',
        success: true,
        reason: 'Requestor JWT changed (automatic invalidation)',
        metadata: { sessionId, cacheKey },
      });

      return null;
    }

    // Decrypt
    try {
      const delegationToken = this.decrypt(
        entry.encryptedToken,
        session.encryptionKey,
        entry.iv,
        entry.authTag,
        jwtHash
      );

      // Update session activity
      session.lastActive = Date.now();
      this.metrics.hits++;

      this.logAudit({
        timestamp: new Date(),
        source: 'delegation:token-cache',
        action: 'cache_hit',
        success: true,
        metadata: { sessionId, cacheKey },
      });

      return delegationToken;
    } catch (error) {
      // Decryption failed (corrupted data, AAD mismatch, etc.)
      session.entries.delete(cacheKey);
      this.updateMetrics();
      this.metrics.decryptionFailures++;

      this.logAudit({
        timestamp: new Date(),
        source: 'delegation:token-cache',
        action: 'cache_decryption_failed',
        success: false,
        error: error instanceof Error ? error.message : 'Decryption failed',
        metadata: { sessionId, cacheKey },
      });

      return null;
    }
  }

  /**
   * Update session heartbeat (keep alive)
   *
   * @param sessionId - Session ID
   */
  heartbeat(sessionId: string): void {
    if (!this.config.enabled) {
      return;
    }

    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActive = Date.now();
    }
  }

  /**
   * Clear session and destroy encryption keys
   *
   * @param sessionId - Session ID
   */
  clearSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    // Zero out encryption key (perfect forward secrecy)
    session.encryptionKey.fill(0);

    // Clear entries
    session.entries.clear();

    // Remove session
    this.sessions.delete(sessionId);
    this.updateMetrics();

    this.logAudit({
      timestamp: new Date(),
      source: 'delegation:token-cache',
      action: 'session_cleared',
      success: true,
      metadata: { sessionId },
    });
  }

  /**
   * Get cache metrics
   */
  getMetrics(): CacheMetrics {
    return { ...this.metrics };
  }

  /**
   * Destroy cache and cleanup resources
   */
  destroy(): void {
    // Stop cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Clear all sessions (zeros encryption keys)
    for (const sessionId of this.sessions.keys()) {
      this.clearSession(sessionId);
    }
  }

  // ==========================================================================
  // Private Methods - Encryption/Decryption
  // ==========================================================================

  /**
   * Encrypt data with AES-256-GCM
   */
  private encrypt(
    plaintext: string,
    key: Buffer,
    aad: string
  ): { ciphertext: Buffer; iv: Buffer; authTag: Buffer } {
    // Generate random IV (never reuse!)
    const iv = crypto.randomBytes(EncryptedTokenCache.IV_LENGTH);

    // Create cipher
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    // Set AAD (Additional Authenticated Data - requestor JWT hash)
    cipher.setAAD(Buffer.from(aad, 'utf-8'));

    // Encrypt
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);

    // Get authentication tag
    const authTag = cipher.getAuthTag();

    return { ciphertext, iv, authTag };
  }

  /**
   * Decrypt data with AES-256-GCM
   */
  private decrypt(
    ciphertext: Buffer,
    key: Buffer,
    iv: Buffer,
    authTag: Buffer,
    aad: string
  ): string {
    // Create decipher
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);

    // Set AAD (must match encryption AAD)
    decipher.setAAD(Buffer.from(aad, 'utf-8'));

    // Set authentication tag
    decipher.setAuthTag(authTag);

    // Decrypt
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    return plaintext.toString('utf-8');
  }

  /**
   * Hash JWT using SHA-256
   */
  private hashJWT(jwt: string): string {
    return crypto.createHash('sha256').update(jwt).digest('hex');
  }

  // ==========================================================================
  // Private Methods - Cleanup & Metrics
  // ==========================================================================

  /**
   * Start cleanup interval for session timeout detection
   */
  private startCleanupInterval(): void {
    // Run cleanup every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 60000);
  }

  /**
   * Cleanup expired sessions based on heartbeat timeout
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now();
    const timeoutThreshold = now - this.config.sessionTimeoutMs;

    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.lastActive < timeoutThreshold) {
        this.clearSession(sessionId);

        this.logAudit({
          timestamp: new Date(),
          source: 'delegation:token-cache',
          action: 'session_timeout',
          success: true,
          metadata: {
            sessionId,
            lastActive: new Date(session.lastActive).toISOString(),
          },
        });
      }
    }
  }

  /**
   * Evict oldest cache entry across all sessions
   */
  private evictOldestEntry(): void {
    let oldestSessionId: string | null = null;
    let oldestKey: string | null = null;
    let oldestTimestamp = Infinity;

    for (const [sessionId, session] of this.sessions.entries()) {
      for (const [key, entry] of session.entries.entries()) {
        if (entry.createdAt < oldestTimestamp) {
          oldestTimestamp = entry.createdAt;
          oldestSessionId = sessionId;
          oldestKey = key;
        }
      }
    }

    if (oldestSessionId && oldestKey) {
      const session = this.sessions.get(oldestSessionId)!;
      session.entries.delete(oldestKey);
      this.updateMetrics();

      this.logAudit({
        timestamp: new Date(),
        source: 'delegation:token-cache',
        action: 'cache_eviction',
        success: true,
        reason: 'Max total entries limit reached',
        metadata: { sessionId: oldestSessionId, cacheKey: oldestKey },
      });
    }
  }

  /**
   * Update cache metrics
   */
  private updateMetrics(): void {
    let totalEntries = 0;
    let memoryUsage = 0;

    for (const session of this.sessions.values()) {
      totalEntries += session.entries.size;

      // Estimate memory usage
      memoryUsage += EncryptedTokenCache.KEY_LENGTH; // Encryption key
      for (const entry of session.entries.values()) {
        memoryUsage +=
          entry.encryptedToken.length +
          entry.iv.length +
          entry.authTag.length +
          entry.jwtHash.length;
      }
    }

    this.metrics.totalEntries = totalEntries;
    this.metrics.activeSessions = this.sessions.size;
    this.metrics.memoryUsageBytes = memoryUsage;
  }

  /**
   * Log audit entry (Null Object Pattern)
   */
  private async logAudit(entry: AuditEntry): Promise<void> {
    if (this.auditService && typeof this.auditService.log === 'function') {
      try {
        await this.auditService.log(entry);
      } catch (error) {
        // Silently fail - audit logging should never crash the service
      }
    }
  }
}
