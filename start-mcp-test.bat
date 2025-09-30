@echo off
echo Starting MCP OAuth Server with TEST configuration...
echo.

set NODE_ENV=development
set CONFIG_PATH=config/oauth-obo-test.json
set SERVER_PORT=3000
set MCP_ENDPOINT=/mcp

echo Configuration:
echo   NODE_ENV = %NODE_ENV%
echo   CONFIG_PATH = %CONFIG_PATH%
echo   SERVER_PORT = %SERVER_PORT%
echo   MCP_ENDPOINT = %MCP_ENDPOINT%
echo.
echo ========================================
echo.

node dist/start-server.js