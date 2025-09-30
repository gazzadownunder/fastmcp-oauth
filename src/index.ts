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
    this.server = new FastMCP({
      name: 'FastMCP OAuth OBO Server',
      version: '1.0.0',
      oauth: {
        authorizationServer: {
          issuer: 'https://fastmcp-obo-server.local',
          authorizationEndpoint: 'https://fastmcp-obo-server.local/oauth/authorize',
          tokenEndpoint: 'https://fastmcp-obo-server.local/oauth/token',
          jwksUri: 'https://fastmcp-obo-server.local/.well-known/jwks.json',
          responseTypesSupported: ['code'],
          grantTypesSupported: ['authorization_code'],
          tokenEndpointAuthMethodsSupported: ['client_secret_basic'],
        },
      },
      authenticate: this.authenticateRequest.bind(this),
    });

    this.setupTools();
  }

  private async authenticateRequest(auth: string | undefined): Promise<UserSession | undefined> {
    if (!auth) {
      return undefined;
    }

    try {
      // Extract JWT from Bearer token
      const token = this.extractBearerToken(auth);
      if (!token) {
        return undefined;
      }

      // Validate JWT and create session
      const { session, auditEntry } = await jwtValidator.validateJWT(token);

      // Log audit entry
      this.auditLog.push(auditEntry);

      return session;
    } catch (error) {
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

    // Audit Log Tool (Admin only)
    this.server.addTool({
      name: 'audit-log',
      description: 'Retrieve audit log entries (admin only)',
      parameters: z.object({
        limit: z.number().min(1).max(1000).default(100),
        userId: z.string().optional(),
        action: z.string().optional(),
        success: z.boolean().optional(),
      }),
      execute: async (args, context) => {
        const session = (context as any)?.session as UserSession | undefined;
        if (!session) {
          throw createSecurityError('AUTHENTICATION_REQUIRED', 'Authentication required', 401);
        }

        if (session.role !== 'admin') {
          throw createSecurityError('INSUFFICIENT_PERMISSIONS', 'Admin role required', 403);
        }

        // Filter audit log based on parameters
        let filteredLog = this.auditLog;

        if (args.userId) {
          filteredLog = filteredLog.filter(entry => entry.userId === args.userId);
        }

        if (args.action) {
          filteredLog = filteredLog.filter(entry => entry.action.includes(args.action!));
        }

        if (args.success !== undefined) {
          filteredLog = filteredLog.filter(entry => entry.success === args.success);
        }

        // Sort by timestamp (most recent first) and limit
        const sortedLog = filteredLog
          .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
          .slice(0, args.limit);

        return JSON.stringify({
          entries: sortedLog,
          total: filteredLog.length,
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
    transportType?: 'stdio' | 'sse';
    port?: number;
    configPath?: string;
  } = {}): Promise<void> {
    try {
      // Load configuration
      await configManager.loadConfig(options.configPath);

      // Initialize JWT validator
      await jwtValidator.initialize();

      // Initialize SQL delegator
      await sqlDelegator.initialize();

      // Start FastMCP server
      await this.server.start({
        transportType: options.transportType || 'stdio',
        port: options.port || configManager.getServerPort(),
        stateless: false,
        logLevel: configManager.getLogLevel() as any,
      });

      console.log('FastMCP OAuth OBO Server started successfully');
    } catch (error) {
      console.error('Failed to start server:', sanitizeError(error));
      throw error;
    }
  }

  async stop(): Promise<void> {
    try {
      // Cleanup resources
      await sqlDelegator.destroy();
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