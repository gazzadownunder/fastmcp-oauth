# ============================================================================
# Active Directory Kerberos Delegation Setup Script
# ============================================================================
#
# Purpose: Configure Windows Server 2025 (192.168.1.25) for MCP OAuth
#          Kerberos Constrained Delegation
#
# Prerequisites:
#   - Windows Server 2025 with AD DS installed
#   - PowerShell run as Administrator
#   - Active Directory PowerShell module installed
#
# Usage:
#   .\setup-ad-kerberos.ps1 -DomainController "192.168.1.25" -Realm "COMPANY.COM"
#
# ============================================================================

param(
    [Parameter(Mandatory=$false)]
    [string]$DomainController = "192.168.1.25",

    [Parameter(Mandatory=$false)]
    [string]$Realm = "COMPANY.COM",

    [Parameter(Mandatory=$false)]
    [string]$ServiceAccountName = "svc-mcp-server",

    [Parameter(Mandatory=$false)]
    [string]$ServiceAccountPassword = "YourSecurePassword123!",

    [Parameter(Mandatory=$false)]
    [string]$MCPServerHostname = "mcp-server",

    [Parameter(Mandatory=$false)]
    [string]$FileServerSPN = "cifs/192.168.1.25",

    [Parameter(Mandatory=$false)]
    [string]$FileServerHostSPN = "HOST/192.168.1.25"
)

# ============================================================================
# Helper Functions
# ============================================================================

function Write-Step {
    param([string]$Message)
    Write-Host "`n[STEP] $Message" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "[SUCCESS] $Message" -ForegroundColor Green
}

function Write-Error-Custom {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Yellow
}

# ============================================================================
# Pre-flight Checks
# ============================================================================

Write-Step "Running pre-flight checks..."

# Check if running as Administrator
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error-Custom "This script must be run as Administrator"
    exit 1
}

# Check if Active Directory module is available
if (-not (Get-Module -ListAvailable -Name ActiveDirectory)) {
    Write-Error-Custom "Active Directory PowerShell module not found. Install RSAT tools."
    exit 1
}

# Import Active Directory module
Import-Module ActiveDirectory -ErrorAction Stop
Write-Success "Active Directory module loaded"

# Verify domain connectivity
try {
    $domain = Get-ADDomain
    Write-Success "Connected to domain: $($domain.DNSRoot)"
} catch {
    Write-Error-Custom "Cannot connect to Active Directory: $_"
    exit 1
}

# ============================================================================
# Step 1: Create Service Account
# ============================================================================

Write-Step "Creating service account: $ServiceAccountName"

try {
    # Check if service account already exists
    $existingAccount = Get-ADUser -Filter "SamAccountName -eq '$ServiceAccountName'" -ErrorAction SilentlyContinue

    if ($existingAccount) {
        Write-Info "Service account already exists. Updating properties..."
        Set-ADUser -Identity $ServiceAccountName `
            -Description "MCP OAuth Server - Kerberos Delegation Service Account" `
            -PasswordNeverExpires $true `
            -Enabled $true
    } else {
        # Create new service account
        $securePassword = ConvertTo-SecureString $ServiceAccountPassword -AsPlainText -Force

        New-ADUser -Name $ServiceAccountName `
            -SamAccountName $ServiceAccountName `
            -UserPrincipalName "$ServiceAccountName@$Realm" `
            -AccountPassword $securePassword `
            -Enabled $true `
            -PasswordNeverExpires $true `
            -CannotChangePassword $true `
            -Description "MCP OAuth Server - Kerberos Delegation Service Account"

        Write-Success "Service account created: $ServiceAccountName"
    }

    # Verify account
    $account = Get-ADUser -Identity $ServiceAccountName
    Write-Host "  DN: $($account.DistinguishedName)" -ForegroundColor Gray
    Write-Host "  UPN: $($account.UserPrincipalName)" -ForegroundColor Gray
    Write-Host "  Enabled: $($account.Enabled)" -ForegroundColor Gray

} catch {
    Write-Error-Custom "Failed to create service account: $_"
    exit 1
}

# ============================================================================
# Step 2: Register Service Principal Names (SPNs)
# ============================================================================

Write-Step "Registering Service Principal Names (SPNs)..."

try {
    # Register HTTP SPNs
    $spns = @(
        "HTTP/$MCPServerHostname.$($domain.DNSRoot)",
        "HTTP/$MCPServerHostname",
        "HTTP/localhost"  # For local testing
    )

    foreach ($spn in $spns) {
        Write-Info "Registering SPN: $spn"

        # Check if SPN already registered
        $existingSPN = setspn -Q $spn 2>&1

        if ($LASTEXITCODE -eq 0 -and $existingSPN -match $ServiceAccountName) {
            Write-Info "  SPN already registered"
        } else {
            # Remove from other accounts if exists
            setspn -D $spn $ServiceAccountName 2>&1 | Out-Null

            # Register SPN
            $result = setspn -S $spn $ServiceAccountName
            if ($LASTEXITCODE -eq 0) {
                Write-Success "  SPN registered: $spn"
            } else {
                Write-Error-Custom "  Failed to register SPN: $spn"
            }
        }
    }

    # Verify SPNs
    Write-Info "Verifying registered SPNs..."
    $registeredSPNs = setspn -L $ServiceAccountName
    Write-Host $registeredSPNs -ForegroundColor Gray

} catch {
    Write-Error-Custom "Failed to register SPNs: $_"
    exit 1
}

# ============================================================================
# Step 3: Enable Constrained Delegation (S4U2Self + S4U2Proxy)
# ============================================================================

Write-Step "Enabling Kerberos Constrained Delegation..."

try {
    # Get service account object
    $mcpAccount = Get-ADUser -Identity $ServiceAccountName

    # Enable protocol transition (S4U2Self)
    Write-Info "Enabling protocol transition (S4U2Self)..."
    Set-ADAccountControl -Identity $mcpAccount `
        -TrustedToAuthForDelegation $true

    Write-Success "Protocol transition enabled"

    # Add delegation targets (S4U2Proxy)
    Write-Info "Adding delegation targets (S4U2Proxy) for file server access..."

    $delegationTargets = @(
        $FileServerSPN,
        $FileServerHostSPN,
        "cifs/fileserver.company.com",
        "HOST/fileserver.company.com"
    )

    foreach ($target in $delegationTargets) {
        Write-Info "  Adding target: $target"
        Set-ADUser -Identity $mcpAccount `
            -Add @{'msDS-AllowedToDelegateTo' = $target}
    }

    Write-Info "File server SPNs configured for:"
    Write-Info "  • SMB/CIFS file shares (cifs/...)"
    Write-Info "  • Generic host services (HOST/...)"

    Write-Success "Delegation targets configured"

    # Verify delegation settings
    Write-Info "Verifying delegation configuration..."
    $delegationInfo = Get-ADUser -Identity $ServiceAccountName `
        -Properties TrustedToAuthForDelegation, msDS-AllowedToDelegateTo |
        Select-Object Name, TrustedToAuthForDelegation, msDS-AllowedToDelegateTo

    Write-Host "  Name: $($delegationInfo.Name)" -ForegroundColor Gray
    Write-Host "  TrustedToAuthForDelegation: $($delegationInfo.TrustedToAuthForDelegation)" -ForegroundColor Gray
    Write-Host "  Allowed Delegation Targets:" -ForegroundColor Gray
    $delegationInfo.'msDS-AllowedToDelegateTo' | ForEach-Object {
        Write-Host "    - $_" -ForegroundColor Gray
    }

} catch {
    Write-Error-Custom "Failed to configure delegation: $_"
    exit 1
}

# ============================================================================
# Step 4: Create Test User Accounts
# ============================================================================

Write-Step "Creating test user accounts..."

$testUsers = @(
    @{
        Name = "Alice Admin"
        SamAccountName = "alice"
        UPN = "alice@$Realm"
        Password = "Password123!"
        Description = "Test user - Admin role"
    },
    @{
        Name = "Bob User"
        SamAccountName = "bob"
        UPN = "bob@$Realm"
        Password = "Password123!"
        Description = "Test user - User role"
    },
    @{
        Name = "Charlie Guest"
        SamAccountName = "charlie"
        UPN = "charlie@$Realm"
        Password = "Password123!"
        Description = "Test user - Guest role"
    }
)

foreach ($user in $testUsers) {
    try {
        # Check if user already exists
        $existingUser = Get-ADUser -Filter "SamAccountName -eq '$($user.SamAccountName)'" -ErrorAction SilentlyContinue

        if ($existingUser) {
            Write-Info "User already exists: $($user.SamAccountName)"
        } else {
            $securePassword = ConvertTo-SecureString $user.Password -AsPlainText -Force

            New-ADUser -Name $user.Name `
                -SamAccountName $user.SamAccountName `
                -UserPrincipalName $user.UPN `
                -AccountPassword $securePassword `
                -Enabled $true `
                -PasswordNeverExpires $true `
                -Description $user.Description

            Write-Success "Created user: $($user.SamAccountName)"
        }
    } catch {
        Write-Error-Custom "Failed to create user $($user.SamAccountName): $_"
    }
}

# Verify test users
Write-Info "Verifying test users..."
$users = Get-ADUser -Filter {SamAccountName -eq "alice" -or SamAccountName -eq "bob" -or SamAccountName -eq "charlie"} |
    Select-Object Name, SamAccountName, UserPrincipalName, Enabled

$users | ForEach-Object {
    Write-Host "  $($_.SamAccountName): $($_.UserPrincipalName) (Enabled: $($_.Enabled))" -ForegroundColor Gray
}

# ============================================================================
# Step 5: Generate Keytab File (Optional - for Linux)
# ============================================================================

Write-Step "Generating keytab file (optional)..."

try {
    $keytabPath = "C:\keytabs"
    $keytabFile = "$keytabPath\mcp-server.keytab"

    # Create keytabs directory if doesn't exist
    if (-not (Test-Path $keytabPath)) {
        New-Item -ItemType Directory -Path $keytabPath | Out-Null
        Write-Success "Created keytabs directory: $keytabPath"
    }

    # Generate keytab
    Write-Info "Generating keytab file..."
    $ktpassCommand = "ktpass /princ HTTP/$MCPServerHostname.$($domain.DNSRoot)@$Realm " +
                     "/mapuser $ServiceAccountName@$Realm " +
                     "/pass $ServiceAccountPassword " +
                     "/out $keytabFile " +
                     "/crypto AES256-SHA1 " +
                     "/ptype KRB5_NT_PRINCIPAL"

    Invoke-Expression $ktpassCommand | Out-Null

    if (Test-Path $keytabFile) {
        Write-Success "Keytab file generated: $keytabFile"
        Write-Info "Copy this file to Linux MCP Server at: /etc/keytabs/mcp-server.keytab"

        # Verify keytab
        Write-Info "Verifying keytab entries..."
        klist -k $keytabFile
    } else {
        Write-Error-Custom "Keytab file not created"
    }

} catch {
    Write-Error-Custom "Failed to generate keytab: $_"
}

# ============================================================================
# Step 6: Verification Summary
# ============================================================================

Write-Step "Running final verification..."

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Configuration Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Service Account
Write-Host "`n[Service Account]" -ForegroundColor Yellow
$accountInfo = Get-ADUser -Identity $ServiceAccountName `
    -Properties Enabled, TrustedToAuthForDelegation, ServicePrincipalNames, msDS-AllowedToDelegateTo

Write-Host "  Name: $($accountInfo.Name)" -ForegroundColor Gray
Write-Host "  UPN: $($accountInfo.UserPrincipalName)" -ForegroundColor Gray
Write-Host "  Enabled: $($accountInfo.Enabled)" -ForegroundColor Gray
Write-Host "  TrustedToAuthForDelegation: $($accountInfo.TrustedToAuthForDelegation)" -ForegroundColor Gray

# SPNs
Write-Host "`n[Service Principal Names]" -ForegroundColor Yellow
$accountInfo.ServicePrincipalNames | ForEach-Object {
    Write-Host "  - $_" -ForegroundColor Gray
}

# Delegation Targets
Write-Host "`n[Allowed Delegation Targets]" -ForegroundColor Yellow
$accountInfo.'msDS-AllowedToDelegateTo' | ForEach-Object {
    Write-Host "  - $_" -ForegroundColor Gray
}

# Test Users
Write-Host "`n[Test Users]" -ForegroundColor Yellow
$testUsersList = Get-ADUser -Filter {SamAccountName -eq "alice" -or SamAccountName -eq "bob" -or SamAccountName -eq "charlie"} |
    Select-Object SamAccountName, UserPrincipalName, Enabled

$testUsersList | ForEach-Object {
    Write-Host "  - $($_.SamAccountName) ($($_.UserPrincipalName)) - Enabled: $($_.Enabled)" -ForegroundColor Gray
}

# Domain Info
Write-Host "`n[Domain Information]" -ForegroundColor Yellow
$domainInfo = Get-ADDomain
Write-Host "  Domain: $($domainInfo.DNSRoot)" -ForegroundColor Gray
Write-Host "  Domain Mode: $($domainInfo.DomainMode)" -ForegroundColor Gray
Write-Host "  Forest Mode: $($domainInfo.ForestMode)" -ForegroundColor Gray

# Next Steps
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Next Steps" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Configure Keycloak to include 'legacy_username' claim in JWT tokens" -ForegroundColor White
Write-Host "   - Map to AD attribute: sAMAccountName" -ForegroundColor Gray
Write-Host ""
Write-Host "2. Update MCP Server configuration:" -ForegroundColor White
Write-Host "   - Config file: test-harness/config/kerberos-test-config.json" -ForegroundColor Gray
Write-Host ""
Write-Host "3. If using Linux MCP Server:" -ForegroundColor White
Write-Host "   - Copy keytab: C:\keytabs\mcp-server.keytab -> /etc/keytabs/" -ForegroundColor Gray
Write-Host "   - Set permissions: chmod 600 /etc/keytabs/mcp-server.keytab" -ForegroundColor Gray
Write-Host ""
Write-Host "4. Start MCP Server and run test suite:" -ForegroundColor White
Write-Host "   - npm run build && npm start" -ForegroundColor Gray
Write-Host "   - test-harness/scripts/test-kerberos.ps1" -ForegroundColor Gray
Write-Host ""

Write-Success "Active Directory configuration complete!"
