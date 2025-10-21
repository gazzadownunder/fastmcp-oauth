# Forking mcp-proxy to Prevent Loss of Custom Fixes

## Problem

The `mcp-proxy` package (v2.14.3) requires two critical fixes for OAuth/SSE functionality:
1. **CORS Fix**: Proper CORS headers for Authorization and Mcp-Session-Id
2. **Stateless Session Fix**: Support for stateless OAuth sessions without session pinning

These fixes were applied directly to `node_modules/mcp-proxy/dist/chunk-43AXMLZU.js`, but get overwritten during:
- `npm install`
- `npm update`
- Fresh clone/reinstall

## Solution: Fork and Maintain Custom Version

### Step 1: Fork the mcp-proxy Repository

1. Go to the mcp-proxy GitHub repository: https://github.com/modelcontextprotocol/mcp-proxy
2. Click "Fork" to create your fork: `https://github.com/YOUR-USERNAME/mcp-proxy`
3. Clone your fork locally:
   ```bash
   git clone https://github.com/YOUR-USERNAME/mcp-proxy.git
   cd mcp-proxy
   ```

### Step 2: Apply the Required Fixes

The fixes need to be applied to the **SOURCE CODE**, not the dist files.

#### Find the Source File

The dist file `chunk-43AXMLZU.js` is generated from TypeScript source files. Find the source:
```bash
# Search for the httpStreamHandler function
rg "httpStreamHandler" --type ts
```

Expected location: `src/httpStreamHandler.ts` or similar.

#### Fix #1: CORS Headers (Line ~170 in dist)

Find this code in the source:
```typescript
res.setHeader("Access-Control-Allow-Headers", "*");
```

Replace with:
```typescript
res.setHeader("Access-Control-Allow-Headers",
  "Content-Type, Authorization, Accept, Mcp-Session-Id, Last-Event-Id");
```

**Why**: Wildcard `*` doesn't include `Authorization` header. Must be explicitly listed.

#### Fix #2: Stateless Session Support (Lines ~186-243 in dist)

Find the session handling logic around:
```typescript
const sessionId = Array.isArray(req.headers["mcp-session-id"])
  ? req.headers["mcp-session-id"][0]
  : req.headers["mcp-session-id"];
```

Replace the entire session logic (from session extraction through error handling) with the stateless version from [STATELESS-SESSION-FIX.md](../STATELESS-SESSION-FIX.md).

The key changes:
- Accept `"stateless-session"` as a valid session ID
- Create shared stateless transport instance in `activeTransports["stateless-session"]`
- All stateless requests reuse the same transport
- No "Bad Request: No valid session ID provided" error for stateless mode

**Reference**: See [STATELESS-SESSION-FIX.md](../STATELESS-SESSION-FIX.md) lines 228-282 for complete implementation.

### Step 3: Build and Test the Fork

```bash
# Install dependencies
npm install

# Build the package
npm run build

# Run tests (if available)
npm test
```

Verify the fixes are in `dist/chunk-43AXMLZU.js` (or equivalent output file).

### Step 4: Publish to Your GitHub

```bash
git add .
git commit -m "feat: Add CORS and stateless session fixes for OAuth/JWT

- Fix CORS headers to include Authorization and Mcp-Session-Id
- Add stateless session support for OAuth workflows
- Prevent session pinning issues with JWT authentication"

git push origin main
```

### Step 5: Update This Project to Use Your Fork

✅ **COMPLETED** - This project now uses the forked mcp-proxy repository.

**Current Configuration:**
- Fork Owner: `gazzadownunder`
- Fork URL: https://github.com/gazzadownunder/mcp-proxy
- Branch: `main`
- Package.json entry: `"mcp-proxy": "github:gazzadownunder/mcp-proxy#main"`

To update `package.json` in this project:

```json
{
  "dependencies": {
    "mcp-proxy": "github:gazzadownunder/mcp-proxy#main"
  }
}
```

Or with a specific commit/tag:
```json
{
  "dependencies": {
    "mcp-proxy": "github:gazzadownunder/mcp-proxy#v2.14.3-oauth-fixes"
  }
}
```

Then reinstall:
```bash
npm install
```

### Step 6: Verify the Fixes

```bash
# Check that your fork is installed
npm list mcp-proxy

# Verify the fixes are present
grep -A 2 "Access-Control-Allow-Headers" node_modules/mcp-proxy/dist/chunk-43AXMLZU.js
grep "stateless-session" node_modules/mcp-proxy/dist/chunk-43AXMLZU.js
```

### Step 7: Test with Web Console

```bash
# Start the server
$env:NODE_ENV="development"
$env:CONFIG_PATH="./test-harness/config/keycloak-oauth-only.json"
$env:SERVER_PORT="3000"
npm start

# In another terminal, serve web-test
cd test-harness/web-test
python -m http.server 8000
```

Test the OAuth flow at http://localhost:8000

## Alternative: Use npm patch

If you prefer not to fork, you can use `patch-package`:

```bash
npm install --save-dev patch-package

# Make changes to node_modules/mcp-proxy/dist/chunk-43AXMLZU.js

# Create patch
npx patch-package mcp-proxy
```

Add to package.json:
```json
{
  "scripts": {
    "postinstall": "patch-package"
  }
}
```

This creates `patches/mcp-proxy+2.14.3.patch` that auto-applies after npm install.

**Downside**: Patches can break on version updates. Fork gives more control.

## Maintenance Strategy

### Keep Fork in Sync with Upstream

```bash
# Add upstream remote
git remote add upstream https://github.com/modelcontextprotocol/mcp-proxy.git

# Fetch upstream changes
git fetch upstream

# Merge upstream changes
git merge upstream/main

# Reapply your fixes if needed
# ... make changes ...

# Push updated fork
git push origin main
```

### Version Your Fork

Use tags for stable versions:
```bash
git tag -a v2.14.3-oauth-fixes-1 -m "OAuth and stateless session fixes"
git push origin v2.14.3-oauth-fixes-1
```

Update package.json to pin to tag:
```json
{
  "dependencies": {
    "mcp-proxy": "github:YOUR-USERNAME/mcp-proxy#v2.14.3-oauth-fixes-1"
  }
}
```

## Current Fix Locations

### CORS Fix
- **File**: `node_modules/mcp-proxy/dist/chunk-43AXMLZU.js`
- **Line**: ~170
- **Documentation**: [CORS-FIX-APPLIED.md](../CORS-FIX-APPLIED.md)

### Stateless Session Fix
- **File**: `node_modules/mcp-proxy/dist/chunk-43AXMLZU.js`
- **Lines**: ~186-243
- **Documentation**: [STATELESS-SESSION-FIX.md](../STATELESS-SESSION-FIX.md)

### Complete Fix Summary
- **All Fixes**: [FINAL-FIX-SUMMARY.md](../FINAL-FIX-SUMMARY.md)

## Testing Checklist

After applying fixes to your fork:

- [ ] CORS headers include Authorization
- [ ] CORS headers include Mcp-Session-Id
- [ ] Stateless session ID "stateless-session" accepted
- [ ] Multiple requests reuse stateless transport
- [ ] No "Bad Request: No valid session ID" error
- [ ] OAuth flow completes successfully
- [ ] Token exchange works
- [ ] MCP tools callable with exchanged token
- [ ] Web-test console fully functional

## References

- Original mcp-proxy: https://github.com/modelcontextprotocol/mcp-proxy
- CORS Specification: https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS
- RFC 8693 Token Exchange: https://datatracker.ietf.org/doc/html/rfc8693
- Server-Sent Events: https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events
