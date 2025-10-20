@echo off
REM Kerberos Delegation Testing - MCP Server Startup Script
REM This script starts the MCP server with Kerberos delegation enabled
REM
REM Prerequisites:
REM   1. Active Directory configured at 192.168.1.25 (run scripts\setup-ad-kerberos.ps1)
REM   2. Service account svc-mcp-server@COMPANY.COM created with delegation enabled
REM   3. Keycloak configured with legacy_name claim mapper
REM   4. File server available at 192.168.1.25 or fileserver.company.com

echo ================================================================
echo  Kerberos Delegation Testing - MCP Server
echo ================================================================
echo.
echo IMPORTANT: This configuration requires Active Directory setup!
echo.
echo Prerequisites:
echo   [1] Active Directory at 192.168.1.25 configured for delegation
echo   [2] Service account: svc-mcp-server@COMPANY.COM
echo   [3] File server SPNs registered for delegation
echo   [4] Keycloak has legacy_name claim in JWT tokens
echo.
echo If AD is not configured, run: scripts\setup-ad-kerberos.ps1
echo.
pause
echo.

REM Set environment variables (paths relative to project root)
set NODE_ENV=development
set CONFIG_PATH=./test-harness/config/phase3-kerberos-enabled.json
set SERVER_PORT=3010

echo Environment Configuration:
echo   NODE_ENV:     %NODE_ENV%
echo   CONFIG_PATH:  %CONFIG_PATH%
echo   SERVER_PORT:  %SERVER_PORT%
echo.
echo Kerberos Configuration:
echo   Domain Controller: 192.168.1.25
echo   Realm:             COMPANY.COM
echo   Service Account:   svc-mcp-server
echo   Use Case:          File Server Access (SMB/CIFS)
echo.
echo ================================================================
echo  Starting MCP Server with Kerberos Delegation...
echo ================================================================
echo.

REM Change to project root directory and start server
cd ..
node dist/test-harness/v2-test-server.js

pause
