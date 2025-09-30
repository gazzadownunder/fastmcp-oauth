# OAuth Delegation Test - Phase 3
# Test MCP Server Authentication
# PowerShell version (no jq required)

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "OAuth Delegation Test - Phase 3" -ForegroundColor Cyan
Write-Host "Test MCP Server Authentication" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

$MCP_URL = "http://localhost:3000/mcp"

# Check if exchanged token exists
if (-not (Test-Path ".exchanged-token")) {
    Write-Host "✗ Exchanged token not found" -ForegroundColor Red
    Write-Host "Run 2-exchange-token.ps1 first" -ForegroundColor Yellow
    exit 1
}

$TOKEN = Get-Content ".exchanged-token" -Raw

Write-Host "MCP Server: $MCP_URL"
Write-Host ""

# Test 1: Call user-info tool
Write-Host "Test 1: Calling user-info tool..." -ForegroundColor Yellow

try {
    $body = @{
        jsonrpc = "2.0"
        id = 1
        method = "tools/call"
        params = @{
            name = "user-info"
            arguments = @{}
        }
    } | ConvertTo-Json -Depth 10

    $response = Invoke-RestMethod -Uri $MCP_URL `
        -Method Post `
        -Headers @{
            "Authorization" = "Bearer $TOKEN"
            "Content-Type" = "application/json"
        } `
        -Body $body

    Write-Host "✓ Authentication successful" -ForegroundColor Green
    Write-Host ""
    Write-Host "Response:" -ForegroundColor Cyan
    Write-Host ($response | ConvertTo-Json -Depth 10)

} catch {
    Write-Host "✗ Request failed" -ForegroundColor Red
    Write-Host "Status: $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red

    if ($_.Exception.Response.StatusCode.value__ -eq 401) {
        Write-Host ""
        Write-Host "Authentication failed. Possible reasons:" -ForegroundColor Yellow
        Write-Host "  - Token validation failed"
        Write-Host "  - azp claim doesn't match expected audience"
        Write-Host "  - Token expired"
        Write-Host "  - Issuer not trusted"
    }
    exit 1
}

Write-Host ""
Write-Host "=========================================" -ForegroundColor Green
Write-Host "All tests passed!" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Green