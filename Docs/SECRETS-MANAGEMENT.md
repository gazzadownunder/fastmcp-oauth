# Secure Secrets Management - Design Reference

**Version:** 1.0.0 | **Status:** Production Ready | **Last Updated:** 2025-01-11

This document provides the **reference architecture and implementation guide** for the Dynamic Configuration Resolution system in the MCP OAuth framework. This system eliminates hardcoded credentials from configuration files through a provider-based secret resolution mechanism.

**Target Audience:** Framework developers, extension authors, DevOps engineers implementing custom secret providers

---

## Table of Contents

- [Executive Summary](#executive-summary)
- [Architecture Overview](#architecture-overview)
- [Core Components](#core-components)
- [Provider Implementation Guide](#provider-implementation-guide)
- [Configuration Guide](#configuration-guide)
- [Deployment Scenarios](#deployment-scenarios)
- [Migration Guide](#migration-guide)
- [Security Considerations](#security-considerations)
- [Testing Strategy](#testing-strategy)
- [Appendix](#appendix)

---

## Executive Summary

### The Problem

Traditional configuration management stores sensitive credentials (database passwords, OAuth client secrets, service account passwords) as plaintext in configuration files, creating critical security vulnerabilities:

- ❌ **Secret Exposure** - Credentials committed to version control (Git history)
- ❌ **No Auditing** - No tracking of secret access or resolution
- ❌ **Difficult Rotation** - Requires configuration edits and redeployments
- ❌ **Configuration Drift** - Different configuration files for dev/test/prod environments

### The Solution

**Dynamic Configuration Resolution** - A provider chain system that:

- ✅ **Eliminates Hardcoded Secrets** - Configuration files contain logical names only
- ✅ **Provider-Agnostic** - Supports file mounts, environment variables, cloud secret managers
- ✅ **Prioritizes Security** - File-based secrets (Kubernetes mounts) over environment variables
- ✅ **Audits Access** - Tracks which provider resolved each secret
- ✅ **Fail-Fast** - Application fails to start if secrets cannot be resolved
- ✅ **Backward Compatible** - Existing plaintext strings continue to work

### Design Principles

1. **Configuration-Driven** - No hardcoded secret names in framework code
2. **Provider Chain Pattern** - Multiple resolution strategies with priority ordering
3. **Fail-Fast Security** - Missing secrets cause immediate startup failure
4. **Zero-Code Integration** - Works transparently with existing `FastMCPOAuthServer`
5. **Audit by Default** - All secret resolutions logged to audit trail

---

## Architecture Overview

### Three Core Components

```
┌─────────────────────────────────────────────────────────────┐
│                1. Static Configuration File                 │
│  Contains logical secret names ({"$secret": "DB_PASSWORD"}) │
│  Safe to commit to version control                          │
└────────────────────┬────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────────┐
│                    2. SecretResolver                        │
│  Orchestrates secret resolution via provider chain          │
│  - Loads config from disk                                   │
│  - Walks JSON recursively                                   │
│  - Resolves {"$secret": "NAME"} descriptors                 │
│  - Injects resolved values into config object               │
└────────────────────┬────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────────┐
│              3. ISecretProvider Chain                       │
│  Prioritized chain of secret providers:                     │
│  1. FileSecretProvider (Kubernetes/Docker mounts)           │
│  2. EnvProvider (Environment variables / .env files)        │
│  3. AWSSecretsManagerProvider (optional)                    │
│  4. AzureKeyVaultProvider (optional)                        │
└─────────────────────────────────────────────────────────────┘
```

### ISecretProvider Interface

All secret providers implement this simple interface:

```typescript
interface ISecretProvider {
  /**
   * Attempts to resolve a logical secret name.
   * @param logicalName - The logical name (e.g., "DB_PASSWORD")
   * @returns The secret string, or undefined if not found
   */
  resolve(logicalName: string): Promise<string | undefined>;
}
```

### Provider Priority Chain

**Recommended order (highest to lowest priority):**

1. **FileSecretProvider** - `/run/secrets/` (Kubernetes/Docker mounts)
   - Most secure (strict file permissions: 0400)
   - Never exposed in process environment
   - Recommended for production

2. **EnvProvider** - `process.env` (Environment variables)
   - Fallback for development (.env files)
   - Less secure (visible to all child processes)
   - Higher risk of accidental logging

3. **Cloud Providers** (optional) - AWS Secrets Manager, Azure Key Vault, GCP Secret Manager
   - Direct integration with cloud secret vaults
   - Requires application IAM permissions
   - Adds network latency

### Resolution Flow

```typescript
// 1. Config file contains secret descriptor
{
  "password": {
    "$secret": "DB_PASSWORD"
  }
}

// 2. SecretResolver walks config and finds descriptor
secretResolver.resolveSecrets(config)

// 3. Queries provider chain in order
FileSecretProvider.resolve("DB_PASSWORD")  // Checks /run/secrets/DB_PASSWORD
  → undefined (not found)

EnvProvider.resolve("DB_PASSWORD")          // Checks process.env.DB_PASSWORD
  → "ServicePass123!" (found!)

// 4. Injects resolved value into config
{
  "password": "ServicePass123!"  // Resolved secret (in memory only)
}

// 5. Audit log records resolution
{
  "source": "secret:resolution",
  "secretName": "DB_PASSWORD",
  "provider": "EnvProvider",
  "success": true,
  "timestamp": "2025-01-11T10:30:00Z"
}
```

---

## Core Components

### 1. ISecretProvider Interface

All secret providers implement this interface for uniform resolution:

**Location:** [src/config/secrets/ISecretProvider.ts](../src/config/secrets/ISecretProvider.ts)

```typescript
/**
 * Interface for secret providers that resolve logical secret names
 * to actual secret values from various sources (files, env vars, vaults).
 */
export interface ISecretProvider {
  /**
   * Attempts to resolve a logical secret name to its actual value.
   *
   * @param logicalName - The logical name from config (e.g., "DB_PASSWORD")
   * @returns The secret string if found, undefined if not found
   * @throws Error only for fatal errors (not for "secret not found")
   */
  resolve(logicalName: string): Promise<string | undefined>;
}
```

**Contract:**
- Return `string` if secret found
- Return `undefined` if secret not found (try next provider)
- Throw `Error` only for fatal errors (permission denied, network failure)
- Must be stateless (no caching between calls)

---

### 2. SecretResolver

Orchestrates secret resolution across multiple providers.

**Location:** [src/config/secrets/SecretResolver.ts](../src/config/secrets/SecretResolver.ts)

**Key Methods:**

```typescript
class SecretResolver {
  /**
   * Adds a provider to the resolution chain.
   * Providers are queried in the order they are added.
   */
  addProvider(provider: ISecretProvider): void

  /**
   * Recursively walks configuration object and resolves all
   * secret descriptors ({"$secret": "NAME"}) to actual values.
   */
  async resolveSecrets(config: any): Promise<void>
}
```

**Algorithm:**

1. Walk JSON tree recursively (depth-first traversal)
2. For each object, check if it matches `{"$secret": "NAME"}` pattern
3. If match found:
   - Extract logical name
   - Query providers in order until one returns non-undefined
   - Log resolution attempt to audit service
   - Replace descriptor with resolved value in-place
   - Continue traversal
4. If no provider resolves secret, throw error (fail-fast)

---

### 3. Built-In Providers

#### FileSecretProvider

Reads secrets from files (Kubernetes/Docker secret mounts).

**Location:** [src/config/secrets/providers/FileSecretProvider.ts](../src/config/secrets/providers/FileSecretProvider.ts)

**Configuration:**
```typescript
const provider = new FileSecretProvider('/run/secrets');
```

**Resolution Logic:**
- File path: `{baseDir}/{logicalName}`
- Example: `/run/secrets/DB_PASSWORD`
- Reads file contents and trims whitespace
- Returns `undefined` if file doesn't exist
- Throws if permission denied (EACCES)

**Security Features:**
- ✅ Path traversal prevention (blocks `../`, absolute paths)
- ✅ Respects file permissions (fails if not readable)
- ✅ Never logs secret values

**Recommended Use:** Production deployments (Kubernetes, Docker)

---

#### EnvProvider

Reads secrets from environment variables.

**Location:** [src/config/secrets/providers/EnvProvider.ts](../src/config/secrets/providers/EnvProvider.ts)

**Configuration:**
```typescript
const provider = new EnvProvider();
```

**Resolution Logic:**
- Checks: `process.env[logicalName]`
- Example: `process.env.DB_PASSWORD`
- Returns `undefined` if variable not set
- Trims whitespace from values

**Security Considerations:**
- ⚠️ Environment variables visible to child processes
- ⚠️ May appear in process listings (`ps aux`)
- ⚠️ Higher risk of accidental logging

**Recommended Use:** Development, testing, CI/CD environments

---

### 4. ConfigManager Integration

Secret resolution is integrated into `ConfigManager.loadConfig()`.

**Location:** [src/config/manager.ts](../src/config/manager.ts)

**Developer Usage:**

No code changes required - secret resolution happens transparently:

```typescript
import { FastMCPOAuthServer } from '@fastmcp-oauth/core';

const server = new FastMCPOAuthServer();
await server.start({
  configPath: './config.json',  // Contains secret descriptors
  transport: 'httpStream',
  port: 3000
});
// Secrets resolved automatically during startup
```

---

### 5. Schema Integration

Schemas updated to accept secret descriptors alongside plain strings.

**Location:** [src/config/schemas/delegation.ts](../src/config/schemas/delegation.ts)

**Implementation:**

```typescript
import { z } from 'zod';

// Secret descriptor schema
export const SecretDescriptorSchema = z.object({
  $secret: z.string().min(1).describe('Logical secret name for runtime resolution'),
});

// Union type: plain string OR secret descriptor
export const SecretOrString = z.union([
  z.string().min(1),           // Legacy: "password123"
  SecretDescriptorSchema        // New: {"$secret": "DB_PASSWORD"}
]);
```

**Backward Compatibility:**

Both formats are valid:

```json
// Legacy (still works)
{
  "password": "MyPassword123!"
}

// Modern (recommended)
{
  "password": { "$secret": "DB_PASSWORD" }
}
```

---

## Provider Implementation Guide

### Creating a Custom Provider

Implement the `ISecretProvider` interface to add support for custom secret sources (AWS Secrets Manager, Azure Key Vault, HashiCorp Vault, etc.).

**Step 1: Implement the Interface**

```typescript
import { ISecretProvider } from '@fastmcp-oauth/core/config/secrets';

export class MyCustomProvider implements ISecretProvider {
  private client: any;

  constructor(config: MyProviderConfig) {
    this.client = this.initializeClient(config);
  }

  async resolve(logicalName: string): Promise<string | undefined> {
    try {
      // Fetch secret from your source
      const secret = await this.fetchFromSource(logicalName);

      if (!secret) {
        return undefined;  // Secret not found - try next provider
      }

      return secret;  // Return secret value

    } catch (error) {
      // Only throw for fatal errors (auth failure, network error)
      if (this.isFatalError(error)) {
        throw error;
      }

      // Return undefined for "not found" errors
      return undefined;
    }
  }

  private async fetchFromSource(name: string): Promise<string | undefined> {
    // Your implementation here
  }

  private isFatalError(error: any): boolean {
    // Determine if error should halt startup
    return error.code === 'ECONNREFUSED' || error.code === 'EACCES';
  }
}
```

**Step 2: Register Provider**

```typescript
import { SecretResolver } from '@fastmcp-oauth/core/config/secrets';
import { FileSecretProvider, EnvProvider } from '@fastmcp-oauth/core/config/secrets/providers';
import { MyCustomProvider } from './MyCustomProvider';

// Create resolver with custom provider chain
const secretResolver = new SecretResolver();

// Priority order (highest to lowest)
secretResolver.addProvider(new FileSecretProvider('/run/secrets'));  // 1st
secretResolver.addProvider(new MyCustomProvider({ region: 'us-east-1' })); // 2nd
secretResolver.addProvider(new EnvProvider());  // 3rd (fallback)
```

---

### Example: AWS Secrets Manager Provider

**Installation:**

```bash
npm install @aws-sdk/client-secrets-manager
```

**Implementation:**

```typescript
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { ISecretProvider } from '@fastmcp-oauth/core/config/secrets';

export class AWSSecretsManagerProvider implements ISecretProvider {
  private client: SecretsManagerClient;

  constructor(region: string = 'us-east-1') {
    this.client = new SecretsManagerClient({ region });
  }

  async resolve(logicalName: string): Promise<string | undefined> {
    try {
      const command = new GetSecretValueCommand({
        SecretId: logicalName  // Logical name = AWS secret ID
      });

      const response = await this.client.send(command);

      // AWS returns secret as string or binary
      return response.SecretString || Buffer.from(response.SecretBinary!).toString();

    } catch (error: any) {
      // Secret not found in AWS - try next provider
      if (error.name === 'ResourceNotFoundException') {
        return undefined;
      }

      // Fatal errors (auth failure, network)
      throw new Error(`AWS Secrets Manager error: ${error.message}`);
    }
  }
}
```

---

### Provider Best Practices

#### 1. Error Handling

✅ **Do:**
- Return `undefined` for "not found" scenarios
- Throw errors for fatal conditions (auth failure, network error)
- Log errors internally but don't expose sensitive details

❌ **Don't:**
- Throw for "secret not found" (breaks provider chain)
- Log secret values (even in debug mode)
- Return empty string (should return `undefined`)

#### 2. Performance

✅ **Do:**
- Cache client connections (reuse SDK clients)
- Use connection pooling for network-based providers
- Return quickly on "not found" (don't retry)

❌ **Don't:**
- Create new client per `resolve()` call
- Implement internal caching (SecretResolver does this)
- Perform expensive operations on every call

#### 3. Security

✅ **Do:**
- Use least-privilege credentials
- Validate input (sanitize secret names)
- Support read-only access modes

❌ **Don't:**
- Require admin/write permissions
- Log secret values or API tokens
- Store credentials in provider code

---

## Configuration Guide

For detailed configuration instructions, see [CONFIGURATION.md](CONFIGURATION.md#secret-management-v32).

### Key Concepts

**Secret Descriptor Format:**

```json
{
  "$secret": "LOGICAL_SECRET_NAME"
}
```

**Finding Required Secrets:**

```bash
# Search configuration for secret descriptors
grep -o '"$secret":\s*"[^"]*"' config.json
```

**Development Setup (.env file):**

```bash
DB_PASSWORD=DevPassword123!
OAUTH_CLIENT_SECRET=DevClientSecret456
```

**Production Setup (Kubernetes):**

```bash
kubectl create secret generic mcp-oauth-secrets \
  --from-literal=DB_PASSWORD='ProductionPass123!' \
  --from-literal=OAUTH_CLIENT_SECRET='prod-secret-xyz' \
  --namespace=default
```

Refer to [CONFIGURATION.md - Secret Management section](CONFIGURATION.md#secret-management-v32) for complete examples and deployment scenarios.

---

## Deployment Scenarios

### Scenario 1: Kubernetes with Secret Mounts

**Kubernetes Secret:**

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: mcp-oauth-secrets
  namespace: default
type: Opaque
data:
  # Base64-encoded secrets
  DB_PASSWORD: U2VydmljZVBhc3MxMjMh
  OAUTH_CLIENT_SECRET: c1ZKdnd2MEFsbG5TdzY0TVVnZ1NrOU5TMmlmdGVMUUs=
```

**Deployment:**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mcp-oauth-server
spec:
  template:
    spec:
      containers:
      - name: mcp-oauth
        image: mcp-oauth:latest
        volumeMounts:
        - name: secrets
          mountPath: /run/secrets
          readOnly: true
      volumes:
      - name: secrets
        secret:
          secretName: mcp-oauth-secrets
          items:
          - key: DB_PASSWORD
            path: DB_PASSWORD
            mode: 0400
          - key: OAUTH_CLIENT_SECRET
            path: OAUTH_CLIENT_SECRET
            mode: 0400
```

**Benefits:**
- ✅ Secrets never in container image
- ✅ Secrets never in environment variables
- ✅ Strict file permissions (0400)
- ✅ Kubernetes handles secret rotation
- ✅ Secrets encrypted at rest (etcd)

---

### Scenario 2: Docker with Secret Mounts

**Docker Compose:**

```yaml
version: '3.8'
services:
  mcp-oauth:
    image: mcp-oauth:latest
    secrets:
      - db_password
      - oauth_client_secret
    environment:
      - NODE_ENV=production

secrets:
  db_password:
    file: ./secrets/db_password.txt
  oauth_client_secret:
    file: ./secrets/oauth_client_secret.txt
```

**Secret Files:**
```bash
mkdir -p ./secrets
chmod 700 ./secrets

echo "ServicePass123!" > ./secrets/db_password.txt
echo "sVJvwv0AllnSw64MUggSk9NS2ifteLQK" > ./secrets/oauth_client_secret.txt

chmod 400 ./secrets/*.txt
```

**Docker mounts secrets at:** `/run/secrets/db_password`, `/run/secrets/oauth_client_secret`

---

### Scenario 3: Local Development with .env

**Configuration:** `config/dev.json`

```json
{
  "delegation": {
    "modules": {
      "postgresql": {
        "password": {
          "$secret": "DB_PASSWORD"
        }
      }
    }
  }
}
```

**.env file:** (never commit!)

```bash
DB_PASSWORD=DevPassword123!
OAUTH_CLIENT_SECRET=DevClientSecret456
```

**CRITICAL: Application Entry Point Must Load .env**

The secrets management system reads from `process.env` but does NOT load .env files automatically. Your application's main entry point MUST import dotenv BEFORE any other framework imports:

```typescript
#!/usr/bin/env node

// IMPORTANT: Load .env FIRST before any other imports
// This populates process.env for the secrets management system
import 'dotenv/config';

// Now import framework components
import { ConfigManager } from './config/manager.js';

const configManager = new ConfigManager();
await configManager.loadConfig('./config/dev.json');
// Secrets now resolved from process.env (populated by dotenv)
```

**Why This Design?**

The secrets management system (SecretResolver + EnvProvider) intentionally does NOT handle .env loading because:

1. **Separation of Concerns** - Environment setup (loading .env) is an application concern, not a framework concern
2. **Flexibility** - Applications can use dotenv, dotenv-expand, or other environment loaders
3. **No Side Effects** - Framework code doesn't modify `process.env` unexpectedly
4. **Standard Pattern** - Follows Node.js best practices where main entry point configures environment

**Optional: Specify .env Path**

By default, dotenv searches for `.env` in the current working directory. To specify a different path:

```typescript
import 'dotenv/config';  // Uses DOTENV_CONFIG_PATH environment variable
```

Then set the path via environment variable:

```bash
# Windows batch file
set DOTENV_CONFIG_PATH=./test-harness/.env
node dist/server.js

# Unix shell
DOTENV_CONFIG_PATH=./config/.env node dist/server.js
```

---

### Scenario 4: AWS Secrets Manager (Optional)

**Provider Implementation:**

```typescript
// src/config/secrets/providers/AWSSecretsManagerProvider.ts
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

export class AWSSecretsManagerProvider implements ISecretProvider {
  private client: SecretsManagerClient;

  constructor(region: string = 'us-east-1') {
    this.client = new SecretsManagerClient({ region });
  }

  async resolve(logicalName: string): Promise<string | undefined> {
    try {
      const command = new GetSecretValueCommand({
        SecretId: logicalName
      });
      const response = await this.client.send(command);
      return response.SecretString;
    } catch (error) {
      if (error.name === 'ResourceNotFoundException') {
        return undefined;
      }
      throw error;
    }
  }
}
```

**Provider Chain:**
```typescript
secretResolver.addProvider(new FileSecretProvider('/run/secrets'));
secretResolver.addProvider(new AWSSecretsManagerProvider('us-east-1'));
secretResolver.addProvider(new EnvProvider());
```

---

## Migration Guide

### Step 1: Identify Secrets in Current Config

**Current config:** `config.json`

```json
{
  "delegation": {
    "modules": {
      "postgresql": {
        "password": "ServicePass123!",  // ← Secret #1
        "tokenExchange": {
          "clientSecret": "sVJvwv0AllnSw64MUggSk9NS2ifteLQK"  // ← Secret #2
        }
      }
    }
  }
}
```

**Identified secrets:**
- `DB_PASSWORD` = "ServicePass123!"
- `OAUTH_CLIENT_SECRET` = "sVJvwv0AllnSw64MUggSk9NS2ifteLQK"

---

### Step 2: Create Secret Files (Production)

**Kubernetes:**

```bash
kubectl create secret generic mcp-oauth-secrets \
  --from-literal=DB_PASSWORD='ServicePass123!' \
  --from-literal=OAUTH_CLIENT_SECRET='sVJvwv0AllnSw64MUggSk9NS2ifteLQK' \
  --namespace=default
```

**Docker:**

```bash
mkdir -p /run/secrets
echo 'ServicePass123!' > /run/secrets/DB_PASSWORD
echo 'sVJvwv0AllnSw64MUggSk9NS2ifteLQK' > /run/secrets/OAUTH_CLIENT_SECRET
chmod 400 /run/secrets/*
```

---

### Step 3: Update Configuration

**New config:** `config.json`

```json
{
  "delegation": {
    "modules": {
      "postgresql": {
        "password": {
          "$secret": "DB_PASSWORD"
        },
        "tokenExchange": {
          "clientSecret": {
            "$secret": "OAUTH_CLIENT_SECRET"
          }
        }
      }
    }
  }
}
```

**Safe to commit!** No plaintext secrets.

---

### Step 4: Update Deployment

**Kubernetes:** Add secret volume mount (see Scenario 1 above)

**Docker:** Add secret mounts to docker-compose.yml (see Scenario 2 above)

**Local Development:** Create `.env` file (see Scenario 3 above)

---

### Step 5: Test Secret Resolution

**Startup logs:**

```
[SecretResolver] Resolving secret: DB_PASSWORD
[FileSecretProvider] Found secret at /run/secrets/DB_PASSWORD
[AuditService] Secret resolved: DB_PASSWORD via FileSecretProvider
[SecretResolver] Resolving secret: OAUTH_CLIENT_SECRET
[FileSecretProvider] Found secret at /run/secrets/OAUTH_CLIENT_SECRET
[AuditService] Secret resolved: OAUTH_CLIENT_SECRET via FileSecretProvider
[ConfigManager] Configuration loaded successfully
```

**Verify resolved values:**

```typescript
const config = configManager.getConfig();
console.log('DB Password length:', config.delegation.modules.postgresql.password.length);
// Output: DB Password length: 14 (never log actual password!)
```

---

### Step 6: Remove Secrets from Git History

**⚠️ Critical:** Secrets remain in Git history even after removal!

**Option 1: BFG Repo-Cleaner (Recommended)**

```bash
# Install BFG
brew install bfg  # macOS
# Or download from https://rtyley.github.io/bfg-repo-cleaner/

# Create secrets list
echo "ServicePass123!" > passwords.txt
echo "sVJvwv0AllnSw64MUggSk9NS2ifteLQK" >> passwords.txt

# Remove secrets from history
bfg --replace-text passwords.txt

# Force push (coordinate with team!)
git reflog expire --expire=now --all && git gc --prune=now --aggressive
git push --force --all
```

**Option 2: git-filter-repo**

```bash
pip install git-filter-repo

git filter-repo --invert-paths --path test-harness/config/phase3-test-config.json
```

---

## Security Considerations

### Threat Model

| Threat | Current Risk | Mitigated Risk | Mitigation |
|--------|-------------|----------------|------------|
| **Secret Exposure in Git** | 🔴 Critical | ✅ Eliminated | Config contains logical names only |
| **Accidental Log Exposure** | 🟠 High | ✅ Mitigated | FileSecretProvider prevents env logging |
| **Process Inspection** | 🟠 High | ✅ Mitigated | File mounts with 0400 permissions |
| **Compromised Container** | 🟡 Medium | 🟡 Medium | Secrets in memory (unavoidable) |
| **Insider Threat** | 🟡 Medium | 🟠 Reduced | Audit logging tracks access |
| **Secret Rotation** | 🟠 High | ✅ Simplified | Update secret mount, restart pod |

---

### Best Practices

#### 1. Never Commit Secrets

**❌ Bad:**
```json
{ "password": "ServicePass123!" }
```

**✅ Good:**
```json
{ "password": { "$secret": "DB_PASSWORD" } }
```

#### 2. Use File-Based Secrets in Production

**Priority Order:**
1. ✅ File mounts (`/run/secrets/`) - Most secure
2. ⚠️ Environment variables - Fallback only
3. ❌ Hardcoded - Never

#### 3. Restrict File Permissions

```bash
chmod 0400 /run/secrets/*  # Owner read-only
chown mcp-service:mcp-service /run/secrets/*
```

#### 4. Enable Audit Logging

```json
{
  "auth": {
    "audit": {
      "enabled": true,
      "logAllAttempts": true
    }
  }
}
```

#### 5. Rotate Secrets Regularly

**Kubernetes:**
```bash
kubectl create secret generic mcp-oauth-secrets \
  --from-literal=DB_PASSWORD='NewPassword456!' \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl rollout restart deployment/mcp-oauth-server
```

#### 6. Use Principle of Least Privilege

**Don't give application direct vault access:**

❌ **Bad:** Application reads from AWS Secrets Manager directly
- Requires IAM role with `secretsmanager:GetSecretValue`
- Increases attack surface

✅ **Good:** Platform mounts secrets as files
- Application only reads files
- Platform authenticates to vault
- Separation of concerns

---

## Testing Strategy

### Unit Tests

**FileSecretProvider Tests:**

```typescript
describe('FileSecretProvider', () => {
  it('should read secret from file', async () => {
    // Create temp file
    const secretPath = '/tmp/test-secret';
    await fs.writeFile(secretPath, 'MySecret123!');

    const provider = new FileSecretProvider('/tmp');
    const result = await provider.resolve('test-secret');

    expect(result).toBe('MySecret123!');
  });

  it('should return undefined if file not found', async () => {
    const provider = new FileSecretProvider('/tmp');
    const result = await provider.resolve('nonexistent');

    expect(result).toBeUndefined();
  });

  it('should trim whitespace from secret', async () => {
    const secretPath = '/tmp/test-secret';
    await fs.writeFile(secretPath, '  MySecret123!  \n');

    const provider = new FileSecretProvider('/tmp');
    const result = await provider.resolve('test-secret');

    expect(result).toBe('MySecret123!');
  });
});
```

---

### Integration Tests

**End-to-End Secret Resolution:**

```typescript
describe('ConfigManager with SecretResolver', () => {
  it('should resolve secrets from files', async () => {
    // Setup: Create secret files
    await fs.mkdir('/tmp/secrets', { recursive: true });
    await fs.writeFile('/tmp/secrets/DB_PASSWORD', 'TestPass123!');

    // Create config with secret descriptor
    const config = {
      delegation: {
        modules: {
          postgresql: {
            password: { $secret: 'DB_PASSWORD' }
          }
        }
      }
    };

    // Write config to temp file
    const configPath = '/tmp/test-config.json';
    await fs.writeFile(configPath, JSON.stringify(config));

    // Load config (should resolve secret)
    const configManager = new ConfigManager();
    await configManager.loadConfig(configPath);

    const resolved = configManager.getConfig();
    expect(resolved.delegation.modules.postgresql.password).toBe('TestPass123!');
  });
});
```

---

### Security Tests

**Path Traversal Prevention:**

```typescript
describe('FileSecretProvider Security', () => {
  it('should prevent path traversal attacks', async () => {
    const provider = new FileSecretProvider('/run/secrets');

    // Attempt to read /etc/passwd via path traversal
    const result = await provider.resolve('../../../etc/passwd');

    // Should safely resolve to /run/secrets/../../../etc/passwd
    // which normalizes to /etc/passwd, but provider should reject
    expect(result).toBeUndefined();
  });

  it('should reject absolute paths', async () => {
    const provider = new FileSecretProvider('/run/secrets');

    const result = await provider.resolve('/etc/passwd');

    expect(result).toBeUndefined();
  });
});
```

---

## Appendix

### A. Complete Implementation Example

**File: `src/index.ts`** (Updated with secret resolution)

```typescript
import 'dotenv/config';  // Load .env for development
import { ConfigManager } from './config/manager.js';
import { FastMCPOAuthServer } from './mcp/server.js';

async function main() {
  // ConfigManager now uses SecretResolver internally
  const configManager = new ConfigManager();

  try {
    // Load config - secrets resolved automatically
    await configManager.loadConfig('./config.json');

    console.log('✅ Configuration loaded with secure secret resolution');

    // Create and start server
    const server = new FastMCPOAuthServer(configManager);
    await server.start({ transport: 'httpStream', port: 3000 });

  } catch (error) {
    console.error('❌ FATAL: Failed to load configuration');
    console.error(error.message);
    process.exit(1);  // Fail-fast if secrets cannot be resolved
  }
}

main();
```

---

### B. Provider Implementation Template

**Template for custom providers:**

```typescript
import { ISecretProvider } from '../ISecretProvider.js';

export class MyCustomProvider implements ISecretProvider {
  async resolve(logicalName: string): Promise<string | undefined> {
    try {
      // Your secret retrieval logic here
      const secret = await this.fetchSecretFromSource(logicalName);
      return secret;

    } catch (error) {
      // Return undefined to try next provider
      return undefined;
    }
  }

  private async fetchSecretFromSource(name: string): Promise<string | undefined> {
    // Implementation details
  }
}
```

**Usage:**

```typescript
import { SecretResolver } from './config/secrets/index.js';
import { MyCustomProvider } from './config/secrets/providers/MyCustomProvider.js';

const resolver = new SecretResolver();
resolver.addProvider(new MyCustomProvider());
```

---

### C. Implementation Status

| Component | Status | Tests | Coverage |
|-----------|--------|-------|----------|
| ISecretProvider Interface | ✅ Complete | - | - |
| FileSecretProvider | ✅ Complete | 21 tests | 100% |
| EnvProvider | ✅ Complete | 23 tests | 100% |
| SecretResolver | ✅ Complete | 28 tests | 98% |
| Schema Integration | ✅ Complete | - | - |
| Audit Integration | ✅ Complete | - | - |
| Documentation | ✅ Complete | - | - |

**Overall Status:** ✅ Production Ready

**Test Summary:**
- **72/72 tests passing** (100%)
- **Code coverage:** >95% across all components
- **Security tests:** Path traversal, permission handling, injection prevention

---

### D. Configuration Examples

#### Multi-Database with Secret Descriptors

```json
{
  "delegation": {
    "modules": {
      "postgresql1": {
        "toolPrefix": "hr",
        "host": "hr-db.company.com",
        "database": "hr_database",
        "user": "mcp_service",
        "password": {
          "$secret": "HR_DB_PASSWORD"
        },
        "tokenExchange": {
          "clientSecret": {
            "$secret": "HR_OAUTH_CLIENT_SECRET"
          }
        }
      },
      "postgresql2": {
        "toolPrefix": "sales",
        "host": "sales-db.company.com",
        "database": "sales_database",
        "user": "mcp_service",
        "password": {
          "$secret": "SALES_DB_PASSWORD"
        },
        "tokenExchange": {
          "clientSecret": {
            "$secret": "SALES_OAUTH_CLIENT_SECRET"
          }
        }
      }
    }
  }
}
```

**Secret Files:**

```bash
/run/secrets/
├── HR_DB_PASSWORD
├── HR_OAUTH_CLIENT_SECRET
├── SALES_DB_PASSWORD
└── SALES_OAUTH_CLIENT_SECRET
```

---

### E. Troubleshooting

#### Issue 1: Secret Not Resolved

**Error:**
```
❌ FATAL: Secret "DB_PASSWORD" could not be resolved by any provider.
```

**Solution:**

1. **Check File Provider:**
   ```bash
   ls -la /run/secrets/DB_PASSWORD
   # Should show: -r-------- 1 mcp-service mcp-service 14 Jan 11 10:30 DB_PASSWORD
   ```

2. **Check Environment Variables:**
   ```bash
   echo $DB_PASSWORD
   # Should print: ServicePass123! (if using EnvProvider)
   ```

3. **Check Provider Order:**
   ```typescript
   // FileProvider should be first
   secretResolver.addProvider(new FileSecretProvider('/run/secrets'));
   secretResolver.addProvider(new EnvProvider());
   ```

#### Issue 2: Permission Denied

**Error:**
```
[FileSecretProvider] Error reading /run/secrets/DB_PASSWORD: EACCES
```

**Solution:**

```bash
# Check file permissions
ls -la /run/secrets/DB_PASSWORD

# Fix permissions
chmod 400 /run/secrets/DB_PASSWORD
chown mcp-service:mcp-service /run/secrets/DB_PASSWORD
```

#### Issue 3: Secret in Logs

**Problem:** Secret accidentally logged to console

**Prevention:**

```typescript
// ❌ BAD - Logs entire config (may contain secrets)
console.log('Config loaded:', config);

// ✅ GOOD - Log config structure only
console.log('Config loaded successfully');
console.log('Modules:', Object.keys(config.delegation.modules));
```

---

## References

- **Configuration Guide:** [CONFIGURATION.md](CONFIGURATION.md) - User-facing config documentation
- **Framework Design:** [CLAUDE.md](../CLAUDE.md) - Overall framework architecture
- **Test Suite:** [tests/unit/config/secrets/](../tests/unit/config/secrets/) - Unit tests for providers
- **Implementation:** [src/config/secrets/](../src/config/secrets/) - Source code
- **Kubernetes Secrets:** https://kubernetes.io/docs/concepts/configuration/secret/
- **Docker Secrets:** https://docs.docker.com/engine/swarm/secrets/

---

## Change Log

| Date | Version | Changes |
|------|---------|---------|
| 2025-01-11 | 1.0.0 | Transformed from implementation tracking to reference design document |
| 2025-01-11 | 0.9.0 | Core implementation complete (Phases 1-4) |

---

**Document Type:** Reference Design & Implementation Guide
**Maintenance:** Update when adding new providers or changing architecture
**Related Documents:** [CONFIGURATION.md](CONFIGURATION.md), [CLAUDE.md](../CLAUDE.md)
