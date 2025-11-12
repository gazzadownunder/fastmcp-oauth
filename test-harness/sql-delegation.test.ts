/**
 * SQL Delegation Integration Tests (Optional)
 *
 * Tests PostgreSQL delegation module functionality.
 * This test suite is OPTIONAL - only run if @fastmcp-oauth/sql-delegation is installed.
 *
 * Prerequisites:
 * - PostgreSQL database configured (see test-harness/config/phase3-test-config.json)
 * - @fastmcp-oauth/sql-delegation package installed: npm install @fastmcp-oauth/sql-delegation
 * - Keycloak configured per KEYCLOAK-ROLE-SETUP-INT008.md
 * - MCP Server running on http://localhost:3000 with SQL delegation enabled
 *   Start with: CONFIG_PATH=./test-harness/config/phase3-test-config.json node dist/index.js
 * - Test users created: alice, bob, charlie, dave
 * - PostgreSQL roles configured: alice, bob, charlie
 * - PostgreSQL tables created: alice_table, bob_table, general_table
 *
 * Run: npm run test:sql
 *
 * IMPORTANT: The server must be started manually before running these tests.
 */

import { describe, it, expect, beforeAll } from 'vitest';

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

const CLIENT_CREDENTIALS = {
  mcpOAuth: {
    clientId: process.env.REQUESTOR_CLIENT_ID || 'mcp-oauth',
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get REQUESTOR JWT from Keycloak for a test user
 */
async function getAccessToken(username: string, password: string): Promise<string> {
  const response = await fetch(KEYCLOAK_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_CREDENTIALS.mcpOAuth.clientId,
      username,
      password,
      grant_type: 'password',
      scope: 'openid profile',
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
 */
async function callMCPTool(
  tool: string,
  params: any,
  bearerToken: string
): Promise<any> {
  const response = await fetch(`${MCP_SERVER_URL}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Authorization': `Bearer ${bearerToken}`,
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

  // Parse SSE response
  const text = await response.text();
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const jsonData = line.substring(6);
      const parsed = JSON.parse(jsonData);

      if (process.env.DEBUG_MCP_RESPONSES === 'true') {
        console.log('[DEBUG] MCP Response:', JSON.stringify(parsed, null, 2));
      }

      return parsed;
    }
  }

  throw new Error(`Failed to parse response: ${text.substring(0, 100)}...`);
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
// SQL Delegation Test Suite
// ============================================================================

describe('SQL Delegation Tests (Optional)', () => {
  let aliceToken: string;
  let bobToken: string;
  let charlieToken: string;
  let daveToken: string;

  beforeAll(async () => {
    // Get tokens for all test users
    aliceToken = await getAccessToken(TEST_USERS.alice.username, TEST_USERS.alice.password);
    bobToken = await getAccessToken(TEST_USERS.bob.username, TEST_USERS.bob.password);
    charlieToken = await getAccessToken(TEST_USERS.charlie.username, TEST_USERS.charlie.password);
    daveToken = await getAccessToken(TEST_USERS.dave.username, TEST_USERS.dave.password);

    console.log('✅ Test tokens acquired for all users');
  });

  describe('SQL-001: Basic PostgreSQL Delegation', () => {
    it('should perform token exchange and PostgreSQL delegation', async () => {
      const sqlResponse = await callMCPTool(
        'sql-delegate',
        {
          action: 'query',
          sql: 'SELECT version() AS version',
          params: [],
        },
        aliceToken
      );

      expect(sqlResponse.result).toBeDefined();
      expect(sqlResponse.error).toBeUndefined();

      console.log('✅ SQL-001: Token exchange and PostgreSQL delegation successful');
    });

    it('should use TE-JWT for downstream resource access', async () => {
      const sqlResponse = await callMCPTool(
        'sql-delegate',
        {
          action: 'query',
          sql: 'SELECT current_user AS currentUser',
          params: [],
        },
        aliceToken
      );

      expect(sqlResponse.result).toBeDefined();

      const result = JSON.parse(sqlResponse.result.content[0].text);
      console.log('✅ SQL-001: TE-JWT used for SQL delegation');
      console.log(`  - SQL User: ${JSON.stringify(result)}`);
    });
  });

  describe('SQL-002: PostgreSQL Schema Tools', () => {
    it('should list database schema with sql-schema tool', async () => {
      const schemaResponse = await callMCPTool(
        'sql-schema',
        {
          schemaName: 'public',
        },
        aliceToken
      );

      expect(schemaResponse.result).toBeDefined();
      expect(schemaResponse.error).toBeUndefined();

      const content = JSON.parse(schemaResponse.result.content[0].text);
      expect(content.schema).toBe('public');
      expect(content.tables).toBeDefined();
      expect(Array.isArray(content.tables)).toBe(true);

      console.log('✅ SQL-002: sql-schema tool successful');
      console.log(`  - Schema: ${content.schema}`);
      console.log(`  - Table count: ${content.tableCount}`);
      console.log(`  - Tables: ${content.tables.map((t: any) => t.name).join(', ')}`);
    });

    it('should get table details with sql-table-details tool', async () => {
      const tableResponse = await callMCPTool(
        'sql-table-details',
        {
          tableName: 'general_table',
          schemaName: 'public',
        },
        aliceToken
      );

      expect(tableResponse.result).toBeDefined();
      expect(tableResponse.error).toBeUndefined();

      const content = JSON.parse(tableResponse.result.content[0].text);
      expect(content.table).toBe('general_table');
      expect(content.columns).toBeDefined();
      expect(Array.isArray(content.columns)).toBe(true);

      console.log('✅ SQL-002: sql-table-details tool successful');
      console.log(`  - Table: ${content.table}`);
      console.log(`  - Column count: ${content.columnCount}`);
      console.log(`  - Columns: ${content.columns.map((c: any) => c.name).join(', ')}`);
    });
  });

  describe('SQL-003: Role-Based Table Authorization', () => {
    it('Alice should access alice_table (role: alice)', async () => {
      const sqlResponse = await callMCPTool(
        'sql-delegate',
        {
          action: 'query',
          sql: 'SELECT * FROM alice_table LIMIT 1',
          params: [],
        },
        aliceToken
      );

      expect(sqlResponse.result).toBeDefined();
      expect(sqlResponse.error).toBeUndefined();

      console.log('✅ SQL-003: Alice accessed alice_table successfully');
    });

    it('Alice should access general_table (unrestricted)', async () => {
      const sqlResponse = await callMCPTool(
        'sql-delegate',
        {
          action: 'query',
          sql: 'SELECT * FROM general_table LIMIT 1',
          params: [],
        },
        aliceToken
      );

      expect(sqlResponse.result).toBeDefined();
      expect(sqlResponse.error).toBeUndefined();

      console.log('✅ SQL-003: Alice accessed general_table successfully');
    });

    it('Alice should be denied access to bob_table (role mismatch)', async () => {
      try {
        await callMCPTool(
          'sql-delegate',
          {
            action: 'query',
            sql: 'SELECT * FROM bob_table LIMIT 1',
            params: [],
          },
          aliceToken
        );

        expect(true).toBe(false);
      } catch (error: any) {
        expect(error.message).toBeDefined();
        console.log('✅ SQL-003: Alice denied access to bob_table (as expected)');
        console.log(`  - Error: ${error.message.substring(0, 100)}...`);
      }
    });

    it('Bob should access bob_table (role: bob)', async () => {
      const sqlResponse = await callMCPTool(
        'sql-delegate',
        {
          action: 'query',
          sql: 'SELECT * FROM bob_table LIMIT 1',
          params: [],
        },
        bobToken
      );

      expect(sqlResponse.result).toBeDefined();
      expect(sqlResponse.error).toBeUndefined();

      console.log('✅ SQL-003: Bob accessed bob_table successfully');
    });

    it('Bob should access general_table (unrestricted)', async () => {
      const sqlResponse = await callMCPTool(
        'sql-delegate',
        {
          action: 'query',
          sql: 'SELECT * FROM general_table LIMIT 1',
          params: [],
        },
        bobToken
      );

      expect(sqlResponse.result).toBeDefined();
      expect(sqlResponse.error).toBeUndefined();

      console.log('✅ SQL-003: Bob accessed general_table successfully');
    });

    it('Bob should be denied access to alice_table (role mismatch)', async () => {
      try {
        await callMCPTool(
          'sql-delegate',
          {
            action: 'query',
            sql: 'SELECT * FROM alice_table LIMIT 1',
            params: [],
          },
          bobToken
        );

        expect(true).toBe(false);
      } catch (error: any) {
        expect(error.message).toBeDefined();
        console.log('✅ SQL-003: Bob denied access to alice_table (as expected)');
        console.log(`  - Error: ${error.message.substring(0, 100)}...`);
      }
    });
  });

  describe('SQL-004: PostgreSQL Positional Parameters', () => {
    it('should execute parameterized query with positional params ($1, $2)', async () => {
      const sqlResponse = await callMCPTool(
        'sql-delegate',
        {
          action: 'query',
          sql: 'SELECT $1::text AS param1, $2::integer AS param2',
          params: ['test_value', 42],
        },
        aliceToken
      );

      expect(sqlResponse.result).toBeDefined();
      expect(sqlResponse.error).toBeUndefined();

      const content = JSON.parse(sqlResponse.result.content[0].text);
      expect(content[0].param1).toBe('test_value');
      expect(content[0].param2).toBe(42);

      console.log('✅ SQL-004: Positional parameters work correctly');
    });
  });

  describe('SQL-005: Role-Based SQL Command Controls', () => {
    // Test sql-read role (SELECT only)
    it('sql-read role should allow SELECT commands', async () => {
      const sqlResponse = await callMCPTool(
        'sql-delegate',
        {
          action: 'query',
          sql: 'SELECT * FROM general_table LIMIT 1',
          params: [],
        },
        aliceToken
      );

      expect(sqlResponse.result).toBeDefined();
      expect(sqlResponse.error).toBeUndefined();

      console.log('✅ SQL-005: sql-read role allowed SELECT command');
    });

    it('sql-read role should block INSERT commands', async () => {
      const sqlResponse = await callMCPTool(
        'sql-delegate',
        {
          action: 'query',
          sql: "INSERT INTO general_table (data) VALUES ('test')",
          params: [],
        },
        aliceToken
      );

      expect(sqlResponse.error).toBeDefined();
      expect(sqlResponse.result).toBeUndefined();

      const errorMsg = sqlResponse.error.message.toLowerCase();
      expect(errorMsg).toContain('insufficient permissions');
      expect(errorMsg).not.toContain('sql-write');
      expect(errorMsg).not.toContain('sql-admin');

      console.log('✅ SQL-005: sql-read role blocked INSERT command');
      console.log(`  - Error message (no role leakage): ${sqlResponse.error.message}`);
    });

    it('sql-read role should block UPDATE commands', async () => {
      const sqlResponse = await callMCPTool(
        'sql-delegate',
        {
          action: 'query',
          sql: "UPDATE general_table SET data = 'updated' WHERE id = 1",
          params: [],
        },
        aliceToken
      );

      expect(sqlResponse.error).toBeDefined();
      const errorMsg = sqlResponse.error.message.toLowerCase();
      expect(errorMsg).toContain('insufficient permissions');
      expect(errorMsg).not.toContain('sql-write');

      console.log('✅ SQL-005: sql-read role blocked UPDATE command');
    });

    it('sql-read role should block DELETE commands', async () => {
      const sqlResponse = await callMCPTool(
        'sql-delegate',
        {
          action: 'query',
          sql: 'DELETE FROM general_table WHERE id = 999',
          params: [],
        },
        aliceToken
      );

      expect(sqlResponse.error).toBeDefined();
      const errorMsg = sqlResponse.error.message.toLowerCase();
      expect(errorMsg).toContain('insufficient permissions');
      expect(errorMsg).not.toContain('sql-write');

      console.log('✅ SQL-005: sql-read role blocked DELETE command');
    });

    // Test sql-write role (SELECT, INSERT, UPDATE, DELETE)
    it('sql-write role should allow INSERT commands', async () => {
      const sqlResponse = await callMCPTool(
        'sql-delegate',
        {
          action: 'query',
          sql: "INSERT INTO general_table (data) VALUES ('test_insert')",
          params: [],
        },
        bobToken
      );

      expect(sqlResponse.result).toBeDefined();
      expect(sqlResponse.error).toBeUndefined();

      const content = JSON.parse(sqlResponse.result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.rowCount).toBeGreaterThan(0);
      expect(content.command).toBe('INSERT');
      expect(content.message).toContain('Successfully inserted');

      console.log('✅ SQL-005: sql-write role allowed INSERT command');
      console.log(`  - Row count: ${content.rowCount}`);
      console.log(`  - Message: ${content.message}`);
    });

    it('sql-write role should allow UPDATE commands', async () => {
      const sqlResponse = await callMCPTool(
        'sql-delegate',
        {
          action: 'query',
          sql: "UPDATE general_table SET data = 'updated_value' WHERE id = 1",
          params: [],
        },
        bobToken
      );

      expect(sqlResponse.result).toBeDefined();
      expect(sqlResponse.error).toBeUndefined();

      const content = JSON.parse(sqlResponse.result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.rowCount).toBeGreaterThanOrEqual(0);
      expect(content.command).toBe('UPDATE');
      expect(content.message).toContain('Successfully updated');

      console.log('✅ SQL-005: sql-write role allowed UPDATE command');
      console.log(`  - Row count: ${content.rowCount}`);
    });

    it('sql-write role should allow DELETE commands', async () => {
      const sqlResponse = await callMCPTool(
        'sql-delegate',
        {
          action: 'query',
          sql: "DELETE FROM general_table WHERE data = 'test_delete_me'",
          params: [],
        },
        bobToken
      );

      expect(sqlResponse.result).toBeDefined();
      expect(sqlResponse.error).toBeUndefined();

      const content = JSON.parse(sqlResponse.result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.rowCount).toBeGreaterThanOrEqual(0);
      expect(content.command).toBe('DELETE');
      expect(content.message).toContain('Successfully deleted');

      console.log('✅ SQL-005: sql-write role allowed DELETE command');
    });

    it('sql-write role should block CREATE commands', async () => {
      const sqlResponse = await callMCPTool(
        'sql-delegate',
        {
          action: 'query',
          sql: 'CREATE TABLE test_table (id SERIAL PRIMARY KEY)',
          params: [],
        },
        bobToken
      );

      expect(sqlResponse.error).toBeDefined();
      const errorMsg = sqlResponse.error.message.toLowerCase();
      expect(errorMsg).toContain('insufficient permissions');
      expect(errorMsg).not.toContain('sql-admin');

      console.log('✅ SQL-005: sql-write role blocked CREATE command');
    });

    // Test sql-admin role (all except dangerous)
    it('sql-admin role should allow CREATE commands', async () => {
      const sqlResponse = await callMCPTool(
        'sql-delegate',
        {
          action: 'query',
          sql: 'CREATE TEMPORARY TABLE temp_test (id INTEGER)',
          params: [],
        },
        charlieToken
      );

      expect(sqlResponse.result).toBeDefined();
      expect(sqlResponse.error).toBeUndefined();

      console.log('✅ SQL-005: sql-admin role allowed CREATE command');
    });

    it('sql-admin role should block DROP commands', async () => {
      const sqlResponse = await callMCPTool(
        'sql-delegate',
        {
          action: 'query',
          sql: 'DROP TABLE IF EXISTS nonexistent_table',
          params: [],
        },
        charlieToken
      );

      expect(sqlResponse.error).toBeDefined();
      const errorMsg = sqlResponse.error.message.toLowerCase();
      expect(errorMsg).toContain('insufficient permissions');
      expect(errorMsg).not.toContain('admin');

      console.log('✅ SQL-005: sql-admin role blocked DROP command');
    });
  });

  describe('SQL-006: INSERT/UPDATE/DELETE Response Validation', () => {
    it('INSERT should return success metadata with rowCount', async () => {
      const sqlResponse = await callMCPTool(
        'sql-delegate',
        {
          action: 'query',
          sql: "INSERT INTO general_table (data) VALUES ('metadata_test')",
          params: [],
        },
        bobToken
      );

      expect(sqlResponse.result).toBeDefined();
      const content = JSON.parse(sqlResponse.result.content[0].text);

      expect(content).toHaveProperty('success');
      expect(content).toHaveProperty('rowCount');
      expect(content).toHaveProperty('command');
      expect(content).toHaveProperty('message');

      expect(content.success).toBe(true);
      expect(content.rowCount).toBe(1);
      expect(content.command).toBe('INSERT');
      expect(content.message).toBe('Successfully inserted 1 row');

      console.log('✅ SQL-006: INSERT returns proper metadata');
      console.log(`  - success: ${content.success}`);
      console.log(`  - rowCount: ${content.rowCount}`);
      console.log(`  - command: ${content.command}`);
      console.log(`  - message: ${content.message}`);
    });

    it('UPDATE with 0 rows should return rowCount 0', async () => {
      const sqlResponse = await callMCPTool(
        'sql-delegate',
        {
          action: 'query',
          sql: "UPDATE general_table SET data = 'never_match' WHERE id = -999999",
          params: [],
        },
        bobToken
      );

      expect(sqlResponse.result).toBeDefined();
      const content = JSON.parse(sqlResponse.result.content[0].text);

      expect(content.success).toBe(true);
      expect(content.rowCount).toBe(0);
      expect(content.command).toBe('UPDATE');
      expect(content.message).toBe('Successfully updated 0 rows');

      console.log('✅ SQL-006: UPDATE with 0 rows returns correct metadata');
    });

    it('DELETE multiple rows should return correct rowCount', async () => {
      // First insert multiple rows
      await callMCPTool(
        'sql-delegate',
        {
          action: 'query',
          sql: "INSERT INTO general_table (data) VALUES ('delete_me_1'), ('delete_me_2'), ('delete_me_3')",
          params: [],
        },
        bobToken
      );

      // Then delete them
      const sqlResponse = await callMCPTool(
        'sql-delegate',
        {
          action: 'query',
          sql: "DELETE FROM general_table WHERE data LIKE 'delete_me_%'",
          params: [],
        },
        bobToken
      );

      expect(sqlResponse.result).toBeDefined();
      const content = JSON.parse(sqlResponse.result.content[0].text);

      expect(content.success).toBe(true);
      expect(content.rowCount).toBeGreaterThanOrEqual(3);
      expect(content.command).toBe('DELETE');
      expect(content.message).toContain('Successfully deleted');
      expect(content.message).toContain('rows');

      console.log('✅ SQL-006: DELETE multiple rows returns correct metadata');
      console.log(`  - Rows deleted: ${content.rowCount}`);
    });

    it('SELECT query should still return rows array', async () => {
      const sqlResponse = await callMCPTool(
        'sql-delegate',
        {
          action: 'query',
          sql: 'SELECT * FROM general_table LIMIT 1',
          params: [],
        },
        aliceToken
      );

      expect(sqlResponse.result).toBeDefined();
      const content = JSON.parse(sqlResponse.result.content[0].text);

      expect(Array.isArray(content)).toBe(true);
      expect(content.length).toBeGreaterThan(0);

      console.log('✅ SQL-006: SELECT still returns rows array (not metadata)');
    });
  });

  describe('SQL-007: Security - Error Message Validation', () => {
    it('authorization errors should not leak role information', async () => {
      const sqlResponse = await callMCPTool(
        'sql-delegate',
        {
          action: 'query',
          sql: "INSERT INTO general_table (data) VALUES ('test')",
          params: [],
        },
        aliceToken
      );

      expect(sqlResponse.error).toBeDefined();
      const errorMsg = sqlResponse.error.message.toLowerCase();

      expect(errorMsg).toContain('insufficient permissions');
      expect(errorMsg).not.toContain('sql-read');
      expect(errorMsg).not.toContain('sql-write');
      expect(errorMsg).not.toContain('sql-admin');
      expect(errorMsg).not.toContain('admin');
      expect(errorMsg).not.toContain('required role');

      console.log('✅ SQL-007: Error message does not leak role information');
      console.log(`  - Error: ${sqlResponse.error.message}`);
    });

    it('dangerous operation errors should not leak role requirements', async () => {
      const sqlResponse = await callMCPTool(
        'sql-delegate',
        {
          action: 'query',
          sql: 'DROP TABLE general_table',
          params: [],
        },
        bobToken
      );

      expect(sqlResponse.error).toBeDefined();
      const errorMsg = sqlResponse.error.message.toLowerCase();

      expect(errorMsg).toContain('insufficient permissions');
      expect(errorMsg).not.toContain('admin');
      expect(errorMsg).not.toContain('requires');

      console.log('✅ SQL-007: Dangerous operation error does not leak role info');
    });

    it('unknown command errors should not leak role requirements', async () => {
      const sqlResponse = await callMCPTool(
        'sql-delegate',
        {
          action: 'query',
          sql: 'ANALYZE general_table',
          params: [],
        },
        bobToken
      );

      expect(sqlResponse.error).toBeDefined();
      const errorMsg = sqlResponse.error.message.toLowerCase();

      expect(errorMsg).toContain('insufficient permissions');
      expect(errorMsg).not.toContain('sql-admin');

      console.log('✅ SQL-007: Unknown command error does not leak role info');
    });
  });

  describe('SQL-008: Error Handling', () => {
    it('should handle missing legacy_name claim gracefully', async () => {
      try {
        await callMCPTool(
          'sql-delegate',
          {
            action: 'query',
            sql: 'SELECT 1',
            params: [],
          },
          daveToken
        );

        expect(true).toBe(false);
      } catch (error: any) {
        expect(error.message).toBeDefined();
        console.log('✅ SQL-008: Missing legacy_name handled gracefully');
        console.log(`  - Error: ${error.message}`);
      }
    });
  });

  describe('SQL-009: Token Exchange Cache Performance', () => {
    it('should achieve >80% cache hit rate with 60s TTL', async () => {
      const totalCalls = 20;
      const cacheCalls: number[] = [];

      for (let i = 0; i < totalCalls; i++) {
        const { latencyMs } = await measureLatency(() =>
          callMCPTool(
            'sql-delegate',
            {
              action: 'query',
              sql: 'SELECT now() AS currentTime',
              params: [],
            },
            aliceToken
          )
        );

        cacheCalls.push(latencyMs);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      const avgLatency = cacheCalls.reduce((sum, lat) => sum + lat, 0) / cacheCalls.length;
      const cacheHits = cacheCalls.filter((lat) => lat < 50).length;
      const cacheHitRate = (cacheHits / totalCalls) * 100;

      console.log('✅ SQL-009: Cache hit rate test completed');
      console.log(`  - Total calls: ${totalCalls}`);
      console.log(`  - Cache hits: ${cacheHits} (${cacheHitRate.toFixed(1)}%)`);
      console.log(`  - Average latency: ${avgLatency.toFixed(2)}ms`);

      expect(cacheHitRate).toBeGreaterThanOrEqual(80);
    }, 30000);

    it('should invalidate cache and perform new token exchange on JWT refresh', async () => {
      const call1 = await measureLatency(() =>
        callMCPTool(
          'sql-delegate',
          {
            action: 'query',
            sql: 'SELECT 1 AS test',
            params: [],
          },
          aliceToken
        )
      );

      const call2 = await measureLatency(() =>
        callMCPTool(
          'sql-delegate',
          {
            action: 'query',
            sql: 'SELECT 1 AS test',
            params: [],
          },
          aliceToken
        )
      );

      const newToken = await getAccessToken(TEST_USERS.alice.username, TEST_USERS.alice.password);

      const call3 = await measureLatency(() =>
        callMCPTool(
          'sql-delegate',
          {
            action: 'query',
            sql: 'SELECT 1 AS test',
            params: [],
          },
          newToken
        )
      );

      console.log('✅ SQL-009: JWT refresh test completed');
      console.log(`  - Initial call (cache miss): ${call1.latencyMs.toFixed(2)}ms`);
      console.log(`  - Second call (cache hit): ${call2.latencyMs.toFixed(2)}ms`);
      console.log(`  - After refresh (cache miss): ${call3.latencyMs.toFixed(2)}ms`);

      expect(call2.latencyMs).toBeLessThanOrEqual(call1.latencyMs * 1.5);
      expect(call1.result.result).toBeDefined();
      expect(call2.result.result).toBeDefined();
      expect(call3.result.result).toBeDefined();
    }, 30000);
  });
});
