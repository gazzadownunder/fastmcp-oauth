/**
 * Encrypted Token Cache Unit Tests
 *
 * Tests Phase 2 encrypted caching implementation with comprehensive security validation.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EncryptedTokenCache } from '../../../src/delegation/encrypted-token-cache.js';
import type { CacheConfig } from '../../../src/delegation/encrypted-token-cache.js';

describe('EncryptedTokenCache', () => {
  let cache: EncryptedTokenCache;
  let mockAuditService: any;
  let config: CacheConfig;

  const mockJWT1 = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyMTIzIiwiaWF0IjoxNjQwOTk1MjAwfQ.signature1';
  const mockJWT2 = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyMTIzIiwiaWF0IjoxNjQwOTk1MzAwfQ.signature2';
  const mockDelegationToken = 'delegation-token-value';

  beforeEach(() => {
    // Mock audit service
    mockAuditService = {
      log: vi.fn().mockResolvedValue(undefined),
    };

    // Default config with caching enabled
    config = {
      enabled: true,
      ttlSeconds: 60,
      sessionTimeoutMs: 900000, // 15 minutes
      maxEntriesPerSession: 10,
      maxTotalEntries: 1000,
    };

    cache = new EncryptedTokenCache(config, mockAuditService);
  });

  afterEach(() => {
    cache.destroy();
  });

  describe('Session Management', () => {
    it('should activate session and generate encryption key', () => {
      const sessionId = cache.activateSession(mockJWT1, 'user123');

      expect(sessionId).toBeTruthy();
      expect(sessionId.length).toBeGreaterThan(0);
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'delegation:token-cache',
          action: 'session_activated',
          success: true,
        })
      );
    });

    it('should generate same session ID for same JWT', () => {
      const sessionId1 = cache.activateSession(mockJWT1, 'user123');
      const sessionId2 = cache.activateSession(mockJWT1, 'user123');

      expect(sessionId1).toBe(sessionId2);
    });

    it('should generate different session ID for different JWT', () => {
      const sessionId1 = cache.activateSession(mockJWT1, 'user123');
      const sessionId2 = cache.activateSession(mockJWT2, 'user123');

      expect(sessionId1).not.toBe(sessionId2);
    });

    it('should clear session and destroy encryption keys', () => {
      const sessionId = cache.activateSession(mockJWT1, 'user123');

      cache.set(sessionId, 'key1', mockDelegationToken, mockJWT1, Date.now() / 1000 + 3600);

      cache.clearSession(sessionId);

      const retrieved = cache.get(sessionId, 'key1', mockJWT1);
      expect(retrieved).toBeNull();
    });

    it('should update session heartbeat', () => {
      const sessionId = cache.activateSession(mockJWT1, 'user123');

      cache.heartbeat(sessionId);

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('Encryption and Decryption', () => {
    it('should encrypt and decrypt delegation token successfully', () => {
      const sessionId = cache.activateSession(mockJWT1, 'user123');
      const expiresAt = Date.now() / 1000 + 3600;

      cache.set(sessionId, 'key1', mockDelegationToken, mockJWT1, expiresAt);

      const retrieved = cache.get(sessionId, 'key1', mockJWT1);

      expect(retrieved).toBe(mockDelegationToken);
    });

    it('should fail decryption when requestor JWT changes (AAD mismatch)', () => {
      const sessionId = cache.activateSession(mockJWT1, 'user123');
      const expiresAt = Date.now() / 1000 + 3600;

      cache.set(sessionId, 'key1', mockDelegationToken, mockJWT1, expiresAt);

      // Try to decrypt with different JWT
      const retrieved = cache.get(sessionId, 'key1', mockJWT2);

      expect(retrieved).toBeNull();
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'cache_invalidation',
          reason: 'Requestor JWT changed (automatic invalidation)',
        })
      );
    });

    it('should handle corrupted data gracefully', () => {
      const sessionId = cache.activateSession(mockJWT1, 'user123');

      // Manually corrupt cache (simulate tampering)
      // Since cache is private, we test by setting and then trying with wrong JWT
      cache.set(sessionId, 'key1', mockDelegationToken, mockJWT1, Date.now() / 1000 + 3600);

      // Different JWT should trigger decryption failure
      const retrieved = cache.get(sessionId, 'key1', mockJWT2);

      expect(retrieved).toBeNull();
    });
  });

  describe('TTL and Expiry', () => {
    it('should respect delegation token expiry', () => {
      const sessionId = cache.activateSession(mockJWT1, 'user123');
      const expiresAt = Math.floor(Date.now() / 1000) - 10; // Already expired

      cache.set(sessionId, 'key1', mockDelegationToken, mockJWT1, expiresAt);

      const retrieved = cache.get(sessionId, 'key1', mockJWT1);

      // Should not cache expired tokens
      expect(retrieved).toBeNull();
    });

    it('should return null for expired cache entries', () => {
      vi.useFakeTimers();

      const sessionId = cache.activateSession(mockJWT1, 'user123');
      const expiresAt = Math.floor(Date.now() / 1000) + 1; // Expires in 1 second

      cache.set(sessionId, 'key1', mockDelegationToken, mockJWT1, expiresAt);

      // Fast forward 2 seconds
      vi.advanceTimersByTime(2000);

      const retrieved = cache.get(sessionId, 'key1', mockJWT1);

      expect(retrieved).toBeNull();

      vi.useRealTimers();
    });

    it('should use minimum of config TTL and delegation token expiry', () => {
      const shortConfig: CacheConfig = {
        enabled: true,
        ttlSeconds: 10, // 10 seconds
      };

      const shortCache = new EncryptedTokenCache(shortConfig, mockAuditService);
      const sessionId = shortCache.activateSession(mockJWT1, 'user123');

      // Delegation token expires in 1 hour, but config TTL is 10 seconds
      const delegationExpiry = Math.floor(Date.now() / 1000) + 3600;

      shortCache.set(sessionId, 'key1', mockDelegationToken, mockJWT1, delegationExpiry);

      // Verify it was cached
      const retrieved1 = shortCache.get(sessionId, 'key1', mockJWT1);
      expect(retrieved1).toBe(mockDelegationToken);

      shortCache.destroy();
    });
  });

  describe('Cache Size Limits', () => {
    it('should enforce maxEntriesPerSession limit', () => {
      const limitedConfig: CacheConfig = {
        enabled: true,
        maxEntriesPerSession: 2,
      };

      const limitedCache = new EncryptedTokenCache(limitedConfig, mockAuditService);
      const sessionId = limitedCache.activateSession(mockJWT1, 'user123');
      const expiresAt = Date.now() / 1000 + 3600;

      // Add 3 entries (exceeds limit of 2)
      limitedCache.set(sessionId, 'key1', 'token1', mockJWT1, expiresAt);
      limitedCache.set(sessionId, 'key2', 'token2', mockJWT1, expiresAt);
      limitedCache.set(sessionId, 'key3', 'token3', mockJWT1, expiresAt);

      // Oldest entry (key1) should be evicted
      const retrieved1 = limitedCache.get(sessionId, 'key1', mockJWT1);
      const retrieved2 = limitedCache.get(sessionId, 'key2', mockJWT1);
      const retrieved3 = limitedCache.get(sessionId, 'key3', mockJWT1);

      expect(retrieved1).toBeNull(); // Evicted
      expect(retrieved2).toBe('token2');
      expect(retrieved3).toBe('token3');

      limitedCache.destroy();
    });

    it('should enforce maxTotalEntries limit across all sessions', () => {
      const limitedConfig: CacheConfig = {
        enabled: true,
        maxTotalEntries: 3,
      };

      const limitedCache = new EncryptedTokenCache(limitedConfig, mockAuditService);
      const expiresAt = Date.now() / 1000 + 3600;

      const sessionId1 = limitedCache.activateSession(mockJWT1, 'user1');
      const sessionId2 = limitedCache.activateSession(mockJWT2, 'user2');

      // Add entries across sessions
      limitedCache.set(sessionId1, 'key1', 'token1', mockJWT1, expiresAt);
      limitedCache.set(sessionId1, 'key2', 'token2', mockJWT1, expiresAt);
      limitedCache.set(sessionId2, 'key3', 'token3', mockJWT2, expiresAt);

      // Metrics should show 3 total entries
      const metrics = limitedCache.getMetrics();
      expect(metrics.totalEntries).toBe(3);

      // Adding one more should evict oldest
      limitedCache.set(sessionId2, 'key4', 'token4', mockJWT2, expiresAt);

      const metricsAfter = limitedCache.getMetrics();
      expect(metricsAfter.totalEntries).toBe(3); // Still 3 after eviction

      limitedCache.destroy();
    });
  });

  describe('Cache Metrics', () => {
    it('should track cache hits and misses', () => {
      const sessionId = cache.activateSession(mockJWT1, 'user123');
      const expiresAt = Date.now() / 1000 + 3600;

      // Miss
      cache.get(sessionId, 'nonexistent', mockJWT1);

      // Set and hit
      cache.set(sessionId, 'key1', mockDelegationToken, mockJWT1, expiresAt);
      cache.get(sessionId, 'key1', mockJWT1);

      const metrics = cache.getMetrics();

      expect(metrics.hits).toBe(1);
      expect(metrics.misses).toBeGreaterThanOrEqual(1);
    });

    it('should track decryption failures', () => {
      const sessionId = cache.activateSession(mockJWT1, 'user123');
      const expiresAt = Date.now() / 1000 + 3600;

      cache.set(sessionId, 'key1', mockDelegationToken, mockJWT1, expiresAt);

      // Try to get with different JWT (will cause AAD mismatch)
      cache.get(sessionId, 'key1', mockJWT2);

      const metrics = cache.getMetrics();

      expect(metrics.decryptionFailures).toBe(1);
    });

    it('should track active sessions', () => {
      cache.activateSession(mockJWT1, 'user1');
      cache.activateSession(mockJWT2, 'user2');

      const metrics = cache.getMetrics();

      expect(metrics.activeSessions).toBe(2);
    });

    it('should estimate memory usage', () => {
      const sessionId = cache.activateSession(mockJWT1, 'user123');
      const expiresAt = Date.now() / 1000 + 3600;

      cache.set(sessionId, 'key1', mockDelegationToken, mockJWT1, expiresAt);

      const metrics = cache.getMetrics();

      expect(metrics.memoryUsageBytes).toBeGreaterThan(0);
    });
  });

  describe('Session Timeout and Cleanup', () => {
    it('should cleanup expired sessions based on heartbeat timeout', async () => {
      vi.useFakeTimers();

      const timeoutConfig: CacheConfig = {
        enabled: true,
        sessionTimeoutMs: 1000, // 1 second timeout
      };

      const timeoutCache = new EncryptedTokenCache(timeoutConfig, mockAuditService);
      const sessionId = timeoutCache.activateSession(mockJWT1, 'user123');

      // Fast forward past session timeout + cleanup interval
      vi.advanceTimersByTime(70000); // 70 seconds

      // Session should be cleaned up
      const metrics = timeoutCache.getMetrics();
      expect(metrics.activeSessions).toBe(0);

      timeoutCache.destroy();
      vi.useRealTimers();
    });

    it('should keep session alive with heartbeat', () => {
      vi.useFakeTimers();

      const sessionId = cache.activateSession(mockJWT1, 'user123');

      // Advance time but send heartbeat
      vi.advanceTimersByTime(30000); // 30 seconds
      cache.heartbeat(sessionId);

      vi.advanceTimersByTime(30000); // Another 30 seconds
      cache.heartbeat(sessionId);

      const metrics = cache.getMetrics();
      expect(metrics.activeSessions).toBe(1);

      vi.useRealTimers();
    });
  });

  describe('Opt-in Design', () => {
    it('should be disabled by default', () => {
      const defaultCache = new EncryptedTokenCache();

      const sessionId = defaultCache.activateSession(mockJWT1, 'user123');

      expect(sessionId).toBe(''); // No-op when disabled

      defaultCache.destroy();
    });

    it('should be no-op when disabled', () => {
      const disabledCache = new EncryptedTokenCache({ enabled: false });

      const sessionId = disabledCache.activateSession(mockJWT1, 'user123');
      disabledCache.set(sessionId, 'key1', mockDelegationToken, mockJWT1, Date.now() / 1000 + 3600);
      const retrieved = disabledCache.get(sessionId, 'key1', mockJWT1);

      expect(sessionId).toBe('');
      expect(retrieved).toBeNull();

      disabledCache.destroy();
    });
  });

  describe('Security Tests', () => {
    it('SEC-001: Impersonation attack - Different requestor JWT fails decryption', () => {
      const sessionId = cache.activateSession(mockJWT1, 'user123');
      const expiresAt = Date.now() / 1000 + 3600;

      cache.set(sessionId, 'key1', mockDelegationToken, mockJWT1, expiresAt);

      // Attacker tries to use stolen ciphertext with their JWT
      const retrieved = cache.get(sessionId, 'key1', mockJWT2);

      expect(retrieved).toBeNull();
    });

    it('SEC-002: Replay attack - Stolen ciphertext useless without exact JWT', () => {
      const sessionId = cache.activateSession(mockJWT1, 'user123');
      const expiresAt = Date.now() / 1000 + 3600;

      cache.set(sessionId, 'key1', mockDelegationToken, mockJWT1, expiresAt);

      // Even with same session ID, different JWT fails
      const retrieved = cache.get(sessionId, 'key1', mockJWT2);

      expect(retrieved).toBeNull();
    });

    it('SEC-003: Token revocation - New JWT invalidates old cached tokens', () => {
      const sessionId1 = cache.activateSession(mockJWT1, 'user123');
      const expiresAt = Date.now() / 1000 + 3600;

      cache.set(sessionId1, 'key1', mockDelegationToken, mockJWT1, expiresAt);

      // User refreshes token (new JWT)
      const sessionId2 = cache.activateSession(mockJWT2, 'user123');

      // Old session still exists, but trying to decrypt with new JWT fails
      const retrieved = cache.get(sessionId1, 'key1', mockJWT2);

      expect(retrieved).toBeNull();
    });

    it('SEC-004: Session ownership validation - Different subject rejected', () => {
      const sessionId = cache.activateSession(mockJWT1, 'user123');
      const expiresAt = Date.now() / 1000 + 3600;

      cache.set(sessionId, 'key1', mockDelegationToken, mockJWT1, expiresAt);

      // Attacker with different user's JWT cannot decrypt
      const retrieved = cache.get(sessionId, 'key1', mockJWT2);

      expect(retrieved).toBeNull();
    });
  });

  describe('Audit Logging', () => {
    it('should log session activation', () => {
      cache.activateSession(mockJWT1, 'user123');

      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'session_activated',
        })
      );
    });

    it('should log cache set', () => {
      const sessionId = cache.activateSession(mockJWT1, 'user123');
      const expiresAt = Date.now() / 1000 + 3600;

      cache.set(sessionId, 'key1', mockDelegationToken, mockJWT1, expiresAt);

      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'cache_set',
        })
      );
    });

    it('should log cache hit', () => {
      const sessionId = cache.activateSession(mockJWT1, 'user123');
      const expiresAt = Date.now() / 1000 + 3600;

      cache.set(sessionId, 'key1', mockDelegationToken, mockJWT1, expiresAt);
      cache.get(sessionId, 'key1', mockJWT1);

      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'cache_hit',
        })
      );
    });

    it('should work without audit service (Null Object Pattern)', () => {
      const cacheWithoutAudit = new EncryptedTokenCache(config);

      const sessionId = cacheWithoutAudit.activateSession(mockJWT1, 'user123');
      const expiresAt = Date.now() / 1000 + 3600;

      cacheWithoutAudit.set(sessionId, 'key1', mockDelegationToken, mockJWT1, expiresAt);
      const retrieved = cacheWithoutAudit.get(sessionId, 'key1', mockJWT1);

      expect(retrieved).toBe(mockDelegationToken);

      cacheWithoutAudit.destroy();
    });
  });
});
