import { defineConfig } from 'tsup';
import { globSync } from 'glob';

export default defineConfig({
  entry: [
    'src/**/*.ts',
    'examples/**/*.ts', // Application examples for framework users
    'test-harness/v2-test-server.ts' // Include v2 test server
  ],
  format: ['esm'],
  target: 'node18',
  clean: true,
  dts: {
    entry: globSync('src/**/*.ts', { ignore: ['**/__tests__/**', '**/*.test.ts'] }), // Only generate types for src, exclude tests
  },
  sourcemap: true,
  splitting: false,
  bundle: false, // Don't bundle - preserve module structure
  external: ['fastmcp', 'jose', 'mssql', 'kerberos'],
  esbuildOptions: (options) => {
    options.conditions = ['module'];
  },
  outDir: 'dist',
});