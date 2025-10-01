# Installing Forked MCP Dependencies

This project now uses forked versions of `fastmcp` and `mcp-proxy` to include OAuth authentication support.

## Fork Details

### FastMCP (Core Framework)

- **Fork Owner**: gazzadownunder
- **Repository**: https://github.com/gazzadownunder/fastmcp
- **Branch**: main
- **Upstream**: https://github.com/modelcontextprotocol/fastmcp

### MCP-Proxy (HTTP Stream Transport)

- **Fork Owner**: gazzadownunder
- **Repository**: https://github.com/gazzadownunder/mcp-proxy
- **Branch**: main
- **Upstream**: https://github.com/modelcontextprotocol/mcp-proxy

## Installation Instructions

### First Time Installation

```bash
# Remove existing node_modules and package-lock.json
rm -rf node_modules package-lock.json

# Install dependencies (will fetch from GitHub fork)
npm install
```

### Verify Installation

After installation, verify both forks are installed correctly:

```bash
# Check installed versions
npm list fastmcp
npm list mcp-proxy

# Expected output:
# fastmcp@1.x.x github:gazzadownunder/fastmcp#<commit-hash>
# mcp-proxy@2.14.3 github:gazzadownunder/mcp-proxy#<commit-hash>
```

### Verify Fixes Are Present

Check that the CORS and stateless session fixes are present:

```bash
# Check CORS fix (should show Authorization and Mcp-Session-Id explicitly)
grep -A 2 "Access-Control-Allow-Headers" node_modules/mcp-proxy/dist/chunk-43AXMLZU.js

# Check stateless session support (should find "stateless-session")
grep "stateless-session" node_modules/mcp-proxy/dist/chunk-43AXMLZU.js
```

Expected CORS fix:
```javascript
res.setHeader("Access-Control-Allow-Headers",
  "Content-Type, Authorization, Accept, Mcp-Session-Id, Last-Event-Id");
```

Expected stateless session support:
```javascript
sessionId === "stateless-session"
```

## Important Notes

### Do NOT Run `npm update`

Running `npm update` will NOT affect the forked dependency since it's pinned to the GitHub repository. However, be cautious with:

```bash
# This is SAFE (updates other packages, not the fork):
npm update

# This is SAFE (only updates if the fork's main branch changes):
npm install

# This is SAFE (reinstalls from the same fork):
rm -rf node_modules && npm install
```

### Updating to a New Fork Version

If the fork is updated with new commits:

```bash
# Clear npm cache
npm cache clean --force

# Reinstall
rm -rf node_modules package-lock.json
npm install
```

### Pinning to a Specific Commit

To prevent automatic updates from the fork's main branch, pin to a specific commit:

```json
{
  "dependencies": {
    "mcp-proxy": "github:gazzadownunder/mcp-proxy#commit-sha-here"
  }
}
```

Or use a Git tag if the fork has tags:

```json
{
  "dependencies": {
    "mcp-proxy": "github:gazzadownunder/mcp-proxy#v2.14.3-oauth-fixes"
  }
}
```

## Troubleshooting

### Installation Fails

**Problem**: `npm install` fails with "Repository not found"

**Solution**:
1. Verify the fork exists: https://github.com/gazzadownunder/mcp-proxy
2. Check GitHub authentication (private repos need SSH or token)
3. Try with explicit HTTPS:
   ```bash
   npm install https://github.com/gazzadownunder/mcp-proxy.git
   ```

### Fixes Not Present After Install

**Problem**: CORS or stateless session fixes missing after installation

**Solution**:
1. The fork may not have the fixes applied yet
2. Apply fixes to the fork's source code (see [FORKING-MCP-PROXY.md](Docs/FORKING-MCP-PROXY.md))
3. Wait for fixes to be committed to the fork
4. Reinstall after fixes are pushed

### Wrong Version Installed

**Problem**: npm installs original mcp-proxy instead of fork

**Solution**:
1. Check `package.json` has correct entry:
   ```json
   "mcp-proxy": "github:gazzadownunder/mcp-proxy#main"
   ```
2. Clear npm cache:
   ```bash
   npm cache clean --force
   rm -rf node_modules package-lock.json
   npm install
   ```

## CI/CD Considerations

### GitHub Actions

Add to your workflow to ensure fork is fetched:

```yaml
- name: Install dependencies
  run: npm ci
  env:
    # If fork is private, add GitHub token
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Private Forks

If the fork becomes private, configure npm to use GitHub token:

```bash
# Create .npmrc
echo "//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}" >> .npmrc

# Or use git+https with token
npm config set git+https://github.com/.insteadOf git+ssh://git@github.com/
```

## Maintaining the Fork

See [Docs/FORKING-MCP-PROXY.md](Docs/FORKING-MCP-PROXY.md) for:
- Applying the required fixes to fork source code
- Keeping fork in sync with upstream
- Creating tagged releases
- Testing fork changes

## Benefits of Using Fork

✅ **Fixes Persist**: CORS and stateless session fixes won't be lost on reinstall
✅ **Version Control**: Full control over when to update mcp-proxy
✅ **Custom Changes**: Can add project-specific modifications
✅ **No Patch Files**: No need for patch-package workarounds
✅ **Easy Sharing**: Team members get same fixes automatically

## Current Package.json Entries

```json
{
  "dependencies": {
    "fastmcp": "github:gazzadownunder/fastmcp#main",
    "mcp-proxy": "github:gazzadownunder/mcp-proxy#main"
  }
}
```

This means:
- **Source**: GitHub repository (not npm registry)
- **Owner**: gazzadownunder
- **Repositories**: fastmcp and mcp-proxy
- **Branch/Tag**: main (always uses latest main branch commits)
