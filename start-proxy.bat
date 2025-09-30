@echo off
echo Starting CORS Proxy Server for FastMCP...
echo.
echo This proxy runs on port 3001 and forwards to MCP server on port 3000
echo Allows credentials (session cookies) for cross-origin requests
echo.

node proxy-server.js