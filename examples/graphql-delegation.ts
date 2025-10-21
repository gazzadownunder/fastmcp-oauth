/**
 * GraphQL Delegation Example
 *
 * This example demonstrates how to create a delegation module that integrates
 * with GraphQL APIs, using token exchange for authentication.
 *
 * Use Case: Delegate MCP tool calls to a GraphQL backend API with OAuth token exchange
 *
 * Features:
 * - Token exchange for GraphQL-specific JWT
 * - GraphQL query and mutation support
 * - Variable parameterization
 * - Error handling with GraphQL error format
 * - Result transformation from GraphQL response
 */

import type { DelegationModule, DelegationResult } from '../src/delegation/base.js';
import type { UserSession, AuditEntry } from '../src/core/index.js';
import type { CoreContext } from '../src/core/types.js';

/**
 * GraphQL delegation module configuration
 */
export interface GraphQLDelegationConfig {
  endpoint: string;                    // GraphQL endpoint URL
  audience?: string;                   // OAuth audience for token exchange
  scope?: string;                      // OAuth scope for token exchange
  headers?: Record<string, string>;    // Additional headers
  timeout?: number;                    // Request timeout in milliseconds
}

/**
 * GraphQL request parameters
 */
export interface GraphQLRequest {
  query: string;                       // GraphQL query or mutation
  variables?: Record<string, any>;     // Query variables
  operationName?: string;              // Operation name (for multi-operation documents)
}

/**
 * GraphQL response format
 */
export interface GraphQLResponse<T = any> {
  data?: T;
  errors?: Array<{
    message: string;
    locations?: Array<{ line: number; column: number }>;
    path?: Array<string | number>;
    extensions?: Record<string, any>;
  }>;
}

/**
 * GraphQL Delegation Module
 *
 * Delegates MCP operations to a GraphQL API with OAuth token exchange.
 */
export class GraphQLDelegationModule implements DelegationModule {
  readonly name = 'graphql';
  readonly type = 'api';

  private config: GraphQLDelegationConfig | null = null;

  async initialize(config: GraphQLDelegationConfig): Promise<void> {
    if (!config.endpoint) {
      throw new Error('GraphQL endpoint is required');
    }

    if (!config.endpoint.startsWith('https://')) {
      throw new Error('GraphQL endpoint must use HTTPS');
    }

    this.config = {
      ...config,
      timeout: config.timeout || 30000, // Default 30 second timeout
    };

    console.log(`[GraphQLDelegation] Initialized with endpoint: ${config.endpoint}`);
  }

  async delegate<T>(
    session: UserSession,
    action: string,
    params: GraphQLRequest,
    context?: { sessionId?: string; coreContext?: CoreContext }
  ): Promise<DelegationResult<T>> {
    const auditEntry: AuditEntry = {
      timestamp: new Date(),
      source: 'delegation:graphql',
      userId: session.userId,
      action: `graphql:${action}`,
      success: false,
    };

    try {
      if (!this.config) {
        throw new Error('GraphQLDelegationModule not initialized');
      }

      // Validate GraphQL request
      if (!params.query) {
        throw new Error('GraphQL query is required');
      }

      // Get authentication token (preferably via token exchange)
      let authToken = session.claims.rawPayload || '';

      if (context?.coreContext?.tokenExchangeService && this.config.audience) {
        console.log(`[GraphQLDelegation] Exchanging token for audience: ${this.config.audience}`);

        try {
          authToken = await context.coreContext.tokenExchangeService.performExchange({
            requestorJWT: session.claims.rawPayload || '',
            audience: this.config.audience,
            scope: this.config.scope || 'graphql:read graphql:write',
            sessionId: context.sessionId,
          });
        } catch (exchangeError) {
          console.warn(`[GraphQLDelegation] Token exchange failed, using original token:`, exchangeError);
          // Fall back to original token
        }
      }

      // Execute GraphQL request
      const result = await this.executeGraphQL<T>(authToken, params);

      auditEntry.success = true;
      auditEntry.metadata = {
        operationName: params.operationName,
        hasVariables: !!params.variables && Object.keys(params.variables).length > 0,
      };

      return {
        success: true,
        data: result as T,
        auditTrail: auditEntry,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown GraphQL error';
      auditEntry.error = errorMessage;

      return {
        success: false,
        error: errorMessage,
        auditTrail: auditEntry,
      };
    }
  }

  /**
   * Execute a GraphQL request
   */
  private async executeGraphQL<T>(
    authToken: string,
    request: GraphQLRequest
  ): Promise<T> {
    if (!this.config) {
      throw new Error('GraphQLDelegationModule not initialized');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${authToken}`,
      ...this.config.headers,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query: request.query,
          variables: request.variables,
          operationName: request.operationName,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`);
      }

      const graphqlResponse: GraphQLResponse<T> = await response.json();

      // Check for GraphQL errors
      if (graphqlResponse.errors && graphqlResponse.errors.length > 0) {
        const errorMessages = graphqlResponse.errors.map(e => e.message).join('; ');
        throw new Error(`GraphQL errors: ${errorMessages}`);
      }

      if (!graphqlResponse.data) {
        throw new Error('GraphQL response contains no data');
      }

      return graphqlResponse.data;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.config) {
      return false;
    }

    try {
      // Try a simple introspection query
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      try {
        const response = await fetch(this.config.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: '{ __typename }',
          }),
          signal: controller.signal,
        });

        return response.ok;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch {
      return false;
    }
  }

  async destroy(): Promise<void> {
    this.config = null;
    console.log(`[GraphQLDelegation] Destroyed`);
  }
}

/**
 * Example Usage
 *
 * This demonstrates how to use the GraphQL delegation module with the framework.
 */

/*
import { createDelegationTool } from '../src/mcp/tools/delegation-tool-factory.js';
import { z } from 'zod';

// 1. Create and initialize the GraphQL delegation module
const graphqlModule = new GraphQLDelegationModule();
await graphqlModule.initialize({
  endpoint: 'https://api.example.com/graphql',
  audience: 'urn:api:graphql',
  scope: 'graphql:read graphql:write',
  headers: {
    'X-API-Version': '2024-01',
  },
  timeout: 30000,
});

// 2. Register module with delegation registry
const coreContext = server.getCoreContext();
coreContext.delegationRegistry.register(graphqlModule);

// 3. Create MCP tools using the factory

// Example Tool 1: Query user profile
const getUserProfileTool = createDelegationTool('graphql', {
  name: 'graphql-get-user',
  description: 'Get user profile from GraphQL API',

  parameters: z.object({
    userId: z.string().describe('User ID to query'),
  }),

  action: 'query',
  requiredPermission: 'graphql:read',

  // Transform MCP parameters to GraphQL request
  transformParams: (params) => ({
    query: `
      query GetUser($userId: ID!) {
        user(id: $userId) {
          id
          name
          email
          department
          roles
        }
      }
    `,
    variables: { userId: params.userId },
    operationName: 'GetUser',
  }),

  // Transform GraphQL response for LLM
  transformResult: (result: any) => ({
    user: result.user,
  }),
}, coreContext);

// Example Tool 2: Create a new project (mutation)
const createProjectTool = createDelegationTool('graphql', {
  name: 'graphql-create-project',
  description: 'Create a new project via GraphQL API',

  parameters: z.object({
    name: z.string().describe('Project name'),
    description: z.string().describe('Project description'),
    ownerId: z.string().describe('Project owner user ID'),
  }),

  action: 'mutation',
  requiredPermission: 'graphql:write',
  requiredRoles: ['admin', 'project-manager'],

  // Transform MCP parameters to GraphQL mutation
  transformParams: (params) => ({
    query: `
      mutation CreateProject($input: CreateProjectInput!) {
        createProject(input: $input) {
          project {
            id
            name
            description
            owner {
              id
              name
            }
            createdAt
          }
          errors {
            field
            message
          }
        }
      }
    `,
    variables: {
      input: {
        name: params.name,
        description: params.description,
        ownerId: params.ownerId,
      },
    },
    operationName: 'CreateProject',
  }),

  // Transform GraphQL response
  transformResult: (result: any) => {
    if (result.createProject.errors?.length > 0) {
      throw new Error(`Validation errors: ${result.createProject.errors.map((e: any) => e.message).join(', ')}`);
    }
    return {
      project: result.createProject.project,
    };
  },
}, coreContext);

// Example Tool 3: Search projects
const searchProjectsTool = createDelegationTool('graphql', {
  name: 'graphql-search-projects',
  description: 'Search projects by keyword',

  parameters: z.object({
    keyword: z.string().describe('Search keyword'),
    limit: z.number().min(1).max(100).default(10).describe('Maximum results'),
  }),

  action: 'query',
  requiredPermission: 'graphql:read',

  transformParams: (params) => ({
    query: `
      query SearchProjects($keyword: String!, $limit: Int!) {
        searchProjects(keyword: $keyword, limit: $limit) {
          edges {
            node {
              id
              name
              description
              status
              owner {
                id
                name
              }
            }
          }
          totalCount
        }
      }
    `,
    variables: {
      keyword: params.keyword,
      limit: params.limit,
    },
    operationName: 'SearchProjects',
  }),

  transformResult: (result: any) => ({
    projects: result.searchProjects.edges.map((e: any) => e.node),
    totalCount: result.searchProjects.totalCount,
  }),
}, coreContext);

// 4. Register all tools with the server
server.registerTools([
  getUserProfileTool,
  createProjectTool,
  searchProjectsTool,
]);

console.log('GraphQL delegation tools registered successfully');
*/
