/**
 * REST API Delegation Example
 *
 * Demonstrates how to create a custom delegation module that integrates with a REST API backend.
 * This example shows:
 * - Creating a custom DelegationModule
 * - Using TokenExchangeService for API authentication
 * - Creating tools with createDelegationTool() factory
 * - Handling API errors gracefully
 *
 * Use Case: Your organization has an internal REST API that requires JWT authentication.
 * The MCP server exchanges the user's JWT for an API-specific token and makes authorized requests.
 */

import { MCPOAuthServer, createDelegationTool, type DelegationModule, type DelegationResult } from '../src/index.js';
import type { UserSession, AuditEntry } from '../src/core/index.js';
import { z } from 'zod';

// ============================================================================
// REST API Delegation Module
// ============================================================================

interface RestAPIConfig {
  baseUrl: string;
  apiKey?: string;
  useTokenExchange: boolean;
  tokenExchangeAudience?: string;
}

/**
 * REST API delegation module
 *
 * This module demonstrates how to integrate with an external REST API using:
 * - Optional token exchange for API-specific JWTs
 * - API key authentication as fallback
 * - Proper error handling and audit logging
 */
export class RestAPIDelegationModule implements DelegationModule {
  readonly name = 'rest-api';
  readonly type = 'api';

  private config: RestAPIConfig | null = null;

  /**
   * Initialize module
   */
  async initialize(config: RestAPIConfig): Promise<void> {
    this.config = config;
    console.log(`[RestAPI] Module initialized: ${config.baseUrl}`);
    console.log(`[RestAPI] Token exchange: ${config.useTokenExchange ? 'enabled' : 'disabled'}`);
  }

  /**
   * Delegate action to REST API
   *
   * Supports two authentication modes:
   * 1. Token exchange: Exchange requestor JWT for API-specific token
   * 2. API key: Use static API key for authentication
   */
  async delegate<T = unknown>(
    session: UserSession,
    action: string,
    params: any,
    context?: {
      sessionId?: string;
      coreContext?: any;
    }
  ): Promise<DelegationResult<T>> {
    if (!this.config) {
      throw new Error('RestAPIDelegationModule not initialized');
    }

    const auditEntry: AuditEntry = {
      timestamp: new Date(),
      source: 'delegation:rest-api',
      userId: session.userId,
      action: `rest-api:${action}`,
      success: false,
      metadata: { action, params },
    };

    try {
      // Step 1: Determine authentication method
      let authHeader: string;

      if (this.config.useTokenExchange && context?.coreContext?.tokenExchangeService) {
        // Use token exchange
        console.log('[RestAPI] Using token exchange for authentication');
        const delegationToken = await this.performTokenExchange(session, context);
        authHeader = `Bearer ${delegationToken}`;
        auditEntry.metadata = { ...auditEntry.metadata, authMethod: 'token-exchange' };
      } else if (this.config.apiKey) {
        // Use API key fallback
        console.log('[RestAPI] Using API key for authentication');
        authHeader = `Bearer ${this.config.apiKey}`;
        auditEntry.metadata = { ...auditEntry.metadata, authMethod: 'api-key' };
      } else {
        throw new Error('No authentication method configured (need token exchange or API key)');
      }

      // Step 2: Make API request
      const endpoint = params.endpoint || action;
      const method = params.method || 'POST';
      const url = `${this.config.baseUrl}/${endpoint}`;

      console.log(`[RestAPI] ${method} ${url}`);

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader,
          'X-User-ID': session.userId,
          'X-User-Role': session.role,
        },
        body: method !== 'GET' ? JSON.stringify(params.data || {}) : undefined,
      });

      // Step 3: Handle response
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`API error: ${response.status} ${response.statusText} - ${errorBody}`);
      }

      const data = await response.json();

      auditEntry.success = true;
      auditEntry.metadata = {
        ...auditEntry.metadata,
        statusCode: response.status,
        endpoint,
        method,
      };

      return {
        success: true,
        data: data as T,
        auditTrail: auditEntry,
      };
    } catch (error) {
      auditEntry.error = error instanceof Error ? error.message : 'Unknown error';
      console.error('[RestAPI] Error:', auditEntry.error);

      return {
        success: false,
        error: auditEntry.error,
        auditTrail: auditEntry,
      };
    }
  }

  /**
   * Perform token exchange to get API-specific JWT
   */
  private async performTokenExchange(
    session: UserSession,
    context: { sessionId?: string; coreContext?: any }
  ): Promise<string> {
    const tokenExchangeService = context.coreContext?.tokenExchangeService;
    if (!tokenExchangeService) {
      throw new Error('TokenExchangeService not available');
    }

    const requestorJWT = session.claims?.access_token as string;
    if (!requestorJWT) {
      throw new Error('Session missing access_token for token exchange');
    }

    // Exchange requestor JWT for API-specific token
    const delegationToken = await tokenExchangeService.performExchange({
      requestorJWT,
      audience: this.config?.tokenExchangeAudience || 'urn:api:rest',
      scope: 'api:read api:write',
      sessionId: context.sessionId, // Enable token caching
    });

    return delegationToken;
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    if (!this.config) {
      return false;
    }

    try {
      const response = await fetch(`${this.config.baseUrl}/health`, {
        method: 'GET',
        headers: this.config.apiKey ? { 'Authorization': `Bearer ${this.config.apiKey}` } : {},
      });
      return response.ok;
    } catch (error) {
      console.error('[RestAPI] Health check failed:', error);
      return false;
    }
  }

  /**
   * Cleanup
   */
  async destroy(): Promise<void> {
    console.log('[RestAPI] Module destroyed');
    this.config = null;
  }
}

// ============================================================================
// Example Usage
// ============================================================================

async function main() {
  console.log('='.repeat(80));
  console.log('REST API Delegation Example');
  console.log('='.repeat(80));

  // Step 1: Create MCP OAuth Server
  const server = new MCPOAuthServer({
    configPath: './test-harness/config/v2-keycloak-token-exchange.json',
  });

  await server.start();
  console.log('[Example] ✓ Server started');

  // Step 2: Get CoreContext
  const coreContext = server.getCoreContext();

  // Step 3: Create and register REST API module
  const restApiModule = new RestAPIDelegationModule();
  coreContext.delegationRegistry.register(restApiModule);

  await restApiModule.initialize({
    baseUrl: 'https://api.example.com',
    useTokenExchange: true,
    tokenExchangeAudience: 'urn:api:example',
    // Alternative: Use API key instead of token exchange
    // apiKey: process.env.API_KEY,
    // useTokenExchange: false,
  });
  console.log('[Example] ✓ REST API module registered');

  // Step 4: Create tools using factory

  // Tool 1: Get user profile from API
  const getUserProfileTool = createDelegationTool(
    'rest-api',
    {
      name: 'get-user-profile',
      description: 'Get user profile from backend API',
      parameters: z.object({
        userId: z.string().describe('User ID to fetch'),
      }),
      action: 'users/profile',
      requiredPermission: 'api:read',

      // Transform parameters for API
      transformParams: (params) => ({
        endpoint: `users/${params.userId}/profile`,
        method: 'GET',
      }),

      // Transform API response for LLM
      transformResult: (apiResponse: any) => ({
        displayName: apiResponse.fullName,
        email: apiResponse.email,
        department: apiResponse.department,
        // Hide sensitive fields
      }),
    },
    coreContext
  );

  // Tool 2: Update user settings
  const updateUserSettingsTool = createDelegationTool(
    'rest-api',
    {
      name: 'update-user-settings',
      description: 'Update user settings in backend API',
      parameters: z.object({
        userId: z.string().describe('User ID'),
        settings: z.record(z.any()).describe('Settings to update'),
      }),
      action: 'users/settings',
      requiredPermission: 'api:write',
      requiredRoles: ['user', 'admin'],

      // Transform parameters for API
      transformParams: (params) => ({
        endpoint: `users/${params.userId}/settings`,
        method: 'PUT',
        data: params.settings,
      }),
    },
    coreContext
  );

  // Tool 3: Search API data
  const searchDataTool = createDelegationTool(
    'rest-api',
    {
      name: 'search-api-data',
      description: 'Search for data in backend API',
      parameters: z.object({
        query: z.string().describe('Search query'),
        filters: z.record(z.any()).optional().describe('Optional filters'),
      }),
      action: 'search',
      requiredPermission: 'api:read',

      transformParams: (params) => ({
        endpoint: 'search',
        method: 'POST',
        data: {
          q: params.query,
          filters: params.filters || {},
        },
      }),
    },
    coreContext
  );

  // Step 5: Register tools
  server.registerTools([
    getUserProfileTool,
    updateUserSettingsTool,
    searchDataTool,
  ]);
  console.log('[Example] ✓ REST API tools registered');

  // Step 6: List registered tools
  console.log('\n' + '='.repeat(80));
  console.log('Registered MCP Tools:');
  console.log('='.repeat(80));

  const tools = [
    { name: 'get-user-profile', description: 'Get user profile from backend API' },
    { name: 'update-user-settings', description: 'Update user settings (requires api:write permission)' },
    { name: 'search-api-data', description: 'Search for data in backend API' },
  ];

  tools.forEach(tool => {
    console.log(`✓ ${tool.name}`);
    console.log(`  ${tool.description}`);
  });

  console.log('\n' + '='.repeat(80));
  console.log('Example Complete!');
  console.log('='.repeat(80));
  console.log('\nKey Takeaways:');
  console.log('1. Custom delegation modules integrate with any REST API');
  console.log('2. Token exchange provides API-specific JWT authentication');
  console.log('3. createDelegationTool() factory reduces boilerplate to ~10 lines per tool');
  console.log('4. Parameter and result transformation keeps tools LLM-friendly');
  console.log('5. All OAuth security (auth, authz, audit) handled automatically');

  console.log('\nTo use these tools:');
  console.log('1. Start the MCP server (already running)');
  console.log('2. Connect MCP client with valid JWT token');
  console.log('3. Client sees tools if user has required permissions');
  console.log('4. LLM can call tools - server validates JWT and makes API requests');

  // Keep server running
  console.log('\n[Example] Server running... Press Ctrl+C to stop');
}

// Run example if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Error running example:', error);
    process.exit(1);
  });
}

export { RestAPIDelegationModule };
