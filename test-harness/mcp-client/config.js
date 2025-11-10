/**
 * Configuration for MCP OAuth Integration Test Client
 *
 * This file contains all configuration for:
 * - Keycloak OAuth endpoints
 * - MCP Server endpoints
 * - Client credentials
 */

const CONFIG = {
    // Keycloak OAuth Configuration
    oauth: {
        realm: 'mcp_security',
        authEndpoint: 'http://192.168.1.137:8080/realms/mcp_security/protocol/openid-connect/auth',
        tokenEndpoint: 'http://192.168.1.137:8080/realms/mcp_security/protocol/openid-connect/token',
        logoutEndpoint: 'http://192.168.1.137:8080/realms/mcp_security/protocol/openid-connect/logout',

        // Client credentials
        clientId: 'mcp-oauth',
        clientSecret: 'LMdUemYydqmQzkhhg0aspPuvXfX6OiEB',

        // Test user credentials (for password grant flow)
        testUser: {
            username: 'alice@test.local',
            password: 'Test123!'
        },

        // OAuth settings
        scope: 'email openid',
        responseType: 'code',
        redirectUri: window.location.origin + window.location.pathname,

        // Scope configuration for each authentication method
        // Allows different scopes to be requested per authentication flow
        //
        // Each authentication method can have its own scope configuration:
        // - password: Password grant flow (Resource Owner Password Credentials)
        // - sso: SSO redirect (Authorization Code Flow with PKCE)
        // - mcpOAuth: MCP OAuth Discovery (discovers endpoints from MCP server)
        // - inspector: Inspector-style OAuth (minimal parameter OAuth 2.1)
        //
        // To modify scopes, edit the values below. For example:
        // - 'email openid': Basic OIDC scopes for email and user ID
        // - 'email openid profile': Adds profile information
        // - 'email openid mcp:read mcp:write': Custom MCP scopes
        //
        // Note: For inspector-style OAuth, scope is only used if
        // inspector.useDefaultScopes is set to false
        scopes: {
            password: 'email openid',           // Password grant flow
            sso: 'email openid',                // SSO redirect (authorization code)
            mcpOAuth: 'email openid',           // MCP OAuth discovery
            inspector: 'email openid'           // Inspector-style OAuth (only if useDefaultScopes=false)
        },

        // PKCE (Proof Key for Code Exchange) - RFC 7636
        // Required by some IDPs for authorization code flow security
        pkce: {
            enabled: true,
            codeChallengeMethod: 'S256' // S256 (SHA-256) or plain
        },

        // Inspector-Style OAuth Configuration
        // PUBLIC CLIENT - OAuth 2.1 flow matching MCP Inspector behavior
        //
        // Client Type: PUBLIC (browser-based application)
        // Security: PKCE (S256) instead of client_secret
        //
        // Key differences from standard OAuth:
        // - Public client (no client_secret sent)
        // - No state parameter (PKCE provides CSRF protection)
        // - No scope parameter (uses IDP default scopes)
        // - Minimal 5 parameters: response_type, client_id, redirect_uri, code_challenge, code_challenge_method
        //
        // IMPORTANT: Keycloak client MUST be configured as PUBLIC:
        // - Client authentication: OFF
        // - Standard flow: ENABLED
        // - Valid redirect URIs: Must include this application's URL
        inspector: {
            enabled: true,
            authEndpoint: 'http://192.168.1.137:8080/realms/mcp_security/protocol/openid-connect/auth',
            tokenEndpoint: 'http://192.168.1.137:8080/realms/mcp_security/protocol/openid-connect/token',
            clientId: 'mcp-oauth',
            // No client_secret - this is a PUBLIC client per OAuth 2.1
            // PKCE provides security instead of client credentials
            // Redirect URI sent in authorization request and token exchange
            preRegisteredRedirectUri: window.location.origin + window.location.pathname,
            // No scope parameter - uses IDP default scopes
            useDefaultScopes: true,
            // No state parameter - PKCE provides CSRF protection per OAuth 2.1
            skipStateParam: true
        }
    },

    // MCP Server Configuration
    mcp: {
        baseUrl: 'http://localhost:3000',
        endpoint: '/mcp',

        // Protocol version
        protocolVersion: '2024-11-05',

        // Client information
        clientInfo: {
            name: 'mcp-oauth-test-client',
            version: '1.0.0'
        },

        // Request timeout (ms)
        timeout: 30000
    },

    // UI Configuration
    ui: {
        // Auto-scroll log console to bottom
        autoScrollLog: true,

        // Maximum log entries to keep
        maxLogEntries: 100,

        // Token display truncation length
        tokenTruncateLength: 50
    }
};

// Freeze config to prevent accidental modification
// Note: CONFIG.oauth.scopes is NOT frozen to allow runtime modification via UI
Object.freeze(CONFIG);
Object.freeze(CONFIG.oauth.testUser);
Object.freeze(CONFIG.oauth.pkce);
Object.freeze(CONFIG.oauth.inspector);
Object.freeze(CONFIG.mcp);
Object.freeze(CONFIG.mcp.clientInfo);
Object.freeze(CONFIG.ui);

console.log('✓ Configuration loaded', CONFIG);
