@echo off
REM Phase 3 Integration Testing - MCP Server Startup Script
REM This script starts the MCP server with Phase 3 test configuration

echo ================================================================
echo  Phase 3 Integration Testing - MCP Server
echo ================================================================
echo.

REM Set environment variables
set NODE_ENV=development
set CONFIG_PATH=./config/phase3-test-config.json
set SERVER_PORT=3000

echo Environment Configuration:
echo   NODE_ENV:     %NODE_ENV%
echo   CONFIG_PATH:  %CONFIG_PATH%
echo   SERVER_PORT:  %SERVER_PORT%
echo.
echo ================================================================
echo  Starting MCP Server...
echo ================================================================
echo.

REM Start the test server (dist is in parent directory)
node ..\dist\test-harness\v2-test-server.js

pause
