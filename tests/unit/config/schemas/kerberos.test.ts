/**
 * Kerberos Configuration Schema Tests
 *
 * Tests for Kerberos delegation configuration validation
 */

import { describe, it, expect } from 'vitest';
import {
  KerberosServiceAccountSchema,
  KerberosTicketCacheSchema,
  KerberosConfigSchema,
  validateKerberosConfig,
  createDefaultKerberosConfig,
  type KerberosConfig,
} from '../../../../src/config/schemas/kerberos.js';

describe('KerberosServiceAccountSchema', () => {
  describe('Valid Configurations', () => {
    it('should validate service account with password', () => {
      const config = {
        username: 'svc-mcp-server',
        password: 'SecurePassword123!',
      };

      const result = KerberosServiceAccountSchema.parse(config);

      expect(result.username).toBe('svc-mcp-server');
      expect(result.password).toBe('SecurePassword123!');
    });

    it('should validate service account with keytab', () => {
      const config = {
        username: 'svc-mcp-server',
        keytabPath: '/etc/keytabs/svc-mcp-server.keytab',
      };

      const result = KerberosServiceAccountSchema.parse(config);

      expect(result.username).toBe('svc-mcp-server');
      expect(result.keytabPath).toBe('/etc/keytabs/svc-mcp-server.keytab');
    });

    it('should validate service account with both password and keytab', () => {
      const config = {
        username: 'svc-mcp-server',
        password: 'SecurePassword123!',
        keytabPath: '/etc/keytabs/svc-mcp-server.keytab',
      };

      const result = KerberosServiceAccountSchema.parse(config);

      expect(result.username).toBe('svc-mcp-server');
      expect(result.password).toBe('SecurePassword123!');
      expect(result.keytabPath).toBe('/etc/keytabs/svc-mcp-server.keytab');
    });
  });

  describe('Invalid Configurations', () => {
    it('should reject service account with empty username', () => {
      const config = {
        username: '',
        password: 'SecurePassword123!',
      };

      expect(() => KerberosServiceAccountSchema.parse(config)).toThrow();
    });

    it('should reject service account without password or keytab', () => {
      const config = {
        username: 'svc-mcp-server',
      };

      expect(() => KerberosServiceAccountSchema.parse(config)).toThrow(
        'Either password or keytabPath must be provided'
      );
    });

    it('should reject service account with missing username', () => {
      const config = {
        password: 'SecurePassword123!',
      };

      expect(() => KerberosServiceAccountSchema.parse(config)).toThrow();
    });
  });
});

describe('KerberosTicketCacheSchema', () => {
  describe('Valid Configurations', () => {
    it('should validate ticket cache with default values', () => {
      const config = {};

      const result = KerberosTicketCacheSchema.parse(config);

      expect(result.enabled).toBe(true);
      expect(result.ttlSeconds).toBe(3600);
      expect(result.renewThresholdSeconds).toBe(300);
      expect(result.maxEntriesPerSession).toBe(10);
      expect(result.sessionTimeoutMs).toBe(900000);
    });

    it('should validate ticket cache with custom values', () => {
      const config = {
        enabled: false,
        ttlSeconds: 7200,
        renewThresholdSeconds: 600,
        maxEntriesPerSession: 20,
        sessionTimeoutMs: 1800000,
      };

      const result = KerberosTicketCacheSchema.parse(config);

      expect(result.enabled).toBe(false);
      expect(result.ttlSeconds).toBe(7200);
      expect(result.renewThresholdSeconds).toBe(600);
      expect(result.maxEntriesPerSession).toBe(20);
      expect(result.sessionTimeoutMs).toBe(1800000);
    });

    it('should validate with minimum allowed values', () => {
      const config = {
        ttlSeconds: 60,
        renewThresholdSeconds: 30,
        maxEntriesPerSession: 1,
        sessionTimeoutMs: 60000,
      };

      const result = KerberosTicketCacheSchema.parse(config);

      expect(result.ttlSeconds).toBe(60);
      expect(result.renewThresholdSeconds).toBe(30);
      expect(result.maxEntriesPerSession).toBe(1);
      expect(result.sessionTimeoutMs).toBe(60000);
    });

    it('should validate with maximum allowed values', () => {
      const config = {
        ttlSeconds: 86400,
        renewThresholdSeconds: 3600,
        maxEntriesPerSession: 100,
        sessionTimeoutMs: 3600000,
      };

      const result = KerberosTicketCacheSchema.parse(config);

      expect(result.ttlSeconds).toBe(86400);
      expect(result.renewThresholdSeconds).toBe(3600);
      expect(result.maxEntriesPerSession).toBe(100);
      expect(result.sessionTimeoutMs).toBe(3600000);
    });
  });

  describe('Invalid Configurations', () => {
    it('should reject ttlSeconds below minimum', () => {
      const config = {
        ttlSeconds: 30, // Below min of 60
      };

      expect(() => KerberosTicketCacheSchema.parse(config)).toThrow();
    });

    it('should reject ttlSeconds above maximum', () => {
      const config = {
        ttlSeconds: 90000, // Above max of 86400
      };

      expect(() => KerberosTicketCacheSchema.parse(config)).toThrow();
    });

    it('should reject renewThresholdSeconds below minimum', () => {
      const config = {
        renewThresholdSeconds: 20, // Below min of 30
      };

      expect(() => KerberosTicketCacheSchema.parse(config)).toThrow();
    });

    it('should reject maxEntriesPerSession below minimum', () => {
      const config = {
        maxEntriesPerSession: 0, // Below min of 1
      };

      expect(() => KerberosTicketCacheSchema.parse(config)).toThrow();
    });

    it('should reject sessionTimeoutMs below minimum', () => {
      const config = {
        sessionTimeoutMs: 30000, // Below min of 60000
      };

      expect(() => KerberosTicketCacheSchema.parse(config)).toThrow();
    });
  });
});

describe('KerberosConfigSchema', () => {
  describe('Valid Configurations', () => {
    it('should validate complete Kerberos configuration', () => {
      const config = {
        enabled: true,
        domainController: 'dc.company.com',
        servicePrincipalName: 'HTTP/mcp-server.company.com',
        realm: 'COMPANY.COM',
        enableS4U2Self: true,
        enableS4U2Proxy: true,
        allowedDelegationTargets: ['MSSQLSvc/sql01.company.com:1433'],
        serviceAccount: {
          username: 'svc-mcp-server',
          password: 'SecurePassword123!',
        },
        ticketCache: {
          enabled: true,
          ttlSeconds: 3600,
        },
      };

      const result = KerberosConfigSchema.parse(config);

      expect(result.enabled).toBe(true);
      expect(result.domainController).toBe('dc.company.com');
      expect(result.servicePrincipalName).toBe('HTTP/mcp-server.company.com');
      expect(result.realm).toBe('COMPANY.COM');
      expect(result.enableS4U2Self).toBe(true);
      expect(result.enableS4U2Proxy).toBe(true);
      expect(result.allowedDelegationTargets).toEqual(['MSSQLSvc/sql01.company.com:1433']);
    });

    it('should convert realm to uppercase', () => {
      const config = {
        enabled: true,
        domainController: 'dc.company.com',
        servicePrincipalName: 'HTTP/mcp-server.company.com',
        realm: 'company.com', // Lowercase
        serviceAccount: {
          username: 'svc-mcp-server',
          password: 'SecurePassword123!',
        },
      };

      const result = KerberosConfigSchema.parse(config);

      expect(result.realm).toBe('COMPANY.COM'); // Converted to uppercase
    });

    it('should apply default values for optional fields', () => {
      const config = {
        domainController: 'dc.company.com',
        servicePrincipalName: 'HTTP/mcp-server.company.com',
        realm: 'COMPANY.COM',
        serviceAccount: {
          username: 'svc-mcp-server',
          password: 'SecurePassword123!',
        },
      };

      const result = KerberosConfigSchema.parse(config);

      expect(result.enabled).toBe(false); // Default
      expect(result.enableS4U2Self).toBe(true); // Default
      expect(result.enableS4U2Proxy).toBe(true); // Default
      expect(result.allowedDelegationTargets).toEqual([]); // Default
    });

    it('should validate with optional KDC address', () => {
      const config = {
        enabled: true,
        domainController: 'dc.company.com',
        servicePrincipalName: 'HTTP/mcp-server.company.com',
        realm: 'COMPANY.COM',
        kdc: 'dc.company.com:88',
        serviceAccount: {
          username: 'svc-mcp-server',
          password: 'SecurePassword123!',
        },
      };

      const result = KerberosConfigSchema.parse(config);

      expect(result.kdc).toBe('dc.company.com:88');
    });

    it('should validate with empty allowedDelegationTargets', () => {
      const config = {
        domainController: 'dc.company.com',
        servicePrincipalName: 'HTTP/mcp-server.company.com',
        realm: 'COMPANY.COM',
        allowedDelegationTargets: [],
        serviceAccount: {
          username: 'svc-mcp-server',
          password: 'SecurePassword123!',
        },
      };

      const result = KerberosConfigSchema.parse(config);

      expect(result.allowedDelegationTargets).toEqual([]);
    });

    it('should validate with multiple delegation targets', () => {
      const config = {
        domainController: 'dc.company.com',
        servicePrincipalName: 'HTTP/mcp-server.company.com',
        realm: 'COMPANY.COM',
        allowedDelegationTargets: [
          'MSSQLSvc/sql01.company.com:1433',
          'HTTP/api.company.com',
          'cifs/fileserver.company.com',
        ],
        serviceAccount: {
          username: 'svc-mcp-server',
          password: 'SecurePassword123!',
        },
      };

      const result = KerberosConfigSchema.parse(config);

      expect(result.allowedDelegationTargets).toHaveLength(3);
    });
  });

  describe('Invalid Configurations', () => {
    it('should reject configuration with empty domainController', () => {
      const config = {
        domainController: '',
        servicePrincipalName: 'HTTP/mcp-server.company.com',
        realm: 'COMPANY.COM',
        serviceAccount: {
          username: 'svc-mcp-server',
          password: 'SecurePassword123!',
        },
      };

      expect(() => KerberosConfigSchema.parse(config)).toThrow();
    });

    it('should reject configuration with empty servicePrincipalName', () => {
      const config = {
        domainController: 'dc.company.com',
        servicePrincipalName: '',
        realm: 'COMPANY.COM',
        serviceAccount: {
          username: 'svc-mcp-server',
          password: 'SecurePassword123!',
        },
      };

      expect(() => KerberosConfigSchema.parse(config)).toThrow();
    });

    it('should reject configuration with empty realm', () => {
      const config = {
        domainController: 'dc.company.com',
        servicePrincipalName: 'HTTP/mcp-server.company.com',
        realm: '',
        serviceAccount: {
          username: 'svc-mcp-server',
          password: 'SecurePassword123!',
        },
      };

      expect(() => KerberosConfigSchema.parse(config)).toThrow();
    });

    it('should reject configuration with invalid service account', () => {
      const config = {
        domainController: 'dc.company.com',
        servicePrincipalName: 'HTTP/mcp-server.company.com',
        realm: 'COMPANY.COM',
        serviceAccount: {
          username: 'svc-mcp-server',
          // Missing password or keytab
        },
      };

      expect(() => KerberosConfigSchema.parse(config)).toThrow();
    });

    it('should reject configuration with missing required fields', () => {
      const config = {
        enabled: true,
        // Missing domainController, servicePrincipalName, realm, serviceAccount
      };

      expect(() => KerberosConfigSchema.parse(config)).toThrow();
    });
  });
});

describe('validateKerberosConfig', () => {
  it('should validate valid configuration', () => {
    const config = {
      domainController: 'dc.company.com',
      servicePrincipalName: 'HTTP/mcp-server.company.com',
      realm: 'COMPANY.COM',
      serviceAccount: {
        username: 'svc-mcp-server',
        password: 'SecurePassword123!',
      },
    };

    const result = validateKerberosConfig(config);

    expect(result).toBeDefined();
    expect(result.domainController).toBe('dc.company.com');
  });

  it('should throw on invalid configuration', () => {
    const config = {
      domainController: '', // Invalid
      servicePrincipalName: 'HTTP/mcp-server.company.com',
      realm: 'COMPANY.COM',
      serviceAccount: {
        username: 'svc-mcp-server',
        password: 'SecurePassword123!',
      },
    };

    expect(() => validateKerberosConfig(config)).toThrow();
  });

  it('should throw on malformed configuration', () => {
    const config = 'not-an-object';

    expect(() => validateKerberosConfig(config)).toThrow();
  });
});

describe('createDefaultKerberosConfig', () => {
  it('should create default configuration with disabled state', () => {
    const result = createDefaultKerberosConfig();

    expect(result.enabled).toBe(false);
    expect(result.domainController).toBe('');
    expect(result.servicePrincipalName).toBe('');
    expect(result.realm).toBe('');
    expect(result.enableS4U2Self).toBe(true);
    expect(result.enableS4U2Proxy).toBe(true);
    expect(result.allowedDelegationTargets).toEqual([]);
    expect(result.serviceAccount.username).toBe('');
  });

  it('should create configuration without password or keytab', () => {
    const result = createDefaultKerberosConfig();

    expect(result.serviceAccount.password).toBeUndefined();
    expect(result.serviceAccount.keytabPath).toBeUndefined();
  });

  it('should create configuration that passes validation when completed', () => {
    const result = createDefaultKerberosConfig();

    // Complete the configuration
    result.domainController = 'dc.company.com';
    result.servicePrincipalName = 'HTTP/mcp-server.company.com';
    result.realm = 'COMPANY.COM';
    result.serviceAccount.username = 'svc-mcp-server'; // Need non-empty username
    result.serviceAccount.password = 'SecurePassword123!';

    // Should validate successfully
    const validated = validateKerberosConfig(result);
    expect(validated).toBeDefined();
  });
});
