# Keycloak SSO Cookie Persistence - Deep Analysis & Fix

## Problem Statement

After logout, Keycloak SSO cookies (`AUTH_SESSION_ID`, `KEYCLOAK_SESSION`, `KEYCLOAK_IDENTITY`) persist in the browser, causing automatic re-authentication when the user attempts to log in again.

## Root Cause Analysis

### Why Cookies Persist After Logout

1. **HttpOnly Cookies** - JavaScript cannot delete these cookies; only Keycloak server can by sending `Set-Cookie` headers with expiration
2. **Cookie Domain** - Cookies belong to Keycloak's domain (`localhost:8080`), not the app's domain
3. **Missing id_token_hint** - If Keycloak doesn't receive a valid `id_token_hint`, it cannot identify which session to terminate
4. **SSO Session Active** - Keycloak may keep the SSO session active even after "logout"

### The Real Issue

Even if cookies persist, they should only matter if Keycloak checks them. The problem occurs when:

```
User logs out → Cookies persist → User clicks Login
  ↓
Browser sends request to Keycloak WITH SSO cookies
  ↓
Keycloak sees valid AUTH_SESSION_ID cookie
  ↓
Keycloak: "Valid session exists!"
  ↓
Keycloak automatically logs user in WITHOUT showing login form ❌
```

## Two-Part Solution

### Part 1: Force Login Prompt (CRITICAL)

**Purpose:** Bypass SSO cookies entirely by forcing Keycloak to show the login form

**Implementation:** Use OIDC `prompt=login` parameter

**Code Changes:**
```javascript
// Login function now includes:
const loginOptions = {
    redirectUri: window.location.href,
    prompt: 'login',  // FORCE login prompt (bypasses SSO cookies)
    maxAge: 0         // Require fresh authentication
};

keycloak.login(loginOptions);
```

**What This Does:**
- `prompt=login` - Forces Keycloak to display login form even if SSO session exists
- `maxAge=0` - Requires fresh authentication (no cached credentials)
- Bypasses ALL SSO cookies
- User MUST enter credentials

**Result:** Even if cookies persist, user must re-authenticate ✅

### Part 2: Enhanced Logout Debugging

**Purpose:** Verify that Keycloak logout is being called correctly with `id_token_hint`

**Implementation:** Added comprehensive logging to logout function

**What Gets Logged:**
```
========== LOGOUT DEBUG ==========
Keycloak State:
  authenticated: true
  token: eyJhbGciOiJSUzI1NiIsInR5cCI...
  idToken: eyJhbGciOiJSUzI1NiIsInR5cCI...  ← CRITICAL
  refreshToken: eyJhbGciOiJIUzI1NiIsInR5cCI...
  sessionId: abc123-def456-ghi789
  subject: user@example.com

Keycloak.js logout URL: http://localhost:8080/realms/mcp_security/protocol/openid-connect/logout?
  id_token_hint=eyJhbGciOiJSUzI1NiIsInR5cCI...  ← VERIFY THIS
  post_logout_redirect_uri=http://localhost:5173/?logged_out=true

✓ id_token_hint is included in logout URL

Expected flow:
  1. Redirect to Keycloak logout endpoint
  2. Keycloak validates id_token_hint
  3. Keycloak terminates session
  4. Keycloak sends Set-Cookie headers to delete cookies
  5. Keycloak redirects back to app
========== END LOGOUT DEBUG ==========
```

## Testing Instructions

### Test 1: Verify id_token_hint in Logout

**Steps:**
1. Login to the application
2. Open browser DevTools → Console
3. Click Logout button
4. Look for `========== LOGOUT DEBUG ==========` in console
5. ✅ **VERIFY:** `idToken: eyJ...` is present (not "MISSING")
6. ✅ **VERIFY:** Console shows `✓ id_token_hint is included in logout URL`
7. ❌ **FAIL:** If console shows `✗ WARNING: id_token_hint is MISSING`

**If id_token_hint is MISSING:**
- Keycloak cannot identify which session to terminate
- Cookies will NOT be deleted
- SSO session will remain active

### Test 2: Inspect Logout Network Traffic

**Steps:**
1. Login to the application
2. Open browser DevTools → Network tab
3. Enable "Preserve log"
4. Click Logout button
5. Find the request to `/protocol/openid-connect/logout`
6. ✅ **VERIFY:** Request includes `id_token_hint` parameter
7. ✅ **VERIFY:** Response includes `Set-Cookie` headers with `Max-Age=0` or `Expires` in past
8. Switch to Application → Cookies
9. ❌ **VERIFY:** `AUTH_SESSION_ID`, `KEYCLOAK_SESSION`, `KEYCLOAK_IDENTITY` should be deleted

**Example Set-Cookie Header (what we want to see):**
```
Set-Cookie: AUTH_SESSION_ID=; Path=/; Max-Age=0; HttpOnly; SameSite=None
Set-Cookie: KEYCLOAK_SESSION=; Path=/; Max-Age=0; HttpOnly; SameSite=None
Set-Cookie: KEYCLOAK_IDENTITY=; Path=/; Max-Age=0; HttpOnly; SameSite=None
```

### Test 3: Verify Login Prompt is Forced

**Steps:**
1. Login to the application
2. Click Logout button
3. Wait for redirect back to app
4. Check browser cookies (Application → Cookies)
5. Note: Cookies may still exist (this is OK now)
6. Click Login button
7. Open browser DevTools → Console
8. ✅ **VERIFY:** Console shows `Note: prompt=login will force fresh authentication`
9. ✅ **VERIFY:** Redirected to Keycloak login page (NOT automatically logged in)
10. ✅ **VERIFY:** Must enter username and password
11. ✅ **VERIFY:** After entering credentials, successfully logged in

**This is the CRITICAL test:** Even if cookies persist, user must re-authenticate.

### Test 4: Check Login URL Parameters

**Steps:**
1. Click Login button
2. Open browser DevTools → Console BEFORE redirect
3. Look for: `Login URL: http://localhost:8080/realms/...`
4. Copy the full URL
5. ✅ **VERIFY:** URL includes `prompt=login`
6. ✅ **VERIFY:** URL includes `max_age=0`

**Example Login URL:**
```
http://localhost:8080/realms/mcp_security/protocol/openid-connect/auth?
  client_id=contextflow&
  redirect_uri=http://localhost:5173/&
  state=abc123&
  response_type=code&
  scope=openid&
  prompt=login&          ← CRITICAL
  max_age=0&            ← CRITICAL
  code_challenge=xyz&
  code_challenge_method=S256
```

## Why This Solution Works

### Before Fix:
```
1. Logout → Keycloak logout endpoint
2. Cookies may or may not be deleted (depends on id_token_hint)
3. User clicks Login
4. Keycloak sees cookies → Auto-login ❌
```

### After Fix:
```
1. Logout → Keycloak logout endpoint
2. Cookies may or may not be deleted
3. User clicks Login WITH prompt=login
4. Keycloak sees prompt=login → FORCE login form ✅
5. User must enter credentials ✅
6. Fresh authentication session created ✅
```

**Key Insight:** We don't rely on cookie deletion anymore. We force re-authentication regardless of cookie state.

## Keycloak Configuration Issues

If logout still doesn't delete cookies even with valid `id_token_hint`, check:

### 1. Keycloak Realm Settings

**Location:** Keycloak Admin Console → Realm Settings → Sessions

**Check:**
- SSO Session Idle: Should timeout after inactivity
- SSO Session Max: Maximum SSO session lifetime
- Client Session Idle: Client session timeout
- Client Session Max: Maximum client session lifetime

**Recommendation:**
- Set reasonable timeouts (e.g., 30 minutes idle, 10 hours max)
- Enable "Revoke Refresh Token" to invalidate old sessions

### 2. Keycloak Client Settings

**Location:** Keycloak Admin Console → Clients → {your-client}

**Check:**
- Access Type: `public` or `confidential`
- Standard Flow Enabled: `ON`
- Valid Redirect URIs: Includes your app URL
- Web Origins: Includes your app origin (for CORS)
- Backchannel Logout Session Required: `ON` (for proper logout)

### 3. Cookie Settings

**Browser Settings to Check:**
- Third-party cookies: Should be allowed for Keycloak domain
- SameSite policy: May affect cross-origin cookies
- Secure flag: Cookies with Secure flag require HTTPS

**Development Workaround:**
If using localhost, cookies should work. If using different hostnames, may need HTTPS.

## Alternative Solutions (if prompt=login doesn't work)

### Option 1: Clear Cookies Manually (Won't work for HttpOnly)

```javascript
// In logout function (AFTER Keycloak logout)
document.cookie.split(";").forEach(cookie => {
    const name = cookie.split("=")[0].trim();
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
});
```

**Limitation:** Cannot delete HttpOnly cookies

### Option 2: Use Keycloak Admin API to Revoke Session

```javascript
// Requires admin credentials - not recommended for client-side
const response = await fetch(
    `${keycloakConfig.url}/admin/realms/${keycloakConfig.realm}/users/${userId}/logout`,
    {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${adminToken}`,
            'Content-Type': 'application/json'
        }
    }
);
```

**Limitation:** Requires admin privileges

### Option 3: Use kc_action Parameter

```javascript
// Force Keycloak to show login form via kc_action
keycloak.login({
    redirectUri: window.location.href,
    action: 'login'  // Alternative to prompt=login
});
```

### Option 4: Use Different Keycloak Endpoint

```javascript
// Use Keycloak's logout endpoint with different parameters
const logoutUrl = `${keycloakConfig.url}/realms/${keycloakConfig.realm}/protocol/openid-connect/logout`;
const params = new URLSearchParams({
    post_logout_redirect_uri: redirectUri,
    client_id: keycloakConfig.clientId,
    id_token_hint: keycloak.idToken,
    logout_hint: keycloak.subject  // Additional hint
});
window.location.href = `${logoutUrl}?${params.toString()}`;
```

## Expected Behavior After Fix

### Logout Flow:
1. User clicks Logout
2. Console shows detailed debug information
3. Redirected to Keycloak logout endpoint
4. Keycloak processes logout (may or may not delete cookies)
5. Redirected back to app with `?logged_out=true`
6. App clears local storage and state
7. Login button is visible

### Login Flow (CRITICAL):
1. User clicks Login
2. Console shows `⚠ Forcing login prompt (bypassing SSO cookies)`
3. Redirected to Keycloak
4. **Keycloak SHOWS LOGIN FORM** (even if cookies exist)
5. User enters username and password
6. Redirected back to app with fresh tokens
7. Successfully logged in

## Success Criteria

✅ **After logout, clicking Login shows Keycloak login form**
✅ **User must enter credentials to log back in**
✅ **No automatic re-authentication**
✅ **Fresh session created on each login**

## Debugging Checklist

If issue persists, check:

- [ ] Console shows `✓ id_token_hint is included in logout URL`
- [ ] Console shows `prompt=login will force fresh authentication`
- [ ] Network tab shows `/logout` request with `id_token_hint` parameter
- [ ] Login URL includes `prompt=login` and `max_age=0` parameters
- [ ] Keycloak shows login form (not auto-login)
- [ ] User must enter credentials
- [ ] Keycloak realm session settings are reasonable
- [ ] Client backchannel logout is enabled

## Conclusion

The `prompt=login` parameter is the **most reliable solution** because:
1. Works regardless of cookie state
2. No server-side configuration changes needed
3. Standard OIDC parameter (not Keycloak-specific)
4. Forces fresh authentication every time
5. Bypasses ALL SSO mechanisms

Even if Keycloak cookies persist forever, `prompt=login` ensures users must re-authenticate. This is the security-first approach.
