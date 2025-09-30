import { MCPServerModel } from '../models/MCPServer.js';
import { AgentModel } from '../models/Agent.js';
import { MCPTool } from '../utils/MCPTool.js';
import { createHash } from 'crypto';
// Phase 8: Import SDK types and backward compatibility aliases
import {
  // SDK types (new)
  SDKTool,
  SDKListToolsResult,
  SDKCallToolResult,
  SDKServerCapabilities,
  // Backward compatibility aliases
  MCPToolDefinition,
  MCPToolInstance,
  MCPToolCache,
  MCPServerConnection,
  MCPToolExecutionContext,
  MCPRequest,
  MCPResponse,
  MCPListToolsResponse,
  MCPError,
  MCPConnectionError,
  MCPTimeoutError,
  MCPSessionError,
  MCPServerHealthCheck,
  MCPServerTestResult,
  MCPServerInfo,
  MCPServerCapabilities,
  MCPSessionContext,
  MCPInitializeRequest,
  MCPInitializeResponse,
  MCPToolResult,
  // Type utilities
  isSDKTool,
  isSDKCallToolResult,
  legacyToSDKTool
} from '../types/mcpSdk.js';
import { CustomError } from '../middleware/errorHandler.js';
import pool from '../config/database.js';
import { ErrorLoggingService } from './errorLoggingService.js';

// MCP SDK imports
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { 
  ListToolsResultSchema,
  CallToolResultSchema,
  InitializeResultSchema,
  ListResourcesResultSchema,
  ListPromptsResultSchema
} from '@modelcontextprotocol/sdk/types.js';

/**
 * Service for managing MCP (Model Context Protocol) server tools
 * Handles tool discovery, caching, and integration with LangChain
 */
// Interface for Simple Auth challenges
interface SimpleAuthChallenge {
  challengeKey: string;
  challengeId: number;
  createdAt: Date;
  expiresAt: Date;
}

// Phase 9: Enhanced client metadata for resource management
interface ClientMetadata {
  client: Client;
  createdAt: Date;
  lastUsedAt: Date;
  transportType: 'HTTP' | 'SSE';
}

export class MCPToolsService {
  private static instance: MCPToolsService;
  private toolCache = new Map<string, MCPToolCache>();
  private sessionCache = new Map<string, MCPSessionContext>();
  private simpleAuthChallenges = new Map<string, SimpleAuthChallenge>(); // serverId -> challenge
  private mcpClients = new Map<string, ClientMetadata>(); // Phase 9: Enhanced with metadata
  private cleanupInterval?: NodeJS.Timeout; // Phase 9: Periodic cleanup timer
  
  // Phase 9: Resource management constants
  private readonly MAX_CLIENTS = 100; // Maximum number of cached clients
  private readonly CLIENT_TTL_MS = 30 * 60 * 1000; // 30 minutes idle timeout
  private readonly CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // Cleanup every 5 minutes
  
  // Existing constants
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private readonly SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes  
  private readonly DEFAULT_TIMEOUT_MS = 30 * 1000; // 30 seconds
  private readonly SIMPLE_AUTH_CHALLENGE_TTL_MS = 2 * 60 * 1000; // 2 minutes for challenges

  public static getInstance(): MCPToolsService {
    if (!MCPToolsService.instance) {
      MCPToolsService.instance = new MCPToolsService();
      // Phase 9: Start periodic cleanup timer
      MCPToolsService.instance.startPeriodicCleanup();
    }
    return MCPToolsService.instance;
  }
  
  /**
   * Phase 9: Start periodic cleanup of idle clients
   */
  private startPeriodicCleanup(): void {
    if (this.cleanupInterval) {
      return; // Already running
    }
    
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleClients();
    }, this.CLEANUP_INTERVAL_MS);
    
    console.log(`[${new Date().toISOString()}] [MCP Resource Management] Started periodic cleanup (every ${this.CLEANUP_INTERVAL_MS / 1000}s)`);
  }
  
  /**
   * Phase 9: Clean up idle clients to prevent memory leaks
   */
  private cleanupIdleClients(): void {
    const now = Date.now();
    const clientsToRemove: string[] = [];
    
    // Find idle clients
    for (const [key, metadata] of Array.from(this.mcpClients.entries())) {
      const idleTime = now - metadata.lastUsedAt.getTime();
      if (idleTime > this.CLIENT_TTL_MS) {
        clientsToRemove.push(key);
      }
    }
    
    // Remove idle clients
    for (const key of clientsToRemove) {
      const metadata = this.mcpClients.get(key);
      if (metadata) {
        try {
          metadata.client.close();
        } catch (error) {
          console.warn(`[${new Date().toISOString()}] [MCP Resource Management] Error closing client:`, error);
        }
        this.mcpClients.delete(key);
      }
    }
    
    if (clientsToRemove.length > 0) {
      console.log(`[${new Date().toISOString()}] [MCP Resource Management] Cleaned up ${clientsToRemove.length} idle clients`);
    }
    
    // Enforce max client limit
    if (this.mcpClients.size > this.MAX_CLIENTS) {
      this.enforceMaxClients();
    }
  }
  
  /**
   * Phase 9: Enforce maximum client limit by removing least recently used
   */
  private enforceMaxClients(): void {
    const clientsToRemove = this.mcpClients.size - this.MAX_CLIENTS;
    if (clientsToRemove <= 0) return;
    
    // Sort by last used time (oldest first)
    const sortedClients = Array.from(this.mcpClients.entries())
      .sort((a, b) => a[1].lastUsedAt.getTime() - b[1].lastUsedAt.getTime());
    
    // Remove oldest clients
    for (let i = 0; i < clientsToRemove; i++) {
      const [key, metadata] = sortedClients[i];
      try {
        metadata.client.close();
      } catch (error) {
        console.warn(`[${new Date().toISOString()}] [MCP Resource Management] Error closing client:`, error);
      }
      this.mcpClients.delete(key);
    }
    
    console.log(`[${new Date().toISOString()}] [MCP Resource Management] Enforced max clients limit, removed ${clientsToRemove} clients`);
  }

  /**
   * Create transport for MCP SDK client based on server endpoint
   * Phase 4: Now includes authentication via request headers
   * Phase 5: Integrated with SDK session management
   * Phase 6: Enhanced with SSE and alternative transport support
   */
  private createTransport(server: MCPServerConnection, conversationId?: string): Transport {
    console.log(`[${new Date().toISOString()}] [MCP SDK] Creating transport for server:`, {
      serverId: server.id,
      serverName: server.name,
      endpoint: server.endpointUrl,
      authType: server.auth_type,
      conversationId
    });

    const url = new URL(server.endpointUrl);
    
    // Create authentication headers based on server configuration
    const authHeaders = this.createSDKAuthHeaders(server, conversationId);
    
    // Phase 5: Get existing session ID from legacy cache for migration compatibility
    const sessionKey = conversationId ? `${server.id}_${conversationId}` : server.id;
    const existingSession = this.sessionCache.get(sessionKey);
    const sessionId = existingSession?.sessionId;
    
    // Common transport options with authentication and session management
    const baseHeaders = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'User-Agent': 'ContextFlow-AI/1.0',
      // Protocol version is handled automatically by SDK after initialization
      ...authHeaders // Add authentication headers
    };
    
    // Phase 6: Determine transport type based on endpoint and server configuration
    const isSSEEndpoint = server.endpointUrl.includes('/sse') || 
                         server.endpointUrl.includes('/events') ||
                         server.endpointUrl.includes('/stream');
    
    let transport: Transport;
    
    if (isSSEEndpoint) {
      // Use SSE transport for server-sent event endpoints
      // Phase 11: Add deprecation warning for SSE transport
      console.warn(`[${new Date().toISOString()}] [MCP SDK] ⚠️  SSE transport is deprecated! Consider migrating to Streamable HTTP.`);
      console.warn(`[${new Date().toISOString()}] [MCP SDK] ⚠️  SSE endpoint: ${server.endpointUrl} - Check if a modern HTTP endpoint is available`);
      console.log(`[${new Date().toISOString()}] [MCP SDK] Using deprecated SSE transport for endpoint: ${server.endpointUrl}`);
      
      transport = new SSEClientTransport(url, {
        requestInit: {
          headers: baseHeaders
        }
      });
    } else {
      // Use HTTP transport for standard endpoints (default)
      console.log(`[${new Date().toISOString()}] [MCP SDK] Using HTTP transport for endpoint: ${server.endpointUrl}`);
      
      const opts = {
        requestInit: {
          headers: baseHeaders
        },
        // Phase 5: SDK-based session management
        sessionId: sessionId // Let SDK handle session if we have one
      };
      
      transport = new StreamableHTTPClientTransport(url, opts);
    }

    console.log(`[${new Date().toISOString()}] [MCP SDK] Transport created for server ${server.name}:`, {
      transportType: isSSEEndpoint ? 'SSE' : 'HTTP',
      authType: server.auth_type,
      hasSession: !!sessionId,
      sessionPreview: sessionId ? sessionId.substring(0, 8) + '...' : null
    });
    return transport;
  }

  /**
   * Create authentication headers for SDK transport
   * Phase 4: Maps our auth types to HTTP headers
   */
  private createSDKAuthHeaders(server: MCPServerConnection, conversationId?: string): Record<string, string> {
    const headers: Record<string, string> = {};
    
    console.log(`[${new Date().toISOString()}] [MCP SDK Auth] Creating auth headers for server:`, {
      serverId: server.id,
      serverName: server.name,
      authType: server.auth_type,
      hasUsername: !!server.username,
      hasSecret: !!server.secret
    });
    
    switch (server.auth_type) {
      case 'api_key':
        if (server.secret) {
          headers['X-API-Key'] = server.secret;
          console.log(`[${new Date().toISOString()}] [MCP SDK Auth] Added API key header`);
        }
        break;
        
      case 'bearer_token':
        if (server.secret) {
          headers['Authorization'] = `Bearer ${server.secret}`;
          console.log(`[${new Date().toISOString()}] [MCP SDK Auth] Added Bearer token header`);
        }
        break;
        
      case 'basic_auth':
        if (server.username && server.secret) {
          const credentials = Buffer.from(`${server.username}:${server.secret}`).toString('base64');
          headers['Authorization'] = `Basic ${credentials}`;
          console.log(`[${new Date().toISOString()}] [MCP SDK Auth] Added Basic auth header`);
        }
        break;
        
      case 'simple_auth':
        // Simple auth requires pre-authentication challenge-response flow
        // This is complex and will be implemented in a later phase
        // For now, simple_auth servers will use legacy HTTP implementation
        console.log(`[${new Date().toISOString()}] [MCP SDK Auth] Simple auth not yet supported in SDK mode - will use legacy fallback`);
        break;
        
      case 'none':
      default:
        console.log(`[${new Date().toISOString()}] [MCP SDK Auth] No authentication configured`);
        break;
    }
    
    return headers;
  }

  /**
   * Get or create an MCP SDK client for a server
   * Phase 4: Now includes authentication via transport headers
   * Authentication is handled at the transport level via requestInit headers
   */
  private async _getOrCreateMcpClient(server: MCPServerConnection, conversationId?: string): Promise<Client> {
    const clientKey = conversationId ? `${server.id}_${conversationId}` : server.id;
    
    // Phase 9: Check if client already exists and update last used time
    const existingMetadata = this.mcpClients.get(clientKey);
    if (existingMetadata) {
      existingMetadata.lastUsedAt = new Date();
      console.log(`[${new Date().toISOString()}] [MCP SDK] Reusing existing client for server:`, {
        serverId: server.id,
        serverName: server.name,
        clientAge: Date.now() - existingMetadata.createdAt.getTime(),
        cacheSize: this.mcpClients.size
      });
      return existingMetadata.client;
    }

    console.log(`[${new Date().toISOString()}] [MCP SDK] Creating new client for server:`, {
      serverId: server.id,
      serverName: server.name,
      endpoint: server.endpointUrl
    });

    let client: Client; // Phase 11: Fix missing variable declaration causing ReferenceError

    try {
      // Check if this server uses simple_auth which requires special handling
      if (server.auth_type === 'simple_auth') {
        console.log(`[${new Date().toISOString()}] [MCP SDK] Simple auth detected - SDK client creation will be skipped`);
        throw new MCPConnectionError(
          server.id,
          server.endpointUrl,
          new Error('Simple auth requires legacy implementation - SDK client not created')
        );
      }

      // Create transport
      const transport = this.createTransport(server, conversationId);

      // Phase 11: Fixed client variable declaration
      client = new Client({
        name: 'ContextFlow-AI',
        version: '1.0.0'
      }, {
        capabilities: {
          // Client capabilities - what we support
          tools: {},
          resources: {},
          prompts: {}
        }
      });

      // Connect to the server
      await client.connect(transport);
      
      // Phase 5: Sync SDK session back to our cache for compatibility
      const transportWithSession = transport as StreamableHTTPClientTransport;
      const newSessionId = transportWithSession.sessionId;
      
      if (newSessionId) {
        const sessionKey = conversationId ? `${server.id}_${conversationId}` : server.id;
        const sessionContext: MCPSessionContext = {
          serverId: server.id,
          sessionId: newSessionId,
          serverInfo: {
            name: server.name,
            version: '1.0.0', // Default version
            capabilities: {}
          },
          protocolVersion: transportWithSession.protocolVersion || '2024-11-05',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + this.SESSION_TTL_MS)
        };
        
        this.sessionCache.set(sessionKey, sessionContext);
        
        console.log(`[${new Date().toISOString()}] [MCP SDK] Synced SDK session to cache:`, {
          serverId: server.id,
          sessionKey,
          sessionId: newSessionId.substring(0, 8) + '...',
          protocolVersion: sessionContext.protocolVersion
        });
      }
      
      console.log(`[${new Date().toISOString()}] [MCP SDK] Client connected successfully for server:`, {
        serverId: server.id,
        serverName: server.name,
        serverCapabilities: client.getServerCapabilities(),
        hasSession: !!newSessionId
      });

      // Phase 9: Store the client with metadata for resource management
      const metadata: ClientMetadata = {
        client,
        createdAt: new Date(),
        lastUsedAt: new Date(),
        transportType: server.endpointUrl.includes('/sse') || 
                      server.endpointUrl.includes('/events') || 
                      server.endpointUrl.includes('/stream') ? 'SSE' : 'HTTP'
      };
      this.mcpClients.set(clientKey, metadata);
      
      // Phase 9: Enforce max clients limit
      if (this.mcpClients.size > this.MAX_CLIENTS) {
        this.enforceMaxClients();
      }

      return client;

    } catch (error) {
      // Phase 6: Enhanced error handling with better categorization
      const errorDetails = this.categorizeSDKError(error);
      
      console.error(`[${new Date().toISOString()}] [MCP SDK] Failed to create/connect client:`, {
        serverId: server.id,
        serverName: server.name,
        errorType: errorDetails.type,
        errorMessage: errorDetails.message,
        errorCode: errorDetails.code,
        isRetryable: errorDetails.isRetryable
      });

      // Log to error logging service if available
      if (errorDetails.type === 'CONNECTION' || errorDetails.type === 'TIMEOUT') {
        try {
          await ErrorLoggingService.getInstance().logError({
            severity: errorDetails.type === 'TIMEOUT' ? 'high' : 'medium',
            errorType: 'integration',
            errorName: 'MCP_SDK_CONNECTION',
            message: error instanceof Error ? error.message : String(error),
            stackTrace: error instanceof Error ? error.stack : undefined,
            metadata: { 
              serverId: server.id, 
              serverName: server.name,
              endpoint: server.endpointUrl,
              errorType: errorDetails.type,
              isRetryable: errorDetails.isRetryable
            }
          });
        } catch (logError) {
          console.warn(`[${new Date().toISOString()}] [MCP SDK] Failed to log error to database:`, logError);
        }
      }

      // Remove from cache if it was partially created
      await this.cleanupClient(server.id, conversationId);

      // Throw appropriate error based on type
      if (errorDetails.type === 'TIMEOUT') {
        throw new MCPTimeoutError(
          server.id,
          server.endpointUrl,
          errorDetails.message
        );
      } else if (errorDetails.type === 'AUTH') {
        throw new MCPError(
          `Authentication failed for server ${server.name}: ${errorDetails.message}`,
          -32001,
          server.id
        );
      } else {
        throw new MCPConnectionError(
          server.id,
          server.endpointUrl,
          error instanceof Error ? error : new Error(String(error))
        );
      }
    }
  }

  /**
   * Clean up and disconnect a client
   * Phase 5: Enhanced with SDK session termination
   * Used for error recovery and shutdown
   */
  private async cleanupClient(serverId: string, conversationId?: string): Promise<void> {
    const clientKey = conversationId ? `${serverId}_${conversationId}` : serverId;
    const metadata = this.mcpClients.get(clientKey); // Phase 9: Get metadata instead of client directly
    
    if (metadata) {
      try {
        // Phase 5: Try to properly terminate SDK session before closing
        const transport = metadata.client.transport as StreamableHTTPClientTransport;
        if (transport && typeof transport.terminateSession === 'function') {
          try {
            await transport.terminateSession();
            console.log(`[${new Date().toISOString()}] [MCP SDK] Session terminated for server:`, {
              serverId,
              clientKey
            });
          } catch (sessionError) {
            console.warn(`[${new Date().toISOString()}] [MCP SDK] Could not terminate session (server may not support it):`, {
              serverId,
              error: sessionError instanceof Error ? sessionError.message : String(sessionError)
            });
          }
        }
        
        await metadata.client.close();
        console.log(`[${new Date().toISOString()}] [MCP SDK] Client closed for server:`, {
          serverId,
          clientKey
        });
      } catch (error) {
        console.warn(`[${new Date().toISOString()}] [MCP SDK] Error closing client:`, {
          serverId,
          clientKey,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      this.mcpClients.delete(clientKey);
    }
    
    // Phase 11.6: Only clean up legacy session cache for SDK-based servers
    // Don't clean up sessions for simple auth servers as they use legacy sessions exclusively
    const sessionKey = conversationId ? `${serverId}_${conversationId}` : serverId;
    const sessionContext = this.sessionCache.get(sessionKey);
    
    // Check if this is a simple auth server by looking up the server configuration
    let isSimpleAuthServer = false;
    try {
      const mcpServerModel = new MCPServerModel(pool);
      const server = await mcpServerModel.getWithDecryptedCredentials(serverId);
      isSimpleAuthServer = server?.auth_type === 'simple_auth';
    } catch (error) {
      console.warn(`[${new Date().toISOString()}] [MCP SDK] Could not determine server auth type for cleanup:`, error);
    }
    
    if (this.sessionCache.has(sessionKey) && !isSimpleAuthServer) {
      this.sessionCache.delete(sessionKey);
      console.log(`[${new Date().toISOString()}] [MCP SDK] Legacy session cache cleaned for SDK server:`, {
        serverId,
        sessionKey
      });
    } else if (this.sessionCache.has(sessionKey) && isSimpleAuthServer) {
      console.log(`[${new Date().toISOString()}] [MCP SDK] Preserving session cache for simple auth server:`, {
        serverId,
        sessionKey,
        sessionId: sessionContext?.sessionId ? sessionContext.sessionId.substring(0, 8) + '...' : null
      });
    }
  }

  /**
   * Create authentication headers based on server configuration
   */
  private createAuthHeaders(server: MCPServerConnection): Record<string, string> {
    const headers: Record<string, string> = {};
    
    console.log(`[${new Date().toISOString()}] [MCP Auth Debug] Creating auth headers for server:`, {
      serverId: server.id,
      serverName: server.name,
      authType: server.auth_type,
      hasUsername: !!server.username,
      hasSecret: !!server.secret,
      secretLength: server.secret?.length || 0
    });
    
    switch (server.auth_type) {
      case 'api_key':
        if (server.secret) {
          headers['X-API-Key'] = server.secret;
          console.log(`[${new Date().toISOString()}] [MCP Auth Debug] Added API key header:`, {
            serverId: server.id,
            keyLength: server.secret.length,
            keyPreview: server.secret.substring(0, 10) + '...'
          });
        } else {
          console.warn(`[${new Date().toISOString()}] [MCP Auth Debug] API key auth configured but no secret provided for server ${server.name}`);
        }
        break;
      case 'bearer_token':
        if (server.secret) {
          headers['Authorization'] = `Bearer ${server.secret}`;
          console.log(`[${new Date().toISOString()}] [MCP Auth Debug] Added Bearer token header:`, {
            serverId: server.id,
            tokenLength: server.secret.length,
            tokenPreview: server.secret.substring(0, 10) + '...'
          });
        } else {
          console.warn(`[${new Date().toISOString()}] [MCP Auth Debug] Bearer token auth configured but no secret provided for server ${server.name}`);
        }
        break;
      case 'basic_auth':
        if (server.username && server.secret) {
          const credentials = Buffer.from(`${server.username}:${server.secret}`).toString('base64');
          headers['Authorization'] = `Basic ${credentials}`;
          console.log(`[${new Date().toISOString()}] [MCP Auth Debug] Added Basic auth header:`, {
            serverId: server.id,
            username: server.username,
            passwordLength: server.secret.length,
            credentialsLength: credentials.length,
            credentialsPreview: credentials.substring(0, 20) + '...'
          });
        } else {
          console.warn(`[${new Date().toISOString()}] [MCP Auth Debug] Basic auth configured but missing username or password for server ${server.name}:`, {
            hasUsername: !!server.username,
            hasPassword: !!server.secret
          });
        }
        break;
      case 'simple_auth':
        // Simple auth uses session-based headers after authentication
        // No basic auth headers needed here
        console.log(`[${new Date().toISOString()}] [MCP Auth Debug] Simple auth configured - will use session-based authentication for server ${server.name}`);
        break;
      case 'none':
      default:
        console.log(`[${new Date().toISOString()}] [MCP Auth Debug] No authentication configured for server ${server.name}`);
        break;
    }
    
    console.log(`[${new Date().toISOString()}] [MCP Auth Debug] Final auth headers for server ${server.name}:`, {
      serverId: server.id,
      headerCount: Object.keys(headers).length,
      headerKeys: Object.keys(headers),
      hasAuth: Object.keys(headers).some(key => key.toLowerCase().includes('authorization') || key.toLowerCase().includes('api'))
    });
    
    return headers;
  }

  /**
   * Perform Simple Authentication challenge-response flow
   */
  private async performSimpleAuth(server: MCPServerConnection, conversationId?: string): Promise<string | null> {
    if (!server.username || !server.secret) {
      console.error(`[${new Date().toISOString()}] [MCP Simple Auth] Missing username or password for server ${server.name}`);
      return null;
    }

    const requestId = this.generateRequestId();
    
    console.log(`[${new Date().toISOString()}] [MCP Simple Auth] Starting authentication flow for server:`, {
      serverId: server.id,
      serverName: server.name,
      endpoint: server.endpointUrl,
      username: server.username,
      requestId
    });

    try {
      // Step 1: Send initial request to get challenge
      const initRequest: MCPRequest = {
        jsonrpc: '2.0',
        id: requestId,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: { tools: {} },
          clientInfo: {
            name: 'ContextFlow-AI',
            version: '1.0.0'
          }
        }
      };

      const requestHeaders = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'User-Agent': 'ContextFlow-AI/1.0'
        // Protocol version handled by SDK
      };

      const requestBody = JSON.stringify(initRequest);

      console.log(`[${new Date().toISOString()}] [MCP Simple Auth] SENDING CHALLENGE REQUEST:`, {
        serverId: server.id,
        endpoint: server.endpointUrl,
        method: 'POST',
        headers: requestHeaders,
        body: requestBody,
        bodyLength: requestBody.length
      });

      const response = await fetch(server.endpointUrl, {
        method: 'POST',
        headers: requestHeaders,
        body: requestBody,
        signal: AbortSignal.timeout(server.timeoutSeconds * 1000)
      });

      console.log(`[${new Date().toISOString()}] [MCP Simple Auth] RECEIVED CHALLENGE RESPONSE:`, {
        serverId: server.id,
        statusCode: response.status,
        statusText: response.statusText,
        responseHeaders: {}  // Simplified for compatibility
      });

      if (response.status !== 401) {
        console.error(`[${new Date().toISOString()}] [MCP Simple Auth] Expected 401 status for challenge, got ${response.status}`);
        return null;
      }

      // Step 2: Parse challenge from 401 response
      const challengeText = await response.text();
      
      console.log(`[${new Date().toISOString()}] [MCP Simple Auth] RAW CHALLENGE RESPONSE BODY:`, {
        serverId: server.id,
        responseBody: challengeText,
        responseLength: challengeText.length
      });
      
      let challengeResponse: any;
      
      try {
        challengeResponse = JSON.parse(challengeText);
        console.log(`[${new Date().toISOString()}] [MCP Simple Auth] PARSED CHALLENGE RESPONSE:`, {
          serverId: server.id,
          parsedResponse: challengeResponse
        });
      } catch (parseError) {
        console.error(`[${new Date().toISOString()}] [MCP Simple Auth] Failed to parse challenge response:`, parseError);
        return null;
      }

      if (!challengeResponse.error || 
          challengeResponse.error.code !== -32001 ||
          challengeResponse.error.data?.method !== 'auth-challenge') {
        console.error(`[${new Date().toISOString()}] [MCP Simple Auth] Invalid challenge response format:`, challengeResponse);
        return null;
      }

      const challengeKey = challengeResponse.error.data.params?.key;
      const challengeId = challengeResponse.error.data.params?.challenge_id || challengeResponse.error.data.params?.id;

      console.log(`[${new Date().toISOString()}] [MCP Simple Auth] Challenge params received:`, {
        serverId: server.id,
        params: challengeResponse.error.data.params,
        hasKey: !!challengeResponse.error.data.params?.key,
        hasChallengeId: !!challengeResponse.error.data.params?.challenge_id,
        hasId: !!challengeResponse.error.data.params?.id
      });

      // Add this validation block
      if (!challengeId) {
        console.error(`[${new Date().toISOString()}] [MCP Simple Auth] No challenge ID found in response`);
        // You could throw an error here or return null to stop the flow
        return null;
      }

      if (!challengeKey) {
        console.error(`[${new Date().toISOString()}] [MCP Simple Auth] No challenge key in response`);
        return null;
      }

      console.log(`[${new Date().toISOString()}] [MCP Simple Auth] Received challenge:`, {
        serverId: server.id,
        challengeId,
        challengeKeyPreview: challengeKey.substring(0, 10) + '...'
      });

      // Step 3: Calculate response hash using md5(challenge_key + md5(password))
      const passwordHash = createHash('md5').update(server.secret).digest('hex');
      const responseHash = createHash('md5').update(challengeKey + passwordHash).digest('hex');

      console.log(`[${new Date().toISOString()}] [MCP Simple Auth] Calculated hashes:`, {
        serverId: server.id,
        passwordHashPreview: passwordHash.substring(0, 8) + '...',
        responseHashPreview: responseHash.substring(0, 8) + '...',
        challengeKeyUsed: challengeKey.substring(0, 10) + '...',
        hashCalculation: `md5("${challengeKey.substring(0, 10)}..." + "${passwordHash.substring(0, 8)}...") = "${responseHash.substring(0, 8)}..."`
      });

      // Step 4: Send authentication request
      const authRequest: MCPRequest = {
        jsonrpc: '2.0',
        id: this.generateRequestId(),
        method: 'auth',
        params: {
          username: server.username,
          hashed_response: responseHash,
          challenge_id: challengeId
        }
      };

      const authRequestHeaders = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'ContextFlow-AI/1.0',
        // Protocol version handled by SDK
      };

      const authRequestBody = JSON.stringify(authRequest);

      console.log(`[${new Date().toISOString()}] [MCP Simple Auth] SENDING AUTHENTICATION REQUEST:`, {
        serverId: server.id,
        endpoint: server.endpointUrl,
        method: 'POST',
        headers: authRequestHeaders,
        body: authRequestBody,
        bodyLength: authRequestBody.length,
        authData: {
          username: server.username,
          challenge_id: challengeId,
          hashed_response_preview: responseHash.substring(0, 8) + '...'
        }
      });

      const authResponse = await fetch(server.endpointUrl, {
        method: 'POST',
        headers: authRequestHeaders,
        body: authRequestBody,
        signal: AbortSignal.timeout(server.timeoutSeconds * 1000)
      });

      console.log(`[${new Date().toISOString()}] [MCP Simple Auth] RECEIVED AUTHENTICATION RESPONSE:`, {
        serverId: server.id,
        statusCode: authResponse.status,
        statusText: authResponse.statusText,
        responseHeaders: {}  // Simplified for compatibility
      });

      // Step 5: Parse authentication response to get session key
      const authText = await authResponse.text();
      
      console.log(`[${new Date().toISOString()}] [MCP Simple Auth] RAW AUTHENTICATION RESPONSE BODY:`, {
        serverId: server.id,
        responseBody: authText,
        responseLength: authText.length
      });
      
      if (!authResponse.ok) {
        console.error(`[${new Date().toISOString()}] [MCP Simple Auth] Authentication failed with HTTP ${authResponse.status}:`, {
          serverId: server.id,
          statusCode: authResponse.status,
          statusText: authResponse.statusText,
          responseBody: authText
        });
        return null;
      }

      let authResult: any;
      
      try {
        authResult = JSON.parse(authText);
        console.log(`[${new Date().toISOString()}] [MCP Simple Auth] PARSED AUTHENTICATION RESPONSE:`, {
          serverId: server.id,
          parsedResponse: authResult
        });
      } catch (parseError) {
        console.error(`[${new Date().toISOString()}] [MCP Simple Auth] Failed to parse auth response:`, parseError);
        return null;
      }

      if (authResult.error) {
        console.error(`[${new Date().toISOString()}] [MCP Simple Auth] Authentication error:`, authResult.error);
        return null;
      }

      const sessionKey = authResult.result?.params?.session_key;
      if (!sessionKey) {
        console.error(`[${new Date().toISOString()}] [MCP Simple Auth] No session key in authentication response`);
        return null;
      }

      console.log(`[${new Date().toISOString()}] [MCP Simple Auth] Authentication successful:`, {
        serverId: server.id,
        sessionKeyPreview: sessionKey.substring(0, 10) + '...'
      });

      // Step 6: Send second initialization request with session ID to establish connection
      console.log(`[${new Date().toISOString()}] [MCP Simple Auth] Sending second initialization request with session ID:`, {
        serverId: server.id,
        sessionId: sessionKey.substring(0, 10) + '...'
      });

      const secondInitRequest: MCPRequest = {
        jsonrpc: '2.0',
        id: this.generateRequestId(),
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: { tools: {} },
          clientInfo: {
            name: 'ContextFlow-AI',
            version: '1.0.0'
          }
        }
      };

      const secondInitHeaders = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'User-Agent': 'ContextFlow-AI/1.0',
        // Protocol version handled by SDK,
        'Mcp-Session-Id': sessionKey // Include the session ID in the header
      };

      const secondInitBody = JSON.stringify(secondInitRequest);

      console.log(`[${new Date().toISOString()}] [MCP Simple Auth] SENDING SECOND INIT REQUEST:`, {
        serverId: server.id,
        endpoint: server.endpointUrl,
        method: 'POST',
        headers: secondInitHeaders,
        body: secondInitBody,
        bodyLength: secondInitBody.length
      });

      const secondInitResponse = await fetch(server.endpointUrl, {
        method: 'POST',
        headers: secondInitHeaders,
        body: secondInitBody,
        signal: AbortSignal.timeout(server.timeoutSeconds * 1000)
      });

      console.log(`[${new Date().toISOString()}] [MCP Simple Auth] RECEIVED SECOND INIT RESPONSE:`, {
        serverId: server.id,
        statusCode: secondInitResponse.status,
        statusText: secondInitResponse.statusText,
        responseHeaders: {}  // Simplified for compatibility
      });

      const secondInitText = await secondInitResponse.text();
      
      console.log(`[${new Date().toISOString()}] [MCP Simple Auth] RAW SECOND INIT RESPONSE BODY:`, {
        serverId: server.id,
        responseBody: secondInitText,
        responseLength: secondInitText.length
      });

      if (!secondInitResponse.ok) {
        console.error(`[${new Date().toISOString()}] [MCP Simple Auth] Second initialization failed with HTTP ${secondInitResponse.status}:`, {
          serverId: server.id,
          statusCode: secondInitResponse.status,
          statusText: secondInitResponse.statusText,
          responseBody: secondInitText
        });
        return null;
      }

      let secondInitResult: any;
      
      try {
        secondInitResult = this.parseSSEResponse(secondInitText);
        console.log(`[${new Date().toISOString()}] [MCP Simple Auth] PARSED SECOND INIT RESPONSE:`, {
          serverId: server.id,
          parsedResponse: secondInitResult
        });
      } catch (parseError) {
        console.error(`[${new Date().toISOString()}] [MCP Simple Auth] Failed to parse second init response:`, parseError);
        return null;
      }

      if (secondInitResult.error) {
        console.error(`[${new Date().toISOString()}] [MCP Simple Auth] Second initialization error:`, secondInitResult.error);
        return null;
      }

      // Step 7: Cache the session with actual server info from second init
      const sessionContext: MCPSessionContext = {
        serverId: server.id,
        sessionId: sessionKey,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + this.SESSION_TTL_MS),
        protocolVersion: secondInitResult.result?.protocolVersion || '2025-03-26',
        serverInfo: secondInitResult.result?.serverInfo || {
          name: server.name,
          version: 'unknown',
          protocolVersion: '2025-03-26',
          capabilities: {}
        }
      };

      const sessionCacheKey = conversationId ? `${server.id}_${conversationId}` : server.id;
      this.sessionCache.set(sessionCacheKey, sessionContext);

      console.log(`[${new Date().toISOString()}] [MCP Simple Auth] Session fully established:`, {
        serverId: server.id,
        sessionId: sessionKey.substring(0, 10) + '...',
        serverName: sessionContext.serverInfo?.name,
        serverVersion: sessionContext.serverInfo?.version,
        protocolVersion: sessionContext.protocolVersion
      });

      return sessionKey;

    } catch (error) {
      console.error(`[${new Date().toISOString()}] [MCP Simple Auth] Authentication failed:`, {
        serverId: server.id,
        serverName: server.name,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Initialize MCP session for servers that require it
   */
  async initializeSession(server: MCPServerConnection, conversationId?: string): Promise<MCPSessionContext | null> {
    const requestId = this.generateRequestId();
    
    console.log(`[${new Date().toISOString()}] [MCP Session Debug] Initializing session for server:`, {
      serverId: server.id,
      serverName: server.name,
      endpoint: server.endpointUrl,
      authType: server.auth_type,
      requestId
    });

    // Handle Simple Authentication separately
    if (server.auth_type === 'simple_auth') {
      console.log(`[${new Date().toISOString()}] [MCP Session Debug] Using Simple Authentication for server ${server.name}`);
      const sessionKey = await this.performSimpleAuth(server, conversationId);
      if (sessionKey) {
        const sessionCacheKey = conversationId ? `${server.id}_${conversationId}` : server.id;
        return this.sessionCache.get(sessionCacheKey) || null;
      }
      return null;
    }

    try {
      const initRequest = {
        jsonrpc: '2.0',
        id: requestId,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {
            tools: {}
          },
          clientInfo: {
            name: 'ContextFlow-AI',
            version: '1.0.0'
          }
        }
      } as MCPRequest;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), server.timeoutSeconds * 1000);
      const startTime = Date.now();

      try {
        const authHeaders = this.createAuthHeaders(server);
        const requestHeaders = {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'User-Agent': 'ContextFlow-AI/1.0',
          // Protocol version handled by SDK,
          ...authHeaders
        };
        
        console.log(`[${new Date().toISOString()}] [MCP Session Debug] Sending initialize request:`, {
          serverId: server.id,
          serverName: server.name,
          endpoint: server.endpointUrl,
          requestId,
          authType: server.auth_type,
          headers: {
            'Content-Type': requestHeaders['Content-Type'],
            'Accept': requestHeaders['Accept'],
            'User-Agent': requestHeaders['User-Agent'],
            'Authorization': requestHeaders['Authorization'] ? '***' + requestHeaders['Authorization'].substring(requestHeaders['Authorization'].length - 5) : 'None',
            'X-API-Key': requestHeaders['X-API-Key'] ? '***' + requestHeaders['X-API-Key'].substring(requestHeaders['X-API-Key'].length - 5) : 'None'
          },
          requestBody: initRequest
        });

        const response = await fetch(server.endpointUrl, {
          method: 'POST',
          headers: requestHeaders,
          body: JSON.stringify(initRequest),
          signal: controller.signal
        });

        const responseTime = Date.now() - startTime;
        clearTimeout(timeoutId);

        console.log(`[${new Date().toISOString()}] [MCP Session Debug] Initialize response received:`, {
          serverId: server.id,
          requestId,
          statusCode: response.status,
          responseTimeMs: responseTime,
          contentType: response.headers.get('content-type'),
          hasSessionId: !!response.headers.get('mcp-session-id')
        });

        if (!response.ok) {
          // Try to parse error response for more details
          try {
            const errorText = await response.text();
            const errorResponse = JSON.parse(errorText);
            
            console.error(`[${new Date().toISOString()}] [MCP Session Debug] Initialize failed with error:`, {
              serverId: server.id,
              requestId,
              statusCode: response.status,
              statusText: response.statusText,
              errorCode: errorResponse?.error?.code,
              errorMessage: errorResponse?.error?.message
            });
            
            // Mark server as requiring sessions if we get a session error
            if (errorResponse?.error?.code === -32000 && 
                errorResponse?.error?.message?.toLowerCase().includes('session')) {
              server.requiresSession = true;
            }
          } catch (parseError) {
            console.error(`[${new Date().toISOString()}] [MCP Session Debug] Initialize failed with HTTP error:`, {
              serverId: server.id,
              requestId,
              statusCode: response.status,
              statusText: response.statusText
            });
          }
          return null;
        }

        // Extract session ID from headers
        const sessionId = response.headers.get('mcp-session-id');
        
        // Parse response - handle both JSON and Server-Sent Events
        const responseText = await response.text();
        let initResponse: MCPResponse<MCPInitializeResponse>;

        if (response.headers.get('content-type')?.includes('text/event-stream')) {
          // Parse Server-Sent Events format
          const lines = responseText.split('\n');
          const dataLine = lines.find(line => line.startsWith('data: '));
          if (!dataLine) {
            throw new Error('No data in Server-Sent Events response');
          }
          initResponse = JSON.parse(dataLine.substring(6));
        } else {
          // Parse regular JSON
          initResponse = JSON.parse(responseText);
        }

        console.log(`[${new Date().toISOString()}] [MCP Session Debug] Initialize response parsed:`, {
          serverId: server.id,
          requestId,
          sessionId,
          hasResult: !!initResponse.result,
          hasError: !!(initResponse as any).error,
          serverName: initResponse.result?.serverInfo?.name
        });

        if ((initResponse as any).error) {
          console.error(`[${new Date().toISOString()}] [MCP Session Debug] Server returned initialization error:`, {
            serverId: server.id,
            requestId,
            errorCode: (initResponse as any).error.code,
            errorMessage: (initResponse as any).error.message
          });
          return null;
        }

        if (!initResponse.result) {
          console.error(`[${new Date().toISOString()}] [MCP Session Debug] No result in initialization response:`, {
            serverId: server.id,
            requestId
          });
          return null;
        }

        // Create session context
        const sessionContext: MCPSessionContext = {
          serverId: server.id,
          sessionId: sessionId || `fallback_${requestId}`,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + this.SESSION_TTL_MS),
          protocolVersion: initResponse.result.protocolVersion,
          serverInfo: { 
            name: (initResponse.result.serverInfo as any)?.name || server.name,
            version: (initResponse.result.serverInfo as any)?.version || 'unknown',
            protocolVersion: initResponse.result.protocolVersion,
            capabilities: (initResponse.result.serverInfo as any)?.capabilities || {}
          }
        };

        // Cache the session with conversation scope
        const sessionKey = conversationId ? `${server.id}_${conversationId}` : server.id;
        this.sessionCache.set(sessionKey, sessionContext);

        console.log(`[${new Date().toISOString()}] [MCP Session Debug] Session initialized successfully:`, {
          serverId: server.id,
          sessionId: sessionContext.sessionId,
          protocolVersion: sessionContext.protocolVersion,
          serverName: sessionContext.serverInfo?.name,
          expiresAt: sessionContext.expiresAt
        });

        return sessionContext;

      } catch (error) {
        clearTimeout(timeoutId);
        
        if (error instanceof DOMException && error.name === 'AbortError') {
          console.error(`[${new Date().toISOString()}] [MCP Session Debug] Session initialization timeout:`, {
            serverId: server.id,
            requestId,
            timeoutMs: server.timeoutSeconds * 1000
          });
          throw new MCPTimeoutError(server.id, server.endpointUrl, `${server.timeoutSeconds * 1000}`);
        }
        
        throw error;
      }

    } catch (error) {
      console.error(`[${new Date().toISOString()}] [MCP Session Debug] Session initialization failed:`, {
        serverId: server.id,
        serverName: server.name,
        requestId,
        errorType: error.constructor.name,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      
      // Log to error logging service
      await ErrorLoggingService.getInstance().logError({
        severity: 'medium',
        errorType: 'mcp_integration',
        errorName: error instanceof Error ? error.name : 'MCPSessionInitializationError',
        message: `Failed to initialize MCP session for server ${server.name}: ${error instanceof Error ? error.message : String(error)}`,
        stackTrace: error instanceof Error ? error.stack : undefined,
        metadata: {
          serverId: server.id,
          serverName: server.name,
          endpoint: server.endpointUrl,
          requestId,
          operation: 'session_initialization'
        }
      });
      
      return null;
    }
  }

  /**
   * Get session for server (with automatic initialization if needed)
   */
  async ensureSession(server: MCPServerConnection, conversationId?: string): Promise<string | null> {
    const sessionKey = conversationId ? `${server.id}_${conversationId}` : server.id;
    
    console.log(`[${new Date().toISOString()}] [MCP Session Debug] Ensuring session:`, {
      serverId: server.id,
      serverName: server.name,
      conversationId,
      sessionKey,
      cacheSize: this.sessionCache.size,
      existingKeys: Array.from(this.sessionCache.keys())
    });
    
    // Check if session already exists and is valid
    const existingSession = this.sessionCache.get(sessionKey);
    if (existingSession && existingSession.expiresAt && existingSession.expiresAt > new Date()) {
      console.log(`[${new Date().toISOString()}] [MCP Session Debug] Using cached session:`, {
        serverId: server.id,
        conversationId,
        sessionKey,
        sessionId: existingSession.sessionId.substring(0, 8) + '...',
        expiresAt: existingSession.expiresAt
      });
      return existingSession.sessionId;
    }

    console.log(`[${new Date().toISOString()}] [MCP Session Debug] No valid cached session, initializing new session`);
    // Initialize new session
    const sessionContext = await this.initializeSession(server, conversationId);
    console.log(`[${new Date().toISOString()}] [MCP Session Debug] Session initialization result:`, {
      serverId: server.id,
      success: !!sessionContext?.sessionId,
      sessionId: sessionContext?.sessionId ? sessionContext.sessionId.substring(0, 8) + '...' : null
    });
    return sessionContext?.sessionId || null;
  }

  /**
   * Clear session cache for a specific server and conversation
   * Phase 5: Enhanced to also clean up SDK clients
   */
  async clearSession(serverId: string, conversationId?: string): Promise<void> {
    const sessionKey = conversationId ? `${serverId}_${conversationId}` : serverId;
    const hadSession = this.sessionCache.has(sessionKey);
    
    // Phase 5: Clean up SDK client which will also handle session termination
    await this.cleanupClient(serverId, conversationId);
    
    console.log(`[${new Date().toISOString()}] [MCP Session Debug] Session cleared:`, {
      serverId,
      conversationId,
      sessionKey,
      hadSession,
      clearedSDKClient: true
    });
  }

  /**
   * Phase 5: Get SDK client session ID for external use
   * Provides compatibility bridge between SDK and legacy session handling
   */
  getSDKSessionId(serverId: string, conversationId?: string): string | null {
    const clientKey = conversationId ? `${serverId}_${conversationId}` : serverId;
    const metadata = this.mcpClients.get(clientKey); // Phase 9: Get metadata instead
    
    if (metadata && metadata.client.transport) {
      const transport = metadata.client.transport as StreamableHTTPClientTransport;
      return transport.sessionId || null;
    }
    
    // Fallback to legacy cache
    const sessionKey = conversationId ? `${serverId}_${conversationId}` : serverId;
    const legacySession = this.sessionCache.get(sessionKey);
    return legacySession?.sessionId || null;
  }

  /**
   * Phase 5: Synchronize SDK session state with legacy cache
   * Preserves application-level caching while migrating to SDK
   */
  syncSDKSessionToCache(serverId: string, conversationId?: string): void {
    const clientKey = conversationId ? `${serverId}_${conversationId}` : serverId;
    const client = this.mcpClients.get(clientKey);
    
    if (client && (client.client as any).transport) {
      const transport = (client.client as any).transport as StreamableHTTPClientTransport;
      const sessionId = (transport as any).sessionId;
      
      if (sessionId) {
        const sessionKey = conversationId ? `${serverId}_${conversationId}` : serverId;
        const existingSession = this.sessionCache.get(sessionKey);
        
        // Update or create session context
        const sessionContext: MCPSessionContext = {
          serverId,
          sessionId,
          serverInfo: existingSession?.serverInfo || {
            name: serverId,
            version: '1.0.0',
            capabilities: {}
          },
          protocolVersion: transport.protocolVersion || '2024-11-05',
          createdAt: existingSession?.createdAt || new Date(),
          expiresAt: new Date(Date.now() + this.SESSION_TTL_MS)
        };
        
        this.sessionCache.set(sessionKey, sessionContext);
        
        console.log(`[${new Date().toISOString()}] [MCP SDK] Session synced to cache:`, {
          serverId,
          sessionKey,
          sessionId: sessionId.substring(0, 8) + '...',
          isUpdate: !!existingSession
        });
      }
    }
  }

  /**
   * Check if server requires session management by testing direct vs session communication
   */
  async detectSessionRequirement(server: MCPServerConnection): Promise<boolean> {
    const requestId = this.generateRequestId();
    
    console.log(`[${new Date().toISOString()}] [MCP Session Debug] Detecting session requirement:`, {
      serverId: server.id,
      serverName: server.name,
      authType: server.auth_type,
      requestId
    });

    // Simple auth servers always require sessions
    if (server.auth_type === 'simple_auth') {
      console.log(`[${new Date().toISOString()}] [MCP Session Debug] Simple auth server requires sessions by definition`);
      return true;
    }

    try {
      // Try direct tools/list request without session
      const directRequest: MCPRequest = {
        jsonrpc: '2.0',
        id: requestId,
        method: 'tools/list',
        params: {}
      };

      const response = await fetch(server.endpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'User-Agent': 'ContextFlow-AI/1.0',
          // Protocol version handled by SDK
          ...this.createAuthHeaders(server)
        },
        body: JSON.stringify(directRequest),
        signal: AbortSignal.timeout(server.timeoutSeconds * 1000)
      });

      // Parse response regardless of status code (400 might contain session error)
      const responseText = await response.text();
      let mcpResponse: MCPResponse;
      
      console.log(`[${new Date().toISOString()}] [MCP Session Debug] Received response for session detection:`, {
        serverId: server.id,
        requestId,
        statusCode: response.status,
        statusText: response.statusText,
        responseLength: responseText.length,
        responseText: responseText.substring(0, 500)
      });
      
      // Special handling for 400 Bad Request - often indicates session requirement
      if (response.status === 400) {
        console.log(`[${new Date().toISOString()}] [MCP Session Debug] 400 Bad Request indicates session required`);
        return true;
      }
      
      try {
        mcpResponse = JSON.parse(responseText) as MCPResponse;
      } catch (parseError) {
        console.log(`[${new Date().toISOString()}] [MCP Session Debug] Could not parse response:`, {
          serverId: server.id,
          requestId,
          statusCode: response.status,
          responseText: responseText.substring(0, 200),
          parseError: parseError instanceof Error ? parseError.message : String(parseError)
        });
        // If we can't parse the response, assume session is required
        return true;
      }
      
      // If we get a valid response without error, server doesn't require sessions
      if (response.ok && !mcpResponse.error) {
        console.log(`[${new Date().toISOString()}] [MCP Session Debug] Server supports direct communication:`, {
          serverId: server.id,
          requestId
        });
        return false;
      }
      
      // Check for session-related error codes (regardless of HTTP status)
      if (mcpResponse.error && (
        mcpResponse.error.code === -32000 ||
        mcpResponse.error.message?.toLowerCase().includes('session') ||
        mcpResponse.error.message?.toLowerCase().includes('initialize')
      )) {
        console.log(`[${new Date().toISOString()}] [MCP Session Debug] Server requires session management:`, {
          serverId: server.id,
          requestId,
          errorCode: mcpResponse.error.code,
          errorMessage: mcpResponse.error.message,
          httpStatus: response.status
        });
        return true;
      }
      
      // If we get another type of error, still assume no session required
      if (mcpResponse.error) {
        console.log(`[${new Date().toISOString()}] [MCP Session Debug] Server returned non-session error:`, {
          serverId: server.id,
          requestId,
          errorCode: mcpResponse.error.code,
          errorMessage: mcpResponse.error.message
        });
        return false;
      }

    } catch (error) {
      console.log(`[${new Date().toISOString()}] [MCP Session Debug] Session detection test failed:`, {
        serverId: server.id,
        requestId,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    // Default to trying session management if detection is unclear
    return true;
  }

  /**
   * Get all MCP tools available for a specific agent
   */
  async getAgentMCPTools(agentId: string, conversationId?: string, userId?: string): Promise<MCPTool[]> {
    try {
      // Get MCP servers associated with the agent
      const mcpServers = await this.getAgentMCPServers(agentId);
      
      if (mcpServers.length === 0) {
        return [];
      }

      console.log(`[${new Date().toISOString()}] [MCP Server Debug] Starting tool fetch for agent ${agentId}:`, {
        agentId,
        serverCount: mcpServers.length,
        servers: mcpServers.map(s => ({
          id: s.id,
          name: s.name,
          endpoint: s.endpointUrl,
          healthStatus: s.healthStatus,
          timeoutSeconds: s.timeoutSeconds
        }))
      });

      // Fetch tools from all servers in parallel
      const toolPromises = mcpServers.map(server => 
        this.getMCPServerTools(server, conversationId).catch(async (error) => {
          console.error(`[${new Date().toISOString()}] [MCP Server Debug] Failed to fetch tools from server ${server.name}:`, {
            serverId: server.id,
            serverName: server.name,
            endpoint: server.endpointUrl,
            errorType: error.constructor.name,
            errorMessage: error instanceof Error ? error.message : String(error),
            errorStack: error instanceof Error ? error.stack : undefined
          });
          
          // Log to error logging service
          await ErrorLoggingService.getInstance().logError({
            severity: 'medium',
            errorType: 'mcp_integration',
            errorName: error instanceof Error ? error.name : 'MCPToolFetchError',
            message: `Failed to fetch tools from MCP server ${server.name}: ${error instanceof Error ? error.message : String(error)}`,
            stackTrace: error instanceof Error ? error.stack : undefined,
            metadata: {
              serverId: server.id,
              serverName: server.name,
              endpoint: server.endpointUrl,
              agentId,
              operation: 'tool_fetch'
            }
          });
          
          return []; // Return empty array on error to not block other servers
        })
      );

      const toolArrays = await Promise.all(toolPromises);
      const allToolInstances = toolArrays.flat();
      
      console.log(`[${new Date().toISOString()}] [MCP Server Debug] Tool fetch completed:`, {
        agentId,
        totalToolInstances: allToolInstances.length,
        toolsByServer: mcpServers.map(server => ({
          serverId: server.id,
          serverName: server.name,
          toolCount: toolArrays[mcpServers.indexOf(server)]?.length || 0,
          tools: toolArrays[mcpServers.indexOf(server)]?.map(t => t.toolName) || []
        }))
      });

      // Ensure sessions are established for servers that need them
      const serverSessionPromises = mcpServers.map(async (server) => {
        // Check if server might require session (undefined means we don't know yet)
        if (server.requiresSession === true || server.requiresSession === undefined) {
          console.log(`[${new Date().toISOString()}] [MCP Session Debug] Proactively establishing session for server:`, {
            serverId: server.id,
            serverName: server.name,
            requiresSession: server.requiresSession,
            conversationId
          });
          
          try {
            const sessionId = await this.ensureSession(server, conversationId);
            if (sessionId) {
              console.log(`[${new Date().toISOString()}] [MCP Session Debug] Session established successfully:`, {
                serverId: server.id,
                serverName: server.name,
                sessionIdPreview: sessionId.substring(0, 10) + '...'
              });
              // Update server's requiresSession flag if it was undefined
              if (server.requiresSession === undefined) {
                server.requiresSession = true;
              }
            }
          } catch (error) {
            console.warn(`[${new Date().toISOString()}] [MCP Session Debug] Failed to establish session:`, {
              serverId: server.id,
              serverName: server.name,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      });
      
      // Wait for all sessions to be established
      await Promise.all(serverSessionPromises);
      
      // Convert tool instances to LangChain MCPTool objects
      // Phase 2: Changed to async map to handle client creation
      const mcpToolPromises = allToolInstances.map(async toolInstance => {
        const server = this.findServerById(mcpServers, toolInstance.serverId);
        const sessionKey = conversationId ? `${server?.id}_${conversationId}` : server?.id;
        const sessionContext = server && sessionKey ? this.sessionCache.get(sessionKey) : undefined;
        
        console.log(`[${new Date().toISOString()}] [MCP Session Debug] Creating tool execution context:`, {
          toolName: toolInstance.toolName,
          serverId: toolInstance.serverId,
          serverName: server?.name,
          serverAuthType: server?.auth_type,
          conversationId,
          sessionKey,
          serverRequiresSession: server?.requiresSession,
          hasSessionContext: !!sessionContext,
          sessionId: sessionContext?.sessionId ? sessionContext.sessionId.substring(0, 8) + '...' : null,
          availableSessionKeys: Array.from(this.sessionCache.keys()),
          sessionContext: sessionContext ? {
            serverId: sessionContext.serverId,
            hasSessionId: !!sessionContext.sessionId,
            protocolVersion: sessionContext.protocolVersion,
            serverName: sessionContext.serverInfo?.name
          } : null
        });
        
        // Phase 2: Get or create SDK client for this server
        let mcpClient;
        try {
          if (server) {
            mcpClient = await this._getOrCreateMcpClient(server, conversationId);
          }
        } catch (clientError) {
          console.warn(`[${new Date().toISOString()}] [MCP SDK] Could not create client for tool execution, will fallback:`, {
            serverId: toolInstance.serverId,
            error: clientError instanceof Error ? clientError.message : String(clientError)
          });
        }
        
        const executionContext: MCPToolExecutionContext = {
          serverId: toolInstance.serverId,
          serverEndpoint: server?.endpointUrl || '',
          timeoutMs: (server?.timeoutSeconds || 30) * 1000,
          conversationId,
          userId,
          sessionId: sessionContext?.sessionId, // Deprecated with SDK
          requiresSession: server?.requiresSession, // Deprecated with SDK
          mcpClient // SDK client for tool execution
        };
        
        console.log(`[${new Date().toISOString()}] [MCP Server Debug] Creating MCPTool wrapper:`, {
          agentId,
          toolName: toolInstance.toolName,
          serverId: toolInstance.serverId,
          serverName: toolInstance.serverName,
          executionContext,
          toolDefinition: {
            name: toolInstance.definition.name,
            description: toolInstance.definition.description,
            inputSchemaKeys: Object.keys(toolInstance.definition.inputSchema?.properties || {})
          }
        });

        return new MCPTool(toolInstance.definition, executionContext);
      });
      
      // Phase 2: Wait for all tool creation promises
      const mcpTools = await Promise.all(mcpToolPromises);

      console.log(`[${new Date().toISOString()}] [MCP Server Debug] Successfully loaded MCP tools:`, {
        agentId,
        totalTools: mcpTools.length,
        serverCount: mcpServers.length,
        toolDetails: mcpTools.map(tool => ({
          name: tool.name,
          description: tool.description,
          metadata: tool.getMetadata()
        }))
      });
      
      return mcpTools;

    } catch (error) {
      console.error(`[${new Date().toISOString()}] Error getting MCP tools for agent ${agentId}:`, error);
      throw new CustomError(
        `Failed to load MCP tools for agent: ${error instanceof Error ? error.message : String(error)}`,
        500
      );
    }
  }

  /**
   * Get MCP servers associated with an agent
   */
  private async getAgentMCPServers(agentId: string): Promise<MCPServerConnection[]> {
    console.log(`[${new Date().toISOString()}] [MCP Debug] Looking up MCP servers for agent:`, {
      agentId,
      timestamp: new Date().toISOString()
    });

    // First, let's check if the agent exists
    const agentCheckQuery = `SELECT id, name FROM agents WHERE id = $1`;
    const agentCheck = await pool.query(agentCheckQuery, [agentId]);
    
    console.log(`[${new Date().toISOString()}] [MCP Debug] Agent existence check:`, {
      agentId,
      agentExists: agentCheck.rows.length > 0,
      agentData: agentCheck.rows[0] || null
    });

    // Check if any MCP servers exist at all
    const totalServersQuery = `SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE is_active = true) as active FROM mcp_servers`;
    const totalServers = await pool.query(totalServersQuery);
    
    console.log(`[${new Date().toISOString()}] [MCP Debug] System MCP servers overview:`, {
      totalServers: totalServers.rows[0]?.total || 0,
      activeServers: totalServers.rows[0]?.active || 0
    });

    // Check agent-server associations (regardless of server status)
    const associationsQuery = `
      SELECT 
        ams.agent_id,
        ams.mcp_server_id,
        ams.is_enabled,
        ms.name,
        ms.is_active,
        ms.health_status
      FROM agent_mcp_servers ams
      LEFT JOIN mcp_servers ms ON ms.id = ams.mcp_server_id
      WHERE ams.agent_id = $1
    `;
    
    const associations = await pool.query(associationsQuery, [agentId]);
    
    console.log(`[${new Date().toISOString()}] [MCP Debug] Agent MCP server associations:`, {
      agentId,
      totalAssociations: associations.rows.length,
      associations: associations.rows.map(row => ({
        serverId: row.mcp_server_id,
        serverName: row.name,
        associationEnabled: row.is_enabled,
        serverActive: row.is_active,
        serverHealth: row.health_status
      }))
    });

    const query = `
      SELECT 
        ms.id
      FROM mcp_servers ms
      INNER JOIN agent_mcp_servers ams ON ms.id = ams.mcp_server_id
      WHERE ams.agent_id = $1 
        AND ms.is_active = true 
        AND ams.is_enabled = true
      ORDER BY ms.name
    `;

    const result = await pool.query(query, [agentId]);
    
    console.log(`[${new Date().toISOString()}] [MCP Debug] Final filtered query result:`, {
      agentId,
      filteredServerCount: result.rows.length,
      serverIds: result.rows.map(row => row.id)
    });
    
    // Get servers with decrypted credentials using the model
    const servers: MCPServerConnection[] = [];
    for (const row of result.rows) {
      try {
        const mcpServerModel = new MCPServerModel(pool);
        const server = await mcpServerModel.getWithDecryptedCredentials(row.id);
        if (server) {
          console.log(`[${new Date().toISOString()}] [MCP Auth Debug] Loading server credentials:`, {
            serverId: server.id,
            serverName: server.name,
            authType: server.auth_type,
            hasUsername: !!server.username,
            hasSecret: !!server.secret,
            secretLength: server.secret?.length || 0,
            endpoint: server.endpoint_url,
            isActive: server.is_active
          });
          
          servers.push({
            id: server.id,
            name: server.name,
            endpointUrl: server.endpoint_url,
            timeoutSeconds: server.timeout_seconds,
            rateLimitPerMinute: server.rate_limit_per_minute,
            healthStatus: server.health_status,
            auth_type: server.auth_type || 'none',
            username: server.username,
            secret: server.secret,
            isActive: server.is_active,
            requiresSession: undefined // Will be detected when needed
          });
        } else {
          console.warn(`[${new Date().toISOString()}] [MCP Auth Debug] No server data returned for ID ${row.id}`);
        }
      } catch (error) {
        console.error(`[${new Date().toISOString()}] [MCP Auth Debug] Error getting decrypted credentials for server ${row.id}:`, {
          error: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined
        });
      }
    }
    
    return servers;
  }

  /**
   * Get tools from a specific MCP server (with caching)
   * Phase 2: Refactored to use SDK client instead of manual HTTP requests
   */
  async getMCPServerTools(server: MCPServerConnection, conversationId?: string): Promise<MCPToolInstance[]> {
    // Check cache first (preserved from original implementation)
    const cachedTools = this.getFromCache(server.id);
    if (cachedTools && cachedTools.expiresAt > new Date()) {
      return this.convertToToolInstances(server, cachedTools.tools);
    }

    // Phase 11.6: Check if this is a simple auth server that needs legacy implementation
    if (server.auth_type === 'simple_auth') {
      console.log(`[${new Date().toISOString()}] [MCP SDK] Simple auth server detected, using legacy implementation:`, {
        serverId: server.id,
        serverName: server.name,
        endpoint: server.endpointUrl,
        authType: server.auth_type,
        conversationId
      });
      
      try {
        // Use legacy fetchToolsFromServer for simple auth
        const tools = await this.fetchToolsFromServer(server, conversationId);
        
        // Phase 11.6: Verify session was established for tool execution
        const sessionKey = conversationId ? `${server.id}_${conversationId}` : server.id;
        const sessionContext = this.sessionCache.get(sessionKey);
        
        console.log(`[${new Date().toISOString()}] [MCP Legacy] Simple auth tools fetch completed:`, {
          serverId: server.id,
          serverName: server.name,
          toolCount: tools.length,
          sessionKey,
          hasSession: !!sessionContext,
          sessionId: sessionContext?.sessionId ? sessionContext.sessionId.substring(0, 8) + '...' : null,
          availableSessionKeys: Array.from(this.sessionCache.keys())
        });
        
        // Update cache
        this.updateCache(server.id, tools);
        
        return this.convertToToolInstances(server, tools);
      } catch (error) {
        console.error(`[${new Date().toISOString()}] [MCP Legacy] Failed to fetch tools from simple auth server:`, {
          serverId: server.id,
          serverName: server.name,
          error: error instanceof Error ? error.message : String(error)
        });
        
        // Return cached tools if available as fallback
        if (cachedTools) {
          console.log(`[${new Date().toISOString()}] [MCP Legacy] Using expired cache as fallback`);
          return this.convertToToolInstances(server, cachedTools.tools);
        }
        
        throw error;
      }
    }

    try {
      console.log(`[${new Date().toISOString()}] [MCP SDK] Fetching tools from server using SDK:`, {
        serverId: server.id,
        serverName: server.name,
        endpoint: server.endpointUrl,
        cacheStatus: 'miss or expired'
      });
      
      // Get or create SDK client
      const client = await this._getOrCreateMcpClient(server, conversationId);
      
      // Phase 8: Request tools list from server using SDK with proper types
      const toolsResponse: SDKListToolsResult = await client.request({
        method: 'tools/list',
        params: {}
      }, ListToolsResultSchema);
      
      // Phase 8: SDK tools are already in the correct format (Tool type)
      // No conversion needed - SDK Tool type is equivalent to MCPToolDefinition
      const tools: SDKTool[] = toolsResponse.tools;
      
      console.log(`[${new Date().toISOString()}] [MCP SDK] Tools fetched successfully:`, {
        serverId: server.id,
        serverName: server.name,
        toolCount: tools.length,
        tools: tools.map(t => ({
          name: t.name,
          description: t.description,
          inputSchemaType: typeof t.inputSchema
        }))
      });
      
      // Update cache (preserved from original implementation)
      this.updateCache(server.id, tools);
      
      return this.convertToToolInstances(server, tools);
      
    } catch (error) {
      // Phase 6: Enhanced error handling with categorization
      const errorDetails = this.categorizeSDKError(error);
      
      console.error(`[${new Date().toISOString()}] [MCP SDK] Failed to fetch tools from server:`, {
        serverId: server.id,
        serverName: server.name,
        endpoint: server.endpointUrl,
        errorType: errorDetails.type,
        errorMessage: errorDetails.message,
        errorCode: errorDetails.code,
        isRetryable: errorDetails.isRetryable,
        hasCachedFallback: !!cachedTools
      });
      
      // Log specific error types to error service
      if (errorDetails.type === 'CONNECTION' || errorDetails.type === 'TIMEOUT') {
        try {
          await ErrorLoggingService.getInstance().logError({
            severity: errorDetails.type === 'TIMEOUT' ? 'high' : 'medium',
            errorType: 'integration',
            errorName: 'MCP_TOOLS_FETCH',
            message: error instanceof Error ? error.message : String(error),
            stackTrace: error instanceof Error ? error.stack : undefined,
            metadata: {
              serverId: server.id,
              serverName: server.name,
              endpoint: server.endpointUrl,
              errorType: errorDetails.type,
              isRetryable: errorDetails.isRetryable,
              hasCachedFallback: !!cachedTools
            }
          });
        } catch (logError) {
          console.warn(`[${new Date().toISOString()}] [MCP SDK] Failed to log error to database:`, logError);
        }
      }
      
      // Try to clean up the client if there was an error
      await this.cleanupClient(server.id, conversationId);
      
      // Return cached tools if available, even if expired, as fallback (only for retryable errors)
      if (cachedTools && errorDetails.isRetryable) {
        console.log(`[${new Date().toISOString()}] [MCP SDK] Using expired cache as fallback for retryable error:`, {
          serverId: server.id,
          serverName: server.name,
          cachedToolCount: cachedTools.tools.length,
          cacheAge: Date.now() - cachedTools.cachedAt.getTime(),
          errorType: errorDetails.type
        });
        return this.convertToToolInstances(server, cachedTools.tools);
      }
      
      // Throw appropriate error based on type
      if (errorDetails.type === 'TIMEOUT') {
        throw new MCPTimeoutError(server.id, server.endpointUrl, errorDetails.message);
      } else if (errorDetails.type === 'AUTH') {
        throw new MCPError(`Authentication failed: ${errorDetails.message}`, errorDetails.code || -32001, server.id);
      } else if (errorDetails.type === 'CONNECTION') {
        throw new MCPConnectionError(server.id, server.endpointUrl, error instanceof Error ? error : new Error(errorDetails.message));
      } else {
        throw error;
      }
    }
  }

  /**
   * Categorize SDK errors for better handling
   * Phase 6: Enhanced error categorization for SDK-specific errors
   * Enhanced: Better SSE and client creation error handling
   */
  private categorizeSDKError(error: unknown): {
    type: 'CONNECTION' | 'TIMEOUT' | 'AUTH' | 'PROTOCOL' | 'UNKNOWN';
    message: string;
    code?: number;
    isRetryable: boolean;
  } {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorString = errorMessage.toLowerCase();
    const errorName = error instanceof Error ? error.name : '';
    
    // Phase 11: Enhanced debugging - log full error details for investigation
    console.log(`[${new Date().toISOString()}] [MCP Error Debug] Categorizing error:`, {
      errorMessage,
      errorString,
      errorName,
      errorType: typeof error,
      errorConstructor: error instanceof Error ? error.constructor.name : 'Unknown',
      errorStack: error instanceof Error ? error.stack?.split('\n').slice(0, 3).join('\n') : undefined,
      hasCause: error instanceof Error && 'cause' in error,
      cause: error instanceof Error && 'cause' in error ? error.cause : undefined
    });
    
    // Protocol version mismatch detection
    if (errorString.includes('unsupported protocol version') || 
        errorString.includes('protocol version is not supported') ||
        errorString.includes('bad request') && errorString.includes('protocol')) {
      
      console.log(`[${new Date().toISOString()}] [MCP Error Debug] Detected protocol version mismatch`);
      
      // Extract supported versions if available
      const versionMatch = errorMessage.match(/supported versions?:?\s*([\d\-,\s]+)/i);
      const supportedVersions = versionMatch ? versionMatch[1] : 'unknown';
      
      return {
        type: 'PROTOCOL',
        message: `Protocol version mismatch. Server supports: ${supportedVersions}`,
        code: -32600,
        isRetryable: false
      };
    }
    
    // Enhanced SSE-specific error detection - check for SyntaxError first (highest priority)
    if (errorString.includes('invalid or illegal string') || 
        errorString.includes('syntaxerror') ||
        errorName.toLowerCase() === 'syntaxerror') {
      
      console.log(`[${new Date().toISOString()}] [MCP Error Debug] Detected SyntaxError - this is the root cause!`);
      
      return {
        type: 'PROTOCOL',
        message: `SSE SyntaxError: ${errorMessage} (The SSE endpoint returned malformed data that cannot be parsed)`,
        code: -32600,
        isRetryable: false
      };
    }
    
    // Client creation and SDK-specific errors (lower priority)
    if (errorString.includes('client is not defined') ||
        errorString.includes('transport') && errorString.includes('not defined') ||
        errorString.includes('cannot read properties of undefined')) {
      
      console.log(`[${new Date().toISOString()}] [MCP Error Debug] Detected client initialization error - may be masking deeper issue`);
      
      return {
        type: 'PROTOCOL',
        message: `SDK Client Error: ${errorMessage} (SDK client or transport initialization failed - check if endpoint supports MCP protocol)`,
        code: -32601,
        isRetryable: false
      };
    }
    
    // SSE/EventSource specific errors
    if (errorString.includes('eventsource') ||
        errorString.includes('server-sent events') ||
        errorString.includes('sse')) {
      return {
        type: 'CONNECTION',
        message: `SSE Connection Error: ${errorMessage}`,
        code: -32002,
        isRetryable: true
      };
    }
    
    // Connection errors
    if (errorString.includes('econnrefused') || 
        errorString.includes('enotfound') || 
        errorString.includes('connection refused') ||
        errorString.includes('network') ||
        errorString.includes('fetch failed')) {
      return {
        type: 'CONNECTION',
        message: errorMessage,
        code: -32002,
        isRetryable: true
      };
    }
    
    // Timeout errors
    if (errorString.includes('timeout') || 
        errorString.includes('timed out') ||
        errorString.includes('deadline')) {
      return {
        type: 'TIMEOUT',
        message: errorMessage,
        code: -32003,
        isRetryable: true
      };
    }
    
    // Authentication errors
    if (errorString.includes('unauthorized') || 
        errorString.includes('forbidden') ||
        errorString.includes('401') ||
        errorString.includes('403') ||
        errorString.includes('authentication') ||
        errorString.includes('invalid credentials')) {
      return {
        type: 'AUTH',
        message: errorMessage,
        code: -32001,
        isRetryable: false
      };
    }
    
    // Protocol errors
    if (errorString.includes('protocol') || 
        errorString.includes('invalid response') ||
        errorString.includes('malformed') ||
        errorString.includes('parse error')) {
      return {
        type: 'PROTOCOL',
        message: errorMessage,
        code: -32700,
        isRetryable: false
      };
    }
    
    // Unknown errors
    return {
      type: 'UNKNOWN',
      message: errorMessage,
      code: -32000,
      isRetryable: false
    };
  }

  /**
   * Parse response that may be in Server-Sent Events (SSE) format or regular JSON
   */
  private parseSSEResponse(responseText: string): any {
    // Handle Server-Sent Events format
    if (responseText.includes('event:') && responseText.includes('data:')) {
      const lines = responseText.split('\n');
      const dataLine = lines.find(line => line.startsWith('data: '));
      if (dataLine) {
        try {
          return JSON.parse(dataLine.substring(6));
        } catch (error) {
          console.error(`[${new Date().toISOString()}] [MCP Server Debug] Failed to parse SSE data line:`, {
            dataLine,
            error: error instanceof Error ? error.message : String(error)
          });
          throw new Error('Failed to parse SSE response data');
        }
      }
      throw new Error('No data line found in SSE response');
    }
    
    // Fallback to regular JSON parsing
    return JSON.parse(responseText);
  }

  /**
   * Fetch tools directly from MCP server
   */
  private async fetchToolsFromServer(server: MCPServerConnection, conversationId?: string): Promise<MCPToolDefinition[]> {
    const requestId = this.generateRequestId();
    
    console.log(`[${new Date().toISOString()}] [MCP Session Debug] Starting tool fetch with session management:`, {
      serverId: server.id,
      serverName: server.name,
      conversationId,
      initialRequiresSession: server.requiresSession,
      authType: server.auth_type
    });
    
    // Detect if server requires session management (if not already known)
    if (server.requiresSession === undefined) {
      console.log(`[${new Date().toISOString()}] [MCP Session Debug] Detecting session requirement...`);
      server.requiresSession = await this.detectSessionRequirement(server);
      console.log(`[${new Date().toISOString()}] [MCP Session Debug] Session requirement detected:`, {
        serverId: server.id,
        requiresSession: server.requiresSession
      });
    }
    
    // Ensure we have a session if required
    let sessionId: string | null = null;
    if (server.requiresSession) {
      console.log(`[${new Date().toISOString()}] [MCP Session Debug] Server requires session, establishing...`);
      sessionId = await this.ensureSession(server, conversationId);
      console.log(`[${new Date().toISOString()}] [MCP Session Debug] Session establishment result:`, {
        serverId: server.id,
        sessionEstablished: !!sessionId,
        sessionId: sessionId ? sessionId.substring(0, 8) + '...' : null
      });
      if (!sessionId) {
        throw new MCPSessionError(server.id, 'Failed to establish session');
      }
    } else {
      console.log(`[${new Date().toISOString()}] [MCP Session Debug] Server does not require session`);
    }
    
    const request: MCPRequest = {
      jsonrpc: '2.0',
      id: requestId,
      method: 'tools/list',
      params: {}
    };
    
    console.log(`[${new Date().toISOString()}] [MCP Server Debug] Preparing tools/list request:`, {
      serverId: server.id,
      serverName: server.name,
      endpoint: server.endpointUrl,
      requestId,
      requiresSession: server.requiresSession,
      sessionId: sessionId ? sessionId.substring(0, 8) + '...' : null,
      request: JSON.stringify(request, null, 2),
      timeoutMs: server.timeoutSeconds * 1000
    });

    const controller = new AbortController();
    const timeoutMs = server.timeoutSeconds * 1000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const startTime = Date.now();

    try {
      // Prepare headers - ALWAYS include both accept types for MCP servers
      const authHeaders = this.createAuthHeaders(server);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream', // Always include both
        'User-Agent': 'ContextFlow-AI/1.0',
        // Protocol version handled by SDK, // REQUIRED by MCP specification
        ...authHeaders // Add authentication headers
      };
      
      // Add session ID if available (REQUIRED if server provided one)
      if (server.requiresSession && sessionId) {
        headers['Mcp-Session-Id'] = sessionId;
        console.log(`[${new Date().toISOString()}] [MCP Auth Debug] Added session ID to headers:`, {
          serverId: server.id,
          sessionIdLength: sessionId.length,
          sessionIdPreview: sessionId.substring(0, 10) + '...'
        });
      }
      
      console.log(`[${new Date().toISOString()}] [MCP Auth Debug] Final request headers for tools/list:`, {
        serverId: server.id,
        serverName: server.name,
        endpoint: server.endpointUrl,
        requestId,
        headers: {
          'Content-Type': headers['Content-Type'],
          'Accept': headers['Accept'],
          'User-Agent': headers['User-Agent'],
          'Authorization': headers['Authorization'] ? 'Bearer ***' + headers['Authorization'].substring(headers['Authorization'].length - 5) : 'None',
          'X-API-Key': headers['X-API-Key'] ? '***' + headers['X-API-Key'].substring(headers['X-API-Key'].length - 5) : 'None',
          'Mcp-Session-Id': headers['Mcp-Session-Id'] ? '***' + headers['Mcp-Session-Id'].substring(headers['Mcp-Session-Id'].length - 5) : 'None'
        },
        authHeadersCount: Object.keys(authHeaders).length,
        totalHeadersCount: Object.keys(headers).length
      });

      const response = await fetch(server.endpointUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        signal: controller.signal
      });
      
      const httpTime = Date.now() - startTime;
      clearTimeout(timeoutId);
      
      console.log(`[${new Date().toISOString()}] [MCP Server Debug] HTTP response received for tools/list:`, {
        serverId: server.id,
        serverName: server.name,
        requestId,
        httpTimeMs: httpTime,
        statusCode: response.status,
        statusText: response.statusText,
        contentType: response.headers.get('content-type'),
        responseHeaders: {
          'www-authenticate': response.headers.get('www-authenticate'),
          'authorization': response.headers.get('authorization'),
          'mcp-session-id': response.headers.get('mcp-session-id'),
          'mcp-error': response.headers.get('mcp-error')
        }
      });

      if (!response.ok) {
        let errorDetails = `HTTP ${response.status}: ${response.statusText}`;
        
        // Add authentication-specific debugging
        if (response.status === 401) {
          const responseBody = await response.text();
          console.error(`[${new Date().toISOString()}] [MCP Auth Debug] 401 Authentication challenge received:`, {
            serverId: server.id,
            serverName: server.name,
            authType: server.auth_type,
            wwwAuthenticate: response.headers.get('www-authenticate'),
            hasAuthHeader: !!server.secret,
            endpoint: server.endpointUrl,
            responseBody: responseBody,
            responseHeaders: {}  // Simplified for compatibility
          });
          
          // If this is a MCP simple auth challenge, try to authenticate
          if (server.auth_type === 'simple_auth' && server.username && server.secret) {
            try {
              console.log(`[${new Date().toISOString()}] [MCP Auth Debug] Attempting MCP simple auth challenge-response...`);
              const authResult = await this.performSimpleAuth(server);
              if (authResult) {
                console.log(`[${new Date().toISOString()}] [MCP Auth Debug] Simple auth succeeded, retrying original request...`);
                // Retry the original request with authentication
                return this.fetchToolsFromServer(server, conversationId);
              }
            } catch (authError) {
              console.error(`[${new Date().toISOString()}] [MCP Auth Debug] Simple auth failed:`, authError);
            }
          }
          
          errorDetails += '. Authentication failed - check username, password, or API key.';
        } else if (response.status === 403) {
          console.error(`[${new Date().toISOString()}] [MCP Auth Debug] Authorization failed:`, {
            serverId: server.id,
            serverName: server.name,
            authType: server.auth_type,
            endpoint: server.endpointUrl
          });
          errorDetails += '. Access forbidden - check user permissions and authorization.';
        }
        
        // Provide specific guidance for common MCP server issues
        if (response.status === 405) {
          errorDetails += '. This server may not support the MCP protocol. Verify the endpoint URL and ensure the server implements MCP tools/list method.';
        } else if (response.status === 404) {
          errorDetails += '. The MCP server endpoint was not found. Check the endpoint URL configuration.';
        } else if (response.status >= 500) {
          errorDetails += '. The MCP server encountered an internal error.';
        }
        
        const error = new MCPConnectionError(
          server.id,
          server.endpointUrl,
          new Error(errorDetails)
        );
        
        console.error(`[${new Date().toISOString()}] [MCP Server Debug] HTTP error for tools/list:`, {
          serverId: server.id,
          serverName: server.name,
          requestId,
          statusCode: response.status,
          statusText: response.statusText,
          endpoint: server.endpointUrl,
          error: error.message,
          guidance: response.status === 405 ? 'Server does not support MCP protocol' : 'Check server configuration'
        });
        
        throw error;
      }
      
      const responseText = await response.text();
      console.log(`[${new Date().toISOString()}] [MCP Server Debug] Raw tools/list response:`, {
        serverId: server.id,
        serverName: server.name,
        requestId,
        responseLength: responseText.length,
        responsePreview: responseText.substring(0, 500) + (responseText.length > 500 ? '...' : '')
      });
      
      let mcpResponse: MCPResponse<MCPListToolsResponse>;
      try {
        mcpResponse = this.parseSSEResponse(responseText) as MCPResponse<MCPListToolsResponse>;
        console.log(`[${new Date().toISOString()}] [MCP Server Debug] Successfully parsed tools/list response:`, {
          serverId: server.id,
          serverName: server.name,
          requestId,
          responseFormat: responseText.includes('event:') ? 'SSE' : 'JSON'
        });
      } catch (parseError) {
        console.error(`[${new Date().toISOString()}] [MCP Server Debug] Failed to parse tools/list response:`, {
          serverId: server.id,
          serverName: server.name,
          requestId,
          parseError: parseError instanceof Error ? parseError.message : String(parseError),
          responseText: responseText.substring(0, 1000)
        });
        throw new MCPError('Invalid response format from MCP server', -32700, server.id);
      }
      
      console.log(`[${new Date().toISOString()}] [MCP Server Debug] Parsed tools/list response:`, {
        serverId: server.id,
        serverName: server.name,
        requestId,
        responseId: mcpResponse.id,
        hasResult: !!mcpResponse.result,
        hasError: !!mcpResponse.error,
        errorCode: mcpResponse.error?.code,
        errorMessage: mcpResponse.error?.message
      });
      
      if (mcpResponse.error) {
        console.error(`[${new Date().toISOString()}] [MCP Server Debug] MCP server returned error for tools/list:`, {
          serverId: server.id,
          serverName: server.name,
          requestId,
          errorCode: mcpResponse.error.code,
          errorMessage: mcpResponse.error.message,
          errorData: mcpResponse.error.data
        });
        
        // Handle session-related errors with retry
        if (mcpResponse.error.code === -32000 && 
            mcpResponse.error.message.toLowerCase().includes('session')) {
          
          console.log(`[${new Date().toISOString()}] [MCP Server Debug] Session error detected, clearing cache and retrying:`, {
            serverId: server.id,
            serverName: server.name,
            requestId
          });
          
          // Clear session cache and mark as requiring session
          await this.clearSession(server.id, conversationId);
          server.requiresSession = true;
          
          // Retry with new session (but only once to avoid infinite loops)
          if (!request.params?.retry) {
            const retryRequest = { ...request, params: { ...request.params, retry: true } };
            console.log(`[${new Date().toISOString()}] [MCP Server Debug] Retrying tools/list with new session:`, {
              serverId: server.id,
              requestId: retryRequest.id
            });
            
            // Recursive call with retry flag
            return this.fetchToolsFromServer(server, conversationId);
          }
        }
        
        throw new MCPError(
          `MCP server error: ${mcpResponse.error.message}`,
          mcpResponse.error.code,
          server.id
        );
      }

      if (!mcpResponse.result) {
        console.error(`[${new Date().toISOString()}] [MCP Server Debug] No result in tools/list response:`, {
          serverId: server.id,
          serverName: server.name,
          requestId,
          response: mcpResponse
        });
        throw new MCPError('No result in MCP response', -32603, server.id);
      }
      
      const tools = mcpResponse.result.tools || [];
      console.log(`[${new Date().toISOString()}] [MCP Server Debug] Successfully parsed tools from server:`, {
        serverId: server.id,
        serverName: server.name,
        requestId,
        toolCount: tools.length,
        toolNames: tools.map(t => t.name),
        toolDetails: tools.map(t => ({
          name: t.name,
          description: t.description.substring(0, 100) + (t.description.length > 100 ? '...' : ''),
          hasInputSchema: !!t.inputSchema,
          inputSchemaType: typeof t.inputSchema,
          inputSchemaProperties: Object.keys(t.inputSchema?.properties || {})
        }))
      });

      return tools;

    } catch (error) {
      const totalTime = Date.now() - startTime;
      clearTimeout(timeoutId);
      
      if (error instanceof DOMException && error.name === 'AbortError') {
        console.error(`[${new Date().toISOString()}] [MCP Server Debug] Request timeout for tools/list:`, {
          serverId: server.id,
          serverName: server.name,
          requestId,
          timeoutMs,
          totalTimeMs: totalTime
        });
        throw new MCPTimeoutError(server.id, server.endpointUrl, `${timeoutMs}`);
      }
      
      if (error instanceof MCPError) {
        console.error(`[${new Date().toISOString()}] [MCP Server Debug] MCP error during tools/list:`, {
          serverId: server.id,
          serverName: server.name,
          requestId,
          mcpErrorCode: error.code,
          mcpErrorMessage: error.message,
          totalTimeMs: totalTime
        });
        throw error;
      }
      
      console.error(`[${new Date().toISOString()}] [MCP Server Debug] Unexpected error during tools/list:`, {
        serverId: server.id,
        serverName: server.name,
        requestId,
        errorType: error.constructor.name,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        totalTimeMs: totalTime
      });
      
      throw new MCPConnectionError(server.id, server.endpointUrl, error);
    }
  }

  /**
   * Convert tool definitions to tool instances
   */
  /**
   * Convert tools to tool instances
   * Phase 8: Updated to handle both SDK Tool and legacy MCPToolDefinition types
   */
  private convertToToolInstances(
    server: MCPServerConnection, 
    tools: SDKTool[] | MCPToolDefinition[]
  ): MCPToolInstance[] {
    return tools.map(tool => ({
      serverId: server.id,
      serverName: server.name,
      toolName: tool.name,
      definition: tool as SDKTool, // Phase 8: Both types are compatible
      lastUpdated: new Date(),
      // Phase 8: Add SDK integration metadata
      sdkClient: true,
      transportType: server.endpointUrl.includes('/sse') || 
                    server.endpointUrl.includes('/events') || 
                    server.endpointUrl.includes('/stream') ? 'SSE' : 'HTTP'
    }));
  }

  /**
   * Update health status for MCP servers after tool fetching
   */
  async updateServerHealthStatus(
    serverId: string, 
    isHealthy: boolean, 
    error?: string
  ): Promise<void> {
    try {
      let status = isHealthy ? 'healthy' : 'unhealthy';
      
      // Detect MCP protocol issues
      if (error && error.includes('Method Not Allowed')) {
        status = 'misconfigured';
        error += ' (Server does not support MCP protocol)';
      } else if (error && error.includes('404')) {
        status = 'misconfigured';
        error += ' (Endpoint not found)';
      }
      const query = `
        UPDATE mcp_servers 
        SET health_status = $1, 
            last_health_check = CURRENT_TIMESTAMP,
            ${error ? 'sync_error_message = $3' : 'sync_error_message = NULL'}
        WHERE id = $2
      `;
      
      const params = error ? [status, serverId, error] : [status, serverId];
      await pool.query(query, params);
      
    } catch (dbError) {
      console.error(`[${new Date().toISOString()}] Failed to update health status for MCP server ${serverId}:`, dbError);
      // Don't throw here - health status update failures shouldn't break tool functionality
    }
  }

  /**
   * Perform health check on MCP server
   */
  async performHealthCheck(serverId: string): Promise<MCPServerHealthCheck> {
    try {
      const mcpServerModel = new MCPServerModel(pool);
      const server = await mcpServerModel.getWithDecryptedCredentials(serverId);
      if (!server) {
        throw new Error('MCP server not found');
      }

      const serverConnection: MCPServerConnection = {
        id: server.id,
        name: server.name,
        endpointUrl: server.endpoint_url,
        timeoutSeconds: server.timeout_seconds || 30,
        rateLimitPerMinute: server.rate_limit_per_minute || 100,
        healthStatus: server.health_status || 'unknown',
        auth_type: server.auth_type || 'none',
        username: server.username,
        secret: server.secret,
        isActive: server.is_active
      };

      const startTime = Date.now();
      
      console.log(`[${new Date().toISOString()}] [MCP Server Debug] Starting health check:`, {
        serverId,
        serverName: server.name,
        endpoint: server.endpoint_url
      });
      
      // Try to fetch tools as health check (no conversation context for health checks)
      const tools = await this.fetchToolsFromServer(serverConnection);
      
      const responseTime = Date.now() - startTime;
      
      console.log(`[${new Date().toISOString()}] [MCP Server Debug] Health check completed successfully:`, {
        serverId,
        serverName: server.name,
        responseTimeMs: responseTime,
        toolCount: tools.length
      });
      
      // Update database health status
      await this.updateServerHealthStatus(serverId, true);
      
      return {
        serverId,
        status: 'healthy',
        responseTimeMs: responseTime,
        toolsCount: tools.length,
        lastCheck: new Date().toISOString(),
        checkedAt: new Date(),
        message: `Successfully connected. Found ${tools.length} tools.`
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      console.error(`[${new Date().toISOString()}] [MCP Server Debug] Health check failed:`, {
        serverId,
        errorType: error.constructor.name,
        errorMessage,
        errorStack: error instanceof Error ? error.stack : undefined
      });
      
      // Update database health status
      await this.updateServerHealthStatus(serverId, false, errorMessage);
      
      return {
        serverId,
        status: 'unhealthy',
        responseTimeMs: 0,
        toolsCount: 0,
        lastCheck: new Date().toISOString(),
        checkedAt: new Date(),
        error: errorMessage,
        message: `Health check failed: ${errorMessage}`
      };
    }
  }

  /**
   * Clear tool cache for a specific server or all servers
   */
  clearCache(serverId?: string): void {
    if (serverId) {
      const hadCache = this.toolCache.has(serverId);
      this.toolCache.delete(serverId);
      console.log(`[${new Date().toISOString()}] [MCP Server Debug] Cleared cache for server:`, {
        serverId,
        hadCache,
        remainingCacheEntries: this.toolCache.size
      });
    } else {
      const cacheSize = this.toolCache.size;
      this.toolCache.clear();
      console.log(`[${new Date().toISOString()}] [MCP Server Debug] Cleared all cache:`, {
        clearedEntries: cacheSize
      });
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    totalCachedServers: number;
    cacheEntries: Array<{
      serverId: string;
      toolCount: number;
      cachedAt: Date;
      expiresAt: Date;
      isExpired: boolean;
    }>;
  } {
    const now = new Date();
    const cacheEntries = Array.from(this.toolCache.entries()).map(([serverId, cache]) => ({
      serverId,
      toolCount: cache.tools.length,
      cachedAt: cache.cachedAt,
      expiresAt: cache.expiresAt,
      isExpired: cache.expiresAt <= now
    }));

    return {
      totalCachedServers: this.toolCache.size,
      cacheEntries
    };
  }

  /**
   * Test connection to MCP server (public method)
   * Phase 11: Added public wrapper for simple connection testing
   */
  async testConnection(server: MCPServerConnection): Promise<MCPServerTestResult> {
    const testStartTime = new Date();
    
    // Initialize minimal test result structure for connection testing only
    const testResult: MCPServerTestResult = {
      serverId: server.id,
      serverName: server.name,
      endpointUrl: server.endpointUrl,
      testStartTime,
      testEndTime: new Date(), // Will be updated at the end
      totalTestTimeMs: 0, // Will be calculated at the end
      overallStatus: 'failed',
      sessionManagement: {
        requiresSession: false,
        detectionMethod: 'default_assumption'
      },
      connectionTest: { status: 'failed' },
      protocolTest: { status: 'failed' },
      toolsTest: { status: 'failed', toolCount: 0, tools: [] },
      capabilitiesTest: { status: 'failed', supportedMethods: [] },
      summary: {
        successfulTests: 0,
        totalTests: 1, // Only connection test
        issues: [],
        recommendations: []
      }
    };

    try {
      // Test connection only
      await this.testConnectionInternal(server, testResult);
      
      // Calculate final metrics
      const testEndTime = new Date();
      testResult.testEndTime = testEndTime;
      testResult.totalTestTimeMs = testEndTime.getTime() - testStartTime.getTime();
      
      // Update summary
      testResult.summary.successfulTests = testResult.connectionTest.status === 'passed' || testResult.connectionTest.status === 'success' ? 1 : 0;
      testResult.overallStatus = testResult.summary.successfulTests > 0 ? 'success' : 'failed';
      
      return testResult;
      
    } catch (error) {
      const testEndTime = new Date();
      testResult.testEndTime = testEndTime;
      testResult.totalTestTimeMs = testEndTime.getTime() - testStartTime.getTime();
      
      // Ensure connectionTest is marked as failed if not already set
      if (testResult.connectionTest.status !== 'failed') {
        testResult.connectionTest = {
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
          responseTimeMs: testResult.totalTestTimeMs
        };
      }
      
      testResult.summary.issues.push(error instanceof Error ? error.message : String(error));
      testResult.overallStatus = 'failed';
      
      return testResult;
    }
  }

  /**
   * Perform comprehensive test of MCP server including health check, tools discovery, and capabilities
   */
  async performComprehensiveTest(serverId: string): Promise<MCPServerTestResult> {
    const testStartTime = new Date();
    let server: any;

    try {
      const mcpServerModel = new MCPServerModel(pool);
      server = await mcpServerModel.getWithDecryptedCredentials(serverId);
      if (!server) {
        throw new CustomError('MCP server not found', 404);
      }
    } catch (error) {
      const testEndTime = new Date();
      return {
        serverId,
        serverName: 'Unknown',
        endpointUrl: 'Unknown',
        testStartTime,
        testEndTime,
        totalTestTimeMs: testEndTime.getTime() - testStartTime.getTime(),
        overallStatus: 'failed',
        sessionManagement: {
          requiresSession: false,
          detectionMethod: 'default_assumption'
        },
        connectionTest: {
          status: 'failed',
          error: 'Server not found in database'
        },
        protocolTest: {
          status: 'failed',
          error: 'Cannot test protocol - server not found'
        },
        toolsTest: {
          status: 'failed',
          toolCount: 0,
          tools: [],
          error: 'Cannot test tools - server not found'
        },
        capabilitiesTest: {
          status: 'failed',
          supportedMethods: [],
          error: 'Cannot test capabilities - server not found'
        },
        summary: {
          successfulTests: 0,
          totalTests: 4,
          issues: ['MCP server not found in database'],
          recommendations: ['Verify the server ID and ensure the server exists']
        }
      };
    }

    const serverConnection: MCPServerConnection = {
      id: server.id,
      name: server.name,
      endpointUrl: server.endpoint_url,
      timeoutSeconds: server.timeout_seconds || 30,
      rateLimitPerMinute: server.rate_limit_per_minute || 100,
      healthStatus: server.health_status || 'unknown',
      auth_type: server.auth_type || 'none',
      username: server.username,
      secret: server.secret,
      isActive: server.is_active
    };

    console.log(`[${new Date().toISOString()}] [MCP Test Debug] Starting comprehensive test for server:`, {
      serverId,
      serverName: server.name,
      endpoint: server.endpoint_url,
      isActive: server.is_active
    });

    // Initialize test result structure
    const testResult: MCPServerTestResult = {
      serverId,
      serverName: server.name,
      endpointUrl: server.endpoint_url,
      testStartTime,
      testEndTime: new Date(), // Will be updated at the end
      totalTestTimeMs: 0, // Will be calculated at the end
      overallStatus: 'failed',
      sessionManagement: {
        requiresSession: false,
        detectionMethod: 'default_assumption'
      },
      connectionTest: { status: 'failed' },
      protocolTest: { status: 'failed' },
      toolsTest: { status: 'failed', toolCount: 0, tools: [] },
      capabilitiesTest: { status: 'failed', supportedMethods: [] },
      summary: {
        successfulTests: 0,
        totalTests: 4,
        issues: [],
        recommendations: []
      }
    };

    // Test 1: Basic connectivity
    await this.testConnectionInternal(serverConnection, testResult);
    
    // Test 2: Protocol compatibility (if connection succeeded)
    if (testResult.connectionTest.status === 'success') {
      await this.testProtocolCompatibility(serverConnection, testResult);
    }

    // Test 3: Tools discovery (if protocol test succeeded)
    if (testResult.protocolTest.status === 'success') {
      await this.testToolsDiscovery(serverConnection, testResult);
    }

    // Test 4: Capabilities discovery
    if (testResult.protocolTest.status === 'success') {
      await this.testCapabilities(serverConnection, testResult);
    }

    // Finalize test results
    const testEndTime = new Date();
    testResult.testEndTime = testEndTime;
    testResult.totalTestTimeMs = testEndTime.getTime() - testStartTime.getTime();
    
    // Calculate success metrics
    const tests = [
      testResult.connectionTest,
      testResult.protocolTest,
      testResult.toolsTest,
      testResult.capabilitiesTest
    ];
    
    testResult.summary.successfulTests = tests.filter(test => test.status === 'success').length;
    
    // Determine overall status
    if (testResult.summary.successfulTests === testResult.summary.totalTests) {
      testResult.overallStatus = 'success';
    } else if (testResult.summary.successfulTests > 0) {
      testResult.overallStatus = 'partial';
    } else {
      testResult.overallStatus = 'failed';
    }

    // Finalize session management information based on test results
    testResult.sessionManagement.requiresSession = serverConnection.requiresSession ?? false;
    
    // Determine detection method based on test results
    if (testResult.connectionTest.details?.requiresSession) {
      testResult.sessionManagement.detectionMethod = 'initialize_response';
    } else if (serverConnection.requiresSession === true) {
      testResult.sessionManagement.detectionMethod = 'error_analysis';
    } else {
      testResult.sessionManagement.detectionMethod = 'default_assumption';
    }
    
    // Get session ID if available (for testing, use server.id as session key)
    const sessionContext = this.sessionCache.get(server.id);
    if (sessionContext?.sessionId) {
      testResult.sessionManagement.sessionId = sessionContext.sessionId;
    }

    // Generate recommendations
    this.generateRecommendations(testResult);

    // Update server health status in database based on test results
    await this.updateServerHealthFromTest(serverId, testResult);

    console.log(`[${new Date().toISOString()}] [MCP Test Debug] Comprehensive test completed:`, {
      serverId,
      serverName: server.name,
      overallStatus: testResult.overallStatus,
      successfulTests: testResult.summary.successfulTests,
      totalTestTimeMs: testResult.totalTestTimeMs,
      toolCount: testResult.toolsTest.toolCount,
      requiresSession: testResult.sessionManagement.requiresSession,
      detectionMethod: testResult.sessionManagement.detectionMethod
    });

    return testResult;
  }

  /**
   * Test basic connectivity to MCP server
   */
  /**
   * Test connection using SDK client (internal method)
   * Phase 7: Refactored to use SDK instead of legacy HTTP
   * Phase 11: Renamed to testConnectionInternal to avoid conflict with public method
   */
  private async testConnectionInternal(server: MCPServerConnection, testResult: MCPServerTestResult): Promise<void> {
    const startTime = Date.now();
    
    try {
      console.log(`[${new Date().toISOString()}] [MCP Test Debug] Testing connection to ${server.endpointUrl} using SDK`);
      
      // Phase 7: Use SDK client instead of manual fetch
      let client: Client | null = null;
      
      try {
        // Try to get or create an SDK client
        client = await this._getOrCreateMcpClient(server);
        
        // If we got here, connection was successful
        testResult.connectionTest = {
          status: 'success',
          responseTimeMs: Date.now() - startTime,
          transportType: server.endpointUrl.includes('/sse') || 
                        server.endpointUrl.includes('/events') || 
                        server.endpointUrl.includes('/stream') ? 'SSE' : 'HTTP'
        };
        
        console.log(`[${new Date().toISOString()}] [MCP Test Debug] SDK connection successful:`, {
          serverId: server.id,
          serverName: server.name,
          responseTimeMs: testResult.connectionTest.responseTimeMs,
          transportType: testResult.connectionTest.transportType
        });
        
      } catch (sdkError) {
        // Enhanced fallback: Try legacy method for all server types when SDK fails
        console.log(`[${new Date().toISOString()}] [MCP Test Debug] SDK connection failed, trying legacy HTTP fallback:`, {
          serverId: server.id,
          serverName: server.name,
          authType: server.auth_type,
          endpoint: server.endpointUrl,
          sdkError: sdkError instanceof Error ? sdkError.message : String(sdkError)
        });
        
        try {
          await this.testConnectionLegacy(server, testResult);
          
          // If legacy method succeeds, add a note about SDK failure
          if (testResult.connectionTest?.status === 'success') {
            console.log(`[${new Date().toISOString()}] [MCP Test Debug] Legacy HTTP fallback successful:`, {
              serverId: server.id,
              serverName: server.name,
              responseTimeMs: testResult.connectionTest.responseTimeMs
            });
            
            // Add SDK failure info but mark connection as passed
            testResult.connectionTest.error = `SDK failed (${sdkError instanceof Error ? sdkError.message : String(sdkError)}) but legacy HTTP succeeded`;
            testResult.connectionTest.transportType = 'HTTP-Legacy';
          }
          return;
        } catch (legacyError) {
          console.error(`[${new Date().toISOString()}] [MCP Test Debug] Both SDK and legacy methods failed:`, {
            serverId: server.id,
            serverName: server.name,
            sdkError: sdkError instanceof Error ? sdkError.message : String(sdkError),
            legacyError: legacyError instanceof Error ? legacyError.message : String(legacyError)
          });
          
          // Use the original SDK error since that's the primary method
          throw sdkError;
        }
      }
      
    } catch (error) {
      // Phase 7: Use enhanced error categorization
      const errorDetails = this.categorizeSDKError(error);
      
      testResult.connectionTest = {
        status: 'failed',
        error: `${errorDetails.type}: ${errorDetails.message}`,
        responseTimeMs: Date.now() - startTime,
        errorType: errorDetails.type,
        isRetryable: errorDetails.isRetryable
      };
      
      console.error(`[${new Date().toISOString()}] [MCP Test Debug] Connection test failed:`, {
        serverId: server.id,
        serverName: server.name,
        errorType: errorDetails.type,
        errorMessage: errorDetails.message,
        isRetryable: errorDetails.isRetryable,
        responseTimeMs: testResult.connectionTest.responseTimeMs
      });
    }
  }

  /**
   * Legacy connection test for simple_auth and fallback scenarios
   * Phase 7: Preserved for simple_auth compatibility
   */
  private async testConnectionLegacy(server: MCPServerConnection, testResult: MCPServerTestResult): Promise<void> {
    const startTime = Date.now();
    
    // Phase 11: Add defensive check for testResult parameter
    if (!testResult) {
      console.error(`[${new Date().toISOString()}] [MCP Test Debug] testConnectionLegacy called with undefined testResult parameter`);
      throw new Error('testResult parameter is required for testConnectionLegacy');
    }
    
    try {
      console.log(`[${new Date().toISOString()}] [MCP Test Debug] Testing connection to ${server.endpointUrl} using legacy HTTP`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), server.timeoutSeconds * 1000);

      // First try session-based initialization
      const response = await fetch(server.endpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'User-Agent': 'ContextFlow-AI/1.0',
          // Protocol version handled by SDK,
          ...this.createAuthHeaders(server)
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'connection_test',
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: {
              name: 'ContextFlow-AI',
              version: '1.0.0'
            }
          }
        }),
        signal: controller.signal
      });

      const responseTime = Date.now() - startTime;
      clearTimeout(timeoutId);

      if (response.ok) {
        // Extract session ID if provided
        const sessionId = response.headers.get('mcp-session-id');
        
        // Attempt to parse response to detect if server supports sessions
        try {
          const responseText = await response.text();
          let parsedResponse: any;
          
          try {
            parsedResponse = this.parseSSEResponse(responseText);
          } catch (parseError) {
            console.log(`[${new Date().toISOString()}] [MCP Test Debug] Could not parse connection test response (non-critical):`, {
              parseError: parseError instanceof Error ? parseError.message : String(parseError)
            });
          }
          
          // Mark server as session-capable if we got a session ID or proper initialize response
          if (sessionId || (parsedResponse?.result?.serverInfo)) {
            server.requiresSession = true;
            
            // Cache session if provided
            if (sessionId && parsedResponse?.result) {
              const sessionContext = {
                serverId: server.id,
                sessionId,
                createdAt: new Date(),
                expiresAt: new Date(Date.now() + this.SESSION_TTL_MS),
                protocolVersion: parsedResponse.result.protocolVersion,
                serverInfo: parsedResponse.result.serverInfo
              };
              this.sessionCache.set(server.id, sessionContext);
              
              console.log(`[${new Date().toISOString()}] [MCP Test Debug] Cached session info for protocol test:`, {
                sessionId: sessionId.substring(0, 8) + '...',
                serverName: parsedResponse.result.serverInfo?.name,
                protocolVersion: parsedResponse.result.protocolVersion
              });
            }
          }
          
        } catch (parseError) {
          console.log(`[${new Date().toISOString()}] [MCP Test Debug] Could not parse connection test response (non-critical):`, {
            parseError: parseError instanceof Error ? parseError.message : String(parseError)
          });
        }
        
        testResult.connectionTest = {
          status: 'success',
          responseTimeMs: responseTime
        };
        console.log(`[${new Date().toISOString()}] [MCP Test Debug] Connection test successful: ${responseTime}ms, session support: ${!!sessionId}`);
      } else {
        // Check if this is a session-related error or authentication challenge
        let requiresSession = false;
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        let responseBody = '';
        
        // Read response body once
        try {
          responseBody = await response.text();
        } catch (e) {
          console.error(`[${new Date().toISOString()}] [MCP Test Debug] Failed to read response body:`, e);
        }
        
        // Handle 401 authentication challenges for simple_auth servers
        if (response.status === 401 && server.auth_type === 'simple_auth') {
          console.log(`[${new Date().toISOString()}] [MCP Test Debug] 401 Authentication challenge received during connection test:`, {
            serverId: server.id,
            serverName: server.name,
            responseHeaders: {},  // Simplified for compatibility
            responseBody: responseBody
          });
          
          try {
            console.log(`[${new Date().toISOString()}] [MCP Test Debug] Attempting MCP simple auth challenge-response...`);
            // Parse the challenge response to verify it's a proper auth challenge
            let challengeResponse: any;
            try {
              challengeResponse = JSON.parse(responseBody);
              console.log(`[${new Date().toISOString()}] [MCP Test Debug] Parsed challenge response:`, challengeResponse);
            } catch (e) {
              console.error(`[${new Date().toISOString()}] [MCP Test Debug] Failed to parse challenge response:`, e);
            }
            
            const authResult = await this.performSimpleAuth(server);
            if (authResult) {
              console.log(`[${new Date().toISOString()}] [MCP Test Debug] Simple auth succeeded, marking connection test as successful`);
              testResult.connectionTest = {
                status: 'success',
                responseTimeMs: Date.now() - startTime,
                details: { authenticated: true, sessionId: authResult }
              };
              
              // Cache the session for subsequent tests
              const sessionContext = {
                serverId: server.id,
                sessionId: authResult,
                createdAt: new Date(),
                expiresAt: new Date(Date.now() + this.SESSION_TTL_MS),
                protocolVersion: '2025-03-26',
                serverInfo: {
                  name: server.name,
                  version: 'unknown',
                  protocolVersion: '2025-03-26',
                  capabilities: {}
                }
              };
              this.sessionCache.set(server.id, sessionContext);
              server.requiresSession = true;
              
              return; // Exit early on successful auth
            }
          } catch (authError) {
            console.error(`[${new Date().toISOString()}] [MCP Test Debug] Simple auth failed during connection test:`, authError);
            errorMessage = `Authentication failed: ${authError instanceof Error ? authError.message : String(authError)}`;
          }
        }
        
        try {
          const errorResponse = responseBody ? JSON.parse(responseBody) : {};
          
          // Check for session-related error codes
          if (errorResponse?.error?.code === -32000 && 
              errorResponse?.error?.message?.toLowerCase().includes('session')) {
            requiresSession = true;
            server.requiresSession = true;
            errorMessage = 'Server requires session initialization';
            console.log(`[${new Date().toISOString()}] [MCP Test Debug] Server requires session initialization: ${server.endpointUrl}`);
            
            // This is actually expected behavior for session-based servers
            testResult.connectionTest = {
              status: 'success',
              responseTimeMs: responseTime,
              details: { requiresSession: true }
            };
            testResult.summary.issues = []; // Clear issues since this is expected
          } else {
            testResult.connectionTest = {
              status: 'failed',
              responseTimeMs: responseTime,
              error: errorMessage
            };
            testResult.summary.issues.push(`Connection failed: ${errorMessage}`);
          }
        } catch (parseError) {
          // If we can't parse the error, stick with the original failure
          testResult.connectionTest = {
            status: 'failed',
            responseTimeMs: responseTime,
            error: errorMessage
          };
          testResult.summary.issues.push(`Connection failed with HTTP ${response.status}`);
        }
      }

    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      testResult.connectionTest = {
        status: 'failed',
        responseTimeMs: responseTime,
        error: errorMessage
      };
      
      if (error instanceof DOMException && error.name === 'AbortError') {
        testResult.summary.issues.push('Connection timeout - server did not respond within timeout period');
      } else {
        testResult.summary.issues.push(`Connection error: ${errorMessage}`);
      }
      
      console.log(`[${new Date().toISOString()}] [MCP Test Debug] Connection test failed:`, {
        endpoint: server.endpointUrl,
        error: errorMessage,
        responseTime
      });
    }
  }

  /**
   * Test MCP protocol compatibility - reuse existing session from connection test
   */
  /**
   * Test protocol compatibility using SDK
   * Phase 7: Simplified to use SDK client connection as proof of protocol compatibility
   */
  private async testProtocolCompatibility(server: MCPServerConnection, testResult: MCPServerTestResult): Promise<void> {
    try {
      console.log(`[${new Date().toISOString()}] [MCP Test Debug] Testing protocol compatibility using SDK`);
      
      // Phase 11.6: Handle simple auth servers that can't use SDK
      if (server.auth_type === 'simple_auth') {
        console.log(`[${new Date().toISOString()}] [MCP Test Debug] Simple auth server detected, using session-based protocol test`);
        
        // Check if we have session information from connection test
        const sessionContext = this.sessionCache.get(server.id);
        
        const serverInfo = {
          name: sessionContext?.serverInfo?.name || server.name,
          version: sessionContext?.serverInfo?.version || 'unknown',
          protocolVersion: '2025-03-26', // Simple auth uses standard MCP protocol
          capabilities: sessionContext?.serverInfo?.capabilities || {}
        };
        
        testResult.protocolTest = {
          status: 'success',
          protocolVersion: '2025-03-26',
          serverInfo,
          sdkClient: false // Indicate this was tested via legacy method
        };
        
        console.log(`[${new Date().toISOString()}] [MCP Test Debug] Simple auth protocol test successful:`, {
          serverName: serverInfo.name,
          serverVersion: serverInfo.version,
          hasSession: !!sessionContext,
          sessionId: sessionContext?.sessionId ? 'present' : 'none'
        });
        
        return;
      }
      
      // Phase 7: If the SDK client was successfully created in the connection test,
      // then protocol compatibility is already proven. Just get the client info.
      let client: Client;
      
      try {
        // Get the existing SDK client (should exist from connection test)
        client = await this._getOrCreateMcpClient(server);
      } catch (clientError) {
        // If we can't get the client, protocol test fails
        throw new Error(`Could not establish SDK client: ${clientError instanceof Error ? clientError.message : String(clientError)}`);
      }
      
      // Get server info from SDK client
      const serverCapabilities = client.getServerCapabilities();
      
      // Extract protocol version from transport if available
      const clientKey = server.id;
      const existingMetadata = this.mcpClients.get(clientKey); // Phase 9: Get metadata
      let protocolVersion = '2025-03-26'; // Default
      
      if (existingMetadata && existingMetadata.client.transport) {
        const transport = existingMetadata.client.transport as any;
        if (transport.protocolVersion) {
          protocolVersion = transport.protocolVersion;
        }
      }
      
      // Check legacy session cache for additional info
      const existingSession = this.sessionCache.get(server.id);
      
      const serverInfo = {
        name: existingSession?.serverInfo?.name || server.name,
        version: existingSession?.serverInfo?.version || 'unknown',
        protocolVersion: protocolVersion,
        capabilities: serverCapabilities || {}
      };
      
      testResult.protocolTest = {
        status: 'success',
        protocolVersion: protocolVersion,
        serverInfo,
        sdkClient: true // Indicate this was tested via SDK
      };
      
      console.log(`[${new Date().toISOString()}] [MCP Test Debug] SDK protocol test successful:`, {
        protocolVersion,
        serverName: serverInfo.name,
        serverVersion: serverInfo.version,
        capabilities: Object.keys(serverCapabilities || {}),
        transportType: server.endpointUrl.includes('/sse') || 
                       server.endpointUrl.includes('/events') || 
                       server.endpointUrl.includes('/stream') ? 'SSE' : 'HTTP'
      });

    } catch (error) {
      // Phase 7: Use enhanced error categorization
      const errorDetails = this.categorizeSDKError(error);
      
      testResult.protocolTest = {
        status: 'failed',
        error: `${errorDetails.type}: ${errorDetails.message}`,
        errorType: errorDetails.type,
        isRetryable: errorDetails.isRetryable
      };
      
      testResult.summary.issues.push(`Protocol test failed (${errorDetails.type}): ${errorDetails.message}`);
      
      console.error(`[${new Date().toISOString()}] [MCP Test Debug] SDK protocol test failed:`, {
        serverId: server.id,
        serverName: server.name,
        errorType: errorDetails.type,
        errorMessage: errorDetails.message,
        isRetryable: errorDetails.isRetryable
      });
    }
  }

  /**
   * Test tools discovery
   */
  /**
   * Test tools discovery using SDK
   * Phase 7: Refactored to use SDK-based getMCPServerTools instead of legacy fetchToolsFromServer
   */
  private async testToolsDiscovery(server: MCPServerConnection, testResult: MCPServerTestResult): Promise<void> {
    try {
      console.log(`[${new Date().toISOString()}] [MCP Test Debug] Testing tools discovery using SDK`);
      
      // Phase 7: Use SDK-based getMCPServerTools instead of legacy fetchToolsFromServer
      const toolInstances = await this.getMCPServerTools(server);
      
      // Convert tool instances back to definitions for test result
      const tools: MCPToolDefinition[] = toolInstances.map(tool => ({
        name: tool.definition.name,
        description: tool.definition.description || '',
        inputSchema: tool.definition.inputSchema || { type: 'object', properties: {} }
      }));
      
      testResult.toolsTest = {
        status: 'success',
        toolCount: tools.length,
        tools
      };
      
      console.log(`[${new Date().toISOString()}] [MCP Test Debug] SDK tools discovery successful: ${tools.length} tools found`);
      
    } catch (error) {
      // Phase 7: Use enhanced error categorization
      const errorDetails = this.categorizeSDKError(error);
      
      testResult.toolsTest = {
        status: 'failed',
        toolCount: 0,
        tools: [],
        error: `${errorDetails.type}: ${errorDetails.message}`,
        errorType: errorDetails.type,
        isRetryable: errorDetails.isRetryable
      };
      
      testResult.summary.issues.push(`Tools discovery failed (${errorDetails.type}): ${errorDetails.message}`);
      
      console.error(`[${new Date().toISOString()}] [MCP Test Debug] SDK tools discovery failed:`, {
        serverId: server.id,
        serverName: server.name,
        errorType: errorDetails.type,
        errorMessage: errorDetails.message,
        isRetryable: errorDetails.isRetryable
      });
    }
  }

  /**
   * Test server capabilities using SDK
   * Phase 7: Refactored to use SDK client for capabilities testing
   */
  private async testCapabilities(server: MCPServerConnection, testResult: MCPServerTestResult): Promise<void> {
    try {
      console.log(`[${new Date().toISOString()}] [MCP Test Debug] Testing server capabilities using SDK`);
      
      // Phase 11.6: Handle simple auth servers that can't use SDK
      if (server.auth_type === 'simple_auth') {
        console.log(`[${new Date().toISOString()}] [MCP Test Debug] Simple auth server detected, using session-based capabilities test`);
        
        // Check if we have session information from previous tests
        const sessionContext = this.sessionCache.get(server.id);
        
        const supportedMethods = ['tools/list', 'tools/call']; // Simple auth servers typically support basic tool operations
        const capabilities = sessionContext?.serverInfo?.capabilities || {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false }
        };
        
        testResult.capabilitiesTest = {
          status: 'success',
          supportedMethods,
          capabilities,
          details: {
            source: 'session_cache',
            hasSession: !!sessionContext,
            authType: 'simple_auth'
          }
        };
        
        console.log(`[${new Date().toISOString()}] [MCP Test Debug] Simple auth capabilities test successful:`, {
          supportedMethods: supportedMethods.length,
          hasSessionCapabilities: !!sessionContext?.serverInfo?.capabilities
        });
        
        return;
      }
      
      // Phase 7: Get SDK client to test capabilities
      let client: Client;
      try {
        client = await this._getOrCreateMcpClient(server);
      } catch (clientError) {
        // If we can't get a client, mark as failed
        throw new Error(`Could not establish SDK client: ${clientError instanceof Error ? clientError.message : String(clientError)}`);
      }
      
      const supportedMethods = [];
      
      // Get server capabilities from SDK client
      const serverCapabilities = client.getServerCapabilities();
      
      // Test tools/list if server says it supports tools
      if (serverCapabilities?.tools) {
        try {
          await client.request({ 
            method: 'tools/list',
            params: {}
          }, ListToolsResultSchema); // FIX: Added missing resultSchema parameter
          supportedMethods.push('tools/list');
          console.log(`[${new Date().toISOString()}] [MCP Test Debug] tools/list supported`);
        } catch (error) {
          console.log(`[${new Date().toISOString()}] [MCP Test Debug] tools/list not supported:`, error);
        }
      }
      
      // Test resources/list if server says it supports resources
      if (serverCapabilities?.resources) {
        try {
          await client.request({ 
            method: 'resources/list',
            params: {}
          }, ListResourcesResultSchema); // FIX: Added missing resultSchema parameter
          supportedMethods.push('resources/list');
          console.log(`[${new Date().toISOString()}] [MCP Test Debug] resources/list supported`);
        } catch (error) {
          console.log(`[${new Date().toISOString()}] [MCP Test Debug] resources/list not supported:`, error);
        }
      }
      
      // Test prompts/list if server says it supports prompts
      if (serverCapabilities?.prompts) {
        try {
          await client.request({ 
            method: 'prompts/list',
            params: {}
          }, ListPromptsResultSchema); // FIX: Added missing resultSchema parameter
          supportedMethods.push('prompts/list');
          console.log(`[${new Date().toISOString()}] [MCP Test Debug] prompts/list supported`);
        } catch (error) {
          console.log(`[${new Date().toISOString()}] [MCP Test Debug] prompts/list not supported:`, error);
        }
      }

      testResult.capabilitiesTest = {
        status: 'success',
        capabilities: serverCapabilities,
        supportedMethods
      };
      
      console.log(`[${new Date().toISOString()}] [MCP Test Debug] SDK capabilities test successful:`, {
        supportedMethods,
        serverCapabilities
      });
      
    } catch (error) {
      // Phase 7: Use enhanced error categorization
      const errorDetails = this.categorizeSDKError(error);
      
      testResult.capabilitiesTest = {
        status: 'failed',
        supportedMethods: [],
        error: `${errorDetails.type}: ${errorDetails.message}`,
        errorType: errorDetails.type,
        isRetryable: errorDetails.isRetryable
      };
      
      testResult.summary.issues.push(`Capabilities test failed (${errorDetails.type}): ${errorDetails.message}`);
      
      console.error(`[${new Date().toISOString()}] [MCP Test Debug] SDK capabilities test failed:`, {
        serverId: server.id,
        serverName: server.name,
        errorType: errorDetails.type,
        errorMessage: errorDetails.message,
        isRetryable: errorDetails.isRetryable
      });
    }
  }

  /**
   * Send MCP request for testing purposes
   */
  private async sendMCPRequest(server: MCPServerConnection, request: MCPRequest): Promise<MCPResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), server.timeoutSeconds * 1000);

    try {
      // Get session ID if available (use server.id for testing)
      const sessionContext = this.sessionCache.get(server.id);
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream', // Always include both
        'User-Agent': 'ContextFlow-AI/1.0',
        // Protocol version handled by SDK, // REQUIRED by MCP specification
        ...this.createAuthHeaders(server) // Add authentication headers
      };
      
      // Add session ID if available (REQUIRED if server provided one)
      if (sessionContext?.sessionId) {
        headers['Mcp-Session-Id'] = sessionContext.sessionId;
      }
      
      const response = await fetch(server.endpointUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new MCPConnectionError(
          server.id,
          server.endpointUrl,
          new Error(`HTTP ${response.status}: ${response.statusText}`)
        );
      }

      const responseText = await response.text();
      let result: MCPResponse;
      
      try {
        result = this.parseSSEResponse(responseText) as MCPResponse;
      } catch (parseError) {
        throw new MCPError('Invalid response format from MCP server', -32700, server.id);
      }

      return result;

    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new MCPTimeoutError(server.id, server.endpointUrl, `${server.timeoutSeconds * 1000}`);
      }
      
      if (error instanceof MCPError) {
        throw error;
      }
      
      throw new MCPConnectionError(server.id, server.endpointUrl, error);
    }
  }

  /**
   * Generate recommendations based on test results
   */
  private generateRecommendations(testResult: MCPServerTestResult): void {
    const recommendations: string[] = [];

    if (testResult.connectionTest.status === 'failed') {
      recommendations.push('Check that the MCP server is running and accessible');
      recommendations.push('Verify the endpoint URL is correct');
      recommendations.push('Ensure firewall/network settings allow connections');
    }

    if (testResult.protocolTest.status === 'failed') {
      recommendations.push('Verify the server implements MCP protocol version 2024-11-05 or compatible');
      recommendations.push('Check server logs for initialization errors');
    }

    if (testResult.toolsTest.status === 'failed') {
      recommendations.push('Ensure the server implements tools/list method');
      recommendations.push('Check if the server requires authentication or additional setup');
    }

    if (testResult.capabilitiesTest.status === 'failed') {
      recommendations.push('Server may have limited MCP method support');
      recommendations.push('Review server documentation for supported capabilities');
    }

    if (testResult.toolsTest.status === 'success' && testResult.toolsTest.toolCount === 0) {
      recommendations.push('Server is healthy but provides no tools - verify server configuration');
    }

    if (testResult.connectionTest.responseTimeMs && testResult.connectionTest.responseTimeMs > 5000) {
      recommendations.push('Server response time is slow - consider checking server performance');
    }

    testResult.summary.recommendations = recommendations;
  }

  /**
   * Update server health status based on test results
   */
  private async updateServerHealthFromTest(serverId: string, testResult: MCPServerTestResult): Promise<void> {
    try {
      let healthStatus = 'unhealthy';
      let errorMessage: string | null = null;

      if (testResult.overallStatus === 'success') {
        healthStatus = 'healthy';
      } else if (testResult.overallStatus === 'partial') {
        healthStatus = 'healthy'; // Partial success still considered healthy
        if (testResult.summary.issues.length > 0) {
          errorMessage = `Partial functionality: ${testResult.summary.issues.join('; ')}`;
        }
      } else {
        healthStatus = 'unhealthy';
        errorMessage = testResult.summary.issues.join('; ');
      }

      const query = `
        UPDATE mcp_servers 
        SET health_status = $1, 
            last_health_check = CURRENT_TIMESTAMP,
            sync_error_message = $2
        WHERE id = $3
      `;

      await pool.query(query, [healthStatus, errorMessage, serverId]);

    } catch (error) {
      console.error(`[${new Date().toISOString()}] Failed to update health status for MCP server ${serverId}:`, error);
      // Don't throw here - test results are more important than database updates
    }
  }

  // Private helper methods

  private getFromCache(serverId: string): MCPToolCache | null {
    return this.toolCache.get(serverId) || null;
  }

  /**
   * Update tool cache with SDK types
   * Phase 8: Updated to handle SDK Tool types and metadata
   */
  private updateCache(serverId: string, tools: SDKTool[]): void {
    const now = new Date();
    const cache: MCPToolCache = {
      serverId,
      tools,
      cachedAt: now,
      expiresAt: new Date(now.getTime() + this.CACHE_TTL_MS),
      // Phase 8: Add SDK metadata
      sdkClient: true
    };
    
    this.toolCache.set(serverId, cache);
  }

  private findServerById(servers: MCPServerConnection[], serverId: string): MCPServerConnection | undefined {
    return servers.find(server => server.id === serverId);
  }

  private generateRequestId(): string {
    return `mcp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get available tools for a specific MCP server (public API method)
   */
  async getAvailableTools(serverId: string): Promise<MCPToolDefinition[]> {
    try {
      const mcpServerModel = new MCPServerModel(pool);
      const server = await mcpServerModel.getWithDecryptedCredentials(serverId);
      
      if (!server) {
        throw new CustomError('MCP server not found', 404);
      }

      const serverConnection: MCPServerConnection = {
        id: server.id,
        name: server.name,
        endpointUrl: server.endpoint_url,
        timeoutSeconds: server.timeout_seconds || 30,
        rateLimitPerMinute: server.rate_limit_per_minute || 100,
        healthStatus: server.health_status || 'unknown',
        auth_type: server.auth_type || 'none',
        username: server.username,
        secret: server.secret,
        isActive: server.is_active
      };

      console.log(`[${new Date().toISOString()}] [MCP Tools Debug] Fetching tools for server:`, {
        serverId,
        serverName: server.name,
        endpoint: server.endpoint_url
      });

      // Phase 11.2: Use SDK-based getMCPServerTools instead of legacy fetchToolsFromServer
      const toolInstances = await this.getMCPServerTools(serverConnection);
      
      // Convert MCPToolInstance[] to MCPToolDefinition[] for API compatibility
      const tools = toolInstances.map(instance => instance.definition);
      
      console.log(`[${new Date().toISOString()}] [MCP Tools Debug] Successfully retrieved tools:`, {
        serverId,
        serverName: server.name,
        toolCount: tools.length,
        toolNames: tools.map(t => t.name)
      });

      return tools;
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Error getting available tools for server ${serverId}:`, error);
      throw new CustomError(
        `Failed to get available tools: ${error instanceof Error ? error.message : String(error)}`,
        500
      );
    }
  }

  /**
   * Execute a tool on a specific MCP server
   */
  async executeTool(serverId: string, toolName: string, toolArguments: Record<string, any>): Promise<MCPToolResult> {
    try {
      const mcpServerModel = new MCPServerModel(pool);
      const server = await mcpServerModel.getWithDecryptedCredentials(serverId);
      
      if (!server) {
        throw new CustomError('MCP server not found', 404);
      }

      const serverConnection: MCPServerConnection = {
        id: server.id,
        name: server.name,
        endpointUrl: server.endpoint_url,
        timeoutSeconds: server.timeout_seconds || 30,
        rateLimitPerMinute: server.rate_limit_per_minute || 100,
        healthStatus: server.health_status || 'unknown',
        auth_type: server.auth_type || 'none',
        username: server.username,
        secret: server.secret,
        isActive: server.is_active
      };

      console.log(`[${new Date().toISOString()}] [MCP Tool Execution Debug] Executing tool:`, {
        serverId,
        serverName: server.name,
        toolName,
        argumentKeys: Object.keys(toolArguments)
      });

      return await this.executeToolOnServer(serverConnection, toolName, toolArguments);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Error executing tool ${toolName} on server ${serverId}:`, error);
      throw new CustomError(
        `Failed to execute tool: ${error instanceof Error ? error.message : String(error)}`,
        500
      );
    }
  }

  /**
   * Execute a tool directly on MCP server
   * Phase 11.3: Migrated to use SDK client first, with legacy HTTP fallback
   */
  private async executeToolOnServer(
    server: MCPServerConnection, 
    toolName: string, 
    toolArguments: Record<string, any>
  ): Promise<MCPToolResult> {
    const requestId = this.generateRequestId();
    const startTime = Date.now();
    
    console.log(`[${new Date().toISOString()}] [MCP Tool Execution Debug] Starting tool execution:`, {
      serverId: server.id,
      serverName: server.name,
      endpoint: server.endpointUrl,
      requestId,
      toolName,
      argumentsProvided: Object.keys(toolArguments).length,
      timeoutMs: server.timeoutSeconds * 1000
    });

    // Phase 11.3: Try SDK client first (same pattern as Phase 11.2)
    try {
      console.log(`[${new Date().toISOString()}] [MCP Tool Execution Debug] Attempting SDK client execution`);
      
      // Get or create SDK client
      const client = await this._getOrCreateMcpClient(server);
      
      console.log(`[${new Date().toISOString()}] [MCP SDK] Using SDK client for tool execution (DEBUGGING):`, {
        serverId: server.id,
        serverName: server.name,
        toolName,
        requestId,
        clientType: typeof client,
        hasRequestMethod: typeof client.request === 'function'
      });
      
      // Execute tool using SDK client (same as MCPTool.ts does)
      const sdkResponse = await client.request({
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: toolArguments
        }
      }, CallToolResultSchema);
      
      const executionTime = Date.now() - startTime;
      
      console.log(`[${new Date().toISOString()}] [MCP SDK] Tool execution response:`, {
        serverId: server.id,
        serverName: server.name,
        toolName,
        requestId,
        executionTimeMs: executionTime,
        hasContent: !!(sdkResponse as any)?.content,
        contentLength: (sdkResponse as any)?.content?.length || 0,
        isError: (sdkResponse as any)?.isError,
        responseType: 'SDK_CALL_TOOL_RESULT'
      });
      
      // Validate and return SDK response
      if (sdkResponse && typeof sdkResponse === 'object') {
        console.log(`[${new Date().toISOString()}] [MCP Tool Execution Debug] SDK execution successful:`, {
          serverId: server.id,
          serverName: server.name,
          requestId,
          toolName,
          totalTimeMs: executionTime,
          resultContentCount: (sdkResponse as any).content?.length || 0,
          isError: (sdkResponse as any).isError || false
        });
        
        // Return in expected MCPToolResult format
        return {
          content: (sdkResponse as any).content || [],
          isError: (sdkResponse as any).isError || false
        };
      } else {
        throw new Error('Invalid SDK response format');
      }
      
    } catch (sdkError) {
      console.log(`[${new Date().toISOString()}] [MCP Tool Execution Debug] SDK execution failed, falling back to legacy HTTP:`, {
        serverId: server.id,
        serverName: server.name,
        requestId,
        toolName,
        sdkErrorMessage: sdkError instanceof Error ? sdkError.message : String(sdkError),
        sdkErrorType: sdkError.constructor.name
      });
      
      // Phase 11.3: Fallback to legacy HTTP implementation (for simple_auth and compatibility)
      return await this.executeToolOnServerLegacy(server, toolName, toolArguments, requestId, startTime);
    }
  }

  /**
   * Legacy HTTP implementation for tool execution
   * Used as fallback when SDK client is not available (e.g., simple_auth servers)
   */
  private async executeToolOnServerLegacy(
    server: MCPServerConnection, 
    toolName: string, 
    toolArguments: Record<string, any>,
    requestId: string,
    startTime: number
  ): Promise<MCPToolResult> {
    // Detect if server requires session management (if not already known)
    if (server.requiresSession === undefined) {
      server.requiresSession = await this.detectSessionRequirement(server);
    }
    
    // Ensure we have a session if required
    let sessionId: string | null = null;
    if (server.requiresSession) {
      sessionId = await this.ensureSession(server);
      if (!sessionId) {
        throw new MCPSessionError(server.id, 'Failed to establish session');
      }
    }
    
    const request: MCPRequest = {
      jsonrpc: '2.0',
      id: requestId,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: toolArguments
      }
    };
    
    console.log(`[${new Date().toISOString()}] [MCP Tool Execution Debug] Using legacy HTTP for tools/call request:`, {
      serverId: server.id,
      serverName: server.name,
      endpoint: server.endpointUrl,
      requestId,
      toolName,
      requiresSession: server.requiresSession,
      sessionId: sessionId ? sessionId.substring(0, 8) + '...' : null,
      argumentsProvided: Object.keys(toolArguments).length,
      timeoutMs: server.timeoutSeconds * 1000
    });

    const controller = new AbortController();
    const timeoutMs = server.timeoutSeconds * 1000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // Prepare headers
      const authHeaders = this.createAuthHeaders(server);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'User-Agent': 'ContextFlow-AI/1.0',
        // Protocol version handled by SDK,
        ...authHeaders
      };
      
      // Add session ID if available
      if (server.requiresSession && sessionId) {
        headers['Mcp-Session-Id'] = sessionId;
      }
      
      const response = await fetch(server.endpointUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        signal: controller.signal
      });
      
      const httpTime = Date.now() - startTime;
      clearTimeout(timeoutId);
      
      console.log(`[${new Date().toISOString()}] [MCP Tool Execution Debug] Legacy HTTP response received:`, {
        serverId: server.id,
        serverName: server.name,
        requestId,
        toolName,
        httpTimeMs: httpTime,
        statusCode: response.status,
        statusText: response.statusText
      });

      if (!response.ok) {
        let errorDetails = `HTTP ${response.status}: ${response.statusText}`;
        
        // Handle authentication errors
        if (response.status === 401) {
          errorDetails += '. Authentication failed - check credentials.';
        } else if (response.status === 403) {
          errorDetails += '. Access forbidden - check permissions.';
        } else if (response.status === 404) {
          errorDetails += '. Tool execution endpoint not found.';
        } else if (response.status >= 500) {
          errorDetails += '. MCP server encountered an internal error.';
        }
        
        throw new MCPConnectionError(server.id, server.endpointUrl, new Error(errorDetails));
      }
      
      const responseText = await response.text();
      console.log(`[${new Date().toISOString()}] [MCP Tool Execution Debug] Legacy raw response received:`, {
        serverId: server.id,
        serverName: server.name,
        requestId,
        toolName,
        responseLength: responseText.length,
        responsePreview: responseText.substring(0, 500) + (responseText.length > 500 ? '...' : '')
      });
      
      let mcpResponse: MCPResponse<MCPToolResult>;
      try {
        mcpResponse = this.parseSSEResponse(responseText) as MCPResponse<MCPToolResult>;
      } catch (parseError) {
        console.error(`[${new Date().toISOString()}] [MCP Tool Execution Debug] Failed to parse legacy response:`, {
          serverId: server.id,
          serverName: server.name,
          requestId,
          toolName,
          parseError: parseError instanceof Error ? parseError.message : String(parseError),
          responseText: responseText.substring(0, 1000)
        });
        throw new MCPError('Invalid response format from MCP server', -32700, server.id);
      }
      
      console.log(`[${new Date().toISOString()}] [MCP Tool Execution Debug] Legacy parsed response:`, {
        serverId: server.id,
        serverName: server.name,
        requestId,
        toolName,
        responseId: mcpResponse.id,
        hasResult: !!mcpResponse.result,
        hasError: !!mcpResponse.error
      });
      
      if (mcpResponse.error) {
        console.error(`[${new Date().toISOString()}] [MCP Tool Execution Debug] MCP server returned error:`, {
          serverId: server.id,
          serverName: server.name,
          requestId,
          toolName,
          errorCode: mcpResponse.error.code,
          errorMessage: mcpResponse.error.message,
          errorData: mcpResponse.error.data
        });
        
        // Return error result instead of throwing for better debugging
        return {
          content: [{
            type: 'text',
            text: `Tool execution failed: ${mcpResponse.error.message}`
          }],
          isError: true
        };
      }

      if (!mcpResponse.result) {
        console.error(`[${new Date().toISOString()}] [MCP Tool Execution Debug] No result in legacy response:`, {
          serverId: server.id,
          serverName: server.name,
          requestId,
          toolName,
          response: mcpResponse
        });
        throw new MCPError('No result in MCP response', -32603, server.id);
      }
      
      console.log(`[${new Date().toISOString()}] [MCP Tool Execution Debug] Legacy tool execution successful:`, {
        serverId: server.id,
        serverName: server.name,
        requestId,
        toolName,
        totalTimeMs: Date.now() - startTime,
        resultContentCount: mcpResponse.result.content?.length || 0
      });

      return mcpResponse.result;

    } catch (error) {
      const totalTime = Date.now() - startTime;
      clearTimeout(timeoutId);
      
      if (error instanceof DOMException && error.name === 'AbortError') {
        console.error(`[${new Date().toISOString()}] [MCP Tool Execution Debug] Legacy request timeout:`, {
          serverId: server.id,
          serverName: server.name,
          requestId,
          toolName,
          timeoutMs,
          totalTimeMs: totalTime
        });
        throw new MCPTimeoutError(server.id, server.endpointUrl, `${timeoutMs}`);
      }
      
      if (error instanceof MCPError) {
        console.error(`[${new Date().toISOString()}] [MCP Tool Execution Debug] Legacy MCP error:`, {
          serverId: server.id,
          serverName: server.name,
          requestId,
          toolName,
          mcpErrorCode: error.code,
          mcpErrorMessage: error.message,
          totalTimeMs: totalTime
        });
        throw error;
      }
      
      console.error(`[${new Date().toISOString()}] [MCP Tool Execution Debug] Legacy unexpected error:`, {
        serverId: server.id,
        serverName: server.name,
        requestId,
        toolName,
        errorType: error.constructor.name,
        errorMessage: error instanceof Error ? error.message : String(error),
        totalTimeMs: totalTime
      });
      
      throw new MCPConnectionError(server.id, server.endpointUrl, error);
    }
  }
}

export default MCPToolsService.getInstance();