// MCP OAuth Test Console Application
// Based on working Sample-client-auth pattern

// Initialize Keycloak (CRITICAL: Declare but don't instantiate yet)
let keycloak;
let exchangedToken = null;
let mcpClient = null; // MCP SSE client instance

// Logging
function log(message, type = 'info') {
    const console = document.getElementById('log-console');
    const timestamp = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    entry.innerHTML = `<span class="log-timestamp">[${timestamp}]</span>${message}`;
    console.appendChild(entry);
    console.scrollTop = console.scrollHeight;
}

// Initialize the application (EXACT pattern from Sample-client-auth)
async function init() {
    log('MCP OAuth Test Console initialized', 'info');
    log(`Keycloak URL: ${keycloakConfig.url}`, 'info');
    log(`MCP Server: ${mcpConfig.url}${mcpConfig.endpoint}`, 'info');

    try {
        // Create Keycloak instance (CRITICAL: Create INSIDE init function)
        keycloak = new Keycloak(keycloakConfig);

        log('Keycloak instance created', 'info');
        console.log('Keycloak config:', keycloakConfig);
        console.log('Keycloak auth URL will be:', `${keycloakConfig.url}/realms/${keycloakConfig.realm}/protocol/openid-connect/auth`);

        // Initialize Keycloak with error handling (EXACT pattern from Sample-client-auth)
        const authenticated = await keycloak.init(appConfig.initOptions).catch((error) => {
            console.error('Keycloak init error:', error);
            log('SSO check completed (no existing session)', 'info');
            // If SSO check fails, continue without authentication
            return false;
        });

        log(`Keycloak init complete. Authenticated: ${authenticated}`, 'info');
        log(`Has token: ${!!keycloak.token}`, 'info');
        log(`Has tokenParsed: ${!!keycloak.tokenParsed}`, 'info');

        if (authenticated) {
            log('✓ User is authenticated!', 'success');
            console.log('User is authenticated');
            onLoginSuccess();
        } else {
            log('No existing session - click Login to authenticate', 'info');
            console.log('User is not authenticated');
        }

        // Set up automatic token refresh (from Sample-client-auth)
        setInterval(() => {
            keycloak.updateToken(appConfig.minValidity).then((refreshed) => {
                if (refreshed) {
                    console.log('Token was refreshed');
                    log('Token automatically refreshed', 'success');
                }
            }).catch(() => {
                console.error('Failed to refresh token');
                log('Session expired. Please login again.', 'error');
            });
        }, 60000); // Check every minute

    } catch (error) {
        console.error('Failed to initialize Keycloak', error);
        log(`Failed to initialize Keycloak: ${error.message || String(error)}`, 'error');
    }
}

// Login with Keycloak SSO (EXACT pattern from Sample-client-auth)
async function login() {
    try {
        log('Redirecting to Keycloak SSO login...', 'info');

        // Create login URL for debugging
        const loginUrl = keycloak.createLoginUrl({
            redirectUri: window.location.href,
            prompt: 'login'
        });
        console.log('Login URL:', loginUrl);
        console.log('Redirecting to Keycloak login page...');

        // Perform the redirect
        keycloak.login({
            redirectUri: window.location.href,
            prompt: 'login'
        });
    } catch (error) {
        const errorMessage = error?.message || String(error) || 'Unknown error';
        log(`✗ Login error: ${errorMessage}`, 'error');
        console.error('Login error:', error);
    }
}

// Logout
async function logout() {
    try {
        log('Logging out...', 'info');
        console.log('Logging out and redirecting to Keycloak...');
        await keycloak.logout({
            redirectUri: window.location.origin + window.location.pathname
        });
    } catch (error) {
        log(`✗ Logout error: ${error.message}`, 'error');
    }
}

// Handle successful login
function onLoginSuccess() {
    // Verify we have a token
    if (!keycloak.token || !keycloak.tokenParsed) {
        log('✗ Error: No token available after authentication', 'error');
        console.error('Keycloak state:', keycloak);
        return;
    }

    log('Processing authentication success...', 'info');

    // Update UI
    document.getElementById('auth-status').textContent = 'Connected';
    document.getElementById('auth-status').className = 'status connected';
    document.getElementById('login-btn').style.display = 'none';
    document.getElementById('logout-btn').style.display = 'block';
    document.getElementById('user-info').style.display = 'block';
    document.getElementById('exchange-btn').disabled = false;

    // Display user info
    document.getElementById('username').textContent = keycloak.tokenParsed.preferred_username || 'N/A';
    document.getElementById('email').textContent = keycloak.tokenParsed.email || 'N/A';
    document.getElementById('subject-token').textContent = keycloak.token.substring(0, 100) + '...';

    // Display subject token claims
    displayClaims('subject-claims', keycloak.tokenParsed);

    log(`User logged in: ${keycloak.tokenParsed.preferred_username}`, 'success');
    log(`Subject token obtained from '${keycloak.tokenParsed.azp}' client`, 'success');

    // Validate azp claim
    if (keycloak.tokenParsed.azp === keycloakConfig.clientId) {
        log(`✓ PASS: azp claim is '${keycloakConfig.clientId}' (correct for subject token)`, 'success');
    } else {
        log(`✗ FAIL: azp claim is '${keycloak.tokenParsed.azp}', expected '${keycloakConfig.clientId}'`, 'error');
    }
}

// Exchange Token (RFC 8693) - using Sample-client-auth pattern
async function exchangeToken() {
    try {
        log('Starting token exchange (RFC 8693)...', 'info');
        log(`Exchanging token for client: ${tokenExchangeConfig.client_id}`, 'info');

        const tokenUrl = `${keycloakConfig.url}/realms/${keycloakConfig.realm}/protocol/openid-connect/token`;

        const formData = new URLSearchParams();
        formData.append('grant_type', tokenExchangeConfig.grant_type);
        formData.append('client_id', tokenExchangeConfig.client_id);
        formData.append('client_secret', tokenExchangeConfig.client_secret);
        formData.append('subject_token', keycloak.token);
        formData.append('subject_token_type', 'urn:ietf:params:oauth:token-type:access_token');
        formData.append('requested_token_type', tokenExchangeConfig.requested_token_type);
        formData.append('audience', tokenExchangeConfig.audience);

        console.log('Token exchange endpoint:', tokenUrl);
        console.log('Exchange parameters:', {
            grant_type: tokenExchangeConfig.grant_type,
            client_id: tokenExchangeConfig.client_id,
            audience: tokenExchangeConfig.audience,
            subject_token: keycloak.token.substring(0, 50) + '...'
        });

        const response = await fetch(tokenUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: formData
        });

        const data = await response.json();

        if (data.error) {
            log(`✗ Token exchange failed: ${data.error_description || data.error}`, 'error');
            throw new Error(data.error_description || data.error);
        }

        exchangedToken = data.access_token;

        // Update UI
        document.getElementById('exchange-status').textContent = 'Token Exchanged';
        document.getElementById('exchange-status').className = 'status exchanged';
        document.getElementById('exchange-info').style.display = 'block';
        document.getElementById('exchanged-token').textContent = exchangedToken.substring(0, 100) + '...';

        // Enable MCP tools
        document.getElementById('user-info-btn').disabled = false;
        document.getElementById('health-btn').disabled = false;
        document.getElementById('sql-btn').disabled = false;

        // Parse and display exchanged token claims
        const tokenParts = exchangedToken.split('.');
        const payload = JSON.parse(atob(tokenParts[1]));
        displayClaims('exchanged-claims', payload);

        log('✓ Token exchange successful!', 'success');
        log(`Exchanged token obtained for '${payload.azp}' client`, 'success');

        // Validate azp claim on exchanged token
        if (payload.azp === tokenExchangeConfig.client_id) {
            log(`✓ PASS: azp claim is '${tokenExchangeConfig.client_id}' (correct for exchanged token)`, 'success');
        } else {
            log(`✗ FAIL: azp claim is '${payload.azp}', expected '${tokenExchangeConfig.client_id}'`, 'error');
        }

        log('Ready to initialize MCP connection!', 'success');

        // Initialize MCP session with exchanged token
        await initializeMcpSession();

    } catch (error) {
        log(`✗ Token exchange error: ${error.message}`, 'error');
        console.error('Token exchange error:', error);
    }
}

// Initialize MCP Session using SSE client
async function initializeMcpSession() {
    try {
        log('Initializing MCP session with SSE client...', 'info');

        // Create MCP client instance
        mcpClient = new MCPClient(mcpConfig.url, mcpConfig.endpoint);

        // Connect with exchanged token
        const result = await mcpClient.connect(exchangedToken);

        log(`✓ MCP session initialized!`, 'success');
        log(`  Protocol version: ${result.protocolVersion}`, 'info');
        log(`  Server: ${result.serverInfo?.name} ${result.serverInfo?.version}`, 'info');

        // Update MCP status
        document.getElementById('mcp-status').textContent = 'Connected';
        document.getElementById('mcp-status').className = 'status connected';

    } catch (error) {
        log(`✗ MCP initialization error: ${error.message}`, 'error');
        console.error('MCP initialization error:', error);
    }
}

// Display JWT claims
function displayClaims(elementId, claims) {
    const element = document.getElementById(elementId);
    const formatted = JSON.stringify(claims, null, 2);
    element.innerHTML = `<pre>${formatted}</pre>`;

    // Highlight critical claims
    const critical = {
        iss: claims.iss,
        aud: claims.aud,
        azp: claims.azp,
        sub: claims.sub,
        exp: claims.exp ? new Date(claims.exp * 1000).toISOString() : 'N/A'
    };

    log(`Claims: iss=${critical.iss}, aud=${critical.aud}, azp=${critical.azp}`, 'info');
}

// Call MCP Tool using SSE client
async function callMcpTool(toolName) {
    if (!mcpClient) {
        log('✗ MCP client not connected', 'error');
        return;
    }

    try {
        log(`Calling MCP tool: ${toolName}...`, 'info');
        document.getElementById('mcp-status').textContent = 'Calling...';
        document.getElementById('mcp-status').className = 'status exchanged';

        // Prepare tool-specific arguments
        let arguments = {};
        if (toolName === 'health-check') {
            arguments = { service: 'all' };
        } else if (toolName === 'sql-delegate') {
            arguments = {
                action: 'query',
                sql: 'SELECT SYSTEM_USER, CURRENT_USER, SESSION_USER',
                resource: 'test-database'
            };
        }

        // Call tool via MCP client
        const response = await mcpClient.callTool(toolName, arguments);

        console.log('Tool response:', response);
        if (response.error) {
            console.error('Tool error details:', JSON.stringify(response.error, null, 2));
        }

        // Update status
        if (response.error) {
            document.getElementById('mcp-status').textContent = 'Error';
            document.getElementById('mcp-status').className = 'status disconnected';
            log(`✗ ${toolName} call failed: ${response.error.message}`, 'error');
        } else {
            document.getElementById('mcp-status').textContent = 'Connected';
            document.getElementById('mcp-status').className = 'status connected';
            log(`✓ ${toolName} call successful!`, 'success');
        }

        // Display response
        document.getElementById('mcp-response').style.display = 'block';
        document.getElementById('mcp-response').textContent = JSON.stringify(response, null, 2);

    } catch (error) {
        log(`✗ MCP call error: ${error.message}`, 'error');
        document.getElementById('mcp-status').textContent = 'Error';
        document.getElementById('mcp-status').className = 'status disconnected';
        document.getElementById('mcp-response').style.display = 'block';
        document.getElementById('mcp-response').textContent = `Error: ${error.message}`;
        console.error('MCP call error:', error);
    }
}

// Initialize on page load (CRITICAL: Use DOMContentLoaded like Sample-client-auth)
document.addEventListener('DOMContentLoaded', init);