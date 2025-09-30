// Serve web-test and MCP endpoint from same origin (port 3000)
// This bypasses CORS and allows cookies to work
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 3000;

// Serve static files from test-harness/web-test
const staticPath = join(__dirname, 'test-harness', 'web-test');
console.log(`Serving static files from: ${staticPath}`);

app.use(express.static(staticPath));

// Note: MCP server will handle /mcp endpoint
// This server just serves the static HTML/JS/CSS files

app.listen(PORT, () => {
  console.log(`\n✓ Static file server running on http://localhost:${PORT}`);
  console.log(`  Serving: ${staticPath}`);
  console.log(`\n  NOTE: Start MCP server FIRST, then this server will serve UI on same port\n`);
});