@echo off
echo ========================================
echo MCP Server Clean Start Test
echo ========================================
echo.

echo Step 1: Killing all node processes on port 3000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000" ^| findstr "LISTENING"') do (
    echo Killing PID: %%a
    taskkill /F /PID %%a
)
timeout /t 2 /nobreak >nul

echo.
echo Step 2: Verifying port 3000 is free...
netstat -ano | findstr ":3000" | findstr "LISTENING"
if %ERRORLEVEL% EQU 0 (
    echo ERROR: Port 3000 is still in use!
    pause
    exit /b 1
) else (
    echo OK: Port 3000 is free
)

echo.
echo Step 3: Starting MCP server...
set NODE_ENV=development
set CONFIG_PATH=config\oauth-obo-test.json
set SERVER_PORT=3000
set MCP_ENDPOINT=/mcp

echo Environment:
echo   NODE_ENV=%NODE_ENV%
echo   CONFIG_PATH=%CONFIG_PATH%
echo   SERVER_PORT=%SERVER_PORT%
echo   MCP_ENDPOINT=%MCP_ENDPOINT%
echo.
echo Starting server (you should see logs below)...
echo ========================================
echo.

node dist\start-server.js