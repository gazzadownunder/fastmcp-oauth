@echo off
REM Phase 3 - Complete Build and Test Script
REM This script runs from the ROOT directory and handles everything

echo ================================================================
echo  Phase 3 Integration ^& Performance Testing
echo  Complete Build and Test Script
echo ================================================================
echo.

REM Get the directory where this script is located (should be root)
set ROOT_DIR=%~dp0
echo Root Directory: %ROOT_DIR%
echo.

echo ================================================================
echo  Step 1: Build Project
echo ================================================================
echo.

cd /d "%ROOT_DIR%"
call npm run build

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: Build failed!
    echo Please fix build errors before proceeding.
    pause
    exit /b 1
)

echo.
echo ================================================================
echo  Step 2: Verify Keycloak Setup
echo ================================================================
echo.
echo Running verification script to test all users...
echo.

cd /d "%ROOT_DIR%test-harness"
call verify-keycloak-setup.bat

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: Keycloak verification failed!
    echo.
    echo Common fixes:
    echo   1. Update client secret in config/phase3-test-config.json
    echo   2. Ensure users exist: alice@test.local, bob@test.local, etc.
    echo   3. Check user passwords are set (not temporary)
    echo.
    pause
    exit /b 1
)

echo.
echo ================================================================
echo  Build and Verification Complete!
echo ================================================================
echo.
echo Next steps:
echo.
echo   Terminal 1 (Server):
echo     cd test-harness
echo     start-phase3-server.bat
echo.
echo   Terminal 2 (Tests):
echo     npm run test:phase3
echo     npm run test:phase3:performance
echo.
echo OR run the automated test script:
echo     cd test-harness
echo     run-phase3-tests.bat
echo.

pause
