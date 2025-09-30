@echo off
echo Starting MCP OAuth OBO Server for testing...
echo.
echo Configuration: config/oauth-obo-test.json
echo Port: 3000
echo Endpoint: /mcp
echo.

set NODE_ENV=development
set CONFIG_PATH=config\oauth-obo-test.json
set SERVER_PORT=3000
set MCP_ENDPOINT=/mcp

node dist\start-server.js