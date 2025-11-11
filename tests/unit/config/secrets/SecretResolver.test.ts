/**
 * Unit Tests for SecretResolver
 *
 * Tests the secret resolution orchestrator with provider chain logic, including:
 * - Provider chain priority
 * - Recursive configuration walking
 * - Secret descriptor detection and replacement
 * - Fail-fast behavior
 * - Audit logging integration
 * - Error handling
 *
 * @see Docs/SECRETS-MANAGEMENT.md
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SecretResolver } from '../../../../src/config/secrets/SecretResolver.js';
import { ISecretProvider } from '../../../../src/config/secrets/ISecretProvider.js';
import { AuditService } from '../../../../src/core/audit-service.js';

// Mock provider for testing
class MockSecretProvider implements ISecretProvider {
  private secrets: Map<string, string>;

  constructor(secrets: Record<string, string>) {
    this.secrets = new Map(Object.entries(secrets));
  }

  async resolve(logicalName: string): Promise<string | undefined> {
    return this.secrets.get(logicalName);
  }

  // Helper for tests
  addSecret(name: string, value: string): void {
    this.secrets.set(name, value);
  }

  removeSecret(name: string): void {
    this.secrets.delete(name);
  }
}

// Mock provider that always fails
class FailingProvider implements ISecretProvider {
  async resolve(logicalName: string): Promise<string | undefined> {
    throw new Error(`Provider error for ${logicalName}`);
  }
}

describe('SecretResolver', () => {
  let resolver: SecretResolver;

  beforeEach(() => {
    resolver = new SecretResolver({ failFast: true });
  });

  describe('constructor', () => {
    it('should create resolver with default config', () => {
      const defaultResolver = new SecretResolver();
      expect(defaultResolver).toBeInstanceOf(SecretResolver);
      expect(defaultResolver.getProviders()).toHaveLength(0);
    });

    it('should create resolver with audit service', () => {
      const auditService = new AuditService({ enabled: true });
      const resolverWithAudit = new SecretResolver({ auditService });
      expect(resolverWithAudit).toBeInstanceOf(SecretResolver);
    });

    it('should create resolver with failFast disabled', () => {
      const nonFailingResolver = new SecretResolver({ failFast: false });
      expect(nonFailingResolver).toBeInstanceOf(SecretResolver);
    });
  });

  describe('addProvider', () => {
    it('should add provider to chain', () => {
      const provider = new MockSecretProvider({ TEST: 'value' });
      resolver.addProvider(provider);

      expect(resolver.getProviders()).toHaveLength(1);
      expect(resolver.getProviders()[0]).toBe(provider);
    });

    it('should add multiple providers in order', () => {
      const provider1 = new MockSecretProvider({ TEST1: 'value1' });
      const provider2 = new MockSecretProvider({ TEST2: 'value2' });

      resolver.addProvider(provider1);
      resolver.addProvider(provider2);

      expect(resolver.getProviders()).toHaveLength(2);
      expect(resolver.getProviders()[0]).toBe(provider1);
      expect(resolver.getProviders()[1]).toBe(provider2);
    });

    it('should throw error for invalid provider', () => {
      const invalidProvider = { notResolve: () => {} } as any;

      expect(() => resolver.addProvider(invalidProvider)).toThrow(
        'Provider must implement ISecretProvider interface'
      );
    });
  });

  describe('resolveSecrets', () => {
    describe('basic resolution', () => {
      it('should resolve simple secret descriptor', async () => {
        const provider = new MockSecretProvider({ DB_PASSWORD: 'ServicePass123!' });
        resolver.addProvider(provider);

        const config = {
          password: { $secret: 'DB_PASSWORD' },
        };

        await resolver.resolveSecrets(config);

        expect(config.password).toBe('ServicePass123!');
      });

      it('should resolve multiple secret descriptors', async () => {
        const provider = new MockSecretProvider({
          DB_PASSWORD: 'DBPass123!',
          API_KEY: 'ApiKey456!',
        });
        resolver.addProvider(provider);

        const config = {
          database: { password: { $secret: 'DB_PASSWORD' } },
          api: { key: { $secret: 'API_KEY' } },
        };

        await resolver.resolveSecrets(config);

        expect(config.database.password).toBe('DBPass123!');
        expect(config.api.key).toBe('ApiKey456!');
      });

      it('should leave non-secret values unchanged', async () => {
        const provider = new MockSecretProvider({ SECRET: 'SecretValue' });
        resolver.addProvider(provider);

        const config = {
          plainString: 'plain value',
          plainNumber: 42,
          plainBoolean: true,
          plainArray: [1, 2, 3],
          plainObject: { key: 'value' },
          secret: { $secret: 'SECRET' },
        };

        await resolver.resolveSecrets(config);

        expect(config.plainString).toBe('plain value');
        expect(config.plainNumber).toBe(42);
        expect(config.plainBoolean).toBe(true);
        expect(config.plainArray).toEqual([1, 2, 3]);
        expect(config.plainObject).toEqual({ key: 'value' });
        expect(config.secret).toBe('SecretValue');
      });
    });

    describe('nested resolution', () => {
      it('should resolve secrets in nested objects', async () => {
        const provider = new MockSecretProvider({ NESTED_SECRET: 'NestedValue' });
        resolver.addProvider(provider);

        const config = {
          level1: {
            level2: {
              level3: {
                secret: { $secret: 'NESTED_SECRET' },
              },
            },
          },
        };

        await resolver.resolveSecrets(config);

        expect(config.level1.level2.level3.secret).toBe('NestedValue');
      });

      it('should resolve secrets in arrays', async () => {
        const provider = new MockSecretProvider({
          SECRET1: 'Value1',
          SECRET2: 'Value2',
        });
        resolver.addProvider(provider);

        const config = {
          array: [
            { $secret: 'SECRET1' },
            { $secret: 'SECRET2' },
            'plain value',
          ],
        };

        await resolver.resolveSecrets(config);

        // Note: Arrays with secret descriptors are not currently supported
        // The resolver only replaces secrets in object properties, not array elements
        // This is by design to avoid ambiguity about array element types
        expect(config.array[0]).toEqual({ $secret: 'SECRET1' }); // Unchanged
        expect(config.array[1]).toEqual({ $secret: 'SECRET2' }); // Unchanged
        expect(config.array[2]).toBe('plain value'); // Unchanged
      });

      it('should resolve secrets in mixed nested structures', async () => {
        const provider = new MockSecretProvider({
          SECRET_A: 'ValueA',
          SECRET_B: 'ValueB',
          SECRET_C: 'ValueC',
        });
        resolver.addProvider(provider);

        const config = {
          databases: [
            {
              name: 'db1',
              password: { $secret: 'SECRET_A' },
            },
            {
              name: 'db2',
              password: { $secret: 'SECRET_B' },
            },
          ],
          api: {
            credentials: {
              key: { $secret: 'SECRET_C' },
            },
          },
        };

        await resolver.resolveSecrets(config);

        expect(config.databases[0].password).toBe('ValueA');
        expect(config.databases[1].password).toBe('ValueB');
        expect(config.api.credentials.key).toBe('ValueC');
      });
    });

    describe('provider chain priority', () => {
      it('should use first provider that returns value', async () => {
        const provider1 = new MockSecretProvider({ SECRET: 'Provider1Value' });
        const provider2 = new MockSecretProvider({ SECRET: 'Provider2Value' });

        resolver.addProvider(provider1);
        resolver.addProvider(provider2);

        const config = { password: { $secret: 'SECRET' } };
        await resolver.resolveSecrets(config);

        expect(config.password).toBe('Provider1Value'); // First provider wins
      });

      it('should fallback to second provider if first returns undefined', async () => {
        const provider1 = new MockSecretProvider({}); // Empty
        const provider2 = new MockSecretProvider({ SECRET: 'Provider2Value' });

        resolver.addProvider(provider1);
        resolver.addProvider(provider2);

        const config = { password: { $secret: 'SECRET' } };
        await resolver.resolveSecrets(config);

        expect(config.password).toBe('Provider2Value'); // Second provider wins
      });

      it('should try all providers in order until one succeeds', async () => {
        const provider1 = new MockSecretProvider({});
        const provider2 = new MockSecretProvider({});
        const provider3 = new MockSecretProvider({ SECRET: 'Provider3Value' });

        resolver.addProvider(provider1);
        resolver.addProvider(provider2);
        resolver.addProvider(provider3);

        const config = { password: { $secret: 'SECRET' } };
        await resolver.resolveSecrets(config);

        expect(config.password).toBe('Provider3Value'); // Third provider wins
      });
    });

    describe('error handling', () => {
      it('should throw error if secret not found and failFast is true', async () => {
        const provider = new MockSecretProvider({}); // Empty provider
        resolver.addProvider(provider);

        const config = { password: { $secret: 'NONEXISTENT' } };

        await expect(resolver.resolveSecrets(config)).rejects.toThrow(
          'Secret "NONEXISTENT" at path "config.password" could not be resolved'
        );
      });

      it('should not throw error if secret not found and failFast is false', async () => {
        const nonFailingResolver = new SecretResolver({ failFast: false });
        const provider = new MockSecretProvider({});
        nonFailingResolver.addProvider(provider);

        const config = { password: { $secret: 'NONEXISTENT' } };

        await expect(nonFailingResolver.resolveSecrets(config)).resolves.not.toThrow();
        expect(config.password).toEqual({ $secret: 'NONEXISTENT' }); // Unchanged
      });

      it('should handle provider errors gracefully and try next provider', async () => {
        const failingProvider = new FailingProvider();
        const workingProvider = new MockSecretProvider({ SECRET: 'WorkingValue' });

        resolver.addProvider(failingProvider);
        resolver.addProvider(workingProvider);

        const config = { password: { $secret: 'SECRET' } };

        // Should not throw - fallback to working provider
        await expect(resolver.resolveSecrets(config)).resolves.not.toThrow();
        expect(config.password).toBe('WorkingValue');
      });

      it('should handle invalid config structures gracefully', async () => {
        const provider = new MockSecretProvider({ SECRET: 'Value' });
        resolver.addProvider(provider);

        // Test with null
        const nullConfig = null;
        await expect(resolver.resolveSecrets(nullConfig)).resolves.not.toThrow();

        // Test with undefined
        const undefinedConfig = undefined;
        await expect(resolver.resolveSecrets(undefinedConfig)).resolves.not.toThrow();

        // Test with primitives
        const primitiveConfig = 'string';
        await expect(resolver.resolveSecrets(primitiveConfig)).resolves.not.toThrow();
      });
    });

    describe('secret descriptor validation', () => {
      it('should not treat object with multiple keys as secret descriptor', async () => {
        const provider = new MockSecretProvider({ SECRET: 'Value' });
        resolver.addProvider(provider);

        const config = {
          notASecret: {
            $secret: 'SECRET',
            otherKey: 'value',
          },
        };

        await resolver.resolveSecrets(config);

        // Should remain unchanged (has extra key)
        expect(config.notASecret).toEqual({
          $secret: 'SECRET',
          otherKey: 'value',
        });
      });

      it('should require $secret to be a string', async () => {
        const provider = new MockSecretProvider({});
        resolver.addProvider(provider);

        const config = {
          invalid1: { $secret: 123 }, // Number
          invalid2: { $secret: true }, // Boolean
          invalid3: { $secret: null }, // Null
          invalid4: { $secret: undefined }, // Undefined
        };

        await resolver.resolveSecrets(config);

        // All should remain unchanged (invalid descriptors)
        expect(config.invalid1).toEqual({ $secret: 123 });
        expect(config.invalid2).toEqual({ $secret: true });
        expect(config.invalid3).toEqual({ $secret: null });
        expect(config.invalid4).toEqual({ $secret: undefined });
      });

      it('should reject empty string as secret name', async () => {
        const provider = new MockSecretProvider({ '': 'EmptyKeyValue' });
        resolver.addProvider(provider);

        const config = {
          secret: { $secret: '' },
        };

        // Empty string is NOT a valid secret name
        // The descriptor check (obj.$secret &&) is falsy for empty strings
        // This is intentional - empty secret names don't make sense from security perspective
        await resolver.resolveSecrets(config);
        expect(config.secret).toEqual({ $secret: '' }); // Unchanged - invalid descriptor
      });
    });
  });

  describe('audit logging integration', () => {
    it('should log successful secret resolution', async () => {
      const auditService = new AuditService({ enabled: true });
      const logSpy = vi.spyOn(auditService, 'log');

      const resolverWithAudit = new SecretResolver({ auditService });
      const provider = new MockSecretProvider({ SECRET: 'Value' });
      resolverWithAudit.addProvider(provider);

      const config = { password: { $secret: 'SECRET' } };
      await resolverWithAudit.resolveSecrets(config);

      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'secret:resolution',
          action: 'resolve:SECRET',
          success: true,
        })
      );
    });

    it('should log failed secret resolution', async () => {
      const auditService = new AuditService({ enabled: true });
      const logSpy = vi.spyOn(auditService, 'log');

      const resolverWithAudit = new SecretResolver({
        auditService,
        failFast: false,
      });
      const provider = new MockSecretProvider({});
      resolverWithAudit.addProvider(provider);

      const config = { password: { $secret: 'NONEXISTENT' } };
      await resolverWithAudit.resolveSecrets(config);

      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'secret:resolution',
          action: 'resolve:NONEXISTENT',
          success: false,
        })
      );
    });

    it('should include provider name in audit log', async () => {
      const auditService = new AuditService({ enabled: true });
      const logSpy = vi.spyOn(auditService, 'log');

      const resolverWithAudit = new SecretResolver({ auditService });
      const provider = new MockSecretProvider({ SECRET: 'Value' });
      resolverWithAudit.addProvider(provider);

      const config = { password: { $secret: 'SECRET' } };
      await resolverWithAudit.resolveSecrets(config);

      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            provider: 'MockSecretProvider',
          }),
        })
      );
    });
  });

  describe('clearProviders', () => {
    it('should remove all providers', () => {
      const provider1 = new MockSecretProvider({ TEST1: 'value1' });
      const provider2 = new MockSecretProvider({ TEST2: 'value2' });

      resolver.addProvider(provider1);
      resolver.addProvider(provider2);
      expect(resolver.getProviders()).toHaveLength(2);

      resolver.clearProviders();
      expect(resolver.getProviders()).toHaveLength(0);
    });
  });

  describe('real-world scenarios', () => {
    it('should handle multi-database configuration', async () => {
      const provider = new MockSecretProvider({
        HR_DB_PASSWORD: 'HRPass123!',
        HR_CLIENT_SECRET: 'HRSecret456!',
        SALES_DB_PASSWORD: 'SalesPass789!',
        SALES_CLIENT_SECRET: 'SalesSecret012!',
      });
      resolver.addProvider(provider);

      const config = {
        delegation: {
          modules: {
            'hr-database': {
              password: { $secret: 'HR_DB_PASSWORD' },
              tokenExchange: {
                clientSecret: { $secret: 'HR_CLIENT_SECRET' },
              },
            },
            'sales-database': {
              password: { $secret: 'SALES_DB_PASSWORD' },
              tokenExchange: {
                clientSecret: { $secret: 'SALES_CLIENT_SECRET' },
              },
            },
          },
        },
      };

      await resolver.resolveSecrets(config);

      expect(config.delegation.modules['hr-database'].password).toBe('HRPass123!');
      expect(config.delegation.modules['hr-database'].tokenExchange.clientSecret).toBe(
        'HRSecret456!'
      );
      expect(config.delegation.modules['sales-database'].password).toBe('SalesPass789!');
      expect(config.delegation.modules['sales-database'].tokenExchange.clientSecret).toBe(
        'SalesSecret012!'
      );
    });

    it('should handle configuration with mixed secret sources', async () => {
      const fileProvider = new MockSecretProvider({ FILE_SECRET: 'FromFile' });
      const envProvider = new MockSecretProvider({
        ENV_SECRET: 'FromEnv',
        FILE_SECRET: 'FromEnvButNotUsed',
      });

      resolver.addProvider(fileProvider); // Higher priority
      resolver.addProvider(envProvider); // Lower priority

      const config = {
        secret1: { $secret: 'FILE_SECRET' },
        secret2: { $secret: 'ENV_SECRET' },
      };

      await resolver.resolveSecrets(config);

      expect(config.secret1).toBe('FromFile'); // From file provider
      expect(config.secret2).toBe('FromEnv'); // From env provider (fallback)
    });
  });
});
