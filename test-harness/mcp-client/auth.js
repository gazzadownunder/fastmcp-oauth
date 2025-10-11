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
        this.claims = null;
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

        const formData = new URLSearchParams();
        formData.append('grant_type', 'password');
        formData.append('client_id', CONFIG.oauth.clientId);
        formData.append('client_secret', CONFIG.oauth.clientSecret);
        formData.append('username', CONFIG.oauth.testUser.username);
        formData.append('password', CONFIG.oauth.testUser.password);
        formData.append('scope', CONFIG.oauth.scope);

        log('info', `Requesting token for user: ${CONFIG.oauth.testUser.username}`);

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
        return data;
    }

    /**
     * SSO Redirect Flow (Authorization Code)
     */
    redirectToSSO() {
        log('info', 'Redirecting to Keycloak SSO...');

        const params = new URLSearchParams({
            client_id: CONFIG.oauth.clientId,
            redirect_uri: CONFIG.oauth.redirectUri,
            response_type: CONFIG.oauth.responseType,
            scope: CONFIG.oauth.scope
        });

        const authUrl = `${CONFIG.oauth.authEndpoint}?${params.toString()}`;
        log('info', `Redirect URL: ${authUrl}`);

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

        // Clean up URL
        window.history.replaceState({}, document.title, CONFIG.oauth.redirectUri);

        const formData = new URLSearchParams();
        formData.append('grant_type', 'authorization_code');
        formData.append('code', code);
        formData.append('redirect_uri', CONFIG.oauth.redirectUri);
        formData.append('client_id', CONFIG.oauth.clientId);
        formData.append('client_secret', CONFIG.oauth.clientSecret);

        const response = await fetch(CONFIG.oauth.tokenEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: formData.toString()
        });

        const data = await response.json();

        if (!response.ok || !data.access_token) {
            log('error', `Code exchange failed: ${data.error_description || data.error}`);
            throw new Error(data.error_description || data.error || 'Code exchange failed');
        }

        log('success', 'Authorization code exchanged successfully');
        this.setAccessToken(data.access_token);
        return data;
    }

    /**
     * Set access token and decode claims
     * @param {string} token - JWT token
     */
    setAccessToken(token) {
        this.accessToken = token;
        this.claims = this.decodeJWT(token);
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
     * Logout and clear all tokens
     */
    logout() {
        log('info', 'Logging out...');
        this.accessToken = null;
        this.claims = null;
        log('success', 'Logout successful');
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
