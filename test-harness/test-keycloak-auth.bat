@echo off
REM Quick Keycloak Authentication Test
REM Tests if we can get a token from Keycloak with current credentials

echo ================================================================
echo  Keycloak Authentication Test
echo ================================================================
echo.

set KEYCLOAK_URL=http://localhost:8080
set REALM=mcp_security
set CLIENT_ID=mcp-oauth
set CLIENT_SECRET=JUUA5xCJDQZdreWgEFYvfAqjJnGdTXXA
set USERNAME=alice@test.local
set PASSWORD=Test123!

echo Testing authentication with:
echo   Keycloak: %KEYCLOAK_URL%
echo   Realm:    %REALM%
echo   Client:   %CLIENT_ID%
echo   User:     %USERNAME%
echo.

echo Step 1: Testing Keycloak connectivity...
curl -s "%KEYCLOAK_URL%/realms/%REALM%/.well-known/openid-configuration" > nul 2>&1

if %ERRORLEVEL% EQU 0 (
    echo [OK] Keycloak is reachable
) else (
    echo [FAIL] Cannot connect to Keycloak at %KEYCLOAK_URL%
    echo        Make sure Keycloak is running
    pause
    exit /b 1
)

echo.
echo Step 2: Attempting password grant authentication...
echo.

curl -v -X POST "%KEYCLOAK_URL%/realms/%REALM%/protocol/openid-connect/token" ^
  -H "Content-Type: application/x-www-form-urlencoded" ^
  -d "client_id=%CLIENT_ID%" ^
  -d "client_secret=%CLIENT_SECRET%" ^
  -d "username=%USERNAME%" ^
  -d "password=%PASSWORD%" ^
  -d "grant_type=password" 2>&1

echo.
echo.
echo ================================================================
echo  Troubleshooting Guide
echo ================================================================
echo.
echo If you see "401 Unauthorized" or "invalid_grant":
echo   1. Check client secret is correct in Keycloak Admin Console
echo   2. Verify user exists: alice@test.local
echo   3. Check password is correct and not temporary
echo   4. Ensure "Direct Access Grants" is enabled on mcp-oauth client
echo.
echo If you see "invalid_client":
echo   1. Client ID or secret is wrong
echo   2. Get correct secret from Keycloak: Clients -^> mcp-oauth -^> Credentials
echo.
echo If you see "access_token" in the response:
echo   ✅ SUCCESS! Authentication working correctly
echo.

pause
