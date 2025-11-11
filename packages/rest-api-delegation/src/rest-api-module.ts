/**
 * REST API Delegation Module
 *
 * Production-ready delegation module for integrating with REST APIs.
 * Supports token exchange for API-specific JWT authentication and API key fallback.
 *
 * @module @mcp-oauth/rest-api-delegation
 */

import type { UserSession, AuditEntry } from 'mcp-oauth-framework/core';
import type { DelegationModule, DelegationResult } from 'mcp-oauth-framework/delegation';

/**
 * REST API configuration
 */
export interface RestAPIConfig {
  /** Base URL of the REST API (e.g., 'https://api.example.com') */
  baseUrl: string;

  /** Optional API key for fallback authentication (if token exchange unavailable) */
  apiKey?: string;

  /** Whether to use token exchange for authentication */
  useTokenExchange: boolean;

  /** Audience for token exchange requests (default: 'urn:api:rest') */
  tokenExchangeAudience?: string;

  /** Optional default request timeout in milliseconds */
  timeout?: number;

  /** Optional custom headers to include in all requests */
  defaultHeaders?: Record<string, string>;
}

/**
 * REST API Delegation Module
 *
 * This module enables MCP tools to delegate operations to external REST APIs.
 * It supports two authentication modes:
 * 1. Token exchange: Exchange requestor JWT for API-specific token (recommended)
 * 2. API key: Use static API key for authentication (fallback)
 *
 * **Multi-Instance Support:**
 * Multiple REST API modules can be registered with different names (e.g., 'rest-api1', 'rest-api2').
 * Each instance has independent configuration, connection, and token exchange settings.
 *
 * @example Single instance
 * ```typescript
 * import { RestAPIDelegationModule } from '@mcp-oauth/rest-api-delegation';
 *
 * const module = new RestAPIDelegationModule();
 * await module.initialize({
 *   baseUrl: 'https://api.example.com',
 *   useTokenExchange: true,
 *   tokenExchangeAudience: 'urn:api:example'
 * });
 *
 * coreContext.delegationRegistry.register(module);
 * ```
 *
 * @example Multiple instances
 * ```typescript
 * const api1 = new RestAPIDelegationModule('rest-api1');
 * await api1.initialize({ baseUrl: 'https://internal-api.com', ... });
 *
 * const api2 = new RestAPIDelegationModule('rest-api2');
 * await api2.initialize({ baseUrl: 'https://partner-api.com', ... });
 * ```
 */
export class RestAPIDelegationModule implements DelegationModule {
  readonly name: string;
  readonly type = 'api';

  private config: RestAPIConfig | null = null;
  private tokenExchangeService?: any;
  private tokenExchangeConfig?: any;

  /**
   * Create a new REST API delegation module
   *
   * @param name - Module name (e.g., 'rest-api', 'rest-api1', 'rest-api2')
   *               Defaults to 'rest-api' for backward compatibility
   */
  constructor(name: string = 'rest-api') {
    this.name = name;
  }

  /**
   * Initialize module with configuration
   */
  async initialize(config: RestAPIConfig): Promise<void> {
    this.config = config;
    console.log(`[RestAPI:${this.name}] Module initialized: ${config.baseUrl}`);
    console.log(`[RestAPI:${this.name}] Token exchange: ${config.useTokenExchange ? 'enabled' : 'disabled'}`);

    if (!config.useTokenExchange && !config.apiKey) {
      console.warn(`[RestAPI:${this.name}] WARNING: Neither token exchange nor API key configured - authentication may fail`);
    }
  }

  /**
   * Set token exchange service (called by ConfigOrchestrator)
   */
  setTokenExchangeService(
    service: any,
    config: {
      tokenEndpoint: string;
      clientId: string;
      clientSecret: string;
      audience?: string;
    }
  ): void {
    console.log(`[RestAPI:${this.name}] Token exchange service configured`);
    this.tokenExchangeService = service;
    this.tokenExchangeConfig = config;
  }

  /**
   * Delegate action to REST API
   *
   * @param session - User session from authentication
   * @param action - Action name (used as endpoint if not overridden in params)
   * @param params - Parameters for the API request
   * @param params.endpoint - API endpoint (overrides action)
   * @param params.method - HTTP method (default: 'POST')
   * @param params.data - Request body data (for POST/PUT/PATCH)
   * @param params.query - Query parameters (for GET)
   * @param params.headers - Additional headers
   * @param context - Request context (sessionId, coreContext)
   *
   * @example
   * ```typescript
   * const result = await module.delegate(session, 'users/profile', {
   *   endpoint: 'users/123/profile',
   *   method: 'GET'
   * }, { sessionId, coreContext });
   * ```
   */
  async delegate<T = unknown>(
    session: UserSession,
    action: string,
    params: any,
    context?: {
      sessionId?: string;
      coreContext?: any;
    }
  ): Promise<DelegationResult<T>> {
    if (!this.config) {
      throw new Error('RestAPIDelegationModule not initialized');
    }

    const auditEntry: AuditEntry = {
      timestamp: new Date(),
      source: `delegation:${this.name}`,
      userId: session.userId,
      action: `${this.name}:${action}`,
      success: false,
      metadata: { action, params },
    };

    try {
      // Step 1: Determine authentication method
      let authHeader: string;

      if (this.config.useTokenExchange && this.tokenExchangeService) {
        // Use token exchange
        console.log(`[RestAPI:${this.name}] Using token exchange for authentication`);
        const delegationToken = await this.performTokenExchange(session, context);
        authHeader = `Bearer ${delegationToken}`;
        auditEntry.metadata = { ...auditEntry.metadata, authMethod: 'token-exchange' };
      } else if (this.config.apiKey) {
        // Use API key fallback
        console.log(`[RestAPI:${this.name}] Using API key for authentication`);
        authHeader = `Bearer ${this.config.apiKey}`;
        auditEntry.metadata = { ...auditEntry.metadata, authMethod: 'api-key' };
      } else {
        throw new Error('No authentication method configured (need token exchange or API key)');
      }

      // Step 2: Build API request
      const endpoint = params.endpoint || action;
      const method = params.method || 'POST';
      const url = `${this.config.baseUrl}/${endpoint}`;

      console.log(`[RestAPI:${this.name}] ${method} ${url}`);

      // Build headers
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
        'X-User-ID': session.userId,
        'X-User-Role': session.role,
        ...this.config.defaultHeaders,
        ...params.headers,
      };

      // Build request options
      const requestOptions: RequestInit = {
        method,
        headers,
      };

      // Add body for non-GET requests
      if (method !== 'GET' && params.data) {
        requestOptions.body = JSON.stringify(params.data);
      }

      // Add timeout if configured
      if (this.config.timeout) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);
        requestOptions.signal = controller.signal;

        try {
          const response = await fetch(url, requestOptions);
          clearTimeout(timeoutId);
          return await this.handleResponse<T>(response, auditEntry, endpoint, method);
        } catch (error) {
          clearTimeout(timeoutId);
          throw error;
        }
      } else {
        const response = await fetch(url, requestOptions);
        return await this.handleResponse<T>(response, auditEntry, endpoint, method);
      }
    } catch (error) {
      auditEntry.error = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[RestAPI:${this.name}] Error:`, auditEntry.error);

      return {
        success: false,
        error: auditEntry.error,
        auditTrail: auditEntry,
      };
    }
  }

  /**
   * Handle API response
   */
  private async handleResponse<T>(
    response: Response,
    auditEntry: AuditEntry,
    endpoint: string,
    method: string
  ): Promise<DelegationResult<T>> {
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`API error: ${response.status} ${response.statusText} - ${errorBody}`);
    }

    // Handle empty responses
    const contentType = response.headers.get('content-type');
    let data: any;

    if (contentType?.includes('application/json')) {
      data = await response.json();
    } else if (response.status === 204) {
      data = null; // No content
    } else {
      data = await response.text();
    }

    auditEntry.success = true;
    auditEntry.metadata = {
      ...auditEntry.metadata,
      statusCode: response.status,
      endpoint,
      method,
    };

    return {
      success: true,
      data: data as T,
      auditTrail: auditEntry,
    };
  }

  /**
   * Perform token exchange to get API-specific JWT
   */
  private async performTokenExchange(
    session: UserSession,
    context?: { sessionId?: string; coreContext?: any }
  ): Promise<string> {
    if (!this.tokenExchangeService) {
      throw new Error('TokenExchangeService not available');
    }

    const requestorJWT = session.claims?.access_token as string;
    if (!requestorJWT) {
      throw new Error('Session missing access_token for token exchange');
    }

    // Exchange requestor JWT for API-specific token
    const delegationToken = await this.tokenExchangeService.performExchange({
      requestorJWT,
      audience: this.config?.tokenExchangeAudience || 'urn:api:rest',
      scope: 'api:read api:write',
      sessionId: context?.sessionId, // Enable token caching
    });

    return delegationToken;
  }

  /**
   * Validate that a session has access to this module
   */
  async validateAccess(session: UserSession): Promise<boolean> {
    // Basic validation: session must exist and have userId
    if (!session || !session.userId) {
      return false;
    }

    // Allow access for all authenticated users by default
    // Subclasses can override for more specific access control
    return true;
  }

  /**
   * Health check - verify API is accessible
   */
  async healthCheck(): Promise<boolean> {
    if (!this.config) {
      return false;
    }

    try {
      const response = await fetch(`${this.config.baseUrl}/health`, {
        method: 'GET',
        headers: this.config.apiKey ? { 'Authorization': `Bearer ${this.config.apiKey}` } : {},
      });
      return response.ok;
    } catch (error) {
      console.error(`[RestAPI:${this.name}] Health check failed:`, error);
      return false;
    }
  }

  /**
   * Cleanup resources
   */
  async destroy(): Promise<void> {
    console.log(`[RestAPI:${this.name}] Module destroyed`);
    this.config = null;
    this.tokenExchangeService = undefined;
    this.tokenExchangeConfig = undefined;
  }
}
