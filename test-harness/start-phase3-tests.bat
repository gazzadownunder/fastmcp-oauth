@echo off
REM Phase 3 Integration & Performance Tests Quick Start
REM Runs MCP server with Phase 3 test configuration

echo ========================================
echo Phase 3 Integration Tests Quick Start
echo ========================================
echo.

REM Check if Keycloak is running
echo Checking Keycloak availability...
curl -s http://localhost:8080 >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Keycloak is not running on http://localhost:8080
    echo Please start Keycloak before running tests
    echo.
    pause
    exit /b 1
)
echo [OK] Keycloak is running
echo.

REM Set environment variables
echo Setting environment variables...
set NODE_ENV=test
set CONFIG_PATH=./test-harness/config/phase3-test-config.json
set SERVER_PORT=3000
echo [OK] Environment configured
echo.

REM Check if config file exists
if not exist "%CONFIG_PATH%" (
    echo [ERROR] Configuration file not found: %CONFIG_PATH%
    echo Please create the configuration file
    echo See: test-harness/PHASE3-TESTING-GUIDE.md
    echo.
    pause
    exit /b 1
)

echo Starting MCP Server...
echo Configuration: %CONFIG_PATH%
echo Server Port: %SERVER_PORT%
echo.
echo Press Ctrl+C to stop the server
echo ========================================
echo.

npm start
