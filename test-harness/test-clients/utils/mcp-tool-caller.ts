/**
 * Helper utility for calling MCP server tools
 */

export interface MCPToolRequest {
  tool: string;
  arguments: Record<string, any>;
}

export interface MCPToolResponse {
  success: boolean;
  data?: any;
  error?: string;
  timestamp: string;
}

export interface MCPConfig {
  serverUrl: string;
}

export class MCPToolCaller {
  private config: MCPConfig;

  constructor(config: MCPConfig) {
    this.config = config;
  }

  /**
   * Load configuration from environment
   */
  static loadFromEnv(): MCPToolCaller {
    return new MCPToolCaller({
      serverUrl: process.env.MCP_SERVER_URL || 'http://localhost:3000',
    });
  }

  /**
   * Call an MCP tool with Bearer token authentication
   */
  async callTool(
    toolName: string,
    args: Record<string, any>,
    token: string
  ): Promise<MCPToolResponse> {
    const url = `${this.config.serverUrl}/mcp/tools/${toolName}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(args),
      });

      const responseText = await response.text();

      // Try to parse as JSON
      let responseData: any;
      try {
        responseData = JSON.parse(responseText);
      } catch {
        responseData = { raw: responseText };
      }

      if (!response.ok) {
        return {
          success: false,
          error: responseData.error || `HTTP ${response.status}: ${response.statusText}`,
          data: responseData,
          timestamp: new Date().toISOString(),
        };
      }

      return {
        success: true,
        data: responseData,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Call sql-delegate tool
   */
  async sqlDelegate(
    action: 'query' | 'procedure' | 'function',
    token: string,
    options: {
      sql?: string;
      procedure?: string;
      functionName?: string;
      params?: Record<string, any>;
      resource?: string;
    }
  ): Promise<MCPToolResponse> {
    return this.callTool('sql-delegate', { action, ...options }, token);
  }

  /**
   * Call user-info tool
   */
  async userInfo(token: string): Promise<MCPToolResponse> {
    return this.callTool('user-info', {}, token);
  }

  /**
   * Call health-check tool
   */
  async healthCheck(
    token: string,
    service: 'sql' | 'kerberos' | 'all' = 'all'
  ): Promise<MCPToolResponse> {
    return this.callTool('health-check', { service }, token);
  }

  /**
   * Call audit-log tool (admin only)
   */
  async auditLog(
    token: string,
    options: {
      limit?: number;
      userId?: string;
      action?: string;
      success?: boolean;
    } = {}
  ): Promise<MCPToolResponse> {
    return this.callTool('audit-log', options, token);
  }

  /**
   * Check if MCP server is reachable
   */
  async isServerReachable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.serverUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get server URL
   */
  getServerUrl(): string {
    return this.config.serverUrl;
  }
}