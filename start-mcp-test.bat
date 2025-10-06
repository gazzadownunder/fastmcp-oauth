@echo off
echo Starting MCP OAuth Server v2.x with TEST configuration...
echo.

set NODE_ENV=development
set CONFIG_PATH=config/oauth-obo-test.json
set SERVER_PORT=3000
set MCP_TRANSPORT=httpStream

echo Configuration:
echo   NODE_ENV = %NODE_ENV%
echo   CONFIG_PATH = %CONFIG_PATH%
echo   SERVER_PORT = %SERVER_PORT%
echo   MCP_TRANSPORT = %MCP_TRANSPORT%
echo.
echo ========================================
echo.

node dist/examples/start-server.js