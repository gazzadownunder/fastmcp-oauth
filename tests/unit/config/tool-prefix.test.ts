/**
 * Tool Prefix Configuration Tests
 *
 * Tests for Option C implementation (Global Default + Per-Module Override)
 * Validates schema validation and auto-registration behavior.
 *
 * Test Coverage:
 * - defaultToolPrefix validation (global setting)
 * - toolPrefix validation (per-module override)
 * - Regex validation (lowercase, hyphens, max length)
 * - Default value behavior
 * - Migration compatibility
 */

import { describe, it, expect } from 'vitest';
import {
  DelegationConfigSchema,
  PostgreSQLConfigSchema,
  SQLConfigSchema,
  KerberosConfigSchema,
} from '../../../src/config/schemas/delegation.js';

describe('Tool Prefix Configuration', () => {
  describe('DelegationConfigSchema - defaultToolPrefix', () => {
    it('should accept valid defaultToolPrefix', () => {
      const config = {
        defaultToolPrefix: 'sql',
        modules: {},
      };

      const result = DelegationConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.defaultToolPrefix).toBe('sql');
      }
    });

    it('should use default value "sql" when not specified', () => {
      const config = {
        modules: {},
      };

      const result = DelegationConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.defaultToolPrefix).toBe('sql');
      }
    });

    it('should accept lowercase letters only', () => {
      const validPrefixes = ['sql', 'db', 'postgres', 'api', 'data'];

      for (const prefix of validPrefixes) {
        const config = {
          defaultToolPrefix: prefix,
          modules: {},
        };

        const result = DelegationConfigSchema.safeParse(config);
        expect(result.success).toBe(true);
      }
    });

    it('should accept lowercase letters with numbers', () => {
      const validPrefixes = ['sql1', 'db2', 'api3', 'postgres9'];

      for (const prefix of validPrefixes) {
        const config = {
          defaultToolPrefix: prefix,
          modules: {},
        };

        const result = DelegationConfigSchema.safeParse(config);
        expect(result.success).toBe(true);
      }
    });

    it('should accept lowercase letters with hyphens', () => {
      const validPrefixes = ['hr-sql', 'sales-db', 'internal-api', 'legacy-erp'];

      for (const prefix of validPrefixes) {
        const config = {
          defaultToolPrefix: prefix,
          modules: {},
        };

        const result = DelegationConfigSchema.safeParse(config);
        expect(result.success).toBe(true);
      }
    });

    it('should reject uppercase letters', () => {
      const invalidPrefixes = ['SQL', 'Sql', 'DATABASE', 'Api'];

      for (const prefix of invalidPrefixes) {
        const config = {
          defaultToolPrefix: prefix,
          modules: {},
        };

        const result = DelegationConfigSchema.safeParse(config);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toContain('lowercase');
        }
      }
    });

    it('should reject prefixes starting with numbers', () => {
      const invalidPrefixes = ['1sql', '2db', '9api'];

      for (const prefix of invalidPrefixes) {
        const config = {
          defaultToolPrefix: prefix,
          modules: {},
        };

        const result = DelegationConfigSchema.safeParse(config);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toContain('lowercase letter');
        }
      }
    });

    it('should reject prefixes starting with hyphens', () => {
      const invalidPrefixes = ['-sql', '-db', '-api'];

      for (const prefix of invalidPrefixes) {
        const config = {
          defaultToolPrefix: prefix,
          modules: {},
        };

        const result = DelegationConfigSchema.safeParse(config);
        expect(result.success).toBe(false);
      }
    });

    it('should reject special characters (except hyphens)', () => {
      const invalidPrefixes = ['sql_db', 'api.v1', 'data@base', 'my#sql', 'db$1'];

      for (const prefix of invalidPrefixes) {
        const config = {
          defaultToolPrefix: prefix,
          modules: {},
        };

        const result = DelegationConfigSchema.safeParse(config);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toContain('lowercase');
        }
      }
    });

    it('should reject prefixes longer than 20 characters', () => {
      const config = {
        defaultToolPrefix: 'this-is-a-very-long-prefix-name', // 32 chars
        modules: {},
      };

      const result = DelegationConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.path.includes('defaultToolPrefix'))).toBe(
          true
        );
      }
    });

    it('should reject empty string', () => {
      const config = {
        defaultToolPrefix: '',
        modules: {},
      };

      const result = DelegationConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });

  describe('PostgreSQLConfigSchema - toolPrefix', () => {
    it('should accept valid toolPrefix', () => {
      const config = {
        toolPrefix: 'hr-sql',
        host: 'localhost',
        database: 'hr_database',
        user: 'service_account',
        password: 'password',
      };

      const result = PostgreSQLConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.toolPrefix).toBe('hr-sql');
      }
    });

    it('should allow toolPrefix to be omitted', () => {
      const config = {
        host: 'localhost',
        database: 'test_database',
        user: 'service_account',
        password: 'password',
      };

      const result = PostgreSQLConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.toolPrefix).toBeUndefined();
      }
    });

    it('should reject invalid toolPrefix format', () => {
      const invalidPrefixes = ['SQL', '1sql', 'sql_db', 'api.v1', '-prefix'];

      for (const prefix of invalidPrefixes) {
        const config = {
          toolPrefix: prefix,
          host: 'localhost',
          database: 'test_database',
          user: 'service_account',
          password: 'password',
        };

        const result = PostgreSQLConfigSchema.safeParse(config);
        expect(result.success).toBe(false);
      }
    });

    it('should accept complex valid prefixes', () => {
      const validPrefixes = ['hr-sql', 'sales-db2', 'legacy', 'api-v1'];

      for (const prefix of validPrefixes) {
        const config = {
          toolPrefix: prefix,
          host: 'localhost',
          database: 'test_database',
          user: 'service_account',
          password: 'password',
        };

        const result = PostgreSQLConfigSchema.safeParse(config);
        expect(result.success).toBe(true);
      }
    });
  });

  describe('SQLConfigSchema - toolPrefix', () => {
    it('should accept valid toolPrefix for MSSQL', () => {
      const config = {
        toolPrefix: 'legacy',
        server: 'localhost',
        database: 'legacy_erp',
        options: {},
      };

      const result = SQLConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.toolPrefix).toBe('legacy');
      }
    });

    it('should allow toolPrefix to be omitted for MSSQL', () => {
      const config = {
        server: 'localhost',
        database: 'test_database',
        options: {},
      };

      const result = SQLConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.toolPrefix).toBeUndefined();
      }
    });

    it('should reject invalid toolPrefix format for MSSQL', () => {
      const config = {
        toolPrefix: 'LEGACY_ERP', // uppercase and underscore
        server: 'localhost',
        database: 'test_database',
        options: {},
      };

      const result = SQLConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });

  describe('KerberosConfigSchema - toolPrefix', () => {
    it('should accept valid toolPrefix for Kerberos', () => {
      const config = {
        toolPrefix: 'file-browse',
        serviceAccount: 'svc-mcp-server',
        keytabPath: '/etc/keytabs/svc.keytab',
        realm: 'COMPANY.COM',
        kdc: 'dc1.company.com',
      };

      const result = KerberosConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.toolPrefix).toBe('file-browse');
      }
    });

    it('should allow toolPrefix to be omitted for Kerberos', () => {
      const config = {
        serviceAccount: 'svc-mcp-server',
        keytabPath: '/etc/keytabs/svc.keytab',
        realm: 'COMPANY.COM',
        kdc: 'dc1.company.com',
      };

      const result = KerberosConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.toolPrefix).toBeUndefined();
      }
    });
  });

  describe('Multi-Module Configuration', () => {
    it('should accept different toolPrefix values for each module', () => {
      const config = {
        defaultToolPrefix: 'sql',
        modules: {
          postgresql1: {
            toolPrefix: 'hr-sql',
            host: 'localhost',
            database: 'hr_database',
            user: 'service_account',
            password: 'password',
          },
          postgresql2: {
            toolPrefix: 'sales-sql',
            host: 'localhost',
            database: 'sales_database',
            user: 'service_account',
            password: 'password',
          },
          mssql1: {
            toolPrefix: 'legacy',
            server: 'localhost',
            database: 'legacy_erp',
          },
        },
      };

      const result = DelegationConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should accept modules without toolPrefix (manual registration)', () => {
      const config = {
        defaultToolPrefix: 'sql',
        modules: {
          postgresql1: {
            toolPrefix: 'hr-sql',
            host: 'localhost',
            database: 'hr_database',
            user: 'service_account',
            password: 'password',
          },
          postgresql2: {
            // No toolPrefix - manual registration required
            host: 'localhost',
            database: 'sales_database',
            user: 'service_account',
            password: 'password',
          },
        },
      };

      const result = DelegationConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should validate toolPrefix per module', () => {
      // Note: DelegationConfigSchema uses z.record(z.any()) for modules,
      // so it doesn't validate module structure at the top level.
      // Individual module schemas (PostgreSQLConfigSchema, etc.) validate toolPrefix.

      // Test individual module validation instead
      const invalidModuleConfig = {
        toolPrefix: 'SALES_DB', // invalid (uppercase + underscore)
        host: 'localhost',
        database: 'sales_database',
        user: 'service_account',
        password: 'password',
      };

      const result = PostgreSQLConfigSchema.safeParse(invalidModuleConfig);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('lowercase');
      }
    });
  });

  describe('Backward Compatibility', () => {
    it('should accept legacy config without defaultToolPrefix', () => {
      const legacyConfig = {
        modules: {
          sql: {
            host: 'localhost',
            database: 'app_database',
            user: 'service_account',
            password: 'password',
          },
        },
      };

      const result = DelegationConfigSchema.safeParse(legacyConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.defaultToolPrefix).toBe('sql'); // Should use default
      }
    });

    it('should accept legacy config without any toolPrefix fields', () => {
      const legacyConfig = {
        modules: {
          postgresql: {
            host: 'localhost',
            database: 'app_database',
            user: 'service_account',
            password: 'password',
          },
          kerberos: {
            serviceAccount: 'svc-mcp-server',
            keytabPath: '/etc/keytabs/svc.keytab',
            realm: 'COMPANY.COM',
            kdc: 'dc1.company.com',
          },
        },
      };

      const result = DelegationConfigSchema.safeParse(legacyConfig);
      expect(result.success).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should accept single-character prefix', () => {
      const config = {
        defaultToolPrefix: 's',
        modules: {},
      };

      const result = DelegationConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should accept 20-character prefix (max length)', () => {
      const config = {
        defaultToolPrefix: 'a'.repeat(20),
        modules: {},
      };

      const result = DelegationConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should accept prefix with multiple hyphens', () => {
      const config = {
        defaultToolPrefix: 'my-company-hr-sql',
        modules: {},
      };

      const result = DelegationConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should accept prefix with numbers at end', () => {
      const config = {
        defaultToolPrefix: 'sql123',
        modules: {},
      };

      const result = DelegationConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should accept prefix with alternating letters and hyphens', () => {
      const config = {
        defaultToolPrefix: 'a-b-c-d',
        modules: {},
      };

      const result = DelegationConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });
  });
});
