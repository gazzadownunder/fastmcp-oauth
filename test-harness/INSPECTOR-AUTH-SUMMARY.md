# Inspector-Style Authentication - Complete Analysis

## What is Inspector-Style Authentication?

Inspector-style authentication is an **OAuth 2.1 PUBLIC CLIENT** implementation that matches the MCP Inspector's authentication behavior.

## OAuth 2.1 Public Client Standard

### Definition
From OAuth 2.1 Draft (Section 2.1):
> **Public clients** are clients incapable of maintaining the confidentiality of their credentials (e.g., clients executing on the device used by the resource owner, such as an installed native application or a web browser-based application).

### Key Requirements
1. **Client Type**: PUBLIC (not confidential)
2. **Client Secret**: MUST NOT be used (cannot be kept secret in browser)
3. **PKCE**: MUST be used (RFC 7636) as replacement for client_secret
4. **Client ID**: REQUIRED in all requests
5. **Client Authentication**: Not performed (no credentials to authenticate with)

## Why Public Clients?

Browser-based applications (like MCP Inspector and mcp-client) are PUBLIC clients because:
- JavaScript code is visible to users (View Source)
- Client secrets can be extracted from browser
- Cannot securely store credentials
- Run in untrusted environment (user's browser)

**Security Model:** PKCE cryptographic binding replaces client credentials

## Inspector-Style vs Standard OAuth

| Feature | Standard OAuth (Confidential) | Inspector-Style (Public) |
|---------|------------------------------|--------------------------|
| Client Type | CONFIDENTIAL | PUBLIC |
| client_secret | ✅ Required | ❌ Forbidden |
| PKCE | ⚠️ Recommended | ✅ Required |
| Security Basis | Client credentials | PKCE cryptographic binding |
| Token Exchange Auth | client_id + client_secret | client_id + code_verifier |
| Parameters (Auth) | 7-9 | 5 |
| Parameters (Token) | 5-6 | 4 |

## Implementation Details

### Authorization Request (5 parameters)
```http
GET /realms/mcp_security/protocol/openid-connect/auth?
  response_type=code&                    ← REQUIRED
  client_id=mcp-oauth&                   ← REQUIRED
  redirect_uri=http://localhost:3001/&  ← REQUIRED
  code_challenge=CVA5GEyz...&            ← REQUIRED (PKCE)
  code_challenge_method=S256             ← REQUIRED (PKCE)
```

**Omitted (compared to standard OAuth):**
- ❌ `scope` - Uses IDP defaults (openid profile email)
- ❌ `state` - PKCE provides CSRF protection

### Token Exchange (4 parameters + PKCE)
```http
POST /realms/mcp_security/protocol/openid-connect/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&              ← REQUIRED
code=8c15d3d2-918e-4d48-8458...&           ← REQUIRED
redirect_uri=http://localhost:3001/&       ← REQUIRED
client_id=mcp-oauth&                        ← REQUIRED
code_verifier=owduct05gq1MuXBYkCnpq2HBK... ← REQUIRED (PKCE)
```

**Omitted (compared to standard OAuth):**
- ❌ `client_secret` - Public client has no secret

## PKCE Security Model

### How PKCE Replaces client_secret

1. **Client generates code_verifier**
   - Cryptographically random string (43-128 characters)
   - Kept secret in browser (sessionStorage)
   - Never transmitted during authorization

2. **Client computes code_challenge**
   - SHA-256 hash of code_verifier
   - Sent in authorization request
   - IDP stores it with authorization code

3. **Token Exchange Validation**
   - Client sends code_verifier
   - IDP computes SHA-256(code_verifier)
   - Compares with stored code_challenge
   - Must match to issue tokens

**Result:** Authorization code is cryptographically bound to the client that initiated the request.

### Security Guarantees

| Attack Vector | Protection Mechanism |
|--------------|---------------------|
| Code Interception | Code useless without code_verifier |
| CSRF | Code bound to specific client session via PKCE |
| Replay Attack | Authorization code is single-use |
| Client Impersonation | Attacker cannot generate valid code_verifier |

## Keycloak Configuration Requirements

### Critical Settings

**Client Settings → Capability Config:**
```
Client authentication:           OFF      ← CRITICAL (makes it PUBLIC)
Standard flow:                   ENABLED
Direct access grants:            ENABLED  (optional)
Implicit flow:                   DISABLED (deprecated)
Service accounts roles:          DISABLED (for confidential only)
```

**Client Settings → Advanced Settings:**
```
Proof Key for Code Exchange
  Code Challenge Method:         S256     ← CRITICAL (enforces PKCE)
```

**Client Settings → Credentials Tab:**
```
Should show: "No credentials configured for this client"
```

### Why These Settings Matter

1. **Client authentication: OFF**
   - Tells Keycloak this is a PUBLIC client
   - Keycloak will NOT require client_secret
   - Keycloak will accept requests without client authentication

2. **PKCE Code Challenge Method: S256**
   - Enforces PKCE for all authorization requests
   - Requires SHA-256 hashing (more secure than "plain")
   - Validates code_verifier in token exchange

## Common Failure Modes

### 1. Client Configured as CONFIDENTIAL

**Error:**
```json
{
  "error": "unauthorized_client",
  "error_description": "Client authentication failed"
}
```

**Cause:** "Client authentication" is ON (expects client_secret)

**Fix:** Set "Client authentication" to OFF

### 2. PKCE Not Enforced

**Error:**
```json
{
  "error": "invalid_grant",
  "error_description": "PKCE verification failed"
}
```

**Cause:** PKCE Code Challenge Method not set to S256

**Fix:** Set "Proof Key for Code Exchange Code Challenge Method" to S256

### 3. Redirect URI Mismatch

**Error:**
```json
{
  "error": "invalid_grant",
  "error_description": "Incorrect redirect_uri"
}
```

**Cause:** redirect_uri in token exchange doesn't match authorization request

**Fix:** Ensure exact match (including trailing slashes)

## Testing Procedure

### Step 1: Configure Keycloak

Follow [KEYCLOAK-PUBLIC-CLIENT-TROUBLESHOOTING.md](KEYCLOAK-PUBLIC-CLIENT-TROUBLESHOOTING.md)

### Step 2: Open mcp-client

```bash
# Serve mcp-client on port 3001
# (or configure redirect URIs to match your port)
```

### Step 3: Click Inspector-Style Auth Button

Browser console should show:
```
[AUTH-INSPECTOR] PKCE code_verifier generated (length: 43)
[AUTH-INSPECTOR] PKCE code_challenge generated (SHA-256)
✓ Inspector-style OAuth request built (minimal parameters)
[AUTH-INSPECTOR] Authorization URL: http://localhost:8080/...
```

### Step 4: Authenticate at Keycloak

After login, browser should redirect back with authorization code.

### Step 5: Token Exchange

Browser console should show:
```
[AUTH-INSPECTOR] Inspector-style token exchange detected
🔍 Using pre-registered redirect_uri: http://localhost:3001/
🔓 Public client (no client_secret - PKCE provides security)
🔐 PKCE code_verifier included in token exchange
[AUTH-INSPECTOR] Token exchange request: { ... }
✓ Authorization code exchanged successfully (Inspector-style)
```

### Step 6: Success Indicators

- ✅ Access token received
- ✅ ID token received
- ✅ User session established
- ✅ MCP can be initialized with bearer token

## Verification Checklist

Before reporting issues, verify:

### Keycloak Configuration
- [ ] Client authentication is OFF
- [ ] PKCE Code Challenge Method is S256
- [ ] Standard flow is ENABLED
- [ ] Valid redirect URIs include your mcp-client URL
- [ ] Credentials tab shows "No credentials configured"

### Browser Console Logs
- [ ] PKCE parameters generated successfully
- [ ] Authorization URL has 5 parameters (not 7-9)
- [ ] Token exchange shows "Public client (no client_secret)"
- [ ] Token exchange includes code_verifier

### Network Tab
- [ ] Authorization request has code_challenge parameter
- [ ] Token exchange POST does NOT include client_secret
- [ ] Token exchange POST includes code_verifier
- [ ] Response HTTP 200 with access_token

## Comparison with MCP Inspector

The mcp-client Inspector-style authentication should behave **identically** to MCP Inspector:

| Aspect | MCP Inspector | mcp-client Inspector-Style |
|--------|--------------|---------------------------|
| Client Type | PUBLIC | PUBLIC ✅ |
| client_secret | None | None ✅ |
| PKCE | S256 | S256 ✅ |
| Auth Params | 5 | 5 ✅ |
| Token Params | 4-5 | 4-5 ✅ |
| Security Model | PKCE binding | PKCE binding ✅ |

If MCP Inspector fails with same error, the issue is **Keycloak configuration**, not the client implementation.

## OAuth 2.1 Compliance

This implementation is **fully compliant** with OAuth 2.1 Draft Specification:

✅ Public client (Section 2.1)
✅ PKCE required (Section 7.6)
✅ S256 code challenge method (RFC 7636)
✅ No client_secret for public clients (Section 2.1)
✅ client_id in all requests (Section 4.1.1)
✅ Authorization code flow (Section 4.1)

## References

1. [OAuth 2.1 Draft Specification](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-11)
2. [RFC 7636 - PKCE](https://datatracker.ietf.org/doc/html/rfc7636)
3. [OAuth 2.0 for Browser-Based Apps](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-browser-based-apps)

## Summary

**Inspector-style authentication IS a supported OAuth 2.1 method** for public clients.

If it's failing:
1. ✅ The implementation is correct
2. ❌ Keycloak configuration needs adjustment

Follow [KEYCLOAK-PUBLIC-CLIENT-TROUBLESHOOTING.md](KEYCLOAK-PUBLIC-CLIENT-TROUBLESHOOTING.md) to configure Keycloak properly for public client support.
