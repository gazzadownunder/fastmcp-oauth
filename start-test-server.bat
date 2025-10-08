@echo off
echo ═══════════════════════════════════════════════════════════
echo   MCP OAuth v2 Test Server - New Modular Framework
echo ═══════════════════════════════════════════════════════════
echo.
echo Configuration: test-harness\config\v2-keycloak-oauth-only.json
echo Port:          3000
echo Transport:     http-stream
echo Framework:     v2.0.0 (Modular Architecture)
echo.
echo ═══════════════════════════════════════════════════════════
echo.

set NODE_ENV=development
set CONFIG_PATH=./test-harness/config/v2-keycloak-oauth-only.json
set SERVER_PORT=3100

node dist/test-harness/v2-test-server.js