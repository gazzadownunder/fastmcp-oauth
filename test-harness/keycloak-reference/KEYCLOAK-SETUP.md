# Keycloak Configuration for OAuth OBO Testing

This document describes the Keycloak configuration required for the OAuth Token Exchange (On-Behalf-Of (OBO)) delegation flow, based on `Docs/oauth2 details.docx`.

## Overview

The OAuth delegation flow requires two clients in Keycloak:

1. **Client 1 (`contextflow`)** - User authentication client (issues Subject Tokens)
2. **Client 2 (`mcp-oauth`)** - Service client (performs token exchange, issues Delegated Tokens)

## Prerequisites

- Keycloak 20+ running at `localhost:8080`
- Admin access to Keycloak Admin Console
- Understanding of OAuth 2.0 and OpenID Connect

## Realm Configuration

### 1. Create Realm

1. Navigate to Keycloak Admin Console: `http://localhost:8080/admin`
2. Create a new realm (e.g., `mcp_security`)
3. Configure realm settings:
   - **Display name**: MCP OAuth Realm
   - **Enabled**: Yes
   - **User registration**: Disabled (for security)

### 2. Realm Settings

**Tokens Tab**:
- Access Token Lifespan: 5-60 minutes (recommended: 15 minutes)
- Access Token Lifespan For Implicit Flow: 15 minutes
- Client Login Timeout: 5 minutes

**Security Defenses Tab**:
- Headers → X-Frame-Options: DENY
- Headers → Content-Security-Policy: frame-ancestors 'none';
- Brute Force Detection: Enabled

## Client 1: contextflow (User Authentication)

### Basic Settings

1. **Client ID**: `contextflow`
2. **Name**: ContextFlow Client
3. **Description**: User authentication client for OAuth delegation flow
4. **Enabled**: Yes

### Capability Config

- **Client authentication**: Optional (or On for confidential)
- **Authorization**: Off
- **Standard flow**: Enabled (Authorization Code)
- **Direct access grants**: Enabled (for testing only - disable in production)
- **Implicit flow**: Disabled
- **Service accounts roles**: Disabled

### Access Settings

- **Root URL**: `http://localhost:3000`
- **Home URL**: `http://localhost:3000`
- **Valid redirect URIs**:
  - `http://localhost:3000/*`
  - `http://localhost:3000/callback`
- **Valid post logout redirect URIs**: `http://localhost:3000`
- **Web origins**: `http://localhost:3000`

### Client Scopes

**Assigned Default Client Scopes**:
- `profile`
- `email`
- `roles`
- `web-origins`
- `acr`

**Assigned Optional Client Scopes**:
- `address`
- `phone`
- `offline_access`
- `microprofile-jwt`

### Important: Audience Configuration

To enable token exchange, the Subject Token from `contextflow` must include `mcp-oauth` in the audience claim.

**Option 1: Using Audience Mapper**

1. Go to Client → Client scopes → Add mapper → By configuration
2. **Mapper type**: Audience
3. **Name**: mcp-oauth-audience
4. **Included Client Audience**: `mcp-oauth`
5. **Add to access token**: Yes
6. **Add to ID token**: No

**Option 2: Using Hardcoded Claim**

1. Go to Client → Client scopes → Add mapper → By configuration
2. **Mapper type**: Hardcoded claim
3. **Name**: audience-claim
4. **Token Claim Name**: aud
5. **Claim value**: `["contextflow", "mcp-oauth"]`
6. **Claim JSON Type**: JSON
7. **Add to access token**: Yes

## Client 2: mcp-oauth (Token Exchange)

### Basic Settings

1. **Client ID**: `mcp-oauth`
2. **Name**: MCP OAuth Service
3. **Description**: Service client for OAuth token exchange (RFC 8693)
4. **Enabled**: Yes

### Capability Config (CRITICAL)

- **Client authentication**: **ON** (required for confidential client)
- **Authorization**: Off
- **Standard flow**: Disabled
- **Direct access grants**: Disabled
- **Implicit flow**: Disabled
- **Service accounts roles**: **Enabled** (required)
- **OAuth 2.0 Device Authorization Grant**: Disabled
- **OIDC CIBA Grant**: Disabled

### Authentication Flow Overrides

- **Direct grant flow**: direct grant (or "None" if disabled)

### Access Settings

- **Root URL**: `http://localhost:3000`
- **Home URL**: `http://localhost:3000`
- **Valid redirect URIs**: `/*` (not used, but required)
- **Web origins**: `http://localhost:3000`

### Advanced Settings (CRITICAL FOR TOKEN EXCHANGE)

**Fine Grain OpenID Connect Configuration**:
- **Access Token Lifespan**: 1800 (30 minutes)

**OAuth 2.0 Mutual TLS Certificate Bound Access Tokens Enabled**: No (unless using mTLS)

**Token Exchange Permission** (This is the key setting):

Navigate to **Permissions** tab:
1. **Permissions Enabled**: Yes
2. Create policy for token exchange:
   - **Policy Name**: token-exchange-policy
   - **Policy Type**: Client
   - **Clients**: Select `contextflow`
   - **Logic**: Positive

3. Create permission:
   - **Permission Name**: token-exchange-permission
   - **Resource Type**: Token Exchange
   - **Apply Policy**: token-exchange-policy
   - **Decision Strategy**: Unanimous

**Alternative** (if Permissions tab not available in your Keycloak version):

Some Keycloak versions enable token exchange by default. Verify by testing the exchange flow.

### Credentials

1. Go to **Credentials** tab
2. **Client Authenticator**: Client Id and Secret
3. Generate secret (or set a known secret)
4. Copy the **Client Secret** - you'll need this for `test.env`

### Client Scopes

**Assigned Default Client Scopes**:
- `profile`
- `email`
- `roles`
- `web-origins`
- `acr`

**Important Mappers**:

The `mcp-oauth` client needs access to all claims from the Subject Token, including `legacy_sam_account`.

## User Configuration

### 1. Create Test Users

Create at least two test users:

**User 1: testuser**
- Username: `testuser`
- Email: `testuser@company.com`
- First Name: Test
- Last Name: User
- Email Verified: Yes
- Enabled: Yes

**User 2: adminuser**
- Username: `adminuser`
- Email: `admin@company.com`
- First Name: Admin
- Last Name: User
- Email Verified: Yes
- Enabled: Yes

### 2. Set Passwords

For each user:
1. Go to Credentials tab
2. Set password (e.g., `test123` for testuser, `admin123` for adminuser)
3. **Temporary**: No (disable password reset requirement)

### 3. Configure Custom Attribute: legacy_sam_account

This is the CRITICAL attribute that maps to the SQL Server user for EXECUTE AS.

For each user:
1. Go to **Attributes** tab
2. Add attribute:
   - **Key**: `legacy_sam_account`
   - **Value**: `TESTDOMAIN\testuser` (or `TESTDOMAIN\adminuser`)
3. Click **Save**

### 4. Assign Roles

**For testuser**:
- Realm roles: `user`, `sql_access`

**For adminuser**:
- Realm roles: `admin`, `user`, `sql_access`

## Client Scopes and Mappers

### Create Custom Client Scope for legacy_sam_account

1. Navigate to **Client scopes** → **Create client scope**
2. **Name**: `legacy-account-mapping`
3. **Type**: Optional
4. **Protocol**: openid-connect
5. **Display on consent screen**: No
6. **Include in token scope**: Yes

### Add Mapper for legacy_sam_account

1. Go to the new scope → **Mappers** → **Add mapper** → **By configuration**
2. **Mapper type**: User Attribute
3. **Name**: legacy_sam_account-mapper
4. **User Attribute**: legacy_sam_account
5. **Token Claim Name**: legacy_sam_account
6. **Claim JSON Type**: String
7. **Add to ID token**: Yes
8. **Add to access token**: Yes
9. **Add to userinfo**: Yes
10. **Multivalued**: No
11. **Aggregate attribute values**: No

### Assign Scope to Clients

1. Go to **Client** (`contextflow`) → **Client scopes** tab
2. **Add client scope** → Select `legacy-account-mapping`
3. **Assigned type**: Default

4. Repeat for `mcp-oauth` client

### Map Realm Roles

Both clients need realm roles mapped:

1. Go to Client → Client scopes → `roles` (built-in)
2. Add mapper:
   - **Mapper type**: User Realm Role
   - **Name**: realm-roles-mapper
   - **Token Claim Name**: realm_access.roles
   - **Claim JSON Type**: String (array)
   - **Add to ID token**: Yes
   - **Add to access token**: Yes
   - **Multivalued**: Yes

## Verification

### Verify Configuration

Run the verification script:
```bash
cd test-harness
./scripts/verify-keycloak.sh
```

### Manual Verification

**1. Check JWKS Endpoint**:
```bash
curl http://localhost:8080/realms/mcp_security/protocol/openid-connect/certs | jq .
```

**2. Get Subject Token**:
```bash
curl -X POST http://localhost:8080/realms/mcp_security/protocol/openid-connect/token \
  -d "grant_type=password" \
  -d "client_id=contextflow" \
  -d "username=testuser" \
  -d "password=test123" \
  | jq .access_token | cut -d'"' -f2
```

**3. Decode Token and Check Claims**:
```bash
echo "<token>" | cut -d'.' -f2 | base64 -d | jq .
```

Expected claims:
```json
{
  "iss": "http://localhost:8080/realms/cp_security",
  "sub": "<user-uuid>",
  "aud": ["contextflow", "mcp-oauth"],
  "azp": "contextflow",
  "legacy_sam_account": "TESTDOMAIN\\testuser",
  "realm_access": {
    "roles": ["user", "sql_access"]
  },
  "preferred_username": "testuser",
  ...
}
```

**4. Test Token Exchange**:
```bash
SUBJECT_TOKEN="<token-from-step-2>"
curl -X POST http://localhost:8080/realms/cp_security/protocol/openid-connect/token \
  -u "mcp-oauth:<client-secret>" \
  -d "grant_type=urn:ietf:params:oauth:grant-type:token-exchange" \
  -d "subject_token=${SUBJECT_TOKEN}" \
  -d "subject_token_type=urn:ietf:params:oauth:token-type:access_token" \
  -d "audience=mcp-oauth" \
  | jq .access_token | cut -d'"' -f2
```

**5. Decode Exchanged Token**:
```bash
echo "<exchanged-token>" | cut -d'.' -f2 | base64 -d | jq .
```

Expected claims:
```json
{
  "iss": "http://localhost:8080/realms/cp_security",
  "sub": "<user-uuid>",
  "aud": ["mcp-oauth"],
  "azp": "mcp-oauth",  // ← Key difference!
  "legacy_sam_account": "TESTDOMAIN\\testuser",
  ...
}
```

## Common Issues

### Token Exchange Fails with "not allowed"

**Solution**:
- Verify `mcp-oauth` client has **Client authentication** enabled
- Check **Service accounts roles** is enabled
- Verify token exchange permission/policy is configured

### Missing legacy_sam_account Claim

**Solution**:
- Verify user has the `legacy_name` attribute set
- Check client scope includes the `legacy-account-mapping` scope
- Verify mapper is configured correctly
- Check mapper is set to **Add to access token**

### Audience Does Not Include mcp-oauth

**Solution**:
- Add audience mapper to `contextflow` client
- Or use hardcoded claim mapper with JSON array value
- Verify mapper is active

### azp Claim Incorrect After Exchange

**Solution**:
- This indicates token exchange is not working correctly
- Verify `mcp-oauth` client configuration
- Check Keycloak logs for errors
- Ensure grant type is exactly: `urn:ietf:params:oauth:grant-type:token-exchange`

## Security Considerations

1. **Client Secrets**: Store securely, never commit to git
2. **Direct Grant Flow**: Disable in production (for testing only)
3. **Token Lifetimes**: Keep short (5-15 minutes)
4. **HTTPS**: Use HTTPS in production for all Keycloak endpoints
5. **Brute Force Protection**: Enable in production
6. **User Registration**: Disable or carefully control

## References

- Keycloak Token Exchange: https://www.keycloak.org/docs/latest/securing_apps/#_token-exchange
- RFC 8693: OAuth 2.0 Token Exchange
- OpenID Connect Core: https://openid.net/specs/openid-connect-core-1_0.html