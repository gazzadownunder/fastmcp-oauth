# Keycloak S4U2Self Delegation Research

**Date:** 2025-01-08
**Question:** Can Keycloak perform S4U2Self delegation and return a TGT that can be used to access Windows resources protected by KDC?

---

## Executive Summary

**Answer: NO - Keycloak CANNOT perform S4U2Self delegation or return TGTs for arbitrary users**

After extensive research of Keycloak documentation and community discussions, the findings are:

### What Keycloak CAN Do ✅

1. **SPNEGO/Kerberos Authentication** - Authenticate users who already have Kerberos tickets from their domain-joined machines
2. **Credential Forwarding** - Forward existing delegated Kerberos credentials from browser to application
3. **GSS Delegation Credential Mapper** - Include base64-encoded Kerberos tickets in JWT claims
4. **LDAP User Attribute Mapping** - Query Active Directory for user attributes (sAMAccountName, memberOf, etc.)

### What Keycloak CANNOT Do ❌

1. **S4U2Self Protocol Transition** - Cannot obtain Kerberos tickets on behalf of users without their credentials
2. **Generate TGTs for Arbitrary Users** - Cannot create Kerberos tickets for users who didn't authenticate via Kerberos
3. **Kerberos Constrained Delegation** - No built-in S4U2Proxy support
4. **Token Exchange to Kerberos Tickets** - Token exchange only supports OAuth/OIDC tokens, NOT Kerberos tickets

---

## Detailed Research Findings

### 1. Keycloak's Kerberos Support - What It Actually Does

**From Official Documentation:**

> "Keycloak supports login with a Kerberos ticket through the SPNEGO protocol. SPNEGO (Simple and Protected GSSAPI Negotiation Mechanism) is used to authenticate transparently through the web browser after the user has been authenticated when logging-in his session."

**Critical Limitation:** This requires users to already have Kerberos tickets from a domain-joined machine.

**Flow:**
```
1. User logs into domain-joined Windows machine
   → Obtains TGT from Active Directory KDC

2. User opens browser to access Keycloak-protected app
   → Browser sends existing Kerberos ticket to Keycloak (SPNEGO)

3. Keycloak validates ticket with AD
   → Creates Keycloak session

4. (Optional) Keycloak forwards delegated credential to application
   → Application can use it to access other Kerberized services
```

**Key Point:** User MUST already have a Kerberos ticket. Keycloak just validates and forwards it.

### 2. GSS Delegation Credential Mapper

**Purpose:** Include user's existing Kerberos ticket in JWT claims

**Configuration:**
- Enable "gss delegation credential" mapper in client configuration
- Requires browser to be configured for credential delegation
- Requires "forwardable" flag on Kerberos tickets in krb5.conf

**Example JWT Claim:**
```json
{
  "iss": "https://keycloak.example.com",
  "sub": "alice",
  "gss_delegation_credential": "YIIFzQYGKwYBBQU..."  // base64-encoded Kerberos ticket
}
```

**Code to Extract Ticket:**
```java
String serializedGssCredential = accessToken.getOtherClaims()
  .get(org.keycloak.common.constants.KerberosConstants.GSS_DELEGATION_CREDENTIAL);

GSSCredential credential = org.keycloak.common.util.KerberosSerializationUtils
  .deserializeCredential(serializedGssCredential);
```

**CRITICAL LIMITATION:** This only works if:
1. User authenticated via Kerberos/SPNEGO (not password, not OAuth)
2. User's browser is on a domain-joined machine
3. User's TGT has "forwardable" flag set
4. Browser is configured to delegate credentials

**Does NOT work for:**
- ❌ Users who authenticated with username/password
- ❌ Users on non-domain-joined machines
- ❌ OAuth/OIDC authentication flows
- ❌ Users authenticating from mobile devices or external networks

### 3. S4U2Self Support - Community Consensus

**Stack Overflow Question:** "Keycloak GSS Credential delegation when browser not in AD Domain"

**Answer from Community:**
> "Keycloak will never receive GSS credentials from browser and so cannot forward them to your Java Web App."

**Suggested Workaround:**
> "Java Web App has to invoke Kerberos Constrained Delegation S4U2Self for impersonation to generate a ticket on behalf of the end-user based on its login name."

**Interpretation:** Keycloak does NOT perform S4U2Self. Applications must do it themselves.

**Medium Article:** "Kerberos integration with Keycloak"

Key finding:
> "Keycloak does not support Kerberos Constrained Delegation (yet) and so cannot impersonate user - i.e. generate a TGT on behalf on end-user based on its login name."

**Status:** As of 2024, Keycloak has NO built-in S4U2Self/S4U2Proxy support.

### 4. Token Exchange Capabilities

**From Official Token Exchange Documentation:**

**Supported Token Types:**

| Direction | Supported Types |
|-----------|----------------|
| Subject Token (input) | OAuth access tokens, JWTs |
| Requested Token (output) | OAuth access tokens, Refresh tokens, ID tokens |

**Explicit Statement:**
> "We currently only support OpenID Connect and OAuth exchanges."

**NOT Supported:**
- ❌ Kerberos tickets as subject tokens
- ❌ Kerberos tickets as requested tokens
- ❌ SAML identity providers
- ❌ Twitter tokens

**Token Exchange Flow:**
```
POST /realms/mcp_security/protocol/openid-connect/token
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:token-exchange
&subject_token=<OAUTH_JWT>         ← MUST be OAuth/OIDC token
&subject_token_type=urn:ietf:params:oauth:token-type:access_token
&requested_token_type=urn:ietf:params:oauth:token-type:access_token
&audience=mcp-oauth

Response:
{
  "access_token": "<NEW_OAUTH_JWT>",  ← Returns OAuth JWT, NOT Kerberos ticket
  "token_type": "Bearer",
  "expires_in": 3600
}
```

**Conclusion:** Token exchange CANNOT return Kerberos tickets.

### 5. What About Keycloak's Kerberos Federation?

**Purpose:** Allow Keycloak to authenticate users against Kerberos/AD

**Configuration:**
```json
{
  "kerberosRealm": "W25AD.NET",
  "serverPrincipal": "HTTP/keycloak.w25ad.net@W25AD.NET",
  "keyTab": "/etc/keycloak/keycloak.keytab",
  "allowPasswordAuthentication": true
}
```

**What This Does:**
- ✅ Allows SPNEGO authentication (if user has Kerberos ticket)
- ✅ Allows password authentication (validates against AD)
- ✅ Retrieves user attributes from LDAP
- ❌ Does NOT perform S4U2Self to obtain tickets for users

**Keycloak's Service Account:** Configured with keytab, but only used for:
1. Authenticating Keycloak itself to AD (LDAP queries)
2. Validating incoming Kerberos tickets from browsers
3. **NOT** used for S4U2Self delegation on behalf of users

---

## Why Keycloak Can't Do S4U2Self

### Technical Reason

**S4U2Self requires:**
1. Service account with `TRUSTED_TO_AUTH_FOR_DELEGATION` flag in AD
2. Direct Kerberos protocol communication with KDC
3. Construction of PA-FOR-USER preauthentication data
4. Negotiation of forwardable TGT on behalf of user
5. Windows SSPI or MIT Kerberos GSSAPI library support

**Keycloak's Kerberos Integration:**
- Uses Java GSS-API (limited functionality)
- Designed for **authentication**, not **delegation**
- No API exposed for S4U2Self in Keycloak admin or REST APIs
- No configuration options for constrained delegation

### Architectural Reason

**Keycloak's Design Philosophy:**
- Central authentication authority (SSO)
- Issues OAuth/OIDC tokens (industry standard)
- Does NOT act as Kerberos ticket broker

**Why S4U2Self Doesn't Fit:**
- Would require Keycloak to maintain Kerberos tickets (state management)
- Security risk (Keycloak becomes high-value target)
- Complex lifecycle management (ticket expiration, renewal)
- Platform-specific (Windows-centric)
- Contradicts stateless OAuth model

---

## What Keycloak CAN Provide for MCP-OAuth

### Scenario: User Authenticates with Password (NOT Kerberos)

**User Flow:**
```
1. User opens browser (non-domain-joined machine)
2. Navigates to MCP-protected application
3. Redirected to Keycloak login page
4. Enters username/password
5. Keycloak validates against Active Directory
6. Returns OAuth JWT (Subject Token)
```

**What Keycloak Can Include in JWT:**
- ✅ `sub` - User ID
- ✅ `preferred_username` - User's UPN (alice@w25ad.net)
- ✅ `legacy_name` - sAMAccountName from AD (via LDAP mapper)
- ✅ `roles` - User's AD group memberships
- ✅ `permissions` - Application-specific permissions
- ❌ `kerberos_ticket` - NOT POSSIBLE (user didn't authenticate with Kerberos)

**Token Exchange Result:**
```json
{
  "access_token": "eyJhbG...",
  "iss": "https://keycloak.example.com",
  "sub": "a1b2c3d4-...",
  "preferred_username": "alice@w25ad.net",
  "legacy_name": "ALICE_ADMIN",           ← Retrieved via LDAP
  "roles": ["sql_writer", "file_reader"],
  "permissions": ["sql:read", "sql:write"]
}
```

**Missing:** Kerberos TGT ticket

### Scenario: User Authenticates with Kerberos (Domain-Joined)

**User Flow:**
```
1. User logs into domain-joined Windows machine
2. Obtains TGT from AD KDC
3. Opens browser to MCP-protected application
4. Browser sends Kerberos ticket to Keycloak (SPNEGO)
5. Keycloak validates ticket
6. Returns OAuth JWT with delegated Kerberos ticket
```

**What Keycloak Can Include in JWT:**
- ✅ All claims from password scenario above
- ✅ `gss_delegation_credential` - Base64-encoded Kerberos ticket (if mapper enabled)

**Token Exchange Result:**
```json
{
  "access_token": "eyJhbG...",
  "iss": "https://keycloak.example.com",
  "sub": "a1b2c3d4-...",
  "preferred_username": "alice@w25ad.net",
  "legacy_name": "ALICE_ADMIN",
  "gss_delegation_credential": "YIIFzQYGKwYBBQU..."  ← User's existing Kerberos ticket
}
```

**Limitation:** Only works if user authenticated via Kerberos. Does NOT work for password/OAuth authentication.

---

## Impact on MCP-OAuth Architecture

### Original Assumption (INCORRECT)

**What We Hoped:**
```
Client → Keycloak (password auth)
         ↓
      OAuth JWT (no Kerberos ticket)
         ↓
      MCP Server → Token Exchange → Keycloak
                                      ↓
                                  Keycloak performs S4U2Self
                                  (obtains Kerberos TGT for alice)
                                      ↓
                                  TE-JWT with Kerberos ticket
                                      ↓
                                  MCP Server
                                      ↓
                                  Use ticket to access file shares
```

**Why This Doesn't Work:** Keycloak CANNOT perform S4U2Self.

### Reality Check

**What Keycloak Actually Provides:**
```
Client → Keycloak (password auth)
         ↓
      OAuth JWT (no Kerberos ticket)
         ↓
      MCP Server → Token Exchange → Keycloak
                                      ↓
                                  LDAP query to AD
                                  (retrieve sAMAccountName)
                                      ↓
                                  TE-JWT with legacy_name claim
                                  (NO Kerberos ticket)
                                      ↓
                                  MCP Server
                                      ↓
                                  ??? How to access file shares ???
```

**Problem:** MCP server has `legacy_name` but NO Kerberos ticket.

---

## Options for Kerberos Delegation with Keycloak

### Option 1: MCP Server Performs S4U2Self Locally ⚠️

**Approach:**
- Keycloak returns `legacy_name` via LDAP (as it does now)
- MCP server has native SSPI/GSSAPI bindings
- MCP server performs S4U2Self using `legacy_name`
- MCP server performs S4U2Proxy to get service ticket
- MCP server accesses file share with service ticket

**Requirements:**
- MCP service account configured with `TRUSTED_TO_AUTH_FOR_DELEGATION`
- MCP service account has `msDS-AllowedToDelegateTo` for target SPNs
- Native C++ SSPI bindings (~2000 LOC, per KERBEROS-SOLUTION-ANALYSIS.md)

**Keycloak's Role:**
- ✅ Authenticate user
- ✅ Provide `legacy_name` claim via LDAP
- ❌ NOT involved in Kerberos delegation

**Verdict:** Technically viable but requires significant MCP server development (see KERBEROS-SOLUTION-ANALYSIS.md Option 3).

### Option 2: Windows Service Performs S4U2Self ✅ RECOMMENDED

**Approach:**
- Keycloak returns `legacy_name` via LDAP (as it does now)
- MCP server (Node.js) sends request to Windows Service via named pipe
- Windows Service (C#/.NET) performs S4U2Self/S4U2Proxy
- Windows Service accesses file share and returns results
- MCP server returns results to client

**Requirements:**
- Windows Service written in C#/.NET (200-300 LOC)
- Service account configured with delegation rights
- Named pipe communication between Node.js and Windows Service

**Keycloak's Role:**
- ✅ Authenticate user
- ✅ Provide `legacy_name` claim via LDAP
- ❌ NOT involved in Kerberos delegation

**Verdict:** Most practical solution (see KERBEROS-SOLUTION-ANALYSIS.md Option 1).

### Option 3: Require Domain-Joined Clients ⚠️

**Approach:**
- Enforce Kerberos/SPNEGO authentication (no password auth)
- Users MUST be on domain-joined machines
- Browsers MUST be configured for credential delegation
- Keycloak forwards existing Kerberos ticket in JWT
- MCP server extracts ticket from JWT
- MCP server uses ticket to perform S4U2Proxy (simpler than S4U2Self)

**Requirements:**
- All users on domain-joined machines
- Browser configuration (Firefox: network.negotiate-auth.delegation-uris)
- MCP server has S4U2Proxy support (only proxy, not self)
- Reduced development effort (~100 hours vs 212 hours)

**Keycloak's Role:**
- ✅ Authenticate user via Kerberos/SPNEGO
- ✅ Forward existing Kerberos ticket in JWT
- ❌ Does NOT generate new tickets

**Verdict:** Viable for corporate intranets where all users are on domain. Not viable for external/mobile users.

### Option 4: RunAs Service Account Mode ✅ IMMEDIATE

**Approach:**
- MCP server uses service account credentials for ALL operations
- Keycloak provides user identity in JWT (audit logging only)
- File shares accessed as service account, NOT individual users

**Requirements:**
- Service account has access to all required file shares
- Accept that resources see service account, not users
- Comprehensive audit logging at application layer

**Keycloak's Role:**
- ✅ Authenticate user
- ✅ Provide user identity for audit logging
- ❌ NOT involved in resource access

**Verdict:** Already implemented in packages/kerberos-delegation. Works today for development/testing and non-compliance scenarios (see KERBEROS-SOLUTION-ANALYSIS.md Option 0).

---

## Conclusion

### Can Keycloak Perform S4U2Self Delegation?

**NO** - Keycloak does NOT have built-in S4U2Self/S4U2Proxy support.

**What Keycloak DOES:**
- ✅ Authenticates users against Active Directory
- ✅ Validates existing Kerberos tickets (if user has them)
- ✅ Forwards existing Kerberos tickets in JWT (if user authenticated via SPNEGO)
- ✅ Retrieves user attributes from LDAP (sAMAccountName, memberOf)
- ✅ Issues OAuth/OIDC tokens with user claims

**What Keycloak DOES NOT DO:**
- ❌ Generate Kerberos TGTs on behalf of arbitrary users
- ❌ Perform S4U2Self protocol transition
- ❌ Return Kerberos tickets in token exchange responses
- ❌ Support constrained delegation

### Can Keycloak Return a TGT for Use with Windows Resources?

**ONLY IF** user authenticated via Kerberos/SPNEGO (domain-joined machine with existing TGT).

**NOT POSSIBLE IF** user authenticated via:
- Password (most common)
- OAuth/OIDC from external IDP
- Mobile device
- Non-domain-joined machine

### Recommended Path Forward

**Based on research and KERBEROS-SOLUTION-ANALYSIS.md findings:**

1. **Immediate Use:** RunAs Service Account Mode (Option 0)
   - Already implemented in packages/kerberos-delegation
   - Works for development, testing, shared resources
   - Keycloak provides user identity for audit logging only

2. **True Delegation (If Required):** Windows Service with Named Pipes (Option 1)
   - C#/.NET service performs S4U2Self/S4U2Proxy (200-300 LOC)
   - Keycloak provides `legacy_name` via LDAP
   - MCP server communicates with Windows Service via IPC

3. **Corporate Intranet Only:** Require Domain-Joined Clients (Option 3)
   - Enforce Kerberos/SPNEGO authentication
   - Keycloak forwards existing tickets
   - MCP server performs S4U2Proxy only (~100 hours development)

4. **NOT RECOMMENDED:** Native SSPI Bindings in MCP Server
   - ~2000 LOC of C++ code
   - High complexity and maintenance burden
   - Better to use Windows Service approach

---

## References

- [Keycloak Kerberos Documentation](https://wjw465150.gitbooks.io/keycloak-documentation/content/server_admin/topics/authentication/kerberos.html)
- [Keycloak Token Exchange Documentation](https://www.keycloak.org/securing-apps/token-exchange)
- [Keycloak GitHub - Kerberos Example](https://github.com/keycloak/keycloak/blob/95967b9c79ed94750d9b4cb10f0a6a9a64c44501/examples/kerberos/README.md)
- [Stack Overflow: Keycloak GSS Credential Delegation](https://stackoverflow.com/questions/53657083/keycloak-gss-credential-delegation-when-browser-not-in-ad-domain)
- [Medium: Kerberos Integration with Keycloak](https://medium.com/@rishabhsvats/red-hat-single-sign-on-integration-with-kerberos-user-federation-f9c9e757ace)
- [MCP-OAuth: KERBEROS-SOLUTION-ANALYSIS.md](./KERBEROS-SOLUTION-ANALYSIS.md)

---

**Last Updated:** 2025-01-08
**Research Status:** ✅ Complete
**Conclusion:** Keycloak CANNOT perform S4U2Self. Use Windows Service approach (KERBEROS-SOLUTION-ANALYSIS.md Option 1) or RunAs mode (Option 0).
