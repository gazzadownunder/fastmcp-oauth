/**
 * Unit Tests for OAuth Protected Resource Metadata (RFC 9728)
 *
 * Tests the generation of OAuth metadata for MCP servers acting as
 * OAuth 2.1 Resource Servers.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { CoreContext } from '../../../src/core/types.js';
import {
  generateProtectedResourceMetadata,
  generateWWWAuthenticateHeader,
  type ProtectedResourceMetadata,
} from '../../../src/mcp/oauth-metadata.js';

describe('OAuth Metadata (RFC 9728)', () => {
  let mockCoreContext: CoreContext;

  beforeEach(() => {
    // Reset console.log mock
    vi.spyOn(console, 'log').mockImplementation(() => {});

    // Create mock CoreContext
    mockCoreContext = {
      configManager: {
        getAuthConfig: vi.fn().mockReturnValue({
          trustedIDPs: [
            {
              issuer: 'https://auth.example.com',
              jwksUri: 'https://auth.example.com/.well-known/jwks.json',
              algorithms: ['RS256', 'ES256'],
            },
          ],
        }),
        getFastMCPConfig: vi.fn().mockReturnValue({
          oauth: {
            scopes: ['mcp:read', 'mcp:write', 'mcp:admin'],
          },
        }),
      },
    } as any;
  });

  describe('generateProtectedResourceMetadata()', () => {
    it('should generate valid RFC 9728 metadata', () => {
      const serverUrl = 'https://mcp-server.example.com';

      const metadata = generateProtectedResourceMetadata(mockCoreContext, serverUrl);

      expect(metadata).toEqual({
        resource: 'https://mcp-server.example.com',
        authorization_servers: ['https://auth.example.com'],
        bearer_methods_supported: ['header'],
        resource_signing_alg_values_supported: ['RS256', 'ES256'],
        scopes_supported: ['mcp:read', 'mcp:write', 'mcp:admin'],
        resource_documentation: 'https://mcp-server.example.com/docs',
      });
    });

    it('should support multiple authorization servers', () => {
      mockCoreContext.configManager.getAuthConfig = vi.fn().mockReturnValue({
        trustedIDPs: [
          { issuer: 'https://auth1.example.com', algorithms: ['RS256'] },
          { issuer: 'https://auth2.example.com', algorithms: ['ES256'] },
          { issuer: 'https://auth3.example.com', algorithms: ['RS256'] },
        ],
      });

      const metadata = generateProtectedResourceMetadata(mockCoreContext, 'https://mcp.example.com');

      expect(metadata.authorization_servers).toEqual([
        'https://auth1.example.com',
        'https://auth2.example.com',
        'https://auth3.example.com',
      ]);
    });

    it('should deduplicate signing algorithms', () => {
      mockCoreContext.configManager.getAuthConfig = vi.fn().mockReturnValue({
        trustedIDPs: [
          { issuer: 'https://auth1.example.com', algorithms: ['RS256', 'ES256'] },
          { issuer: 'https://auth2.example.com', algorithms: ['RS256'] }, // Duplicate RS256
          { issuer: 'https://auth3.example.com', algorithms: ['ES256'] }, // Duplicate ES256
        ],
      });

      const metadata = generateProtectedResourceMetadata(mockCoreContext, 'https://mcp.example.com');

      // Should only include unique algorithms
      expect(metadata.resource_signing_alg_values_supported).toHaveLength(2);
      expect(metadata.resource_signing_alg_values_supported).toContain('RS256');
      expect(metadata.resource_signing_alg_values_supported).toContain('ES256');
    });

    it('should use default algorithms when not specified', () => {
      mockCoreContext.configManager.getAuthConfig = vi.fn().mockReturnValue({
        trustedIDPs: [
          { issuer: 'https://auth.example.com' }, // No algorithms specified
        ],
      });

      const metadata = generateProtectedResourceMetadata(mockCoreContext, 'https://mcp.example.com');

      // Should default to RS256 and ES256
      expect(metadata.resource_signing_alg_values_supported).toEqual(['RS256', 'ES256']);
    });

    it('should handle HTTP URLs (development mode)', () => {
      const serverUrl = 'http://localhost:3000';

      const metadata = generateProtectedResourceMetadata(mockCoreContext, serverUrl);

      expect(metadata.resource).toBe('http://localhost:3000');
      expect(metadata.resource_documentation).toBe('http://localhost:3000/docs');
    });

    it('should return empty scopes array when no scopes configured', () => {
      mockCoreContext.configManager.getFastMCPConfig = vi.fn().mockReturnValue({
        oauth: {
          // No scopes
        },
      });

      const metadata = generateProtectedResourceMetadata(mockCoreContext, 'https://mcp.example.com');

      expect(metadata.scopes_supported).toEqual([]);
    });

    it('should return empty scopes array when oauth config missing', () => {
      mockCoreContext.configManager.getFastMCPConfig = vi.fn().mockReturnValue({
        // No oauth config
      });

      const metadata = generateProtectedResourceMetadata(mockCoreContext, 'https://mcp.example.com');

      expect(metadata.scopes_supported).toEqual([]);
    });

    it('should return empty scopes array when MCP config is null', () => {
      mockCoreContext.configManager.getFastMCPConfig = vi.fn().mockReturnValue(null);

      const metadata = generateProtectedResourceMetadata(mockCoreContext, 'https://mcp.example.com');

      expect(metadata.scopes_supported).toEqual([]);
    });

    it('should always include bearer header method', () => {
      const metadata = generateProtectedResourceMetadata(mockCoreContext, 'https://mcp.example.com');

      expect(metadata.bearer_methods_supported).toEqual(['header']);
    });

    it('should include documentation URL based on server URL', () => {
      const metadata1 = generateProtectedResourceMetadata(
        mockCoreContext,
        'https://api.example.com'
      );
      expect(metadata1.resource_documentation).toBe('https://api.example.com/docs');

      const metadata2 = generateProtectedResourceMetadata(
        mockCoreContext,
        'https://mcp.company.net:8443'
      );
      expect(metadata2.resource_documentation).toBe('https://mcp.company.net:8443/docs');
    });
  });

  describe('generateWWWAuthenticateHeader()', () => {
    it('should generate RFC 6750 Bearer header', () => {
      const header = generateWWWAuthenticateHeader(
        mockCoreContext,
        'MCP Server',
        undefined, // no scope
        true, // include protected resource metadata
        'http://localhost:3000' // server URL
      );

      expect(header).toBe(
        'Bearer realm="MCP Server", resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource"'
      );
    });

    it('should include scope when provided', () => {
      const header = generateWWWAuthenticateHeader(
        mockCoreContext,
        'MCP Server',
        'mcp:read mcp:write',
        true, // include protected resource metadata
        'http://localhost:3000' // server URL
      );

      expect(header).toBe(
        'Bearer realm="MCP Server", scope="mcp:read mcp:write", resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource"'
      );
    });

    it('should omit scope when not provided', () => {
      const header = generateWWWAuthenticateHeader(mockCoreContext, 'MCP Server');

      expect(header).not.toContain('scope=');
    });

    it('should handle different realm names', () => {
      const header1 = generateWWWAuthenticateHeader(mockCoreContext, 'Production API');
      expect(header1).toContain('realm="Production API"');

      const header2 = generateWWWAuthenticateHeader(mockCoreContext, 'Test Environment');
      expect(header2).toContain('realm="Test Environment"');
    });

    it('should use first trusted IDP as authorization server', () => {
      mockCoreContext.configManager.getAuthConfig = vi.fn().mockReturnValue({
        trustedIDPs: [
          { issuer: 'https://primary.example.com' },
          { issuer: 'https://secondary.example.com' },
          { issuer: 'https://tertiary.example.com' },
        ],
      });

      const header = generateWWWAuthenticateHeader(
        mockCoreContext,
        'MCP Server',
        undefined,
        true,
        'http://localhost:3000'
      );

      expect(header).toContain('resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource"');
    });

    it('should handle missing trusted IDPs gracefully', () => {
      mockCoreContext.configManager.getAuthConfig = vi.fn().mockReturnValue({
        trustedIDPs: [],
      });

      const header = generateWWWAuthenticateHeader(mockCoreContext, 'MCP Server');

      expect(header).toBe('Bearer realm="MCP Server"');
    });

    it('should handle null issuer gracefully', () => {
      mockCoreContext.configManager.getAuthConfig = vi.fn().mockReturnValue({
        trustedIDPs: [{ issuer: null }],
      });

      const header = generateWWWAuthenticateHeader(mockCoreContext, 'MCP Server');

      expect(header).toBe('Bearer realm="MCP Server"');
    });

    it('should escape quotes in realm name', () => {
      // Test that realm with quotes is properly formatted
      const header = generateWWWAuthenticateHeader(mockCoreContext, 'My "Special" Realm');

      // The realm should be wrapped in quotes as per RFC 6750
      expect(header).toContain('realm="My "Special" Realm"');
    });

    it('should handle multiple scopes', () => {
      const header = generateWWWAuthenticateHeader(
        mockCoreContext,
        'MCP Server',
        'mcp:read mcp:write mcp:admin sql:query'
      );

      expect(header).toContain('scope="mcp:read mcp:write mcp:admin sql:query"');
    });

    it('should format header according to RFC 6750 Section 3', () => {
      const header = generateWWWAuthenticateHeader(
        mockCoreContext,
        'Test Realm',
        'test:scope',
        true,
        'http://localhost:3000'
      );

      // Check format: Bearer <param>, <param>, <param>
      expect(header).toMatch(/^Bearer realm="[^"]+", scope="[^"]+", resource_metadata="[^"]+"$/);
    });
  });

  describe('extractSupportedScopes() - Internal Function', () => {
    it('should log debug information', () => {
      const consoleSpy = vi.spyOn(console, 'log');

      generateProtectedResourceMetadata(mockCoreContext, 'https://mcp.example.com');

      expect(consoleSpy).toHaveBeenCalledWith(
        '[OAuth Metadata] extractSupportedScopes called'
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        '[OAuth Metadata] Returning scopes:',
        ['mcp:read', 'mcp:write', 'mcp:admin']
      );
    });

    it('should handle empty scopes array', () => {
      mockCoreContext.configManager.getFastMCPConfig = vi.fn().mockReturnValue({
        oauth: {
          scopes: [],
        },
      });

      const metadata = generateProtectedResourceMetadata(mockCoreContext, 'https://mcp.example.com');

      expect(metadata.scopes_supported).toEqual([]);
    });

    it('should preserve scope order', () => {
      mockCoreContext.configManager.getFastMCPConfig = vi.fn().mockReturnValue({
        oauth: {
          scopes: ['scope:a', 'scope:b', 'scope:c', 'scope:d'],
        },
      });

      const metadata = generateProtectedResourceMetadata(mockCoreContext, 'https://mcp.example.com');

      expect(metadata.scopes_supported).toEqual(['scope:a', 'scope:b', 'scope:c', 'scope:d']);
    });
  });

  describe('Integration Scenarios', () => {
    it('should work with minimal configuration', () => {
      mockCoreContext.configManager.getAuthConfig = vi.fn().mockReturnValue({
        trustedIDPs: [{ issuer: 'https://auth.example.com' }],
      });
      mockCoreContext.configManager.getFastMCPConfig = vi.fn().mockReturnValue({});

      const metadata = generateProtectedResourceMetadata(mockCoreContext, 'https://mcp.example.com');

      expect(metadata.resource).toBe('https://mcp.example.com');
      expect(metadata.authorization_servers).toEqual(['https://auth.example.com']);
      expect(metadata.bearer_methods_supported).toEqual(['header']);
      expect(metadata.resource_signing_alg_values_supported).toEqual(['RS256', 'ES256']);
      expect(metadata.scopes_supported).toEqual([]);
    });

    it('should work with complex multi-IDP configuration', () => {
      mockCoreContext.configManager.getAuthConfig = vi.fn().mockReturnValue({
        trustedIDPs: [
          {
            issuer: 'https://keycloak.company.com/realms/production',
            algorithms: ['RS256', 'ES256', 'EdDSA'],
          },
          {
            issuer: 'https://auth0.company.com',
            algorithms: ['RS256'],
          },
          {
            issuer: 'https://azure-ad.company.com',
            algorithms: ['RS256', 'ES256'],
          },
        ],
      });
      mockCoreContext.configManager.getFastMCPConfig = vi.fn().mockReturnValue({
        oauth: {
          scopes: [
            'mcp:read',
            'mcp:write',
            'mcp:admin',
            'sql:query',
            'sql:execute',
            'kerberos:delegate',
          ],
        },
      });

      const metadata = generateProtectedResourceMetadata(mockCoreContext, 'https://mcp.example.com');

      expect(metadata.authorization_servers).toHaveLength(3);
      expect(metadata.resource_signing_alg_values_supported).toContain('RS256');
      expect(metadata.resource_signing_alg_values_supported).toContain('ES256');
      expect(metadata.resource_signing_alg_values_supported).toContain('EdDSA');
      expect(metadata.scopes_supported).toHaveLength(6);
    });

    it('should generate consistent metadata across multiple calls', () => {
      const metadata1 = generateProtectedResourceMetadata(mockCoreContext, 'https://mcp.example.com');
      const metadata2 = generateProtectedResourceMetadata(mockCoreContext, 'https://mcp.example.com');

      expect(metadata1).toEqual(metadata2);
    });
  });

  describe('Type Compliance', () => {
    it('should return ProtectedResourceMetadata type', () => {
      const metadata = generateProtectedResourceMetadata(mockCoreContext, 'https://mcp.example.com');

      // TypeScript compilation validates this at build time
      const typedMetadata: ProtectedResourceMetadata = metadata;

      expect(typedMetadata.resource).toBeDefined();
      expect(typedMetadata.authorization_servers).toBeDefined();
      expect(typedMetadata.bearer_methods_supported).toBeDefined();
      expect(typedMetadata.resource_signing_alg_values_supported).toBeDefined();
    });

    it('should include all required RFC 9728 fields', () => {
      const metadata = generateProtectedResourceMetadata(mockCoreContext, 'https://mcp.example.com');

      // Required fields per RFC 9728
      expect(metadata).toHaveProperty('resource');
      expect(metadata).toHaveProperty('authorization_servers');
      expect(metadata).toHaveProperty('bearer_methods_supported');
      expect(metadata).toHaveProperty('resource_signing_alg_values_supported');

      // Optional but included fields
      expect(metadata).toHaveProperty('scopes_supported');
      expect(metadata).toHaveProperty('resource_documentation');
    });
  });
});
