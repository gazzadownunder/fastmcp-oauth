// Initialize Keycloak
let keycloak;
let tokenUpdateTimer;

// DOM Elements
const elements = {
    loading: document.getElementById('loading'),
    unauthenticated: document.getElementById('unauthenticated'),
    authenticated: document.getElementById('authenticated'),
    error: document.getElementById('error'),
    loginBtn: document.getElementById('loginBtn'),
    logoutBtn: document.getElementById('logoutBtn'),
    refreshBtn: document.getElementById('refreshBtn'),
    retryBtn: document.getElementById('retryBtn'),
    toggleDebug: document.getElementById('toggleDebug'),
    debugContent: document.getElementById('debugContent'),
    debugOutput: document.getElementById('debugOutput'),
    errorMessage: document.getElementById('errorMessage'),
    userName: document.getElementById('userName'),
    userDetails: document.getElementById('userDetails'),
    tokenDetails: document.getElementById('tokenDetails'),
    sessionDetails: document.getElementById('sessionDetails'),
    idpUrl: document.getElementById('idpUrl'),
    realmName: document.getElementById('realmName'),
    exchangeBtn: document.getElementById('exchangeBtn'),
    exchangeResult: document.getElementById('exchangeResult'),
    exchangeStatus: document.getElementById('exchangeStatus'),
    exchangeDetails: document.getElementById('exchangeDetails'),
    exchangedToken: document.getElementById('exchangedToken')
};

// Initialize the application
async function init() {
    showSection('loading');

    try {
        // Create Keycloak instance
        keycloak = new Keycloak(keycloakConfig);

        console.log('Keycloak config:', keycloakConfig);
        console.log('Keycloak auth URL will be:', `${keycloakConfig.url}/realms/${keycloakConfig.realm}/protocol/openid-connect/auth`);

        // Update IDP information display
        elements.idpUrl.textContent = keycloakConfig.url;
        elements.realmName.textContent = keycloakConfig.realm;

        // Initialize Keycloak with error handling
        const authenticated = await keycloak.init(appConfig.initOptions).catch((error) => {
            console.error('Keycloak init error:', error);
            // If SSO check fails, continue without authentication
            return false;
        });

        if (authenticated) {
            console.log('User is authenticated');
            await loadUserProfile();
            showAuthenticatedView();
            startTokenUpdateTimer();
        } else {
            console.log('User is not authenticated');
            showUnauthenticatedView();
        }

        // Set up automatic token refresh
        setInterval(() => {
            keycloak.updateToken(appConfig.minValidity).then((refreshed) => {
                if (refreshed) {
                    console.log('Token was refreshed');
                    updateTokenDisplay();
                    updateDebugInfo();
                }
            }).catch(() => {
                console.error('Failed to refresh token');
                showError('Session expired. Please login again.');
            });
        }, 60000); // Check every minute

    } catch (error) {
        console.error('Failed to initialize Keycloak', error);
        showError('Failed to connect to Keycloak. Please ensure Keycloak is running on ' + keycloakConfig.url);
    }
}

// Load user profile
async function loadUserProfile() {
    try {
        const profile = await keycloak.loadUserProfile();
        updateUserDisplay(profile);
    } catch (error) {
        console.error('Failed to load user profile', error);
    }
}

// Show specific section
function showSection(section) {
    const sections = ['loading', 'unauthenticated', 'authenticated', 'error'];
    sections.forEach(s => {
        const element = elements[s];
        if (element) {
            element.classList.toggle('hidden', s !== section);
        }
    });
}

// Show authenticated view
function showAuthenticatedView() {
    showSection('authenticated');
    updateTokenDisplay();
    updateSessionDisplay();
    updateDebugInfo();
}

// Show unauthenticated view
function showUnauthenticatedView() {
    showSection('unauthenticated');
    updateDebugInfo();
}

// Show error
function showError(message) {
    showSection('error');
    elements.errorMessage.textContent = message;
}

// Update user display
function updateUserDisplay(profile) {
    elements.userName.textContent = profile.username || profile.email || 'User';

    const userInfo = {
        'Username': profile.username || 'N/A',
        'Email': profile.email || 'N/A',
        'First Name': profile.firstName || 'N/A',
        'Last Name': profile.lastName || 'N/A',
        'Email Verified': profile.emailVerified ? 'Yes' : 'No'
    };

    elements.userDetails.innerHTML = Object.entries(userInfo)
        .map(([key, value]) => `<dt>${key}:</dt><dd>${value}</dd>`)
        .join('');
}

// Update token display
function updateTokenDisplay() {
    if (!keycloak.token) return;

    const tokenInfo = {
        'Access Token': keycloak.token ? `${keycloak.token.substring(0, 20)}...` : 'N/A',
        'Token Type': 'Bearer',
        'Expires In': keycloak.tokenParsed ? getTimeRemaining(keycloak.tokenParsed.exp) : 'N/A',
        'Refresh Token': keycloak.refreshToken ? `${keycloak.refreshToken.substring(0, 20)}...` : 'N/A',
        'Refresh Expires In': keycloak.refreshTokenParsed ? getTimeRemaining(keycloak.refreshTokenParsed.exp) : 'N/A'
    };

    elements.tokenDetails.innerHTML = Object.entries(tokenInfo)
        .map(([key, value]) => `<dt>${key}:</dt><dd>${value}</dd>`)
        .join('');
}

// Update session display
function updateSessionDisplay() {
    const sessionInfo = {
        'Session State': keycloak.sessionId || 'N/A',
        'Auth Server URL': keycloak.authServerUrl || 'N/A',
        'Realm': keycloak.realm || 'N/A',
        'Client ID': keycloak.clientId || 'N/A',
        'Flow': appConfig.initOptions.flow || 'standard'
    };

    elements.sessionDetails.innerHTML = Object.entries(sessionInfo)
        .map(([key, value]) => `<dt>${key}:</dt><dd>${value}</dd>`)
        .join('');
}

// Update debug info
function updateDebugInfo() {
    const debugInfo = {
        authenticated: keycloak.authenticated,
        token: keycloak.token,
        tokenParsed: keycloak.tokenParsed,
        refreshToken: keycloak.refreshToken,
        refreshTokenParsed: keycloak.refreshTokenParsed,
        idToken: keycloak.idToken,
        idTokenParsed: keycloak.idTokenParsed,
        realmAccess: keycloak.realmAccess,
        resourceAccess: keycloak.resourceAccess,
        timeSkew: keycloak.timeSkew
    };

    elements.debugOutput.textContent = JSON.stringify(debugInfo, null, 2);
}

// Get time remaining from timestamp
function getTimeRemaining(exp) {
    const now = Math.floor(Date.now() / 1000);
    const remaining = exp - now;

    if (remaining <= 0) return 'Expired';

    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;

    return `${minutes}m ${seconds}s`;
}

// Start token update timer
function startTokenUpdateTimer() {
    if (tokenUpdateTimer) clearInterval(tokenUpdateTimer);

    tokenUpdateTimer = setInterval(() => {
        if (keycloak.authenticated) {
            updateTokenDisplay();
        }
    }, appConfig.tokenUpdateInterval);
}

// Stop token update timer
function stopTokenUpdateTimer() {
    if (tokenUpdateTimer) {
        clearInterval(tokenUpdateTimer);
        tokenUpdateTimer = null;
    }
}

// Event Listeners
elements.loginBtn.addEventListener('click', () => {
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
});

elements.logoutBtn.addEventListener('click', () => {
    console.log('Logging out and redirecting to Keycloak...');
    stopTokenUpdateTimer();
    keycloak.logout({
        redirectUri: window.location.origin + window.location.pathname
    });
});

elements.refreshBtn.addEventListener('click', async () => {
    try {
        const refreshed = await keycloak.updateToken(-1); // Force refresh
        if (refreshed) {
            console.log('Token refreshed successfully');
            updateTokenDisplay();
            updateDebugInfo();
            // Show success feedback
            elements.refreshBtn.textContent = 'Token Refreshed!';
            elements.refreshBtn.classList.add('btn-success');
            setTimeout(() => {
                elements.refreshBtn.innerHTML = `
                    <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="23 4 23 10 17 10"></polyline>
                        <polyline points="1 20 1 14 7 14"></polyline>
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                    </svg>
                    Refresh Token`;
                elements.refreshBtn.classList.remove('btn-success');
            }, 2000);
        }
    } catch (error) {
        console.error('Failed to refresh token', error);
        showError('Failed to refresh token. Please login again.');
    }
});

elements.retryBtn.addEventListener('click', () => {
    window.location.reload();
});

elements.exchangeBtn.addEventListener('click', async () => {
    console.log('Initiating token exchange...');
    elements.exchangeResult.classList.remove('hidden');
    elements.exchangeStatus.textContent = 'Exchanging token...';
    elements.exchangeStatus.className = 'status-pending';

    try {
        const exchangedData = await performTokenExchange();
        displayExchangeResult(exchangedData);
    } catch (error) {
        console.error('Token exchange failed:', error);
        elements.exchangeStatus.textContent = `Token exchange failed: ${error.message}`;
        elements.exchangeStatus.className = 'status-error';
        elements.exchangeDetails.innerHTML = '';
        elements.exchangedToken.textContent = '';
    }
});

elements.toggleDebug.addEventListener('click', () => {
    const isHidden = elements.debugContent.classList.toggle('hidden');
    elements.toggleDebug.textContent = isHidden ? 'Show Debug Info' : 'Hide Debug Info';
});

// Token Exchange Function
async function performTokenExchange() {
    if (!keycloak.token) {
        throw new Error('No access token available');
    }

    const tokenEndpoint = `${keycloakConfig.url}/realms/${keycloakConfig.realm}/protocol/openid-connect/token`;

    // Prepare the token exchange request
    const params = new URLSearchParams({
        grant_type: tokenExchangeConfig.grant_type,
        client_id: tokenExchangeConfig.client_id,
        client_secret: tokenExchangeConfig.client_secret,
        subject_token: keycloak.token,
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        requested_token_type: tokenExchangeConfig.requested_token_type,
        audience: tokenExchangeConfig.audience
    });

    // Only add scope if it's defined
    if (tokenExchangeConfig.scope) {
        params.append('scope', tokenExchangeConfig.scope);
    }

    console.log('Token exchange endpoint:', tokenEndpoint);
    console.log('Exchange parameters:', {
        grant_type: tokenExchangeConfig.grant_type,
        client_id: tokenExchangeConfig.client_id,
        audience: tokenExchangeConfig.audience,
        scope: tokenExchangeConfig.scope,
        subject_token: keycloak.token.substring(0, 50) + '...'
    });

    const response = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params
    });

    if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        try {
            const errorData = JSON.parse(errorText);
            errorMessage = errorData.error_description || errorData.error || errorMessage;
        } catch (e) {
            errorMessage += ` - ${errorText}`;
        }
        throw new Error(errorMessage);
    }

    const data = await response.json();
    console.log('Token exchange successful:', data);
    return data;
}

// Display Token Exchange Result
function displayExchangeResult(data) {
    elements.exchangeStatus.textContent = 'Token exchange successful!';
    elements.exchangeStatus.className = 'status-success';

    // Parse the exchanged token
    let tokenParsed = null;
    try {
        const tokenParts = data.access_token.split('.');
        if (tokenParts.length === 3) {
            tokenParsed = JSON.parse(atob(tokenParts[1]));
        }
    } catch (e) {
        console.error('Failed to parse exchanged token:', e);
    }

    // Display exchange details
    const exchangeInfo = {
        'Token Type': data.token_type || 'Bearer',
        'Expires In': data.expires_in ? `${data.expires_in} seconds` : 'N/A',
        'Scope': data.scope || 'N/A',
        'Client ID': tokenExchangeConfig.client_id,
        'Audience': tokenParsed?.aud || tokenExchangeConfig.audience
    };

    if (tokenParsed) {
        exchangeInfo['Subject'] = tokenParsed.sub || 'N/A';
        exchangeInfo['Issuer'] = tokenParsed.iss || 'N/A';
        exchangeInfo['Issued At'] = tokenParsed.iat ? new Date(tokenParsed.iat * 1000).toLocaleString() : 'N/A';
        exchangeInfo['Expiration'] = tokenParsed.exp ? new Date(tokenParsed.exp * 1000).toLocaleString() : 'N/A';
    }

    elements.exchangeDetails.innerHTML = Object.entries(exchangeInfo)
        .map(([key, value]) => `<dt>${key}:</dt><dd>${value}</dd>`)
        .join('');

    // Display the token (truncated for display)
    elements.exchangedToken.textContent = JSON.stringify({
        access_token: data.access_token.substring(0, 100) + '...',
        token_type: data.token_type,
        expires_in: data.expires_in,
        scope: data.scope,
        decoded_payload: tokenParsed
    }, null, 2);
}

// Handle authentication errors
window.addEventListener('unload', () => {
    stopTokenUpdateTimer();
});

// Initialize on page load
document.addEventListener('DOMContentLoaded', init);