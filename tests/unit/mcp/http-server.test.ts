/**
 * Unit Tests for HTTP Server with OAuth Metadata Endpoints
 *
 * Tests the Express server wrapper that provides:
 * - OAuth metadata endpoints (RFC 8414, RFC 9728)
 * - CORS handling
 * - Error handling with WWW-Authenticate headers
 * - Health check endpoint
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { CoreContext } from '../../../src/core/types.js';
import {
  createOAuthMetadataServer,
  startHTTPServer,
  type HTTPServerOptions,
} from '../../../src/mcp/http-server.js';

// Mock oauth-metadata module
vi.mock('../../../src/mcp/oauth-metadata.js', () => ({
  generateProtectedResourceMetadata: vi.fn((coreContext, serverUrl) => ({
    resource: serverUrl,
    authorization_servers: ['https://auth.example.com'],
    bearer_methods_supported: ['header'],
    resource_signing_alg_values_supported: ['RS256', 'ES256'],
    scopes_supported: ['mcp:read', 'mcp:write'],
  })),
  generateWWWAuthenticateHeader: vi.fn(
    (coreContext, realm, scope) => `Bearer realm="${realm}", authorization_server="https://auth.example.com"`
  ),
}));

describe('HTTP Server', () => {
  let mockCoreContext: CoreContext;
  let serverOptions: HTTPServerOptions;

  beforeEach(() => {
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
        getMCPConfig: vi.fn().mockReturnValue({
          oauth: {
            scopes: ['mcp:read', 'mcp:write'],
          },
        }),
      },
    } as any;

    serverOptions = {
      port: 3000,
      serverUrl: 'http://localhost:3000',
      mcpEndpoint: '/mcp',
    };
  });

  describe('createOAuthMetadataServer()', () => {
    it('should create Express app with OAuth metadata routes', () => {
      const app = createOAuthMetadataServer(mockCoreContext, serverOptions);

      expect(app).toBeDefined();
      expect(typeof app).toBe('function'); // Express app is a function
    });

    it('should enable JSON parsing', async () => {
      const app = createOAuthMetadataServer(mockCoreContext, serverOptions);

      const response = await request(app)
        .post('/test')
        .send({ test: 'data' })
        .set('Content-Type', 'application/json');

      // Server should parse JSON (even though route doesn't exist)
      expect(response.status).not.toBe(400); // Not a parse error
    });

    describe('CORS Middleware', () => {
      it('should add CORS headers to all responses', async () => {
        const app = createOAuthMetadataServer(mockCoreContext, serverOptions);

        const response = await request(app).get('/.well-known/oauth-authorization-server');

        expect(response.headers['access-control-allow-origin']).toBe('*');
        expect(response.headers['access-control-allow-methods']).toBe('GET, POST, OPTIONS');
        expect(response.headers['access-control-allow-headers']).toContain('Authorization');
        expect(response.headers['access-control-expose-headers']).toContain('WWW-Authenticate');
      });

      it('should handle OPTIONS preflight requests', async () => {
        const app = createOAuthMetadataServer(mockCoreContext, serverOptions);

        const response = await request(app).options('/.well-known/oauth-authorization-server');

        expect(response.status).toBe(200);
      });
    });

    describe('OAuth Authorization Server Metadata (RFC 8414)', () => {
      it('should return authorization server metadata', async () => {
        const app = createOAuthMetadataServer(mockCoreContext, serverOptions);

        const response = await request(app).get('/.well-known/oauth-authorization-server');

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
          issuer: 'https://auth.example.com',
          authorization_endpoint: 'https://auth.example.com/protocol/openid-connect/auth',
          token_endpoint: 'https://auth.example.com/protocol/openid-connect/token',
          jwks_uri: 'https://auth.example.com/.well-known/jwks.json',
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256', 'ES256'],
          token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
          code_challenge_methods_supported: ['S256'],
          scopes_supported: ['openid', 'profile', 'email'],
        });
      });

      it('should return 500 when no trusted IDPs configured', async () => {
        mockCoreContext.configManager.getAuthConfig = vi.fn().mockReturnValue({
          trustedIDPs: [],
        });

        const app = createOAuthMetadataServer(mockCoreContext, serverOptions);

        const response = await request(app).get('/.well-known/oauth-authorization-server');

        expect(response.status).toBe(500);
        expect(response.body).toEqual({
          error: 'server_error',
          error_description: 'No trusted identity providers configured',
        });
      });

      it('should use default algorithms when not specified', async () => {
        mockCoreContext.configManager.getAuthConfig = vi.fn().mockReturnValue({
          trustedIDPs: [
            {
              issuer: 'https://auth.example.com',
              jwksUri: 'https://auth.example.com/.well-known/jwks.json',
              // algorithms not specified
            },
          ],
        });

        const app = createOAuthMetadataServer(mockCoreContext, serverOptions);

        const response = await request(app).get('/.well-known/oauth-authorization-server');

        expect(response.status).toBe(200);
        expect(response.body.id_token_signing_alg_values_supported).toEqual(['RS256']);
      });
    });

    describe('OAuth Protected Resource Metadata (RFC 9728)', () => {
      it('should return protected resource metadata', async () => {
        const app = createOAuthMetadataServer(mockCoreContext, serverOptions);

        const response = await request(app).get('/.well-known/oauth-protected-resource');

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
          resource: 'http://localhost:3000',
          authorization_servers: ['https://auth.example.com'],
          bearer_methods_supported: ['header'],
          resource_signing_alg_values_supported: ['RS256', 'ES256'],
          scopes_supported: ['mcp:read', 'mcp:write'],
        });
      });

      it('should call generateProtectedResourceMetadata with correct params', async () => {
        const { generateProtectedResourceMetadata } = await import(
          '../../../src/mcp/oauth-metadata.js'
        );

        const app = createOAuthMetadataServer(mockCoreContext, serverOptions);

        await request(app).get('/.well-known/oauth-protected-resource');

        expect(generateProtectedResourceMetadata).toHaveBeenCalledWith(
          mockCoreContext,
          'http://localhost:3000'
        );
      });
    });

    describe('Health Check Endpoint', () => {
      it('should return healthy status', async () => {
        const app = createOAuthMetadataServer(mockCoreContext, serverOptions);

        const response = await request(app).get('/health');

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
          status: 'healthy',
          service: 'mcp-oauth-server',
          timestamp: expect.any(String),
        });
      });

      it('should return ISO 8601 timestamp', async () => {
        const app = createOAuthMetadataServer(mockCoreContext, serverOptions);

        const response = await request(app).get('/health');

        const timestamp = new Date(response.body.timestamp);
        expect(timestamp.toISOString()).toBe(response.body.timestamp);
      });
    });

    describe('Error Handling', () => {
      it('should handle 404 errors for unknown routes', async () => {
        const app = createOAuthMetadataServer(mockCoreContext, serverOptions);

        const response = await request(app).get('/unknown-route');

        // Express default behavior for 404
        expect(response.status).toBe(404);
      });

      it('should return 500 when IDP configuration is missing', async () => {
        // Create context with empty IDP array
        const emptyIDPContext = {
          ...mockCoreContext,
          configManager: {
            ...mockCoreContext.configManager,
            getAuthConfig: () => ({
              trustedIDPs: [],
              rateLimiting: undefined,
              audit: undefined,
            }),
          },
        };

        const app = createOAuthMetadataServer(emptyIDPContext, serverOptions);

        const response = await request(app).get('/.well-known/oauth-authorization-server');

        expect(response.status).toBe(500);
        expect(response.body).toEqual({
          error: 'server_error',
          error_description: 'No trusted identity providers configured',
        });
      });
    });
  });

  describe('startHTTPServer()', () => {
    it('should start HTTP server on specified port', async () => {
      const app = express();
      const port = 3001;

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const server = await startHTTPServer(app, port);

      expect(server).toBeDefined();
      expect(server.listening).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining(`Listening on port ${port}`));

      // Cleanup
      server.close();
      consoleSpy.mockRestore();
    });

    it('should log OAuth metadata URLs', async () => {
      const app = express();
      const port = 3002;

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const server = await startHTTPServer(app, port);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('/.well-known/oauth-authorization-server')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('/.well-known/oauth-protected-resource')
      );

      // Cleanup
      server.close();
      consoleSpy.mockRestore();
    });

    it('should reject when port is already in use', async () => {
      const app1 = express();
      const app2 = express();
      const port = 3003;

      const server1 = await startHTTPServer(app1, port);

      await expect(startHTTPServer(app2, port)).rejects.toThrow(`Port ${port} is already in use`);

      // Cleanup
      server1.close();
    });

    it('should handle server lifecycle correctly', async () => {
      const app = express();
      const port = 3004;

      const server = await startHTTPServer(app, port);

      // Verify server is listening
      expect(server.listening).toBe(true);

      // Verify server can be closed
      expect(server.close).toBeInstanceOf(Function);

      // Cleanup
      server.close();
    });

    it('should return server instance that can be closed', async () => {
      const app = express();
      const port = 3005;

      const server = await startHTTPServer(app, port);

      expect(server.close).toBeInstanceOf(Function);

      // Close should work
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    });
  });
});
