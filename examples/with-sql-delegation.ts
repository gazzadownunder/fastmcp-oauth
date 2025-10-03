/**
 * Example: Authentication with SQL Delegation
 *
 * This example demonstrates using Core authentication + SQL delegation
 * without MCP dependencies.
 */

import {
  AuthenticationService,
  AuditService,
  ROLE_USER,
  type AuthConfig,
  type UserSession
} from '../src/core/index.js';

import {
  DelegationRegistry,
  SQLDelegationModule,
  type SQLConfig
} from '../src/delegation/index.js';

async function main() {
  // 1. Set up audit service
  const auditService = new AuditService({
    enabled: true,
    storage: undefined
  });

  // 2. Configure authentication
  const authConfig: AuthConfig = {
    trustedIDPs: [
      {
        issuer: 'https://auth.example.com',
        discoveryUrl: 'https://auth.example.com/.well-known/oauth-authorization-server',
        jwksUri: 'https://auth.example.com/.well-known/jwks.json',
        audience: 'my-api',
        algorithms: ['RS256'],
        claimMappings: {
          legacyUsername: 'legacy_sam_account',
          roles: 'user_roles',
          scopes: 'scopes'
        },
        security: {
          clockTolerance: 60,
          maxTokenAge: 3600,
          requireNbf: true
        }
      }
    ],
    roleMappings: {
      adminRole: 'admin',
      userRole: ROLE_USER,
      guestRole: 'guest',
      customRoles: []
    }
  };

  // 3. Create authentication service
  const authService = new AuthenticationService(authConfig, auditService);
  await authService.initialize();

  // 4. Set up delegation registry
  const delegationRegistry = new DelegationRegistry(auditService);

  // 5. Configure and register SQL delegation module
  const sqlConfig: SQLConfig = {
    server: 'localhost',
    database: 'myapp',
    options: {
      trustedConnection: true,
      encrypt: true,
      trustServerCertificate: false
    }
  };

  const sqlModule = new SQLDelegationModule();
  await sqlModule.initialize(sqlConfig);
  delegationRegistry.register(sqlModule);

  console.log('Registered delegation modules:', delegationRegistry.list());

  // 6. Simulate user authentication
  const mockJwtToken = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...';

  try {
    const authResult = await authService.authenticate(mockJwtToken);

    if (authResult.rejected) {
      console.log('Authentication rejected, cannot perform delegation');
      return;
    }

    const session = authResult.session;
    console.log('User authenticated:', session.userId);

    // 7. Perform SQL delegation
    if (session.legacyUsername) {
      // Example: Execute a query
      const queryResult = await delegationRegistry.delegate(
        'sql',
        session,
        'query',
        {
          sql: 'SELECT TOP 10 * FROM Users WHERE IsActive = @active',
          params: { active: true }
        }
      );

      if (queryResult.success) {
        console.log('Query executed successfully:', queryResult.data);
        console.log('Audit trail:', queryResult.auditTrail);
      } else {
        console.error('Query failed:', queryResult.error);
      }

      // Example: Execute a stored procedure
      const procResult = await delegationRegistry.delegate(
        'sql',
        session,
        'procedure',
        {
          procedure: 'sp_GetUserOrders',
          params: { userId: session.userId }
        }
      );

      if (procResult.success) {
        console.log('Procedure executed successfully:', procResult.data);
      } else {
        console.error('Procedure failed:', procResult.error);
      }
    } else {
      console.log('No legacy username, delegation not available');
    }
  } catch (error) {
    console.error('Error:', error);
  }

  // Cleanup
  await delegationRegistry.destroyAll();
  await authService.destroy();
}

// Run the example
main().catch(console.error);
