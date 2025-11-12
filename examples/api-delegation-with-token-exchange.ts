/**
 * API Delegation with Token Exchange Example
 *
 * This example demonstrates Phase 2 enhancement: Custom delegation modules
 * accessing TokenExchangeService via CoreContext injection.
 *
 * Scenario:
 * - MCP server receives user's JWT from IDP (e.g., Keycloak)
 * - Custom API delegation module needs to call downstream API
 * - Downstream API requires different JWT claims/audience than user's token
 * - Module uses TokenExchangeService to exchange user JWT for API-specific token
 * - API token is cached for performance (automatic invalidation on JWT refresh)
 *
 * Key Features:
 * - CoreContext injection (Phase 2)
 * - Token exchange for API authentication
 * - Token caching with AAD binding
 * - Automatic cache invalidation on JWT refresh
 * - Fallback to API key if token exchange unavailable
 */

import type { DelegationModule, DelegationResult } from '../src/delegation/base.js';
import type { UserSession, AuditEntry } from '../src/core/index.js';

// ============================================================================
// API Delegation Module with Token Exchange
// ============================================================================

interface APIDelegationConfig {
  apiBaseUrl: string;
  apiKey?: string; // Fallback if token exchange unavailable
  tokenExchange?: {
    audience: string;
    scope?: string;
  };
}

/**
 * API delegation module demonstrating TokenExchangeService usage
 *
 * This module shows how to:
 * 1. Access TokenExchangeService via context.coreContext
 * 2. Exchange requestor JWT for API-specific token
 * 3. Use sessionId for token caching
 * 4. Handle token exchange errors gracefully
 * 5. Fallback to API key authentication
 */
export class APIDelegationModule implements DelegationModule {
  readonly name = 'api-with-token-exchange';
  readonly type = 'api';

  private config: APIDelegationConfig | null = null;

  async initialize(config: APIDelegationConfig): Promise<void> {
    this.config = config;
    console.log('[APIModule] Module initialized');
    console.log('[APIModule] API Base URL:', config.apiBaseUrl);
    console.log('[APIModule] Token Exchange:', config.tokenExchange ? 'enabled' : 'disabled');
  }

  /**
   * Delegate API call with token exchange
   *
   * Phase 2 Enhancement: Receives CoreContext via context parameter
   */
  async delegate<T = unknown>(
    session: UserSession,
    action: string,
    params: any,
    context?: {
      sessionId?: string;      // For token caching
      coreContext?: any;       // Contains TokenExchangeService
    }
  ): Promise<DelegationResult<T>> {
    if (!this.config) {
      throw new Error('APIDelegationModule not initialized');
    }

    const auditEntry: AuditEntry = {
      timestamp: new Date(),
      source: 'delegation:api-with-token-exchange',
      userId: session.userId,
      action: `api:${action}`,
      success: false,
      metadata: { action, hasContext: !!context },
    };

    try {
      // Step 1: Determine authentication method
      let authToken: string;
      let authMethod: string;

      // Try token exchange first (if available)
      if (this.config.tokenExchange && context?.coreContext?.tokenExchangeService) {
        console.log('[APIModule] Using token exchange for authentication');
        authToken = await this.performTokenExchange(session, context);
        authMethod = 'token-exchange';
      }
      // Fallback to API key
      else if (this.config.apiKey) {
        console.log('[APIModule] Falling back to API key authentication');
        authToken = this.config.apiKey;
        authMethod = 'api-key';
      }
      // No authentication available
      else {
        throw new Error('No authentication method available (need token exchange or API key)');
      }

      // Step 2: Make API request
      const endpoint = params.endpoint || action;
      const method = params.method || 'POST';
      const url = `${this.config.apiBaseUrl}/${endpoint}`;

      console.log(`[APIModule] ${method} ${url}`);
      console.log(`[APIModule] Auth method: ${authMethod}`);

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
          'X-User-ID': session.userId,
          'X-Session-ID': context?.sessionId || 'unknown',
        },
        body: method !== 'GET' ? JSON.stringify(params.data || {}) : undefined,
      });

      // Step 3: Handle response
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();

      auditEntry.success = true;
      auditEntry.metadata = {
        ...auditEntry.metadata,
        authMethod,
        statusCode: response.status,
        endpoint,
        usedTokenExchange: authMethod === 'token-exchange',
        usedCache: context?.sessionId ? 'possible' : 'disabled',
      };

      return {
        success: true,
        data: data as T,
        auditTrail: auditEntry,
      };
    } catch (error) {
      auditEntry.error = error instanceof Error ? error.message : 'Unknown error';
      console.error('[APIModule] Delegation error:', auditEntry.error);

      return {
        success: false,
        error: auditEntry.error,
        auditTrail: auditEntry,
      };
    }
  }

  /**
   * Perform token exchange to get API-specific JWT
   *
   * This is the key Phase 2 enhancement - accessing TokenExchangeService
   * via CoreContext injection.
   */
  private async performTokenExchange(
    session: UserSession,
    context: { sessionId?: string; coreContext?: any }
  ): Promise<string> {
    // Access TokenExchangeService from CoreContext
    const tokenExchangeService = context.coreContext?.tokenExchangeService;
    if (!tokenExchangeService) {
      throw new Error('TokenExchangeService not available in CoreContext');
    }

    // Extract requestor JWT from session
    const requestorJWT = session.claims?.access_token as string;
    if (!requestorJWT) {
      throw new Error('Session missing access_token claim for token exchange');
    }

    console.log('[APIModule] Performing token exchange...');
    console.log('[APIModule] Token Exchange Config:', {
      audience: this.config?.tokenExchange?.audience,
      scope: this.config?.tokenExchange?.scope,
      hasSessionId: !!context.sessionId,
    });

    // Perform token exchange
    // If sessionId is provided, the exchanged token will be cached
    // Cache is automatically invalidated when requestor JWT changes (AAD binding)
    const delegationToken = await tokenExchangeService.performExchange({
      requestorJWT,
      audience: this.config!.tokenExchange!.audience,
      scope: this.config!.tokenExchange!.scope || 'api:read api:write',
      sessionId: context.sessionId, // CRITICAL: Enables token caching
    });

    console.log('[APIModule] ✓ Token exchange successful');
    return delegationToken;
  }

  async healthCheck(): Promise<boolean> {
    if (!this.config) {
      return false;
    }

    try {
      const response = await fetch(`${this.config.apiBaseUrl}/health`, {
        method: 'GET',
        headers: this.config.apiKey
          ? { 'Authorization': `Bearer ${this.config.apiKey}` }
          : {},
      });
      return response.ok;
    } catch (error) {
      console.error('[APIModule] Health check failed:', error);
      return false;
    }
  }

  async destroy(): Promise<void> {
    console.log('[APIModule] Module destroyed');
    this.config = null;
  }
}

// ============================================================================
// Example Usage
// ============================================================================

/**
 * Example: Using the API delegation module with token exchange
 */
export async function demonstrateTokenExchangeUsage() {
  console.log('='.repeat(80));
  console.log('Phase 2: Token Exchange Context Example');
  console.log('='.repeat(80));
  console.log();

  // This example demonstrates:
  // 1. How custom modules receive CoreContext
  // 2. How to access TokenExchangeService
  // 3. How token caching works with sessionId
  // 4. Automatic cache invalidation on JWT refresh

  console.log('Module Features:');
  console.log('✓ Access TokenExchangeService via context.coreContext');
  console.log('✓ Exchange user JWT for API-specific token');
  console.log('✓ Token caching with sessionId (reduces IDP load)');
  console.log('✓ Automatic cache invalidation on JWT refresh (AAD binding)');
  console.log('✓ Fallback to API key if token exchange unavailable');
  console.log();

  console.log('Example Flow:');
  console.log('1. User authenticates to MCP server with JWT from IDP');
  console.log('2. MCP tool calls module.delegate(session, action, params, context)');
  console.log('3. Module accesses context.coreContext.tokenExchangeService');
  console.log('4. Module exchanges user JWT for API-specific token');
  console.log('5. Exchanged token is cached (key: sessionId + audience)');
  console.log('6. Module makes API request with exchanged token');
  console.log('7. Subsequent requests use cached token (<2ms vs 150-300ms)');
  console.log('8. User refreshes JWT → AAD mismatch → cache invalidated → new exchange');
  console.log();

  console.log('Code Example:');
  console.log(`
// In your MCP server setup:
import { FastMCPOAuthServer } from 'fastmcp-oauth';
import { APIDelegationModule } from './examples/api-delegation-with-token-exchange.js';

const server = new FastMCPOAuthServer({ configPath: './config.json' });
await server.start();

const coreContext = server.getCoreContext();

// Register API module
const apiModule = new APIDelegationModule();
coreContext.delegationRegistry.register(apiModule);

await apiModule.initialize({
  apiBaseUrl: 'https://api.internal.com',
  tokenExchange: {
    audience: 'urn:api:internal',
    scope: 'api:read api:write',
  },
  // Fallback if token exchange not configured:
  // apiKey: process.env.API_KEY,
});

// Create tool using factory
import { createDelegationTool } from 'fastmcp-oauth';

const apiTool = createDelegationTool('api-with-token-exchange', {
  name: 'call-internal-api',
  description: 'Call internal API with token exchange',
  parameters: z.object({
    endpoint: z.string(),
    data: z.record(z.any()).optional(),
  }),
  action: 'call',
  requiredPermission: 'api:execute',
}, coreContext);

server.registerTool(apiTool);

// When tool is called:
// 1. DelegationRegistry passes CoreContext to module
// 2. Module uses TokenExchangeService for API token
// 3. Token is cached for subsequent calls
// 4. Cache invalidated automatically on JWT refresh
  `);

  console.log();
  console.log('Configuration (config.json):');
  console.log(`
{
  "auth": {
    "trustedIDPs": [{
      "issuer": "https://auth.company.com",
      "jwksUri": "https://auth.company.com/.well-known/jwks.json",
      "audience": "mcp-server-api"
    }]
  },
  "delegation": {
    "tokenExchange": {
      "tokenEndpoint": "https://auth.company.com/oauth/token",
      "clientId": "mcp-server",
      "clientSecret": "SECRET",
      "audience": "urn:api:internal",
      "cache": {
        "enabled": true,
        "ttlSeconds": 60
      }
    }
  }
}
  `);

  console.log('='.repeat(80));
  console.log('Key Takeaways:');
  console.log('='.repeat(80));
  console.log('1. CoreContext injection enables framework service access');
  console.log('2. TokenExchangeService handles OAuth token exchange (RFC 8693)');
  console.log('3. Token caching reduces IDP load by 81% (with AAD security)');
  console.log('4. Automatic invalidation prevents stale token usage');
  console.log('5. Backward compatible (context parameter is optional)');
  console.log();
}

// Run demonstration if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  demonstrateTokenExchangeUsage().catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });
}
