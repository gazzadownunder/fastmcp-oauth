# mcp-proxy Fork Integration

**Date**: 2025-10-06
**Status**: ✅ Complete - Using mcp-proxy with authentication fixes from GitHub

---

## Summary

The project now uses the **mcp-proxy fork** with OAuth/JWT authentication fixes from:
- **Repository**: https://github.com/gazzadownunder/mcp-proxy
- **Branch**: `auth-issue`
- **Package**: `github:gazzadownunder/mcp-proxy#auth-issue`

---

## Changes Made

### 1. Updated package.json

**Before**:
```json
{
  "dependencies": {
    "mcp-proxy": "^5.8.0"
  }
}
```

**After**:
```json
{
  "dependencies": {
    "mcp-proxy": "github:gazzadownunder/mcp-proxy#auth-issue"
  }
}
```

### 2. Reinstalled Dependencies

```bash
# Removed old mcp-proxy
rm -rf node_modules/mcp-proxy node_modules/.package-lock.json package-lock.json

# Installed from GitHub fork
npm install
```

### 3. Verified Fixes Are Present

Both authentication fixes are now in the **source TypeScript files**:

**Fix #1**: Stateless authentication check
```typescript
// node_modules/mcp-proxy/src/startHTTPServer.ts
if (!authResult || (typeof authResult === 'object' && 'authenticated' in authResult && !authResult.authenticated)) {
  // Extract error message and return HTTP 401
}
```

**Fix #2**: createServer catch block
```typescript
// node_modules/mcp-proxy/src/startHTTPServer.ts
const isAuthError = errorMessage.includes('Authentication') || ...;
if (isAuthError) {
  res.writeHead(401).end(JSON.stringify({...}));
}
```

---

## Benefits

### 1. ✅ Permanent Fixes
- Fixes are in the source TypeScript files
- Will survive `npm install` and rebuilds
- No need for patch scripts or manual modifications

### 2. ✅ Version Control
- Package.json tracks the exact fork and branch
- Team members get the same fixed version
- Consistent across development environments

### 3. ✅ Easy Updates
- Can update to latest `auth-issue` branch: `npm update mcp-proxy`
- Can switch branches if needed: Change `#auth-issue` to `#other-branch`
- Can switch back to npm version when upstream fixes are released

### 4. ✅ Security
- Authentication failures properly rejected with HTTP 401
- Error messages propagated to clients
- No session creation for failed authentication

---

## Testing

The authentication fixes work correctly:

```bash
# Test with invalid JWT
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer invalid.jwt.token" \
  -d '{"jsonrpc":"2.0","method":"initialize",...}'

# Response: HTTP 401 Unauthorized ✅
{"error":{"code":-32000,"message":"Invalid JWT payload"},"id":1,"jsonrpc":"2.0"}
```

---

## Switching Back to npm Version (When Upstream is Fixed)

When the original punkpeye/mcp-proxy repository releases a version with the fixes:

1. Update package.json:
```json
{
  "dependencies": {
    "mcp-proxy": "^5.9.0"  // or whatever version has the fix
  }
}
```

2. Reinstall:
```bash
npm install
```

---

## Fork Branch Details

The `auth-issue` branch contains:

### Authentication Fixes
1. **Stateless auth check** - Detects `{authenticated: false}` pattern
2. **createServer catch** - Returns HTTP 401 for authentication errors
3. **Error message propagation** - Extracts and returns actual error messages

### Original Features (from main branch)
- API key authentication
- HTTP Stream transport
- SSE transport
- Stateless mode support
- All original mcp-proxy functionality

---

## Package Resolution

When you run `npm install`, npm will:

1. Fetch from: https://github.com/gazzadownunder/mcp-proxy
2. Checkout branch: `auth-issue`
3. Install dependencies
4. Build the package (if needed)
5. Place in: `node_modules/mcp-proxy/`

The installed version will have:
- **Version**: Shows as `1.0.0` (from package.json in the fork)
- **Source**: GitHub repository (not npm registry)
- **Resolved**: `github:gazzadownunder/mcp-proxy#<commit-hash>`

---

## Team Setup

Other developers can simply:

```bash
git clone <your-project-repo>
cd <project-directory>
npm install  # Automatically gets the fork from GitHub
npm run build
npm start
```

No special configuration or manual patches needed!

---

## Maintenance

### Updating to Latest auth-issue Branch

```bash
npm update mcp-proxy
```

This will fetch the latest commit from the `auth-issue` branch.

### Checking Installed Version

```bash
npm list mcp-proxy
```

Shows:
```
mcp-proxy@1.0.0
└─┬ github:gazzadownunder/mcp-proxy#<commit-hash>
```

### Viewing Source

The mcp-proxy source is in `node_modules/mcp-proxy/` and can be modified if needed (though changes will be lost on reinstall).

---

## Future: Submitting to Upstream

Once the fixes are submitted and accepted by the original punkpeye/mcp-proxy repository:

1. They will be released in a new npm version (e.g., v5.9.0)
2. We can switch back to using the npm registry version
3. Update package.json to use the npm version
4. Remove the GitHub dependency

Until then, the fork provides a clean, maintainable solution.

---

## Documentation Updates

Updated files:
- ✅ [package.json](../package.json) - Now points to GitHub fork
- ✅ [Docs/github-issues-authentication-fix.md](./github-issues-authentication-fix.md) - Ready for upstream submission
- ✅ [Docs/github-repo-comparison.md](./github-repo-comparison.md) - Comparison documentation
- ✅ [Docs/mcp-proxy-fork-integration.md](./mcp-proxy-fork-integration.md) - This document

---

## Conclusion

The project now uses a **clean, maintainable** integration with the mcp-proxy fork:

- ✅ No manual patches required
- ✅ No build scripts needed
- ✅ Version controlled in package.json
- ✅ Team-friendly (automatic installation)
- ✅ Easy to update
- ✅ Easy to switch back when upstream is fixed

The authentication fixes are permanent and will work correctly across all environments.
