import { FastMCP } from 'fastmcp';
import { z } from 'zod';
import { configManager } from './config/manager.js';
import { jwtValidator } from './middleware/jwt-validator.js';
import { sqlDelegator } from './services/sql-delegator.js';
import type { UserSession, AuditEntry } from './types/index.js';
import { createSecurityError, sanitizeError } from './utils/errors.js';

export class OAuthOBOServer {
  private server: FastMCP;
  private auditLog: AuditEntry[] = [];

  constructor() {
    // FastMCP authenticate callback: validates JWT and creates session on initialize
    this.server = new FastMCP({
      name: 'FastMCP OAuth OBO Server',
      version: '1.0.0',
      authenticate: this.authenticateRequest.bind(this),
    });

    this.setupTools();
  }

  private async authenticateRequest(request: any): Promise<UserSession | undefined> {
    console.log('\n[AUTH DEBUG] ========== Authentication Request ==========');
    console.log('[AUTH DEBUG] Request type:', typeof request);
    console.log('[AUTH DEBUG] Request method:', request?.method);
    console.log('[AUTH DEBUG] Request URL:', request?.url);
    console.log('[AUTH DEBUG] Request body (first 100 chars):', JSON.stringify(request?.body)?.substring(0, 100));
    console.log('[AUTH DEBUG] Request headers:', request?.headers);

    // Extract Authorization header from HTTP request
    const authHeader = request?.headers?.authorization;

    if (!authHeader) {
      console.log('[AUTH DEBUG] No authorization header provided');
      return undefined;
    }

    console.log('[AUTH DEBUG] Authorization header found:', authHeader.substring(0, 20) + '...');

    try {
      // Extract JWT from Bearer token
      const token = this.extractBearerToken(authHeader);
      if (!token) {
        console.log('[AUTH DEBUG] Failed to extract Bearer token from authorization header');
        return undefined;
      }

      console.log('[AUTH DEBUG] Bearer token extracted successfully');
      console.log('[AUTH DEBUG] Token preview:', token.substring(0, 50) + '...');

      // Decode token to inspect claims before validation
      const parts = token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
        console.log('[AUTH DEBUG] JWT Claims:');
        console.log(`  - iss (issuer): ${payload.iss || 'NOT PRESENT'}`);
        console.log(`  - aud (audience): ${JSON.stringify(payload.aud) || 'NOT PRESENT'}`);
        console.log(`  - azp (authorized party): ${payload.azp || 'NOT PRESENT'}`);
        console.log(`  - sub (subject): ${payload.sub || 'NOT PRESENT'}`);
        console.log(`  - exp (expires): ${payload.exp ? new Date(payload.exp * 1000).toISOString() : 'NOT PRESENT'}`);
      }

      // Validate JWT and create session
      console.log('[AUTH DEBUG] Starting JWT validation...');
      const { session, auditEntry } = await jwtValidator.validateJWT(token);

      console.log('[AUTH DEBUG] ✓ JWT validation SUCCESSFUL');
      console.log('[AUTH DEBUG] Session created:');
      console.log(`  - userId: ${session.userId}`);
      console.log(`  - username: ${session.username}`);
      console.log(`  - legacyUsername: ${session.legacyUsername || 'N/A'}`);
      console.log(`  - role: ${session.role}`);
      console.log(`  - permissions: ${session.permissions.join(', ')}`);
      console.log('[AUTH DEBUG] ================================================\n');

      // Log audit entry
      this.auditLog.push(auditEntry);

      return session;
    } catch (error) {
      console.error('[AUTH DEBUG] ✗ JWT validation FAILED');
      console.error('[AUTH DEBUG] Error:', error instanceof Error ? error.message : 'Unknown error');
      console.error('[AUTH DEBUG] ================================================\n');

      // Log failed authentication attempt
      const auditEntry: AuditEntry = {
        timestamp: new Date(),
        userId: 'unknown',
        action: 'authentication',
        resource: 'server',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };

      this.auditLog.push(auditEntry);

      // Return undefined for failed authentication (don't throw)
      return undefined;
    }
  }

  private extractBearerToken(auth: string): string | null {
    const bearerPrefix = 'Bearer ';
    if (!auth.startsWith(bearerPrefix)) {
      return null;
    }

    return auth.slice(bearerPrefix.length).trim();
  }

  private setupTools(): void {
    // SQL Delegation Tool
    this.server.addTool({
      name: 'sql-delegate',
      description: 'Execute SQL operations on behalf of legacy users',
      parameters: z.object({
        action: z.enum(['query', 'procedure', 'function']),
        sql: z.string().optional(),
        procedure: z.string().optional(),
        functionName: z.string().optional(),
        params: z.record(z.any()).optional(),
        resource: z.string().optional(),
      }),
      execute: async (args, context) => {
        const session = (context as any)?.session as UserSession | undefined;
        if (!session) {
          throw createSecurityError('AUTHENTICATION_REQUIRED', 'Authentication required', 401);
        }

        // Validate access for SQL delegation
        const hasAccess = await sqlDelegator.validateAccess(session);
        if (!hasAccess) {
          throw createSecurityError('INSUFFICIENT_PERMISSIONS', 'Insufficient permissions for SQL delegation', 403);
        }

        if (!session.legacyUsername) {
          throw createSecurityError('MISSING_LEGACY_USERNAME', 'Legacy username required for delegation', 400);
        }

        // Perform delegation
        const result = await sqlDelegator.delegate(
          session.legacyUsername,
          args.action,
          {
            sql: args.sql,
            procedure: args.procedure,
            functionName: args.functionName,
            params: args.params,
            resource: args.resource || 'sql-database',
          }
        );

        // Log audit entry
        this.auditLog.push(result.auditTrail);

        if (!result.success) {
          throw createSecurityError('DELEGATION_FAILED', result.error || 'SQL delegation failed', 500);
        }

        return JSON.stringify({
          success: true,
          data: result.data,
          legacyUser: session.legacyUsername,
          timestamp: new Date().toISOString(),
        });
      },
    });

    // Health Check Tool
    this.server.addTool({
      name: 'health-check',
      description: 'Check the health status of delegation services',
      parameters: z.object({
        service: z.enum(['sql', 'kerberos', 'all']).default('all'),
      }),
      execute: async (args, context) => {
        const session = (context as any)?.session as UserSession | undefined;
        if (!session) {
          throw createSecurityError('AUTHENTICATION_REQUIRED', 'Authentication required', 401);
        }

        const healthStatus: Record<string, boolean> = {};

        if (args.service === 'sql' || args.service === 'all') {
          healthStatus.sql = await sqlDelegator.healthCheck();
        }

        if (args.service === 'kerberos' || args.service === 'all') {
          // TODO: Implement Kerberos health check
          healthStatus.kerberos = false;
        }

        return JSON.stringify({
          healthy: Object.values(healthStatus).every(status => status),
          services: healthStatus,
          timestamp: new Date().toISOString(),
        });
      },
    });

    // User Info Tool
    this.server.addTool({
      name: 'user-info',
      description: 'Get current user session information',
      parameters: z.object({}),
      execute: async (args, context) => {
        const session = (context as any)?.session as UserSession | undefined;
        if (!session) {
          throw createSecurityError('AUTHENTICATION_REQUIRED', 'Authentication required', 401);
        }

        // Return sanitized user information
        return JSON.stringify({
          userId: session.userId,
          username: session.username,
          legacyUsername: session.legacyUsername,
          role: session.role,
          permissions: session.permissions,
          scopes: session.scopes,
          timestamp: new Date().toISOString(),
        });
      },
    });
  }

  async start(options: {
    transportType?: 'stdio' | 'httpStream';
    port?: number;
    endpoint?: string;
    configPath?: string;
  } = {}): Promise<void> {
    try {
      // Load configuration
      await configManager.loadConfig(options.configPath);

      // Initialize JWT validator
      await jwtValidator.initialize();

      // Initialize SQL delegator only if SQL config is present
      const config = configManager.getConfig();
      if (config.sql) {
        console.log('SQL configuration detected, initializing SQL delegator...');
        await sqlDelegator.initialize();
      } else {
        console.log('No SQL configuration, skipping SQL delegator initialization');
      }

      // Start FastMCP server with appropriate transport
      const transportType = options.transportType || 'stdio';

      if (transportType === 'httpStream') {
        console.log('[SERVER] Starting HTTP Stream transport');
        console.log('[SERVER] Using stateless mode (stateless: true)');
        await this.server.start({
          transportType: 'httpStream',
          httpStream: {
            port: options.port || configManager.getServerPort(),
            endpoint: options.endpoint || '/mcp',
          },
          stateless: true,  // Stateless mode - JWT auth on every request
          logLevel: 'debug',
        });
      } else {
        await this.server.start({
          transportType: 'stdio',
          stateless: false,
          logLevel: configManager.getLogLevel() as any,
        });
      }

      console.log('FastMCP OAuth OBO Server started successfully');
    } catch (error) {
      console.error('Failed to start server:', sanitizeError(error));
      throw error;
    }
  }

  async stop(): Promise<void> {
    try {
      // Cleanup resources
      const config = configManager.getConfig();
      if (config.sql) {
        await sqlDelegator.destroy();
      }
      jwtValidator.destroy();

      console.log('FastMCP OAuth OBO Server stopped successfully');
    } catch (error) {
      console.error('Error during server shutdown:', sanitizeError(error));
      throw error;
    }
  }

  // Get server instance for advanced usage
  getServer(): FastMCP {
    return this.server;
  }

  // Get audit log for external processing
  getAuditLog(): AuditEntry[] {
    return [...this.auditLog];
  }

  // Clear audit log (admin operation)
  clearAuditLog(): void {
    this.auditLog = [];
  }
}

// Export server instance and types
export { configManager, jwtValidator, sqlDelegator };
export type { UserSession, AuditEntry, OAuthOBOConfig } from './types/index.js';

// Default export for easy usage
export default OAuthOBOServer;