# IDP Configuration Requirements - Phase 3 Integration Testing

**Document Version:** 1.0
**Created:** 2025-01-08
**Purpose:** Keycloak configuration requirements for Phase 3 integration and performance testing

---

## Overview

Phase 3 requires a fully configured Keycloak IDP with RFC 8693 token exchange support to validate:
- End-to-end token exchange flows
- Two-stage authorization (MCP access + downstream resource access)
- Encrypted token cache behavior with real JWTs
- Performance benchmarks and load testing
- Security penetration testing

---

## Keycloak Version Requirements

**Minimum Version:** Keycloak 24.0+
**Recommended:** Keycloak 25.0+ (latest stable)
**Protocol Support:** OpenID Connect 1.0, OAuth 2.0, RFC 8693 Token Exchange

---

## Realm Configuration

### Realm: `mcp_security`

**Basic Settings:**
- **Realm Name:** `mcp_security`
- **Display Name:** MCP OAuth Security Testing Realm
- **Enabled:** Yes
- **User Registration:** Disabled (manual user creation only)
- **Email as Username:** No
- **Login with Email:** Yes
- **Duplicate Emails:** Not allowed
- **Verify Email:** No (for testing)
- **Require SSL:** external requests (allow HTTP for localhost)

**Token Settings:**
- **Access Token Lifespan:** 15 minutes (900 seconds)
- **Access Token Lifespan for Implicit Flow:** 15 minutes
- **Client Login Timeout:** 5 minutes
- **Refresh Token Max Reuse:** 0 (one-time use)
- **SSO Session Idle:** 30 minutes
- **SSO Session Max:** 10 hours

**Advanced Settings:**
- **Revoke Refresh Token:** Enabled
- **Refresh Token Max Reuse:** 0
- **Access Token Lifespan:** 900 seconds (15 minutes)

---

## Client Configurations

### Client 1: `mcp-oauth` (MCP Server - Requestor)

**Purpose:** Issues initial JWT for MCP tool access (requestor JWT)

**Basic Settings:**
- **Client ID:** `mcp-oauth`
- **Name:** MCP OAuth Server
- **Enabled:** Yes
- **Client Protocol:** openid-connect
- **Access Type:** confidential
- **Standard Flow Enabled:** Yes
- **Direct Access Grants Enabled:** Yes
- **Service Accounts Enabled:** Yes
- **Authorization Enabled:** No

**Client Secret:**
- Generate and save client secret (e.g., `JUUA5xCJDQZdreWgEFYvfAqjJnGdTXXA`)
- Copy to test configurations

**Valid Redirect URIs:**
- `http://localhost:3000/*`
- `http://localhost:8080/*`
- `http://127.0.0.1:3000/*`

**Web Origins:**
- `http://localhost:3000`
- `http://localhost:8080`
- `+` (allow all valid redirect URIs)

**Roles:**
- Create client roles: `admin`, `user`, `guest`

**Mappers (Protocol Mappers):**

1. **Audience Mapper** - Add `mcp-oauth` to audience
   - **Mapper Type:** Audience
   - **Included Client Audience:** `mcp-oauth`
   - **Add to ID token:** Yes
   - **Add to access token:** Yes

2. **Legacy Username Mapper** - Map to `legacy_sam_account` claim
   - **Mapper Type:** User Attribute
   - **User Attribute:** `legacyUsername`
   - **Token Claim Name:** `legacy_sam_account`
   - **Claim JSON Type:** String
   - **Add to ID token:** No
   - **Add to access token:** Yes
   - **Add to userinfo:** No

3. **Roles Mapper** - Map client roles to `user_roles` claim
   - **Mapper Type:** User Client Role
   - **Client ID:** `mcp-oauth`
   - **Token Claim Name:** `user_roles`
   - **Claim JSON Type:** String
   - **Add to ID token:** No
   - **Add to access token:** Yes
   - **Add to userinfo:** No
   - **Multivalued:** Yes

4. **Permissions Mapper** - Map to `authorized_scopes` claim
   - **Mapper Type:** User Attribute
   - **User Attribute:** `permissions`
   - **Token Claim Name:** `authorized_scopes`
   - **Claim JSON Type:** String
   - **Add to ID token:** No
   - **Add to access token:** Yes
   - **Multivalued:** Yes

---

### Client 2: `mcp-server-client` (Token Exchange - Delegation)

**Purpose:** Used for server-side token exchange (receives delegation tokens / TE-JWT)

**Basic Settings:**
- **Client ID:** `mcp-server-client`
- **Name:** MCP Server Token Exchange Client
- **Enabled:** Yes
- **Client Protocol:** openid-connect
- **Access Type:** confidential
- **Standard Flow Enabled:** No
- **Direct Access Grants Enabled:** No
- **Service Accounts Enabled:** Yes
- **Authorization Enabled:** No

**Client Secret:**
- Generate and save client secret (different from `mcp-oauth`)
- Copy to token exchange configuration

**Token Exchange Permissions:**
- **Enable Token Exchange:** Yes (see Permissions tab)
- **Allowed to exchange tokens from:** `mcp-oauth`
- **Audience:** `mcp-server-client`

**Scope Configuration:**
- **Full Scope Allowed:** No
- **Assigned Roles:** Add specific roles for delegation

**Mappers (Protocol Mappers):**

1. **Audience Mapper** - Add `mcp-server-client` to audience
   - **Mapper Type:** Audience
   - **Included Client Audience:** `mcp-server-client`
   - **Add to access token:** Yes

2. **Legacy Name Mapper** - Map to `legacy_name` claim (for TE-JWT)
   - **Mapper Type:** User Attribute
   - **User Attribute:** `legacyUsername`
   - **Token Claim Name:** `legacy_name`
   - **Claim JSON Type:** String
   - **Add to access token:** Yes

3. **Delegation Roles Mapper** - Map to `roles` claim in TE-JWT
   - **Mapper Type:** User Attribute
   - **User Attribute:** `delegationRoles`
   - **Token Claim Name:** `roles`
   - **Claim JSON Type:** String
   - **Add to access token:** Yes
   - **Multivalued:** Yes

4. **Delegation Permissions Mapper** - Map to `permissions` claim in TE-JWT
   - **Mapper Type:** User Attribute
   - **User Attribute:** `delegationPermissions`
   - **Token Claim Name:** `permissions`
   - **Claim JSON Type:** String
   - **Add to access token:** Yes
   - **Multivalued:** Yes

5. **Authorized Party Mapper** - Add `azp` claim
   - **Mapper Type:** Hardcoded claim
   - **Token Claim Name:** `azp`
   - **Claim value:** `mcp-server-client`
   - **Claim JSON Type:** String
   - **Add to access token:** Yes

**Token Exchange Setup:**

Navigate to: `Clients` → `mcp-server-client` → `Permissions` tab

1. Enable **Permissions**
2. Go to **token-exchange** permission
3. Add policy: Create a **Client Policy**
   - **Name:** `allow-mcp-oauth-exchange`
   - **Clients:** Select `mcp-oauth`
4. Add permission:
   - **Apply Policy:** `allow-mcp-oauth-exchange`
   - **Decision Strategy:** Affirmative

---

### Client 3: `contextflow` (Optional - Multi-Audience Testing)

**Purpose:** Tests multi-audience scenarios (Subject Token with multiple audiences)

**Basic Settings:**
- **Client ID:** `contextflow`
- **Name:** ContextFlow Application
- **Enabled:** Yes
- **Access Type:** confidential

**Audience Configuration:**
- Add both `contextflow` and `mcp-oauth` to audience claims
- Tests scenarios where Subject Token has multiple audiences

---

## Test Users Configuration

Create the following test users with specific attributes for testing different authorization scenarios:

### User 1: `alice` (Privilege Elevation)

**Basic Info:**
- **Username:** `alice`
- **Email:** `alice@test.local`
- **First Name:** Alice
- **Last Name:** Administrator
- **Enabled:** Yes
- **Email Verified:** Yes

**Credentials:**
- **Password:** `Test123!` (temporary: No)

**Attributes:**
- **legacyUsername:** `ALICE_ADMIN`
- **delegationRoles:** `admin,sql-admin`
- **delegationPermissions:** `sql:read,sql:write,sql:execute`
- **permissions:** `mcp:tools:basic`

**Role Mappings:**
- **Client Roles (mcp-oauth):** `user`
- This tests privilege elevation: user role in MCP → admin role in delegation

**Purpose:** Test privilege elevation (MCP: user → SQL: admin)

---

### User 2: `bob` (Privilege Reduction)

**Basic Info:**
- **Username:** `bob`
- **Email:** `bob@test.local`
- **First Name:** Bob
- **Last Name:** User
- **Enabled:** Yes

**Credentials:**
- **Password:** `Test123!`

**Attributes:**
- **legacyUsername:** `BOB_USER`
- **delegationRoles:** `user,read-only`
- **delegationPermissions:** `sql:read`
- **permissions:** `mcp:tools:all`

**Role Mappings:**
- **Client Roles (mcp-oauth):** `admin`
- This tests privilege reduction: admin role in MCP → read-only in delegation

**Purpose:** Test privilege reduction (MCP: admin → SQL: read-only)

---

### User 3: `charlie` (Same Privileges)

**Basic Info:**
- **Username:** `charlie`
- **Email:** `charlie@test.local`
- **First Name:** Charlie
- **Last Name:** Member
- **Enabled:** Yes

**Credentials:**
- **Password:** `Test123!`

**Attributes:**
- **legacyUsername:** `CHARLIE_USER`
- **delegationRoles:** `user`
- **delegationPermissions:** `sql:read,sql:write`
- **permissions:** `mcp:tools:standard`

**Role Mappings:**
- **Client Roles (mcp-oauth):** `user`
- Same privilege level in both MCP and delegation

**Purpose:** Test consistent privileges (MCP: user → SQL: user)

---

### User 4: `dave` (Unmapped Role / Missing Legacy Name)

**Basic Info:**
- **Username:** `dave`
- **Email:** `dave@test.local`
- **First Name:** Dave
- **Last Name:** Guest
- **Enabled:** Yes

**Credentials:**
- **Password:** `Test123!`

**Attributes:**
- **legacyUsername:** (empty - intentionally missing)
- **delegationRoles:** (empty)
- **delegationPermissions:** (empty)
- **permissions:** `mcp:tools:readonly`

**Role Mappings:**
- **Client Roles (mcp-oauth):** `guest`
- Tests error handling when `legacy_name` claim is missing

**Purpose:** Test error handling for missing `legacy_name` claim

---

### User 5: `loadtest` (Performance Testing)

**Basic Info:**
- **Username:** `loadtest`
- **Email:** `loadtest@test.local`
- **Enabled:** Yes

**Credentials:**
- **Password:** `LoadTest123!`

**Attributes:**
- **legacyUsername:** `LOADTEST_USER`
- **delegationRoles:** `user`
- **delegationPermissions:** `sql:read,sql:write`

**Role Mappings:**
- **Client Roles (mcp-oauth):** `user`

**Purpose:** Dedicated user for load testing (1000+ concurrent sessions)

---

## Token Exchange Flow Configuration

### Enable Token Exchange in Keycloak

**Step 1: Enable Preview Features**

Edit `standalone.xml` or use environment variable:
```bash
-Dkeycloak.profile.feature.token_exchange=enabled
```

Or in Docker:
```bash
docker run -e KEYCLOAK_FEATURES=token-exchange ...
```

**Step 2: Configure Token Exchange Permissions**

1. Navigate to: `Clients` → `mcp-server-client` → `Permissions` tab
2. Enable **Permissions Enabled** toggle
3. Click **token-exchange** scope permission
4. Create Client Policy:
   - Name: `allow-mcp-oauth-exchange`
   - Clients: `mcp-oauth`
5. Apply policy to token-exchange permission

**Step 3: Test Token Exchange**

```bash
# Get Subject Token (from mcp-oauth)
SUBJECT_TOKEN=$(curl -X POST \
  http://localhost:8080/realms/mcp_security/protocol/openid-connect/token \
  -d "client_id=mcp-oauth" \
  -d "client_secret=JUUA5xCJDQZdreWgEFYvfAqjJnGdTXXA" \
  -d "username=alice" \
  -d "password=Test123!" \
  -d "grant_type=password" | jq -r '.access_token')

# Exchange for Delegation Token
curl -X POST \
  http://localhost:8080/realms/mcp_security/protocol/openid-connect/token \
  -d "client_id=mcp-server-client" \
  -d "client_secret=<mcp-server-client-secret>" \
  -d "grant_type=urn:ietf:params:oauth:grant-type:token-exchange" \
  -d "subject_token=${SUBJECT_TOKEN}" \
  -d "subject_token_type=urn:ietf:params:oauth:token-type:access_token" \
  -d "audience=mcp-server-client" \
  -d "requested_token_type=urn:ietf:params:oauth:token-type:access_token"
```

Expected response should contain:
- `access_token` (delegation token / TE-JWT)
- `token_type: "Bearer"`
- `expires_in: 900`

---

## Verification Checklist

### Pre-Testing Verification

- [ ] Keycloak 24.0+ installed and running
- [ ] Realm `mcp_security` created
- [ ] Client `mcp-oauth` configured with correct mappers
- [ ] Client `mcp-server-client` configured with token exchange permissions
- [ ] All 5 test users created with correct attributes
- [ ] Token exchange permissions enabled and tested manually
- [ ] JWKS endpoint accessible: `http://localhost:8080/realms/mcp_security/protocol/openid-connect/certs`
- [ ] Token endpoint accessible: `http://localhost:8080/realms/mcp_security/protocol/openid-connect/token`

### Token Exchange Validation

Test each user can perform token exchange:

```bash
# Alice (privilege elevation)
# Requestor JWT should have: user_roles=["user"], legacy_sam_account=null
# TE-JWT should have: roles=["admin","sql-admin"], legacy_name="ALICE_ADMIN"

# Bob (privilege reduction)
# Requestor JWT should have: user_roles=["admin"]
# TE-JWT should have: roles=["user","read-only"], legacy_name="BOB_USER"

# Charlie (same privileges)
# Requestor JWT should have: user_roles=["user"]
# TE-JWT should have: roles=["user"], legacy_name="CHARLIE_USER"

# Dave (missing legacy_name)
# Requestor JWT should have: user_roles=["guest"]
# TE-JWT should have: legacy_name missing (expect error in delegation)
```

### JWT Claims Validation

**Requestor JWT (from mcp-oauth) must contain:**
- `iss: "http://localhost:8080/realms/mcp_security"`
- `aud: ["mcp-oauth"]`
- `azp: "mcp-oauth"` (optional)
- `sub: "<user-id>"`
- `user_roles: [...]`
- `legacy_sam_account: "<value>"` (optional)
- `authorized_scopes: [...]`
- `exp`, `iat`, `nbf`

**TE-JWT (from mcp-server-client) must contain:**
- `iss: "http://localhost:8080/realms/mcp_security"`
- `aud: ["mcp-server-client"]`
- `azp: "mcp-server-client"`
- `sub: "<user-id>"`
- `legacy_name: "<LEGACY_USERNAME>"`
- `roles: [...]`
- `permissions: [...]`
- `exp`, `iat`, `nbf`

---

## Multi-Audience Testing (Advanced)

### Purpose
Test scenarios where Subject Token has multiple audiences

### Configuration

**Client: `contextflow`**
- Add audiences: `["contextflow", "mcp-oauth"]`
- Tests `aud` validation in TokenExchangeService

**Expected Behavior:**
1. User authenticates to `contextflow`
2. Receives JWT with `aud: ["contextflow", "mcp-oauth"]`
3. MCP server validates JWT (accepts if `mcp-oauth` in audience)
4. Token exchange with `mcp-server-client` succeeds
5. TE-JWT has `aud: ["mcp-server-client"]`

---

## Security Testing Configuration

### Rate Limiting
- Configure Keycloak rate limiting for token endpoint
- Test: 100+ requests/minute should trigger rate limiting

### Token Revocation
- Enable refresh token revocation
- Test: Revoked tokens cannot be exchanged

### Expired Token Handling
- Set short token lifetime (60 seconds) for expiry tests
- Test: Expired Subject Token fails exchange with 400 error

---

## Performance Testing Requirements

### Load Generation
- Support 1000 concurrent users
- Use `loadtest` user credentials
- Generate realistic request patterns (bursts + steady state)

### Metrics Collection
- Enable Keycloak metrics endpoint
- Monitor:
  - Token exchange request rate
  - Token exchange latency (p50, p99)
  - Error rate
  - Active sessions

---

## Troubleshooting

### Token Exchange Returns 403 Forbidden
- **Cause:** Token exchange permissions not configured
- **Fix:** Check `mcp-server-client` → Permissions → token-exchange policy

### TE-JWT Missing `legacy_name` Claim
- **Cause:** Mapper not configured on `mcp-server-client`
- **Fix:** Add User Attribute mapper for `legacyUsername` → `legacy_name`

### Subject Token Rejected
- **Cause:** Audience mismatch
- **Fix:** Ensure Subject Token has `mcp-oauth` in `aud` claim

### Token Exchange Returns 400 Bad Request
- **Cause:** Token expired or invalid format
- **Fix:** Check token expiry, ensure Bearer format

---

## Export/Import

### Export Realm Configuration

```bash
docker exec <keycloak-container> \
  /opt/keycloak/bin/kc.sh export \
  --dir /tmp/export \
  --realm mcp_security \
  --users realm_file
```

### Import Realm Configuration

```bash
docker exec <keycloak-container> \
  /opt/keycloak/bin/kc.sh import \
  --dir /tmp/export \
  --override true
```

**Note:** Realm export JSON will be provided in `test-harness/config/keycloak-realm-export.json`

---

## Next Steps

Once Keycloak is configured:

1. ✅ Verify all test users can authenticate
2. ✅ Test token exchange manually with curl
3. ✅ Validate JWT claims structure
4. ✅ Run Phase 3 integration test suite
5. ✅ Execute performance benchmarks
6. ✅ Perform load testing

See **Phase 3 Test Harness** documentation for automated testing procedures.
