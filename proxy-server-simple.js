// Simple CORS Proxy for FastMCP
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

const app = express();
const PORT = 3001;
const TARGET = 'http://localhost:3000';

// Logging middleware
app.use((req, res, next) => {
  console.log(`\n${req.method} ${req.url}`);
  console.log(`Cookie from browser: ${req.headers.cookie || 'none'}`);
  next();
});

// CORS headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'http://localhost:8000');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');
  res.header('Access-Control-Expose-Headers', 'Set-Cookie');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// Proxy /mcp to backend
app.use('/mcp', createProxyMiddleware({
  target: TARGET,
  changeOrigin: true,
  pathRewrite: { '^/mcp': '/mcp' },
  onProxyRes: (proxyRes, req, res) => {
    console.log(`Response: ${proxyRes.statusCode}`);
    if (proxyRes.headers['set-cookie']) {
      console.log('Set-Cookie from backend:', proxyRes.headers['set-cookie']);
    }
  }
}));

app.listen(PORT, () => {
  console.log(`\n✓ Proxy running: http://localhost:${PORT} -> ${TARGET}`);
  console.log(`  CORS allowed from: http://localhost:8000\n`);
});