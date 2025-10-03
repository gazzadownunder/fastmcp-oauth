/**
 * Example: Custom Delegation Module
 *
 * This example demonstrates creating a custom delegation module
 * for API-based delegation (e.g., calling a legacy REST API on behalf of a user).
 */

import {
  DelegationModule,
  DelegationResult,
  DelegationRegistry
} from '../src/delegation/index.js';

import {
  AuditService,
  type UserSession,
  type AuditEntry
} from '../src/core/index.js';

/**
 * Custom configuration for API delegation
 */
interface APIConfig {
  baseUrl: string;
  timeout?: number;
  headers?: Record<string, string>;
}

/**
 * Custom API Delegation Module
 *
 * This module calls a legacy REST API using the user's legacy credentials.
 */
class APIDelegationModule implements DelegationModule {
  public readonly name = 'api';
  public readonly type = 'rest-api';

  private config?: APIConfig;

  async initialize(config: any): Promise<void> {
    this.config = config as APIConfig;
    console.log(`API Delegation Module initialized: ${this.config.baseUrl}`);
  }

  async delegate<T>(
    session: UserSession,
    action: string,
    params: any
  ): Promise<DelegationResult<T>> {
    if (!this.config) {
      throw new Error('API module not initialized');
    }

    // Create audit entry
    const auditEntry: AuditEntry = {
      timestamp: new Date(),
      userId: session.userId,
      action: `api:${action}`,
      resource: params.endpoint || 'api',
      success: false,
      source: 'delegation:api'
    };

    try {
      // Validate session has required claims
      if (!session.legacyUsername) {
        auditEntry.error = 'Missing legacy username';
        return {
          success: false,
          error: 'Legacy username required for API delegation',
          auditTrail: auditEntry
        };
      }

      // Build request
      const url = `${this.config.baseUrl}${params.endpoint}`;
      const response = await fetch(url, {
        method: params.method || 'GET',
        headers: {
          ...this.config.headers,
          'X-Legacy-User': session.legacyUsername,
          'X-On-Behalf-Of': session.userId,
          'Content-Type': 'application/json'
        },
        body: params.body ? JSON.stringify(params.body) : undefined
      });

      const data = await response.json();

      if (!response.ok) {
        auditEntry.error = `API error: ${response.status}`;
        return {
          success: false,
          error: `API returned ${response.status}: ${data.message || 'Unknown error'}`,
          auditTrail: auditEntry
        };
      }

      // Success
      auditEntry.success = true;
      return {
        success: true,
        data: data as T,
        auditTrail: auditEntry
      };
    } catch (error) {
      auditEntry.error = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: auditEntry.error,
        auditTrail: auditEntry
      };
    }
  }

  async validateAccess(session: UserSession): Promise<boolean> {
    // Check if user has required permissions
    return session.permissions.includes('api:access') || session.role === 'admin';
  }

  async healthCheck(): Promise<boolean> {
    if (!this.config) {
      return false;
    }

    try {
      const response = await fetch(`${this.config.baseUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async destroy(): Promise<void> {
    this.config = undefined;
    console.log('API Delegation Module destroyed');
  }
}

/**
 * Example usage
 */
async function main() {
  // 1. Create audit service
  const auditService = new AuditService({ enabled: true });

  // 2. Create delegation registry
  const registry = new DelegationRegistry(auditService);

  // 3. Create and register custom API module
  const apiModule = new APIDelegationModule();
  await apiModule.initialize({
    baseUrl: 'https://legacy-api.example.com',
    timeout: 30000,
    headers: {
      'X-API-Version': 'v2'
    }
  });

  registry.register(apiModule);

  // 4. Create mock user session
  const session: UserSession = {
    _version: 1,
    userId: 'user123',
    username: 'john.doe',
    legacyUsername: 'DOMAIN\\jdoe',
    role: 'user',
    permissions: ['api:access', 'read', 'write'],
    scopes: ['api:legacy'],
    rejected: false,
    issuer: 'https://auth.example.com',
    audience: 'my-api',
    expiresAt: new Date(Date.now() + 3600000)
  };

  // 5. Perform API delegation
  const result = await registry.delegate(
    'api',
    session,
    'get-user-data',
    {
      endpoint: '/users/me',
      method: 'GET'
    }
  );

  if (result.success) {
    console.log('API call successful:', result.data);
    console.log('Audit trail:', result.auditTrail);
  } else {
    console.error('API call failed:', result.error);
  }

  // 6. Health check
  const healthy = await apiModule.healthCheck();
  console.log('API module healthy?', healthy);

  // Cleanup
  await registry.destroyAll();
}

// Run the example
main().catch(console.error);
