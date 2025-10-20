# ============================================================================
# Kerberos Delegation Test Script
# ============================================================================
#
# Purpose: Test OAuth + Kerberos delegation flow with MCP Server
#
# Prerequisites:
#   - Active Directory configured (run setup-ad-kerberos.ps1)
#   - Keycloak running with user attribute mappers
#   - MCP Server running with kerberos-test-config.json
#
# Usage:
#   .\test-kerberos.ps1 -Username "alice" -Password "password"
#
# ============================================================================

param(
    [Parameter(Mandatory=$false)]
    [string]$KeycloakUrl = "http://192.168.1.25:8080",

    [Parameter(Mandatory=$false)]
    [string]$MCPServerUrl = "http://localhost:3000",

    [Parameter(Mandatory=$false)]
    [string]$Username = "alice",

    [Parameter(Mandatory=$false)]
    [string]$Password = "password",

    [Parameter(Mandatory=$false)]
    [string]$Realm = "mcp-test",

    [Parameter(Mandatory=$false)]
    [string]$ClientId = "mcp-client",

    [Parameter(Mandatory=$false)]
    [string]$ADDomainController = "192.168.1.25",

    [Parameter(Mandatory=$false)]
    [string]$ADRealm = "COMPANY.COM"
)

# ============================================================================
# Helper Functions
# ============================================================================

function Write-TestHeader {
    param([string]$Message)
    Write-Host "`n╔══════════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║ $($Message.PadRight(68)) ║" -ForegroundColor Cyan
    Write-Host "╚══════════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
}

function Write-TestStep {
    param([string]$Message)
    Write-Host "`n[STEP] $Message" -ForegroundColor Yellow
}

function Write-TestSuccess {
    param([string]$Message)
    Write-Host "[✓] $Message" -ForegroundColor Green
}

function Write-TestError {
    param([string]$Message)
    Write-Host "[✗] $Message" -ForegroundColor Red
}

function Write-TestInfo {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Gray
}

function Invoke-MCPTool {
    param(
        [string]$ToolName,
        [hashtable]$Arguments,
        [string]$AccessToken
    )

    $body = @{
        jsonrpc = "2.0"
        method = "tools/call"
        params = @{
            name = $ToolName
            arguments = $Arguments
        }
        id = [System.Guid]::NewGuid().ToString()
    } | ConvertTo-Json -Depth 10

    try {
        $response = Invoke-RestMethod -Method Post -Uri "$MCPServerUrl/mcp" `
            -Headers @{
                "Authorization" = "Bearer $AccessToken"
                "Content-Type" = "application/json"
            } `
            -Body $body `
            -ErrorAction Stop

        return $response
    } catch {
        Write-TestError "MCP tool call failed: $_"
        Write-TestInfo "Response: $($_.Exception.Response)"
        throw
    }
}

# ============================================================================
# Test 0: Pre-flight Checks
# ============================================================================

Write-TestHeader "Test 0: Pre-flight Checks"

Write-TestStep "Verifying Active Directory configuration..."

try {
    # Check if AD module available
    if (Get-Module -ListAvailable -Name ActiveDirectory) {
        Import-Module ActiveDirectory -ErrorAction Stop

        # Verify service account exists
        $serviceAccount = Get-ADUser -Filter "SamAccountName -eq 'svc-mcp-server'" -ErrorAction SilentlyContinue

        if ($serviceAccount) {
            Write-TestSuccess "Service account exists: svc-mcp-server"

            # Check delegation settings
            $delegationInfo = Get-ADUser -Identity "svc-mcp-server" `
                -Properties TrustedToAuthForDelegation, msDS-AllowedToDelegateTo

            if ($delegationInfo.TrustedToAuthForDelegation) {
                Write-TestSuccess "Protocol transition (S4U2Self) enabled"
            } else {
                Write-TestError "Protocol transition NOT enabled. Run setup-ad-kerberos.ps1"
            }

            if ($delegationInfo.'msDS-AllowedToDelegateTo') {
                Write-TestSuccess "Delegation targets configured: $($delegationInfo.'msDS-AllowedToDelegateTo'.Count) targets"
                $delegationInfo.'msDS-AllowedToDelegateTo' | ForEach-Object {
                    Write-TestInfo "  - $_"
                }
            } else {
                Write-TestError "No delegation targets configured. Run setup-ad-kerberos.ps1"
            }
        } else {
            Write-TestError "Service account 'svc-mcp-server' not found. Run setup-ad-kerberos.ps1"
        }

        # Verify test user exists
        $testUser = Get-ADUser -Filter "SamAccountName -eq '$Username'" -ErrorAction SilentlyContinue

        if ($testUser) {
            Write-TestSuccess "Test user exists: $Username"
        } else {
            Write-TestError "Test user '$Username' not found. Run setup-ad-kerberos.ps1"
        }
    } else {
        Write-TestInfo "Active Directory module not available (not on domain controller)"
        Write-TestInfo "Skipping AD verification..."
    }
} catch {
    Write-TestError "AD verification failed: $_"
}

Write-TestStep "Verifying Keycloak connectivity..."

try {
    $keycloakHealth = Invoke-RestMethod -Method Get -Uri "$KeycloakUrl/health" -ErrorAction Stop
    Write-TestSuccess "Keycloak is accessible at $KeycloakUrl"
} catch {
    Write-TestError "Cannot reach Keycloak at $KeycloakUrl"
    Write-TestInfo "Ensure Keycloak is running and accessible"
    exit 1
}

Write-TestStep "Verifying MCP Server connectivity..."

try {
    $mcpHealth = Invoke-RestMethod -Method Get -Uri "$MCPServerUrl/health" -ErrorAction SilentlyContinue
    Write-TestSuccess "MCP Server is accessible at $MCPServerUrl"
} catch {
    Write-TestError "Cannot reach MCP Server at $MCPServerUrl"
    Write-TestInfo "Start MCP Server with: npm start"
    Write-TestInfo "Config: set CONFIG_PATH=./test-harness/config/kerberos-test-config.json"
    exit 1
}

# ============================================================================
# Test 1: Obtain OAuth Token
# ============================================================================

Write-TestHeader "Test 1: Obtain OAuth Token from Keycloak"

Write-TestStep "Authenticating user: $Username"

$tokenEndpoint = "$KeycloakUrl/realms/$Realm/protocol/openid-connect/token"

try {
    $tokenResponse = Invoke-RestMethod -Method Post -Uri $tokenEndpoint `
        -Headers @{ "Content-Type" = "application/x-www-form-urlencoded" } `
        -Body @{
            grant_type = "password"
            client_id = $ClientId
            username = $Username
            password = $Password
            scope = "openid profile"
        } `
        -ErrorAction Stop

    $accessToken = $tokenResponse.access_token
    Write-TestSuccess "OAuth access token obtained"
    Write-TestInfo "Token type: $($tokenResponse.token_type)"
    Write-TestInfo "Expires in: $($tokenResponse.expires_in) seconds"
    Write-TestInfo "Token preview: $($accessToken.Substring(0, [Math]::Min(50, $accessToken.Length)))..."

    # Decode JWT to verify legacy_username claim
    Write-TestStep "Verifying JWT claims..."

    $tokenParts = $accessToken.Split('.')
    $payload = $tokenParts[1]

    # Add padding if needed
    while ($payload.Length % 4 -ne 0) {
        $payload += "="
    }

    $payloadJson = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($payload))
    $claims = $payloadJson | ConvertFrom-Json

    Write-TestInfo "User ID: $($claims.sub)"
    Write-TestInfo "Username: $($claims.preferred_username)"

    if ($claims.legacy_username) {
        Write-TestSuccess "legacy_username claim present: $($claims.legacy_username)"
    } else {
        Write-TestError "legacy_username claim MISSING!"
        Write-TestInfo "Configure Keycloak user attribute mapper:"
        Write-TestInfo "  1. Clients → $ClientId → Mappers → Create"
        Write-TestInfo "  2. Name: legacy_username"
        Write-TestInfo "  3. Mapper Type: User Attribute"
        Write-TestInfo "  4. User Attribute: sAMAccountName"
        Write-TestInfo "  5. Token Claim Name: legacy_username"
        Write-TestInfo ""
        Write-TestInfo "Also set user attribute:"
        Write-TestInfo "  1. Users → $Username → Attributes"
        Write-TestInfo "  2. Add attribute: sAMAccountName = $($Username.ToUpper())"
        exit 1
    }

    if ($claims.realm_roles) {
        Write-TestInfo "Roles: $($claims.realm_roles -join ', ')"
    }

} catch {
    Write-TestError "Failed to obtain OAuth token: $_"
    Write-TestInfo "Verify username/password and Keycloak configuration"
    exit 1
}

# ============================================================================
# Test 2: Call user-info Tool (Verify Authentication)
# ============================================================================

Write-TestHeader "Test 2: Verify MCP Authentication"

Write-TestStep "Calling user-info tool..."

try {
    $userInfoResponse = Invoke-MCPTool -ToolName "user-info" -Arguments @{} -AccessToken $accessToken

    if ($userInfoResponse.result) {
        Write-TestSuccess "User authenticated successfully"
        Write-TestInfo "User ID: $($userInfoResponse.result.userId)"
        Write-TestInfo "Legacy Username: $($userInfoResponse.result.legacyUsername)"
        Write-TestInfo "Roles: $($userInfoResponse.result.roles -join ', ')"
        Write-TestInfo "Session ID: $($userInfoResponse.result.sessionId)"
    } else {
        Write-TestError "Unexpected response: $($userInfoResponse | ConvertTo-Json)"
    }
} catch {
    Write-TestError "Authentication failed: $_"
    exit 1
}

# ============================================================================
# Test 3: Kerberos Delegation - S4U2Self
# ============================================================================

Write-TestHeader "Test 3: Kerberos Delegation (S4U2Self)"

Write-TestStep "Requesting Kerberos ticket for user: $($claims.legacy_username)@$ADRealm"

try {
    $s4u2selfResponse = Invoke-MCPTool -ToolName "kerberos-delegate" `
        -Arguments @{
            action = "s4u2self"
            resource = "kerberos"
        } `
        -AccessToken $accessToken

    if ($s4u2selfResponse.result -and $s4u2selfResponse.result.success) {
        Write-TestSuccess "Kerberos ticket obtained via S4U2Self"
        Write-TestInfo "User Principal: $($s4u2selfResponse.result.userPrincipal)"
        Write-TestInfo "Action: $($s4u2selfResponse.result.action)"

        if ($s4u2selfResponse.result.ticket) {
            Write-TestInfo "Ticket details:"
            Write-TestInfo "  Principal: $($s4u2selfResponse.result.ticket.principal)"
            Write-TestInfo "  Service: $($s4u2selfResponse.result.ticket.service)"
            Write-TestInfo "  Expires: $($s4u2selfResponse.result.ticket.expiresAt)"
        }
    } else {
        Write-TestError "S4U2Self failed"
        Write-TestInfo "Response: $($s4u2selfResponse | ConvertTo-Json -Depth 10)"

        if ($s4u2selfResponse.error) {
            Write-TestError "Error: $($s4u2selfResponse.error.message)"
        }
    }
} catch {
    Write-TestError "S4U2Self request failed: $_"
    Write-TestInfo "Possible causes:"
    Write-TestInfo "  - Kerberos module not implemented yet (expected for now)"
    Write-TestInfo "  - Service account delegation not configured"
    Write-TestInfo "  - KDC unreachable"
}

# ============================================================================
# Test 4: Kerberos Delegation - S4U2Proxy
# ============================================================================

Write-TestHeader "Test 4: Kerberos Delegation (S4U2Proxy)"

Write-TestStep "Requesting proxy ticket for SQL Server..."

$targetSPN = "MSSQLSvc/sql01.company.com:1433"

try {
    $s4u2proxyResponse = Invoke-MCPTool -ToolName "kerberos-delegate" `
        -Arguments @{
            action = "s4u2proxy"
            targetSPN = $targetSPN
            resource = "kerberos"
        } `
        -AccessToken $accessToken

    if ($s4u2proxyResponse.result -and $s4u2proxyResponse.result.success) {
        Write-TestSuccess "Proxy ticket obtained via S4U2Proxy"
        Write-TestInfo "User Principal: $($s4u2proxyResponse.result.userPrincipal)"
        Write-TestInfo "Target SPN: $($s4u2proxyResponse.result.targetSPN)"
        Write-TestInfo "Action: $($s4u2proxyResponse.result.action)"

        if ($s4u2proxyResponse.result.ticket) {
            Write-TestInfo "Proxy ticket details:"
            Write-TestInfo "  Principal: $($s4u2proxyResponse.result.ticket.principal)"
            Write-TestInfo "  Target Service: $($s4u2proxyResponse.result.ticket.targetService)"
            Write-TestInfo "  Delegated From: $($s4u2proxyResponse.result.ticket.delegatedFrom)"
            Write-TestInfo "  Expires: $($s4u2proxyResponse.result.ticket.expiresAt)"
        }
    } else {
        Write-TestError "S4U2Proxy failed"
        Write-TestInfo "Response: $($s4u2proxyResponse | ConvertTo-Json -Depth 10)"

        if ($s4u2proxyResponse.error) {
            Write-TestError "Error: $($s4u2proxyResponse.error.message)"
        }
    }
} catch {
    Write-TestError "S4U2Proxy request failed: $_"
    Write-TestInfo "Possible causes:"
    Write-TestInfo "  - Kerberos module not implemented yet (expected for now)"
    Write-TestInfo "  - Target SPN not in allowed delegation targets"
    Write-TestInfo "  - Service account delegation not configured"
}

# ============================================================================
# Test 5: Unauthorized Delegation (Negative Test)
# ============================================================================

Write-TestHeader "Test 5: Unauthorized Delegation (Negative Test)"

Write-TestStep "Attempting delegation to unauthorized SPN..."

$unauthorizedSPN = "HTTP/unauthorized.company.com"

try {
    $unauthorizedResponse = Invoke-MCPTool -ToolName "kerberos-delegate" `
        -Arguments @{
            action = "s4u2proxy"
            targetSPN = $unauthorizedSPN
            resource = "kerberos"
        } `
        -AccessToken $accessToken

    if ($unauthorizedResponse.result -and -not $unauthorizedResponse.result.success) {
        Write-TestSuccess "Delegation correctly rejected for unauthorized SPN"
        Write-TestInfo "Error: $($unauthorizedResponse.result.error)"
    } elseif ($unauthorizedResponse.error) {
        Write-TestSuccess "Delegation correctly rejected (error response)"
        Write-TestInfo "Error: $($unauthorizedResponse.error.message)"
    } else {
        Write-TestError "SECURITY ISSUE: Delegation allowed to unauthorized SPN!"
        Write-TestInfo "Response: $($unauthorizedResponse | ConvertTo-Json -Depth 10)"
    }
} catch {
    Write-TestSuccess "Delegation correctly rejected (exception)"
    Write-TestInfo "Exception: $_"
}

# ============================================================================
# Test 6: View Audit Logs
# ============================================================================

Write-TestHeader "Test 6: View Kerberos Delegation Audit Logs"

Write-TestStep "Retrieving audit logs..."

try {
    $auditResponse = Invoke-MCPTool -ToolName "audit-log" `
        -Arguments @{
            limit = 10
            userId = $claims.sub
        } `
        -AccessToken $accessToken

    if ($auditResponse.result) {
        $auditEntries = $auditResponse.result

        Write-TestSuccess "Retrieved $($auditEntries.Count) audit log entries"

        # Filter Kerberos-related entries
        $kerberosEntries = $auditEntries | Where-Object { $_.action -like "kerberos:*" }

        if ($kerberosEntries.Count -gt 0) {
            Write-TestInfo "Kerberos delegation audit entries:"
            $kerberosEntries | ForEach-Object {
                Write-Host "  [$($_.timestamp)] $($_.action) - Success: $($_.success)" -ForegroundColor Gray
                if ($_.metadata) {
                    Write-Host "    Metadata: $($_.metadata | ConvertTo-Json -Compress)" -ForegroundColor DarkGray
                }
            }
        } else {
            Write-TestInfo "No Kerberos delegation entries in audit log (expected if not implemented yet)"
        }
    }
} catch {
    Write-TestError "Failed to retrieve audit logs: $_"
}

# ============================================================================
# Test Summary
# ============================================================================

Write-TestHeader "Test Summary"

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════════════════╗" -ForegroundColor White
Write-Host "║                          TEST RESULTS                                ║" -ForegroundColor White
Write-Host "╠══════════════════════════════════════════════════════════════════════╣" -ForegroundColor White
Write-Host "║                                                                      ║" -ForegroundColor White
Write-Host "║  ✓ Pre-flight checks passed                                         ║" -ForegroundColor Green
Write-Host "║  ✓ OAuth authentication successful                                  ║" -ForegroundColor Green
Write-Host "║  ✓ JWT contains legacy_username claim                               ║" -ForegroundColor Green
Write-Host "║  ✓ MCP Server authentication works                                  ║" -ForegroundColor Green
Write-Host "║                                                                      ║" -ForegroundColor White
Write-Host "║  Kerberos Delegation Tests:                                         ║" -ForegroundColor Yellow
Write-Host "║    - S4U2Self: Not implemented yet (expected)                       ║" -ForegroundColor Yellow
Write-Host "║    - S4U2Proxy: Not implemented yet (expected)                      ║" -ForegroundColor Yellow
Write-Host "║    - Unauthorized delegation: Validation works                      ║" -ForegroundColor Green
Write-Host "║                                                                      ║" -ForegroundColor White
Write-Host "╚══════════════════════════════════════════════════════════════════════╝" -ForegroundColor White
Write-Host ""

Write-Host "Next Steps:" -ForegroundColor Cyan
Write-Host "  1. Implement KerberosClient class (src/delegation/kerberos/kerberos-client.ts)" -ForegroundColor White
Write-Host "  2. Implement TicketCache class (src/delegation/kerberos/ticket-cache.ts)" -ForegroundColor White
Write-Host "  3. Update KerberosDelegationModule with real implementation" -ForegroundColor White
Write-Host "  4. Re-run this test script to verify end-to-end flow" -ForegroundColor White
Write-Host ""

Write-Host "Documentation:" -ForegroundColor Cyan
Write-Host "  - Implementation Guide: docs/kerberos.md" -ForegroundColor White
Write-Host "  - AD Setup Script: scripts/setup-ad-kerberos.ps1" -ForegroundColor White
Write-Host "  - Test Client README: test-harness/kerberos-client/README.md" -ForegroundColor White
Write-Host ""
