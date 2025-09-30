// MCP SSE Client for httpStream transport
// Handles Server-Sent Events communication with FastMCP httpStream

class MCPClient {
    constructor(url, endpoint) {
        this.url = url;
        this.endpoint = endpoint;
        this.token = null;
        this.sessionId = null;
        this.requestId = 0;
        this.pendingRequests = new Map();
        this.reader = null;
        this.abortController = null;
    }

    async connect(bearerToken) {
        this.token = bearerToken;

        console.log('[MCP CLIENT] Connecting to', `${this.url}${this.endpoint}`);

        // Send initialize request
        const initResult = await this.sendRequest('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {
                roots: { listChanged: true },
                sampling: {}
            },
            clientInfo: {
                name: 'MCP OAuth Test Console',
                version: '1.0.0'
            }
        });

        console.log('[MCP CLIENT] Initialize result:', initResult);

        if (initResult.error) {
            throw new Error(`MCP initialization failed: ${initResult.error.message}`);
        }

        // Note: Session ID is captured from response header in sendRequest(), not from response body
        console.log('[MCP CLIENT] Connected with session:', this.sessionId);

        return initResult.result;
    }

    async sendRequest(method, params) {
        const id = ++this.requestId;
        const request = {
            jsonrpc: '2.0',
            id,
            method,
            params
        };

        console.log('[MCP CLIENT] Sending request:', request);

        // Create abort controller for this request
        this.abortController = new AbortController();

        try {
            const headers = {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream',
                'Authorization': `Bearer ${this.token}`
            };

            // Add session ID only if we have one (don't send on first request)
            if (this.sessionId) {
                headers['Mcp-Session-Id'] = this.sessionId;
                console.log('[MCP CLIENT] Using session ID:', this.sessionId);
            } else {
                console.log('[MCP CLIENT] No session ID yet - first request (initialize)');
                // Don't send Mcp-Session-Id header on first request - let server create session
            }

            console.log('[MCP CLIENT] Request headers:', headers);

            const response = await fetch(`${this.url}${this.endpoint}`, {
                method: 'POST',
                headers,
                body: JSON.stringify(request),
                signal: this.abortController.signal
            });

            console.log('[MCP CLIENT] Response status:', response.status);
            console.log('[MCP CLIENT] Response Content-Type:', response.headers.get('content-type'));

            // Debug: Log all response headers
            console.log('[MCP CLIENT] All response headers:');
            for (const [key, value] of response.headers.entries()) {
                console.log(`  ${key}: ${value}`);
            }

            // Capture session ID from response headers (if present)
            // Note: Use lowercase because HTTP/2 normalizes headers to lowercase
            const sessionIdFromHeader = response.headers.get('mcp-session-id');
            console.log('[MCP CLIENT] Session ID from header:', sessionIdFromHeader);
            if (sessionIdFromHeader && !this.sessionId) {
                console.log('[MCP CLIENT] Captured session ID from header:', sessionIdFromHeader);
                this.sessionId = sessionIdFromHeader;
            } else if (!sessionIdFromHeader) {
                console.log('[MCP CLIENT] WARNING: No mcp-session-id header in response!');
            }

            const contentType = response.headers.get('content-type');

            // Handle SSE response
            if (contentType?.includes('text/event-stream')) {
                return await this.handleSSEResponse(response, id);
            }

            // Handle JSON response
            if (contentType?.includes('application/json')) {
                const data = await response.json();
                console.log('[MCP CLIENT] JSON response:', data);
                return data;
            }

            // Fallback: try to parse as text
            const text = await response.text();
            console.log('[MCP CLIENT] Text response:', text.substring(0, 200));

            // Try to parse SSE manually
            return this.parseSSEMessage(text);

        } catch (error) {
            console.error('[MCP CLIENT] Request error:', error);
            throw error;
        }
    }

    async handleSSEResponse(response, requestId) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                const { done, value } = await reader.read();

                if (done) {
                    console.log('[MCP CLIENT] Stream complete');
                    break;
                }

                buffer += decoder.decode(value, { stream: true });

                // Process complete SSE messages
                const lines = buffer.split('\n');
                buffer = lines.pop(); // Keep incomplete line in buffer

                let event = {};
                for (const line of lines) {
                    if (line.startsWith('event:')) {
                        event.type = line.substring(6).trim();
                    } else if (line.startsWith('data:')) {
                        const data = line.substring(5).trim();
                        if (data) {
                            try {
                                event.data = JSON.parse(data);
                            } catch (e) {
                                event.data = data;
                            }
                        }
                    } else if (line === '') {
                        // End of message
                        if (event.data) {
                            console.log('[MCP CLIENT] SSE message:', event);

                            // Check if this is the response to our request
                            if (event.data.id === requestId || event.type === 'message') {
                                reader.cancel();
                                return event.data;
                            }
                        }
                        event = {};
                    }
                }
            }
        } catch (error) {
            console.error('[MCP CLIENT] Stream reading error:', error);
            throw error;
        } finally {
            reader.releaseLock();
        }

        throw new Error('No response received from SSE stream');
    }

    parseSSEMessage(text) {
        // Parse SSE format manually
        const lines = text.split('\n');
        let data = null;

        for (const line of lines) {
            if (line.startsWith('data:')) {
                const jsonStr = line.substring(5).trim();
                try {
                    data = JSON.parse(jsonStr);
                    break;
                } catch (e) {
                    console.error('[MCP CLIENT] Failed to parse SSE data:', jsonStr);
                }
            }
        }

        return data;
    }

    async callTool(toolName, args) {
        return await this.sendRequest('tools/call', {
            name: toolName,
            arguments: args
        });
    }

    disconnect() {
        if (this.abortController) {
            this.abortController.abort();
        }
        console.log('[MCP CLIENT] Disconnected');
    }
}

// Export for use in app.js
window.MCPClient = MCPClient;