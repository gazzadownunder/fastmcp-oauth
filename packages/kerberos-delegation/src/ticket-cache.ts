/**
 * Kerberos Ticket Cache - Session-scoped ticket caching
 *
 * Provides in-memory caching of Kerberos tickets to reduce KDC load
 * and improve performance. Tickets are scoped to user sessions and
 * automatically expire based on TTL.
 *
 * Features:
 * - Session-scoped storage (tickets isolated by sessionId)
 * - TTL-based expiration
 * - Automatic cleanup of expired tickets
 * - Renewal threshold warnings
 * - Metrics tracking
 *
 * @module delegation/kerberos/ticket-cache
 */

import type { KerberosTicket } from './kerberos-client.js';

/**
 * Cached ticket entry with metadata
 */
interface CachedTicket {
  /**
   * The Kerberos ticket
   */
  ticket: KerberosTicket;

  /**
   * Cache entry creation timestamp
   */
  cachedAt: Date;

  /**
   * Last access timestamp
   */
  lastAccess: Date;

  /**
   * Hit count
   */
  hitCount: number;
}

/**
 * Session cache entry
 */
interface SessionCache {
  /**
   * Session ID
   */
  sessionId: string;

  /**
   * Tickets for this session (key: principal)
   */
  tickets: Map<string, CachedTicket>;

  /**
   * Last activity timestamp
   */
  lastActivity: Date;
}

/**
 * Cache metrics
 */
export interface TicketCacheMetrics {
  /**
   * Total cache hits
   */
  cacheHits: number;

  /**
   * Total cache misses
   */
  cacheMisses: number;

  /**
   * Total expired tickets removed
   */
  expiredTickets: number;

  /**
   * Active sessions
   */
  activeSessions: number;

  /**
   * Total cached tickets
   */
  totalTickets: number;

  /**
   * Average ticket age (ms)
   */
  averageTicketAge: number;

  /**
   * Estimated memory usage (bytes)
   */
  memoryUsageEstimate: number;
}

/**
 * TicketCache - In-memory cache for Kerberos tickets
 *
 * Provides session-scoped caching with automatic expiration and cleanup.
 *
 * @example
 * ```typescript
 * const cache = new TicketCache({
 *   enabled: true,
 *   ttlSeconds: 3600,
 *   renewThresholdSeconds: 300
 * });
 *
 * // Cache a ticket
 * await cache.set('session-123', 'ALICE@COMPANY.COM', ticket);
 *
 * // Retrieve cached ticket
 * const cachedTicket = await cache.get('session-123', 'ALICE@COMPANY.COM');
 *
 * // Clear session on logout
 * await cache.delete('session-123');
 * ```
 */
export class TicketCache {
  private sessions: Map<string, SessionCache> = new Map();
  private config: {
    enabled: boolean;
    ttlSeconds: number;
    renewThresholdSeconds: number;
    maxEntriesPerSession?: number;
    sessionTimeoutMs?: number;
  };
  private metrics: {
    hits: number;
    misses: number;
    expired: number;
  } = {
    hits: 0,
    misses: 0,
    expired: 0,
  };
  private cleanupInterval?: NodeJS.Timeout;

  constructor(
    config: {
      enabled?: boolean;
      ttlSeconds?: number;
      renewThresholdSeconds?: number;
      maxEntriesPerSession?: number;
      sessionTimeoutMs?: number;
    } = {}
  ) {
    this.config = {
      enabled: config.enabled ?? true,
      ttlSeconds: config.ttlSeconds ?? 3600, // 1 hour default
      renewThresholdSeconds: config.renewThresholdSeconds ?? 300, // 5 minutes
      maxEntriesPerSession: config.maxEntriesPerSession ?? 10,
      sessionTimeoutMs: config.sessionTimeoutMs ?? 15 * 60 * 1000, // 15 minutes
    };

    // Start periodic cleanup if enabled
    if (this.config.enabled) {
      this.startCleanup();
    }
  }

  /**
   * Set (cache) a ticket for a session
   *
   * @param sessionId - User session ID
   * @param principal - User principal name (cache key)
   * @param ticket - Kerberos ticket to cache
   */
  async set(
    sessionId: string,
    principal: string,
    ticket: KerberosTicket
  ): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    // Get or create session cache
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        sessionId,
        tickets: new Map(),
        lastActivity: new Date(),
      };
      this.sessions.set(sessionId, session);
    }

    // Check max entries per session
    if (
      this.config.maxEntriesPerSession &&
      session.tickets.size >= this.config.maxEntriesPerSession &&
      !session.tickets.has(principal)
    ) {
      // Remove oldest ticket (LRU)
      const oldestKey = this.findOldestTicket(session);
      if (oldestKey) {
        session.tickets.delete(oldestKey);
      }
    }

    // Cache the ticket
    session.tickets.set(principal, {
      ticket,
      cachedAt: new Date(),
      lastAccess: new Date(),
      hitCount: 0,
    });

    // Update last activity
    session.lastActivity = new Date();
  }

  /**
   * Get (retrieve) a cached ticket
   *
   * Returns undefined if:
   * - Cache is disabled
   * - Ticket not found
   * - Ticket expired
   * - Session expired
   *
   * @param sessionId - User session ID
   * @param principal - User principal name (cache key)
   * @returns Cached ticket or undefined
   */
  async get(
    sessionId: string,
    principal: string
  ): Promise<KerberosTicket | undefined> {
    if (!this.config.enabled) {
      this.metrics.misses++;
      return undefined;
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      this.metrics.misses++;
      return undefined;
    }

    const cached = session.tickets.get(principal);
    if (!cached) {
      this.metrics.misses++;
      return undefined;
    }

    // Check ticket expiration
    const now = new Date();
    const cacheAge = now.getTime() - cached.cachedAt.getTime();
    const ttlMs = this.config.ttlSeconds * 1000;

    if (cacheAge > ttlMs) {
      // Ticket cache expired
      session.tickets.delete(principal);
      this.metrics.expired++;
      this.metrics.misses++;
      return undefined;
    }

    // Check ticket validity
    if (cached.ticket.expiresAt < now) {
      // Ticket itself expired
      session.tickets.delete(principal);
      this.metrics.expired++;
      this.metrics.misses++;
      return undefined;
    }

    // Update access metadata
    cached.lastAccess = now;
    cached.hitCount++;
    session.lastActivity = now;

    this.metrics.hits++;
    return cached.ticket;
  }

  /**
   * Check if ticket needs renewal soon
   *
   * Returns true if ticket will expire within renewThresholdSeconds
   *
   * @param sessionId - User session ID
   * @param principal - User principal name
   * @returns true if renewal needed, false otherwise
   */
  async needsRenewal(sessionId: string, principal: string): Promise<boolean> {
    const ticket = await this.get(sessionId, principal);
    if (!ticket) {
      return true; // No ticket, needs renewal
    }

    const now = new Date();
    const timeUntilExpiry = ticket.expiresAt.getTime() - now.getTime();
    const renewalThresholdMs = this.config.renewThresholdSeconds * 1000;

    return timeUntilExpiry < renewalThresholdMs;
  }

  /**
   * Delete (clear) all tickets for a session
   *
   * Call this when user logs out or session ends
   *
   * @param sessionId - User session ID
   */
  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  /**
   * Update last activity timestamp for a session
   *
   * Call this on every request to prevent session timeout
   *
   * @param sessionId - User session ID
   */
  async heartbeat(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = new Date();
    }
  }

  /**
   * Get cache metrics
   *
   * @returns Current cache metrics
   */
  getMetrics(): TicketCacheMetrics {
    let totalTickets = 0;
    let totalAge = 0;
    let memoryEstimate = 0;

    const now = new Date();

    for (const session of this.sessions.values()) {
      for (const cached of session.tickets.values()) {
        totalTickets++;
        totalAge += now.getTime() - cached.cachedAt.getTime();

        // Estimate memory: principal (50 bytes) + ticket data (~1KB)
        memoryEstimate += 1050;
      }

      // Session overhead: ~200 bytes
      memoryEstimate += 200;
    }

    return {
      cacheHits: this.metrics.hits,
      cacheMisses: this.metrics.misses,
      expiredTickets: this.metrics.expired,
      activeSessions: this.sessions.size,
      totalTickets,
      averageTicketAge: totalTickets > 0 ? totalAge / totalTickets : 0,
      memoryUsageEstimate: memoryEstimate,
    };
  }

  /**
   * Cleanup expired tickets and sessions
   *
   * Removes:
   * - Expired tickets (based on TTL and ticket expiration)
   * - Inactive sessions (based on sessionTimeoutMs)
   */
  async cleanup(): Promise<void> {
    const now = new Date();
    const ttlMs = this.config.ttlSeconds * 1000;
    const sessionTimeoutMs = this.config.sessionTimeoutMs || 15 * 60 * 1000;

    let removedTickets = 0;
    let removedSessions = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      // Check session timeout
      const sessionAge = now.getTime() - session.lastActivity.getTime();
      if (sessionAge > sessionTimeoutMs) {
        this.sessions.delete(sessionId);
        removedSessions++;
        removedTickets += session.tickets.size;
        continue;
      }

      // Cleanup expired tickets in this session
      for (const [principal, cached] of session.tickets.entries()) {
        const cacheAge = now.getTime() - cached.cachedAt.getTime();
        const ticketExpired = cached.ticket.expiresAt < now;

        if (cacheAge > ttlMs || ticketExpired) {
          session.tickets.delete(principal);
          removedTickets++;
        }
      }

      // Remove empty sessions
      if (session.tickets.size === 0) {
        this.sessions.delete(sessionId);
        removedSessions++;
      }
    }

    if (removedTickets > 0 || removedSessions > 0) {
      this.metrics.expired += removedTickets;
    }
  }

  /**
   * Find oldest ticket in session (for LRU eviction)
   *
   * @param session - Session cache
   * @returns Principal of oldest ticket
   */
  private findOldestTicket(session: SessionCache): string | undefined {
    let oldestPrincipal: string | undefined;
    let oldestAccess = new Date();

    for (const [principal, cached] of session.tickets.entries()) {
      if (cached.lastAccess < oldestAccess) {
        oldestAccess = cached.lastAccess;
        oldestPrincipal = principal;
      }
    }

    return oldestPrincipal;
  }

  /**
   * Start periodic cleanup task
   */
  private startCleanup(): void {
    // Run cleanup every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup().catch((error) => {
        console.error('Ticket cache cleanup failed:', error);
      });
    }, 60 * 1000);

    // Ensure cleanup stops on process exit
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Stop periodic cleanup and clear all cache
   */
  async destroy(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }

    this.sessions.clear();
    this.metrics = { hits: 0, misses: 0, expired: 0 };
  }
}
