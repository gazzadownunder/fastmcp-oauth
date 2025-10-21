/**
 * LDAP Delegation Example
 *
 * This example demonstrates how to create a delegation module that integrates
 * with LDAP/Active Directory for authentication and directory operations.
 *
 * Use Case: Delegate MCP tool calls to LDAP directory services for user/group management
 *
 * Features:
 * - LDAP authentication and bind
 * - User search and attribute retrieval
 * - Group membership queries
 * - Directory modifications (add, modify, delete)
 * - Connection pooling and error handling
 *
 * Note: This is a conceptual example. In production, use ldapjs or similar library.
 */

import type { DelegationModule, DelegationResult } from '../src/delegation/base.js';
import type { UserSession, AuditEntry } from '../src/core/index.js';
import type { CoreContext } from '../src/core/types.js';

/**
 * LDAP delegation module configuration
 */
export interface LDAPDelegationConfig {
  url: string;                         // LDAP server URL (e.g., 'ldaps://dc.example.com:636')
  baseDN: string;                      // Base DN for searches (e.g., 'DC=example,DC=com')
  bindDN?: string;                     // Service account DN for binding
  bindPassword?: string;               // Service account password
  useTLS?: boolean;                    // Use LDAPS (default: true)
  timeout?: number;                    // Operation timeout in milliseconds
  poolSize?: number;                   // Connection pool size
  searchScope?: 'base' | 'one' | 'sub'; // Default search scope
}

/**
 * LDAP search parameters
 */
export interface LDAPSearchRequest {
  baseDN?: string;                     // Base DN (defaults to config.baseDN)
  filter: string;                      // LDAP filter (e.g., '(uid=john)')
  scope?: 'base' | 'one' | 'sub';      // Search scope
  attributes?: string[];               // Attributes to return
  sizeLimit?: number;                  // Maximum results
}

/**
 * LDAP modify request
 */
export interface LDAPModifyRequest {
  dn: string;                          // Distinguished Name to modify
  changes: Array<{
    operation: 'add' | 'delete' | 'replace';
    modification: {
      type: string;                    // Attribute name
      values: string[];                // Attribute values
    };
  }>;
}

/**
 * LDAP entry result
 */
export interface LDAPEntry {
  dn: string;
  attributes: Record<string, string | string[]>;
}

/**
 * LDAP Delegation Module
 *
 * Delegates MCP operations to LDAP directory services.
 *
 * Note: This is a simplified implementation for demonstration. In production,
 * use ldapjs or similar library with proper connection management.
 */
export class LDAPDelegationModule implements DelegationModule {
  readonly name = 'ldap';
  readonly type = 'authentication';

  private config: LDAPDelegationConfig | null = null;

  async initialize(config: LDAPDelegationConfig): Promise<void> {
    if (!config.url) {
      throw new Error('LDAP server URL is required');
    }

    if (!config.baseDN) {
      throw new Error('LDAP base DN is required');
    }

    // Validate LDAPS for production
    if (!config.url.startsWith('ldaps://') && config.useTLS !== false) {
      console.warn('[LDAPDelegation] WARNING: Using unencrypted LDAP connection. Use ldaps:// for production.');
    }

    this.config = {
      useTLS: true,
      timeout: 30000,
      poolSize: 5,
      searchScope: 'sub',
      ...config,
    };

    // In production, initialize connection pool here
    console.log(`[LDAPDelegation] Initialized with server: ${config.url}`);
  }

  async delegate<T>(
    session: UserSession,
    action: string,
    params: LDAPSearchRequest | LDAPModifyRequest | any,
    context?: { sessionId?: string; coreContext?: CoreContext }
  ): Promise<DelegationResult<T>> {
    const auditEntry: AuditEntry = {
      timestamp: new Date(),
      source: 'delegation:ldap',
      userId: session.userId,
      action: `ldap:${action}`,
      success: false,
    };

    try {
      if (!this.config) {
        throw new Error('LDAPDelegationModule not initialized');
      }

      let result: T;

      switch (action) {
        case 'search':
          result = await this.search(params as LDAPSearchRequest) as T;
          break;

        case 'authenticate':
          result = await this.authenticate(params.username, params.password) as T;
          break;

        case 'getGroups':
          result = await this.getUserGroups(params.username) as T;
          break;

        case 'modify':
          result = await this.modify(params as LDAPModifyRequest) as T;
          break;

        case 'add':
          result = await this.addEntry(params.dn, params.attributes) as T;
          break;

        case 'delete':
          result = await this.deleteEntry(params.dn) as T;
          break;

        default:
          throw new Error(`Unknown LDAP action: ${action}`);
      }

      auditEntry.success = true;
      auditEntry.metadata = {
        action,
        baseDN: this.config.baseDN,
      };

      return {
        success: true,
        data: result,
        auditTrail: auditEntry,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown LDAP error';
      auditEntry.error = errorMessage;

      return {
        success: false,
        error: errorMessage,
        auditTrail: auditEntry,
      };
    }
  }

  /**
   * Search LDAP directory
   */
  private async search(request: LDAPSearchRequest): Promise<LDAPEntry[]> {
    if (!this.config) {
      throw new Error('LDAPDelegationModule not initialized');
    }

    const baseDN = request.baseDN || this.config.baseDN;
    const scope = request.scope || this.config.searchScope || 'sub';

    console.log(`[LDAPDelegation] Searching: ${baseDN} with filter: ${request.filter}`);

    // Mock implementation - replace with actual LDAP client
    // Production: use ldapjs
    /*
    import ldap from 'ldapjs';

    const client = ldap.createClient({
      url: this.config.url,
      timeout: this.config.timeout,
    });

    return new Promise((resolve, reject) => {
      client.bind(this.config.bindDN, this.config.bindPassword, (err) => {
        if (err) return reject(err);

        const entries: LDAPEntry[] = [];
        client.search(baseDN, {
          filter: request.filter,
          scope,
          attributes: request.attributes,
          sizeLimit: request.sizeLimit || 100,
        }, (err, res) => {
          if (err) return reject(err);

          res.on('searchEntry', (entry) => {
            entries.push({
              dn: entry.dn.toString(),
              attributes: entry.attributes,
            });
          });

          res.on('error', reject);
          res.on('end', () => {
            client.unbind();
            resolve(entries);
          });
        });
      });
    });
    */

    // Mock response
    return [
      {
        dn: `CN=John Doe,${baseDN}`,
        attributes: {
          cn: 'John Doe',
          mail: 'john.doe@example.com',
          department: 'Engineering',
          title: 'Senior Developer',
        },
      },
    ];
  }

  /**
   * Authenticate user against LDAP
   */
  private async authenticate(username: string, password: string): Promise<{ authenticated: boolean; dn?: string }> {
    if (!this.config) {
      throw new Error('LDAPDelegationModule not initialized');
    }

    console.log(`[LDAPDelegation] Authenticating user: ${username}`);

    // Search for user DN
    const searchResults = await this.search({
      filter: `(uid=${username})`,
      attributes: ['dn'],
    });

    if (searchResults.length === 0) {
      return { authenticated: false };
    }

    const userDN = searchResults[0].dn;

    // Try to bind with user credentials
    // Production: use ldapjs client.bind(userDN, password)
    /*
    const client = ldap.createClient({ url: this.config.url });

    return new Promise((resolve) => {
      client.bind(userDN, password, (err) => {
        client.unbind();
        if (err) {
          resolve({ authenticated: false });
        } else {
          resolve({ authenticated: true, dn: userDN });
        }
      });
    });
    */

    // Mock response
    return { authenticated: true, dn: userDN };
  }

  /**
   * Get user's group memberships
   */
  private async getUserGroups(username: string): Promise<string[]> {
    if (!this.config) {
      throw new Error('LDAPDelegationModule not initialized');
    }

    console.log(`[LDAPDelegation] Getting groups for user: ${username}`);

    // Search for user
    const userResults = await this.search({
      filter: `(uid=${username})`,
      attributes: ['dn', 'memberOf'],
    });

    if (userResults.length === 0) {
      return [];
    }

    const memberOf = userResults[0].attributes.memberOf;
    return Array.isArray(memberOf) ? memberOf : [memberOf as string];
  }

  /**
   * Modify LDAP entry
   */
  private async modify(request: LDAPModifyRequest): Promise<{ success: boolean }> {
    if (!this.config) {
      throw new Error('LDAPDelegationModule not initialized');
    }

    console.log(`[LDAPDelegation] Modifying entry: ${request.dn}`);

    // Production: use ldapjs client.modify(dn, changes)
    /*
    const client = ldap.createClient({ url: this.config.url });

    return new Promise((resolve, reject) => {
      client.bind(this.config.bindDN, this.config.bindPassword, (err) => {
        if (err) return reject(err);

        const changes = request.changes.map(c => new ldap.Change({
          operation: c.operation,
          modification: c.modification,
        }));

        client.modify(request.dn, changes, (err) => {
          client.unbind();
          if (err) return reject(err);
          resolve({ success: true });
        });
      });
    });
    */

    return { success: true };
  }

  /**
   * Add new LDAP entry
   */
  private async addEntry(dn: string, attributes: Record<string, string | string[]>): Promise<{ success: boolean }> {
    if (!this.config) {
      throw new Error('LDAPDelegationModule not initialized');
    }

    console.log(`[LDAPDelegation] Adding entry: ${dn}`);

    // Production: use ldapjs client.add(dn, attributes)
    return { success: true };
  }

  /**
   * Delete LDAP entry
   */
  private async deleteEntry(dn: string): Promise<{ success: boolean }> {
    if (!this.config) {
      throw new Error('LDAPDelegationModule not initialized');
    }

    console.log(`[LDAPDelegation] Deleting entry: ${dn}`);

    // Production: use ldapjs client.del(dn)
    return { success: true };
  }

  async healthCheck(): Promise<boolean> {
    if (!this.config) {
      return false;
    }

    try {
      // Try to bind with service account
      // Production: attempt actual LDAP bind
      return true;
    } catch {
      return false;
    }
  }

  async destroy(): Promise<void> {
    // Production: close all connections in pool
    this.config = null;
    console.log(`[LDAPDelegation] Destroyed`);
  }
}

/**
 * Example Usage
 */

/*
import { createDelegationTool } from '../src/mcp/tools/delegation-tool-factory.js';
import { z } from 'zod';

// 1. Create and initialize LDAP delegation module
const ldapModule = new LDAPDelegationModule();
await ldapModule.initialize({
  url: 'ldaps://dc.example.com:636',
  baseDN: 'DC=example,DC=com',
  bindDN: 'CN=Service Account,CN=Users,DC=example,DC=com',
  bindPassword: process.env.LDAP_BIND_PASSWORD,
  useTLS: true,
  timeout: 30000,
});

// 2. Register module
const coreContext = server.getCoreContext();
coreContext.delegationRegistry.register(ldapModule);

// 3. Create tools

// Search users
const searchUsersTool = createDelegationTool('ldap', {
  name: 'ldap-search-users',
  description: 'Search LDAP directory for users',

  parameters: z.object({
    username: z.string().optional().describe('Username filter'),
    department: z.string().optional().describe('Department filter'),
    limit: z.number().min(1).max(100).default(10),
  }),

  action: 'search',
  requiredPermission: 'ldap:read',

  transformParams: (params) => {
    const filters: string[] = [];
    if (params.username) filters.push(`(uid=${params.username})`);
    if (params.department) filters.push(`(department=${params.department})`);

    const filter = filters.length > 1 ? `(&${filters.join('')})` : filters[0] || '(objectClass=person)';

    return {
      filter,
      attributes: ['cn', 'mail', 'department', 'title'],
      sizeLimit: params.limit,
    };
  },

  transformResult: (results: LDAPEntry[]) => ({
    users: results.map(e => e.attributes),
    count: results.length,
  }),
}, coreContext);

// Get user groups
const getUserGroupsTool = createDelegationTool('ldap', {
  name: 'ldap-get-user-groups',
  description: 'Get LDAP group memberships for a user',

  parameters: z.object({
    username: z.string().describe('Username'),
  }),

  action: 'getGroups',
  requiredPermission: 'ldap:read',

  transformParams: (params) => ({ username: params.username }),

  transformResult: (groups: string[]) => ({
    groups: groups.map(dn => {
      const match = dn.match(/CN=([^,]+)/);
      return match ? match[1] : dn;
    }),
  }),
}, coreContext);

// Authenticate user (for verification, not login)
const verifyUserTool = createDelegationTool('ldap', {
  name: 'ldap-verify-credentials',
  description: 'Verify user credentials against LDAP',

  parameters: z.object({
    username: z.string().describe('Username'),
    password: z.string().describe('Password'),
  }),

  action: 'authenticate',
  requiredPermission: 'ldap:authenticate',
  requiredRoles: ['admin'],

  transformParams: (params) => ({
    username: params.username,
    password: params.password,
  }),

  transformResult: (result: any) => ({
    authenticated: result.authenticated,
    message: result.authenticated ? 'Credentials valid' : 'Invalid credentials',
  }),
}, coreContext);

// 4. Register tools
server.registerTools([
  searchUsersTool,
  getUserGroupsTool,
  verifyUserTool,
]);

console.log('LDAP delegation tools registered successfully');

// Production notes:
// 1. Install ldapjs: npm install ldapjs @types/ldapjs
// 2. Use connection pooling for better performance
// 3. Implement proper error handling for LDAP errors
// 4. Use LDAPS (ldaps://) for encrypted connections
// 5. Store bind credentials securely (environment variables, secrets manager)
// 6. Implement rate limiting to prevent LDAP server overload
// 7. Consider caching for frequently accessed data
*/
