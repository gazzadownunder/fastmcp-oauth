import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      // Map package imports to source files for testing
      'mcp-oauth-framework/core': path.resolve(__dirname, './src/core/index.ts'),
      'mcp-oauth-framework/delegation': path.resolve(__dirname, './src/delegation/index.ts'),
      'mcp-oauth-framework': path.resolve(__dirname, './src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      // Exclude legacy tests (v1.x architecture - deprecated)
      '**/tests/unit/jwt-validator.test.ts',
      '**/tests/integration/basic-functionality.test.ts',
      // Exclude optional delegation tests (run separately with npm run test:sql)
      '**/test-harness/sql-delegation.test.ts',
      '**/test-harness/phase3-integration.test.ts',
      '**/test-harness/phase3-performance.test.ts'
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.d.ts',
        '**/*.test.ts',
        'vitest.config.ts',
        'tsup.config.ts'
      ]
    }
  }
});