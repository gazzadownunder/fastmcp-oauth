/**
 * User Info Tool Tests
 *
 * Tests for the user-info tool implementation.
 */

import { describe, it, expect } from 'vitest';
import { createUserInfoTool } from '../../../../src/mcp/tools/user-info.js';
import type { CoreContext } from '../../../../src/core/index.js';
import type { MCPContext, LLMResponse } from '../../../../src/mcp/types.js';
import { UNASSIGNED_ROLE } from '../../../../src/core/types.js';

describe('user-info Tool', () => {
  const coreContext: CoreContext = {
    authService: {} as any,
    auditService: {} as any,
    delegationRegistry: {} as any,
    configManager: {} as any,
  };

  describe('Tool Metadata', () => {
    it('should have correct name', () => {
      const tool = createUserInfoTool(coreContext);
      expect(tool.name).toBe('user-info');
    });

    it('should have description', () => {
      const tool = createUserInfoTool(coreContext);
      expect(tool.description).toContain('authenticated user session');
    });

    it('should have schema with includeClaims parameter', () => {
      const tool = createUserInfoTool(coreContext);
      expect(tool.schema).toBeDefined();
    });
  });

  describe('canAccess (Visibility Filtering)', () => {
    it('should hide tool from unauthenticated users', () => {
      const tool = createUserInfoTool(coreContext);
      const mcpContext: MCPContext = {
        session: null as any,
      };

      expect(tool.canAccess!(mcpContext)).toBe(false);
    });

    it('should hide tool from rejected sessions', () => {
      const tool = createUserInfoTool(coreContext);
      const mcpContext: MCPContext = {
        session: {
          userId: 'user1',
          username: 'testuser',
          role: UNASSIGNED_ROLE,
          permissions: [],
          _version: 1,
          rejected: true,
          rejectionReason: 'No role assigned',
          claims: {},
        },
      };

      expect(tool.canAccess!(mcpContext)).toBe(false);
    });

    it('should show tool to all authenticated users', () => {
      const tool = createUserInfoTool(coreContext);
      const mcpContext: MCPContext = {
        session: {
          userId: 'user1',
          username: 'user',
          role: 'user',
          permissions: ['sql:query'],
          _version: 1,
          rejected: false,
          claims: {},
        },
      };

      expect(tool.canAccess!(mcpContext)).toBe(true);
    });

    it('should show tool to admin users', () => {
      const tool = createUserInfoTool(coreContext);
      const mcpContext: MCPContext = {
        session: {
          userId: 'admin1',
          username: 'admin',
          role: 'admin',
          permissions: ['*'],
          _version: 1,
          rejected: false,
          claims: {},
        },
      };

      expect(tool.canAccess!(mcpContext)).toBe(true);
    });

    it('should show tool to guest users if authenticated', () => {
      const tool = createUserInfoTool(coreContext);
      const mcpContext: MCPContext = {
        session: {
          userId: 'guest1',
          username: 'guest',
          role: 'guest',
          permissions: [],
          _version: 1,
          rejected: false,
          claims: {},
        },
      };

      expect(tool.canAccess!(mcpContext)).toBe(true);
    });
  });

  describe('Handler Execution', () => {
    const validSession = {
      userId: 'user123',
      username: 'testuser',
      role: 'user',
      permissions: ['sql:query', 'sql:procedure'],
      _version: 1,
      rejected: false,
      claims: {
        iss: 'https://auth.example.com',
        sub: 'user123',
        aud: 'mcp-server',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        jti: 'token-id-12345',
        azp: 'mcp-client',
      },
    };

    it('should return basic user info without claims', async () => {
      const tool = createUserInfoTool(coreContext);
      const mcpContext: MCPContext = { session: validSession };

      const result = (await tool.handler({}, mcpContext)) as LLMResponse;

      expect(result.status).toBe('success');
      expect(result.data).toHaveProperty('userId', 'user123');
      expect(result.data).toHaveProperty('username', 'testuser');
      expect(result.data).toHaveProperty('role', 'user');
      expect(result.data).toHaveProperty('sessionVersion', 1);
      expect(result.data).not.toHaveProperty('claims');
      // Note: scopes and customRoles are optional and only included if present
    });

    it('should include claims when includeClaims=true', async () => {
      const tool = createUserInfoTool(coreContext);
      const mcpContext: MCPContext = { session: validSession };

      const result = (await tool.handler({ includeClaims: true }, mcpContext)) as LLMResponse;

      expect(result.status).toBe('success');
      expect(result.data).toHaveProperty('claims');
      expect(result.data.claims).toHaveProperty('iss', 'https://auth.example.com');
      expect(result.data.claims).toHaveProperty('sub', 'user123');
    });

    it('should sanitize sensitive claims (jti, azp)', async () => {
      const tool = createUserInfoTool(coreContext);
      const mcpContext: MCPContext = { session: validSession };

      const result = (await tool.handler({ includeClaims: true }, mcpContext)) as LLMResponse;

      expect(result.status).toBe('success');
      expect(result.data.claims).not.toHaveProperty('jti');
      expect(result.data.claims).not.toHaveProperty('azp');
    });

    it('should include legacyUsername if present', async () => {
      const tool = createUserInfoTool(coreContext);
      const sessionWithLegacy = {
        ...validSession,
        legacyUsername: 'DOMAIN\\legacy_user',
      };
      const mcpContext: MCPContext = { session: sessionWithLegacy };

      const result = (await tool.handler({}, mcpContext)) as LLMResponse;

      expect(result.status).toBe('success');
      expect(result.data).toHaveProperty('legacyUsername', 'DOMAIN\\legacy_user');
    });

    it('should include customRoles if present', async () => {
      const tool = createUserInfoTool(coreContext);
      const sessionWithCustomRoles = {
        ...validSession,
        customRoles: ['developer', 'analyst'],
      };
      const mcpContext: MCPContext = { session: sessionWithCustomRoles };

      const result = (await tool.handler({}, mcpContext)) as LLMResponse;

      expect(result.status).toBe('success');
      expect(result.data).toHaveProperty('customRoles');
      expect(result.data.customRoles).toEqual(['developer', 'analyst']);
    });

    it('should include scopes if present', async () => {
      const tool = createUserInfoTool(coreContext);
      const sessionWithScopes = {
        ...validSession,
        scopes: ['read', 'write'],
      };
      const mcpContext: MCPContext = { session: sessionWithScopes };

      const result = (await tool.handler({}, mcpContext)) as LLMResponse;

      expect(result.status).toBe('success');
      expect(result.data).toHaveProperty('scopes');
      expect(result.data.scopes).toEqual(['read', 'write']);
    });

    it('should not include empty optional fields', async () => {
      const tool = createUserInfoTool(coreContext);
      const minimalSession = {
        userId: 'user123',
        username: 'testuser',
        role: 'user',
        permissions: ['sql:query'],
        _version: 1,
        rejected: false,
        claims: {},
        customRoles: [], // Empty array
        scopes: [], // Empty array
      };
      const mcpContext: MCPContext = { session: minimalSession };

      const result = (await tool.handler({}, mcpContext)) as LLMResponse;

      expect(result.status).toBe('success');
      expect(result.data).not.toHaveProperty('legacyUsername');
      expect(result.data).not.toHaveProperty('customRoles');
      expect(result.data).not.toHaveProperty('scopes');
    });

    it('should require authentication (hard check)', async () => {
      const tool = createUserInfoTool(coreContext);
      const mcpContext: MCPContext = {
        session: {
          ...validSession,
          rejected: true,
          rejectionReason: 'Test rejection',
        },
      };

      const result = (await tool.handler({}, mcpContext)) as LLMResponse;

      expect(result.status).toBe('failure');
      expect(result.code).toBe('UNAUTHENTICATED');
    });

    it('should use default includeClaims=false when not specified', async () => {
      const tool = createUserInfoTool(coreContext);
      const mcpContext: MCPContext = { session: validSession };

      const result = (await tool.handler({}, mcpContext)) as LLMResponse;

      expect(result.status).toBe('success');
      expect(result.data).not.toHaveProperty('claims');
    });

    it('should handle sessions without claims gracefully', async () => {
      const tool = createUserInfoTool(coreContext);
      const sessionWithoutClaims = {
        ...validSession,
        claims: undefined,
      };
      const mcpContext: MCPContext = { session: sessionWithoutClaims as any };

      const result = (await tool.handler({ includeClaims: true }, mcpContext)) as LLMResponse;

      expect(result.status).toBe('success');
      expect(result.data).not.toHaveProperty('claims');
    });

    it('should return LLMSuccessResponse on success (GAP #5)', async () => {
      const tool = createUserInfoTool(coreContext);
      const mcpContext: MCPContext = { session: validSession };

      const result = (await tool.handler({}, mcpContext)) as LLMResponse;

      expect(result).toHaveProperty('status', 'success');
      expect(result).toHaveProperty('data');
      expect(result).not.toHaveProperty('code');
      expect(result).not.toHaveProperty('message');
    });

    it('should return LLMFailureResponse on error (GAP #4)', async () => {
      const tool = createUserInfoTool(coreContext);
      const mcpContext: MCPContext = {
        session: {
          ...validSession,
          rejected: true,
        },
      };

      const result = (await tool.handler({}, mcpContext)) as LLMResponse;

      expect(result).toHaveProperty('status', 'failure');
      expect(result).toHaveProperty('code');
      expect(result).toHaveProperty('message');
      expect(result).not.toHaveProperty('data');
    });
  });
});
