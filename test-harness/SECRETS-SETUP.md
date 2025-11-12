# Phase 3 Test Server - Secure Secrets Setup

**Version:** 3.2+ | **Date:** 2025-01-11

This document explains how to configure secrets for the Phase 3 test server using the new Dynamic Secret Resolution system.

---

## What Changed (v3.2+)

The Phase 3 test server now uses **secure secret management** instead of hardcoded passwords:

### Before (v3.1 and earlier):
```json
{
  "password": "ServicePass123!"  // ❌ Hardcoded in config file
}
```

### After (v3.2+):
```json
{
  "password": { "$secret": "POSTGRESQL1_PASSWORD" }  // ✅ Logical name only
}
```

**Benefits:**
- ✅ No secrets committed to Git
- ✅ Different secrets for dev/test/prod
- ✅ Kubernetes/Docker native support
- ✅ Audit logging of secret access
- ✅ Fail-fast security (server won't start if secrets missing)

---

## Quick Start (Development)

### Step 1: Copy Environment Template
```bash
# From project root
cp test-harness/.env.phase3 test-harness/.env
```

### Step 2: Edit .env File
Open `test-harness/.env` and update with actual secret values:

```bash
# PostgreSQL 1 - Primary Database
POSTGRESQL1_PASSWORD=your_actual_password_here
POSTGRESQL1_OAUTH_CLIENT_SECRET=your_actual_oauth_secret_here

# PostgreSQL 2 - Analytics Database
POSTGRESQL2_PASSWORD=your_actual_password_here
POSTGRESQL2_OAUTH_CLIENT_SECRET=your_actual_oauth_secret_here

# Kerberos Delegation
KERBEROS_SERVICE_ACCOUNT_PASSWORD=your_actual_password_here
KERBEROS_OAUTH_CLIENT_SECRET=your_actual_oauth_secret_here
```

### Step 3: Load Environment Variables

**Windows (PowerShell):**
```powershell
# Option 1: Use dotenv (recommended)
npm install -g dotenv-cli
cd test-harness
dotenv -e .env -- cmd /c start-phase3-server.bat

# Option 2: Set manually
$env:POSTGRESQL1_PASSWORD="ServicePass123!"
$env:POSTGRESQL1_OAUTH_CLIENT_SECRET="sVJvwv0AllnSw64MUggSk9NS2ifteLQK"
# ... set remaining variables
cd test-harness
.\start-phase3-server.bat
```

**Linux/macOS (Bash):**
```bash
# Option 1: Use dotenv (recommended)
npm install -g dotenv-cli
cd test-harness
dotenv -e .env -- ./start-phase3-server.sh

# Option 2: Export variables
export POSTGRESQL1_PASSWORD="ServicePass123!"
export POSTGRESQL1_OAUTH_CLIENT_SECRET="sVJvwv0AllnSw64MUggSk9NS2ifteLQK"
# ... export remaining variables
cd test-harness
./start-phase3-server.sh
```

### Step 4: Start Server
```bash
npm run build
cd test-harness
start-phase3-server.bat  # Windows
# or
./start-phase3-server.sh  # Linux/macOS
```

---

## Production Deployment (Kubernetes)

For production, use **Kubernetes Secrets** mounted as files (most secure):

### Step 1: Create Kubernetes Secrets
```bash
kubectl create secret generic mcp-postgresql1 \
  --from-literal=password='ServicePass123!' \
  --from-literal=oauth-client-secret='sVJvwv0AllnSw64MUggSk9NS2ifteLQK'

kubectl create secret generic mcp-postgresql2 \
  --from-literal=password='Letmein' \
  --from-literal=oauth-client-secret='tErtusngY6ukdctJL7Ouy8oImZK9wHe4'

kubectl create secret generic mcp-kerberos \
  --from-literal=service-account-password='YourSecurePassword123!' \
  --from-literal=oauth-client-secret='sVJvwv0AllnSw64MUggSk9NS2ifteLQK'
```

### Step 2: Mount Secrets in Deployment
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mcp-oauth-server
spec:
  template:
    spec:
      containers:
      - name: mcp-server
        image: your-registry/mcp-oauth:3.2
        volumeMounts:
        - name: postgresql1-secrets
          mountPath: /run/secrets
          readOnly: true
        - name: postgresql2-secrets
          mountPath: /run/secrets
          readOnly: true
        - name: kerberos-secrets
          mountPath: /run/secrets
          readOnly: true
      volumes:
      - name: postgresql1-secrets
        secret:
          secretName: mcp-postgresql1
          items:
          - key: password
            path: POSTGRESQL1_PASSWORD
          - key: oauth-client-secret
            path: POSTGRESQL1_OAUTH_CLIENT_SECRET
      - name: postgresql2-secrets
        secret:
          secretName: mcp-postgresql2
          items:
          - key: password
            path: POSTGRESQL2_PASSWORD
          - key: oauth-client-secret
            path: POSTGRESQL2_OAUTH_CLIENT_SECRET
      - name: kerberos-secrets
        secret:
          secretName: mcp-kerberos
          items:
          - key: service-account-password
            path: KERBEROS_SERVICE_ACCOUNT_PASSWORD
          - key: oauth-client-secret
            path: KERBEROS_OAUTH_CLIENT_SECRET
```

### Step 3: Deploy
```bash
kubectl apply -f deployment.yaml
```

**How It Works:**
1. Kubernetes mounts secrets as files in `/run/secrets/`
2. FileSecretProvider reads secrets from `/run/secrets/POSTGRESQL1_PASSWORD`
3. No environment variables needed (more secure)
4. Secrets automatically rotated by Kubernetes

---

## Secret Resolution Order

The framework tries providers in this order:

1. **FileSecretProvider** (highest priority)
   - Location: `/run/secrets/{SECRET_NAME}`
   - Use: Kubernetes, Docker, production
   - Security: ✅ Best (file permissions, no process leakage)

2. **EnvProvider** (fallback)
   - Location: `process.env[SECRET_NAME]`
   - Use: Development, testing
   - Security: ⚠️ Lower (visible in process list)

3. **Fail-Fast** (if not found)
   - Server exits with error message
   - Forces explicit secret configuration

---

## Troubleshooting

### Error: "Secret could not be resolved"
**Cause:** Missing environment variable or file

**Solution:**
```bash
# Check which secret is missing from error message
# Example: Secret "POSTGRESQL1_PASSWORD" could not be resolved

# Verify environment variable is set
echo $POSTGRESQL1_PASSWORD  # Linux/macOS
echo %POSTGRESQL1_PASSWORD%  # Windows CMD
echo $env:POSTGRESQL1_PASSWORD  # Windows PowerShell

# If using files, verify file exists
ls /run/secrets/POSTGRESQL1_PASSWORD
```

### Error: "Config file not found"
**Cause:** CONFIG_PATH environment variable incorrect

**Solution:**
```bash
# Ensure path is relative to project root
set CONFIG_PATH=./test-harness/config/phase3-test-config.json
```

### Server starts but PostgreSQL connection fails
**Cause:** Secret contains wrong value or extra whitespace

**Solution:**
```bash
# Secrets are automatically trimmed
# Verify secret value matches actual database password
# Check PostgreSQL logs for authentication errors
```

---

## Security Best Practices

### ✅ DO:
- Use Kubernetes secrets for production
- Use `/run/secrets/` file mounts (most secure)
- Add `.env` to `.gitignore`
- Rotate secrets regularly
- Use different secrets for dev/test/prod
- Monitor audit logs for secret access

### ❌ DON'T:
- Commit `.env` to version control
- Use hardcoded secrets in config files
- Share secrets in Slack/email
- Use production secrets in development
- Log secret values (automatically sanitized)

---

## Configuration-Specific Secrets

**IMPORTANT:** The required secrets are **determined by your configuration file**, not by the framework. The secrets listed below are specific to the **Phase 3 test configuration** (`phase3-test-config.json`) and will differ for other deployments.

### How to Identify Required Secrets

Search your configuration file for `{"$secret": "NAME"}` descriptors:

```bash
# Find all secret descriptors in your config (Linux/macOS)
grep -o '"$secret":\s*"[^"]*"' your-config.json

# Windows PowerShell
Select-String -Path your-config.json -Pattern '\$secret' | ForEach-Object { $_.Line }

# Or manually search for: {"$secret": "NAME"}
```

**Example from phase3-test-config.json:**
```json
{
  "password": { "$secret": "POSTGRESQL1_PASSWORD" },
  "clientSecret": { "$secret": "POSTGRESQL1_OAUTH_CLIENT_SECRET" }
}
```

### Secrets for Phase 3 Test Config Only

These secrets are **only required for `phase3-test-config.json`**. Your configuration may have different secrets:

| Secret Name | Configuration Path | Purpose |
|-------------|-------------------|---------|
| `POSTGRESQL1_PASSWORD` | `delegation.modules.postgresql1.password` | Primary DB password |
| `POSTGRESQL1_OAUTH_CLIENT_SECRET` | `delegation.modules.postgresql1.tokenExchange.clientSecret` | Primary DB OAuth secret |
| `POSTGRESQL2_PASSWORD` | `delegation.modules.postgresql2.password` | Analytics DB password |
| `POSTGRESQL2_OAUTH_CLIENT_SECRET` | `delegation.modules.postgresql2.tokenExchange.clientSecret` | Analytics DB OAuth secret |
| `KERBEROS_SERVICE_ACCOUNT_PASSWORD` | `delegation.modules._kerberos.serviceAccount.password` | Kerberos svc account |
| `KERBEROS_OAUTH_CLIENT_SECRET` | `delegation.modules._kerberos.tokenExchange.clientSecret` | Kerberos OAuth secret |

**Notes:**
- Your configuration may have more, fewer, or completely different secret names
- Secret names are defined by **you** in the configuration file
- The framework only resolves secrets it finds in your config
- No secrets are "required" by the framework - only by your specific configuration

---

## Additional Resources

- [SECRETS-MANAGEMENT.md](../Docs/SECRETS-MANAGEMENT.md) - Full implementation guide
- [CONFIGURATION.md](../Docs/CONFIGURATION.md) - Configuration reference
- [server-with-secrets.ts](../examples/server-with-secrets.ts) - Example server code

For questions or issues, see [GitHub Issues](https://github.com/gazzadownunder/fastmcp-oauth/issues).
