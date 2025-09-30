import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'index-simple': 'src/index-simple.ts',
    'start-server': 'src/start-server.ts',
  },
  format: ['esm'],
  target: 'node18',
  clean: true,
  dts: false, // Temporarily disabled due to FastMCP type conflicts
  sourcemap: true,
  splitting: false,
  bundle: true,
  external: ['fastmcp', 'jose', 'mssql', 'kerberos'],
  esbuildOptions: (options) => {
    options.conditions = ['module'];
  },
});