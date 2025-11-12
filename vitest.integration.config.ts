import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Vitest Configuration for Integration Tests
 *
 * These tests require:
 * - MCP Server running at http://localhost:3000
 * - Keycloak IDP configured and accessible
 * - Test users and clients configured
 *
 * Run with:
 *   npm run test:integration
 *   npm run test:performance
 */
export default defineConfig({
  resolve: {
    alias: {
      // Map package imports to source files for testing
      'fastmcp-oauth/core': path.resolve(__dirname, './src/core/index.ts'),
      'fastmcp-oauth/delegation': path.resolve(__dirname, './src/delegation/index.ts'),
      'fastmcp-oauth': path.resolve(__dirname, './src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    // Only include integration test files
    include: [
      'test-harness/integration.test.ts',
      'test-harness/performance.test.ts',
      'test-harness/sql-delegation.test.ts',
    ],
    // Longer timeout for integration tests (network calls, IDP round-trips)
    testTimeout: 30000,
    hookTimeout: 30000,
    // No coverage for integration tests (they test running server, not code)
    coverage: {
      enabled: false,
    },
  },
});
