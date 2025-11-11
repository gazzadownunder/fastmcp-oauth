/**
 * Authentication Module
 *
 * Handles OAuth 2.1 authentication flows:
 * - Password Grant (Resource Owner Password Credentials)
 * - Authorization Code Flow (SSO Redirect)
 * - Manual JWT Import
 * - JWT Decoding and Claims Extraction
 */

class AuthenticationManager {
    constructor() {
        this.accessToken = null;
        this.idToken = null;  // Store id_token for logout
        this.claims = null;
        this.pkceCodeVerifier = null;  // Store PKCE code_verifier for token exchange
    }

    /**
     * Generate cryptographically secure random string for PKCE code_verifier
     * @returns {string} Base64URL encoded random string (43-128 characters)
     */
    generateCodeVerifier() {
        // Generate 32 random bytes (256 bits)
        const randomBytes = new Uint8Array(32);
        crypto.getRandomValues(randomBytes);

        // Convert to base64url encoding (RFC 7636 Section 4.1)
        return this.base64UrlEncode(randomBytes);
    }

    /**
     * Generate code_challenge from code_verifier using SHA-256
     * @param {string} codeVerifier - PKCE code verifier
     * @returns {Promise<string>} Base64URL encoded SHA-256 hash
     */
    async generateCodeChallenge(codeVerifier) {
        // SHA-256 hash the code_verifier
        const encoder = new TextEncoder();
        const data = encoder.encode(codeVerifier);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);

        // Convert to base64url encoding
        const hashArray = new Uint8Array(hashBuffer);
        return this.base64UrlEncode(hashArray);
    }

    /**
     * Base64URL encode (RFC 7636 Appendix A)
     * @param {Uint8Array} buffer - Bytes to encode
     * @returns {string} Base64URL encoded string
     */
    base64UrlEncode(buffer) {
        // Convert to base64
        const base64 = btoa(String.fromCharCode(...buffer));

        // Convert base64 to base64url (RFC 4648 Section 5)
        return base64
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');
    }

    /**
     * Decode JWT and extract claims
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
     * Password Grant Flow
     * @returns {Promise<object>} Token response
     */
    async loginWithPassword() {
        log('info', 'Starting Password Grant flow...');

        // Use runtime scope if available (from UI), otherwise fall back to config
        const scope = (typeof getRuntimeScope !== 'undefined' ? getRuntimeScope('password') : null)
                      || CONFIG.oauth.scopes?.password
                      || CONFIG.oauth.scope;

        const formData = new URLSearchParams();
        formData.append('grant_type', 'password');
        formData.append('client_id', CONFIG.oauth.clientId);
        formData.append('client_secret', CONFIG.oauth.clientSecret);
        formData.append('username', CONFIG.oauth.testUser.username);
        formData.append('password', CONFIG.oauth.testUser.password);
        formData.append('scope', scope);

        log('info', `Requesting token for user: ${CONFIG.oauth.testUser.username}`);
        log('info', `Scope: ${scope}`);

        const response = await fetch(CONFIG.oauth.tokenEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: formData.toString()
        });

        const data = await response.json();

        if (!response.ok || !data.access_token) {
            log('error', `Password grant failed: ${data.error_description || data.error}`);
            throw new Error(data.error_description || data.error || 'Authentication failed');
        }

        log('success', 'Password grant successful');
        this.setAccessToken(data.access_token);
        // Store id_token if present (needed for logout)
        if (data.id_token) {
            this.idToken = data.id_token;
            log('info', 'ID token stored for logout');
        }
        return data;
    }

    /**
     * SSO Redirect Flow (Authorization Code)
     * @param {boolean} forceLogin - If true, force login prompt (bypass SSO cookies)
     */
    async redirectToSSO(forceLogin = false) {
        log('info', 'Redirecting to Keycloak SSO...');

        // Use runtime scope if available (from UI), otherwise fall back to config
        const scope = (typeof getRuntimeScope !== 'undefined' ? getRuntimeScope('sso') : null)
                      || CONFIG.oauth.scopes?.sso
                      || CONFIG.oauth.scope;

        const params = new URLSearchParams({
            client_id: CONFIG.oauth.clientId,
            redirect_uri: CONFIG.oauth.redirectUri,
            response_type: CONFIG.oauth.responseType,
            scope: scope
        });

        log('info', `Scope: ${scope}`);

        // PKCE support (RFC 7636)
        if (CONFIG.oauth.pkce.enabled) {
            log('info', '🔐 PKCE enabled - Generating code_verifier and code_challenge...');

            // Generate code_verifier and store it
            this.pkceCodeVerifier = this.generateCodeVerifier();
            console.log('[AUTH] PKCE code_verifier generated (length:', this.pkceCodeVerifier.length, ')');

            // Generate code_challenge from code_verifier
            const codeChallenge = await this.generateCodeChallenge(this.pkceCodeVerifier);
            console.log('[AUTH] PKCE code_challenge generated (SHA-256)');

            // Add PKCE parameters to authorization request
            params.append('code_challenge', codeChallenge);
            params.append('code_challenge_method', CONFIG.oauth.pkce.codeChallengeMethod);

            log('success', `✓ PKCE parameters added (method: ${CONFIG.oauth.pkce.codeChallengeMethod})`);

            // Store code_verifier in sessionStorage for callback
            sessionStorage.setItem('pkce_code_verifier', this.pkceCodeVerifier);
        }

        // Add prompt=login to force fresh authentication (bypass SSO cookies)
        if (forceLogin) {
            params.append('prompt', 'login');
            params.append('max_age', '0');
            log('warning', '⚠ Forcing login prompt (bypassing SSO cookies)');
            console.log('[AUTH] prompt=login added to bypass SSO session');
        }

        const authUrl = `${CONFIG.oauth.authEndpoint}?${params.toString()}`;
        log('info', `Redirect URL: ${authUrl}`);
        console.log('[AUTH] SSO URL:', authUrl);

        window.location.href = authUrl;
    }

    /**
     * Discover OAuth authorization endpoint from MCP server
     * Fetches /.well-known/oauth-authorization-server from MCP server
     * @returns {Promise<object>} Authorization server metadata
     */
    async discoverOAuthEndpoints() {
        log('info', '🔍 Discovering OAuth endpoints from MCP server...');

        const discoveryUrl = `${CONFIG.mcp.baseUrl}/.well-known/oauth-authorization-server`;
        log('info', `Discovery URL: ${discoveryUrl}`);

        try {
            const response = await fetch(discoveryUrl);

            if (!response.ok) {
                throw new Error(`Discovery failed: HTTP ${response.status}`);
            }

            const metadata = await response.json();
            log('success', `✓ Discovered authorization endpoint: ${metadata.authorization_endpoint}`);
            console.log('[AUTH] OAuth Server Metadata:', metadata);

            return metadata;
        } catch (error) {
            log('error', `OAuth discovery failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * MCP OAuth Discovery Flow
     * Discovers authorization endpoint from MCP server and redirects to it
     * @param {boolean} forceLogin - If true, force login prompt (bypass SSO cookies)
     */
    async redirectToMCPOAuth(forceLogin = false) {
        log('info', '🔗 Starting MCP OAuth Discovery flow...');

        try {
            // Discover OAuth endpoints from MCP server
            const metadata = await this.discoverOAuthEndpoints();

            // Use discovered authorization endpoint
            const authEndpoint = metadata.authorization_endpoint;

            // Use runtime scope if available (from UI), otherwise fall back to config
            const scope = (typeof getRuntimeScope !== 'undefined' ? getRuntimeScope('mcpOAuth') : null)
                          || CONFIG.oauth.scopes?.mcpOAuth
                          || CONFIG.oauth.scope;

            const params = new URLSearchParams({
                client_id: CONFIG.oauth.clientId,
                redirect_uri: CONFIG.oauth.redirectUri,
                response_type: CONFIG.oauth.responseType,
                scope: scope
            });

            log('info', `Scope: ${scope}`);

            // PKCE support (RFC 7636)
            if (CONFIG.oauth.pkce.enabled) {
                log('info', '🔐 PKCE enabled - Generating code_verifier and code_challenge...');

                // Generate code_verifier and store it
                this.pkceCodeVerifier = this.generateCodeVerifier();
                console.log('[AUTH] PKCE code_verifier generated (length:', this.pkceCodeVerifier.length, ')');

                // Generate code_challenge from code_verifier
                const codeChallenge = await this.generateCodeChallenge(this.pkceCodeVerifier);
                console.log('[AUTH] PKCE code_challenge generated (SHA-256)');

                // Add PKCE parameters to authorization request
                params.append('code_challenge', codeChallenge);
                params.append('code_challenge_method', CONFIG.oauth.pkce.codeChallengeMethod);

                log('success', `✓ PKCE parameters added (method: ${CONFIG.oauth.pkce.codeChallengeMethod})`);

                // Store code_verifier in sessionStorage for callback
                sessionStorage.setItem('pkce_code_verifier', this.pkceCodeVerifier);
            }

            // Add prompt=login to force fresh authentication (bypass SSO cookies)
            if (forceLogin) {
                params.append('prompt', 'login');
                params.append('max_age', '0');
                log('warning', '⚠ Forcing login prompt (bypassing SSO cookies)');
                console.log('[AUTH] prompt=login added to bypass SSO session');
            }

            // Add state parameter to track MCP OAuth flow
            const state = btoa(JSON.stringify({ flow: 'mcp-oauth', timestamp: Date.now() }));
            params.append('state', state);

            const authUrl = `${authEndpoint}?${params.toString()}`;
            log('info', `Redirecting to discovered endpoint: ${authEndpoint}`);
            log('info', `Full URL: ${authUrl}`);
            console.log('[AUTH] MCP OAuth URL:', authUrl);

            window.location.href = authUrl;
        } catch (error) {
            log('error', `MCP OAuth discovery failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Inspector-Style Authorization Code Flow (PUBLIC CLIENT)
     * Minimal parameter OAuth 2.1 flow matching MCP Inspector behavior
     *
     * Client Type: PUBLIC (browser-based application per OAuth 2.1)
     *
     * Key Differences from Standard OAuth:
     * - Public client (no client_secret - PKCE provides security)
     * - No state parameter (PKCE provides CSRF protection per OAuth 2.1)
     * - No scope parameter (uses IDP default scopes)
     * - Minimal parameters: response_type, client_id, redirect_uri, code_challenge, code_challenge_method
     *
     * Security:
     * - PKCE (S256) provides CSRF protection and code interception protection
     * - No client_secret exposed in browser (public client per OAuth 2.1)
     * - Redirect URI must match between authorization request and token exchange
     * - Authorization code is single-use and time-limited
     *
     * Requirements:
     * - Keycloak client MUST be configured as PUBLIC (Client authentication: OFF)
     *
     * @returns {Promise<void>} Redirects to authorization endpoint
     */
    async redirectToInspectorAuth() {
        log('info', '🔍 Starting Inspector-Style OAuth flow...');

        if (!CONFIG.oauth.inspector.enabled) {
            log('error', 'Inspector-style OAuth is disabled in configuration');
            throw new Error('Inspector-style OAuth is not enabled');
        }

        // Generate PKCE parameters (REQUIRED for OAuth 2.1)
        log('info', '🔐 Generating PKCE parameters...');
        this.pkceCodeVerifier = this.generateCodeVerifier();
        console.log('[AUTH-INSPECTOR] PKCE code_verifier generated (length:', this.pkceCodeVerifier.length, ')');

        // Generate code_challenge from code_verifier using SHA-256
        const codeChallenge = await this.generateCodeChallenge(this.pkceCodeVerifier);
        console.log('[AUTH-INSPECTOR] PKCE code_challenge generated (SHA-256)');

        // Store code_verifier for token exchange callback
        sessionStorage.setItem('pkce_code_verifier', this.pkceCodeVerifier);
        sessionStorage.setItem('auth_method', 'inspector');
        log('success', '✓ PKCE parameters stored for callback');

        // Build MINIMAL authorization request (Inspector-style)
        // Required OAuth 2.1 parameters + redirect_uri (needed by Keycloak)
        const params = new URLSearchParams({
            response_type: 'code',                              // REQUIRED
            client_id: CONFIG.oauth.inspector.clientId,         // REQUIRED
            redirect_uri: CONFIG.oauth.inspector.preRegisteredRedirectUri, // REQUIRED (for Keycloak to know where to redirect)
            code_challenge: codeChallenge,                      // REQUIRED (PKCE)
            code_challenge_method: 'S256'                       // REQUIRED (PKCE)
        });

        // Add scope if configured (optional - overrides useDefaultScopes behavior)
        // Use runtime scope if available (from UI), otherwise fall back to config
        const configuredScope = (typeof getRuntimeScope !== 'undefined' ? getRuntimeScope('inspector') : null)
                                || CONFIG.oauth.scopes?.inspector;
        if (configuredScope && !CONFIG.oauth.inspector.useDefaultScopes) {
            params.append('scope', configuredScope);
            log('info', `Scope: ${configuredScope}`);
        } else if (CONFIG.oauth.inspector.useDefaultScopes) {
            log('warning', '⚠ No scope parameter (uses IDP defaults)');
        }

        const authUrl = `${CONFIG.oauth.inspector.authEndpoint}?${params.toString()}`;

        log('success', '✓ Inspector-style OAuth request built (minimal parameters)');
        log('info', 'Parameters:');
        log('info', '  - response_type: code');
        log('info', '  - client_id: ' + CONFIG.oauth.inspector.clientId);
        log('info', '  - redirect_uri: ' + CONFIG.oauth.inspector.preRegisteredRedirectUri);
        log('info', '  - code_challenge: ' + codeChallenge.substring(0, 20) + '...');
        log('info', '  - code_challenge_method: S256');
        log('warning', '⚠ No state parameter (PKCE provides CSRF protection)');
        console.log('[AUTH-INSPECTOR] Authorization URL:', authUrl);

        // Redirect to IDP authorization endpoint
        log('info', `Redirecting to: ${CONFIG.oauth.inspector.authEndpoint}`);
        window.location.href = authUrl;
    }

    /**
     * Handle SSO Callback (exchange authorization code for token)
     * @param {string} code - Authorization code
     * @returns {Promise<object>} Token response
     */
    async handleSSOCallback(code) {
        log('info', 'Processing SSO callback...');
        log('info', `Authorization code: ${code.substring(0, 20)}...`);

        // Detect which authentication method was used
        const authMethod = sessionStorage.getItem('auth_method') || 'standard';
        const isInspectorStyle = authMethod === 'inspector';

        if (isInspectorStyle) {
            log('info', '🔍 Inspector-style token exchange detected');
        } else {
            log('info', '🌐 Standard OAuth token exchange');
        }

        // Clean up URL (use appropriate redirect URI)
        const cleanupUri = isInspectorStyle
            ? CONFIG.oauth.inspector.preRegisteredRedirectUri
            : CONFIG.oauth.redirectUri;
        window.history.replaceState({}, document.title, cleanupUri);

        // Build token exchange request
        const formData = new URLSearchParams();
        formData.append('grant_type', 'authorization_code');
        formData.append('code', code);

        // Inspector-style: Use pre-registered redirect_uri in token exchange
        // Standard OAuth: Use redirect_uri from config
        // Note: Keycloak requires redirect_uri in token exchange even if not sent in auth request
        if (isInspectorStyle) {
            formData.append('redirect_uri', CONFIG.oauth.inspector.preRegisteredRedirectUri);
            log('info', '🔍 Using pre-registered redirect_uri: ' + CONFIG.oauth.inspector.preRegisteredRedirectUri);
        } else {
            formData.append('redirect_uri', CONFIG.oauth.redirectUri);
            log('info', '  - redirect_uri: ' + CONFIG.oauth.redirectUri);
        }

        // Add client credentials (use appropriate config)
        if (isInspectorStyle) {
            // Inspector-style: Public client (no client_secret per OAuth 2.1)
            // Browser-based applications should NOT send client_secret
            // PKCE provides security instead of client credentials
            formData.append('client_id', CONFIG.oauth.inspector.clientId);
            log('info', '🔓 Public client (no client_secret - PKCE provides security)');
            console.log('[AUTH-INSPECTOR] Public client - no client_secret sent');
        } else {
            // Standard OAuth: Confidential client (includes client_secret)
            formData.append('client_id', CONFIG.oauth.clientId);
            formData.append('client_secret', CONFIG.oauth.clientSecret);
        }

        // PKCE support - Include code_verifier (REQUIRED for PKCE flows)
        const codeVerifier = sessionStorage.getItem('pkce_code_verifier');

        if (codeVerifier) {
            formData.append('code_verifier', codeVerifier);
            log('info', '🔐 PKCE code_verifier included in token exchange');
            console.log(`[AUTH${isInspectorStyle ? '-INSPECTOR' : ''}] code_verifier retrieved (length: ${codeVerifier.length})`);

            // Clear code_verifier from storage after use (one-time use)
            sessionStorage.removeItem('pkce_code_verifier');
            this.pkceCodeVerifier = null;
        } else {
            log('warning', '⚠ PKCE code_verifier not found - token exchange may fail');
            console.warn('[AUTH] PKCE code_verifier missing');
        }

        // Determine token endpoint
        const tokenEndpoint = isInspectorStyle
            ? CONFIG.oauth.inspector.tokenEndpoint
            : CONFIG.oauth.tokenEndpoint;

        log('info', `Token endpoint: ${tokenEndpoint}`);
        console.log(`[AUTH${isInspectorStyle ? '-INSPECTOR' : ''}] Token exchange request:`, {
            endpoint: tokenEndpoint,
            parameters: Object.fromEntries(formData.entries())
        });

        const response = await fetch(tokenEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: formData.toString()
        });

        const data = await response.json();

        if (!response.ok || !data.access_token) {
            log('error', `❌ Code exchange failed (HTTP ${response.status})`);
            log('error', `Error: ${data.error || 'unknown'}`);
            log('error', `Description: ${data.error_description || 'No description'}`);

            console.error(`[AUTH${isInspectorStyle ? '-INSPECTOR' : ''}] ========== TOKEN EXCHANGE ERROR ==========`);
            console.error(`HTTP Status: ${response.status} ${response.statusText}`);
            console.error(`Error Code: ${data.error || 'unknown'}`);
            console.error(`Error Description: ${data.error_description || 'No description'}`);
            console.error(`Full Response:`, data);
            console.error(`Request Parameters:`, Object.fromEntries(formData.entries()));
            console.error(`=========================================`);

            // Provide helpful troubleshooting hints
            if (data.error === 'unauthorized_client' || data.error === 'invalid_client') {
                log('error', '💡 Hint: Check Keycloak client configuration');
                log('error', '   - Client authentication should be OFF (public client)');
                log('error', '   - PKCE Code Challenge Method should be S256');
                console.error('[HINT] This error usually means:');
                console.error('  1. Client is configured as CONFIDENTIAL (needs client_secret)');
                console.error('  2. Go to Keycloak Admin → Clients → mcp-oauth → Settings');
                console.error('  3. Set "Client authentication" to OFF');
                console.error('  4. Set "PKCE Code Challenge Method" to S256 in Advanced Settings');
            } else if (data.error === 'invalid_grant') {
                log('error', '💡 Hint: Authorization code or PKCE validation failed');
                log('error', '   - Code may have expired or already been used');
                log('error', '   - PKCE code_verifier may not match code_challenge');
                console.error('[HINT] This error usually means:');
                console.error('  1. Authorization code expired (try again immediately)');
                console.error('  2. PKCE code_verifier doesn\'t match code_challenge');
                console.error('  3. redirect_uri mismatch between auth and token requests');
            }

            throw new Error(data.error_description || data.error || 'Code exchange failed');
        }

        log('success', `✓ Authorization code exchanged successfully (${isInspectorStyle ? 'Inspector-style' : 'Standard OAuth'})`);
        this.setAccessToken(data.access_token);

        // Store id_token if present (needed for logout)
        if (data.id_token) {
            this.idToken = data.id_token;
            log('info', 'ID token stored for logout');
        }

        // Clean up auth method marker
        sessionStorage.removeItem('auth_method');

        return data;
    }

    /**
     * Set access token and decode claims
     * @param {string} token - JWT token
     * @param {object} claims - Optional pre-decoded claims (for external discovery flows)
     */
    setAccessToken(token, claims = null) {
        this.accessToken = token;
        this.claims = claims || this.decodeJWT(token);
        log('success', `Access token set. Subject: ${this.claims.sub || 'unknown'}`);
    }

    /**
     * Get active token
     * @returns {string|null} Active JWT token
     */
    getActiveToken() {
        return this.accessToken;
    }

    /**
     * Check if authenticated
     * @returns {boolean} True if authenticated
     */
    isAuthenticated() {
        return this.accessToken !== null;
    }

    /**
     * Logout - Redirect to Keycloak OIDC logout endpoint
     * Uses GET /realms/{realm}/protocol/openid-connect/logout
     * Required parameters:
     *   - id_token_hint (for session identification)
     *   - post_logout_redirect_uri (where to redirect after logout)
     *   - client_id (which client is logging out)
     */
    logout() {
        log('info', '========== OIDC LOGOUT ==========');
        log('info', 'Starting Keycloak OIDC logout...');

        console.log('[AUTH] Logout State:');
        console.log('  accessToken:', this.accessToken ? this.accessToken.substring(0, 50) + '...' : 'NONE');
        console.log('  idToken:', this.idToken ? this.idToken.substring(0, 50) + '...' : 'NONE');

        if (!this.idToken) {
            log('warning', '⚠ No ID token available - logout may not clear SSO cookies');
            console.warn('[AUTH] Missing id_token - Keycloak may not terminate SSO session');
        }

        // Build OIDC logout URL
        const logoutEndpoint = CONFIG.oauth.logoutEndpoint;
        const redirectUri = window.location.origin + window.location.pathname + '?logged_out=true';

        const params = new URLSearchParams();
        params.append('post_logout_redirect_uri', redirectUri);
        params.append('client_id', CONFIG.oauth.clientId);

        // CRITICAL: Include id_token_hint for proper session termination
        if (this.idToken) {
            params.append('id_token_hint', this.idToken);
            log('info', '✓ id_token_hint will be included in logout request');
            console.log('[AUTH] ✓ id_token_hint present (length:', this.idToken.length, ')');
        } else {
            log('error', '✗ id_token_hint MISSING - SSO cookies may persist');
            console.error('[AUTH] ✗ id_token_hint MISSING');
        }

        const logoutUrl = `${logoutEndpoint}?${params.toString()}`;

        console.log('[AUTH] OIDC Logout URL (GET request):');
        console.log('  Endpoint:', logoutEndpoint);
        console.log('  Method: GET');
        console.log('  Parameters:');
        console.log('    - post_logout_redirect_uri:', redirectUri);
        console.log('    - client_id:', CONFIG.oauth.clientId);
        console.log('    - id_token_hint:', this.idToken ? 'PRESENT' : 'MISSING ❌');

        log('info', 'Redirecting to: ' + logoutEndpoint);
        log('info', 'Expected flow:');
        log('info', '  1. GET → /protocol/openid-connect/logout');
        log('info', '  2. Keycloak validates id_token_hint');
        log('info', '  3. Keycloak terminates session');
        log('info', '  4. Keycloak deletes SSO cookies (Set-Cookie: Max-Age=0)');
        log('info', '  5. Keycloak redirects back to app');
        log('info', '========== END OIDC LOGOUT ==========');

        console.log('[AUTH] Full logout URL:', logoutUrl);

        // Clear local tokens before redirect
        this.accessToken = null;
        this.idToken = null;
        this.claims = null;

        // Redirect to Keycloak logout (GET request)
        window.location.href = logoutUrl;
    }

    /**
     * Get user information from claims
     * @returns {object} User information
     */
    getUserInfo() {
        if (!this.claims) {
            return null;
        }

        return {
            sub: this.claims.sub || 'unknown',
            email: this.claims.email || this.claims.preferred_username || 'unknown',
            name: this.claims.name || this.claims.preferred_username || 'unknown',
            roles: this.claims.roles || this.claims.realm_access?.roles || [],
            legacyUsername: this.claims.legacy_sam_account || this.claims.legacy_name || null
        };
    }
}

// Global authentication manager instance
const authManager = new AuthenticationManager();

console.log('✓ Authentication module loaded');
