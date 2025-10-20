# Keycloak legacy_name Claim Setup

**Purpose:** Configure Keycloak to include the `legacy_name` claim in the requestor JWT for Kerberos delegation.

## Why This is Needed

Kerberos delegation requires the Windows username (e.g., "ALICE") to:
1. Build the Kerberos user principal: `ALICE@w25ad.net`
2. Perform S4U2Self (obtain ticket on behalf of user)
3. Perform S4U2Proxy (delegate to file servers)

## Keycloak Configuration Steps

### Step 1: Open Keycloak Admin Console

Navigate to: `http://localhost:8080/admin` (or your Keycloak URL)

### Step 2: Navigate to Your Client

1. **Realm:** Select your realm (e.g., `mcp_security`)
2. **Clients:** Click "Clients" in left menu
3. **Find client:** `mcp-oauth` (or your client ID)
4. **Click:** The client name to edit

### Step 3: Add Client Mapper

1. **Tab:** Click "Client scopes" tab
2. **Dedicated scope:** Click `mcp-oauth-dedicated` (or "Add dedicated scope" if missing)
3. **Add mapper:** Click "Configure a new mapper"
4. **Mapper type:** Select "User Property"

### Step 4: Configure Mapper

Fill in the following:

| Field | Value | Notes |
|-------|-------|-------|
| **Name** | `legacy_username` | Internal name |
| **Mapper Type** | User Property | Maps from user property |
| **Property** | `username` | Keycloak username field |
| **Token Claim Name** | `legacy_name` | **MUST BE EXACTLY THIS** |
| **Claim JSON Type** | String | |
| **Add to ID token** | ✅ ON | |
| **Add to access token** | ✅ ON | **REQUIRED!** |
| **Add to userinfo** | ✅ ON | Optional |
| **Multivalued** | ❌ OFF | |

**CRITICAL:** The "Token Claim Name" MUST be `legacy_name` (not `legacy_username`, not `legacyUsername`)

### Step 5: Save

Click "Save" at the bottom.

## Alternative: Map from User Attribute (If using AD sync)

If your Keycloak users are synced from Active Directory, you can map the AD `sAMAccountName` directly:

1. **Mapper Type:** User Attribute
2. **User Attribute:** `sAMAccountName` (AD attribute)
3. **Token Claim Name:** `legacy_name`
4. **Everything else:** Same as above

## Alternative: Hardcoded for Testing

For quick testing without AD sync:

1. **Mapper Type:** Hardcoded claim
2. **Token Claim Name:** `legacy_name`
3. **Claim value:** `TESTUSER` (any Windows username)
4. **Add to access token:** ✅ ON

## Step 6: Get New Token

**IMPORTANT:** You must get a new JWT token after adding the mapper. Old tokens won't have the claim.

### Using Password Grant (Testing)

```bash
curl -X POST http://localhost:8080/realms/mcp_security/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password" \
  -d "client_id=mcp-oauth" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "username=alice" \
  -d "password=password" \
  -d "scope=openid profile"
```

Save the `access_token` from the response.

### Using Authorization Code Flow (Production)

Follow your normal OAuth flow - the new token will include the `legacy_name` claim.

## Step 7: Verify the Claim

### Option A: Decode at jwt.io

1. Go to https://jwt.io
2. Paste your access token
3. Look in the payload:

```json
{
  "sub": "428e17e9-21f6-48c1-ac94-78f472ec6704",
  "preferred_username": "alice",
  "legacy_name": "ALICE",  // ← THIS MUST BE PRESENT!
  "roles": ["user"],
  "aud": ["mcp-oauth"],
  "iss": "http://localhost:8080/realms/mcp_security"
}
```

### Option B: Test with MCP user-info Tool

```bash
curl -X POST http://localhost:3010/mcp \
  -H "Authorization: Bearer YOUR_NEW_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "user-info",
      "arguments": {}
    },
    "id": 1
  }'
```

**Expected response:**
```json
{
  "result": {
    "content": [{
      "type": "text",
      "text": {
        "userId": "428e17e9-21f6-48c1-ac94-78f472ec6704",
        "legacyUsername": "ALICE",  // ← THIS CONFIRMS IT WORKED!
        "roles": ["user"],
        "authenticated": true
      }
    }]
  }
}
```

## Step 8: Test Kerberos Tools

Now that you have `legacy_name` in your JWT, the Kerberos tools should work (assuming AD is configured):

```bash
# List directory
curl -X POST http://localhost:3010/mcp \
  -H "Authorization: Bearer YOUR_NEW_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "kerberos-list-directory",
      "arguments": {
        "path": "//192.168.1.25/shared"
      }
    },
    "id": 1
  }'
```

**Expected (without AD configured):**
```json
{
  "result": {
    "status": "failure",
    "code": "MODULE_NOT_FOUND",
    "message": "Kerberos delegation module not available..."
  }
}
```

**Expected (with AD configured):**
- Should list files in the share

## Troubleshooting

### Issue: "legacyUsername": null in user-info response

**Cause:** The `legacy_name` claim is not in the JWT

**Solutions:**
1. Check mapper is saved and enabled
2. Check "Add to access token" is ✅ ON
3. Get a **new** token (old tokens don't have the claim)
4. Verify the token at jwt.io to see what claims it actually contains

### Issue: Claim name is wrong

**Symptom:** JWT has `legacy_username` but MCP shows `legacyUsername: null`

**Cause:** Token Claim Name must be exactly `legacy_name` (with underscore)

**Fix:** Edit the mapper and change "Token Claim Name" to `legacy_name`

### Issue: Multiple users need different Windows usernames

**Solution:** Use User Attribute mapper instead of User Property:

1. In Keycloak, go to: Users → Select user → Attributes tab
2. Add attribute: `sAMAccountName` = `ALICE`
3. Use "User Attribute" mapper type pointing to `sAMAccountName`

This way each user can have their own Windows username.

## Summary

**What you're doing:** Adding a `legacy_name` claim to the JWT that contains the Windows username

**Why:** Kerberos delegation needs the Windows username to build the Kerberos principal

**Key points:**
- Claim name MUST be `legacy_name` (with underscore)
- Must be in ACCESS token (not just ID token)
- Must get NEW token after adding mapper
- Verify with user-info tool before testing Kerberos tools

Once this is configured, your Kerberos tools will work (assuming Active Directory is also configured).
