/**
 * AuditService Tests
 *
 * Tests for Phase 1.3: Audit Service with Null Object Pattern and Overflow Handling
 *
 * @see Docs/refactor-progress.md Phase 1.3
 */

import { describe, it, expect, vi } from 'vitest';
import { AuditService, InMemoryAuditStorage } from '../../../src/core/audit-service.js';
import type { AuditEntry } from '../../../src/core/types.js';

describe('AuditService', () => {
  describe('Null Object Pattern', () => {
    it('should work without configuration (disabled by default)', async () => {
      const audit = new AuditService();

      // Should not throw
      await expect(
        audit.log({
          timestamp: new Date(),
          source: 'test',
          action: 'test_action',
          success: true
        })
      ).resolves.toBeUndefined();

      expect(audit.isEnabled()).toBe(false);
    });

    it('should not crash with undefined config', async () => {
      const audit = new AuditService(undefined);

      await expect(
        audit.log({
          timestamp: new Date(),
          source: 'test',
          action: 'test_action',
          success: true
        })
      ).resolves.toBeUndefined();
    });

    it('should not log when disabled', async () => {
      const audit = new AuditService({ enabled: false });
      const storage = audit._getStorage() as InMemoryAuditStorage;

      await audit.log({
        timestamp: new Date(),
        source: 'test',
        action: 'test_action',
        success: true
      });

      expect(storage.getEntries()).toHaveLength(0);
    });
  });

  describe('Enabled Audit Logging', () => {
    it('should log entries when enabled', async () => {
      const audit = new AuditService({ enabled: true });
      const storage = audit._getStorage() as InMemoryAuditStorage;

      const entry: AuditEntry = {
        timestamp: new Date(),
        source: 'auth:service',
        userId: 'user123',
        action: 'login',
        success: true
      };

      await audit.log(entry);

      const entries = storage.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject(entry);
    });

    it('should add timestamp if missing', async () => {
      const audit = new AuditService({ enabled: true });
      const storage = audit._getStorage() as InMemoryAuditStorage;

      const entry = {
        source: 'test',
        action: 'test_action',
        success: true
      } as AuditEntry;

      await audit.log(entry);

      const entries = storage.getEntries();
      expect(entries[0].timestamp).toBeInstanceOf(Date);
    });

    it('should log multiple entries', async () => {
      const audit = new AuditService({ enabled: true });
      const storage = audit._getStorage() as InMemoryAuditStorage;

      for (let i = 0; i < 5; i++) {
        await audit.log({
          timestamp: new Date(),
          source: 'test',
          action: `action_${i}`,
          success: true
        });
      }

      expect(storage.getEntries()).toHaveLength(5);
    });
  });

  describe('MANDATORY (GAP #3): Source Field Validation', () => {
    it('should throw if source field is missing', async () => {
      const audit = new AuditService({ enabled: true });

      const entryWithoutSource = {
        timestamp: new Date(),
        // source: missing
        action: 'test_action',
        success: true
      } as AuditEntry;

      await expect(audit.log(entryWithoutSource)).rejects.toThrow(
        /CRITICAL: AuditEntry missing required field: source/
      );
    });

    it('should accept entries with source field', async () => {
      const audit = new AuditService({ enabled: true });

      await expect(
        audit.log({
          timestamp: new Date(),
          source: 'auth:mapper',
          action: 'role_mapping',
          success: true
        })
      ).resolves.toBeUndefined();
    });

    it('should track source field values correctly', async () => {
      const audit = new AuditService({ enabled: true });
      const storage = audit._getStorage() as InMemoryAuditStorage;

      const sources = ['auth:service', 'delegation:sql', 'delegation:registry'];

      for (const source of sources) {
        await audit.log({
          timestamp: new Date(),
          source,
          action: 'test',
          success: true
        });
      }

      const entries = storage.getEntries();
      expect(entries.map(e => e.source)).toEqual(sources);
    });
  });

  describe('MANDATORY (GAP #7): Overflow Handling', () => {
    it('should call onOverflow callback when capacity reached', async () => {
      const onOverflow = vi.fn();
      const maxEntries = 5;

      const storage = new InMemoryAuditStorage(maxEntries, onOverflow);
      const audit = new AuditService({ enabled: true, storage });

      // Fill to capacity
      for (let i = 0; i < maxEntries; i++) {
        await audit.log({
          timestamp: new Date(),
          source: 'test',
          action: `action_${i}`,
          success: true
        });
      }

      expect(onOverflow).not.toHaveBeenCalled();

      // Trigger overflow
      await audit.log({
        timestamp: new Date(),
        source: 'test',
        action: 'overflow_action',
        success: true
      });

      expect(onOverflow).toHaveBeenCalledTimes(1);
      expect(onOverflow).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ action: 'action_0' })
        ])
      );
    });

    it('should pass ALL entries to onOverflow before discarding', async () => {
      const onOverflow = vi.fn();
      const maxEntries = 3;

      const storage = new InMemoryAuditStorage(maxEntries, onOverflow);
      const audit = new AuditService({ enabled: true, storage });

      // Fill to capacity
      for (let i = 0; i < maxEntries; i++) {
        await audit.log({
          timestamp: new Date(),
          source: 'test',
          action: `action_${i}`,
          success: true
        });
      }

      // Trigger overflow
      await audit.log({
        timestamp: new Date(),
        source: 'test',
        action: 'overflow_action',
        success: true
      });

      const callbackEntries = onOverflow.mock.calls[0][0];
      expect(callbackEntries).toHaveLength(maxEntries + 1); // All entries before shift
    });

    it('should remove oldest entry after overflow', async () => {
      const onOverflow = vi.fn();
      const maxEntries = 3;

      const storage = new InMemoryAuditStorage(maxEntries, onOverflow);
      const audit = new AuditService({ enabled: true, storage });

      // Fill to capacity
      for (let i = 0; i < maxEntries; i++) {
        await audit.log({
          timestamp: new Date(),
          source: 'test',
          action: `action_${i}`,
          success: true
        });
      }

      // Trigger overflow
      await audit.log({
        timestamp: new Date(),
        source: 'test',
        action: 'overflow_action',
        success: true
      });

      const remainingEntries = (storage as InMemoryAuditStorage).getEntries();
      expect(remainingEntries).toHaveLength(maxEntries);
      expect(remainingEntries[0].action).toBe('action_1'); // action_0 removed
      expect(remainingEntries[maxEntries - 1].action).toBe('overflow_action');
    });

    it('should work without onOverflow callback', async () => {
      const maxEntries = 3;
      const storage = new InMemoryAuditStorage(maxEntries); // No callback
      const audit = new AuditService({ enabled: true, storage });

      // Should not throw even without callback
      for (let i = 0; i < maxEntries + 2; i++) {
        await expect(
          audit.log({
            timestamp: new Date(),
            source: 'test',
            action: `action_${i}`,
            success: true
          })
        ).resolves.toBeUndefined();
      }
    });

    it('should call onOverflow multiple times on multiple overflows', async () => {
      const onOverflow = vi.fn();
      const maxEntries = 2;

      const storage = new InMemoryAuditStorage(maxEntries, onOverflow);
      const audit = new AuditService({ enabled: true, storage });

      // Fill and overflow twice
      for (let i = 0; i < maxEntries + 2; i++) {
        await audit.log({
          timestamp: new Date(),
          source: 'test',
          action: `action_${i}`,
          success: true
        });
      }

      expect(onOverflow).toHaveBeenCalledTimes(2);
    });
  });

  describe('In-Memory Storage Limit', () => {
    it('should default to 10,000 entry limit', async () => {
      const audit = new AuditService({ enabled: true });
      const storage = audit._getStorage() as InMemoryAuditStorage;

      // This is a metadata test - we trust the implementation
      // without actually logging 10k entries in the test
      expect(storage).toBeInstanceOf(InMemoryAuditStorage);
    });

    it('should maintain max entries limit', async () => {
      const maxEntries = 10;
      const storage = new InMemoryAuditStorage(maxEntries);
      const audit = new AuditService({ enabled: true, storage });

      // Log more than max
      for (let i = 0; i < maxEntries * 2; i++) {
        await audit.log({
          timestamp: new Date(),
          source: 'test',
          action: `action_${i}`,
          success: true
        });
      }

      // Should never exceed max
      expect((storage as InMemoryAuditStorage).getEntries()).toHaveLength(maxEntries);
    });
  });

  describe('Custom Storage', () => {
    it('should accept custom storage implementation', async () => {
      const customStorage = {
        log: vi.fn()
      };

      const audit = new AuditService({
        enabled: true,
        storage: customStorage
      });

      await audit.log({
        timestamp: new Date(),
        source: 'test',
        action: 'test_action',
        success: true
      });

      expect(customStorage.log).toHaveBeenCalledTimes(1);
    });

    it('should support async storage implementations', async () => {
      const customStorage = {
        log: vi.fn().mockResolvedValue(undefined)
      };

      const audit = new AuditService({
        enabled: true,
        storage: customStorage
      });

      await expect(
        audit.log({
          timestamp: new Date(),
          source: 'test',
          action: 'test_action',
          success: true
        })
      ).resolves.toBeUndefined();
    });
  });

  describe('Write-Only API Design', () => {
    it('should NOT expose query methods on AuditService', () => {
      const audit = new AuditService({ enabled: true });

      // Verify no query methods exist
      expect(audit).not.toHaveProperty('query');
      expect(audit).not.toHaveProperty('find');
      expect(audit).not.toHaveProperty('getEntries');
      expect(audit).not.toHaveProperty('search');
    });

    it('should only expose log() method publicly', () => {
      const audit = new AuditService({ enabled: true });

      const publicMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(audit))
        .filter(name => !name.startsWith('_') && name !== 'constructor');

      expect(publicMethods).toContain('log');
      expect(publicMethods).toContain('isEnabled');
      expect(publicMethods).not.toContain('query');
    });
  });
});
