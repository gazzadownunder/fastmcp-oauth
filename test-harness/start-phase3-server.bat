@echo off
REM Phase 3 Integration Testing - MCP Server Startup Script
REM This script starts the MCP server with Phase 3 test configuration

echo ================================================================
echo  Phase 3 Integration Testing - MCP Server (Secure Config)
echo ================================================================
echo.

REM Set environment variables (paths relative to project root)
set NODE_ENV=development
set CONFIG_PATH=./test-harness/config/phase3-test-config.json
set SERVER_PORT=3000
set DOTENV_CONFIG_PATH=./test-harness/.env

echo Environment Configuration:
echo   NODE_ENV:     %NODE_ENV%
echo   CONFIG_PATH:  %CONFIG_PATH%
echo   SERVER_PORT:  %SERVER_PORT%
echo   DOTENV_PATH:  %DOTENV_CONFIG_PATH%
echo.
echo ================================================================
echo  SECRETS MANAGEMENT (NEW in v3.2)
echo ================================================================
echo.
echo This server uses DYNAMIC SECRET RESOLUTION:
echo   - Config file contains logical names: {"$secret": "NAME"}
echo   - Secrets resolved at runtime from environment variables
echo   - NO HARDCODED PASSWORDS in configuration files
echo.
echo REQUIRED ENVIRONMENT VARIABLES (for phase3-test-config.json):
echo   Note: Your config may require different secrets!
echo.
echo   POSTGRESQL1_PASSWORD              - Primary DB password
echo   POSTGRESQL1_OAUTH_CLIENT_SECRET   - Primary DB OAuth secret
echo   POSTGRESQL2_PASSWORD              - Analytics DB password
echo   POSTGRESQL2_OAUTH_CLIENT_SECRET   - Analytics DB OAuth secret
echo   KERBEROS_SERVICE_ACCOUNT_PASSWORD - Kerberos service account
echo   KERBEROS_OAUTH_CLIENT_SECRET      - Kerberos OAuth secret
echo.
echo   To find required secrets for YOUR config:
echo     grep "$secret" %CONFIG_PATH%
echo.
echo SETUP INSTRUCTIONS:
echo   1. Copy test-harness\.env.phase3 to test-harness\.env
echo   2. Update .env with actual secret values
echo   3. Ensure .env is in .gitignore (DO NOT commit secrets!)
echo.
echo For production: Use Kubernetes secrets mounted at /run/secrets/
echo   Provider chain: /run/secrets/ (highest priority) -^> env vars
echo.
echo ================================================================
echo  DELEGATION MODULES
echo ================================================================
echo.
echo This server includes:
echo   - Multi-Database PostgreSQL Support (2 databases configured)
echo     * SQL1 Tools: Primary database (postgres)
echo     * SQL2 Tools: Analytics database (contextflow_ai)
echo   - Token Exchange per database module (with encrypted cache)
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
