# MCP OAuth Flow Clarification

## The Confusion: Authorization Code vs SSO Redirect

You asked an excellent question: **"When most MCP servers use SSO redirection and not the code method"**

The answer is: **They ARE the same thing!**

## Understanding the Terminology

### "Authorization Code Flow" = "SSO Redirect"

These terms refer to the **SAME** OAuth 2.1 flow:

1. **Authorization Code Flow** (OAuth 2.1 technical term)
2. **SSO Redirect** (user-facing description)
3. **Browser-based redirect** (implementation description)

All three describe the same pattern:
```
Client → Redirect to IDP → User authenticates → Redirect back with code → Exchange code for token
```

### What We've Implemented

Our mcp-client has **THREE variants** of the same authorization code flow:

| Method | Technical Name | User-Facing Name | Difference |
|--------|---------------|------------------|------------|
| Method 2 | Authorization Code + PKCE | SSO Redirect | Full parameters (7-9) |
| Method 3 | Authorization Code + PKCE + Discovery | MCP OAuth Discovery | Discovers auth endpoint first |
| Method 4 | Authorization Code + PKCE (minimal) | Inspector-Style | Minimal parameters (5) |

**All three use the SAME flow**: redirect to IDP, authenticate, redirect back, exchange code for token.

## MCP Specification Requirements

### What MCP Requires

From the MCP Authorization Specification (2025-06-18):

1. **OAuth Flow**: Authorization Code Flow with PKCE
2. **Server Role**: MCP servers are **Resource Servers ONLY**
3. **Token Issuance**: External Authorization Servers issue tokens
4. **Client Flow**:
   - Client requests protected resource
   - Server returns 401 with Protected Resource Metadata (PRM)
   - Client discovers Authorization Server
   - Client performs **OAuth 2.1 Authorization Code flow with PKCE**
   - Client obtains access token
   - Client retries request with token

### Key Quote from Specification

> "Client initiates an OAuth 2.1 Authorization Code flow with PKCE"

This IS the "SSO redirect" flow!

## The MCP Standard Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    MCP Standard OAuth Flow                       │
│                                                                   │
│  1. MCP Client → MCP Server                                     │
│     Request: tools/list (no auth)                               │
│                                                                   │
│  2. MCP Server → MCP Client                                     │
│     Response: HTTP 401 Unauthorized                             │
│     Header: WWW-Authenticate with PRM link                      │
│                                                                   │
│  3. MCP Client fetches PRM                                      │
│     GET /.well-known/oauth-protected-resource                   │
│     Discovers: authorization_servers, scopes_supported          │
│                                                                   │
│  4. MCP Client discovers Auth Server metadata                   │
│     GET /.well-known/oauth-authorization-server                 │
│     Discovers: authorization_endpoint, token_endpoint           │
│                                                                   │
│  5. MCP Client → Authorization Server                           │
│     REDIRECT to authorization_endpoint                          │
│     Parameters:                                                  │
│       - response_type=code                                      │
│       - client_id=mcp-client                                    │
│       - redirect_uri=http://client/callback                     │
│       - code_challenge=...                                      │
│       - code_challenge_method=S256                              │
│       - resource=https://mcp-server.com (MCP-specific)          │
│       - scope=mcp:read mcp:write                                │
│                                                                   │
│  6. User authenticates at Authorization Server (SSO)            │
│                                                                   │
│  7. Authorization Server → MCP Client                           │
│     REDIRECT to redirect_uri with authorization code            │
│                                                                   │
│  8. MCP Client → Authorization Server                           │
│     POST /token                                                  │
│     Parameters:                                                  │
│       - grant_type=authorization_code                           │
│       - code=...                                                 │
│       - redirect_uri=...                                        │
│       - client_id=...                                            │
│       - code_verifier=... (PKCE)                                │
│       - resource=https://mcp-server.com (MCP-specific)          │
│                                                                   │
│  9. Authorization Server → MCP Client                           │
│     Response: access_token, refresh_token                       │
│                                                                   │
│ 10. MCP Client → MCP Server                                     │
│     Request: tools/list                                         │
│     Header: Authorization: Bearer <access_token>                │
│                                                                   │
│ 11. MCP Server validates token and responds                     │
└─────────────────────────────────────────────────────────────────┘
```

**Step 5-7 is what users call "SSO Redirect"**
**Step 8-9 is the "code exchange" or "token exchange"**
**Together they form the "Authorization Code Flow"**

## What Makes Inspector-Style Different

Inspector-style is **NOT a different flow** - it's the **SAME authorization code flow** with:

### Minimal Parameters

**Standard OAuth Authorization Request** (7-9 parameters):
```
response_type=code
client_id=mcp-oauth
redirect_uri=http://localhost:3001/
code_challenge=...
code_challenge_method=S256
scope=openid email profile
state=abc123
resource=https://mcp-server.com
```

**Inspector-Style Authorization Request** (5-6 parameters):
```
response_type=code
client_id=mcp-oauth
redirect_uri=http://localhost:3001/
code_challenge=...
code_challenge_method=S256
resource=https://mcp-server.com (MCP-specific)
```

**Omitted:**
- ❌ `scope` - Uses IDP defaults
- ❌ `state` - PKCE provides CSRF protection

### Public Client (No client_secret)

**Standard OAuth Token Exchange** (confidential client):
```
grant_type=authorization_code
code=...
redirect_uri=...
client_id=...
client_secret=...          ← Confidential client
code_verifier=...
resource=...
```

**Inspector-Style Token Exchange** (public client):
```
grant_type=authorization_code
code=...
redirect_uri=...
client_id=...
code_verifier=...          ← PKCE replaces client_secret
resource=...
```

**Omitted:**
- ❌ `client_secret` - Public client (browser-based)

## Why "Inspector-Style" Exists

MCP Inspector is a **browser-based development tool** (public client), so it:
1. Cannot securely store client_secret (JavaScript is visible)
2. Uses minimal parameters (simplicity for developers)
3. Relies on PKCE for security (instead of client_secret)

This is **OAuth 2.1 compliant** for public clients.

## Comparison: All Four Methods

| Method | Flow Type | Redirect? | Parameters | client_secret | Use Case |
|--------|-----------|-----------|------------|---------------|----------|
| 1. Password Grant | Password | ❌ No | 6 | ✅ Yes | Testing only |
| 2. SSO Redirect | Auth Code + PKCE | ✅ Yes | 7-9 | ✅ Yes | Production (confidential) |
| 3. MCP OAuth Discovery | Auth Code + PKCE | ✅ Yes | 7-9 | ✅ Yes | MCP standard flow |
| 4. Inspector-Style | Auth Code + PKCE | ✅ Yes | 5-6 | ❌ No | Browser-based (public) |

**Methods 2, 3, and 4 ALL use "SSO redirect" (authorization code flow)**

The differences are:
- Discovery (method 3 discovers endpoints first)
- Parameters (method 4 uses minimal parameters)
- Client type (method 4 is public, others are confidential)

## MCP Specification Compliance

### Required by MCP Spec

✅ **Authorization Code Flow** - All methods 2, 3, 4 use this
✅ **PKCE (S256)** - All methods 2, 3, 4 use this
✅ **Resource parameter** - Should add to all methods
✅ **Discovery (PRM)** - Method 3 implements this
✅ **External Auth Server** - Keycloak is external

### Our Implementation

| Requirement | Method 2 | Method 3 | Method 4 | Status |
|-------------|----------|----------|----------|--------|
| Authorization Code Flow | ✅ | ✅ | ✅ | Compliant |
| PKCE (S256) | ✅ | ✅ | ✅ | Compliant |
| OAuth Discovery | ❌ | ✅ | ❌ | Method 3 only |
| Resource parameter | ❌ | ❌ | ❌ | **TODO** |
| Public client support | ❌ | ❌ | ✅ | Method 4 only |

## What Needs to Be Added: Resource Parameter

### MCP-Specific Requirement

From MCP spec:
> "MCP clients MUST include the resource parameter in authorization and token requests"

This is **RFC 8707 - Resource Indicators**.

### What is the Resource Parameter?

Identifies which MCP server the token is for:

```
Authorization Request:
  resource=https://mcp-server.example.com

Token Exchange:
  resource=https://mcp-server.example.com
```

### Why It's Important

Prevents token misuse:
- Token is bound to specific MCP server
- Cannot use token for different MCP server
- Authorization server validates resource ownership

### Implementation Status

❌ **Not currently implemented** in any of our methods

Should add to:
- Method 2 (SSO Redirect)
- Method 3 (MCP OAuth Discovery)
- Method 4 (Inspector-Style)

## Conclusion

### Your Question Answered

> "Most MCP servers use SSO redirection and not the code method"

**Answer:** SSO redirect **IS** the authorization code method!

- "SSO redirect" = user-facing term
- "Authorization code flow" = technical OAuth term
- They describe the same thing

### Inspector-Style is Standard-Compliant

Inspector-style authentication:
- ✅ Uses authorization code flow (SSO redirect)
- ✅ Uses PKCE (S256)
- ✅ OAuth 2.1 compliant for public clients
- ✅ Same flow as MCP Inspector tool
- ⚠️ Missing `resource` parameter (should add)

### What Makes it "Inspector-Style"

1. **Public client** (no client_secret)
2. **Minimal parameters** (5-6 instead of 7-9)
3. **Browser-based** (PKCE for security)

But it's still the **same authorization code flow with SSO redirect** that MCP requires!

### Next Steps

1. ✅ Implementation is correct
2. ⚠️ Add `resource` parameter for full MCP compliance
3. ⚠️ Configure Keycloak as public client
4. ✅ All methods use standard OAuth authorization code flow

## References

- [MCP Authorization Specification](https://modelcontextprotocol.io/specification/draft/basic/authorization)
- [OAuth 2.1 Draft](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-11)
- [RFC 8707 - Resource Indicators](https://datatracker.ietf.org/doc/html/rfc8707)
- [RFC 7636 - PKCE](https://datatracker.ietf.org/doc/html/rfc7636)
