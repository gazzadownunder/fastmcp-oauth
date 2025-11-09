/**
 * Custom HTTP Server for MCP with OAuth Metadata Endpoints
 *
 * This wrapper creates an Express server that hosts:
 * 1. OAuth metadata endpoints (/.well-known/oauth-authorization-server)
 * 2. FastMCP protocol endpoint (/mcp via proxy)
 *
 * Necessary because FastMCP doesn't expose the underlying Express app
 * for adding custom routes.
 */

import express, { type Request, type Response } from 'express';
import { createServer } from 'http';
import type { CoreContext } from '../core/types.js';
import {
  generateProtectedResourceMetadata,
  generateWWWAuthenticateHeader,
} from './oauth-metadata.js';

/**
 * HTTP Server Options
 */
export interface HTTPServerOptions {
  port: number;
  serverUrl: string; // e.g., "http://localhost:3000"
  mcpEndpoint?: string; // Default: "/mcp"
}

/**
 * Create Express server with OAuth metadata endpoints
 *
 * Sets up:
 * - GET /.well-known/oauth-authorization-server - OAuth metadata (RFC 8414)
 * - GET /.well-known/oauth-protected-resource - Protected resource metadata (RFC 9728)
 * - Error handlers with WWW-Authenticate headers
 *
 * @param coreContext - Core context with configuration
 * @param options - Server options
 * @returns Express app (ready for FastMCP integration)
 */
export function createOAuthMetadataServer(
  coreContext: CoreContext,
  options: HTTPServerOptions
): express.Application {
  const app = express();

  // Enable JSON parsing
  app.use(express.json());

  // CORS headers (required for browser-based MCP clients)
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id');
    res.header('Access-Control-Expose-Headers', 'WWW-Authenticate, Mcp-Session-Id');

    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // OAuth 2.0 Authorization Server Metadata (RFC 8414)
  // This advertises the external IDP's endpoints to clients
  app.get('/.well-known/oauth-authorization-server', (req: Request, res: Response) => {
    const authConfig = coreContext.configManager.getAuthConfig();
    const primaryIDP = authConfig.trustedIDPs[0];

    if (!primaryIDP) {
      return res.status(500).json({
        error: 'server_error',
        error_description: 'No trusted identity providers configured',
      });
    }

    // Return authorization server metadata pointing to external IDP
    const metadata = {
      issuer: primaryIDP.issuer,
      authorization_endpoint: `${primaryIDP.issuer}/protocol/openid-connect/auth`,
      token_endpoint: `${primaryIDP.issuer}/protocol/openid-connect/token`,
      jwks_uri: primaryIDP.jwksUri,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: primaryIDP.algorithms || ['RS256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      code_challenge_methods_supported: ['S256'], // PKCE required
      scopes_supported: ['openid', 'profile', 'email'],
    };

    res.json(metadata);
  });

  // OAuth 2.0 Protected Resource Metadata (RFC 9728)
  // This advertises MCP server capabilities as a resource server
  app.get('/.well-known/oauth-protected-resource', (req: Request, res: Response) => {
    const metadata = generateProtectedResourceMetadata(coreContext, options.serverUrl);
    res.json(metadata);
  });

  // Health check endpoint
  app.get('/health', (req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      service: 'mcp-oauth-server',
      timestamp: new Date().toISOString(),
    });
  });

  // 401 error handler - Add WWW-Authenticate header
  app.use((err: any, req: Request, res: Response, next: any) => {
    if (err.statusCode === 401 || err.status === 401) {
      const wwwAuthenticate = generateWWWAuthenticateHeader(
        coreContext,
        'MCP OAuth Server',
        'mcp:read mcp:write'
      );

      res.setHeader('WWW-Authenticate', wwwAuthenticate);
      return res.status(401).json({
        error: 'unauthorized',
        error_description: err.message || 'Authentication required',
      });
    }

    next(err);
  });

  // Generic error handler
  app.use((err: any, req: Request, res: Response, next: any) => {
    console.error('[HTTP Server] Error:', err);
    res.status(err.statusCode || err.status || 500).json({
      error: 'server_error',
      error_description: err.message || 'Internal server error',
    });
  });

  return app;
}

/**
 * Start HTTP server with OAuth metadata endpoints
 *
 * @param app - Express application
 * @param port - Port to listen on
 * @returns HTTP server instance
 */
export function startHTTPServer(app: express.Application, port: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const server = createServer(app);

    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is already in use`));
      } else {
        reject(err);
      }
    });

    server.listen(port, () => {
      console.log(`[HTTP Server] Listening on port ${port}`);
      console.log(
        `[HTTP Server] OAuth metadata: http://localhost:${port}/.well-known/oauth-authorization-server`
      );
      console.log(
        `[HTTP Server] Resource metadata: http://localhost:${port}/.well-known/oauth-protected-resource`
      );
      resolve(server);
    });
  });
}
