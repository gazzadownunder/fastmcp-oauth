/**
 * MCP OAuth Discovery Authentication Module
 *
 * Implements the MCP OAuth 2.1 specification discovery flow:
 * 1. Attempt MCP request without authentication
 * 2. Receive 401 Unauthorized with WWW-Authenticate header
 * 3. Parse WWW-Authenticate to discover authorization server
 * 4. Fetch protected resource metadata (.well-known/oauth-protected-resource)
 * 5. Perform OAuth authorization code flow with PKCE
 * 6. Retry MCP request with obtained access token
 *
 * References:
 * - MCP OAuth 2.1 Specification
 * - RFC 6750 (Bearer Token Usage)
 * - RFC 9728 (OAuth 2.0 Protected Resource Metadata)
 * - RFC 7636 (PKCE)
 */

class MCPOAuthDiscovery {
    constructor() {
        this.discoveredConfig = null;
        this.pkceCodeVerifier = null;
        this.accessToken = null;
    }

    /**
     * Parse WWW-Authenticate header to extract authorization server URL
     *
     * Expected format (RFC 6750):
     * WWW-Authenticate: Bearer realm="http://localhost:3000",
     *                   as_uri="http://localhost:8080/realms/mcp_security",
     *                   scope="mcp:read mcp:write"
     *
     * @param {string} header - WWW-Authenticate header value
     * @returns {object} Parsed authentication parameters
     */
    parseWWWAuthenticate(header) {
        log('info', 'Parsing WWW-Authenticate header...');

        if (!header) {
            throw new Error('No WWW-Authenticate header found in 401 response');
        }

        // Remove "Bearer " prefix
        const authParams = header.replace(/^Bearer\s+/i, '');

        // Parse key=value pairs (handling quoted values)
        const params = {};
        const regex = /(\w+)="([^"]*)"/g;
        let match;

        while ((match = regex.exec(authParams)) !== null) {
            params[match[1]] = match[2];
        }

        log('success', `Discovered authorization server: ${params.as_uri || 'not found'}`);
        log('info', `Realm: ${params.realm || 'not specified'}`);
        log('info', `Required scopes: ${params.scope || 'not specified'}`);

        if (!params.as_uri) {
            throw new Error('WWW-Authenticate header missing required "as_uri" parameter');
        }

        return params;
    }

    /**
     * Fetch protected resource metadata from MCP server
     *
     * Endpoint: /.well-known/oauth-protected-resource (RFC 9728)
     *
     * @param {string} resourceUrl - MCP server base URL
     * @returns {Promise<object>} Protected resource metadata
     */
    async fetchProtectedResourceMetadata(resourceUrl) {
        const metadataUrl = `${resourceUrl}/.well-known/oauth-protected-resource`;

        log('info', `Fetching protected resource metadata: ${metadataUrl}`);

        try {
            const response = await fetch(metadataUrl);

            if (!response.ok) {
                throw new Error(`Metadata endpoint returned ${response.status}: ${await response.text()}`);
            }

            const metadata = await response.json();

            log('success', 'Protected resource metadata retrieved');
            log('info', `Resource: ${metadata.resource}`);
            log('info', `Authorization servers: ${metadata.authorization_servers?.join(', ')}`);
            log('info', `Supported scopes: ${metadata.scopes_supported?.join(', ')}`);

            return metadata;
        } catch (error) {
            log('error', `Failed to fetch protected resource metadata: ${error.message}`);
            throw error;
        }
    }

    /**
     * Fetch authorization server metadata
     *
     * Endpoint: /.well-known/oauth-authorization-server (RFC 8414)
     *
     * @param {string} authServerUrl - Authorization server URL
     * @returns {Promise<object>} Authorization server metadata
     */
    async fetchAuthorizationServerMetadata(authServerUrl) {
        const metadataUrl = `${authServerUrl}/.well-known/oauth-authorization-server`;

        log('info', `Fetching authorization server metadata: ${metadataUrl}`);

        try {
            const response = await fetch(metadataUrl);

            if (!response.ok) {
                throw new Error(`Auth server metadata endpoint returned ${response.status}`);
            }

            const metadata = await response.json();

            log('success', 'Authorization server metadata retrieved');
            log('info', `Issuer: ${metadata.issuer}`);
            log('info', `Authorization endpoint: ${metadata.authorization_endpoint}`);
            log('info', `Token endpoint: ${metadata.token_endpoint}`);

            return metadata;
        } catch (error) {
            log('error', `Failed to fetch authorization server metadata: ${error.message}`);
            throw error;
        }
    }

    /**
     * Perform MCP OAuth discovery flow
     *
     * Steps:
     * 1. Attempt MCP initialize request without auth
     * 2. Parse 401 response WWW-Authenticate header
     * 3. Fetch protected resource metadata
     * 4. Fetch authorization server metadata
     * 5. Build OAuth configuration
     *
     * @param {string} mcpUrl - Full MCP endpoint URL
     * @returns {Promise<object>} Discovered OAuth configuration
     */
    async performDiscovery(mcpUrl) {
        log('info', '🔍 Starting MCP OAuth Discovery...');
        log('info', `Target MCP server: ${mcpUrl}`);

        try {
            // Step 1: Attempt unauthenticated MCP request
            log('info', 'Step 1: Attempting unauthenticated initialize request...');

            const initPayload = {
                jsonrpc: '2.0',
                method: 'initialize',
                params: {
                    protocolVersion: CONFIG.mcp.protocolVersion,
                    capabilities: {},
                    clientInfo: CONFIG.mcp.clientInfo
                },
                id: 1
            };

            const response = await fetch(mcpUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json, text/event-stream'
                },
                body: JSON.stringify(initPayload)
            });

            // Step 2: Check for 401 Unauthorized
            if (response.status === 401) {
                log('success', 'Received 401 Unauthorized (expected for discovery)');

                const wwwAuthenticate = response.headers.get('WWW-Authenticate');

                if (!wwwAuthenticate) {
                    throw new Error('401 response missing WWW-Authenticate header (server may not support OAuth)');
                }

                log('info', `WWW-Authenticate: ${wwwAuthenticate}`);

                // Step 3: Parse WWW-Authenticate header
                const authParams = this.parseWWWAuthenticate(wwwAuthenticate);

                // Extract base URL from MCP endpoint
                const mcpBaseUrl = new URL(mcpUrl).origin;

                // Step 4: Fetch protected resource metadata
                const resourceMetadata = await this.fetchProtectedResourceMetadata(mcpBaseUrl);

                // Step 5: Fetch authorization server metadata
                const authServerUrl = authParams.as_uri || resourceMetadata.authorization_servers?.[0];

                if (!authServerUrl) {
                    throw new Error('Could not determine authorization server URL from discovery');
                }

                const authServerMetadata = await this.fetchAuthorizationServerMetadata(authServerUrl);

                // Step 6: Build discovered OAuth configuration
                this.discoveredConfig = {
                    authorizationEndpoint: authServerMetadata.authorization_endpoint,
                    tokenEndpoint: authServerMetadata.token_endpoint,
                    issuer: authServerMetadata.issuer,
                    scopes: authParams.scope || resourceMetadata.scopes_supported?.join(' ') || 'email openid',
                    clientId: CONFIG.oauth.clientId, // Client must still be pre-registered
                    redirectUri: window.location.origin + window.location.pathname,
                    pkceRequired: authServerMetadata.code_challenge_methods_supported?.includes('S256') || true
                };

                log('success', '✓ MCP OAuth Discovery complete!');
                log('info', 'Discovered configuration:', this.discoveredConfig);

                return this.discoveredConfig;

            } else if (response.status === 200) {
                log('warning', 'Server responded with 200 OK (authentication not required?)');
                log('info', 'This MCP server may not require OAuth authentication');
                return null;
            } else {
                throw new Error(`Unexpected response status: ${response.status}`);
            }

        } catch (error) {
            log('error', `MCP OAuth Discovery failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Generate PKCE code verifier and challenge
     * @returns {Promise<object>} { codeVerifier, codeChallenge }
     */
    async generatePKCE() {
        // Generate code verifier (43-128 characters)
        const randomBytes = new Uint8Array(32);
        crypto.getRandomValues(randomBytes);

        const codeVerifier = btoa(String.fromCharCode(...randomBytes))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');

        // Generate code challenge (SHA-256 hash)
        const encoder = new TextEncoder();
        const data = encoder.encode(codeVerifier);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = new Uint8Array(hashBuffer);

        const codeChallenge = btoa(String.fromCharCode(...hashArray))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');

        return { codeVerifier, codeChallenge };
    }

    /**
     * Initiate OAuth authorization code flow with discovered configuration
     *
     * @returns {Promise<void>} Redirects to authorization endpoint
     */
    async authorize() {
        if (!this.discoveredConfig) {
            throw new Error('Must perform discovery before authorization');
        }

        log('info', 'Starting OAuth authorization code flow...');

        // Generate PKCE parameters
        const { codeVerifier, codeChallenge } = await this.generatePKCE();

        // Store code verifier in sessionStorage for callback
        sessionStorage.setItem('mcp_oauth_code_verifier', codeVerifier);
        sessionStorage.setItem('mcp_oauth_config', JSON.stringify(this.discoveredConfig));

        // Build authorization URL
        const authUrl = new URL(this.discoveredConfig.authorizationEndpoint);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('client_id', this.discoveredConfig.clientId);
        authUrl.searchParams.set('redirect_uri', this.discoveredConfig.redirectUri);
        authUrl.searchParams.set('scope', this.discoveredConfig.scopes);
        authUrl.searchParams.set('code_challenge', codeChallenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');

        log('info', `Redirecting to authorization endpoint: ${authUrl.toString()}`);
        log('info', 'User will authenticate and consent, then be redirected back...');

        // Redirect to authorization endpoint
        window.location.href = authUrl.toString();
    }

    /**
     * Handle OAuth callback (exchange authorization code for token)
     *
     * @param {string} code - Authorization code from redirect
     * @returns {Promise<object>} Token response
     */
    async handleCallback(code) {
        log('info', 'Handling OAuth callback...');

        // Retrieve stored PKCE code verifier
        const codeVerifier = sessionStorage.getItem('mcp_oauth_code_verifier');
        const configJson = sessionStorage.getItem('mcp_oauth_config');

        if (!codeVerifier || !configJson) {
            throw new Error('Missing OAuth state (code_verifier or config). Session may have expired.');
        }

        this.discoveredConfig = JSON.parse(configJson);

        // Exchange authorization code for access token
        log('info', 'Exchanging authorization code for access token...');

        const formData = new URLSearchParams();
        formData.append('grant_type', 'authorization_code');
        formData.append('code', code);
        formData.append('redirect_uri', this.discoveredConfig.redirectUri);
        formData.append('client_id', this.discoveredConfig.clientId);
        formData.append('code_verifier', codeVerifier);

        const response = await fetch(this.discoveredConfig.tokenEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: formData
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Token exchange failed (${response.status}): ${errorText}`);
        }

        const tokenResponse = await response.json();

        log('success', 'Access token obtained via MCP OAuth Discovery!');

        // Store access token
        this.accessToken = tokenResponse.access_token;

        // Clean up session storage
        sessionStorage.removeItem('mcp_oauth_code_verifier');
        sessionStorage.removeItem('mcp_oauth_config');

        // Decode JWT to extract claims
        const claims = this.decodeJWT(tokenResponse.access_token);

        log('info', `Token expires in: ${tokenResponse.expires_in} seconds`);
        log('info', `Subject: ${claims.sub}`);
        log('info', `Email: ${claims.email || 'not provided'}`);

        return {
            accessToken: tokenResponse.access_token,
            tokenType: tokenResponse.token_type,
            expiresIn: tokenResponse.expires_in,
            claims: claims
        };
    }

    /**
     * Decode JWT to extract claims
     * @param {string} token - JWT token
     * @returns {object} Decoded claims
     */
    decodeJWT(token) {
        try {
            const base64Url = token.split('.')[1];
            const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            const jsonPayload = decodeURIComponent(
                atob(base64)
                    .split('')
                    .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
                    .join('')
            );
            return JSON.parse(jsonPayload);
        } catch (error) {
            throw new Error('Failed to decode JWT: ' + error.message);
        }
    }

    /**
     * Get access token
     * @returns {string|null} Access token
     */
    getAccessToken() {
        return this.accessToken;
    }

    /**
     * Check if authenticated via discovery
     * @returns {boolean} True if access token is available
     */
    isAuthenticated() {
        return !!this.accessToken;
    }
}

// Global instance
const mcpOAuthDiscovery = new MCPOAuthDiscovery();
