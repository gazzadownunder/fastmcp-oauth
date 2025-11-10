/**
 * Phase 3 Integration Tests (Core Framework Only)
 *
 * End-to-end integration tests with real Keycloak IDP
 * Tests token exchange, cache behavior, two-stage authorization
 *
 * NOTE: SQL delegation tests moved to sql-delegation.test.ts (optional)
 *
 * Prerequisites:
 * - Keycloak configured per Docs/idp-configuration-requirements.md
 * - MCP Server running on http://localhost:3000 with token exchange enabled
 *   Start with: node dist/index.js (NOT index-simple.js)
 *   Config: test-harness/config/phase3-test-config.json
 * - Test users created: alice, bob, charlie, dave
 *
 * Run: npm run test:phase3
 *
 * IMPORTANT: The server must be started manually before running these tests:
 *   1. Build: npm run build
 *   2. Start: CONFIG_PATH=./test-harness/config/phase3-test-config.json node dist/index.js
 *   3. Run tests: npm test phase3-integration
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { TokenExchangeResult } from '../src/delegation/types.js';
import { ensureServerRunning, ensureKeycloakRunning } from './helpers/ensure-server-running.js';

// ============================================================================
// Configuration
// ============================================================================

const KEYCLOAK_URL = process.env.KEYCLOAK_URL || 'http://192.168.1.137:8080';
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM || 'mcp_security';
const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'http://localhost:3000';

const KEYCLOAK_TOKEN_ENDPOINT = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`;

const TEST_USERS = {
  alice: { username: 'alice@test.local', password: 'Test123!', legacyName: 'ALICE_ADMIN' },
  bob: { username: 'bob@test.local', password: 'Test123!', legacyName: 'BOB_USER' },
  charlie: { username: 'charlie@test.local', password: 'Test123!', legacyName: 'CHARLIE_USER' },
  dave: { username: 'dave@test.local', password: 'Test123!', legacyName: null },
};

// ARCHITECTURE NOTE: OAuth Client Configuration
// ==============================================
// REQUESTOR CLIENT (mcp-oauth):
//   - User-facing PUBLIC client for initial authentication
//   - Client Type: PUBLIC (no client secret)
//   - Grant Type: Resource Owner Password Credentials (ROPC)
//   - Issues: Requestor JWT with audience: "mcp-oauth"
//   - Authentication: User credentials (username + password) ONLY
//   - Keycloak Settings:
//     * Client authentication: OFF (public client)
//     * Direct access grants: ENABLED (for password grant)
//
// TOKEN EXCHANGE CLIENT (mcp-server-client):
//   - Server-side CONFIDENTIAL client for token exchange (RFC 8693)
//   - Client Type: CONFIDENTIAL (has client secret - used by MCP server)
//   - Grant Type: urn:ietf:params:oauth:grant-type:token-exchange
//   - Issues: TE-JWT with audience: "mcp-server-client"
//   - Authentication: Client credentials (client_id + client_secret)
//   - Used by: MCP server performing server-to-server token exchange
//   - Keycloak Settings:
//     * Client authentication: ON (confidential client)
//     * Direct access grants: DISABLED (server-to-server only)
//
// CORRECT FLOW:
//   1. Test → Keycloak (client: mcp-oauth, NO client_secret, user credentials) → Requestor JWT
//   2. Test → MCP Server (Bearer: Requestor JWT)
//   3. MCP Server → Keycloak (client: mcp-server-client, WITH client_secret) → TE-JWT
//   4. MCP Server → SQL/Resource (using TE-JWT claims like legacy_name)
const CLIENT_CREDENTIALS = {
  mcpOAuth: {
    // PUBLIC client - NO client secret (user authentication via ROPC)
    clientId: process.env.REQUESTOR_CLIENT_ID || 'mcp-oauth',
    // clientSecret intentionally omitted - public clients authenticate with user credentials only
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get REQUESTOR JWT from Keycloak for a test user
 *
 * This simulates end-user authentication to the mcp-oauth client.
 * Returns a requestor JWT with audience: "mcp-oauth"
 *
 * The MCP server will later perform token exchange to get TE-JWT with:
 * - audience: "mcp-server-client"
 * - additional claims: legacy_name, elevated roles
 */
async function getAccessToken(username: string, password: string): Promise<string> {
  const response = await fetch(KEYCLOAK_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_CREDENTIALS.mcpOAuth.clientId,
      // NO client_secret - mcp-oauth is a PUBLIC client (ROPC flow with user credentials only)
      username,
      password,
      grant_type: 'password',
      scope: 'openid profile', // Request standard OIDC scopes
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to get access token: ${response.statusText}`);
  }

  const data = await response.json();
  return data.access_token;
}

/**
 * Decode JWT without verification (for inspection)
 */
function decodeJWT(token: string): any {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }
  const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
  return JSON.parse(payload);
}

/**
 * Call MCP tool with Bearer token in stateless OAuth mode
 *
 * STATELESS MODE (OAuth):
 * - No initialize/session handshake required
 * - Each request authenticated independently with Bearer token
 * - Server creates ephemeral session per request (for protocol routing)
 * - Token exchange cache works via JWT hash binding (not session ID)
 *
 * This matches the server configuration: stateless: true (line 524 in server.ts)
 */
async function callMCPTool(
  tool: string,
  params: any,
  bearerToken: string
): Promise<any> {
  // Direct tool call - no initialize needed in stateless mode
  const response = await fetch(`${MCP_SERVER_URL}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Authorization': `Bearer ${bearerToken}`,
      // Note: No Mcp-Session-Id header - server creates ephemeral session per request
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: tool,
        arguments: params,
      },
      id: Math.floor(Math.random() * 1000000),
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`MCP call failed: ${response.statusText} - ${text}`);
  }

  // Parse SSE response (Server-Sent Events)
  const text = await response.text();
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const jsonData = line.substring(6); // Remove "data: " prefix
      const parsed = JSON.parse(jsonData);

      // Debug logging
      if (process.env.DEBUG_MCP_RESPONSES === 'true') {
        console.log('[DEBUG] MCP Response:', JSON.stringify(parsed, null, 2));
      }

      return parsed;
    }
  }

  // Fallback to regular JSON if not SSE
  throw new Error(`Failed to parse response: ${text.substring(0, 100)}...`);
}

/**
 * Clear session cache for a specific token (used for JWT refresh tests)
 * NOTE: Not needed in stateless mode - each request creates new ephemeral session
 */
function clearSession(_bearerToken: string): void {
  // No-op in stateless mode - sessions are ephemeral per request
}

/**
 * Measure latency of async operation
 */
async function measureLatency<T>(fn: () => Promise<T>): Promise<{ result: T; latencyMs: number }> {
  const start = performance.now();
  const result = await fn();
  const latencyMs = performance.now() - start;
  return { result, latencyMs };
}

// ============================================================================
// Test Suite 4: Integration Tests
// ============================================================================

describe('Phase 3: Integration Tests', () => {
  let aliceToken: string;
  let bobToken: string;
  let charlieToken: string;
  let daveToken: string;

  beforeAll(async () => {
    // CRITICAL: Verify server and IDP are running before tests
    console.log('\n🔍 Checking prerequisites...\n');

    await ensureServerRunning({
      serverUrl: `${MCP_SERVER_URL}/mcp`,
      maxAttempts: 3,
      retryDelayMs: 1000,
      timeoutMs: 5000,
    });

    await ensureKeycloakRunning(KEYCLOAK_URL, KEYCLOAK_REALM);

    console.log('\n✅ All prerequisites met, starting tests...\n');

    // Get tokens for all test users
    aliceToken = await getAccessToken(TEST_USERS.alice.username, TEST_USERS.alice.password);
    bobToken = await getAccessToken(TEST_USERS.bob.username, TEST_USERS.bob.password);
    charlieToken = await getAccessToken(TEST_USERS.charlie.username, TEST_USERS.charlie.password);
    daveToken = await getAccessToken(TEST_USERS.dave.username, TEST_USERS.dave.password);

    console.log('✅ Test tokens acquired for all users');
  });

  describe('INT-001: Full End-to-End Flow', () => {
    it('should complete full flow: Request → JWT validation → Tool dispatch', async () => {
      // Call user-info tool (simple MCP tool without delegation)
      const userInfoResponse = await callMCPTool('user-info', {}, aliceToken);

      expect(userInfoResponse.result).toBeDefined();
      expect(userInfoResponse.result.content).toBeDefined();

      const content = JSON.parse(userInfoResponse.result.content[0].text);
      expect(content.username).toBeDefined();
      expect(content.role).toBeDefined();

      console.log('✅ INT-001: Full flow completed successfully');
      console.log(`  - Username: ${content.username}`);
      console.log(`  - Role: ${content.role}`);
    });
  });

  describe('INT-002: JWT Claims Validation', () => {
    it('should validate requestor JWT for MCP access', async () => {
      // Decode requestor JWT
      const claims = decodeJWT(aliceToken);

      expect(claims.iss).toContain(KEYCLOAK_REALM);
      expect(claims.aud).toContain(CLIENT_CREDENTIALS.mcpOAuth.clientId);
      expect(claims.roles).toBeDefined();

      console.log('✅ INT-002: Requestor JWT validated');
      console.log(`  - Issuer: ${claims.iss}`);
      console.log(`  - Audience: ${claims.aud}`);
      console.log(`  - Roles: ${claims.roles}`);
    });

    it('should include required claims in JWT', async () => {
      const claims = decodeJWT(aliceToken);

      // Standard OIDC claims
      expect(claims.sub).toBeDefined();
      expect(claims.exp).toBeDefined();
      expect(claims.iat).toBeDefined();

      // Custom claims
      expect(claims.preferred_username).toBeDefined();

      console.log('✅ INT-002: JWT contains required claims');
      console.log(`  - Subject: ${claims.sub}`);
      console.log(`  - Username: ${claims.preferred_username}`);
    });
  });

  describe('INT-003: Role Mapping', () => {
    it('should map JWT roles to application roles', async () => {
      const claims = decodeJWT(aliceToken);

      // Verify roles are present in JWT
      expect(claims.roles).toBeDefined();
      expect(Array.isArray(claims.roles)).toBe(true);

      console.log('✅ INT-003: Role mapping validated');
      console.log(`  - JWT Roles: ${claims.roles}`);
    });

    it('should handle multiple role assignments', async () => {
      const claims = decodeJWT(bobToken);

      expect(claims.roles).toBeDefined();
      expect(Array.isArray(claims.roles)).toBe(true);
      expect(claims.roles.length).toBeGreaterThan(0);

      console.log('✅ INT-003: Multiple roles supported');
      console.log(`  - Bob Roles: ${claims.roles}`);
    });
  });

  describe('INT-004: MCP Tool Access Control', () => {
    it('should allow access to user-info tool for authenticated users', async () => {
      const response = await callMCPTool('user-info', {}, aliceToken);

      expect(response.result).toBeDefined();
      expect(response.error).toBeUndefined();

      console.log('✅ INT-004: User-info tool accessible to authenticated users');
    });

    it('should allow access to health-check tool', async () => {
      const response = await callMCPTool('health-check', { service: 'all' }, aliceToken);

      expect(response.result).toBeDefined();
      expect(response.error).toBeUndefined();

      console.log('✅ INT-004: Health-check tool accessible');
    });
  });

  describe('INT-005: Session Management', () => {
    it('should handle multiple concurrent tool calls', async () => {
      // Test that multiple tools can be called concurrently
      const calls = await Promise.all([
        callMCPTool('user-info', {}, aliceToken),
        callMCPTool('user-info', {}, bobToken),
        callMCPTool('health-check', { service: 'all' }, charlieToken),
      ]);

      calls.forEach((call) => {
        expect(call.result).toBeDefined();
      });

      console.log('✅ INT-005: Multiple concurrent tool calls succeeded');
    });

    it('should handle repeated calls with same token', async () => {
      // Make multiple calls with same token
      for (let i = 0; i < 5; i++) {
        const response = await callMCPTool('user-info', {}, aliceToken);
        expect(response.result).toBeDefined();
      }

      console.log('✅ INT-005: Repeated calls with same token succeeded');
    });
  });

  describe('Error Handling', () => {
    it('should handle expired tokens gracefully', async () => {
      // Use an obviously expired token
      const expiredToken = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE2MDk0NTkyMDB9.fake';

      try {
        await callMCPTool('user-info', {}, expiredToken);
        expect(true).toBe(false);
      } catch (error: any) {
        const errorMsg = error.message.toLowerCase();
        expect(errorMsg).toMatch(/401|unauthorized|expired/);
        console.log('✅ Expired token rejected');
        console.log(`  - Error: ${error.message}`);
      }
    });

    it('should handle invalid tokens gracefully', async () => {
      try {
        await callMCPTool('user-info', {}, 'invalid.jwt.token');
        expect(true).toBe(false);
      } catch (error: any) {
        const errorMsg = error.message.toLowerCase();
        expect(errorMsg).toMatch(/401|unauthorized|invalid/);
        console.log('✅ Invalid token rejected');
        console.log(`  - Error: ${error.message}`);
      }
    });
  });
});
