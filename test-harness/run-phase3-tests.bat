@echo off
REM Phase 3 Integration & Performance Testing - Complete Test Runner
REM This script runs all Phase 3 tests in sequence

echo ================================================================
echo  Phase 3 Integration ^& Performance Testing
echo ================================================================
echo.
echo This script will run:
echo   1. Integration Tests (INT-001 through INT-010)
echo   2. Performance Benchmarks (PERF-001 through PERF-004)
echo   3. Load ^& Stress Tests (LOAD-001 through LOAD-006)
echo.
echo Prerequisites:
echo   - Keycloak running on http://localhost:8080
echo   - MCP Server running on http://localhost:3000
echo   - Test users configured (alice, bob, charlie, dave, loadtest)
echo.

pause

echo.
echo ================================================================
echo  Step 1: Integration Tests
echo ================================================================
echo.

call npm run test:phase3

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: Integration tests failed!
    echo Please review the errors above and fix before proceeding.
    pause
    exit /b 1
)

echo.
echo ================================================================
echo  Step 2: Performance Benchmarks
echo ================================================================
echo.

call npm run test:phase3:performance

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: Performance tests failed!
    echo Please review the errors above.
    pause
    exit /b 1
)

echo.
echo ================================================================
echo  Phase 3 Testing Complete!
echo ================================================================
echo.
echo All tests passed successfully.
echo.
echo Next steps:
echo   1. Review test results above
echo   2. Update Docs/unified-oauth-progress.md
echo   3. Create Phase 3 git commit
echo.

pause
