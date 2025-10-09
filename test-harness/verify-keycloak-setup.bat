@echo off
REM Keycloak Configuration Verification Script
REM Tests connectivity and verifies test users are configured

echo ================================================================
echo  Keycloak Configuration Verification
echo ================================================================
echo.

echo Step 1: Testing Keycloak connectivity...
echo.

curl -s http://localhost:8080/realms/mcp_security/.well-known/openid-configuration > nul

if %ERRORLEVEL% EQU 0 (
    echo [OK] Keycloak is running on http://localhost:8080
) else (
    echo [FAIL] Cannot connect to Keycloak!
    echo        Make sure Keycloak is running on http://localhost:8080
    pause
    exit /b 1
)

echo.
echo Step 2: Testing user authentication (alice@test.local)...
echo.

curl -s -X POST http://localhost:8080/realms/mcp_security/protocol/openid-connect/token ^
  -d "client_id=mcp-oauth" ^
  -d "client_secret=9DQjCpm4D9wbzXxHa1ki51PhBbyxOXrg" ^
  -d "username=alice@test.local" ^
  -d "password=Test123!" ^
  -d "grant_type=password" > alice_token.json

findstr /C:"access_token" alice_token.json > nul

if %ERRORLEVEL% EQU 0 (
    echo [OK] User alice@test.local authenticated successfully
) else (
    echo [FAIL] Cannot authenticate user alice@test.local
    echo        Check username/password or client credentials
    type alice_token.json
    del alice_token.json
    pause
    exit /b 1
)

echo.
echo Step 3: Testing user authentication (bob@test.local)...
echo.

curl -s -X POST http://localhost:8080/realms/mcp_security/protocol/openid-connect/token ^
  -d "client_id=mcp-oauth" ^
  -d "client_secret=9DQjCpm4D9wbzXxHa1ki51PhBbyxOXrg" ^
  -d "username=bob@test.local" ^
  -d "password=Test123!" ^
  -d "grant_type=password" > bob_token.json

findstr /C:"access_token" bob_token.json > nul

if %ERRORLEVEL% EQU 0 (
    echo [OK] User bob@test.local authenticated successfully
) else (
    echo [FAIL] Cannot authenticate user bob@test.local
    echo        User may not exist - check Keycloak users
    type bob_token.json
    del bob_token.json
    pause
    exit /b 1
)

echo.
echo Step 4: Testing user authentication (charlie@test.local)...
echo.

curl -s -X POST http://localhost:8080/realms/mcp_security/protocol/openid-connect/token ^
  -d "client_id=mcp-oauth" ^
  -d "client_secret=9DQjCpm4D9wbzXxHa1ki51PhBbyxOXrg" ^
  -d "username=charlie@test.local" ^
  -d "password=Test123!" ^
  -d "grant_type=password" > charlie_token.json

findstr /C:"access_token" charlie_token.json > nul

if %ERRORLEVEL% EQU 0 (
    echo [OK] User charlie@test.local authenticated successfully
) else (
    echo [FAIL] Cannot authenticate user charlie@test.local
    echo        User may not exist - check Keycloak users
    type charlie_token.json
    del charlie_token.json
    pause
    exit /b 1
)

echo.
echo Step 5: Testing user authentication (loadtest@test.local)...
echo.

curl -s -X POST http://localhost:8080/realms/mcp_security/protocol/openid-connect/token ^
  -d "client_id=mcp-oauth" ^
  -d "client_secret=9DQjCpm4D9wbzXxHa1ki51PhBbyxOXrg" ^
  -d "username=loadtest@test.local" ^
  -d "password=LoadTest123!" ^
  -d "grant_type=password" > loadtest_token.json

REM  -d "username=loadtest@test.local" ^


findstr /C:"access_token" loadtest_token.json > nul

if %ERRORLEVEL% EQU 0 (
    echo [OK] User loadtest@test.local authenticated successfully
) else (
    echo [FAIL] Cannot authenticate user loadtest@test.local
    echo        User may not exist - check Keycloak users
    type loadtest_token.json
    del loadtest_token.json
    pause
    exit /b 1
)

echo.
echo ================================================================
echo  Verification Complete!
echo ================================================================
echo.
echo All Keycloak connectivity tests passed:
echo   [OK] Keycloak running and accessible
echo   [OK] Client mcp-oauth configured correctly
echo   [OK] Test users (alice@test.local, bob@test.local, charlie@test.local, loadtest@test.local) configured
echo.
echo Next steps:
echo   1. Build the project: npm run build
echo   2. Start MCP server: test-harness\start-phase3-server.bat
echo   3. Run Phase 3 tests: test-harness\run-phase3-tests.bat
echo.

REM Cleanup
del alice_token.json 2> nul
del bob_token.json 2> nul
del charlie_token.json 2> nul
del loadtest_token.json 2> nul

pause
