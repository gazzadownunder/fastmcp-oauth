/**
 * RoleMapper Tests
 *
 * Tests for Phase 1.5: Role Mapper with Failure Policy
 *
 * @see Docs/refactor-progress.md Phase 1.5
 */

import { describe, it, expect } from 'vitest';
import { RoleMapper } from '../../../src/core/role-mapper.js';
import { UNASSIGNED_ROLE, ROLE_ADMIN, ROLE_USER, ROLE_GUEST } from '../../../src/core/types.js';

describe('RoleMapper', () => {
  describe('CRITICAL: Never Throws Policy', () => {
    it('should NEVER throw on any input', () => {
      const mapper = new RoleMapper();

      // These should all return results, never throw
      expect(() => mapper.determineRoles(null as any)).not.toThrow();
      expect(() => mapper.determineRoles(undefined as any)).not.toThrow();
      expect(() => mapper.determineRoles('invalid' as any)).not.toThrow();
      expect(() => mapper.determineRoles(123 as any)).not.toThrow();
      expect(() => mapper.determineRoles({} as any)).not.toThrow();
    });

    it('should return UNASSIGNED_ROLE on invalid input', () => {
      const mapper = new RoleMapper();

      const result = mapper.determineRoles(null as any);

      expect(result.primaryRole).toBe(UNASSIGNED_ROLE);
      expect(result.mappingFailed).toBe(true);
      expect(result.failureReason).toContain('must be an array');
    });

    it('should return UNASSIGNED_ROLE with failure reason on error', () => {
      const mapper = new RoleMapper();

      const result = mapper.determineRoles('not-an-array' as any);

      expect(result).toMatchObject({
        primaryRole: UNASSIGNED_ROLE,
        customRoles: [],
        mappingFailed: true,
      });
      expect(result.failureReason).toBeDefined();
    });
  });

  describe('Default Configuration', () => {
    it('should use default role mappings when no config provided', () => {
      const mapper = new RoleMapper();
      const config = mapper.getConfig();

      expect(config.adminRoles).toEqual(['admin', 'administrator']);
      expect(config.userRoles).toEqual(['user']);
      expect(config.guestRoles).toEqual([]);
      expect(config.defaultRole).toBe(ROLE_GUEST);
    });

    it('should map admin roles correctly', () => {
      const mapper = new RoleMapper();

      const result = mapper.determineRoles(['admin']);

      expect(result.primaryRole).toBe(ROLE_ADMIN);
      expect(result.mappingFailed).toBe(false);
    });

    it('should map user roles correctly', () => {
      const mapper = new RoleMapper();

      const result = mapper.determineRoles(['user']);

      expect(result.primaryRole).toBe(ROLE_USER);
      expect(result.mappingFailed).toBe(false);
    });

    it('should return default role when no matches', () => {
      const mapper = new RoleMapper();

      const result = mapper.determineRoles(['unknown-role']);

      expect(result.primaryRole).toBe(ROLE_GUEST);
      expect(result.mappingFailed).toBe(false);
    });
  });

  describe('Priority-Based Role Assignment', () => {
    it('should prioritize admin over user', () => {
      const mapper = new RoleMapper();

      const result = mapper.determineRoles(['user', 'admin']);

      expect(result.primaryRole).toBe(ROLE_ADMIN);
    });

    it('should prioritize user over guest', () => {
      const mapper = new RoleMapper({
        guestRoles: ['guest'],
      });

      const result = mapper.determineRoles(['guest', 'user']);

      expect(result.primaryRole).toBe(ROLE_USER);
    });

    it('should follow priority order: admin > user > guest', () => {
      const mapper = new RoleMapper({
        guestRoles: ['guest'],
      });

      const result = mapper.determineRoles(['guest', 'user', 'admin']);

      expect(result.primaryRole).toBe(ROLE_ADMIN);
    });
  });

  describe('Custom Role Mappings', () => {
    it('should support custom role mappings', () => {
      const mapper = new RoleMapper({
        customRoles: {
          analyst: ['data_analyst', 'business_analyst'],
        },
      });

      const result = mapper.determineRoles(['data_analyst']);

      expect(result.primaryRole).toBe('analyst');
      expect(result.mappingFailed).toBe(false);
    });

    it('should prioritize standard roles over custom roles', () => {
      const mapper = new RoleMapper({
        customRoles: {
          analyst: ['data_analyst'],
        },
      });

      const result = mapper.determineRoles(['data_analyst', 'admin']);

      expect(result.primaryRole).toBe(ROLE_ADMIN);
    });

    it('should include custom roles in customRoles array', () => {
      const mapper = new RoleMapper({
        customRoles: {
          analyst: ['data_analyst'],
          developer: ['dev'],
        },
      });

      const result = mapper.determineRoles(['admin', 'data_analyst', 'dev']);

      expect(result.primaryRole).toBe(ROLE_ADMIN);
      expect(result.customRoles).toContain('analyst');
      expect(result.customRoles).toContain('developer');
    });

    it('should not duplicate primary role in customRoles', () => {
      const mapper = new RoleMapper({
        customRoles: {
          analyst: ['data_analyst'],
        },
      });

      const result = mapper.determineRoles(['data_analyst']);

      expect(result.primaryRole).toBe('analyst');
      expect(result.customRoles).not.toContain('analyst');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty roles array', () => {
      const mapper = new RoleMapper();

      const result = mapper.determineRoles([]);

      expect(result.primaryRole).toBe(ROLE_GUEST);
      expect(result.mappingFailed).toBe(false);
    });

    it('should filter out null/undefined values', () => {
      const mapper = new RoleMapper();

      const result = mapper.determineRoles([null as any, 'admin', undefined as any]);

      expect(result.primaryRole).toBe(ROLE_ADMIN);
      expect(result.mappingFailed).toBe(false);
    });

    it('should filter out empty strings', () => {
      const mapper = new RoleMapper();

      const result = mapper.determineRoles(['', 'admin', '']);

      expect(result.primaryRole).toBe(ROLE_ADMIN);
    });

    it('should handle roles with special characters', () => {
      const mapper = new RoleMapper({
        customRoles: {
          'special-role': ['role:with:colons', 'role/with/slashes'],
        },
      });

      const result = mapper.determineRoles(['role:with:colons']);

      expect(result.primaryRole).toBe('special-role');
    });
  });

  describe('Configuration Updates', () => {
    it('should allow configuration updates', () => {
      const mapper = new RoleMapper();

      mapper.updateConfig({
        adminRoles: ['superadmin', 'admin'],
      });

      const result = mapper.determineRoles(['superadmin']);
      expect(result.primaryRole).toBe(ROLE_ADMIN);
    });

    it('should merge configuration updates', () => {
      const mapper = new RoleMapper({
        adminRoles: ['admin'],
        userRoles: ['user'],
      });

      mapper.updateConfig({
        customRoles: { analyst: ['data_analyst'] },
      });

      const config = mapper.getConfig();
      expect(config.adminRoles).toEqual(['admin']);
      expect(config.customRoles).toEqual({ analyst: ['data_analyst'] });
    });
  });

  describe('Default Role Behavior', () => {
    it('should use custom default role when configured', () => {
      const mapper = new RoleMapper({
        defaultRole: 'anonymous',
      });

      const result = mapper.determineRoles(['unknown']);

      expect(result.primaryRole).toBe('anonymous');
    });

    it('should use ROLE_GUEST as default when not configured', () => {
      const mapper = new RoleMapper();

      const result = mapper.determineRoles(['unknown']);

      expect(result.primaryRole).toBe(ROLE_GUEST);
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle multiple custom roles correctly', () => {
      const mapper = new RoleMapper({
        customRoles: {
          analyst: ['data_analyst', 'business_analyst'],
          developer: ['frontend_dev', 'backend_dev'],
          designer: ['ui_designer', 'ux_designer'],
        },
      });

      const result = mapper.determineRoles([
        'data_analyst',
        'frontend_dev',
        'ui_designer',
      ]);

      // First custom role wins as primary
      expect(result.primaryRole).toBe('analyst');
      expect(result.customRoles).toContain('developer');
      expect(result.customRoles).toContain('designer');
    });

    it('should handle case-sensitive role names', () => {
      const mapper = new RoleMapper({
        adminRoles: ['Admin'],
      });

      const result1 = mapper.determineRoles(['Admin']);
      const result2 = mapper.determineRoles(['admin']);

      expect(result1.primaryRole).toBe(ROLE_ADMIN);
      expect(result2.primaryRole).toBe(ROLE_GUEST); // Case mismatch
    });
  });

  describe('Validation Results', () => {
    it('should set mappingFailed to false on success', () => {
      const mapper = new RoleMapper();

      const result = mapper.determineRoles(['admin']);

      expect(result.mappingFailed).toBe(false);
      expect(result.failureReason).toBeUndefined();
    });

    it('should set mappingFailed to true on error', () => {
      const mapper = new RoleMapper();

      const result = mapper.determineRoles(null as any);

      expect(result.mappingFailed).toBe(true);
      expect(result.failureReason).toBeDefined();
    });

    it('should include failure reason when mapping fails', () => {
      const mapper = new RoleMapper();

      const result = mapper.determineRoles('invalid' as any);

      expect(result.failureReason).toContain('array');
    });
  });
});
