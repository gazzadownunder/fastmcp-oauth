@echo off
REM Start MCP OAuth Server with Phase 1 Token Exchange Configuration

echo ================================================================
echo   Starting MCP OAuth Server - Phase 1 Token Exchange Test
echo ================================================================
echo.

REM Set environment variables
set NODE_ENV=development
set CONFIG_PATH=./test-harness/config/v2-keycloak-token-exchange.json
set SERVER_PORT=3000

echo Environment:     %NODE_ENV%
echo Configuration:   %CONFIG_PATH%
echo Port:            %SERVER_PORT%
echo.
echo Starting server...
echo.

REM Start the server
node dist/test-harness/v2-test-server.js

pause
