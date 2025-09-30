// Native HTTP Proxy for FastMCP using http-proxy library
import http from 'http';
import httpProxy from 'http-proxy';

const PORT = 3001;
const TARGET = 'http://localhost:3000';
const ALLOWED_ORIGIN = 'http://localhost:8000';

// Create proxy server
const proxy = httpProxy.createProxyServer({
  target: TARGET,
  changeOrigin: true,
  preserveHeaderKeyCase: true
});

// Proxy event logging
proxy.on('proxyReq', (proxyReq, req, res) => {
  console.log(`\n→ PROXY REQUEST`);
  console.log(`  ${req.method} ${req.url} → ${TARGET}${req.url}`);
  console.log(`  Cookie from browser: ${req.headers.cookie || 'none'}`);
  console.log(`  Authorization: ${req.headers.authorization ? 'present' : 'none'}`);
});

proxy.on('proxyRes', (proxyRes, req, res) => {
  console.log(`\n← PROXY RESPONSE`);
  console.log(`  Status: ${proxyRes.statusCode}`);
  console.log(`  Content-Type: ${proxyRes.headers['content-type'] || 'none'}`);

  if (proxyRes.headers['set-cookie']) {
    console.log(`  ✓ Set-Cookie from backend:`);
    proxyRes.headers['set-cookie'].forEach((cookie, idx) => {
      console.log(`    [${idx}] ${cookie}`);
    });
  } else {
    console.log(`  ⚠ No Set-Cookie headers from backend`);
  }
});

proxy.on('error', (err, req, res) => {
  console.error(`\n✗ PROXY ERROR: ${err.message}`);
  if (!res.headersSent) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Proxy error', message: err.message }));
  }
});

// Create HTTP server
const server = http.createServer((req, res) => {
  console.log(`\n[${new Date().toISOString()}] ${req.method} ${req.url}`);

  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');
  res.setHeader('Access-Control-Expose-Headers', 'Set-Cookie');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    console.log('  → Handling CORS preflight');
    res.writeHead(204);
    res.end();
    return;
  }

  // Proxy all /mcp requests
  if (req.url.startsWith('/mcp')) {
    console.log('  → Proxying to backend');
    proxy.web(req, res);
  } else {
    console.log('  → 404 Not Found');
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found', path: req.url }));
  }
});

server.listen(PORT, () => {
  console.log(`\n✓ Native HTTP Proxy running on http://localhost:${PORT}`);
  console.log(`  Target: ${TARGET}`);
  console.log(`  Allowed origin: ${ALLOWED_ORIGIN}\n`);
});