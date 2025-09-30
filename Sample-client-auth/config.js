// Keycloak Configuration
const keycloakConfig = {
    url: 'http://localhost:8080',
    realm: 'mcp_security',
    clientId: 'contextflow'
};

// Application Configuration
const appConfig = {
    // Redirect URIs
    redirectUri: window.location.origin,
    postLogoutRedirectUri: window.location.origin,

    // Keycloak initialization options
    initOptions: {
        onLoad: 'check-sso', // Check for existing sessions without forcing login
        checkLoginIframe: false, // Disabled to avoid frame-ancestors CSP issues
        enableLogging: true,
        flow: 'standard', // Authorization code flow with PKCE
        pkceMethod: 'S256', // Use PKCE for better security
        responseMode: 'fragment', // Match Keycloak test app
        messageReceiveTimeout: 10000 // Increase timeout for SSO checks
    },

    // Token refresh settings
    minValidity: 30, // Refresh token if it expires within 30 seconds

    // UI update interval (milliseconds)
    tokenUpdateInterval: 5000 // Update token display every 5 seconds
};

// Token Exchange Configuration
const tokenExchangeConfig = {
    client_id: 'mcp-oauth',
    client_secret: 'JUUA5xCJDQZdreWgEFYvfAqjJnGdTXXA',
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    audience: 'mcp-oauth', // The audience for the new token
    //scope: 'mcp-oauth' // The scope for the exchanged token
};

// Export configuration
window.keycloakConfig = keycloakConfig;
window.appConfig = appConfig;
window.tokenExchangeConfig = tokenExchangeConfig;