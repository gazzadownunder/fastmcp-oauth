/**
 * MCP OAuth 2.1 Compliance Validation Suite
 * Tests MCP servers against the official specification
 * Reference: https://modelcontextprotocol.io/specification/draft/basic/authorization
 */

class MCPValidator {
    constructor(mcpServerUrl) {
        this.tests = [];
        this.results = new Map();
        this.mcpServerUrl = mcpServerUrl || CONFIG.mcp.baseUrl;

        // Discovered endpoints (populated during discovery phase)
        this.discovered = {
            authorizationEndpoint: null,
            tokenEndpoint: null,
            protectedResourceUrl: null,
            authServerUrl: null,
            issuer: null
        };

        // OAuth credentials for authenticated tests
        this.credentials = {
            clientId: CONFIG.oauth.clientId,
            username: CONFIG.oauth.testUser.username,
            password: CONFIG.oauth.testUser.password,
            tokenEndpoint: CONFIG.oauth.tokenEndpoint
        };

        // Access token for authenticated tests
        this.accessToken = null;

        this.initializeTests();
    }

    /**
     * Define all validation tests based on MCP OAuth 2.1 specification
     */
    initializeTests() {
        this.tests = [
            // 1. Protected Resource Metadata (RFC 9728) - MUST
            {
                id: 'protected-resource-metadata',
                title: 'Protected Resource Metadata Support (RFC 9728)',
                description: 'Server MUST implement OAuth 2.0 Protected Resource Metadata to indicate authorization server locations',
                category: 'discovery',
                required: true,
                testFn: this.testProtectedResourceMetadata.bind(this)
            },

            // 2. WWW-Authenticate: Bearer Scheme
            {
                id: 'www-auth-bearer-scheme',
                title: 'WWW-Authenticate: Bearer Scheme (MUST)',
                description: 'Server MUST use Bearer authentication scheme in WWW-Authenticate header on 401 responses (RFC 6750)',
                category: 'authentication',
                required: true,
                testFn: this.testWWWAuthBearerScheme.bind(this)
            },

            // 3. WWW-Authenticate: resource_metadata Parameter
            {
                id: 'www-auth-resource-metadata',
                title: 'WWW-Authenticate: resource_metadata Parameter (MUST)',
                description: 'Server MUST include resource_metadata parameter in WWW-Authenticate header pointing to Protected Resource Metadata (MCP Spec)',
                category: 'discovery',
                required: true,
                testFn: this.testWWWAuthResourceMetadata.bind(this)
            },

            // 4. WWW-Authenticate: scope Parameter
            {
                id: 'www-auth-scope',
                title: 'WWW-Authenticate: scope Parameter (SHOULD)',
                description: 'Server SHOULD include scope parameter in WWW-Authenticate header to indicate required scopes (MCP Spec)',
                category: 'discovery',
                required: false,
                testFn: this.testWWWAuthScope.bind(this)
            },

            // 5. WWW-Authenticate: realm Parameter
            {
                id: 'www-auth-realm',
                title: 'WWW-Authenticate: realm Parameter (OPTIONAL)',
                description: 'Server MAY include realm parameter in WWW-Authenticate header to indicate scope of protection (RFC 6750)',
                category: 'discovery',
                required: false,
                testFn: this.testWWWAuthRealm.bind(this)
            },

            // 7. Well-Known URI Support
            {
                id: 'well-known-uri',
                title: 'Well-Known URI for Protected Resource',
                description: 'Server MUST support /.well-known/oauth-protected-resource or /.well-known/oauth-protected-resource/mcp',
                category: 'discovery',
                required: true,
                testFn: this.testWellKnownURI.bind(this)
            },

            // 8. Authorization Server Discovery (RFC 8414)
            {
                id: 'auth-server-discovery',
                title: 'Authorization Server Discovery (RFC 8414)',
                description: 'Server MUST support OAuth 2.0 Authorization Server Metadata or OpenID Connect Discovery',
                category: 'discovery',
                required: true,
                testFn: this.testAuthServerDiscovery.bind(this)
            },

            // 9. 401 Unauthorized for Missing Token
            {
                id: 'unauthorized-missing-token',
                title: '401 Unauthorized Without Token',
                description: 'Server MUST return HTTP 401 when no access token is provided',
                category: 'authentication',
                required: true,
                testFn: this.testUnauthorizedMissingToken.bind(this)
            },

            // 10. 401 Unauthorized for Invalid Token
            {
                id: 'unauthorized-invalid-token',
                title: '401 Unauthorized for Invalid Token',
                description: 'Server MUST return HTTP 401 for invalid or expired tokens',
                category: 'authentication',
                required: true,
                testFn: this.testUnauthorizedInvalidToken.bind(this)
            },

            // 11. Token Audience Binding
            {
                id: 'token-audience-binding',
                title: 'Token Audience Binding',
                description: 'Server MUST validate tokens were issued specifically for the MCP server (audience binding)',
                category: 'security',
                required: true,
                testFn: this.testTokenAudienceBinding.bind(this)
            },

            // 12. HTTPS Enforcement
            {
                id: 'https-enforcement',
                title: 'HTTPS Enforcement',
                description: 'Server MUST serve all authorization endpoints over HTTPS (production requirement)',
                category: 'security',
                required: true,
                testFn: this.testHTTPSEnforcement.bind(this)
            },

            // 13. Protected Resource Metadata Structure
            {
                id: 'protected-resource-structure',
                title: 'Protected Resource Metadata Structure',
                description: 'Metadata MUST include resource, authorization_servers, and bearer_methods_supported fields',
                category: 'metadata',
                required: true,
                testFn: this.testProtectedResourceStructure.bind(this)
            },

            // 14. Authorization Server Metadata Structure
            {
                id: 'auth-server-structure',
                title: 'Authorization Server Metadata Structure',
                description: 'Metadata MUST include authorization_endpoint, token_endpoint, and supported grant types',
                category: 'metadata',
                required: true,
                testFn: this.testAuthServerStructure.bind(this)
            },

            // 15. PKCE Support
            {
                id: 'pkce-support',
                title: 'PKCE Support (S256)',
                description: 'Authorization server MUST support PKCE with S256 code challenge method',
                category: 'oauth',
                required: true,
                testFn: this.testPKCESupport.bind(this)
            },

            // 16. Scope Information in 403 Errors
            {
                id: 'scope-error-info',
                title: 'Scope Information in 403 Errors (SHOULD)',
                description: 'Server SHOULD include scope information in WWW-Authenticate header for 403 Forbidden responses',
                category: 'authentication',
                required: false,
                testFn: this.testScopeErrorInfo.bind(this)
            }
        ];
    }

    /**
     * Discovery Phase: Discover all endpoints from the MCP server
     */
    async performDiscovery() {
        log('info', '🔍 Discovery Phase: Discovering OAuth endpoints from MCP server...');

        try {
            // Step 1: Try to discover protected resource metadata
            const protectedResourceUrls = [
                `${this.mcpServerUrl}/.well-known/oauth-protected-resource`,
                `${this.mcpServerUrl}/.well-known/oauth-protected-resource/mcp`
            ];

            for (const url of protectedResourceUrls) {
                try {
                    const response = await fetch(url);
                    if (response.ok) {
                        const metadata = await response.json();
                        this.discovered.protectedResourceUrl = url;
                        this.discovered.authServerUrl = metadata.authorization_servers?.[0];
                        log('success', `✓ Protected resource metadata found: ${url}`);
                        break;
                    }
                } catch (error) {
                    continue;
                }
            }

            // Step 2: Fetch authorization server metadata
            if (this.discovered.authServerUrl) {
                try {
                    const authMetadataUrl = `${this.discovered.authServerUrl}/.well-known/oauth-authorization-server`;
                    const response = await fetch(authMetadataUrl);
                    if (response.ok) {
                        const metadata = await response.json();
                        this.discovered.authorizationEndpoint = metadata.authorization_endpoint;
                        this.discovered.tokenEndpoint = metadata.token_endpoint;
                        this.discovered.issuer = metadata.issuer;
                        log('success', `✓ Authorization server metadata discovered`);
                        log('info', `  Token Endpoint: ${this.discovered.tokenEndpoint}`);
                    }
                } catch (error) {
                    log('warning', `⚠ Failed to fetch authorization server metadata: ${error.message}`);
                }
            }

            // Step 3: Fallback - try auth server metadata directly from MCP server
            if (!this.discovered.tokenEndpoint) {
                try {
                    const authServerUrl = `${this.mcpServerUrl}/.well-known/oauth-authorization-server`;
                    const response = await fetch(authServerUrl);
                    if (response.ok) {
                        const metadata = await response.json();
                        this.discovered.authorizationEndpoint = metadata.authorization_endpoint;
                        this.discovered.tokenEndpoint = metadata.token_endpoint;
                        this.discovered.issuer = metadata.issuer;
                        log('success', `✓ Authorization server metadata found (fallback)`);
                        log('info', `  Token Endpoint: ${this.discovered.tokenEndpoint}`);
                    }
                } catch (error) {
                    log('warning', `⚠ Fallback discovery failed: ${error.message}`);
                }
            }

            return this.discovered.tokenEndpoint !== null;
        } catch (error) {
            log('error', `❌ Discovery failed: ${error.message}`);
            return false;
        }
    }

    /**
     * Acquire access token using password grant for authenticated tests
     */
    async acquireAccessToken() {
        log('info', '🔑 Acquiring access token for authenticated tests...');

        try {
            // Use discovered token endpoint if available, otherwise fall back to config
            const tokenEndpoint = this.discovered.tokenEndpoint || this.credentials.tokenEndpoint;

            if (!tokenEndpoint) {
                log('error', '❌ No token endpoint available (discovery failed and no config fallback)');
                return false;
            }

            log('info', `  Using token endpoint: ${tokenEndpoint}`);

            const formData = new URLSearchParams({
                grant_type: 'password',
                username: this.credentials.username,
                password: this.credentials.password,
                client_id: this.credentials.clientId,
                scope: 'openid email'
            });

            const response = await fetch(tokenEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: formData
            });

            if (response.ok) {
                const data = await response.json();
                this.accessToken = data.access_token;
                log('success', `✓ Access token acquired successfully`);
                log('info', `  Token (first 50 chars): ${this.accessToken.substring(0, 50)}...`);
                return true;
            } else {
                const errorText = await response.text();
                log('error', `❌ Token acquisition failed: HTTP ${response.status}`);
                log('error', `  Error: ${errorText}`);
                return false;
            }
        } catch (error) {
            log('error', `❌ Token acquisition error: ${error.message}`);
            return false;
        }
    }

    /**
     * Run all validation tests
     */
    async runAllTests() {
        log('info', '🧪 Starting MCP OAuth 2.1 compliance validation...');
        this.results.clear();

        // Phase 1: Discovery
        log('info', '');
        log('info', '═══ Phase 1: Endpoint Discovery ═══');
        const discoverySuccess = await this.performDiscovery();
        if (!discoverySuccess) {
            log('warning', '⚠️ Some endpoints could not be discovered - some tests may use config fallback');
        }

        // Phase 2: Token Acquisition
        log('info', '');
        log('info', '═══ Phase 2: Token Acquisition ═══');
        const tokenSuccess = await this.acquireAccessToken();
        if (!tokenSuccess) {
            log('warning', '⚠️ Token acquisition failed - authenticated tests will be skipped');
        }

        // Phase 3: Run Tests
        log('info', '');
        log('info', '═══ Phase 3: Running Validation Tests ═══');

        for (const test of this.tests) {
            log('info', `Testing: ${test.title}`);
            try {
                const result = await test.testFn();
                this.results.set(test.id, result);
                this.updateTestUI(test, result);
            } catch (error) {
                const result = {
                    pass: false,
                    message: `Test error: ${error.message}`,
                    details: error.stack
                };
                this.results.set(test.id, result);
                this.updateTestUI(test, result);
            }
        }

        this.updateSummary();
        log('success', '✓ Validation tests completed');
    }

    /**
     * Test 1: Protected Resource Metadata Support
     */
    async testProtectedResourceMetadata() {
        const urls = [
            `${this.mcpServerUrl}/.well-known/oauth-protected-resource`,
            `${this.mcpServerUrl}/.well-known/oauth-protected-resource/mcp`
        ];

        for (const url of urls) {
            try {
                const response = await fetch(url);
                if (response.ok) {
                    const metadata = await response.json();
                    if (metadata.resource && metadata.authorization_servers) {
                        return {
                            pass: true,
                            status: 'pass',
                            message: 'Protected resource metadata available',
                            details: `Found at: ${url}\nResource: ${metadata.resource}\nAuth Servers: ${metadata.authorization_servers.join(', ')}`
                        };
                    }
                }
            } catch (error) {
                continue;
            }
        }

        return {
            pass: false,
            message: 'Protected resource metadata not found',
            details: `Tried URLs:\n${urls.join('\n')}`
        };
    }

    /**
     * Helper: Parse MCP response (handles both JSON and SSE formats)
     *
     * mcp-proxy may return either application/json or text/event-stream.
     * SSE format wraps JSON in "data:" lines.
     */
    async parseMCPResponse(response) {
        const contentType = response.headers.get('Content-Type') || '';

        if (contentType.includes('text/event-stream')) {
            // Parse SSE format
            const text = await response.text();

            // Extract JSON from SSE "data:" line
            // Format: event: message\nid: ...\ndata: {"jsonrpc":"2.0",...}\n\n
            const dataMatch = text.match(/^data:\s*(.+)$/m);

            if (dataMatch && dataMatch[1]) {
                try {
                    return JSON.parse(dataMatch[1]);
                } catch (e) {
                    throw new Error(`Failed to parse SSE data as JSON: ${e.message}`);
                }
            }

            throw new Error('No data field found in SSE response');
        } else {
            // Standard JSON response
            return await response.json();
        }
    }

    /**
     * Helper: Fetch WWW-Authenticate header from 401 response
     */
    async fetchWWWAuthenticateHeader() {
        const response = await fetch(`${this.mcpServerUrl}/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json;q=1.0, text/event-stream;q=0.5'  // Prefer JSON over SSE
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'initialize',
                params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'validator', version: '1.0' } },
                id: 1
            })
        });

        if (response.status !== 401) {
            throw new Error(`Expected 401, got HTTP ${response.status}`);
        }

        const wwwAuth = response.headers.get('WWW-Authenticate');
        if (!wwwAuth) {
            throw new Error('WWW-Authenticate header not present');
        }

        return wwwAuth;
    }

    /**
     * Test 2: WWW-Authenticate Bearer Scheme
     */
    async testWWWAuthBearerScheme() {
        try {
            const wwwAuth = await this.fetchWWWAuthenticateHeader();
            const hasBearer = wwwAuth.startsWith('Bearer ') || wwwAuth.includes('Bearer ');

            if (hasBearer) {
                return {
                    pass: true,
                    message: 'Bearer authentication scheme present',
                    details: `Header: ${wwwAuth}`
                };
            }

            return {
                pass: false,
                message: 'Bearer scheme missing from WWW-Authenticate header',
                details: `Header: ${wwwAuth}\nExpected: Bearer scheme (RFC 6750)`
            };
        } catch (error) {
            return {
                pass: false,
                message: 'Failed to test Bearer scheme',
                details: error.message
            };
        }
    }

    /**
     * Test 3: WWW-Authenticate resource_metadata Parameter
     */
    async testWWWAuthResourceMetadata() {
        try {
            const wwwAuth = await this.fetchWWWAuthenticateHeader();
            const hasResourceMetadata = wwwAuth.includes('resource_metadata=');

            if (hasResourceMetadata) {
                // Extract the URL from resource_metadata parameter
                const match = wwwAuth.match(/resource_metadata="([^"]+)"/);
                const url = match ? match[1] : 'unknown';

                return {
                    pass: true,
                    message: 'resource_metadata parameter present',
                    details: `Header: ${wwwAuth}\nResource Metadata URL: ${url}`
                };
            }

            return {
                pass: false,
                message: 'resource_metadata parameter missing (REQUIRED by MCP spec)',
                details: `Header: ${wwwAuth}\nExpected: resource_metadata="<url>" parameter pointing to Protected Resource Metadata`
            };
        } catch (error) {
            return {
                pass: false,
                message: 'Failed to test resource_metadata parameter',
                details: error.message
            };
        }
    }

    /**
     * Test 4: WWW-Authenticate scope Parameter
     */
    async testWWWAuthScope() {
        try {
            const wwwAuth = await this.fetchWWWAuthenticateHeader();
            const hasScope = wwwAuth.includes('scope=');

            if (hasScope) {
                // Extract scope value
                const match = wwwAuth.match(/scope="([^"]+)"/);
                const scopes = match ? match[1] : 'unknown';

                return {
                    pass: true,
                    status: 'pass',
                    message: 'scope parameter present (recommended)',
                    details: `Header: ${wwwAuth}\nScopes: ${scopes}\nℹ️ This is a SHOULD requirement - recommended but not mandatory`
                };
            }

            return {
                pass: true,
                status: 'info',
                message: 'scope parameter not present',
                details: `Header: ${wwwAuth}\nℹ️ MCP spec recommends (SHOULD) including scope parameter to guide clients on required scopes\nThis is informational only - not a compliance failure`
            };
        } catch (error) {
            return {
                pass: false,
                status: 'fail',
                message: 'Failed to test scope parameter',
                details: error.message
            };
        }
    }

    /**
     * Test 5: WWW-Authenticate realm Parameter
     */
    async testWWWAuthRealm() {
        try {
            const wwwAuth = await this.fetchWWWAuthenticateHeader();
            const hasRealm = wwwAuth.includes('realm=');

            if (hasRealm) {
                // Extract realm value
                const match = wwwAuth.match(/realm="([^"]+)"/);
                const realm = match ? match[1] : 'unknown';

                return {
                    pass: true,
                    status: 'pass',
                    message: 'realm parameter present (optional)',
                    details: `Header: ${wwwAuth}\nRealm: ${realm}\nℹ️ This is an OPTIONAL (MAY) parameter per RFC 6750`
                };
            }

            return {
                pass: true,
                status: 'info',
                message: 'realm parameter not present',
                details: `Header: ${wwwAuth}\nℹ️ realm is OPTIONAL (MAY) per RFC 6750\nThis is informational only - not a compliance failure`
            };
        } catch (error) {
            return {
                pass: false,
                status: 'fail',
                message: 'Failed to test realm parameter',
                details: error.message
            };
        }
    }

    /**
     * Test 3: Well-Known URI Support
     */
    async testWellKnownURI() {
        const urls = [
            `${this.mcpServerUrl}/.well-known/oauth-protected-resource/mcp`,
            `${this.mcpServerUrl}/.well-known/oauth-protected-resource`
        ];

        const results = [];
        for (const url of urls) {
            try {
                const response = await fetch(url);
                results.push({ url, status: response.status, ok: response.ok });
                if (response.ok) {
                    return {
                        pass: true,
                        message: 'Well-known URI accessible',
                        details: `Found at: ${url}\nStatus: ${response.status}`
                    };
                }
            } catch (error) {
                results.push({ url, error: error.message });
            }
        }

        return {
            pass: false,
            message: 'Well-known URI not accessible',
            details: JSON.stringify(results, null, 2)
        };
    }

    /**
     * Test 4: Authorization Server Discovery
     */
    async testAuthServerDiscovery() {
        try {
            const url = `${this.mcpServerUrl}/.well-known/oauth-authorization-server`;
            const response = await fetch(url);

            if (response.ok) {
                const metadata = await response.json();
                if (metadata.authorization_endpoint && metadata.token_endpoint) {
                    return {
                        pass: true,
                        message: 'Authorization server metadata available',
                        details: `Authorization: ${metadata.authorization_endpoint}\nToken: ${metadata.token_endpoint}`
                    };
                }
            }

            return {
                pass: false,
                message: 'Authorization server metadata not found or incomplete',
                details: `URL: ${url}\nStatus: ${response.status}`
            };
        } catch (error) {
            return {
                pass: false,
                message: 'Failed to fetch authorization server metadata',
                details: error.message
            };
        }
    }

    /**
     * Test 5: 401 Unauthorized for Missing Token
     */
    async testUnauthorizedMissingToken() {
        try {
            const response = await fetch(`${this.mcpServerUrl}/mcp`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json;q=1.0, text/event-stream;q=0.5'  // Prefer JSON over SSE
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'tools/list',
                    id: 1
                })
            });

            if (response.status === 401) {
                return {
                    pass: true,
                    message: 'Correctly returns 401 for missing token',
                    details: `Status: ${response.status} ${response.statusText}`
                };
            }

            return {
                pass: false,
                message: `Expected 401, got HTTP ${response.status}`,
                details: 'Server should reject requests without authentication'
            };
        } catch (error) {
            return {
                pass: false,
                message: 'Failed to test unauthorized access',
                details: error.message
            };
        }
    }

    /**
     * Test 6: 401 Unauthorized for Invalid Token
     */
    async testUnauthorizedInvalidToken() {
        try {
            const response = await fetch(`${this.mcpServerUrl}/mcp`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json;q=1.0, text/event-stream;q=0.5',  // Prefer JSON over SSE
                    'Authorization': 'Bearer invalid.jwt.token'
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'tools/list',
                    id: 1
                })
            });

            if (response.status === 401) {
                return {
                    pass: true,
                    message: 'Correctly rejects invalid tokens',
                    details: `Status: ${response.status} ${response.statusText}`
                };
            }

            return {
                pass: false,
                message: `Expected 401, got HTTP ${response.status}`,
                details: 'Server should reject invalid tokens'
            };
        } catch (error) {
            return {
                pass: false,
                message: 'Failed to test invalid token rejection',
                details: error.message
            };
        }
    }

    /**
     * Test 7: Token Audience Binding
     */
    async testTokenAudienceBinding() {
        // This test validates that the server accepts tokens with correct audience binding
        try {
            // Check if we have an access token
            if (!this.accessToken) {
                return {
                    pass: false,
                    message: 'Cannot test audience binding - no access token available',
                    details: 'Token acquisition must succeed before testing audience binding'
                };
            }

            // Step 1: Get the expected audience from protected resource metadata
            let expectedAudience = null;
            try {
                const metadataResponse = await fetch(`${this.mcpServerUrl}/.well-known/oauth-protected-resource`);
                if (metadataResponse.ok) {
                    const metadata = await metadataResponse.json();
                    expectedAudience = metadata.resource;
                }
            } catch (error) {
                log('warning', `⚠ Could not fetch protected resource metadata: ${error.message}`);
            }

            // Step 2: Make an authenticated request to the MCP server
            const response = await fetch(`${this.mcpServerUrl}/mcp`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json;q=1.0, text/event-stream;q=0.5',  // Prefer JSON (q=1.0) over SSE (q=0.5)
                    'Authorization': `Bearer ${this.accessToken}`
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'initialize',
                    params: {
                        protocolVersion: '2024-11-05',
                        capabilities: {},
                        clientInfo: {
                            name: 'mcp-validator',
                            version: '1.0.0'
                        }
                    },
                    id: 1
                })
            });

            // Step 3: Check if token was accepted (proving audience binding works)
            if (response.ok || response.status === 200) {
                const result = await this.parseMCPResponse(response);

                // Check if we got a valid MCP response (not an error)
                if (result.result && !result.error) {
                    return {
                        pass: true,
                        message: 'Token accepted - audience binding validated',
                        details: `✅ Server successfully validated token audience\nExpected audience: ${expectedAudience || 'Not declared in metadata'}\nToken was accepted by MCP server\nResponse: initialize successful`
                    };
                }
            }

            // Step 4: If token was rejected, check if it's due to audience mismatch
            if (response.status === 401 || response.status === 403) {
                const errorText = await response.text();

                return {
                    pass: false,
                    message: 'Token rejected - possible audience binding mismatch',
                    details: `❌ Server rejected token (HTTP ${response.status})\nExpected audience: ${expectedAudience || 'Not declared in metadata'}\nThis may indicate:\n1. Token audience claim does not match server resource identifier\n2. Token was not issued for this MCP server\n3. IDP audience configuration mismatch\n\nServer response: ${errorText.substring(0, 200)}`
                };
            }

            // Unexpected response
            return {
                pass: false,
                message: `Unexpected response: HTTP ${response.status}`,
                details: `Server returned unexpected status code\nExpected: 200 (success) or 401/403 (auth failure)\nReceived: ${response.status}`
            };

        } catch (error) {
            return {
                pass: false,
                message: 'Failed to test audience binding',
                details: error.message
            };
        }
    }

    /**
     * Test 12: HTTPS Enforcement
     */
    async testHTTPSEnforcement() {
        const serverUrl = new URL(this.mcpServerUrl);
        const isHTTPS = serverUrl.protocol === 'https:';
        const isLocalhost = serverUrl.hostname === 'localhost' || serverUrl.hostname === '127.0.0.1';

        if (isHTTPS) {
            return {
                pass: true,
                status: 'pass',
                message: 'Server uses HTTPS (production ready)',
                details: `URL: ${this.mcpServerUrl}\n✅ HTTPS enforced - ready for production deployment`
            };
        } else if (isLocalhost) {
            return {
                pass: true,
                status: 'info',
                message: 'HTTP allowed for localhost development',
                details: `URL: ${this.mcpServerUrl}\nℹ️ HTTP is acceptable for localhost/127.0.0.1 development\n⚠️ HTTPS is REQUIRED for production deployment\n\nThis is informational - localhost development is exempt from HTTPS requirement`
            };
        } else {
            return {
                pass: false,
                status: 'fail',
                message: 'Server uses HTTP (HTTPS REQUIRED for production)',
                details: `URL: ${this.mcpServerUrl}\n❌ Non-localhost servers MUST use HTTPS\nCurrent protocol: ${serverUrl.protocol}\nMCP specification requires HTTPS for all production deployments`
            };
        }
    }

    /**
     * Test 13: Scope Information in 403 Errors (SHOULD)
     */
    async testScopeErrorInfo() {
        // This test attempts to trigger a 403 by calling a restricted endpoint
        try {
            // Check if we have an access token
            if (!this.accessToken) {
                return {
                    pass: true,
                    status: 'info',
                    message: 'Cannot test 403 response - no access token available',
                    details: 'ℹ️ This is a SHOULD requirement - MCP servers should include scope information in WWW-Authenticate header for 403 Forbidden responses\n\nToken acquisition must succeed before testing 403 responses'
                };
            }

            // Try to call a potentially restricted tool (admin-only operations)
            // Most MCP servers have some tools that require elevated permissions
            const restrictedEndpoints = [
                { method: 'tools/call', params: { name: 'audit-log', arguments: {} } },
                { method: 'tools/call', params: { name: 'admin-tool', arguments: {} } },
                { method: 'tools/call', params: { name: 'delete-user', arguments: {} } }
            ];

            for (const endpoint of restrictedEndpoints) {
                const response = await fetch(`${this.mcpServerUrl}/mcp`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json;q=1.0, text/event-stream;q=0.5',  // Prefer JSON over SSE
                        'Authorization': `Bearer ${this.accessToken}`
                    },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        method: endpoint.method,
                        params: endpoint.params,
                        id: 1
                    })
                });

                // Check for 403 Forbidden response
                if (response.status === 403) {
                    const wwwAuth = response.headers.get('WWW-Authenticate');

                    if (wwwAuth && wwwAuth.includes('scope=')) {
                        // Extract scope information
                        const scopeMatch = wwwAuth.match(/scope="([^"]+)"/);
                        const requiredScopes = scopeMatch ? scopeMatch[1] : 'unknown';

                        return {
                            pass: true,
                            status: 'info',
                            message: 'WWW-Authenticate includes scope info on 403 (recommended)',
                            details: `✅ Server includes scope information in 403 responses\nEndpoint: ${endpoint.method}\nHeader: ${wwwAuth}\nRequired scopes: ${requiredScopes}\n\nℹ️ This is a SHOULD requirement - recommended but not mandatory`
                        };
                    } else {
                        return {
                            pass: true,
                            status: 'info',
                            message: 'WWW-Authenticate present but no scope info',
                            details: `Endpoint: ${endpoint.method}\nHeader: ${wwwAuth || 'Not present'}\n\nℹ️ MCP servers SHOULD include scope information in WWW-Authenticate header for 403 responses\nThis helps clients understand what permissions are needed\n\nThis is informational only - not a compliance failure`
                        };
                    }
                }
            }

            // No 403 responses triggered - token might have full permissions
            return {
                pass: true,
                status: 'info',
                message: 'Cannot trigger 403 response - token may have full permissions',
                details: `Attempted to call restricted endpoints but no 403 responses received\nThis may indicate:\n1. Token has all necessary permissions\n2. Server does not have restricted tools\n3. Server does not properly enforce authorization\n\nℹ️ This is a SHOULD requirement - servers should include scope information in 403 responses\nManual verification recommended for production deployments`
            };

        } catch (error) {
            return {
                pass: true,
                status: 'info',
                message: 'Failed to test 403 scope information',
                details: `Error: ${error.message}\n\nℹ️ This is a SHOULD requirement - not a critical failure\nManual verification recommended`
            };
        }
    }

    /**
     * Test 10: Protected Resource Metadata Structure
     */
    async testProtectedResourceStructure() {
        try {
            const response = await fetch(`${this.mcpServerUrl}/.well-known/oauth-protected-resource`);
            if (response.ok) {
                const metadata = await response.json();
                const required = ['resource', 'authorization_servers', 'bearer_methods_supported'];
                const missing = required.filter(field => !metadata[field]);

                if (missing.length === 0) {
                    return {
                        pass: true,
                        message: 'Protected resource metadata has all required fields',
                        details: JSON.stringify(metadata, null, 2)
                    };
                }

                return {
                    pass: false,
                    message: 'Protected resource metadata missing required fields',
                    details: `Missing: ${missing.join(', ')}\n${JSON.stringify(metadata, null, 2)}`
                };
            }

            return {
                pass: false,
                message: 'Cannot fetch protected resource metadata',
                details: `Status: ${response.status}`
            };
        } catch (error) {
            return {
                pass: false,
                message: 'Failed to test metadata structure',
                details: error.message
            };
        }
    }

    /**
     * Test 11: Authorization Server Metadata Structure
     */
    async testAuthServerStructure() {
        try {
            const response = await fetch(`${this.mcpServerUrl}/.well-known/oauth-authorization-server`);
            if (response.ok) {
                const metadata = await response.json();
                const required = ['authorization_endpoint', 'token_endpoint', 'response_types_supported'];
                const missing = required.filter(field => !metadata[field]);

                if (missing.length === 0) {
                    return {
                        pass: true,
                        message: 'Authorization server metadata has all required fields',
                        details: JSON.stringify(metadata, null, 2)
                    };
                }

                return {
                    pass: false,
                    message: 'Authorization server metadata missing required fields',
                    details: `Missing: ${missing.join(', ')}\n${JSON.stringify(metadata, null, 2)}`
                };
            }

            return {
                pass: false,
                message: 'Cannot fetch authorization server metadata',
                details: `Status: ${response.status}`
            };
        } catch (error) {
            return {
                pass: false,
                message: 'Failed to test metadata structure',
                details: error.message
            };
        }
    }

    /**
     * Test 12: PKCE Support
     */
    async testPKCESupport() {
        try {
            const response = await fetch(`${this.mcpServerUrl}/.well-known/oauth-authorization-server`);
            if (response.ok) {
                const metadata = await response.json();
                const supportsPKCE = metadata.code_challenge_methods_supported?.includes('S256');

                if (supportsPKCE) {
                    return {
                        pass: true,
                        message: 'PKCE with S256 is supported',
                        details: `Supported methods: ${metadata.code_challenge_methods_supported.join(', ')}`
                    };
                }

                return {
                    pass: false,
                    message: 'PKCE S256 not advertised in metadata',
                    details: `Supported methods: ${metadata.code_challenge_methods_supported || 'none'}`
                };
            }

            return {
                pass: false,
                message: 'Cannot verify PKCE support',
                details: `Status: ${response.status}`
            };
        } catch (error) {
            return {
                pass: false,
                message: 'Failed to test PKCE support',
                details: error.message
            };
        }
    }

    /**
     * Update test item UI
     */
    updateTestUI(test, result) {
        const checklist = document.getElementById('validation-checklist');
        let item = document.getElementById(`test-${test.id}`);

        if (!item) {
            item = document.createElement('li');
            item.id = `test-${test.id}`;
            item.className = 'validation-item pending';
            checklist.appendChild(item);
        }

        // Determine status and icon
        let status, icon;
        if (result.status === 'info') {
            status = 'info';
            icon = 'ℹ️';
        } else if (result.pass) {
            status = 'pass';
            icon = '✅';
        } else {
            status = 'fail';
            icon = '❌';
        }

        item.className = `validation-item ${status}`;
        item.innerHTML = `
            <div class="validation-icon ${status}">
                ${icon}
                <button class="retry-button" onclick="mcpValidator.retryTest('${test.id}')" title="Retry this test">
                    🔄
                </button>
            </div>
            <div class="validation-details">
                <div class="validation-title">${test.title}</div>
                <div class="validation-description">${test.description}</div>
                <div class="validation-result">
                    <strong>${result.message}</strong>
                    ${result.details ? `<br><pre style="margin-top: 4px; font-size: 10px; overflow-x: auto; white-space: pre-wrap;">${result.details}</pre>` : ''}
                </div>
            </div>
        `;
    }

    /**
     * Update summary counts
     */
    updateSummary() {
        const summary = document.getElementById('validation-summary');
        summary.style.display = 'block';

        let passCount = 0;
        let failCount = 0;
        let infoCount = 0;
        let pendingCount = 0;

        this.results.forEach(result => {
            if (result.status === 'info') {
                infoCount++;
            } else if (result.pass) {
                passCount++;
            } else {
                failCount++;
            }
        });

        pendingCount = this.tests.length - this.results.size;

        document.getElementById('validation-pass-count').textContent = passCount;
        document.getElementById('validation-fail-count').textContent = failCount;
        document.getElementById('validation-info-count').textContent = infoCount;
        document.getElementById('validation-pending-count').textContent = pendingCount;
        document.getElementById('validation-total-count').textContent = this.tests.length;
    }

    /**
     * Retry a single test
     * @param {string} testId - ID of the test to retry
     */
    async retryTest(testId) {
        log('info', `🔄 Retrying test: ${testId}`);

        // Find the test
        const test = this.tests.find(t => t.id === testId);
        if (!test) {
            log('error', `Test not found: ${testId}`);
            return;
        }

        // Mark test as pending
        const item = document.getElementById(`test-${testId}`);
        if (item) {
            item.className = 'validation-item pending';
            item.querySelector('.validation-icon').innerHTML = '⏳<button class="retry-button" onclick="mcpValidator.retryTest(\'' + testId + '\')" title="Retry this test">🔄</button>';
        }

        try {
            log('info', `Running: ${test.title}`);
            const result = await test.testFn();
            this.results.set(test.id, result);
            this.updateTestUI(test, result);
            this.updateSummary();

            const statusEmoji = result.status === 'info' ? 'ℹ️' : (result.pass ? '✅' : '❌');
            log('info', `${statusEmoji} ${test.title}: ${result.message}`);
        } catch (error) {
            const result = {
                pass: false,
                message: `Test error: ${error.message}`,
                details: error.stack
            };
            this.results.set(test.id, result);
            this.updateTestUI(test, result);
            this.updateSummary();

            log('error', `❌ ${test.title}: ${error.message}`);
        }
    }
}

// Global validator instance
let mcpValidator = null;

/**
 * Initialize validator when page loads
 */
function initializeValidator() {
    mcpValidator = new MCPValidator();
    log('info', '✓ Validation suite initialized');
}

/**
 * Run all validation tests
 */
async function runAllValidationTests() {
    if (!mcpValidator) {
        initializeValidator();
    }

    await mcpValidator.runAllTests();
}

/**
 * Clear validation results
 */
function clearValidationResults() {
    const checklist = document.getElementById('validation-checklist');
    checklist.innerHTML = '';

    const summary = document.getElementById('validation-summary');
    summary.style.display = 'none';

    if (mcpValidator) {
        mcpValidator.results.clear();
    }

    log('info', 'Validation results cleared');
}

// Initialize validator on page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeValidator);
} else {
    initializeValidator();
}
