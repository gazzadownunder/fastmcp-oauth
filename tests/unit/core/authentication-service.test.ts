/**
 * AuthenticationService Tests
 *
 * Tests for Phase 1.7: Authentication Service Orchestration
 *
 * @see Docs/refactor-progress.md Phase 1.7
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthenticationService } from '../../../src/core/authentication-service.js';
import type { AuthConfig } from '../../../src/core/authentication-service.js';
import { AuditService } from '../../../src/core/audit-service.js';
import { UNASSIGNED_ROLE, ROLE_ADMIN, ROLE_USER } from '../../../src/core/types.js';

describe('AuthenticationService', () => {
  // Mock configuration
  const mockConfig: AuthConfig = {
    idpConfigs: [
      {
        issuer: 'https://auth.test.com',
        jwksUri: 'https://auth.test.com/.well-known/jwks.json',
        audience: 'test-api',
        algorithms: ['RS256'],
        claimMappings: {
          legacyUsername: 'legacy_sam_account',
          roles: 'user_roles',
          scopes: 'scopes',
        },
        security: {
          clockTolerance: 60,
          maxTokenAge: 3600,
          requireNbf: true,
        },
      },
    ],
    roleMappings: {
      adminRoles: ['admin'],
      userRoles: ['user'],
      guestRoles: ['guest'],
    },
  };

  describe('Construction and Initialization', () => {
    it('should create service with configuration', () => {
      const service = new AuthenticationService(mockConfig);

      expect(service).toBeDefined();
      expect(service.getConfig()).toEqual(mockConfig);
    });

    it('should create service with custom audit service', () => {
      const auditService = new AuditService({ enabled: true });
      const service = new AuthenticationService(mockConfig, auditService);

      expect(service).toBeDefined();
    });

    it('should use Null Object Pattern for audit service if not provided', () => {
      const service = new AuthenticationService(mockConfig);

      // Should not throw even though no audit service provided
      expect(service).toBeDefined();
    });
  });

  describe('Configuration Management', () => {
    it('should allow updating role mappings configuration', () => {
      const service = new AuthenticationService(mockConfig);

      service.updateConfig({
        roleMappings: {
          adminRoles: ['superadmin', 'admin'],
        },
      });

      const config = service.getConfig();
      expect(config.roleMappings?.adminRoles).toEqual(['superadmin', 'admin']);
    });

    it('should allow updating permissions configuration', () => {
      const service = new AuthenticationService(mockConfig);

      service.updateConfig({
        permissions: {
          adminPermissions: ['read', 'write', 'delete', 'admin'],
        },
      });

      const config = service.getConfig();
      expect(config.permissions?.adminPermissions).toEqual([
        'read',
        'write',
        'delete',
        'admin',
      ]);
    });
  });

  describe('Authentication Flow (Mocked)', () => {
    it('should orchestrate JWT validation, role mapping, and session creation', async () => {
      const service = new AuthenticationService(mockConfig);

      // Mock JWTValidator
      const mockValidateJWT = vi
        .spyOn(service['jwtValidator'], 'validateJWT')
        .mockResolvedValue({
          payload: {
            sub: 'user123',
            iss: 'https://auth.test.com',
            aud: 'test-api',
            exp: Math.floor(Date.now() / 1000) + 3600,
            preferred_username: 'john.doe',
            legacy_sam_account: 'DOMAIN\\jdoe',
          },
          claims: {
            user_roles: ['admin'],
            scopes: 'read write admin',
          },
        });

      const result = await service.authenticate('mock-token');

      expect(mockValidateJWT).toHaveBeenCalledWith('mock-token', undefined);
      expect(result.session).toBeDefined();
      expect(result.session.role).toBe(ROLE_ADMIN);
      expect(result.rejected).toBe(false);
      expect(result.rejectionReason).toBeUndefined();
    });

    it('should return rejected session for UNASSIGNED_ROLE without throwing', async () => {
      const service = new AuthenticationService(mockConfig);

      // Mock JWTValidator to return invalid roles (boolean)
      // This triggers role mapping error -> UNASSIGNED_ROLE
      vi.spyOn(service['jwtValidator'], 'validateJWT').mockResolvedValue({
        payload: {
          sub: 'user456',
          iss: 'https://auth.test.com',
          aud: 'test-api',
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
        claims: {
          user_roles: false as any, // Invalid type (boolean) -> triggers error
        },
      });

      const result = await service.authenticate('mock-token');

      expect(result.session.role).toBe(UNASSIGNED_ROLE);
      expect(result.rejected).toBe(true);
      expect(result.rejectionReason).toBeDefined();
    });
  });

  describe('CRITICAL: Rejection Policy (GAP #1)', () => {
    it('should NOT throw on UNASSIGNED_ROLE, return rejected=true instead', async () => {
      const service = new AuthenticationService(mockConfig);

      // Mock JWTValidator - invalid roles type triggers UNASSIGNED_ROLE
      vi.spyOn(service['jwtValidator'], 'validateJWT').mockResolvedValue({
        payload: {
          sub: 'user',
          iss: 'https://auth.test.com',
          aud: 'test-api',
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
        claims: {
          user_roles: null as any, // Invalid type -> UNASSIGNED_ROLE
        },
      });

      // Should NOT throw
      const result = await service.authenticate('mock-token');

      expect(result.rejected).toBe(true);
      expect(result.session.role).toBe(UNASSIGNED_ROLE);
      expect(result.session.rejected).toBe(true);
    });

    it('should include rejection reason in result', async () => {
      const service = new AuthenticationService(mockConfig);

      vi.spyOn(service['jwtValidator'], 'validateJWT').mockResolvedValue({
        payload: {
          sub: 'user',
          iss: 'https://auth.test.com',
          aud: 'test-api',
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
        claims: {
          user_roles: null, // Invalid roles
        },
      });

      const result = await service.authenticate('mock-token');

      expect(result.rejected).toBe(true);
      expect(result.rejectionReason).toContain('must be an array');
    });
  });

  describe('CRITICAL: Audit Source Field (GAP #3)', () => {
    it('should include source="auth:service" in audit entry on success', async () => {
      const auditService = new AuditService({ enabled: true });
      const auditSpy = vi.spyOn(auditService, 'log');

      const service = new AuthenticationService(mockConfig, auditService);

      vi.spyOn(service['jwtValidator'], 'validateJWT').mockResolvedValue({
        payload: {
          sub: 'user123',
          iss: 'https://auth.test.com',
          aud: 'test-api',
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
        claims: {
          user_roles: ['admin'],
        },
      });

      const result = await service.authenticate('mock-token');

      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'auth:service', // MANDATORY
          action: 'authenticate',
          success: true,
          userId: 'user123',
        })
      );
      expect(result.auditEntry.source).toBe('auth:service');
    });

    it('should include source="auth:service" in audit entry on rejection', async () => {
      const auditService = new AuditService({ enabled: true });
      const auditSpy = vi.spyOn(auditService, 'log');

      const service = new AuthenticationService(mockConfig, auditService);

      // Invalid roles type triggers UNASSIGNED_ROLE
      vi.spyOn(service['jwtValidator'], 'validateJWT').mockResolvedValue({
        payload: {
          sub: 'user456',
          iss: 'https://auth.test.com',
          aud: 'test-api',
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
        claims: {
          user_roles: 123 as any, // Invalid type -> UNASSIGNED_ROLE
        },
      });

      const result = await service.authenticate('mock-token');

      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'auth:service', // MANDATORY
          action: 'authenticate',
          success: false, // Rejected
        })
      );
      expect(result.auditEntry.source).toBe('auth:service');
    });

    it('should include source="auth:service" in audit entry on error', async () => {
      const auditService = new AuditService({ enabled: true });
      const auditSpy = vi.spyOn(auditService, 'log');

      const service = new AuthenticationService(mockConfig, auditService);

      // Mock JWT validation to throw
      vi.spyOn(service['jwtValidator'], 'validateJWT').mockRejectedValue(
        new Error('Invalid token')
      );

      await expect(service.authenticate('invalid-token')).rejects.toThrow(
        'Invalid token'
      );

      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'auth:service', // MANDATORY
          action: 'authenticate',
          success: false,
          error: 'Invalid token',
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should throw on JWT validation failure', async () => {
      const service = new AuthenticationService(mockConfig);

      // Mock JWT validator to throw
      vi.spyOn(service['jwtValidator'], 'validateJWT').mockRejectedValue(
        new Error('JWT signature invalid')
      );

      await expect(service.authenticate('bad-token')).rejects.toThrow(
        'JWT signature invalid'
      );
    });

    it('should log audit entry before throwing JWT error', async () => {
      const auditService = new AuditService({ enabled: true });
      const auditSpy = vi.spyOn(auditService, 'log');

      const service = new AuthenticationService(mockConfig, auditService);

      vi.spyOn(service['jwtValidator'], 'validateJWT').mockRejectedValue(
        new Error('Token expired')
      );

      await expect(service.authenticate('expired-token')).rejects.toThrow();

      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Token expired',
        })
      );
    });
  });

  describe('Audit Entry Validation', () => {
    it('should return audit entry in successful result', async () => {
      const service = new AuthenticationService(mockConfig);

      vi.spyOn(service['jwtValidator'], 'validateJWT').mockResolvedValue({
        payload: {
          sub: 'user123',
          iss: 'https://auth.test.com',
          aud: 'test-api',
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
        claims: {
          user_roles: ['user'],
        },
      });

      const result = await service.authenticate('mock-token');

      expect(result.auditEntry).toMatchObject({
        source: 'auth:service',
        userId: 'user123',
        action: 'authenticate',
        success: true,
      });
      expect(result.auditEntry.timestamp).toBeInstanceOf(Date);
    });

    it('should include metadata in audit entry', async () => {
      const service = new AuthenticationService(mockConfig);

      vi.spyOn(service['jwtValidator'], 'validateJWT').mockResolvedValue({
        payload: {
          sub: 'user123',
          iss: 'https://auth.test.com',
          aud: 'test-api',
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
        claims: {
          user_roles: ['admin'],
        },
      });

      const result = await service.authenticate('mock-token');

      expect(result.auditEntry.metadata).toMatchObject({
        role: ROLE_ADMIN,
        mappingFailed: false,
      });
    });
  });

  describe('Resource Cleanup', () => {
    it('should clean up resources on destroy', () => {
      const service = new AuthenticationService(mockConfig);
      const destroySpy = vi.spyOn(service['jwtValidator'], 'destroy');

      service.destroy();

      expect(destroySpy).toHaveBeenCalled();
    });
  });

  describe('Role Array Extraction', () => {
    it('should extract roles from string in claims', async () => {
      const service = new AuthenticationService(mockConfig);

      vi.spyOn(service['jwtValidator'], 'validateJWT').mockResolvedValue({
        payload: {
          sub: 'user123',
          iss: 'https://auth.test.com',
          aud: 'test-api',
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
        claims: {
          user_roles: 'admin', // Single role as string
        },
      });

      const result = await service.authenticate('mock-token');

      expect(result.session.role).toBe(ROLE_ADMIN);
    });

    it('should handle array of roles in claims', async () => {
      const service = new AuthenticationService(mockConfig);

      vi.spyOn(service['jwtValidator'], 'validateJWT').mockResolvedValue({
        payload: {
          sub: 'user123',
          iss: 'https://auth.test.com',
          aud: 'test-api',
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
        claims: {
          user_roles: ['user', 'admin'], // Array of roles
        },
      });

      const result = await service.authenticate('mock-token');

      expect(result.session.role).toBe(ROLE_ADMIN); // Admin takes priority
    });

    it('should handle missing roles claim', async () => {
      const service = new AuthenticationService(mockConfig);

      vi.spyOn(service['jwtValidator'], 'validateJWT').mockResolvedValue({
        payload: {
          sub: 'user123',
          iss: 'https://auth.test.com',
          aud: 'test-api',
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
        claims: {
          // No user_roles claim - undefined -> UNASSIGNED_ROLE (not an array)
        },
      });

      const result = await service.authenticate('mock-token');

      // Missing roles claim -> undefined -> not an array -> UNASSIGNED_ROLE
      expect(result.session.role).toBe(UNASSIGNED_ROLE);
      expect(result.rejected).toBe(true); // Missing roles = rejected
    });
  });
});
