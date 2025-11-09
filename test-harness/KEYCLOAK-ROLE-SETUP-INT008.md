# Keycloak Configuration for INT-008 Tests

## Problem
INT-008 tests are failing because the PostgreSQL module is not receiving SQL command-level roles (`sql-read`, `sql-write`, `sql-admin`) from the TE-JWT returned by Keycloak during token exchange.

## Required Keycloak Configuration

### Step 1: Create Client Roles for `mcp-server-client`

1. Navigate to **Clients → mcp-server-client → Roles**
2. Create the following roles:
   - `sql-read`
   - `sql-write`
   - `sql-admin`
   - `admin`

### Step 2: Assign Roles to Users

**Alice (sql-read role):**
1. Navigate to **Users → alice → Role Mapping**
2. Select **mcp-server-client** from "Client Roles" dropdown
3. Assign role: `sql-read`

**Bob (sql-write role):**
1. Navigate to **Users → bob → Role Mapping**
2. Select **mcp-server-client** from "Client Roles" dropdown
3. Assign role: `sql-write`

**Charlie (sql-admin role):**
1. Navigate to **Users → charlie → Role Mapping**
2. Select **mcp-server-client** from "Client Roles" dropdown
3. Assign role: `sql-admin`

### Step 3: Configure Token Mapper for Client Roles

**CRITICAL:** Ensure `mcp-server-client` includes client roles in the access token.

1. Navigate to **Clients → mcp-server-client → Client scopes → mcp-server-client-dedicated**
2. Click **Add mapper → By configuration**
3. Select **User Client Role**
4. Configure mapper:
   - **Name**: `client-roles`
   - **Client ID**: `mcp-server-client`
   - **Token Claim Name**: `roles`
   - **Claim JSON Type**: String (or JSON Array)
   - **Add to ID token**: No
   - **Add to access token**: Yes
   - **Add to userinfo**: No
   - **Multivalued**: Yes

### Step 4: Verify Token Exchange Response

After configuration, token exchange should return TE-JWT with:

```json
{
  "sub": "alice-uuid",
  "legacy_name": "alice",
  "roles": ["sql-read"],
  "aud": "mcp-server-client",
  "iss": "http://192.168.1.137:8080/realms/mcp_security",
  ...
}
```

**Test with curl:**

```bash
# Get requestor token for alice
REQUESTOR_TOKEN="<alice-jwt>"

# Perform token exchange
curl -X POST "http://192.168.1.137:8080/realms/mcp_security/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=urn:ietf:params:oauth:grant-type:token-exchange" \
  -d "client_id=mcp-server-client" \
  -d "client_secret=sVJvwv0AllnSw64MUggSk9NS2ifteLQK" \
  -d "subject_token=$REQUESTOR_TOKEN" \
  -d "subject_token_type=urn:ietf:params:oauth:token-type:access_token" \
  -d "audience=mcp-server-client" \
  | jq -r .access_token | cut -d. -f2 | base64 -d | jq .roles
```

**Expected output:**
```json
["sql-read"]
```

## Role Authorization Matrix

| Role | SELECT | INSERT | UPDATE | DELETE | CREATE | DROP |
|------|--------|--------|--------|--------|--------|------|
| sql-read | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| sql-write | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| sql-admin | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| admin | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

## Validation

After configuring Keycloak, restart the MCP server and run:

```bash
npm test -- phase3-integration --grep "INT-008"
```

**Expected results:**
- ✅ sql-read role allows SELECT
- ✅ sql-read role blocks INSERT, UPDATE, DELETE
- ✅ sql-write role allows INSERT, UPDATE, DELETE
- ✅ sql-write role blocks CREATE
- ✅ sql-admin role allows CREATE
- ✅ sql-admin role blocks DROP

## Troubleshooting

### Roles not appearing in TE-JWT

1. Check mapper configuration (Step 3)
2. Verify client roles are assigned to users (Step 2)
3. Check token endpoint response includes roles claim
4. Verify `rolesClaim: "roles"` in config matches token claim name

### Tests still failing

1. Check server logs for token exchange output:
   ```
   [PostgreSQLModule] Token exchange successful: {
     legacyUsername: 'alice',
     roles: [ 'sql-read' ],  // <-- Should see this
     ...
   }
   ```

2. If roles array is empty, Keycloak mapper is not configured correctly

3. If roles contain wrong values (e.g., `alice_table` instead of `sql-read`), user has wrong role assignments
