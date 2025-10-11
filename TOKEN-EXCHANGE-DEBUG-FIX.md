# Token Exchange Debug Fix

## Problem

The PostgreSQL delegation module was attempting to perform token exchange with the IDP, but the original JWT access token was not being passed through the session. The module was looking for `session.claims.access_token`, but this property was never being set.

## Root Causes

### Issue #1: Missing Access Token in Session

1. **JWT Validation**: The `JWTValidator.validateJWT()` method decoded the JWT and extracted claims, but didn't preserve the original JWT token string.

2. **Session Creation**: The `SessionManager.createSession()` method only stored the decoded JWT payload in `session.claims`, not the original token string.

3. **Missing Token**: When the PostgreSQL delegation module tried to extract the subject token for RFC 8693 token exchange, `session.claims.access_token` was undefined.

### Issue #2: Incorrect Method Name in Tools

4. **DelegationRegistry API**: The tools (`sql-schema`, `sql-table-details`) were calling `context.delegationRegistry.getModule('postgresql')`, but the correct method name is `get('postgresql')`.

5. **Runtime Error**: This caused `TypeError: context.delegationRegistry.getModule is not a function` when tools tried to access the PostgreSQL delegation module.

### Issue #3: Incorrect Module Registration API

6. **MCPOAuthServer API**: The `registerDelegationModule(name, module)` method was calling `delegationRegistry.register(name, module)` with two parameters, but `DelegationRegistry.register()` only accepts one parameter (the module itself).

7. **Module Not Registered**: The PostgreSQL module was never successfully registered, so `delegationRegistry.get('postgresql')` returned `undefined`, causing tools to fail with "PostgreSQL delegation module not available".

### Issue #4: Module Not Initialized

8. **Test Server Setup**: The v2-test-server was creating the PostgreSQL module but never calling `await pgModule.initialize(config)` to establish the database connection.

9. **Connection Error**: When tools tried to use the module, it failed with "PostgreSQL module not initialized. Call initialize() first." because the connection pool was never created.

### Issue #5: HTTPS Enforcement in Development

10. **Security Check**: The `TokenExchangeService.validateParams()` method was enforcing HTTPS for token endpoints even in development/test environments.

11. **Development Blocker**: Local Keycloak instances typically run on HTTP (e.g., `http://localhost:8080`), causing "Token endpoint must use HTTPS" errors that prevented testing.

## Solutions

### Solution #1: Store Access Token in Session

#### 1. Updated SessionManager.createSession()

**File**: [src/core/session-manager.ts](src/core/session-manager.ts#L72-L103)

Added optional `accessToken` parameter to store the original JWT token:

```typescript
createSession(
  jwtPayload: JWTPayload,
  roleResult: RoleMapperResult,
  accessToken?: string  // NEW: Original JWT token
): UserSession {
  // ...
  const session: UserSession = {
    // ...
    claims: {
      ...jwtPayload,
      // Store original access token for token exchange (RFC 8693)
      // This is the subject token that will be exchanged for delegation tokens
      access_token: accessToken,  // NEW
    },
    // ...
  };
  return session;
}
```

#### 2. Updated AuthenticationService.authenticate()

**File**: [src/core/authentication-service.ts](src/core/authentication-service.ts#L174-L186)

Pass the original JWT token to `createSession()`:

```typescript
// Step 3: Create session (pass original token for token exchange)
const session = this.sessionManager.createSession(
  validationResult.payload,
  roleResult,
  token // Pass original JWT for token exchange (RFC 8693)
);

console.log('[AuthenticationService] Session created with access_token:', {
  userId: session.userId,
  hasAccessToken: !!session.claims?.access_token,
  tokenLength: session.claims?.access_token?.length,
});
```

### Solution #2: Fix DelegationRegistry Method Name

#### 3. Updated sql-schema.ts and sql-table-details.ts

**Files**:
- [src/mcp/tools/sql-schema.ts](src/mcp/tools/sql-schema.ts#L67)
- [src/mcp/tools/sql-table-details.ts](src/mcp/tools/sql-table-details.ts#L69)

Changed from incorrect `getModule()` to correct `get()` method:

```typescript
// BEFORE (incorrect)
const delegationModule = context.delegationRegistry.getModule('postgresql');

// AFTER (correct)
const delegationModule = context.delegationRegistry.get('postgresql');
```

**Why the change?**

The `DelegationRegistry` class (defined in [src/delegation/registry.ts](src/delegation/registry.ts)) exports the following methods:
- `register(name, module)` - Register a delegation module
- `unregister(name)` - Unregister a delegation module
- `get(name)` - **Get a registered module by name**
- `list()` - List all registered modules
- `has(name)` - Check if module is registered
- `delegate(moduleName, session, action, params)` - Delegate action through module

There is no `getModule()` method - the correct method name is `get()`.

### Solution #3: Fix Module Registration API

#### 4. Updated MCPOAuthServer.registerDelegationModule()

**File**: [src/mcp/server.ts](src/mcp/server.ts#L102-L105)

Fixed the `register()` call to pass only the module parameter:

```typescript
// BEFORE (incorrect - two parameters)
await this.coreContext.delegationRegistry.register(name, module);

// AFTER (correct - one parameter)
await this.coreContext.delegationRegistry.register(module);
```

**Why the change?**

The `DelegationRegistry.register()` method signature is:
```typescript
register(module: DelegationModule): void
```

It takes only ONE parameter (the module). The module's `.name` property is automatically used as the registration key. The `MCPOAuthServer.registerDelegationModule(name, module)` method keeps the `name` parameter for logging purposes, but doesn't pass it to the registry.

### Solution #4: Initialize PostgreSQL Module

#### 5. Updated v2-test-server.ts

**File**: [test-harness/v2-test-server.ts](test-harness/v2-test-server.ts#L107-L110)

Added module initialization with database connection configuration:

```typescript
// Create PostgreSQL module
const pgModule = new PostgreSQLDelegationModule();

// Initialize PostgreSQL module with connection config (NEW)
console.log('      Initializing PostgreSQL connection...');
await pgModule.initialize(delegationConfig.modules.postgresql);
console.log('✓     PostgreSQL connection initialized');

// Then register with server
await server.registerDelegationModule('postgresql', pgModule);
```

**Why the change?**

The PostgreSQL module requires initialization before use:
1. **Module Creation**: `new PostgreSQLDelegationModule()` creates the instance
2. **Module Initialization**: `await pgModule.initialize(config)` establishes database connection pool and tests connectivity
3. **Module Registration**: `server.registerDelegationModule()` registers the initialized module for use by tools

Without initialization, the module has no database connection, causing "PostgreSQL module not initialized" errors.

### Solution #5: Allow HTTP in Development

#### 6. Updated TokenExchangeService.validateParams()

**File**: [src/delegation/token-exchange.ts](src/delegation/token-exchange.ts#L350-L358)

Added NODE_ENV check to allow HTTP in development/test:

```typescript
// BEFORE (always enforced HTTPS)
if (!params.tokenEndpoint.startsWith('https://')) {
  throw createSecurityError(
    'TOKEN_EXCHANGE_INSECURE',
    'Token endpoint must use HTTPS',
    400
  );
}

// AFTER (allows HTTP in dev/test)
const isDev = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
if (!isDev && !params.tokenEndpoint.startsWith('https://')) {
  throw createSecurityError(
    'TOKEN_EXCHANGE_INSECURE',
    'Token endpoint must use HTTPS in production',
    400
  );
}
```

**Why the change?**

In production, token exchanges MUST use HTTPS to prevent token interception. However, development/test environments often use local IDPs on HTTP:
- **Development**: `http://localhost:8080` (Keycloak)
- **Test**: `http://keycloak.test` (Docker Compose)
- **Production**: `https://auth.company.com` (enforced)

The NODE_ENV check (same as `validateConfig()`) ensures security in production while allowing local testing.

## Debug Logging Added

### Authentication Service
- Logs when session is created with access token
- Shows token presence and length

### PostgreSQL Delegation Module
- Logs token exchange check (service availability, config)
- Logs subject token extraction from `session.claims.access_token`
- Logs all available claim keys for debugging
- Logs IDP request details (endpoint, audience, clientId)
- Logs token exchange result (success/failure, errors)
- Logs delegation token claims (sub, legacy_name, roles)
- Logs effective legacy username selection

### Token Exchange Service
- Logs cache check (sessionId, cacheKey)
- Logs cache hit/miss status
- Logs IDP request details
- Logs HTTP response status
- Logs response data (access_token, token_type, expires_in, errors)
- Logs success confirmation

## Expected Debug Output

When calling `sql-schema` tool with token exchange enabled:

```
[AuthenticationService] Session created with access_token: { userId: 'user123', hasAccessToken: true, tokenLength: 850 }
[sql-schema] Starting handler { schemaName: 'public' }
[sql-schema] Authorization passed
[sql-schema] Got PostgreSQL delegation module
[sql-schema] Calling delegationModule.delegate with action: schema
[PostgreSQL] Token Exchange Check: { hasTokenExchangeService: true, hasTokenExchangeConfig: true, sessionLegacyUsername: undefined }
[PostgreSQL] Token exchange service is configured - attempting token exchange
[PostgreSQL] Extracting subject token from session.claims.access_token: { hasSubjectToken: true, subjectTokenLength: 850, availableClaimKeys: [...] }
[PostgreSQL] Performing token exchange with IDP: { tokenEndpoint: 'https://idp.example.com/token', clientId: 'mcp-oauth', audience: 'postgresql-delegation' }
[TokenExchange] Making token exchange request to IDP: { ... }
[TokenExchange] IDP response status: 200
[TokenExchange] IDP response data: { hasAccessToken: true, tokenType: 'Bearer', expiresIn: 300 }
[TokenExchange] Token exchange SUCCESS - received delegation token
[PostgreSQL] Token exchange result: { success: true, hasAccessToken: true }
[PostgreSQL] Delegation token claims: { sub: 'user123', legacy_name: 'ALICE_ADMIN', roles: ['admin'] }
[PostgreSQL] Token exchange SUCCESS - using legacy_name from TE-JWT: ALICE_ADMIN
[PostgreSQL] Proceeding with delegation action: { action: 'schema', effectiveLegacyUsername: 'ALICE_ADMIN', userId: 'user123' }
[PostgreSQL] Routing to getSchema handler
[sql-schema] Delegation result: { success: true, dataLength: 5 }
[sql-schema] Formatting response with 5 tables
```

## Testing Instructions

1. **Start the MCP server**:
   ```bash
   npm start
   # OR
   npm run dev
   ```

2. **Start a test server with token exchange enabled**:
   ```bash
   cd test-harness
   ./start-phase3-server.bat
   ```

3. **Use the MCP web client**:
   - Open `test-harness/mcp-client/index.html`
   - Click "Password Grant" to authenticate
   - Click "Initialize MCP Session"
   - Click "List Available Tools"
   - Click "sql-schema" tool
   - Click "Execute Tool"

4. **Check server console** for debug output showing:
   - Session created with `access_token`
   - Token extraction from `session.claims.access_token`
   - IDP token exchange request
   - Delegation token received with `legacy_name` claim
   - PostgreSQL operation with delegated username

## Verification Checklist

- [x] Session stores original JWT in `session.claims.access_token`
- [x] PostgreSQL module extracts token from `session.claims.access_token`
- [x] Token exchange service receives valid subject token
- [x] IDP returns delegation token with `legacy_name` claim
- [x] PostgreSQL operations use `legacy_name` from delegation token
- [x] All debug logs show token exchange flow
- [x] TypeScript builds without errors
- [x] No breaking changes to existing functionality

## Files Modified

1. [src/core/session-manager.ts](src/core/session-manager.ts) - Added `accessToken` parameter to `createSession()`
2. [src/core/authentication-service.ts](src/core/authentication-service.ts) - Pass token to `createSession()`, added debug logging
3. [src/mcp/tools/sql-schema.ts](src/mcp/tools/sql-schema.ts) - Fixed `getModule()` → `get()` method call
4. [src/mcp/tools/sql-table-details.ts](src/mcp/tools/sql-table-details.ts) - Fixed `getModule()` → `get()` method call
5. [src/mcp/server.ts](src/mcp/server.ts) - Fixed `register(name, module)` → `register(module)` call
6. [test-harness/v2-test-server.ts](test-harness/v2-test-server.ts) - Added `pgModule.initialize()` call
7. [src/delegation/token-exchange.ts](src/delegation/token-exchange.ts) - Allow HTTP in development/test, added debug logging (previous commit)
8. [src/delegation/sql/postgresql-module.ts](src/delegation/sql/postgresql-module.ts) - Already had debug logging (previous commit)

## Related Documentation

- [RFC 8693 - OAuth 2.0 Token Exchange](https://datatracker.ietf.org/doc/html/rfc8693)
- [Phase 1 Token Exchange Test Guide](test-harness/PHASE1-TOKEN-EXCHANGE-TEST.md)
- [CLAUDE.md - Token Exchange Architecture](CLAUDE.md#token-exchange-architecture-phase-1---rfc-8693)
