import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false, // Skip DTS for now - types come from source
  sourcemap: true,
  clean: true,
  target: 'es2022',
  outDir: 'dist',
  external: ['mcp-oauth-framework'], // Don't bundle core framework
});
