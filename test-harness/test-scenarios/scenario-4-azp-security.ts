#!/usr/bin/env node
/**
 * Critical Security Test: azp Claim Validation
 *
 * This test verifies the MOST IMPORTANT security requirement:
 * - Subject Token (azp: contextflow) must be REJECTED
 * - Exchanged Token (azp: mcp-oauth) must be ACCEPTED
 *
 * This prevents privilege escalation attacks where an attacker
 * uses a high-privilege subject token to access the resource server.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { KeycloakHelper } from '../test-clients/utils/keycloak-helper.js';
import { MCPToolCaller } from '../test-clients/utils/mcp-tool-caller.js';

const TEST_NAME = 'azp Claim Security Validation';

async function main() {
  console.log('========================================');
  console.log(TEST_NAME);
  console.log('========================================');
  console.log('');

  let passCount = 0;
  let failCount = 0;

  // Check if token files exist
  const subjectTokenPath = join(process.cwd(), '.subject-token');
  const exchangedTokenPath = join(process.cwd(), '.exchanged-token');

  if (!existsSync(subjectTokenPath)) {
    console.error('✗ Subject token file not found');
    console.error('  Run: ./scripts/1-get-subject-token.sh');
    process.exit(1);
  }

  if (!existsSync(exchangedTokenPath)) {
    console.error('✗ Exchanged token file not found');
    console.error('  Run: ./scripts/2-exchange-token.sh');
    process.exit(1);
  }

  // Read tokens
  const subjectToken = readFileSync(subjectTokenPath, 'utf8').trim();
  const exchangedToken = readFileSync(exchangedTokenPath, 'utf8').trim();

  // Decode tokens to inspect azp claim
  const subjectClaims = KeycloakHelper.decodeToken(subjectToken);
  const exchangedClaims = KeycloakHelper.decodeToken(exchangedToken);

  console.log('Token Analysis:');
  console.log('----------------');
  console.log(`Subject Token azp:   ${subjectClaims.azp || 'N/A'}`);
  console.log(`Exchanged Token azp: ${exchangedClaims.azp || 'N/A'}`);
  console.log('');

  // Initialize MCP tool caller
  const mcpCaller = MCPToolCaller.loadFromEnv();

  // Check if MCP server is running
  console.log('Checking MCP server availability...');
  const isReachable = await mcpCaller.isServerReachable();

  if (!isReachable) {
    console.error('✗ MCP server is not reachable');
    console.error(`  Expected at: ${mcpCaller.getServerUrl()}`);
    console.error('  Start the server with:');
    console.error('    CONFIG_PATH=./test-harness/config/phase3-test-config.json npm start');
    process.exit(1);
  }

  console.log(`✓ MCP server is reachable at ${mcpCaller.getServerUrl()}`);
  console.log('');

  // =================================================================
  // TEST 1: Subject Token (azp: contextflow) must be REJECTED
  // =================================================================
  console.log('========================================');
  console.log('Test 1: Subject Token Rejection');
  console.log('========================================');
  console.log('Expected: HTTP 401/403 - Token rejected');
  console.log(`Token azp: ${subjectClaims.azp}`);
  console.log('');

  try {
    const result = await mcpCaller.userInfo(subjectToken);

    if (!result.success) {
      console.log('✓ PASS: Subject token was correctly rejected');
      console.log(`  Error: ${result.error}`);
      passCount++;
    } else {
      console.error('✗ SECURITY VULNERABILITY: Subject token was accepted!');
      console.error('  This is a CRITICAL security issue.');
      console.error('  The resource server must validate the azp claim.');
      console.error('  Response:', JSON.stringify(result.data, null, 2));
      failCount++;
    }
  } catch (error) {
    console.log('✓ PASS: Subject token was correctly rejected');
    console.log(`  Error: ${error instanceof Error ? error.message : error}`);
    passCount++;
  }

  console.log('');

  // =================================================================
  // TEST 2: Exchanged Token (azp: mcp-oauth) must be ACCEPTED
  // =================================================================
  console.log('========================================');
  console.log('Test 2: Exchanged Token Acceptance');
  console.log('========================================');
  console.log('Expected: HTTP 200 - Token accepted');
  console.log(`Token azp: ${exchangedClaims.azp}`);
  console.log('');

  try {
    const result = await mcpCaller.userInfo(exchangedToken);

    if (result.success) {
      console.log('✓ PASS: Exchanged token was correctly accepted');
      console.log('  User Info:');
      console.log(`    userId: ${result.data.userId || 'N/A'}`);
      console.log(`    username: ${result.data.username || 'N/A'}`);
      console.log(`    legacyUsername: ${result.data.legacyUsername || 'N/A'}`);
      console.log(`    role: ${result.data.role || 'N/A'}`);
      passCount++;
    } else {
      console.error('✗ FAIL: Exchanged token was rejected');
      console.error(`  Error: ${result.error}`);
      failCount++;
    }
  } catch (error) {
    console.error('✗ FAIL: Exchanged token was rejected');
    console.error(`  Error: ${error instanceof Error ? error.message : error}`);
    failCount++;
  }

  console.log('');

  // =================================================================
  // TEST 3: SQL Delegation with Exchanged Token
  // =================================================================
  console.log('========================================');
  console.log('Test 3: SQL Delegation Authorization');
  console.log('========================================');
  console.log('Expected: SQL query executes as delegated user');
  console.log('');

  try {
    const result = await mcpCaller.sqlDelegate(
      'query',
      exchangedToken,
      {
        sql: 'SELECT CURRENT_USER AS delegated_user, SYSTEM_USER AS system_user',
        params: {},
      }
    );

    if (result.success) {
      console.log('✓ PASS: SQL delegation successful with exchanged token');
      console.log('  Result:', JSON.stringify(result.data, null, 2));
      passCount++;
    } else {
      console.error('✗ FAIL: SQL delegation failed');
      console.error(`  Error: ${result.error}`);
      failCount++;
    }
  } catch (error) {
    console.error('✗ FAIL: SQL delegation failed');
    console.error(`  Error: ${error instanceof Error ? error.message : error}`);
    failCount++;
  }

  console.log('');

  // =================================================================
  // TEST 4: SQL Delegation with Subject Token (should fail)
  // =================================================================
  console.log('========================================');
  console.log('Test 4: SQL Delegation with Subject Token');
  console.log('========================================');
  console.log('Expected: Request rejected - wrong azp claim');
  console.log('');

  try {
    const result = await mcpCaller.sqlDelegate(
      'query',
      subjectToken,
      {
        sql: 'SELECT 1',
        params: {},
      }
    );

    if (!result.success) {
      console.log('✓ PASS: SQL delegation correctly rejected subject token');
      console.log(`  Error: ${result.error}`);
      passCount++;
    } else {
      console.error('✗ SECURITY VULNERABILITY: Subject token was accepted for SQL delegation!');
      failCount++;
    }
  } catch (error) {
    console.log('✓ PASS: SQL delegation correctly rejected subject token');
    passCount++;
  }

  console.log('');

  // =================================================================
  // Summary
  // =================================================================
  console.log('========================================');
  console.log('Test Summary');
  console.log('========================================');
  console.log(`Passed: ${passCount}/4`);
  console.log(`Failed: ${failCount}/4`);
  console.log('');

  if (failCount === 0) {
    console.log('✓ ALL SECURITY TESTS PASSED');
    console.log('  The azp claim validation is working correctly.');
    console.log('  Subject tokens are rejected, exchanged tokens are accepted.');
    process.exit(0);
  } else {
    console.error('✗ SECURITY TESTS FAILED');
    console.error('  CRITICAL: azp claim validation is not working correctly.');
    console.error('  This is a serious security vulnerability.');
    process.exit(1);
  }
}

// Run tests
main().catch(error => {
  console.error('Test execution failed:', error);
  process.exit(1);
});