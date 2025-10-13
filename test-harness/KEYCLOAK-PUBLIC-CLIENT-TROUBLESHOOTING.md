# Keycloak Public Client Troubleshooting Guide

## Problem: Token Exchange Fails for Public Clients

If Inspector-style authentication is failing with the same error as MCP Inspector, this indicates a **Keycloak configuration issue** with public client support.

## Common Error Messages

### 1. "unauthorized_client"
```json
{
  "error": "unauthorized_client",
  "error_description": "Client authentication failed"
}
```

### 2. "invalid_client"
```json
{
  "error": "invalid_client",
  "error_description": "Invalid client credentials"
}
```

### 3. "invalid_grant"
```json
{
  "error": "invalid_grant",
  "error_description": "Code not valid"
}
```

## Root Cause Analysis

### OAuth 2.1 Standard
- **Public clients** are clients without credentials
- Public clients **MUST use PKCE** for security
- Public clients **SHOULD NOT send client_secret**
- `client_id` is **REQUIRED** in token exchange
- Client authentication is **NOT REQUIRED** for public clients

### Keycloak Behavior
Keycloak may reject token exchange requests from public clients if:
1. Client is configured as **CONFIDENTIAL** (expects client_secret)
2. PKCE is not properly enforced
3. Client authentication method is incorrectly set

## Step-by-Step Keycloak Configuration

### Step 1: Verify Client Type

1. **Login to Keycloak Admin Console**
   - URL: `http://localhost:8080/admin`
   - Realm: `mcp_security`

2. **Navigate to Clients**
   - Click "Clients" in left menu
   - Find and click `mcp-oauth`

3. **Check Settings Tab**

#### Access Type / Client Authentication
**CRITICAL SETTING:**

For **Keycloak 18+** (new admin console):
- Go to **"Capability config"** section
- Set **"Client authentication"** to **OFF**
- This makes the client PUBLIC

For **Keycloak 17 and earlier**:
- Look for **"Access Type"** field
- Set to **"public"** (NOT "confidential")

### Step 2: Configure Authentication Flow

In the **"Capability config"** or **"Settings"** tab:

```
✅ Standard flow                  ENABLED
✅ Direct access grants           ENABLED (optional - for password grant)
❌ Implicit flow                  DISABLED (deprecated in OAuth 2.1)
❌ Service accounts roles         DISABLED (for confidential clients only)
❌ OAuth 2.0 Device Authorization DISABLED (not needed)
```

### Step 3: Configure PKCE (CRITICAL)

Scroll to **"Advanced Settings"** section:

#### Proof Key for Code Exchange Code Challenge Method
**Set to: S256** ⚠️ REQUIRED

This enforces PKCE for all authorization requests.

Options:
- **(blank)** - PKCE optional (NOT RECOMMENDED)
- **plain** - Code verifier sent as plaintext (NOT RECOMMENDED)
- **S256** - Code verifier hashed with SHA-256 ✅ **USE THIS**

### Step 4: Configure Valid Redirect URIs

In the **"Settings"** tab:

```
Root URL: http://localhost:3001
Valid redirect URIs:
  - http://localhost:3001/*
  - http://localhost:3001/callback
Valid post logout redirect URIs:
  - http://localhost:3001/*
Web origins:
  - http://localhost:3001
```

**Note:** Must match the `redirect_uri` sent in authorization/token requests exactly.

### Step 5: Verify No Credentials Configured

1. Click **"Credentials"** tab
2. Should show: **"No credentials configured for this client"**
3. If credentials exist, DELETE them

### Step 6: Advanced Settings (Optional but Recommended)

In **"Advanced Settings"** section:

```
Access Token Lifespan:           5 minutes (shorter for public clients)
Client Session Idle:             30 minutes
Client Session Max:              10 hours
```

### Step 7: Save and Test

Click **"Save"** at the bottom of the page.

## Testing the Configuration

### Test 1: Authorization Request

Open browser console and navigate to:
```
http://localhost:8080/realms/mcp_security/protocol/openid-connect/auth?response_type=code&client_id=mcp-oauth&redirect_uri=http://localhost:3001/&code_challenge=TEST123&code_challenge_method=S256
```

**Expected:** Should redirect to Keycloak login page (not error)

### Test 2: Token Exchange (using curl)

After getting an authorization code, test token exchange:

```bash
curl -X POST http://localhost:8080/realms/mcp_security/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code" \
  -d "code=YOUR_CODE_HERE" \
  -d "redirect_uri=http://localhost:3001/" \
  -d "client_id=mcp-oauth" \
  -d "code_verifier=YOUR_CODE_VERIFIER_HERE"
```

**Expected Success:**
```json
{
  "access_token": "eyJhbGci...",
  "expires_in": 300,
  "refresh_expires_in": 1800,
  "refresh_token": "eyJhbGci...",
  "token_type": "Bearer",
  "id_token": "eyJhbGci...",
  "not-before-policy": 0,
  "session_state": "...",
  "scope": "openid profile email"
}
```

**Expected Failure (if misconfigured):**
```json
{
  "error": "unauthorized_client",
  "error_description": "Client authentication failed"
}
```

## Common Misconfigurations

### Issue 1: Client is CONFIDENTIAL

**Symptom:** Error "Client authentication failed"

**Check:**
```
Settings → Capability config → Client authentication: OFF
```

**Fix:** Turn OFF client authentication

### Issue 2: PKCE Not Enforced

**Symptom:** Authorization works but token exchange fails with "invalid_grant"

**Check:**
```
Settings → Advanced Settings → Proof Key for Code Exchange Code Challenge Method
```

**Fix:** Set to **S256**

### Issue 3: Redirect URI Mismatch

**Symptom:** Error "invalid_grant" or "redirect_uri mismatch"

**Check:** Redirect URI in token exchange MUST exactly match:
1. The URI sent in authorization request
2. One of the "Valid redirect URIs" in Keycloak

**Fix:** Ensure exact match including trailing slashes

### Issue 4: Client Secret Still Expected

**Symptom:** Error "invalid_client_credentials"

**Check:**
```
Credentials Tab → Should show "No credentials configured"
```

**Fix:**
1. Delete any existing credentials
2. Verify "Client authentication" is OFF
3. Save changes

## Keycloak Version-Specific Notes

### Keycloak 21+ (Quarkus-based)
- Uses **"Client authentication"** toggle
- More intuitive public client configuration
- PKCE settings in Advanced tab

### Keycloak 17-20
- Uses **"Access Type"** dropdown
- Select "public" explicitly
- PKCE settings may be in different location

### Keycloak 16 and earlier (WildFly-based)
- Uses **"Access Type"** dropdown
- May not support PKCE S256 enforcement
- Consider upgrading for better OAuth 2.1 support

## Verification Checklist

Before testing Inspector-style auth, verify:

- [ ] Client authentication: **OFF**
- [ ] Access Type: **public** (or Client authentication OFF)
- [ ] Standard flow: **ENABLED**
- [ ] PKCE Code Challenge Method: **S256**
- [ ] Valid redirect URIs include: `http://localhost:3001/*`
- [ ] Credentials tab shows: "No credentials configured"
- [ ] Client saved successfully

## Alternative: Create New Public Client

If issues persist, create a fresh client:

1. **Create New Client**
   - Client ID: `mcp-oauth-public`
   - Client Protocol: `openid-connect`
   - Click Save

2. **Configure as Public**
   - Client authentication: **OFF**
   - Standard flow: **ON**
   - Valid redirect URIs: `http://localhost:3001/*`
   - PKCE: **S256**
   - Save

3. **Update config.js**
   ```javascript
   inspector: {
     clientId: 'mcp-oauth-public',  // Changed
     // ... rest of config
   }
   ```

## References

- [OAuth 2.1 Draft - Public Clients](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-11#section-2.1)
- [RFC 7636 - PKCE](https://datatracker.ietf.org/doc/html/rfc7636)
- [Keycloak Documentation](https://www.keycloak.org/docs/latest/server_admin/)

## Summary

**Key Requirements for Public Client in Keycloak:**

1. ✅ Client authentication: **OFF**
2. ✅ PKCE Code Challenge Method: **S256**
3. ✅ No credentials in Credentials tab
4. ✅ Valid redirect URIs configured
5. ✅ Standard flow enabled

If all settings are correct and it still fails, the issue may be with:
- Keycloak version compatibility
- Realm-level settings
- Client policies/profiles
- Network/CORS issues

Check Keycloak server logs for detailed error information:
```bash
docker logs keycloak_container_name -f
```
