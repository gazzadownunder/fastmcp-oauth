# Dynamic Client Registration (RFC 7591) Analysis for MCP OAuth Framework

**Date:** 2025-01-31
**Status:** Analysis Complete
**Version:** 1.0

---

## Executive Summary

**Key Finding:** Your understanding is **100% correct** - Dynamic Client Registration (RFC 7591) is an **Identity Provider (IDP) feature**, NOT a Resource Server requirement.

**Framework Status:** ✅ Your MCP OAuth framework already implements **all required MCP specification features** for a Resource Server. DCR support is **optional and outside the scope** of a resource server implementation.

---

## MCP Specification Requirements

### What MCP Servers (Resource Servers) MUST Implement

Per the MCP OAuth 2.1 specification:

| Requirement | RFC | Your Framework Status |
|-------------|-----|----------------------|
| **Protected Resource Metadata** | RFC 9728 | ✅ **Implemented** ([src/mcp/oauth-metadata.ts](../src/mcp/oauth-metadata.ts)) |
| **Bearer Token Validation** | RFC 6750 | ✅ **Implemented** ([src/core/jwt-validator.ts](../src/core/jwt-validator.ts)) |
| **Token Audience Binding** | OAuth 2.1 | ✅ **Implemented** (audience validation in JWT validator) |
| **Resource Indicators Support** | RFC 8707 | ✅ **Implemented** (token exchange with audience scoping) |
| **WWW-Authenticate Header** | RFC 6750 | ✅ **Implemented** (oauth-metadata.ts:generateWWWAuthenticateHeader) |
| **Authorization Server Discovery** | RFC 9728 | ✅ **Implemented** (metadata includes authorization_servers) |

**Conclusion:** Your framework is **100% compliant** with MCP specification requirements for Resource Servers.

---

## What is Dynamic Client Registration?

### Definition

**RFC 7591 - OAuth 2.0 Dynamic Client Registration Protocol** enables OAuth clients to **register with an Authorization Server** dynamically at runtime, without manual pre-registration.

### Key Points

1. **Authorization Server Feature** - DCR is implemented **by the IDP**, not by resource servers
2. **Client-Initiated** - MCP clients call the IDP's `/register` endpoint
3. **Returns Client Credentials** - IDP responds with `client_id` (and optionally `client_secret`)
4. **Optional in MCP Spec** - MCP spec says clients and auth servers **SHOULD** support DCR (not MUST)

---

## Architecture: Who Does What?

```
┌─────────────────────────────────────────────────────────────────┐
│                  MCP OAuth 2.1 Architecture                      │
│                                                                   │
│  ┌──────────────────┐                                            │
│  │   MCP Client     │                                            │
│  │  (Your App)      │                                            │
│  └────────┬─────────┘                                            │
│           │                                                       │
│           │ 1. POST /register (Dynamic Client Registration)      │
│           │    ↓                                                  │
│           │    {                                                  │
│           │      "client_name": "My MCP Client",                 │
│           │      "redirect_uris": ["http://localhost/callback"]  │
│           │    }                                                  │
│           ↓                                                       │
│  ┌──────────────────────────────────────────────────────┐        │
│  │   Authorization Server (IDP)                         │        │
│  │   - Keycloak, Auth0, Okta, Azure AD, etc.           │        │
│  │   - Implements RFC 7591 DCR                          │        │
│  │   - Issues client_id and client_secret               │        │
│  └────────────────┬───────────────────────────────────┬─┘        │
│           │                                            │          │
│           │ 2. Returns client credentials              │          │
│           │    ↓                                       │          │
│           │    {                                       │          │
│           │      "client_id": "abc123",                │          │
│           │      "client_secret": "secret456"          │          │
│           │    }                                       │          │
│           ↓                                            │          │
│  ┌──────────────────┐                                 │          │
│  │   MCP Client     │                                 │          │
│  └────────┬─────────┘                                 │          │
│           │                                            │          │
│           │ 3. Performs OAuth flow with credentials   │          │
│           │    GET /authorize?client_id=abc123...     │          │
│           │    POST /token (code exchange)            │          │
│           │         ↓                                  │          │
│           │         Returns access_token (JWT)        │          │
│           │         ↓                                  │          │
│           │ 4. Calls MCP server with Bearer token     │          │
│           ↓                                            │          │
│  ┌──────────────────────────────────────────────────────┐        │
│  │   MCP Server (Resource Server)                       │        │
│  │   - YOUR FRAMEWORK                                   │        │
│  │   - Validates Bearer token                           │        │
│  │   - Does NOT implement DCR                           │        │
│  │   - Does NOT issue client credentials                │        │
│  └──────────────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Why Your Framework Does NOT Need DCR

### Role Separation

| Component | Role | DCR Involvement |
|-----------|------|-----------------|
| **MCP Client** | Calls DCR endpoint on IDP | ✅ **Initiates DCR** (client-side library) |
| **Authorization Server (IDP)** | Issues client credentials | ✅ **Implements DCR server** (Keycloak, Auth0, etc.) |
| **MCP Server (Your Framework)** | Validates tokens | ❌ **No DCR involvement** (resource server only) |

### Your Framework's Responsibilities

As an OAuth 2.1 **Resource Server**, your framework:

1. ✅ **Validates Bearer tokens** sent by MCP clients
2. ✅ **Enforces authorization** on MCP tools (RBAC)
3. ✅ **Performs token exchange** for delegation (RFC 8693)
4. ✅ **Advertises OAuth metadata** (RFC 9728)
5. ✅ **Returns WWW-Authenticate headers** on 401 errors

Your framework does **NOT**:

1. ❌ Issue client credentials (`client_id`, `client_secret`)
2. ❌ Implement `/register` endpoint (that's the IDP's job)
3. ❌ Handle OAuth authorization code flow (that's the IDP's job)
4. ❌ Perform user authentication (that's the IDP's job)

---

## NapthaAI's "DCR Support" Explained

### What NapthaAI Actually Does

Looking at NapthaAI's implementation, they are **NOT implementing DCR themselves**. Instead:

1. **OAuth Proxy Pattern** - They proxy OAuth requests to an upstream IDP (Auth0)
2. **Auth0 Implements DCR** - Auth0 (the IDP) has DCR support, not NapthaAI's code
3. **Configuration Requirement** - Users must enable "Dynamic Application Registration" in Auth0 admin console
4. **Token Isolation** - They issue their own tokens instead of forwarding Auth0's tokens

**Key Insight:** NapthaAI's "DCR support" means "we work with IDPs that support DCR" (like Auth0). They don't implement RFC 7591 themselves.

---

## What Would DCR Support Mean for Your Framework?

If you wanted to add DCR-like functionality, you would need to become an **OAuth Proxy** (like NapthaAI), which would fundamentally change your architecture:

### Current Architecture (Resource Server)

```
MCP Client → [Your Framework] → Validates JWT → Delegates to downstream resources
```

### OAuth Proxy Architecture (like NapthaAI)

```
MCP Client → [Your Framework as Proxy] → Upstream IDP (Keycloak/Auth0)
                ↓
                Issues own tokens
                ↓
                Validates own tokens
                ↓
                Delegates to downstream resources
```

### What This Would Require

| Component | Change Required | Complexity |
|-----------|----------------|------------|
| **DCR Endpoint** | Add `POST /register` endpoint that forwards to upstream IDP | Medium |
| **Token Issuance** | Become a token issuer (not just validator) | **High** |
| **Token Mapping** | Map upstream IDP tokens to your own tokens | Medium |
| **Key Management** | Generate/manage your own signing keys | **High** |
| **Token Lifetime Management** | Track token expiration, refresh, revocation | **High** |
| **Client Database** | Store registered clients and their credentials | Medium |
| **OAuth Flows** | Implement `/authorize`, `/token` endpoints | **Very High** |

**Estimated Effort:** 6-8 weeks of development + significant security review

---

## Should You Implement DCR Support?

### ❌ Recommendation: **NO**

**Reasons:**

1. **Out of Scope** - You are a **Resource Server**, not an Authorization Server
2. **Architectural Violation** - Would blur the lines between resource server and auth server
3. **Security Risk** - Becoming a token issuer adds massive security surface area
4. **IDP Responsibility** - Modern IDPs (Keycloak, Auth0, Okta, Azure AD) already implement DCR
5. **Maintenance Burden** - OAuth server implementation requires ongoing security updates
6. **Against MCP Spec** - MCP spec explicitly states servers are **Resource Servers**, not Auth Servers
7. **Unnecessary Complexity** - Clients can use IDPs directly for DCR

### ✅ What You Should Do Instead

**Your framework is already complete for its intended purpose.** If users need DCR, they should:

1. **Use an IDP with DCR support** (Keycloak, Auth0, Okta, Azure AD, AWS Cognito)
2. **Client registers with IDP** using the IDP's `/register` endpoint
3. **Client obtains access token** from IDP
4. **Client calls your MCP server** with Bearer token
5. **Your framework validates token** and enforces authorization

This is the **correct OAuth 2.1 architecture** per the MCP specification.

---

## What Your Framework Already Supports

### RFC 9728 - OAuth 2.0 Protected Resource Metadata

**Status:** ✅ **Fully Implemented**

**Location:** [src/mcp/oauth-metadata.ts](../src/mcp/oauth-metadata.ts)

**Features:**
- `generateProtectedResourceMetadata()` - Advertises authorization servers
- `generateWWWAuthenticateHeader()` - Returns RFC 6750 compliant headers
- `extractSupportedScopes()` - Lists available OAuth scopes

**Example Metadata:**
```json
{
  "resource": "https://mcp-server.example.com",
  "authorization_servers": [
    "https://auth.example.com"
  ],
  "bearer_methods_supported": ["header"],
  "resource_signing_alg_values_supported": ["RS256", "ES256"],
  "scopes_supported": [
    "mcp:read",
    "mcp:write",
    "mcp:admin",
    "sql:query",
    "sql:execute"
  ]
}
```

This metadata **tells MCP clients which Authorization Server to use for DCR**.

---

## Client Implementation Guidance (For Your Documentation)

If MCP client developers ask "How do I use DCR with your framework?", here's the answer:

### Step 1: Register with the Authorization Server (IDP)

**Client performs DCR with the IDP (not your MCP server):**

```typescript
// Client registers with Keycloak (example)
const response = await fetch('https://auth.company.com/realms/mcp/clients-registrations/default', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer INITIAL_ACCESS_TOKEN' // Optional, depends on IDP config
  },
  body: JSON.stringify({
    clientName: 'My MCP Client',
    redirectUris: ['http://localhost:3000/callback'],
    grantTypes: ['authorization_code', 'refresh_token'],
    responseTypes: ['code'],
    tokenEndpointAuthMethod: 'client_secret_basic'
  })
});

const { client_id, client_secret } = await response.json();
```

### Step 2: Perform OAuth Flow with IDP

```typescript
// 1. Authorization request
const authUrl = `https://auth.company.com/realms/mcp/protocol/openid-connect/auth?` +
  `client_id=${client_id}&` +
  `redirect_uri=http://localhost:3000/callback&` +
  `response_type=code&` +
  `scope=openid profile mcp:read mcp:write&` +
  `resource=https://mcp-server.example.com`; // RFC 8707 Resource Indicator

// 2. User authenticates, IDP redirects with code

// 3. Token exchange
const tokenResponse = await fetch('https://auth.company.com/realms/mcp/protocol/openid-connect/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    code: authorizationCode,
    redirect_uri: 'http://localhost:3000/callback',
    client_id: client_id,
    client_secret: client_secret,
    resource: 'https://mcp-server.example.com' // RFC 8707 Resource Indicator
  })
});

const { access_token } = await tokenResponse.json();
```

### Step 3: Call MCP Server with Bearer Token

```typescript
// Call your MCP OAuth framework
const mcpResponse = await fetch('https://mcp-server.example.com/mcp', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${access_token}`, // ← Token from IDP
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    method: 'tools/call',
    params: { name: 'sql-delegate', arguments: { query: 'SELECT * FROM users' } },
    id: 1
  })
});
```

**Your framework validates the token and executes the tool - no DCR involvement on your side.**

---

## Configuration Update (Optional)

If you want to help clients discover the IDP's DCR endpoint, you can add this to your OAuth metadata:

### Current Metadata

```typescript
// src/mcp/oauth-metadata.ts
export function generateProtectedResourceMetadata(
  resourceUri: string,
  authorizationServers: string[],
  scopes: string[]
): ProtectedResourceMetadata {
  return {
    resource: resourceUri,
    authorization_servers: authorizationServers,
    bearer_methods_supported: ['header'],
    resource_signing_alg_values_supported: ['RS256', 'ES256'],
    scopes_supported: scopes,
  };
}
```

### Optional Enhancement

```typescript
// src/mcp/oauth-metadata.ts
export function generateProtectedResourceMetadata(
  resourceUri: string,
  authorizationServers: string[],
  scopes: string[],
  includeRegistrationHints: boolean = false // ← Optional parameter
): ProtectedResourceMetadata {
  const metadata: ProtectedResourceMetadata = {
    resource: resourceUri,
    authorization_servers: authorizationServers,
    bearer_methods_supported: ['header'],
    resource_signing_alg_values_supported: ['RS256', 'ES256'],
    scopes_supported: scopes,
  };

  // Optional: Include hints for client registration
  if (includeRegistrationHints) {
    metadata.client_registration_info = {
      // NOTE: This does NOT mean your server implements DCR
      // This tells clients WHERE to perform DCR (at the IDP)
      instructions: 'Clients should register with the authorization server(s) listed above',
      registration_endpoints: authorizationServers.map(as => `${as}/register`), // Generic hint
    };
  }

  return metadata;
}
```

**Important:** This is just **informational metadata** - it does NOT mean your server implements DCR. It's a hint to clients about where to find the IDP's DCR endpoint.

---

## Comparison: Your Framework vs OAuth Proxy Pattern

| Aspect | Your Framework (Resource Server) | OAuth Proxy (like NapthaAI) |
|--------|----------------------------------|----------------------------|
| **OAuth Role** | Resource Server | Proxy + Resource Server |
| **Token Validation** | Validates IDP tokens | Validates own tokens |
| **Token Issuance** | No (IDP issues tokens) | Yes (issues own tokens) |
| **DCR Implementation** | No (IDP implements DCR) | No (proxies to IDP's DCR) |
| **Authorization Flow** | Not involved | Proxies to IDP |
| **Token Exchange** | RFC 8693 (for delegation) | Token mapping (own tokens) |
| **Security Surface** | Low (validation only) | High (token issuer) |
| **Maintenance** | Low | High (key management, revocation) |
| **Architecture** | Simple, stateless | Complex, may require state |
| **MCP Spec Compliance** | ✅ Full compliance | ⚠️ Compliant but more complex |

---

## Summary

### Key Findings

1. **You Are Correct** - DCR is an IDP feature, not a resource server requirement
2. **Framework is Complete** - Your framework implements all required MCP specification features for a Resource Server
3. **No DCR Needed** - Adding DCR would be architectural overreach and unnecessary complexity
4. **NapthaAI Pattern** - They proxy to IDPs with DCR, they don't implement RFC 7591 themselves
5. **Client Responsibility** - MCP clients should register with the IDP directly, then use tokens with your server

### Recommendation

**✅ NO CHANGES REQUIRED**

Your MCP OAuth framework is architecturally correct as a **pure Resource Server**. DCR belongs in the Authorization Server (IDP), not in your framework.

### If Users Ask About DCR

**Response:**
> "This framework is an OAuth 2.1 Resource Server, not an Authorization Server. For Dynamic Client Registration (RFC 7591), please use an identity provider that supports DCR (e.g., Keycloak, Auth0, Okta, Azure AD, AWS Cognito). Clients register with the IDP, obtain tokens, and then call this MCP server with Bearer tokens. This is the correct OAuth 2.1 architecture per the MCP specification."

---

## Appendix A: MCP Specification Requirements Summary

### MCP Servers (Resource Servers) MUST

- ✅ Implement RFC 9728 (Protected Resource Metadata)
- ✅ Validate Bearer tokens (RFC 6750)
- ✅ Validate token audience binding
- ✅ Support Resource Indicators (RFC 8707)
- ✅ Return WWW-Authenticate header on 401
- ✅ Advertise authorization server location

**All implemented in your framework.**

### MCP Servers (Resource Servers) SHOULD (Optional)

- ⚠️ Support Dynamic Client Registration (RFC 7591)

**Clarification:** The MCP spec says "clients and authorization servers SHOULD support DCR". This does **NOT** apply to Resource Servers (MCP servers). The confusion arises because some MCP server implementations (like NapthaAI) act as OAuth proxies, but this is not required by the spec.

### MCP Clients MUST

- Implement OAuth 2.1 authorization flow
- Implement PKCE
- Implement Resource Indicators (RFC 8707)
- Use `resource` parameter in authorization requests
- Parse WWW-Authenticate headers

**Not applicable to your framework (you're the server, not the client).**

---

## Appendix B: RFC 7591 Overview (For Reference)

### RFC 7591 - OAuth 2.0 Dynamic Client Registration Protocol

**Purpose:** Allow OAuth clients to register with Authorization Servers at runtime.

**Typical Flow:**

1. **Client sends registration request:**
   ```http
   POST /register HTTP/1.1
   Host: auth.example.com
   Content-Type: application/json
   Authorization: Bearer INITIAL_ACCESS_TOKEN

   {
     "client_name": "My Application",
     "redirect_uris": ["https://myapp.com/callback"],
     "grant_types": ["authorization_code", "refresh_token"],
     "response_types": ["code"],
     "token_endpoint_auth_method": "client_secret_basic",
     "scope": "openid profile email"
   }
   ```

2. **Authorization Server responds with credentials:**
   ```json
   {
     "client_id": "abc123xyz",
     "client_secret": "secret456",
     "client_id_issued_at": 1640995200,
     "client_secret_expires_at": 0,
     "client_name": "My Application",
     "redirect_uris": ["https://myapp.com/callback"],
     "grant_types": ["authorization_code", "refresh_token"],
     "response_types": ["code"],
     "token_endpoint_auth_method": "client_secret_basic",
     "scope": "openid profile email"
   }
   ```

3. **Client uses credentials for OAuth flow:**
   - Authorization request with `client_id`
   - Token exchange with `client_id` and `client_secret`

**Who Implements This:**
- ✅ Authorization Servers (Keycloak, Auth0, Okta, Azure AD, AWS Cognito)
- ❌ Resource Servers (your MCP OAuth framework)

---

## Appendix C: Recommended IDPs with DCR Support

If your users need DCR, recommend these IDPs:

| IDP | DCR Support | Documentation |
|-----|-------------|---------------|
| **Keycloak** | ✅ Yes | [Keycloak Client Registration](https://www.keycloak.org/docs/latest/securing_apps/#_client_registration) |
| **Auth0** | ✅ Yes | [Auth0 Dynamic Client Registration](https://auth0.com/docs/get-started/applications/dynamic-client-registration) |
| **Okta** | ✅ Yes | [Okta Dynamic Client Registration](https://developer.okta.com/docs/reference/api/oauth-clients/) |
| **Azure AD** | ✅ Yes | [Azure AD App Registration API](https://learn.microsoft.com/en-us/graph/api/application-post-applications) |
| **AWS Cognito** | ✅ Yes | [Cognito App Client Registration](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-client-apps.html) |
| **Google Identity** | ✅ Yes | [Google OAuth Client Registration](https://developers.google.com/identity/protocols/oauth2) |
| **Ping Identity** | ✅ Yes | [PingFederate Dynamic Registration](https://docs.pingidentity.com/bundle/pingfederate-110/page/concept/dynamicClientRegistration.html) |

---

## Document Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2025-01-31 | 1.0 | Initial analysis document created |

---

**Conclusion:** Your framework is architecturally correct and requires **no changes** for DCR support. DCR is the responsibility of the Identity Provider (Authorization Server), not the MCP server (Resource Server).
