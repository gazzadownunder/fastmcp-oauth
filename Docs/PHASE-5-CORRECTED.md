# Phase 5 Corrected: MCP OAuth 2.1 Compliance

**Date:** 2025-01-10
**Status:** ⚠️ CORRECTED - Previous implementation violated MCP specification
**Corrected By:** Architecture Review

---

## Problem Statement

The original Phase 5 implementation (commit e568c82) **violates the MCP OAuth 2.1 specification** by implementing OAuth authorization endpoints on the MCP server itself.

### What Was Wrong

**Original Phase 5 (INCORRECT):**
- ❌ Implemented `/oauth/authorize` endpoint on MCP server
- ❌ Implemented `/oauth/callback` endpoint on MCP server
- ❌ MCP server acting as OAuth authorization proxy
- ❌ OAuth session management on stateless MCP server
- ❌ Authorization code exchange handled by MCP server

**Why This Violates MCP Spec:**

Per the official MCP specification (https://modelcontextprotocol.io/specification/draft/basic/authorization):

> "A protected MCP server acts as an OAuth 2.1 resource server, capable of accepting and responding to protected resource requests using access tokens."

**Key Requirements:**
1. **MCP servers MUST act as Resource Servers ONLY** - They validate tokens, not issue them
2. **MCP servers MUST NOT implement authorization endpoints** - `/authorize` and `/callback` belong to the IDP
3. **MCP servers MUST remain stateless** - No OAuth session management
4. **MCP servers MUST advertise OAuth metadata** - Point to external authorization server

---

## Correct Architecture Per MCP Specification

### OAuth 2.1 Flow (MCP-Compliant)

```
┌──────────────┐                                    ┌──────────────────┐
│              │  1. GET /authorize?               │                  │
│              │     response_type=code            │                  │
│  MCP Client  │────────────────────────────────▶  │  Authorization   │
│              │     + PKCE challenge              │  Server (IDP)    │
│              │                                    │                  │
└──────────────┘                                    └──────────────────┘
       │                                                     │
       │  2. User authenticates                             │
       │     at IDP                                         │
       │                                                     │
       │  3. Redirect to client's callback                  │
       │     with authorization code                        │
       │◀────────────────────────────────────────────────────┘
       │
       │                                            ┌──────────────────┐
       │  4. POST /token                           │                  │
       │     grant_type=authorization_code         │                  │
       │────────────────────────────────────────▶  │  Authorization   │
       │     + code + PKCE verifier                │  Server (IDP)    │
       │                                            │                  │
       │  5. Returns access_token                  │                  │
       │◀────────────────────────────────────────  └──────────────────┘
       │
       │                                            ┌──────────────────┐
       │  6. MCP request                           │                  │
       │     Authorization: Bearer <token>         │                  │
       │────────────────────────────────────────▶  │   MCP Server     │
       │                                            │  (Resource       │
       │  7. Validates token & responds            │   Server)        │
       │◀────────────────────────────────────────  │                  │
       │                                            └──────────────────┘
```

**CRITICAL:** MCP Server NEVER handles `/authorize` or `/callback`. These are IDP endpoints.

---

## Revised Phase 5 Requirements (MCP-Compliant)

### Goal

Ensure MCP server correctly implements OAuth 2.1 **Resource Server** role with proper metadata advertisement.

### Deliverables

| # | Task | MCP Spec Reference |
|---|------|-------------------|
| 5.1 | Implement OAuth 2.0 Protected Resource Metadata (RFC9728) | MUST per MCP spec |
| 5.2 | Advertise authorization server location via WWW-Authenticate header | MUST per MCP spec |
| 5.3 | Implement well-known URI endpoint for OAuth metadata | SHOULD per MCP spec |
| 5.4 | Validate token audience binding (intended for this MCP server) | MUST per OAuth 2.1 Section 5.2 |
| 5.5 | Return HTTP 401 with WWW-Authenticate for invalid/expired tokens | MUST per MCP spec |
| 5.6 | Support PKCE validation (if server issues tokens - NOT APPLICABLE) | N/A - MCP servers don't issue tokens |
| 5.7 | Document OAuth configuration for MCP clients | Required for usability |
| 5.8 | Add OAuth metadata to FastMCP server initialization | Implementation requirement |

### What MCP Server MUST Provide

#### 1. OAuth Metadata Endpoint

**GET /.well-known/oauth-protected-resource**

```json
{
  "resource": "https://mcp-server.example.com",
  "authorization_servers": [
    "https://auth.example.com"
  ],
  "bearer_methods_supported": [
    "header"
  ],
  "resource_documentation": "https://mcp-server.example.com/docs",
  "resource_signing_alg_values_supported": [
    "RS256",
    "ES256"
  ]
}
```

#### 2. WWW-Authenticate Header on 401

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="MCP Server",
                  authorization_server="https://auth.example.com",
                  scope="mcp:read mcp:write"
```

#### 3. Token Validation (Existing - Already Implemented)

- ✅ Validate JWT signature using JWKS from IDP
- ✅ Validate `iss` (issuer) claim matches trusted IDP
- ✅ Validate `aud` (audience) claim includes this MCP server
- ✅ Validate `exp` (expiration) and `nbf` (not before)
- ✅ Extract user claims (sub, roles, permissions)

---

## What Needs to Be Removed

The following components from commit e568c82 **violate MCP spec** and must be removed:

### ❌ Files to Remove

1. **src/oauth/redirect-flow.ts** - MCP servers don't handle OAuth redirect flow
2. **src/mcp/tools/oauth-authorize.ts** - MCP tools can't initiate OAuth flows
3. **src/mcp/tools/oauth-callback.ts** - MCP servers don't handle OAuth callbacks
4. **src/mcp/oauth-http-handler.ts** - No HTTP endpoints for OAuth on MCP server
5. **tests/unit/oauth/redirect-flow.test.ts** - Tests invalid functionality
6. **tests/unit/oauth/pkce-security.test.ts** - PKCE validation is IDP's responsibility

### ❌ Configuration to Remove

```typescript
// REMOVE from config schema
oauthRedirect: {
  enabled: boolean;
  authorizeEndpoint: string;  // ❌ Not MCP server's responsibility
  tokenEndpoint: string;       // ❌ Not MCP server's responsibility
  redirectUris: string[];      // ❌ Not MCP server's responsibility
  // ... all OAuth redirect config
}
```

---

## What Needs to Be Added

### ✅ OAuth Metadata Support

#### 1. Protected Resource Metadata

**src/mcp/oauth-metadata.ts** (NEW FILE)

```typescript
import type { CoreContext } from '../core/types.js';

export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  bearer_methods_supported: string[];
  resource_signing_alg_values_supported: string[];
  scopes_supported?: string[];
}

export function generateProtectedResourceMetadata(
  coreContext: CoreContext,
  serverUrl: string
): ProtectedResourceMetadata {
  const authConfig = coreContext.configManager.getAuthConfig();

  return {
    resource: serverUrl,
    authorization_servers: authConfig.trustedIDPs.map(idp => idp.issuer),
    bearer_methods_supported: ['header'],
    resource_signing_alg_values_supported: ['RS256', 'ES256'],
    scopes_supported: ['mcp:read', 'mcp:write', 'mcp:admin'],
  };
}
```

#### 2. Well-Known Endpoint

**src/mcp/metadata-handler.ts** (NEW FILE)

```typescript
export function setupMetadataRoutes(app: any, coreContext: CoreContext, serverUrl: string): void {
  // OAuth Protected Resource Metadata (RFC9728)
  app.get('/.well-known/oauth-protected-resource', (req, res) => {
    const metadata = generateProtectedResourceMetadata(coreContext, serverUrl);
    res.json(metadata);
  });
}
```

#### 3. Enhanced 401 Response

**src/mcp/middleware.ts** (MODIFY)

```typescript
// When JWT validation fails
if (!session) {
  // Add WWW-Authenticate header per MCP spec
  const authConfig = coreContext.configManager.getAuthConfig();
  const authServer = authConfig.trustedIDPs[0]?.issuer;

  res.setHeader(
    'WWW-Authenticate',
    `Bearer realm="MCP Server", authorization_server="${authServer}", scope="mcp:read mcp:write"`
  );

  return res.status(401).json({
    error: 'unauthorized',
    error_description: 'Valid bearer token required'
  });
}
```

---

## Client-Side Implementation (Out of Scope)

**NOTE:** OAuth authorization flow is **client responsibility**, not server responsibility.

### Example: MCP Client OAuth Flow

```typescript
// This code runs in the MCP CLIENT, not the MCP server
class MCPClientWithOAuth {
  async authenticate() {
    // 1. Get authorization server from MCP server metadata
    const metadata = await fetch('https://mcp-server.example.com/.well-known/oauth-protected-resource');
    const authServer = metadata.authorization_servers[0];

    // 2. Initiate OAuth flow with IDP
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);

    const authUrl = `${authServer}/authorize?` +
      `response_type=code&` +
      `client_id=mcp-client&` +
      `redirect_uri=${encodeURIComponent(this.redirectUri)}&` +
      `code_challenge=${codeChallenge}&` +
      `code_challenge_method=S256&` +
      `scope=mcp:read mcp:write`;

    // 3. Redirect user to IDP
    window.location.href = authUrl;

    // 4. Handle callback (in client's callback handler)
    // POST to IDP token endpoint with code + verifier

    // 5. Use access token with MCP requests
    const mcpResponse = await fetch('https://mcp-server.example.com/mcp', {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
  }
}
```

---

## Migration Plan

### Phase 1: Remove Non-Compliant Code

1. ❌ Remove `src/oauth/redirect-flow.ts`
2. ❌ Remove `src/mcp/tools/oauth-authorize.ts`
3. ❌ Remove `src/mcp/tools/oauth-callback.ts`
4. ❌ Remove `src/mcp/oauth-http-handler.ts`
5. ❌ Remove OAuth redirect tests
6. ❌ Remove OAuth redirect config schema

### Phase 2: Add MCP-Compliant Metadata

1. ✅ Create `src/mcp/oauth-metadata.ts`
2. ✅ Create `src/mcp/metadata-handler.ts`
3. ✅ Modify `src/mcp/middleware.ts` to add WWW-Authenticate header
4. ✅ Add metadata endpoint to MCPOAuthServer
5. ✅ Add tests for metadata generation

### Phase 3: Update Documentation

1. ✅ Update CLAUDE.md to reflect correct OAuth architecture
2. ✅ Update unified-oauth-progress.md to mark Phase 5 as corrected
3. ✅ Create client implementation guide
4. ✅ Update test harness configuration

### Phase 4: Revert Commit e568c82

```bash
# Revert the non-compliant Phase 5 implementation
git revert e568c82

# Commit corrected implementation
git commit -m "fix(oauth): Implement MCP-compliant OAuth 2.1 resource server role (Phase 5 corrected)

BREAKING CHANGE: Removed OAuth redirect endpoints from MCP server

The previous implementation violated MCP OAuth 2.1 specification by
implementing authorization endpoints on the MCP server itself.

MCP servers MUST act as OAuth 2.1 Resource Servers ONLY, validating
tokens issued by external authorization servers.

Changes:
- Remove /oauth/authorize endpoint (not MCP server's responsibility)
- Remove /oauth/callback endpoint (not MCP server's responsibility)
- Remove OAuthRedirectFlow class (clients handle OAuth flow)
- Remove oauth-authorize and oauth-callback MCP tools
- Add OAuth Protected Resource Metadata (RFC9728)
- Add /.well-known/oauth-protected-resource endpoint
- Add WWW-Authenticate header on 401 responses
- Update documentation with correct OAuth architecture

Spec Reference: https://modelcontextprotocol.io/specification/draft/basic/authorization

🤖 Generated with Claude Code
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Acceptance Criteria (Revised)

| # | Criterion | Status |
|---|-----------|--------|
| AC-1 | MCP server exposes /.well-known/oauth-protected-resource endpoint | ⬜ Pending |
| AC-2 | MCP server returns 401 with WWW-Authenticate header for invalid tokens | ⬜ Pending |
| AC-3 | MCP server validates token audience binding | ✅ Already implemented |
| AC-4 | MCP server does NOT implement /oauth/authorize endpoint | ⬜ Pending removal |
| AC-5 | MCP server does NOT implement /oauth/callback endpoint | ⬜ Pending removal |
| AC-6 | MCP server remains stateless (no OAuth sessions) | ⬜ Pending removal |
| AC-7 | OAuth metadata includes authorization_servers array | ⬜ Pending |
| AC-8 | Client documentation explains OAuth flow (external to MCP server) | ⬜ Pending |

---

## References

1. **MCP Authorization Specification**: https://modelcontextprotocol.io/specification/draft/basic/authorization
2. **RFC 9728 - OAuth 2.0 Protected Resource Metadata**: https://datatracker.ietf.org/doc/html/rfc9728
3. **RFC 8414 - OAuth 2.0 Authorization Server Metadata**: https://datatracker.ietf.org/doc/html/rfc8414
4. **OAuth 2.1 Draft**: https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-11

---

## Summary

**Original Phase 5 Status:** ✅ Completed (but non-compliant)
**Corrected Phase 5 Status:** ⬜ Requires rework
**Git Commit to Revert:** e568c82
**Compliance Issue:** MCP servers MUST NOT implement OAuth authorization endpoints

The MCP specification is clear: **MCP servers are OAuth 2.1 Resource Servers**, not authorization servers or authorization proxies. They validate tokens issued by external IDPs, they don't participate in the OAuth authorization code flow.
