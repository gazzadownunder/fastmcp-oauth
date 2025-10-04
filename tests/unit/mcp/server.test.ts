/**
 * MCPOAuthServer Unit Tests
 *
 * Tests the high-level MCPOAuthServer wrapper class.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MCPOAuthServer } from '../../../src/mcp/server.js';
import type { DelegationModule } from '../../../src/delegation/base.js';

describe('MCPOAuthServer', () => {
  describe('Constructor', () => {
    it('should create server instance with config path', () => {
      const server = new MCPOAuthServer('./config/test-config.json');
      expect(server).toBeInstanceOf(MCPOAuthServer);
    });

    it('should initialize with running state as false', () => {
      const server = new MCPOAuthServer('./config/test-config.json');
      expect(server.isServerRunning()).toBe(false);
    });

    it('should provide access to config manager', () => {
      const server = new MCPOAuthServer('./config/test-config.json');
      const configManager = server.getConfigManager();
      expect(configManager).toBeDefined();
      expect(configManager.loadConfig).toBeDefined();
    });
  });

  describe('getCoreContext()', () => {
    it('should throw error if server not started', () => {
      const server = new MCPOAuthServer('./config/test-config.json');

      expect(() => server.getCoreContext()).toThrow(
        'CoreContext not initialized. Call start() first.'
      );
    });
  });

  describe('registerDelegationModule()', () => {
    it('should throw error if server not started', async () => {
      const server = new MCPOAuthServer('./config/test-config.json');

      const mockModule: DelegationModule = {
        name: 'test-module',
        healthCheck: vi.fn().mockResolvedValue(true),
        delegate: vi.fn(),
        destroy: vi.fn(),
      };

      await expect(
        server.registerDelegationModule('test', mockModule)
      ).rejects.toThrow(
        'Cannot register delegation module before server initialization'
      );
    });
  });

  describe('isServerRunning()', () => {
    it('should return false when server is not started', () => {
      const server = new MCPOAuthServer('./config/test-config.json');
      expect(server.isServerRunning()).toBe(false);
    });
  });

  describe('stop()', () => {
    it('should handle stop when server is not running', async () => {
      const server = new MCPOAuthServer('./config/test-config.json');

      // Should not throw
      await expect(server.stop()).resolves.toBeUndefined();
    });
  });

  describe('Type Safety', () => {
    it('should accept valid config paths', () => {
      const server1 = new MCPOAuthServer('./config/test.json');
      const server2 = new MCPOAuthServer('../config/prod.json');
      const server3 = new MCPOAuthServer('/absolute/path/config.json');

      expect(server1).toBeInstanceOf(MCPOAuthServer);
      expect(server2).toBeInstanceOf(MCPOAuthServer);
      expect(server3).toBeInstanceOf(MCPOAuthServer);
    });
  });

  describe('Method Availability', () => {
    it('should have all required methods', () => {
      const server = new MCPOAuthServer('./config/test.json');

      expect(typeof server.start).toBe('function');
      expect(typeof server.stop).toBe('function');
      expect(typeof server.registerDelegationModule).toBe('function');
      expect(typeof server.getCoreContext).toBe('function');
      expect(typeof server.isServerRunning).toBe('function');
      expect(typeof server.getConfigManager).toBe('function');
    });
  });

  describe('Error Messages', () => {
    it('should provide helpful error message for getCoreContext before start', () => {
      const server = new MCPOAuthServer('./config/test.json');

      try {
        server.getCoreContext();
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('Call start() first');
      }
    });

    it('should provide helpful error message for registerDelegationModule before start', async () => {
      const server = new MCPOAuthServer('./config/test.json');
      const mockModule: DelegationModule = {
        name: 'test',
        healthCheck: vi.fn(),
        delegate: vi.fn(),
        destroy: vi.fn(),
      };

      try {
        await server.registerDelegationModule('test', mockModule);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('Call start() first');
      }
    });
  });

  describe('Integration Readiness', () => {
    it('should be ready for integration with ConfigManager', () => {
      const server = new MCPOAuthServer('./config/test.json');
      const configManager = server.getConfigManager();

      // ConfigManager should have expected methods
      expect(configManager).toHaveProperty('loadConfig');
      expect(configManager).toHaveProperty('getConfig');
      expect(configManager).toHaveProperty('getDelegationConfig');
      expect(configManager).toHaveProperty('getMCPConfig');
    });

    it('should be ready for integration with ConfigOrchestrator', () => {
      // The server internally creates a ConfigOrchestrator
      // This test verifies the constructor doesn't throw
      const server = new MCPOAuthServer('./config/test.json');
      expect(server).toBeInstanceOf(MCPOAuthServer);
    });
  });
});
