# Keycloak S4U2Self Integration with MCP-OAuth Token Exchange

**Date:** 2025-01-08
**Context:** How Phase 1 Token Exchange delegates S4U2Self to Keycloak

---

## Executive Summary

The MCP-OAuth framework's **Phase 1 Token Exchange** implementation delegates the complexity of Windows Kerberos S4U2Self/S4U2Proxy to the **Identity Provider (Keycloak)**. The MCP server performs OAuth 2.0 Token Exchange (RFC 8693), and Keycloak performs the Kerberos delegation internally, returning a JWT with the required `legacy_name` claim.

**Key Benefit:** MCP server has **zero Kerberos dependencies** - all S4U operations happen inside Keycloak.

### CRITICAL CLARIFICATION: Two SEPARATE Delegation Modules

**IMPORTANT:** The MCP-OAuth framework supports **two independent delegation modules** that work side-by-side:

1. **SQL Delegation Module** (Already Implemented - `@fastmcp-oauth/sql-delegation`)
   - **Purpose:** Access SQL Server/PostgreSQL databases on behalf of users
   - **Method:** T-SQL `EXECUTE AS USER` command
   - **Authentication:** MCP server connects with **service account credentials**
   - **Kerberos Required:** ❌ NO - Uses T-SQL impersonation only
   - **Resources:** SQL Server, PostgreSQL
   - **Status:** ✅ Fully implemented in `packages/sql-delegation/`
   - **Token Exchange Role:** Gets `legacy_name` claim from Keycloak (via LDAP)

2. **Kerberos Delegation Module** (Trying to Implement - `@fastmcp-oauth/kerberos-delegation`)
   - **Purpose:** Access SMB file shares, NFS, Kerberos-protected apps on behalf of users
   - **Method:** Kerberos S4U2Self/S4U2Proxy protocol
   - **Authentication:** MCP server obtains **user's Kerberos ticket** via delegation
   - **Kerberos Required:** ✅ YES - This IS the Kerberos use case we're implementing
   - **Resources:** SMB/CIFS file shares, NFS, legacy Kerberos apps, SharePoint
   - **Status:** ⚠️ Partially implemented in `packages/kerberos-delegation/`, needs S4U support
   - **Token Exchange Role:** Could get Kerberos ticket from Keycloak (if Kerberos federation enabled)

**Key Point:** These are NOT "current vs future" implementations of the same thing. They are **separate modules for different resource types**. A single MCP server can have BOTH modules registered simultaneously:
- `sql-delegate` tool → uses SQL delegation module (NO Kerberos)
- `kerberos-file-read` tool → uses Kerberos delegation module (WITH S4U2Self/S4U2Proxy)

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                  Complete Token Exchange Flow                    │
│          (Keycloak Performs S4U2Self Internally)                 │
└──────────────────────────────────────────────────────────────────┘

┌─────────────┐                 ┌──────────────┐                 ┌─────────────┐
│   Client    │                 │  MCP Server  │                 │  Keycloak   │
│ (Browser)   │                 │  (Node.js)   │                 │  (IDP + AD) │
└──────┬──────┘                 └──────┬───────┘                 └──────┬──────┘
       │                               │                                │
       │ 1. Login (OAuth Code Flow)    │                                │
       │──────────────────────────────────────────────────────────────>│
       │                               │                                │
       │                               │     Keycloak authenticates     │
       │                               │     user against AD/LDAP       │
       │                               │                                │
       │ 2. Subject Token (ST-JWT)     │                                │
       │<──────────────────────────────────────────────────────────────│
       │   Claims: {                   │                                │
       │     iss: keycloak,            │                                │
       │     sub: alice,               │                                │
       │     aud: [contextflow, mcp-oauth],                            │
       │     preferred_username: alice@w25ad.net,                       │
       │     roles: [user]             │                                │
       │   }                           │                                │
       │                               │                                │
       │ 3. MCP Request with ST-JWT    │                                │
       │──────────────────────────────>│                                │
       │   Authorization: Bearer ST    │                                │
       │   {                           │                                │
       │     method: "tools/call",     │                                │
       │     params: {                 │                                │
       │       name: "sql-delegate",   │                                │
       │       arguments: {            │                                │
       │         action: "query",      │                                │
       │         sql: "SELECT ..."     │                                │
       │       }                       │                                │
       │     }                         │                                │
       │   }                           │                                │
       │                               │                                │
       │                               │ 4. Token Exchange Request      │
       │                               │   (RFC 8693)                   │
       │                               │───────────────────────────────>│
       │                               │   POST /token                  │
       │                               │   grant_type=                  │
       │                               │     token-exchange             │
       │                               │   subject_token=ST-JWT         │
       │                               │   audience=mcp-oauth           │
       │                               │   client_id=mcp-oauth          │
       │                               │   client_secret=SECRET         │
       │                               │                                │
       │                               │         ┌──────────────────────┤
       │                               │         │ Keycloak Internal:   │
       │                               │         │                      │
       │                               │         │ 5. Extract user from ST
       │                               │         │    user=alice@w25ad.net
       │                               │         │                      │
       │                               │         │ 6. Query AD for user │
       │                               │         │    LDAP search:      │
       │                               │         │    (userPrincipalName=
       │                               │         │      alice@w25ad.net)│
       │                               │         │                      │
       │                               │         │ 7. Retrieve AD attrs:│
       │                               │         │    sAMAccountName=   │
       │                               │         │      ALICE_ADMIN     │
       │                               │         │    memberOf=CN=...   │
       │                               │         │                      │
       │                               │         │ 8. [OPTIONAL]        │
       │                               │         │    Perform S4U2Self: │
       │                               │         │    - Keycloak service│
       │                               │         │      account requests│
       │                               │         │      TGT for alice   │
       │                               │         │    - S4U2Self obtains│
       │                               │         │      delegated creds │
       │                               │         │                      │
       │                               │         │ 9. Mint TE-JWT with: │
       │                               │         │    legacy_name=      │
       │                               │         │      ALICE_ADMIN     │
       │                               │         │    roles=[sql_writer]│
       │                               │         │    permissions=      │
       │                               │         │      [sql:write]     │
       │                               │         └──────────────────────┤
       │                               │                                │
       │                               │ 10. Delegation Token (TE-JWT)  │
       │                               │<───────────────────────────────│
       │                               │   {                            │
       │                               │     iss: keycloak,             │
       │                               │     sub: alice,                │
       │                               │     aud: mcp-oauth,            │
       │                               │     azp: mcp-oauth,            │
       │                               │     legacy_name: ALICE_ADMIN,  │
       │                               │     roles: [sql_writer],       │
       │                               │     permissions: [sql:write],  │
       │                               │     act: {                     │
       │                               │       sub: alice,              │
       │                               │       iss: keycloak            │
       │                               │     }                          │
       │                               │   }                            │
       │                               │                                │
       │                               │ 11. Decode TE-JWT              │
       │                               │     Extract:                   │
       │                               │     - legacy_name=ALICE_ADMIN  │
       │                               │     - roles=[sql_writer]       │
       │                               │     - permissions=[sql:write]  │
       │                               │                                │
       │                               │ 12. SQL Delegation             │
       │                               │     EXECUTE AS USER            │
       │                               │       'ALICE_ADMIN'            │
       │                               │     SELECT ...                 │
       │                               │     REVERT                     │
       │                               │                                │
       │ 13. Response                  │                                │
       │<──────────────────────────────│                                │
       │   {                           │                                │
       │     status: "success",        │                                │
       │     data: [...]               │                                │
       │   }                           │                                │
       │                               │                                │
```

---

## How SQL Delegation Actually Works (NO KERBEROS)

### The Confusion Explained

**Question:** "How does the MCP server use the KDC TGT ticket to access domain resources?"

**Answer:** It doesn't! The MCP server does NOT obtain or use Kerberos tickets for SQL Server delegation.

### Actual SQL Delegation Flow

```
┌──────────────────────────────────────────────────────────────────┐
│       SQL Server Delegation (Current Implementation)             │
│                    NO KERBEROS TICKETS USED                      │
└──────────────────────────────────────────────────────────────────┘

┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│  MCP Server │         │  SQL Server  │         │ Keycloak +  │
│  (Node.js)  │         │  (MSSQL/PG)  │         │     AD      │
└──────┬──────┘         └──────┬───────┘         └──────┬──────┘
       │                       │                        │
       │ 1. Receive TE-JWT     │                        │
       │    with legacy_name:  │                        │
       │    "ALICE_ADMIN"      │                        │
       │<──────────────────────────────────────────────>│
       │                       │                        │
       │ 2. Open SQL Connection                         │
       │    using SERVICE ACCOUNT                       │
       │──────────────────────>│                        │
       │    Connection:        │                        │
       │    - User: svc-mcp-server (service account)   │
       │    - Auth: Windows Authentication              │
       │    - OR SQL Authentication                     │
       │    - NO USER CREDENTIALS!                      │
       │                       │                        │
       │ 3. Execute T-SQL      │                        │
       │──────────────────────>│                        │
       │                       │                        │
       │  BEGIN TRANSACTION    │                        │
       │                       │                        │
       │  -- Switch security context to alice          │
       │  EXECUTE AS USER 'ALICE_ADMIN';               │
       │                       │                        │
       │                       │ SQL Server:            │
       │                       │ - Verifies user exists │
       │                       │   in database          │
       │                       │ - Checks Windows SID   │
       │                       │   (queries AD)         │
       │                       │ - Switches execution   │
       │                       │   context              │
       │                       │ - NO KERBEROS!         │
       │                       │                        │
       │  -- Now executing as ALICE_ADMIN              │
       │  SELECT * FROM SensitiveTable;                │
       │                       │                        │
       │                       │ SQL Server:            │
       │                       │ - Checks permissions   │
       │                       │   for ALICE_ADMIN      │
       │                       │ - NOT svc-mcp-server!  │
       │                       │                        │
       │  -- Restore original context                  │
       │  REVERT;              │                        │
       │                       │                        │
       │  COMMIT TRANSACTION   │                        │
       │                       │                        │
       │ 4. Query Results      │                        │
       │<──────────────────────│                        │
       │   (executed as        │                        │
       │    ALICE_ADMIN)       │                        │
       │                       │                        │
```

### SQL Server EXECUTE AS USER - Deep Dive

**What `EXECUTE AS USER` Does:**

1. **NOT Kerberos Delegation** - This is a T-SQL command, not a Kerberos protocol operation
2. **Security Context Switch** - SQL Server switches the execution context internally
3. **Windows SID Validation** - SQL Server queries Active Directory to verify user exists
4. **Permission Checking** - All subsequent queries check permissions against the impersonated user
5. **Automatic Reversion** - Context restored with `REVERT` or at transaction end

**Example T-SQL Session:**

```sql
-- MCP server connects as: DOMAIN\svc-mcp-server
SELECT CURRENT_USER;
-- Returns: DOMAIN\svc-mcp-server

-- Switch to user's context (NO PASSWORD REQUIRED!)
EXECUTE AS USER = 'DOMAIN\ALICE_ADMIN';

SELECT CURRENT_USER;
-- Returns: DOMAIN\ALICE_ADMIN

SELECT SYSTEM_USER;
-- Returns: DOMAIN\svc-mcp-server (connection still authenticated as service account!)

-- Try to access table alice can see
SELECT * FROM HRData.SalaryInfo;
-- Permissions checked against: DOMAIN\ALICE_ADMIN
-- Succeeds if alice has SELECT permission

-- Restore original context
REVERT;

SELECT CURRENT_USER;
-- Returns: DOMAIN\svc-mcp-server
```

### Required SQL Server Setup

**1. Service Account Must Have IMPERSONATE Permission:**

```sql
-- Grant permission to impersonate specific user
GRANT IMPERSONATE ON USER::[DOMAIN\ALICE_ADMIN] TO [DOMAIN\svc-mcp-server];

-- OR grant broad impersonation (less secure)
ALTER SERVER ROLE [sysadmin] ADD MEMBER [DOMAIN\svc-mcp-server];
```

**2. Target User Must Exist in SQL Server:**

**Option A: Contained Database User (NO Windows Login Required)**
```sql
-- SQL Server 2012+ feature
CREATE USER [ALICE_ADMIN] WITHOUT LOGIN;
GRANT SELECT ON HRData.SalaryInfo TO [ALICE_ADMIN];
```

**Option B: Windows Authentication (Traditional)**
```sql
-- User must exist in Active Directory
-- SQL Server verifies via Windows SID lookup
CREATE LOGIN [DOMAIN\ALICE_ADMIN] FROM WINDOWS;
CREATE USER [DOMAIN\ALICE_ADMIN] FOR LOGIN [DOMAIN\ALICE_ADMIN];
GRANT SELECT ON HRData.SalaryInfo TO [DOMAIN\ALICE_ADMIN];
```

### Key Differences from Kerberos Delegation

| Aspect | SQL EXECUTE AS USER (Current) | Kerberos S4U2Proxy (Future) |
|--------|-------------------------------|------------------------------|
| **Authentication Method** | Service account credentials | Kerberos tickets |
| **Connection User** | svc-mcp-server | alice (via delegated ticket) |
| **Execution User** | Switched to alice via T-SQL | alice from connection |
| **Requires User Password** | ❌ No | ❌ No (S4U obtains ticket) |
| **Kerberos Ticket** | ❌ Not used | ✅ Required |
| **Active Directory Query** | ✅ SQL Server queries AD for SID | ✅ KDC validates ticket |
| **Works With** | SQL Server, PostgreSQL | File shares, web apps, SQL |
| **Complexity** | Low (T-SQL command) | High (GSSAPI/SSPI bindings) |

## Key Concepts

### 1. Two-Token Pattern

**Subject Token (ST-JWT):**
- Issued by Keycloak after user authentication
- Audience includes both client app (`contextflow`) and MCP server (`mcp-oauth`)
- Contains user identity but may lack backend-specific claims (e.g., `legacy_name`)
- Used to authorize MCP tool access

**Delegation Token (TE-JWT):**
- Issued by Keycloak via token exchange
- Audience scoped to MCP server only (`mcp-oauth`)
- Contains backend-specific claims (e.g., `legacy_name`, resource-specific roles)
- Used to authorize downstream resource access (SQL Server, file shares, etc.)

### 2. When Does Keycloak Actually Perform S4U2Self?

**SHORT ANSWER:** Keycloak does NOT need to perform S4U2Self for SQL Server delegation in the current implementation.

**Detailed Explanation:**

Keycloak can integrate with Active Directory in two modes:

**Mode A: LDAP Attribute Mapping (Simpler) - CURRENT IMPLEMENTATION**
- Keycloak queries AD/LDAP for user attributes (sAMAccountName, memberOf, etc.)
- **NO Kerberos S4U2Self required**
- Returns `legacy_name` from AD `sAMAccountName` attribute via simple LDAP query
- **This is what we use for SQL Server delegation**
- Keycloak binds to AD with service account credentials (username/password)
- LDAP query: `(userPrincipalName=alice@w25ad.net)` → retrieves `sAMAccountName=ALICE_ADMIN`
- TE-JWT includes `legacy_name: ALICE_ADMIN` claim
- MCP server uses this for SQL `EXECUTE AS USER 'ALICE_ADMIN'`

**Why S4U2Self is NOT needed for SQL delegation:**
1. MCP server doesn't need Kerberos tickets
2. SQL Server connection uses service account credentials (not user's ticket)
3. `EXECUTE AS USER` is a T-SQL command, not Kerberos protocol
4. SQL Server verifies user via Windows SID lookup (queries AD), not Kerberos ticket validation

**Mode B: Kerberos/SPNEGO Integration (Advanced) - FUTURE USE CASE**
- Keycloak configured with Kerberos/SPNEGO authentication
- Keycloak service account has S4U2Self privileges in AD (`TRUSTED_TO_AUTH_FOR_DELEGATION`)
- During token exchange, Keycloak performs S4U2Self to obtain user's delegated Kerberos ticket
- Returns both `legacy_name` claim AND Kerberos ticket (base64-encoded in JWT)
- **Only needed if MCP server must access Kerberos-protected resources (SMB file shares, NFS, Kerberized web apps)**

**When S4U2Self IS needed:**
1. MCP server needs to access SMB file shares as user (requires Kerberos ticket)
2. MCP server needs to call Kerberos-protected web applications
3. MCP server needs to access NFS shares with Kerberos security
4. Any scenario where MCP server must present user's Kerberos ticket to downstream resource

---

## Keycloak Configuration

### Step 1: Connect Keycloak to Active Directory

**Option 1: LDAP User Federation (Recommended)**

```json
// Keycloak Admin Console → User Federation → Add LDAP
{
  "vendor": "Active Directory",
  "connectionUrl": "ldaps://dc.w25ad.net:636",
  "bindDn": "CN=keycloak-svc,OU=Service Accounts,DC=w25ad,DC=net",
  "bindCredential": "KeycloakServicePassword123!",
  "usersDn": "OU=Users,DC=w25ad,DC=net",
  "usernameLDAPAttribute": "userPrincipalName",
  "rdnLDAPAttribute": "cn",
  "uuidLDAPAttribute": "objectGUID",
  "userObjectClasses": "person, organizationalPerson, user",
  "customUserSearchFilter": "(userAccountControl:1.2.840.113556.1.4.803:=512)",
  "searchScope": "Subtree"
}
```

**Option 2: Kerberos/SPNEGO Federation (Advanced)**

```json
// Keycloak Admin Console → User Federation → Add Kerberos
{
  "kerberosRealm": "W25AD.NET",
  "serverPrincipal": "HTTP/keycloak.w25ad.net@W25AD.NET",
  "keyTab": "/etc/keycloak/keycloak.keytab",
  "allowPasswordAuthentication": true,
  "updateProfileFirstLogin": false
}
```

### Step 2: Create Client Mappers

**Client: `mcp-oauth`**

**Mapper 1: Legacy Username Mapper**

```json
{
  "name": "legacy-name-mapper",
  "protocol": "openid-connect",
  "protocolMapper": "oidc-usermodel-attribute-mapper",
  "config": {
    "user.attribute": "sAMAccountName",  // AD attribute
    "claim.name": "legacy_name",         // JWT claim
    "jsonType.label": "String",
    "id.token.claim": "true",
    "access.token.claim": "true",
    "userinfo.token.claim": "true"
  }
}
```

**Mapper 2: Resource-Specific Roles Mapper**

```json
{
  "name": "sql-roles-mapper",
  "protocol": "openid-connect",
  "protocolMapper": "oidc-group-membership-mapper",
  "config": {
    "claim.name": "roles",
    "full.path": "false",
    "id.token.claim": "true",
    "access.token.claim": "true",
    "userinfo.token.claim": "true"
  }
}
```

**Mapper 3: Permissions Mapper (Custom)**

```json
{
  "name": "sql-permissions-mapper",
  "protocol": "openid-connect",
  "protocolMapper": "oidc-hardcoded-claim-mapper",
  "config": {
    "claim.name": "permissions",
    "claim.value": "[\"sql:read\", \"sql:write\"]",  // Based on AD group membership
    "jsonType.label": "JSON",
    "id.token.claim": "true",
    "access.token.claim": "true"
  }
}
```

**Advanced: Script Mapper for Dynamic Permissions**

```javascript
// Keycloak Admin Console → Clients → mcp-oauth → Mappers → Create Protocol Mapper
// Type: Script Mapper

// Script to map AD groups to permissions
var permissions = [];
var groups = user.getGroups();

for each (var group in groups) {
  if (group.getName() === 'SQL_ReadOnly') {
    permissions.push('sql:read');
  } else if (group.getName() === 'SQL_Writers') {
    permissions.push('sql:read');
    permissions.push('sql:write');
  } else if (group.getName() === 'SQL_Admins') {
    permissions.push('sql:read');
    permissions.push('sql:write');
    permissions.push('sql:admin');
  }
}

exports = permissions;
```

### Step 3: Enable Token Exchange

**Client: `mcp-oauth`**

```json
// Keycloak Admin Console → Clients → mcp-oauth → Settings
{
  "clientId": "mcp-oauth",
  "clientAuthenticatorType": "client-secret",
  "secret": "JUUA5xCJDQZdreWgEFYvfAqjJnGdTXXA",
  "standardFlowEnabled": false,           // No direct user login
  "directAccessGrantsEnabled": false,     // No password grants
  "serviceAccountsEnabled": true,         // Client credentials grant
  "authorizationServicesEnabled": false
}

// Keycloak Admin Console → Clients → mcp-oauth → Permissions → Token Exchange
{
  "enabled": true
}

// Keycloak Admin Console → Clients → mcp-oauth → Scope
{
  "fullScopeAllowed": true
}
```

**Client: `contextflow` (User-Facing App)**

```json
{
  "clientId": "contextflow",
  "clientAuthenticatorType": "client-secret",
  "secret": "ContextflowSecret123!",
  "standardFlowEnabled": true,            // OAuth authorization code flow
  "directAccessGrantsEnabled": true,      // For testing (password grant)
  "publicClient": false,
  "redirectUris": ["http://localhost/callback"],
  "webOrigins": ["http://localhost"]
}

// Keycloak Admin Console → Clients → contextflow → Client Scopes
// Add: mcp-oauth (to allow token exchange to mcp-oauth audience)
```

### Step 4: Grant Token Exchange Permission

**Keycloak Admin Console → Clients → contextflow → Permissions → Token Exchange**

Add target client: `mcp-oauth` (allow `contextflow` tokens to be exchanged for `mcp-oauth` tokens)

**Or via REST API:**

```bash
# Get admin token
ADMIN_TOKEN=$(curl -X POST "http://localhost:8080/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli" \
  -d "username=admin" \
  -d "password=admin" \
  -d "grant_type=password" | jq -r '.access_token')

# Grant token exchange permission
curl -X PUT "http://localhost:8080/admin/realms/mcp_security/clients/contextflow-id/token-exchange/clients/mcp-oauth-id" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'
```

---

## MCP Server Configuration

The MCP server config ([v2-keycloak-token-exchange.json](../test-harness/config/v2-keycloak-token-exchange.json)) specifies:

```json
{
  "delegation": {
    "tokenExchange": {
      "tokenEndpoint": "http://localhost:8080/realms/mcp_security/protocol/openid-connect/token",
      "clientId": "mcp-oauth",
      "clientSecret": "JUUA5xCJDQZdreWgEFYvfAqjJnGdTXXA",
      "audience": "mcp-oauth",
      "defaultScope": "openid profile email",
      "cache": {
        "enabled": false  // Phase 1: No caching (stateless)
      }
    }
  }
}
```

**Key Configuration Points:**

1. **tokenEndpoint**: Keycloak's OAuth 2.0 token endpoint
2. **clientId**: Must match Keycloak client with token exchange enabled
3. **clientSecret**: Client credentials for authenticating exchange request
4. **audience**: Target audience for exchanged token (`mcp-oauth`)
5. **cache.enabled**: `false` for Phase 1 (stateless), `true` for Phase 2 (cached)

---

## Token Exchange Flow (Detailed)

### Request from MCP Server to Keycloak

```http
POST /realms/mcp_security/protocol/openid-connect/token HTTP/1.1
Host: localhost:8080
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:token-exchange
&client_id=mcp-oauth
&client_secret=JUUA5xCJDQZdreWgEFYvfAqjJnGdTXXA
&subject_token=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...  (ST-JWT)
&subject_token_type=urn:ietf:params:oauth:token-type:access_token
&requested_token_type=urn:ietf:params:oauth:token-type:access_token
&audience=mcp-oauth
&scope=openid profile email
```

**Key Parameters:**

- **grant_type**: `urn:ietf:params:oauth:grant-type:token-exchange` (RFC 8693)
- **subject_token**: The ST-JWT from user authentication
- **audience**: Target audience (`mcp-oauth`) - scopes TE-JWT to MCP server
- **client_id/client_secret**: MCP server's client credentials

### Keycloak Internal Processing

**Step 1: Validate Subject Token**
```java
// Keycloak internal logic (pseudocode)
SubjectToken st = validateJWT(subject_token);
if (!st.aud.contains("mcp-oauth")) {
  throw new InvalidGrantException("ST-JWT audience must include mcp-oauth");
}
```

**Step 2: Extract User Identity**
```java
String userId = st.claims.get("sub");  // alice
String upn = st.claims.get("preferred_username");  // alice@w25ad.net
```

**Step 3: Query LDAP for User Attributes**
```java
LDAPUser user = ldap.search("(&(objectClass=user)(userPrincipalName=" + upn + "))");
String legacyName = user.getAttribute("sAMAccountName");  // ALICE_ADMIN
List<String> groups = user.getAttribute("memberOf");  // CN=SQL_Writers,...
```

**Step 4 (Optional): Perform S4U2Self for Kerberos Ticket**
```java
// Only if Kerberos federation enabled
if (keycloakConfig.kerberosFederation.enabled) {
  KerberosContext ctx = acquireServiceCredentials();
  KerberosTicket delegatedTicket = ctx.performS4U2Self(upn);
  // Store ticket in session or encode in JWT
}
```

**Step 5: Map Groups to Roles and Permissions**
```java
List<String> roles = new ArrayList<>();
List<String> permissions = new ArrayList<>();

for (String group : groups) {
  if (group.contains("SQL_Writers")) {
    roles.add("sql_writer");
    permissions.add("sql:read");
    permissions.add("sql:write");
  }
  if (group.contains("SQL_Admins")) {
    roles.add("sql_admin");
    permissions.add("sql:admin");
  }
}
```

**Step 6: Mint TE-JWT with Claims**
```java
JWT teJwt = new JWT()
  .setIssuer("http://localhost:8080/realms/mcp_security")
  .setSubject(userId)
  .setAudience("mcp-oauth")
  .setAuthorizedParty("mcp-oauth")  // azp claim
  .setClaim("legacy_name", legacyName)  // ALICE_ADMIN
  .setClaim("roles", roles)              // [sql_writer]
  .setClaim("permissions", permissions)  // [sql:read, sql:write]
  .setClaim("act", Map.of(              // Actor claim (optional)
    "sub", userId,
    "iss", "http://localhost:8080/realms/mcp_security"
  ))
  .setExpiration(now + 3600)
  .sign(realmPrivateKey);
```

### Response from Keycloak to MCP Server

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",  // TE-JWT
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "openid profile email",
  "issued_token_type": "urn:ietf:params:oauth:token-type:access_token"
}
```

**Decoded TE-JWT Payload:**

```json
{
  "iss": "http://localhost:8080/realms/mcp_security",
  "sub": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "aud": "mcp-oauth",
  "azp": "mcp-oauth",
  "exp": 1704729600,
  "iat": 1704726000,
  "preferred_username": "alice@w25ad.net",
  "legacy_name": "ALICE_ADMIN",
  "roles": ["sql_writer"],
  "permissions": ["sql:read", "sql:write"],
  "act": {
    "sub": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "iss": "http://localhost:8080/realms/mcp_security"
  }
}
```

---

## MCP Server Processing

### TokenExchangeService.performExchange()

**Location:** [src/delegation/token-exchange.ts](../src/delegation/token-exchange.ts)

```typescript
async performExchange(params: TokenExchangeParams): Promise<string> {
  const { requestorJWT, audience, scope, sessionId } = params;

  // Build token exchange request
  const requestBody = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    client_id: this.config.clientId,
    client_secret: this.config.clientSecret,
    subject_token: requestorJWT,
    subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    audience: audience || this.config.audience,
    scope: scope || this.config.defaultScope,
  });

  // Call Keycloak token endpoint
  const response = await fetch(this.config.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: requestBody,
  });

  if (!response.ok) {
    const error = await response.json();
    this.auditService.log({
      timestamp: new Date(),
      source: 'token-exchange',
      userId: 'unknown',
      action: 'token_exchange_failed',
      success: false,
      error: error.error_description || error.error,
    });
    throw new Error(`Token exchange failed: ${error.error}`);
  }

  const data = await response.json();

  // Audit successful exchange
  this.auditService.log({
    timestamp: new Date(),
    source: 'token-exchange',
    userId: this.extractUserIdFromJWT(requestorJWT),
    action: 'token_exchange_success',
    success: true,
    metadata: { audience, sessionId },
  });

  return data.access_token;  // Return TE-JWT
}
```

### SQLDelegationModule.delegate()

**Location:** [packages/sql-delegation/src/sql-module.ts](../packages/sql-delegation/src/sql-module.ts)

```typescript
async delegate<T>(
  session: UserSession,
  action: string,
  params: any,
  context?: { sessionId?: string; coreContext?: CoreContext }
): Promise<DelegationResult<T>> {
  const auditEntry: AuditEntry = {
    timestamp: new Date(),
    source: 'delegation:sql',
    userId: session.userId,
    action: `sql_delegation:${action}`,
    success: false,
  };

  try {
    let legacyUsername = session.legacyUsername;

    // If no legacy username in session, perform token exchange
    if (!legacyUsername && context?.coreContext?.tokenExchangeService) {
      const teJwt = await context.coreContext.tokenExchangeService.performExchange({
        requestorJWT: session.claims.access_token,
        audience: 'mcp-oauth',
        sessionId: context.sessionId,
      });

      // Decode TE-JWT to extract legacy_name
      const teClaims = this.decodeJWT(teJwt);
      legacyUsername = teClaims.legacy_name;

      if (!legacyUsername) {
        throw new Error('TE-JWT missing legacy_name claim');
      }

      auditEntry.metadata = { tokenExchangeUsed: true };
    }

    if (!legacyUsername) {
      throw new Error('Session missing legacyUsername (required for SQL delegation)');
    }

    // Perform SQL delegation
    const result = await this.executeSQLWithDelegation(legacyUsername, action, params);

    auditEntry.success = true;
    auditEntry.metadata = {
      ...auditEntry.metadata,
      legacyUsername,
      action,
    };

    return { success: true, data: result as T, auditTrail: auditEntry };
  } catch (error) {
    auditEntry.error = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: auditEntry.error, auditTrail: auditEntry };
  }
}
```

---

## Why This Approach Works

### Advantages of Keycloak-Managed S4U

**1. Zero Kerberos Dependencies in MCP Server**
- No `kerberos` npm package required
- No keytab file management
- No `KRB5_KTNAME` environment variables
- No cross-platform Kerberos library issues

**2. Centralized Identity Management**
- Keycloak is already integrated with Active Directory
- Single source of truth for user attributes
- Consistent role/permission mapping
- Simplified audit trail

**3. Security Benefits**
- Keycloak credentials never exposed to MCP server
- Service account credentials (for S4U2Self) secured in Keycloak
- Token exchange uses OAuth 2.0 client credentials (industry standard)
- MCP server only receives JWTs (stateless, revocable)

**4. Operational Simplicity**
- Keycloak handles S4U2Self complexity internally
- MCP server only performs HTTP POST to token endpoint
- Easy to test (curl commands, no Kerberos CLI tools)
- Standard OAuth 2.0 debugging tools work

**5. Flexibility**
- Works with any IDP supporting RFC 8693 (Okta, Azure AD, Auth0)
- Not locked into Kerberos (can use SAML, LDAP, OAuth)
- Easy to add new claim mappings in Keycloak UI
- No code changes required for new AD attributes

### When Keycloak Performs S4U2Self

Keycloak performs actual Kerberos S4U2Self **ONLY IF:**

1. **Kerberos/SPNEGO Federation Enabled** - Keycloak configured with Kerberos integration
2. **S4U2Self Required** - MCP server needs Kerberos tickets (for SMB/NFS access)
3. **Service Account Configured** - Keycloak service account has `TRUSTED_TO_AUTH_FOR_DELEGATION` in AD

**For SQL Server delegation (current use case):**
- S4U2Self **NOT REQUIRED** - MCP server only needs `legacy_name` claim
- Keycloak retrieves `sAMAccountName` via LDAP query (no Kerberos involved)
- SQL Server uses `EXECUTE AS USER` with `legacy_name` (T-SQL impersonation, not Kerberos)

---

## Testing the Integration

### Step 1: Set Up Keycloak

**Start Keycloak:**
```bash
docker run -p 8080:8080 \
  -e KEYCLOAK_ADMIN=admin \
  -e KEYCLOAK_ADMIN_PASSWORD=admin \
  quay.io/keycloak/keycloak:latest start-dev
```

**Configure Realm, Clients, Mappers** (as described in "Keycloak Configuration" section)

### Step 2: Test Token Exchange Manually

**Get Subject Token:**
```bash
ST_JWT=$(curl -X POST "http://localhost:8080/realms/mcp_security/protocol/openid-connect/token" \
  -d "client_id=contextflow" \
  -d "client_secret=ContextflowSecret123!" \
  -d "username=alice@w25ad.net" \
  -d "password=AlicePassword123!" \
  -d "grant_type=password" \
  | jq -r '.access_token')

echo "Subject Token: $ST_JWT"

# Decode to verify claims
echo $ST_JWT | cut -d. -f2 | base64 -d | jq .
```

**Perform Token Exchange:**
```bash
TE_JWT=$(curl -X POST "http://localhost:8080/realms/mcp_security/protocol/openid-connect/token" \
  -d "grant_type=urn:ietf:params:oauth:grant-type:token-exchange" \
  -d "client_id=mcp-oauth" \
  -d "client_secret=JUUA5xCJDQZdreWgEFYvfAqjJnGdTXXA" \
  -d "subject_token=$ST_JWT" \
  -d "subject_token_type=urn:ietf:params:oauth:token-type:access_token" \
  -d "requested_token_type=urn:ietf:params:oauth:token-type:access_token" \
  -d "audience=mcp-oauth" \
  | jq -r '.access_token')

echo "Delegation Token: $TE_JWT"

# Decode to verify legacy_name claim
echo $TE_JWT | cut -d. -f2 | base64 -d | jq .
# Expected output includes: "legacy_name": "ALICE_ADMIN"
```

### Step 3: Test MCP Server Integration

**Start MCP Server:**
```bash
export NODE_ENV=development
export CONFIG_PATH=./test-harness/config/v2-keycloak-token-exchange.json
export SERVER_PORT=3000
node dist/test-harness/v2-test-server.js
```

**Call SQL Delegate Tool:**
```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ST_JWT" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "sql-delegate",
      "arguments": {
        "action": "query",
        "sql": "SELECT CURRENT_USER AS current_user",
        "params": {}
      }
    },
    "id": 1
  }' | jq .
```

**Expected Output:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "content": [{
      "type": "text",
      "text": "{\"status\":\"success\",\"data\":[{\"current_user\":\"DOMAIN\\\\ALICE_ADMIN\"}]}"
    }]
  },
  "id": 1
}
```

**Verify Server Logs:**
```
[TokenExchangeService] Performing token exchange for audience: mcp-oauth
[TokenExchangeService] Token exchange successful
[SQLDelegationModule] Delegating as: ALICE_ADMIN
[AuditService] SQL delegation succeeded: { userId: alice, legacyUsername: ALICE_ADMIN, tokenExchangeUsed: true }
```

---

## Troubleshooting

### Issue: Token Exchange Returns 400 Bad Request

**Symptom:**
```json
{
  "error": "invalid_grant",
  "error_description": "Token exchange not allowed for client"
}
```

**Solution:**
1. Verify `mcp-oauth` client has token exchange enabled
2. Grant `contextflow` → `mcp-oauth` token exchange permission
3. Ensure subject token audience includes `mcp-oauth`

### Issue: TE-JWT Missing legacy_name Claim

**Symptom:**
```
Error: TE-JWT missing legacy_name claim (required for SQL delegation)
```

**Solution:**
1. Add `legacy-name-mapper` to `mcp-oauth` client mappers
2. Verify LDAP federation retrieves `sAMAccountName` attribute
3. Test LDAP query: `ldapsearch -x -H ldap://dc.w25ad.net -D "CN=keycloak-svc,..." -W -b "DC=w25ad,DC=net" "(userPrincipalName=alice@w25ad.net)" sAMAccountName`

### Issue: Keycloak Cannot Connect to LDAP

**Symptom:**
```
Error: LDAP connection failed: Could not connect to dc.w25ad.net:389
```

**Solution:**
1. Verify network connectivity: `telnet dc.w25ad.net 389`
2. Use LDAPS (port 636) for production
3. Check bind credentials: `ldapsearch -x -H ldap://dc.w25ad.net -D "CN=keycloak-svc,..." -W`
4. Verify Keycloak service account has read access to Users OU

---

## Performance Considerations

### Phase 1 (Stateless)

**Characteristics:**
- Token exchange on **every** SQL delegation request
- Network roundtrip to Keycloak: ~50-150ms
- LDAP query in Keycloak: ~10-50ms
- Total overhead: ~100-200ms per request

**When to Use:**
- Low-throughput scenarios (<10 requests/second)
- Strict security requirements (fresh token every time)
- Testing and development

### Phase 2 (Cached) - RECOMMENDED

**Characteristics:**
- Token exchange on **first** request per session
- Subsequent requests use cached TE-JWT
- Cache hit latency: <1ms
- Session-scoped cache (automatic invalidation on JWT refresh)

**Configuration:**
```json
{
  "delegation": {
    "tokenExchange": {
      "cache": {
        "enabled": true,
        "ttlSeconds": 60,           // Cache TE-JWT for 60 seconds
        "sessionTimeoutMs": 900000, // 15 minutes session timeout
        "maxEntriesPerSession": 10
      }
    }
  }
}
```

**Performance Impact:**
- Latency reduction: ~81% (300ms → 57ms)
- Keycloak load reduction: 90%+ (only first request per session)
- Memory usage: ~10MB for 1000 sessions

**See:** [Phase 2 Encrypted Token Cache Documentation](../src/delegation/encrypted-token-cache.ts)

---

## Summary: Two Delegation Approaches for Different Resources

### Question: "How does the MCP server use KDC TGT tickets to access domain resources?"

### Answer: It Depends on the Resource Type!

The MCP-OAuth framework has **TWO SEPARATE delegation modules** for different resource types:

**Visual Summary:**

```
┌─────────────────────────────────────────────────────────────────┐
│     Module 1: SQL Delegation (NO KERBEROS TICKETS)             │
│     For: SQL Server, PostgreSQL                                 │
└─────────────────────────────────────────────────────────────────┘

Client → Keycloak (OAuth Login)
         ↓
      ST-JWT (subject token)
         ↓
      MCP Server → sql-delegate tool
         ↓
      Token Exchange Request → Keycloak
                                  ↓
                              LDAP Query → Active Directory
                              (Get sAMAccountName attribute)
                                  ↓
                              TE-JWT with legacy_name="ALICE_ADMIN"
                                  ↓
                              MCP Server (SQL Delegation Module)
                                  ↓
                              Connect to SQL Server
                              (Service Account: svc-mcp-server)
                                  ↓
                              EXECUTE AS USER 'ALICE_ADMIN'
                              (T-SQL impersonation, NOT Kerberos)
                                  ↓
                              Query executes as alice
                              ✅ SUCCESS - NO KERBEROS NEEDED

┌─────────────────────────────────────────────────────────────────┐
│  Module 2: Kerberos Delegation (USES KERBEROS TICKETS)         │
│  For: SMB File Shares, NFS, Kerberos Apps                      │
│  This is the use case you're trying to implement!              │
└─────────────────────────────────────────────────────────────────┘

Client → Keycloak (OAuth Login)
         ↓
      ST-JWT
         ↓
      MCP Server → kerberos-file-read tool
         ↓
      Token Exchange → Keycloak (with Kerberos federation)
                         ↓
                     S4U2Self → KDC (Active Directory)
                     (Get user's forwardable TGT)
                         ↓
                     TE-JWT with kerberos_ticket (optional)
                     OR just legacy_name for MCP to use
                         ↓
                     MCP Server (Kerberos Delegation Module)
                         ↓
                     MCP performs S4U2Self locally
                     (Acquire service TGT, then alice's TGT)
                         ↓
                     S4U2Proxy → KDC
                     (Get service ticket for cifs/fileserver)
                         ↓
                     Connect to File Share
                     (Using alice's Kerberos service ticket)
                         ↓
                     File access as alice
                     ✅ SUCCESS - KERBEROS REQUIRED
```

**Module 1: SQL Delegation (Already Working):**

1. ✅ **Client authenticates with Keycloak** → receives Subject Token (ST-JWT)
2. ✅ **MCP server receives ST-JWT** in Authorization header
3. ✅ **MCP server calls Keycloak token endpoint** with RFC 8693 token exchange
4. ✅ **Keycloak queries Active Directory** via LDAP to retrieve `sAMAccountName`
   - **NO S4U2Self performed** - just a simple LDAP query
   - **NO Kerberos tickets involved**
5. ✅ **Keycloak mints TE-JWT** with `legacy_name`, `roles`, `permissions` claims
6. ✅ **MCP server decodes TE-JWT** to extract `legacy_name`
7. ✅ **MCP server connects to SQL Server** using **service account credentials**
   - Connection authenticated as: `svc-mcp-server`
   - **NOT alice's credentials or Kerberos ticket**
8. ✅ **SQL delegation uses `EXECUTE AS USER 'legacy_name'`** for impersonation
   - T-SQL command, NOT Kerberos delegation
   - SQL Server verifies user exists in AD via Windows SID lookup
   - Query executes with alice's permissions

**Module 2: Kerberos Delegation (What You're Implementing):**

1. ✅ **Client authenticates with Keycloak** → receives Subject Token (ST-JWT)
2. ✅ **MCP server receives ST-JWT** in Authorization header
3. ✅ **MCP server calls Keycloak token endpoint** with RFC 8693 token exchange
4. **Option A:** Keycloak performs S4U2Self internally (if Kerberos federation enabled)
   - Returns TE-JWT with Kerberos ticket embedded
   - **OR**
5. **Option B:** MCP server performs S4U2Self locally (requires native bindings)
   - Keycloak just returns `legacy_name` via LDAP
   - MCP server uses `legacy_name` to perform S4U2Self with local KDC
6. ✅ **MCP server performs S4U2Proxy** to get service ticket for target resource
7. ✅ **MCP server connects to file share** using alice's Kerberos ticket
8. ✅ **File share grants access** based on alice's AD permissions

**What Resources Can Be Accessed:**

| Resource Type | Delegation Module | Method | Kerberos Ticket Required? | Status |
|--------------|------------------|--------|---------------------------|---------|
| **SQL Server** | SQL Delegation | T-SQL `EXECUTE AS USER` | ❌ No | ✅ Implemented |
| **PostgreSQL** | SQL Delegation | `SET ROLE` or similar | ❌ No | ✅ Implemented |
| **REST APIs** | REST API Delegation | Bearer token (TE-JWT) | ❌ No | ✅ Implemented |
| **SMB File Shares** | Kerberos Delegation | S4U2Self/S4U2Proxy | ✅ Yes | ⚠️ Needs S4U support |
| **NFS (Kerberized)** | Kerberos Delegation | S4U2Self/S4U2Proxy | ✅ Yes | ⚠️ Needs S4U support |
| **SharePoint** | Kerberos Delegation | S4U2Self/S4U2Proxy | ✅ Yes | ⚠️ Needs S4U support |
| **Legacy Kerberos Apps** | Kerberos Delegation | S4U2Self/S4U2Proxy | ✅ Yes | ⚠️ Needs S4U support |

**Key Insight:** The framework has TWO independent delegation paths:

**Path 1 (SQL Delegation - NO Kerberos):**
- Keycloak acts as **claim provider** (LDAP queries)
- MCP server is **Kerberos-agnostic**
- Uses service account credentials + T-SQL impersonation

**Path 2 (Kerberos Delegation - WITH Kerberos):**
- Keycloak acts as **claim provider** (and optionally performs S4U2Self)
- MCP server **IS Kerberos-aware** (native bindings required)
- Uses S4U2Self/S4U2Proxy to obtain and use user's Kerberos tickets

### Two Approaches to Implement Kerberos Delegation

**You have two options for the Kerberos Delegation Module:**

**Option A: Keycloak Performs S4U2Self (Recommended if using Keycloak)**

```
MCP Server Flow:
1. Receive ST-JWT from client
2. Token Exchange → Keycloak (with Kerberos federation enabled)
3. Keycloak performs S4U2Self internally → gets user's TGT from KDC
4. Keycloak returns TE-JWT with embedded Kerberos ticket (base64-encoded)
5. MCP server extracts ticket from TE-JWT
6. MCP server performs S4U2Proxy to get service ticket for target (cifs/fileserver)
7. MCP server connects to file share using service ticket
```

**Keycloak Configuration Required:**
- Kerberos/SPNEGO federation enabled
- Service account with `TRUSTED_TO_AUTH_FOR_DELEGATION` flag
- `msDS-AllowedToDelegateTo` configured for target SPNs

**MCP Server Implementation:**
- Only needs S4U2Proxy support (simpler than full S4U)
- Extract ticket from JWT, no S4U2Self needed
- ~100 hours of C++ development (GSSAPI/SSPI bindings for S4U2Proxy only)

**Option B: MCP Server Performs S4U2Self Locally**

```
MCP Server Flow:
1. Receive ST-JWT from client
2. Token Exchange → Keycloak (LDAP-only, no Kerberos federation)
3. Keycloak returns TE-JWT with legacy_name (via LDAP query)
4. MCP server acquires service account TGT from local KDC
5. MCP server performs S4U2Self using legacy_name → gets user's TGT
6. MCP server performs S4U2Proxy → gets service ticket for target
7. MCP server connects to file share using service ticket
```

**Active Directory Configuration Required:**
- MCP service account with `TRUSTED_TO_AUTH_FOR_DELEGATION` flag
- `msDS-AllowedToDelegateTo` configured for target SPNs

**MCP Server Implementation:**
- Full S4U2Self + S4U2Proxy support needed
- Native Kerberos library bindings (mongodb-js/kerberos or custom)
- ~212 hours of C++ development (see [KERBEROS-S4U-FEASIBILITY.md](KERBEROS-S4U-FEASIBILITY.md))

**Recommendation:**
- If using Keycloak → Use Option A (Keycloak performs S4U2Self)
- If using other IDP or want MCP server self-contained → Use Option B (MCP performs S4U2Self locally)

---

## References

- [RFC 8693 - OAuth 2.0 Token Exchange](https://www.rfc-editor.org/rfc/rfc8693)
- [Keycloak Token Exchange Documentation](https://www.keycloak.org/docs/latest/securing_apps/#_token-exchange)
- [Keycloak LDAP Federation Guide](https://www.keycloak.org/docs/latest/server_admin/#_ldap)
- [Keycloak Kerberos Federation Guide](https://www.keycloak.org/docs/latest/server_admin/#_kerberos)
- [MCP-OAuth Phase 1 Test Guide](../test-harness/PHASE1-TOKEN-EXCHANGE-TEST.md)
- [MCP-OAuth Phase 2 Cached Token Exchange](../src/delegation/encrypted-token-cache.ts)
- [MS-SFU - Kerberos S4U Extensions](https://docs.microsoft.com/en-us/openspecs/windows_protocols/ms-sfu/)

---

**Last Updated:** 2025-01-08
**Author:** Claude Code (Anthropic)
**Status:** ✅ Complete Documentation
