# Forked Dependencies Summary

This project uses **two forked MCP libraries** from the `gazzadownunder` GitHub account to enable OAuth 2.1 authentication support.

## Overview

| Library | Purpose | Fork URL | Changes Required |
|---------|---------|----------|------------------|
| **fastmcp** | Core MCP framework | https://github.com/gazzadownunder/fastmcp | OAuth support on tool requests |
| **mcp-proxy** | HTTP stream transport | https://github.com/gazzadownunder/mcp-proxy | CORS + Stateless session fixes |

## FastMCP Fork (Core Framework)

### Repository Details
- **Original**: https://github.com/modelcontextprotocol/fastmcp
- **Fork**: https://github.com/gazzadownunder/fastmcp
- **Package.json**: `"fastmcp": "github:gazzadownunder/fastmcp#main"`

### Required Changes

The FastMCP fork needs OAuth authentication support added to tool execution:

#### 1. Bearer Token Extraction
- Extract `Authorization: Bearer <token>` header from incoming requests
- Pass token to authentication middleware
- Make token available in tool execution context

#### 2. User Session Context
- Create `UserSession` object from validated JWT claims
- Include in tool handler context parameter
- Allow tools to access authenticated user information

#### 3. Tool Handler Signature
Update tool handlers to receive session context:

```typescript
// Before (original)
async function myTool(params: ToolParams) {
  // No authentication context
}

// After (forked)
async function myTool(params: ToolParams, context: RequestContext) {
  const session = context.userSession; // Access authenticated user
  const userId = session?.userId;
  // Use authentication for authorization
}
```

#### 4. Integration Points

**Location**: Likely in `src/server/` or `src/tools/` directory

**Files to modify**:
- Request handler that receives MCP tool calls
- Tool registration/execution engine
- Context creation for tool invocation

**Example implementation**:
```typescript
// In request handler
const bearerToken = req.headers.authorization?.replace('Bearer ', '');

// Create context with authentication
const context: RequestContext = {
  userSession: await validateAndCreateSession(bearerToken),
  // ... other context properties
};

// Pass to tool handler
await toolHandler(params, context);
```

### Testing the Fork

After applying changes, test with:
```typescript
import { FastMCP } from 'fastmcp';

const server = new FastMCP({
  name: 'test-oauth',
  // ... config
});

server.addTool({
  name: 'test-auth',
  handler: async (params, context) => {
    // Should have context.userSession available
    console.log('User:', context.userSession?.userId);
  }
});
```

## MCP-Proxy Fork (HTTP Stream Transport)

### Repository Details
- **Original**: https://github.com/modelcontextprotocol/mcp-proxy
- **Fork**: https://github.com/gazzadownunder/mcp-proxy
- **Package.json**: `"mcp-proxy": "github:gazzadownunder/mcp-proxy#main"`

### Required Changes

The MCP-Proxy fork needs two critical fixes:

#### 1. CORS Headers Fix

**Location**: `src/httpStreamHandler.ts` (or similar)

**Find this code** (~line 170 in dist):
```typescript
res.setHeader("Access-Control-Allow-Headers", "*");
```

**Replace with**:
```typescript
res.setHeader("Access-Control-Allow-Headers",
  "Content-Type, Authorization, Accept, Mcp-Session-Id, Last-Event-Id");
```

**Why**: Wildcard `*` doesn't include `Authorization` header per CORS spec. Must be explicit.

#### 2. Stateless Session Support

**Location**: Session handling code (~lines 186-243 in dist)

**Find this pattern**:
```typescript
const sessionId = Array.isArray(req.headers["mcp-session-id"])
  ? req.headers["mcp-session-id"][0]
  : req.headers["mcp-session-id"];

if (sessionId && activeTransports[sessionId]) {
  // Use existing session
} else if (!sessionId && isInitializeRequest(body)) {
  // Create new session
} else {
  // ERROR: Bad Request
}
```

**Replace with stateless support**:
```typescript
const sessionId = Array.isArray(req.headers["mcp-session-id"])
  ? req.headers["mcp-session-id"][0]
  : req.headers["mcp-session-id"];

// Accept "stateless-session" as valid session ID for OAuth workflows
if (sessionId === "stateless-session") {
  if (!activeTransports["stateless-session"]) {
    // Create shared stateless transport
    const transport = new StreamableHTTPServerTransport({
      eventStore: eventStore || new InMemoryEventStore(),
      onsessioninitialized: (_sessionId) => {
        activeTransports["stateless-session"] = { server, transport };
      }
    });
    activeTransports["stateless-session"] = { server, transport };
  }
  // Reuse stateless transport for all requests
  transport = activeTransports["stateless-session"].transport;
  server = activeTransports["stateless-session"].server;
} else if (sessionId && activeTransports[sessionId]) {
  // Use existing session
} else if (!sessionId && isInitializeRequest(body)) {
  // Create new session
} else {
  // ERROR: Bad Request
}
```

**Why**: OAuth tokens contain authentication, not session IDs. Support stateless mode where all requests share one transport.

**Full implementation**: See [STATELESS-SESSION-FIX.md](STATELESS-SESSION-FIX.md) for complete code.

### Testing the Fork

After applying changes, verify:
```bash
# CORS headers include Authorization
curl -I http://localhost:3000/mcp \
  -H "Origin: http://localhost:8000" \
  -X OPTIONS

# Should show: Access-Control-Allow-Headers: Content-Type, Authorization, ...

# Stateless session works
curl http://localhost:3000/mcp \
  -H "Authorization: Bearer <token>" \
  -H "Mcp-Session-Id: stateless-session" \
  -d '{"jsonrpc":"2.0","method":"initialize",...}'

# Should NOT return "Bad Request: No valid session ID"
```

## Installation Instructions

### 1. Clean Install

```bash
# Remove old dependencies
rm -rf node_modules package-lock.json

# Install from forks
npm install
```

### 2. Verify Installation

```bash
# Check both forks are installed
npm list fastmcp
npm list mcp-proxy

# Should show:
# fastmcp@... github:gazzadownunder/fastmcp#<hash>
# mcp-proxy@... github:gazzadownunder/mcp-proxy#<hash>
```

### 3. Verify Fixes (After Fork Updates)

```bash
# Check mcp-proxy CORS fix
grep "Authorization" node_modules/mcp-proxy/dist/chunk-43AXMLZU.js

# Check mcp-proxy stateless session
grep "stateless-session" node_modules/mcp-proxy/dist/chunk-43AXMLZU.js
```

## Fork Maintenance

### Keeping Forks Updated

```bash
# In each fork repository
git remote add upstream https://github.com/modelcontextprotocol/<repo>.git
git fetch upstream
git merge upstream/main

# Reapply custom changes if needed
# ... apply OAuth changes ...

git push origin main
```

### Versioning Strategy

**Option 1: Use main branch** (current)
```json
"fastmcp": "github:gazzadownunder/fastmcp#main"
```
- ✅ Always get latest changes
- ⚠️ May break if upstream changes

**Option 2: Pin to commit**
```json
"fastmcp": "github:gazzadownunder/fastmcp#abc123def"
```
- ✅ Stable, reproducible
- ❌ Requires manual updates

**Option 3: Use tags** (recommended)
```json
"fastmcp": "github:gazzadownunder/fastmcp#v1.0.0-oauth"
```
- ✅ Semantic versioning
- ✅ Clear changelog
- ✅ Controlled updates

### Creating Tagged Releases

```bash
# In fork repository
git tag -a v1.27.7-oauth-1 -m "Add OAuth support to FastMCP

Changes:
- Bearer token extraction from Authorization header
- UserSession context in tool handlers
- OAuth authentication integration"

git push origin v1.27.7-oauth-1
```

Then update package.json:
```json
"fastmcp": "github:gazzadownunder/fastmcp#v1.27.7-oauth-1"
```

## Benefits of Forking

✅ **Persistence**: Changes survive `npm install`
✅ **Version Control**: Full Git history of modifications
✅ **Team Sharing**: Everyone gets same OAuth-enabled versions
✅ **Pull Requests**: Can contribute fixes back to upstream
✅ **Custom Features**: Add project-specific enhancements
✅ **No Patches**: No `patch-package` workarounds needed

## Upstream Contributions

Consider submitting OAuth features to upstream:

1. **FastMCP OAuth Support**
   - Create PR: https://github.com/modelcontextprotocol/fastmcp/pulls
   - Proposal: Add optional authentication context to tool handlers
   - Benefits: Standard OAuth pattern for all FastMCP users

2. **MCP-Proxy CORS Fix**
   - Create PR: https://github.com/modelcontextprotocol/mcp-proxy/pulls
   - Issue: CORS wildcard `*` doesn't include Authorization header
   - Fix: Explicit header list including Authorization

3. **MCP-Proxy Stateless Sessions**
   - Create PR: https://github.com/modelcontextprotocol/mcp-proxy/pulls
   - Feature: Support stateless-session mode for OAuth/JWT workflows
   - Benefits: Better OAuth integration, no session pinning

## Documentation

- **Fork Installation**: [FORK-INSTALLATION.md](../FORK-INSTALLATION.md)
- **MCP-Proxy Forking Guide**: [FORKING-MCP-PROXY.md](FORKING-MCP-PROXY.md)
- **CORS Fix Details**: [CORS-FIX-APPLIED.md](../CORS-FIX-APPLIED.md)
- **Stateless Session Fix**: [STATELESS-SESSION-FIX.md](../STATELESS-SESSION-FIX.md)
- **Complete Fix Summary**: [FINAL-FIX-SUMMARY.md](../FINAL-FIX-SUMMARY.md)

## Current Status

| Library | Fork Created | Changes Applied | Tested | Version Pinned |
|---------|--------------|-----------------|--------|----------------|
| fastmcp | ✅ | ⚠️ Pending | ❌ | Branch: main |
| mcp-proxy | ✅ | ⚠️ Pending | ❌ | Branch: main |

**Next Steps**:
1. Apply OAuth changes to fastmcp fork source code
2. Apply CORS + stateless fixes to mcp-proxy fork source code
3. Build both forks (`npm run build`)
4. Commit and push changes to forks
5. Reinstall dependencies in this project
6. Test complete OAuth flow with web-test console
