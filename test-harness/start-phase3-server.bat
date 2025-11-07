@echo off
REM Phase 3 Integration Testing - MCP Server Startup Script
REM This script starts the MCP server with Phase 3 test configuration

echo ================================================================
echo  Phase 3 Integration Testing - MCP Server
echo ================================================================
echo.

REM Set environment variables (paths relative to project root)
set NODE_ENV=development
set CONFIG_PATH=./test-harness/config/phase3-test-config.json
set SERVER_PORT=3010

echo Environment Configuration:
echo   NODE_ENV:     %NODE_ENV%
echo   CONFIG_PATH:  %CONFIG_PATH%
echo   SERVER_PORT:  %SERVER_PORT%
echo.
echo This server includes:
echo   - Multi-Database PostgreSQL Support (2 databases configured)
echo     * SQL1 Tools: Primary database (postgres)
echo     * SQL2 Tools: Analytics database (analytics_db)
echo   - Token Exchange per database module
echo   - Kerberos Delegation (S4U2Self + S4U2Proxy for file servers)
echo.
echo KERBEROS PREREQUISITES (if enabled):
echo   1. Active Directory at w25-dc.w25ad.net must be reachable
echo   2. Service account svc-mcp-server@w25ad.net must be configured
echo   3. SPNs registered: HTTP/mcp-server
echo   4. Delegation targets configured: cifs/*, HOST/* (file servers)
echo.
echo   If AD is not configured, Kerberos will fail gracefully during startup.
echo   Server will continue with PostgreSQL delegation only.
echo.
echo ================================================================
echo  Starting MCP Server...
echo ================================================================
echo.

REM Change to project root directory and start server
cd ..
node dist/test-harness/v2-test-server.js

pause
