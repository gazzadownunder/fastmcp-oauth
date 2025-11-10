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
      '**/test-harness/integration.test.ts',
      '**/test-harness/performance.test.ts'
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      // IMPORTANT: Only include src/ directory, exclude all build/test artifacts
      include: [
        'src/**/*.ts'
      ],
      exclude: [
        // Build artifacts and configs
        '**/node_modules/**',
        '**/dist/**',
        '**/*.d.ts',
        '**/vitest.config.ts',
        '**/vitest.integration.config.ts',
        '**/tsup.config.ts',
        'bin/**',

        // Test files (unit, integration, test-harness)
        '**/*.test.ts',
        '**/__tests__/**',
        'tests/**',
        'test-harness/**',

        // Examples and tooling (not production code)
        'Examples/**',
        'examples/**',
        'src/examples/**',
        'packages/*/examples/**',

        // Entry points (mostly imports/exports - no logic to test)
        'src/index.ts',
        'src/core/index.ts',
        'src/delegation/index.ts',
        'src/mcp/index.ts',
        'src/config/index.ts',
        'src/config/schemas/index.ts',

        // Type-only files (interfaces, no executable code)
        'src/core/types.ts',
        'src/delegation/types.ts',
        'src/delegation/base.ts',
        'src/mcp/types.ts',
        'src/types/**',

        // Testing utilities (used by external tests, not production code)
        'src/testing/**',

        // MCP tools that require external resources
        // These are tested via integration tests, not unit tests
        'src/mcp/tools/kerberos-delegate.ts',
        'src/mcp/tools/sql-*.ts',
        'src/mcp/tools/*-tools-factory.ts',
      ],
      // Coverage thresholds - aim for high coverage on core production code
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80
      },
      // Include all files in coverage report (even untested ones)
      all: true,
      // Don't skip files with 100% coverage in the report
      skipFull: false
    }
  }
});