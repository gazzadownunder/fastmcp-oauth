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
        authEndpoint: 'http://localhost:8080/realms/mcp_security/protocol/openid-connect/auth',
        tokenEndpoint: 'http://localhost:8080/realms/mcp_security/protocol/openid-connect/token',
        logoutEndpoint: 'http://localhost:8080/realms/mcp_security/protocol/openid-connect/logout',

        // Client credentials
        clientId: 'mcp-oauth',
        clientSecret: '9DQjCpm4D9wbzXxHa1ki51PhBbyxOXrg',

        // Test user credentials (for password grant flow)
        testUser: {
            username: 'alice@test.local',
            password: 'Test123!'
        },

        // OAuth settings
        scope: 'email openid',
        responseType: 'code',
        redirectUri: window.location.origin + window.location.pathname,

        // PKCE (Proof Key for Code Exchange) - RFC 7636
        // Required by some IDPs for authorization code flow security
        pkce: {
            enabled: true,
            codeChallengeMethod: 'S256' // S256 (SHA-256) or plain
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
Object.freeze(CONFIG);
Object.freeze(CONFIG.oauth);
Object.freeze(CONFIG.oauth.testUser);
Object.freeze(CONFIG.oauth.pkce);
Object.freeze(CONFIG.mcp);
Object.freeze(CONFIG.mcp.clientInfo);
Object.freeze(CONFIG.ui);

console.log('✓ Configuration loaded', CONFIG);
