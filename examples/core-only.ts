/**
 * Example: Core Authentication Framework (Standalone)
 *
 * This example demonstrates using the Core authentication framework
 * without any MCP or delegation dependencies.
 */

import {
  AuthenticationService,
  SessionManager,
  JWTValidator,
  RoleMapper,
  AuditService,
  UNASSIGNED_ROLE,
  ROLE_ADMIN,
  ROLE_USER,
  type UserSession,
  type AuthConfig,
  type AuditEntry
} from '../src/core/index.js';

async function main() {
  // 1. Configure audit service (optional, uses Null Object Pattern if omitted)
  const auditService = new AuditService({
    enabled: true,
    storage: undefined, // Uses in-memory storage
    onOverflow: (entries: AuditEntry[]) => {
      console.log('Audit overflow:', entries.length, 'entries being discarded');
      // In production, you might write these to disk or a database
    }
  });

  // 2. Configure authentication
  const authConfig: AuthConfig = {
    trustedIDPs: [
      {
        issuer: 'https://auth.example.com',
        discoveryUrl: 'https://auth.example.com/.well-known/oauth-authorization-server',
        jwksUri: 'https://auth.example.com/.well-known/jwks.json',
        audience: 'my-api',
        algorithms: ['RS256', 'ES256'],
        claimMappings: {
          legacyUsername: 'legacy_username',
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
      adminRole: ROLE_ADMIN,
      userRole: ROLE_USER,
      guestRole: 'guest',
      customRoles: ['developer', 'analyst']
    }
  };

  // 3. Create authentication service
  const authService = new AuthenticationService(authConfig, auditService);
  await authService.initialize();

  // 4. Authenticate a user with a JWT token
  // In a real application, this token would come from the client
  const mockJwtToken = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...';

  try {
    const result = await authService.authenticate(mockJwtToken);

    if (result.rejected) {
      console.log('Authentication rejected:', result.rejectionReason);
      console.log('Session role:', result.session.role);
      console.log('Is unassigned?', result.session.role === UNASSIGNED_ROLE);
    } else {
      console.log('Authentication successful!');
      console.log('User ID:', result.session.userId);
      console.log('Role:', result.session.role);
      console.log('Permissions:', result.session.permissions);
    }
  } catch (error) {
    console.error('Authentication failed:', error);
  }

  // 5. Check session validity
  const sessionManager = new SessionManager();

  // Example: Create a session manually (for testing)
  const testSession: UserSession = {
    _version: 1,
    userId: 'user123',
    username: 'john.doe',
    legacyUsername: 'jdoe',
    role: ROLE_USER,
    permissions: ['read', 'write'],
    scopes: ['api:access'],
    rejected: false,
    issuer: 'https://auth.example.com',
    audience: 'my-api',
    expiresAt: new Date(Date.now() + 3600000)
  };

  const isValid = sessionManager.validateSession(testSession);
  console.log('Session valid?', isValid);

  // 6. Migrate old session format (v0 to v1)
  const oldSession = {
    userId: 'user456',
    username: 'jane.doe',
    role: 'admin',
    permissions: ['admin:all']
  };

  const migratedSession = sessionManager.migrateSession(oldSession);
  console.log('Migrated session version:', migratedSession._version);
  console.log('Migration added rejected field:', 'rejected' in migratedSession);

  // Cleanup
  await authService.destroy();
}

// Run the example
main().catch(console.error);
