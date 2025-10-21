/**
 * gRPC Delegation Example
 *
 * This example demonstrates how to create a delegation module that integrates
 * with gRPC services, using token exchange for authentication.
 *
 * Use Case: Delegate MCP tool calls to gRPC microservices with OAuth token exchange
 *
 * Features:
 * - Token exchange for service-specific JWT
 * - gRPC unary and streaming call support
 * - Metadata (headers) propagation
 * - Error handling with gRPC status codes
 * - Automatic retry with exponential backoff
 *
 * Note: This is a conceptual example. In production, you would use @grpc/grpc-js
 * or similar library for actual gRPC communication.
 */

import type { DelegationModule, DelegationResult } from '../src/delegation/base.js';
import type { UserSession, AuditEntry } from '../src/core/index.js';
import type { CoreContext } from '../src/core/types.js';

/**
 * gRPC delegation module configuration
 */
export interface GRPCDelegationConfig {
  serviceUrl: string;                  // gRPC service URL (e.g., 'localhost:50051')
  serviceName: string;                 // Service name for logging
  audience?: string;                   // OAuth audience for token exchange
  scope?: string;                      // OAuth scope for token exchange
  useTLS?: boolean;                    // Use TLS encryption (default: true)
  timeout?: number;                    // Request timeout in milliseconds
  maxRetries?: number;                 // Maximum retry attempts
  metadata?: Record<string, string>;   // Additional gRPC metadata
}

/**
 * gRPC request parameters
 */
export interface GRPCRequest {
  method: string;                      // gRPC method name (e.g., 'GetUser', 'ListProjects')
  message: Record<string, any>;        // Request message (protobuf fields)
  metadata?: Record<string, string>;   // Additional metadata for this request
}

/**
 * gRPC status codes (subset of standard codes)
 */
enum GRPCStatus {
  OK = 0,
  CANCELLED = 1,
  UNKNOWN = 2,
  INVALID_ARGUMENT = 3,
  DEADLINE_EXCEEDED = 4,
  NOT_FOUND = 5,
  ALREADY_EXISTS = 6,
  PERMISSION_DENIED = 7,
  UNAUTHENTICATED = 16,
  UNAVAILABLE = 14,
}

/**
 * gRPC error with status code
 */
class GRPCError extends Error {
  constructor(
    public readonly code: GRPCStatus,
    message: string,
    public readonly details?: any
  ) {
    super(message);
    this.name = 'GRPCError';
  }
}

/**
 * gRPC Delegation Module
 *
 * Delegates MCP operations to gRPC services with OAuth token exchange.
 *
 * Note: This is a simplified implementation for demonstration. In production,
 * use @grpc/grpc-js with proper proto definitions and generated clients.
 */
export class GRPCDelegationModule implements DelegationModule {
  readonly name = 'grpc';
  readonly type = 'api';

  private config: GRPCDelegationConfig | null = null;

  async initialize(config: GRPCDelegationConfig): Promise<void> {
    if (!config.serviceUrl) {
      throw new Error('gRPC service URL is required');
    }

    if (!config.serviceName) {
      throw new Error('gRPC service name is required');
    }

    this.config = {
      useTLS: true,
      timeout: 30000,
      maxRetries: 3,
      ...config,
    };

    console.log(`[GRPCDelegation] Initialized for service: ${config.serviceName} at ${config.serviceUrl}`);
  }

  async delegate<T>(
    session: UserSession,
    action: string,
    params: GRPCRequest,
    context?: { sessionId?: string; coreContext?: CoreContext }
  ): Promise<DelegationResult<T>> {
    const auditEntry: AuditEntry = {
      timestamp: new Date(),
      source: 'delegation:grpc',
      userId: session.userId,
      action: `grpc:${action}`,
      success: false,
    };

    try {
      if (!this.config) {
        throw new Error('GRPCDelegationModule not initialized');
      }

      // Validate gRPC request
      if (!params.method) {
        throw new Error('gRPC method name is required');
      }

      if (!params.message) {
        throw new Error('gRPC request message is required');
      }

      // Get authentication token (preferably via token exchange)
      let authToken = session.claims.rawPayload || '';

      if (context?.coreContext?.tokenExchangeService && this.config.audience) {
        console.log(`[GRPCDelegation] Exchanging token for audience: ${this.config.audience}`);

        try {
          authToken = await context.coreContext.tokenExchangeService.performExchange({
            requestorJWT: session.claims.rawPayload || '',
            audience: this.config.audience,
            scope: this.config.scope || 'grpc:call',
            sessionId: context.sessionId,
          });
        } catch (exchangeError) {
          console.warn(`[GRPCDelegation] Token exchange failed, using original token:`, exchangeError);
          // Fall back to original token
        }
      }

      // Execute gRPC call with retry logic
      const result = await this.executeGRPCWithRetry<T>(authToken, params);

      auditEntry.success = true;
      auditEntry.metadata = {
        method: params.method,
        serviceName: this.config.serviceName,
      };

      return {
        success: true,
        data: result as T,
        auditTrail: auditEntry,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown gRPC error';
      auditEntry.error = errorMessage;

      if (error instanceof GRPCError) {
        auditEntry.metadata = {
          grpcCode: error.code,
          grpcDetails: error.details,
        };
      }

      return {
        success: false,
        error: errorMessage,
        auditTrail: auditEntry,
      };
    }
  }

  /**
   * Execute gRPC call with exponential backoff retry
   */
  private async executeGRPCWithRetry<T>(
    authToken: string,
    request: GRPCRequest
  ): Promise<T> {
    if (!this.config) {
      throw new Error('GRPCDelegationModule not initialized');
    }

    let lastError: Error | null = null;
    const maxRetries = this.config.maxRetries || 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.executeGRPC<T>(authToken, request);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');

        // Only retry on transient errors
        if (error instanceof GRPCError) {
          const isRetryable = [
            GRPCStatus.UNAVAILABLE,
            GRPCStatus.DEADLINE_EXCEEDED,
            GRPCStatus.UNKNOWN,
          ].includes(error.code);

          if (!isRetryable || attempt === maxRetries - 1) {
            throw error;
          }

          // Exponential backoff: 100ms, 200ms, 400ms...
          const delayMs = 100 * Math.pow(2, attempt);
          console.log(`[GRPCDelegation] Retry attempt ${attempt + 1}/${maxRetries} after ${delayMs}ms`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        } else {
          throw error;
        }
      }
    }

    throw lastError || new Error('gRPC call failed after retries');
  }

  /**
   * Execute a single gRPC call
   *
   * Note: This is a mock implementation. In production, use @grpc/grpc-js:
   *
   * import * as grpc from '@grpc/grpc-js';
   * import * as protoLoader from '@grpc/proto-loader';
   *
   * const packageDefinition = protoLoader.loadSync('service.proto');
   * const proto = grpc.loadPackageDefinition(packageDefinition);
   * const client = new proto.MyService(serviceUrl, credentials);
   *
   * const metadata = new grpc.Metadata();
   * metadata.add('authorization', `Bearer ${authToken}`);
   *
   * return new Promise((resolve, reject) => {
   *   client.MyMethod(request.message, metadata, (err, response) => {
   *     if (err) reject(new GRPCError(err.code, err.message));
   *     else resolve(response);
   *   });
   * });
   */
  private async executeGRPC<T>(
    authToken: string,
    request: GRPCRequest
  ): Promise<T> {
    if (!this.config) {
      throw new Error('GRPCDelegationModule not initialized');
    }

    console.log(`[GRPCDelegation] Executing ${this.config.serviceName}.${request.method}`);

    // Mock implementation - replace with actual gRPC client in production
    return new Promise((resolve, reject) => {
      // Simulate gRPC call
      setTimeout(() => {
        // Mock successful response
        resolve({
          status: 'success',
          message: `Mock response from ${request.method}`,
          data: request.message,
        } as T);
      }, 100);
    });

    // Production implementation would look like:
    /*
    const metadata: Record<string, string> = {
      'authorization': `Bearer ${authToken}`,
      ...this.config.metadata,
      ...request.metadata,
    };

    // Use actual gRPC client here
    const response = await grpcClient.call(request.method, request.message, metadata);
    return response;
    */
  }

  async healthCheck(): Promise<boolean> {
    if (!this.config) {
      return false;
    }

    try {
      // Try a health check RPC (if service implements grpc.health.v1.Health)
      // In production, use: grpcHealthClient.Check({ service: '' })
      return true;
    } catch {
      return false;
    }
  }

  async destroy(): Promise<void> {
    // In production, close gRPC channels here
    this.config = null;
    console.log(`[GRPCDelegation] Destroyed`);
  }
}

/**
 * Example Usage
 *
 * This demonstrates how to use the gRPC delegation module with the framework.
 */

/*
import { createDelegationTool } from '../src/mcp/tools/delegation-tool-factory.js';
import { z } from 'zod';

// 1. Create and initialize the gRPC delegation module
const grpcModule = new GRPCDelegationModule();
await grpcModule.initialize({
  serviceUrl: 'api.example.com:50051',
  serviceName: 'UserService',
  audience: 'urn:grpc:userservice',
  scope: 'grpc:call',
  useTLS: true,
  timeout: 30000,
  maxRetries: 3,
  metadata: {
    'x-client-version': '1.0.0',
  },
});

// 2. Register module with delegation registry
const coreContext = server.getCoreContext();
coreContext.delegationRegistry.register(grpcModule);

// 3. Create MCP tools using the factory

// Example Tool 1: Get user by ID (unary RPC)
const getUserTool = createDelegationTool('grpc', {
  name: 'grpc-get-user',
  description: 'Get user information via gRPC',

  parameters: z.object({
    userId: z.string().describe('User ID'),
  }),

  action: 'GetUser',
  requiredPermission: 'grpc:read',

  // Transform MCP parameters to gRPC request
  transformParams: (params) => ({
    method: 'GetUser',
    message: {
      user_id: params.userId,
    },
  }),

  // Transform gRPC response for LLM
  transformResult: (result: any) => ({
    user: {
      id: result.id,
      name: result.name,
      email: result.email,
      roles: result.roles || [],
    },
  }),
}, coreContext);

// Example Tool 2: Create user (unary RPC with validation)
const createUserTool = createDelegationTool('grpc', {
  name: 'grpc-create-user',
  description: 'Create a new user via gRPC',

  parameters: z.object({
    name: z.string().min(1).describe('User full name'),
    email: z.string().email().describe('User email address'),
    department: z.string().describe('Department'),
  }),

  action: 'CreateUser',
  requiredPermission: 'grpc:write',
  requiredRoles: ['admin', 'hr'],

  transformParams: (params) => ({
    method: 'CreateUser',
    message: {
      name: params.name,
      email: params.email,
      department: params.department,
    },
  }),

  transformResult: (result: any) => {
    if (result.error) {
      throw new Error(`User creation failed: ${result.error}`);
    }
    return {
      userId: result.user_id,
      message: 'User created successfully',
    };
  },
}, coreContext);

// Example Tool 3: List users with pagination (unary RPC)
const listUsersTool = createDelegationTool('grpc', {
  name: 'grpc-list-users',
  description: 'List users with pagination',

  parameters: z.object({
    pageSize: z.number().min(1).max(100).default(10).describe('Page size'),
    pageToken: z.string().optional().describe('Page token for pagination'),
    filter: z.string().optional().describe('Filter expression'),
  }),

  action: 'ListUsers',
  requiredPermission: 'grpc:read',

  transformParams: (params) => ({
    method: 'ListUsers',
    message: {
      page_size: params.pageSize,
      page_token: params.pageToken || '',
      filter: params.filter || '',
    },
  }),

  transformResult: (result: any) => ({
    users: result.users || [],
    nextPageToken: result.next_page_token,
    totalCount: result.total_count,
  }),
}, coreContext);

// Example Tool 4: Batch operation
const batchUpdateRolesTool = createDelegationTool('grpc', {
  name: 'grpc-batch-update-roles',
  description: 'Update roles for multiple users in batch',

  parameters: z.object({
    updates: z.array(z.object({
      userId: z.string(),
      roles: z.array(z.string()),
    })).describe('Array of user role updates'),
  }),

  action: 'BatchUpdateRoles',
  requiredPermission: 'grpc:write',
  requiredRoles: ['admin'],

  transformParams: (params) => ({
    method: 'BatchUpdateRoles',
    message: {
      updates: params.updates.map(u => ({
        user_id: u.userId,
        roles: u.roles,
      })),
    },
  }),

  transformResult: (result: any) => ({
    successCount: result.success_count,
    failureCount: result.failure_count,
    errors: result.errors || [],
  }),
}, coreContext);

// 4. Register all tools with the server
server.registerTools([
  getUserTool,
  createUserTool,
  listUsersTool,
  batchUpdateRolesTool,
]);

console.log('gRPC delegation tools registered successfully');

// Production notes:
// 1. Install @grpc/grpc-js and @grpc/proto-loader
// 2. Define your service in .proto files
// 3. Generate TypeScript types from proto files
// 4. Replace mock implementation with real gRPC client
// 5. Implement proper error handling for gRPC status codes
// 6. Consider implementing client-side streaming and server-side streaming
*/
