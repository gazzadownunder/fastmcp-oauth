# OAuth Delegation Test - Phase 2
# Exchange Subject Token for Delegated Token (RFC 8693)
# PowerShell version (no jq required)

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "OAuth Delegation Test - Phase 2" -ForegroundColor Cyan
Write-Host "Token Exchange (RFC 8693)" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# Configuration
$KEYCLOAK_URL = "http://localhost:8080"
$REALM = "mcp-security"
$CLIENT_ID = "mcp-oauth"
$CLIENT_SECRET = "your-client-secret-here"

# Check if subject token exists
if (-not (Test-Path ".subject-token")) {
    Write-Host "✗ Subject token not found" -ForegroundColor Red
    Write-Host "Run 1-get-subject-token.ps1 first" -ForegroundColor Yellow
    exit 1
}

$SUBJECT_TOKEN = Get-Content ".subject-token" -Raw

Write-Host "Keycloak: $KEYCLOAK_URL"
Write-Host "Realm: $REALM"
Write-Host "Client: $CLIENT_ID"
Write-Host ""

# Token endpoint
$TOKEN_URL = "$KEYCLOAK_URL/realms/$REALM/protocol/openid-connect/token"

Write-Host "Exchanging subject token for delegated token..." -ForegroundColor Yellow
Write-Host ""

# Perform RFC 8693 token exchange
try {
    $response = Invoke-RestMethod -Uri $TOKEN_URL -Method Post -ContentType "application/x-www-form-urlencoded" -Body @{
        grant_type = "urn:ietf:params:oauth:grant-type:token-exchange"
        client_id = $CLIENT_ID
        client_secret = $CLIENT_SECRET
        subject_token = $SUBJECT_TOKEN
        subject_token_type = "urn:ietf:params:oauth:token-type:access_token"
        requested_token_type = "urn:ietf:params:oauth:token-type:access_token"
        audience = $CLIENT_ID
    }

    $EXCHANGED_TOKEN = $response.access_token

    # Save token to file
    $EXCHANGED_TOKEN | Out-File -FilePath ".exchanged-token" -NoNewline -Encoding utf8
    Write-Host "✓ Token exchange successful" -ForegroundColor Green

    # Decode JWT to inspect claims
    $parts = $EXCHANGED_TOKEN.Split('.')
    if ($parts.Length -eq 3) {
        $payload = $parts[1]
        # Add padding if needed
        while ($payload.Length % 4 -ne 0) {
            $payload += "="
        }
        $payloadBytes = [Convert]::FromBase64String($payload.Replace('-', '+').Replace('_', '/'))
        $payloadJson = [System.Text.Encoding]::UTF8.GetString($payloadBytes)
        $claims = $payloadJson | ConvertFrom-Json

        Write-Host ""
        Write-Host "Exchanged Token Claims:" -ForegroundColor Cyan
        Write-Host "  iss: $($claims.iss)"
        Write-Host "  aud: $($claims.aud)"
        Write-Host "  azp: $($claims.azp)"
        Write-Host "  sub: $($claims.sub)"
        Write-Host "  act: $($claims.act -or 'NOT PRESENT')"

        # CRITICAL: Validate azp claim
        Write-Host ""
        if ($claims.azp -eq $CLIENT_ID) {
            Write-Host "✓ PASS: azp claim is '$CLIENT_ID' (correct for exchanged token)" -ForegroundColor Green
        } else {
            Write-Host "✗ FAIL: azp claim is '$($claims.azp)', expected '$CLIENT_ID'" -ForegroundColor Red
            exit 1
        }

        # Check if delegation claim exists
        if ($claims.act) {
            Write-Host "✓ PASS: 'act' claim present (indicates delegation)" -ForegroundColor Green
        } else {
            Write-Host "⚠ WARNING: 'act' claim not present" -ForegroundColor Yellow
        }

        Write-Host ""
        Write-Host "Token saved to: .exchanged-token" -ForegroundColor Green
        Write-Host ""
        Write-Host "Next step: Use this token to call MCP server at http://localhost:3000/mcp" -ForegroundColor Yellow
        Write-Host "Example:" -ForegroundColor Yellow
        Write-Host '  $token = Get-Content .exchanged-token -Raw' -ForegroundColor Gray
        Write-Host '  Invoke-RestMethod -Uri "http://localhost:3000/mcp" -Headers @{Authorization="Bearer $token"}' -ForegroundColor Gray
    }
} catch {
    Write-Host "✗ Token exchange failed" -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red

    if ($_.ErrorDetails.Message) {
        $errorJson = $_.ErrorDetails.Message | ConvertFrom-Json
        Write-Host "Details: $($errorJson.error_description)" -ForegroundColor Red
    }

    Write-Host ""
    Write-Host "Common issues:" -ForegroundColor Yellow
    Write-Host "  - Token exchange not enabled in Keycloak"
    Write-Host "  - Client '$CLIENT_ID' not configured"
    Write-Host "  - Invalid client secret"
    Write-Host "  - Token exchange permissions not set"
    exit 1
}