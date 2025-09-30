# OAuth Delegation Test - Phase 1
# Get Subject Token from Keycloak
# PowerShell version (no jq required)

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "OAuth Delegation Test - Phase 1" -ForegroundColor Cyan
Write-Host "Get Subject Token from Keycloak" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# Configuration
$KEYCLOAK_URL = "http://localhost:8080"
$REALM = "mcp-security"
$CLIENT_ID = "contextflow"
$USERNAME = "test@contextflow.ai"
$PASSWORD = "TestPassword123"

Write-Host "Keycloak: $KEYCLOAK_URL"
Write-Host "Realm: $REALM"
Write-Host "Client: $CLIENT_ID"
Write-Host ""

# Token endpoint
$TOKEN_URL = "$KEYCLOAK_URL/realms/$REALM/protocol/openid-connect/token"

Write-Host "Authenticating with user credentials (testing only)..." -ForegroundColor Yellow
Write-Host "Username: $USERNAME"
Write-Host ""

# Request subject token using password grant (for testing only)
$body = @{
    grant_type = "password"
    client_id = $CLIENT_ID
    username = $USERNAME
    password = $PASSWORD
    scope = "openid profile email"
}

$response = Invoke-RestMethod -Uri $TOKEN_URL -Method Post -ContentType "application/x-www-form-urlencoded" -Body $body
$SUBJECT_TOKEN = $response.access_token

# Save token to file
$SUBJECT_TOKEN | Out-File -FilePath ".subject-token" -NoNewline -Encoding utf8
Write-Host "✓ Subject token obtained successfully" -ForegroundColor Green

# Decode JWT to inspect claims
$parts = $SUBJECT_TOKEN.Split('.')
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
    Write-Host "Subject Token Claims:" -ForegroundColor Cyan
    Write-Host "  iss: $($claims.iss)"
    Write-Host "  aud: $($claims.aud)"
    Write-Host "  azp: $($claims.azp)"
    Write-Host "  sub: $($claims.sub)"
    Write-Host "  preferred_username: $($claims.preferred_username)"

    # CRITICAL: Validate azp claim
    Write-Host ""
    if ($claims.azp -ne $CLIENT_ID) {
        Write-Host "✗ FAIL: azp claim is '$($claims.azp)', expected '$CLIENT_ID'" -ForegroundColor Red
        exit 1
    }

    Write-Host "✓ PASS: azp claim is '$CLIENT_ID' (correct for subject token)" -ForegroundColor Green

    # Check expiration
    $exp = [DateTimeOffset]::FromUnixTimeSeconds($claims.exp).LocalDateTime
    Write-Host "  expires: $exp"

    Write-Host ""
    Write-Host "Token saved to: .subject-token" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next step: Run 2-exchange-token.ps1 to exchange this token" -ForegroundColor Yellow
}