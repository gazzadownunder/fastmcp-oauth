/**
 * Main Application Module
 *
 * Orchestrates the UI interactions and ties together:
 * - Authentication flows
 * - MCP client operations
 * - UI updates and logging
 */

// ============================================================================
// LOGGING UTILITIES
// ============================================================================

/**
 * Log a message to the console
 * @param {string} level - Log level (info, success, error, warning)
 * @param {string} message - Log message
 */
function log(level, message) {
    const logConsole = document.getElementById('log-console');
    const timestamp = new Date().toLocaleTimeString();

    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML = `<span class="log-timestamp">[${timestamp}]</span><span class="log-${level}">${message}</span>`;

    logConsole.appendChild(entry);

    // Auto-scroll to bottom if enabled
    if (CONFIG.ui.autoScrollLog) {
        logConsole.scrollTop = logConsole.scrollHeight;
    }

    // Trim old entries
    const entries = logConsole.querySelectorAll('.log-entry');
    if (entries.length > CONFIG.ui.maxLogEntries) {
        entries[0].remove();
    }

    // Also log to browser console
    const consoleMethod = level === 'error' ? 'error' : level === 'warning' ? 'warn' : 'log';
    console[consoleMethod](`[${level.toUpperCase()}] ${message}`);
}

/**
 * Clear the log console
 */
function clearLog() {
    const logConsole = document.getElementById('log-console');
    logConsole.innerHTML = '';
    log('info', 'Log cleared');
}

// ============================================================================
// UI UPDATE UTILITIES
// ============================================================================

/**
 * Update authentication status UI
 */
function updateAuthUI() {
    const authStatus = document.getElementById('auth-status');
    const loginPasswordBtn = document.getElementById('login-password-btn');
    const loginSsoBtn = document.getElementById('login-sso-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const userInfo = document.getElementById('user-info');
    const initMcpBtn = document.getElementById('init-mcp-btn');

    if (authManager.isAuthenticated()) {
        authStatus.textContent = 'Authenticated';
        authStatus.className = 'status connected';

        loginPasswordBtn.style.display = 'none';
        loginSsoBtn.style.display = 'none';
        logoutBtn.style.display = 'block';
        userInfo.style.display = 'block';

        initMcpBtn.disabled = false;

        // Update user information
        const user = authManager.getUserInfo();
        document.getElementById('user-sub').textContent = user.sub;
        document.getElementById('user-email').textContent = user.email;
        document.getElementById('subject-token').textContent = authManager.accessToken.substring(0, 100) + '...';

        // Update claims
        document.getElementById('subject-claims').innerHTML = `<pre>${JSON.stringify(authManager.claims, null, 2)}</pre>`;
    } else {
        authStatus.textContent = 'Not Authenticated';
        authStatus.className = 'status disconnected';

        loginPasswordBtn.style.display = 'inline-block';
        loginSsoBtn.style.display = 'inline-block';
        logoutBtn.style.display = 'none';
        userInfo.style.display = 'none';

        initMcpBtn.disabled = true;

        document.getElementById('subject-claims').textContent = 'Authenticate first...';
    }
}

/**
 * Update MCP status UI
 */
function updateMCPUI() {
    const mcpStatus = document.getElementById('mcp-status');
    const listToolsBtn = document.getElementById('list-tools-btn');
    const toolsContainer = document.getElementById('tools-container');

    if (mcpClient.initialized) {
        mcpStatus.textContent = 'Connected';
        mcpStatus.className = 'status connected';
        listToolsBtn.disabled = false;

        if (mcpClient.availableTools.length > 0) {
            toolsContainer.style.display = 'block';
            populateToolList();
        }
    } else {
        mcpStatus.textContent = 'Not Connected';
        mcpStatus.className = 'status disconnected';
        listToolsBtn.disabled = true;
        toolsContainer.style.display = 'none';
    }
}

/**
 * Populate the tool list from available tools
 */
function populateToolList() {
    const toolList = document.getElementById('tool-list');
    toolList.innerHTML = '';

    mcpClient.availableTools.forEach(tool => {
        const btn = document.createElement('button');
        btn.className = 'tool-btn';
        btn.textContent = tool.name;
        btn.onclick = () => selectTool(tool);
        toolList.appendChild(btn);
    });

    log('success', `Displaying ${mcpClient.availableTools.length} tools`);
}

/**
 * Select a tool and build its input form
 * @param {object} tool - Tool metadata
 */
function selectTool(tool) {
    // Store selected tool
    mcpClient.selectedTool = tool;

    // Update active button styling
    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.textContent === tool.name) {
            btn.classList.add('active');
        }
    });

    // Show form container, hide placeholder
    document.getElementById('tool-form-container').style.display = 'block';
    document.getElementById('no-tool-selected').style.display = 'none';

    // Update tool info
    document.getElementById('selected-tool-name').textContent = tool.name;
    document.getElementById('selected-tool-description').textContent = tool.description || 'No description available';

    // Build parameter form
    buildParameterForm(tool);

    log('info', `Selected tool: ${tool.name}`);
}

/**
 * Build parameter input form from tool schema
 * @param {object} tool - Tool metadata with inputSchema
 */
function buildParameterForm(tool) {
    const container = document.getElementById('tool-parameters');
    container.innerHTML = '';

    if (!tool.inputSchema || !tool.inputSchema.properties) {
        container.innerHTML = '<p style="color: #999; font-size: 12px;">This tool has no parameters</p>';
        return;
    }

    const properties = tool.inputSchema.properties;
    const required = tool.inputSchema.required || [];

    for (const [paramName, paramSchema] of Object.entries(properties)) {
        const paramGroup = document.createElement('div');
        paramGroup.className = 'param-group';

        // Label
        const label = document.createElement('label');
        label.className = 'param-label';
        label.textContent = paramName;
        if (required.includes(paramName)) {
            label.textContent += ' *';
        }

        // Type badge
        const typeBadge = document.createElement('span');
        typeBadge.className = 'param-type';
        typeBadge.textContent = paramSchema.type || 'any';
        label.appendChild(typeBadge);

        paramGroup.appendChild(label);

        // Description
        if (paramSchema.description) {
            const desc = document.createElement('span');
            desc.className = 'param-description';
            desc.textContent = paramSchema.description;
            paramGroup.appendChild(desc);
        }

        // Input field
        const input = createInputField(paramName, paramSchema, required.includes(paramName));
        paramGroup.appendChild(input);

        container.appendChild(paramGroup);
    }
}

/**
 * Create appropriate input field based on parameter schema
 * @param {string} name - Parameter name
 * @param {object} schema - Parameter schema
 * @param {boolean} required - Whether parameter is required
 * @returns {HTMLElement} Input element
 */
function createInputField(name, schema, required) {
    const type = schema.type;

    if (type === 'string' && schema.enum) {
        // Dropdown for enums
        const select = document.createElement('select');
        select.name = name;
        select.required = required;
        select.style.cssText = 'width: 100%; padding: 8px; border: 1px solid #dee2e6; border-radius: 4px; margin-bottom: 10px;';

        schema.enum.forEach(value => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = value;
            select.appendChild(option);
        });

        return select;
    } else if (type === 'array') {
        // Textarea for arrays (JSON format)
        const textarea = document.createElement('textarea');
        textarea.name = name;
        textarea.required = required;
        textarea.placeholder = '[] or ["value1", "value2"]';
        textarea.value = '[]';
        return textarea;
    } else if (type === 'object') {
        // Textarea for objects (JSON format)
        const textarea = document.createElement('textarea');
        textarea.name = name;
        textarea.required = required;
        textarea.placeholder = '{}';
        textarea.value = '{}';
        return textarea;
    } else if (type === 'number' || type === 'integer') {
        // Number input
        const input = document.createElement('input');
        input.type = 'number';
        input.name = name;
        input.required = required;
        if (schema.default !== undefined) {
            input.value = schema.default;
        }
        return input;
    } else if (type === 'boolean') {
        // Checkbox
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.name = name;
        input.style.cssText = 'width: auto; margin-right: 8px;';
        if (schema.default !== undefined) {
            input.checked = schema.default;
        }
        return input;
    } else {
        // Default text input
        const input = document.createElement('input');
        input.type = 'text';
        input.name = name;
        input.required = required;
        if (schema.default !== undefined) {
            input.value = schema.default;
        }
        return input;
    }
}

/**
 * Display MCP response
 * @param {object} response - MCP response data
 */
function displayMCPResponse(response) {
    const responseDiv = document.getElementById('mcp-response');
    responseDiv.style.display = 'block';

    // Pretty print the response
    let formattedResponse = JSON.stringify(response, null, 2);

    // Try to parse nested JSON strings
    if (response.result && response.result.content) {
        for (const content of response.result.content) {
            if (content.type === 'text' && content.text) {
                try {
                    const parsed = JSON.parse(content.text);
                    formattedResponse = JSON.stringify({ ...response, parsedContent: parsed }, null, 2);
                } catch (e) {
                    // Not JSON, use original
                }
            }
        }
    }

    responseDiv.textContent = formattedResponse;
}

// ============================================================================
// AUTHENTICATION FLOWS
// ============================================================================

/**
 * Login with password grant
 */
async function loginWithPassword() {
    try {
        await authManager.loginWithPassword();
        updateAuthUI();
        updateMCPUI();
        log('success', 'Authentication successful (Password Grant)');
    } catch (error) {
        log('error', `Login failed: ${error.message}`);
        alert(`Login failed: ${error.message}`);
    }
}

/**
 * Login with SSO redirect
 */
function loginWithSSO() {
    authManager.redirectToSSO();
}

/**
 * Toggle manual JWT import UI
 */
function toggleManualJWT() {
    const input = document.getElementById('manual-jwt-input');
    input.style.display = input.style.display === 'none' ? 'block' : 'none';
}

/**
 * Import manual JWT
 */
function importManualJWT() {
    const textarea = document.getElementById('jwt-textarea');
    const token = textarea.value.trim();

    if (!token) {
        alert('Please paste a JWT token');
        return;
    }

    try {
        authManager.setAccessToken(token);
        updateAuthUI();
        updateMCPUI();
        log('success', 'JWT imported successfully');
        textarea.value = '';
        toggleManualJWT();
    } catch (error) {
        log('error', `JWT import failed: ${error.message}`);
        alert(`Invalid JWT: ${error.message}`);
    }
}

/**
 * Logout
 */
function logout() {
    authManager.logout();
    mcpClient.reset();
    updateAuthUI();
    updateMCPUI();
    log('info', 'Logged out successfully');
}

// ============================================================================
// MCP OPERATIONS
// ============================================================================

/**
 * Initialize MCP session
 */
async function initializeMCP() {
    try {
        const response = await mcpClient.initialize();
        updateMCPUI();
        displayMCPResponse(response);
        log('success', 'MCP initialized with access token');
    } catch (error) {
        log('error', `MCP initialization failed: ${error.message}`);
        alert(`MCP initialization failed: ${error.message}`);
    }
}

/**
 * List available tools
 */
async function listTools() {
    try {
        const response = await mcpClient.listTools();
        updateMCPUI();
        displayMCPResponse(response);

        const toolNames = mcpClient.availableTools.map(t => t.name).join(', ');
        log('success', `Available tools: ${toolNames}`);
    } catch (error) {
        log('error', `List tools failed: ${error.message}`);
        alert(`List tools failed: ${error.message}`);
    }
}

/**
 * Execute the selected tool with user-provided parameters
 * @param {Event} event - Form submit event
 */
async function executeSelectedTool(event) {
    event.preventDefault();

    if (!mcpClient.selectedTool) {
        alert('No tool selected');
        return;
    }

    const form = document.getElementById('tool-input-form');
    const formData = new FormData(form);
    const params = {};

    // Build parameters object from form data
    for (const [key, value] of formData.entries()) {
        const input = form.elements[key];
        const schema = mcpClient.selectedTool.inputSchema?.properties[key];

        if (schema) {
            // Parse based on type
            if (schema.type === 'array' || schema.type === 'object') {
                try {
                    params[key] = JSON.parse(value);
                } catch (e) {
                    alert(`Invalid JSON for parameter "${key}": ${e.message}`);
                    return;
                }
            } else if (schema.type === 'number' || schema.type === 'integer') {
                params[key] = parseFloat(value);
            } else if (schema.type === 'boolean') {
                params[key] = input.checked;
            } else {
                params[key] = value;
            }
        } else {
            params[key] = value;
        }
    }

    try {
        log('info', `Executing tool: ${mcpClient.selectedTool.name}`);
        log('info', `Parameters: ${JSON.stringify(params)}`);

        const response = await mcpClient.callTool(mcpClient.selectedTool.name, params);
        displayMCPResponse(response);
        log('success', `Tool '${mcpClient.selectedTool.name}' executed successfully`);
    } catch (error) {
        log('error', `Tool '${mcpClient.selectedTool.name}' failed: ${error.message}`);
        alert(`Tool execution failed: ${error.message}`);
    }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize application on page load
 */
window.addEventListener('DOMContentLoaded', () => {
    log('info', 'MCP OAuth Integration Test Client initialized');
    log('info', `MCP Server: ${CONFIG.mcp.baseUrl}${CONFIG.mcp.endpoint}`);
    log('info', `OAuth Realm: ${CONFIG.oauth.realm}`);

    // Check for SSO callback (authorization code in URL)
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');

    if (code) {
        log('info', 'SSO callback detected, processing authorization code...');
        authManager.handleSSOCallback(code)
            .then(() => {
                updateAuthUI();
                updateMCPUI();
                log('success', 'SSO authentication successful');
            })
            .catch(error => {
                log('error', `SSO callback failed: ${error.message}`);
                alert(`SSO authentication failed: ${error.message}`);
            });
    }

    // Initialize UI state
    updateAuthUI();
    updateMCPUI();
});

console.log('✓ Application module loaded');
