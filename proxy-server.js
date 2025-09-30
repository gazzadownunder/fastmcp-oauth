// CORS Proxy for FastMCP httpStream
// This proxy adds proper CORS headers to allow credentials from cross-origin requests

import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import cors from 'cors';

const app = express();
const PORT = 3001;
const MCP_SERVER = 'http://localhost:3000';

// Request counter for tracking
let requestCounter = 0;

// 1. Initial request logging - captures all incoming requests
app.use((req, res, next) => {
  const reqId = ++requestCounter;
  req.requestId = reqId;
  console.log(`\n[${reqId}] ========== INCOMING REQUEST ==========`);
  console.log(`[${reqId}] ${req.method} ${req.url}`);
  console.log(`[${reqId}] Origin: ${req.headers.origin || 'none'}`);
  console.log(`[${reqId}] Content-Type: ${req.headers['content-type'] || 'none'}`);
  console.log(`[${reqId}] Authorization: ${req.headers.authorization ? req.headers.authorization.substring(0, 30) + '...' : 'none'}`);
  console.log(`[${reqId}] Cookie: ${req.headers.cookie || 'none'}`);

  // Track when response is sent (but don't wrap, causes issues with proxy)
  res.on('finish', () => {
    console.log(`[${reqId}] ========== RESPONSE FINISHED ==========`);
    console.log(`[${reqId}] Final status: ${res.statusCode}`);
  });

  next();
});

// 2. CORS middleware - handles preflight and adds headers
const corsMiddleware = cors({
  origin: 'http://localhost:8000',
  credentials: true,
  allowedHeaders: ['Content-Type', 'Accept', 'Authorization'],
  exposedHeaders: ['Set-Cookie'],
  methods: ['GET', 'POST', 'OPTIONS']
});

app.use((req, res, next) => {
  console.log(`[${req.requestId}] Entering CORS middleware...`);
  corsMiddleware(req, res, (err) => {
    if (err) {
      console.error(`[${req.requestId}] ✗ CORS middleware error:`, err.message);
      return next(err);
    }
    console.log(`[${req.requestId}] ✓ CORS middleware passed`);
    console.log(`[${req.requestId}] Response headersSent: ${res.headersSent}`);
    next();
  });
});

// 3. Post-CORS check
app.use((req, res, next) => {
  if (res.headersSent) {
    console.log(`[${req.requestId}] ⚠ Response already sent after CORS (likely OPTIONS preflight)`);
    return;
  }
  console.log(`[${req.requestId}] Proceeding to proxy middleware...`);
  next();
});

// 4. Proxy middleware with comprehensive logging
// Create proxy that matches ALL requests and forwards to MCP server
const proxyMiddleware = createProxyMiddleware({
  target: MCP_SERVER,
  changeOrigin: true,
  ws: false,
  pathRewrite: (path, req) => {
    // Express strips /mcp when mounting middleware, so we need to add it back
    const newPath = '/mcp' + (path === '/' ? '' : path);
    console.log(`[${req.requestId}] PATH REWRITE: "${path}" -> "${newPath}"`);
    return newPath;
  },

  // Before proxying to backend
  onProxyReq: (proxyReq, req, res) => {
    console.log(`[${req.requestId}] ========== PROXYING REQUEST ==========`);
    console.log(`[${req.requestId}] Target: ${MCP_SERVER}${req.url}`);
    console.log(`[${req.requestId}] Method: ${req.method}`);
    console.log(`[${req.requestId}] Headers being forwarded:`);
    console.log(`[${req.requestId}]   - Authorization: ${proxyReq.getHeader('authorization') ? 'present' : 'none'}`);
    console.log(`[${req.requestId}]   - Cookie: ${proxyReq.getHeader('cookie') || 'none'}`);
    console.log(`[${req.requestId}]   - Content-Type: ${proxyReq.getHeader('content-type') || 'none'}`);
  },

  // After receiving response from backend
  onProxyRes: (proxyRes, req, res) => {
    console.log(`[${req.requestId}] ========== PROXY RESPONSE ==========`);
    console.log(`[${req.requestId}] Status: ${proxyRes.statusCode} ${proxyRes.statusMessage}`);
    console.log(`[${req.requestId}] Content-Type: ${proxyRes.headers['content-type'] || 'none'}`);

    if (proxyRes.headers['set-cookie']) {
      console.log(`[${req.requestId}] ✓ Set-Cookie headers from backend:`);
      proxyRes.headers['set-cookie'].forEach((cookie, idx) => {
        console.log(`[${req.requestId}]   [${idx}] ${cookie}`);
      });
    } else {
      console.log(`[${req.requestId}] ⚠ No Set-Cookie headers from backend`);
    }

    console.log(`[${req.requestId}] ========== END PROXY RESPONSE ==========`);
  },

  // Error handling
  onError: (err, req, res) => {
    console.error(`[${req.requestId}] ========== PROXY ERROR ==========`);
    console.error(`[${req.requestId}] Error: ${err.message}`);
    console.error(`[${req.requestId}] Stack: ${err.stack}`);

    if (!res.headersSent) {
      console.log(`[${req.requestId}] Sending 502 error response to client`);
      res.status(502).json({
        error: 'Proxy error',
        message: err.message,
        target: MCP_SERVER
      });
    } else {
      console.log(`[${req.requestId}] Cannot send error response (headers already sent)`);
    }
  }
});

// Apply proxy only to /mcp paths
app.use('/mcp', (req, res, next) => {
  console.log(`[${req.requestId}] Entering /mcp route handler`);
  proxyMiddleware(req, res, next);
});

// 5. Catch-all for unmatched routes (should not be reached if proxy filter works)
app.use((req, res) => {
  console.log(`[${req.requestId}] ========== 404 NOT FOUND ==========`);
  console.log(`[${req.requestId}] No route/proxy matched for: ${req.method} ${req.url}`);
  res.status(404).json({
    error: 'Not found',
    path: req.url,
    method: req.method
  });
});

app.listen(PORT, () => {
  console.log(`\n✓ CORS Proxy running on http://localhost:${PORT}`);
  console.log(`  Proxying /mcp requests to ${MCP_SERVER}/mcp`);
  console.log(`  Allowed origin: http://localhost:8000\n`);
});