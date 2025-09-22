import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node18',
  clean: true,
  dts: true,
  sourcemap: true,
  splitting: false,
  bundle: true,
  external: ['fastmcp', 'jose', 'mssql', 'kerberos'],
  esbuildOptions: (options) => {
    options.conditions = ['module'];
  },
});