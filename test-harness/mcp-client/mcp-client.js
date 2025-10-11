/**
 * MCP Client Module
 *
 * Handles interaction with the MCP server:
 * - Session initialization
 * - Tool discovery (list tools)
 * - Tool invocation with authentication
 * - Response handling
 */

class MCPClient {
    constructor() {
        this.sessionId = null;
        this.initialized = false;
        this.availableTools = [];
        this.selectedTool = null;
        this.requestId = 1;
    }

    /**
     * Generate next request ID
     * @returns {number} Request ID
     */
    getNextRequestId() {
        return this.requestId++;
    }

    /**
     * Parse SSE (Server-Sent Events) response
     * @param {string} text - SSE formatted text
     * @returns {object} Parsed JSON-RPC response
     */
    parseSSE(text) {
        const lines = text.split('\n');
        let eventType = null;
        let data = '';

        for (const line of lines) {
            if (line.startsWith('event:')) {
                eventType = line.substring(6).trim();
            } else if (line.startsWith('data:')) {
                data += line.substring(5).trim();
            }
        }

        if (data) {
            return JSON.parse(data);
        }

        throw new Error('No data found in SSE response');
    }

    /**
     * Initialize MCP session
     * @returns {Promise<object>} Initialization response
     */
    async initialize() {
        if (!authManager.isAuthenticated()) {
            throw new Error('Authentication required. Please login first.');
        }

        log('info', 'Initializing MCP session...');

        const token = authManager.getActiveToken();
        const requestId = this.getNextRequestId();

        const payload = {
            jsonrpc: '2.0',
            method: 'initialize',
            params: {
                protocolVersion: CONFIG.mcp.protocolVersion,
                capabilities: {},
                clientInfo: CONFIG.mcp.clientInfo
            },
            id: requestId
        };

        log('info', `Sending initialize request (id: ${requestId})`);

        const response = await fetch(`${CONFIG.mcp.baseUrl}${CONFIG.mcp.endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });

        // Check for error status codes
        if (!response.ok) {
            const errorText = await response.text();
            log('error', `MCP initialization failed (HTTP ${response.status}): ${errorText}`);
            throw new Error(`MCP initialization failed: HTTP ${response.status} - ${errorText}`);
        }

        // Extract session ID from response headers
        this.sessionId = response.headers.get('Mcp-Session-Id');

        // Check content type to determine how to parse
        const contentType = response.headers.get('Content-Type');
        let data;

        if (contentType && contentType.includes('text/event-stream')) {
            log('info', 'Parsing SSE response...');
            const text = await response.text();
            data = this.parseSSE(text);
        } else {
            log('info', 'Parsing JSON response...');
            data = await response.json();
        }

        if (data.error) {
            log('error', `MCP initialization error: ${data.error.message}`);
            throw new Error(data.error.message);
        }

        this.initialized = true;

        log('success', `MCP session initialized. Session ID: ${this.sessionId || 'none'}`);
        log('success', `Server: ${data.result?.serverInfo?.name || 'unknown'} v${data.result?.serverInfo?.version || 'unknown'}`);

        return data;
    }

    /**
     * List available tools
     * @returns {Promise<object>} Tools list response
     */
    async listTools() {
        if (!this.initialized) {
            throw new Error('MCP session not initialized. Please initialize first.');
        }

        log('info', 'Listing available tools...');

        const token = authManager.getActiveToken();
        const requestId = this.getNextRequestId();

        const payload = {
            jsonrpc: '2.0',
            method: 'tools/list',
            params: {},
            id: requestId
        };

        log('info', `Sending tools/list request (id: ${requestId})`);

        const response = await fetch(`${CONFIG.mcp.baseUrl}${CONFIG.mcp.endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream',
                'Authorization': `Bearer ${token}`,
                ...(this.sessionId && { 'Mcp-Session-Id': this.sessionId })
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            log('error', `List tools failed (HTTP ${response.status}): ${errorText}`);
            throw new Error(`List tools failed: HTTP ${response.status} - ${errorText}`);
        }

        // Check content type to determine how to parse
        const contentType = response.headers.get('Content-Type');
        let data;

        if (contentType && contentType.includes('text/event-stream')) {
            const text = await response.text();
            data = this.parseSSE(text);
        } else {
            data = await response.json();
        }

        if (data.error) {
            log('error', `List tools error: ${data.error.message}`);
            throw new Error(data.error.message);
        }

        this.availableTools = data.result?.tools || [];
        log('success', `Found ${this.availableTools.length} tools`);

        return data;
    }

    /**
     * Call a tool
     * @param {string} toolName - Tool name
     * @param {object} params - Tool parameters
     * @returns {Promise<object>} Tool response
     */
    async callTool(toolName, params = {}) {
        if (!this.initialized) {
            throw new Error('MCP session not initialized. Please initialize first.');
        }

        log('info', `Calling tool: ${toolName}`);
        if (Object.keys(params).length > 0) {
            log('info', `Parameters: ${JSON.stringify(params)}`);
        }

        const token = authManager.getActiveToken();
        const requestId = this.getNextRequestId();

        const payload = {
            jsonrpc: '2.0',
            method: 'tools/call',
            params: {
                name: toolName,
                arguments: params
            },
            id: requestId
        };

        log('info', `Sending tools/call request (id: ${requestId})`);

        const response = await fetch(`${CONFIG.mcp.baseUrl}${CONFIG.mcp.endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream',
                'Authorization': `Bearer ${token}`,
                ...(this.sessionId && { 'Mcp-Session-Id': this.sessionId })
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            log('error', `Tool call failed (HTTP ${response.status}): ${errorText}`);
            throw new Error(`Tool call failed: HTTP ${response.status} - ${errorText}`);
        }

        // Check content type to determine how to parse
        const contentType = response.headers.get('Content-Type');
        let data;

        if (contentType && contentType.includes('text/event-stream')) {
            const text = await response.text();
            data = this.parseSSE(text);
        } else {
            data = await response.json();
        }

        if (data.error) {
            log('error', `Tool call error: ${data.error.message}`);
            throw new Error(data.error.message);
        }

        log('success', `Tool call successful: ${toolName}`);

        return data;
    }

    /**
     * Reset session
     */
    reset() {
        log('info', 'Resetting MCP session...');
        this.sessionId = null;
        this.initialized = false;
        this.availableTools = [];
        this.selectedTool = null;
        this.requestId = 1;
        log('success', 'MCP session reset');
    }
}

// Global MCP client instance
const mcpClient = new MCPClient();

console.log('✓ MCP client module loaded');
