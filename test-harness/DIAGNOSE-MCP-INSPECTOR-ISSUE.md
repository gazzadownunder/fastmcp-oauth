# Diagnosing MCP Inspector OAuth Issue

## Problem Statement

- ✅ **mcp-client Inspector-style auth WORKS** with Keycloak public client configuration
- ❌ **MCP Inspector FAILS** with "invalid credentials" error using same Keycloak configuration

This indicates a difference in how MCP Inspector and mcp-client are making OAuth requests.

## Diagnostic Steps

### Step 1: Capture MCP Inspector Network Requests

1. **Open MCP Inspector** in browser
2. **Open Browser DevTools** (F12)
3. **Go to Network tab**
4. **Clear network log**
5. **Start OAuth flow** in MCP Inspector
6. **Find the authorization request**

Look for requests to:
```
http://localhost:8080/realms/mcp_security/protocol/openid-connect/auth
```

#### Questions to Answer:

**Authorization Request:**
- [ ] What parameters are included? (list them all)
- [ ] What is the `client_id` value?
- [ ] Is `client_secret` included in URL? (shouldn't be)
- [ ] Is `code_challenge` included?
- [ ] Is `code_challenge_method` included?
- [ ] What is the `redirect_uri` value?
- [ ] Is `resource` parameter included?
- [ ] Is `scope` parameter included?
- [ ] Is `state` parameter included?

**Token Exchange Request:**
```
POST http://localhost:8080/realms/mcp_security/protocol/openid-connect/token
```

- [ ] What is the request body? (show all parameters)
- [ ] Is `client_secret` included in body?
- [ ] Is `code_verifier` included?
- [ ] What HTTP status code is returned?
- [ ] What error response is returned?

### Step 2: Check for Dynamic Client Registration (DCR)

MCP Inspector may attempt **Dynamic Client Registration** before authorization.

Look for requests to:
```
http://localhost:8080/realms/mcp_security/clients-registrations/openid-connect
```

Or:
```
http://localhost:8080/realms/mcp_security/.well-known/openid-configuration
```

Then check if registration_endpoint is called.

#### Questions:

- [ ] Does MCP Inspector try to discover registration_endpoint?
- [ ] Does MCP Inspector POST to a registration endpoint?
- [ ] What error is returned from registration?

### Step 3: Compare Working vs Failing Requests

#### Working Request (mcp-client)

**Authorization URL:**
```
http://localhost:8080/realms/mcp_security/protocol/openid-connect/auth?
  response_type=code&
  client_id=mcp-oauth&
  redirect_uri=http://localhost:3001/&
  code_challenge=CVA5GEyz2nB6H4RXASPvBXUZKA2CP0fZDu4RjeD75f8&
  code_challenge_method=S256
```

**Token Exchange:**
```
POST /token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&
code=...&
redirect_uri=http://localhost:3001/&
client_id=mcp-oauth&
code_verifier=...
```

#### Failing Request (MCP Inspector)

**Fill in from Network tab:**
```
Authorization URL:
[PASTE ACTUAL URL WITH PARAMETERS]

Token Exchange:
[PASTE ACTUAL REQUEST BODY]

Error Response:
[PASTE ACTUAL ERROR JSON]
```

### Step 4: Check Keycloak Client Configuration

Go to Keycloak Admin Console:

**Client: mcp-oauth**

#### Settings Tab
- [ ] Client authentication: **OFF** (public client)
- [ ] Valid redirect URIs: **List all entries**
- [ ] Web origins: **List all entries**

#### Advanced Settings
- [ ] Proof Key for Code Exchange Code Challenge Method: **S256**

#### Credentials Tab
- [ ] Should show: "No credentials configured for this client"

### Step 5: Check Keycloak Realm Settings

**Realm: mcp_security**

Go to **Realm Settings** → **Endpoints**

Check if these endpoints exist:
- [ ] Registration endpoint
- [ ] Token endpoint
- [ ] Authorization endpoint

### Step 6: Check MCP Inspector Configuration

In MCP Inspector UI:

**OAuth Configuration Section:**
- [ ] What authorization endpoint is configured?
- [ ] What token endpoint is configured?
- [ ] What client_id is shown?
- [ ] Is client_secret shown or required?
- [ ] What redirect_uri is configured?

## Common Root Causes

### Issue 1: MCP Inspector Using Different client_id

**Symptom:** "invalid_client" or "Client not found"

**Check:**
- MCP Inspector may be generating a random client_id
- Or using a different client_id than "mcp-oauth"

**Solution:**
- Configure MCP Inspector to use client_id: "mcp-oauth"
- Or create a new Keycloak client with the ID MCP Inspector is using

### Issue 2: Dynamic Client Registration Not Enabled

**Symptom:** MCP Inspector tries to register client and fails

**Check:**
- Look for POST to `/clients-registrations/` endpoint
- Error: "Client registration not enabled" or 404

**Solution Option A - Enable DCR in Keycloak:**
1. Realm Settings → Client Registration → Policies
2. Enable "Authenticated Access"
3. Configure client registration policies

**Solution Option B - Manually Configure Client:**
1. Pre-create client in Keycloak with MCP Inspector's expected ID
2. Configure as public client
3. Add MCP Inspector's redirect URIs

### Issue 3: Redirect URI Not Registered

**Symptom:** "invalid_redirect_uri" error

**Check:**
- MCP Inspector's actual redirect_uri (from network tab)
- Keycloak's "Valid redirect URIs" list

**Solution:**
- Add MCP Inspector's redirect URI to Keycloak
- Common values:
  - `http://localhost:*` (wildcard)
  - `http://127.0.0.1:*` (wildcard)
  - MCP Inspector's specific URI

### Issue 4: MCP Inspector Requires client_secret (Confidential)

**Symptom:** Works when client authentication is ON, fails when OFF

**Check:**
- MCP Inspector may be configured for confidential client
- Trying to send client_secret even though you removed it

**Solution:**
- Configure MCP Inspector for public client mode
- Or keep Keycloak client as CONFIDENTIAL and provide secret to Inspector

### Issue 5: PKCE Not Sent or Validated

**Symptom:** "invalid_grant" during token exchange

**Check:**
- Does authorization request include code_challenge?
- Does token exchange include code_verifier?
- Is "PKCE Code Challenge Method" set to S256 in Keycloak?

**Solution:**
- Ensure MCP Inspector is sending PKCE parameters
- Verify Keycloak requires S256 in Advanced Settings

## Quick Fix: Create Separate Client for MCP Inspector

If diagnosis is taking too long, create a dedicated client:

### Keycloak Configuration

**Create New Client:**
1. Client ID: `mcp-inspector`
2. Client authentication: **OFF** (public)
3. Standard flow: **ENABLED**
4. Valid redirect URIs:
   - `http://localhost:*`
   - `http://127.0.0.1:*`
   - `http://[::1]:*` (IPv6 localhost)
5. Web origins: `*` (development only)
6. PKCE Code Challenge Method: **S256**

**Configure MCP Inspector:**
- Client ID: `mcp-inspector`
- No client secret
- Authorization endpoint: `http://localhost:8080/realms/mcp_security/protocol/openid-connect/auth`
- Token endpoint: `http://localhost:8080/realms/mcp_security/protocol/openid-connect/token`

### Test Configuration

Try MCP Inspector with new client. If it works, compare configurations to identify the difference.

## Data Collection Template

Please provide the following information:

### MCP Inspector OAuth Error

**Screenshot of error:**
[ATTACH SCREENSHOT]

**Console logs:**
```
[PASTE CONSOLE OUTPUT]
```

**Network tab - Authorization request:**
```
URL: [PASTE FULL URL]
Parameters: [LIST ALL PARAMETERS]
```

**Network tab - Token exchange request:**
```
Request Headers:
[PASTE HEADERS]

Request Body:
[PASTE BODY]

Response Status: [STATUS CODE]

Response Body:
[PASTE ERROR JSON]
```

### Keycloak Configuration

**Client Settings:**
```
Client ID: [VALUE]
Client authentication: [ON/OFF]
Standard flow: [ENABLED/DISABLED]
Valid redirect URIs: [LIST ALL]
PKCE Code Challenge Method: [VALUE]
```

**Keycloak Logs:**
```
[PASTE RELEVANT KEYCLOAK SERVER LOGS IF AVAILABLE]
```

## Next Steps

Once you provide the diagnostic information above, we can:
1. Identify the exact difference between working and failing requests
2. Determine if DCR is needed
3. Fix the Keycloak configuration
4. Update MCP Inspector configuration if needed

The key is understanding **exactly what MCP Inspector is sending** compared to what mcp-client sends.
