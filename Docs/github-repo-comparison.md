# GitHub Repository vs Local node_modules Comparison

**Date**: 2025-10-06
**GitHub Repo**: https://github.com/gazzadownunder/mcp-proxy
**Local Path**: `node_modules/mcp-proxy/`

---

## Summary

❌ **The GitHub repository does NOT contain the authentication fixes** that are in our local node_modules.

The GitHub repository (gazzadownunder/mcp-proxy) is a fork of punkpeye/mcp-proxy with API key authentication added, but it does **NOT** have the OAuth/JWT authentication fixes we implemented locally.

---

## Detailed Comparison

### Fix #1: Stateless Authentication Check

**Location**: `src/startHTTPServer.ts` lines ~137-180

#### GitHub Repository (gazzadownunder/mcp-proxy)

```typescript
// Per-request authentication in stateless mode
if (stateless && authenticate) {
  try {
    const authResult = await authenticate(req);
    if (!authResult) {  // ❌ MISSING FIX: Only checks falsy values
      res.setHeader("Content-Type", "application/json");
      res.writeHead(401).end(
        JSON.stringify({
          error: {
            code: -32000,
            message: "Unauthorized: Authentication failed"
          },
          id: (body as { id?: unknown })?.id ?? null,
          jsonrpc: "2.0"
        })
      );
      return true;
    }
  } catch (error) {
    console.error("Authentication error:", error);
    res.setHeader("Content-Type", "application/json");
    res.writeHead(401).end(
      JSON.stringify({
        error: {
          code: -32000,
          message: "Unauthorized: Authentication error"  // ❌ MISSING: No error message extraction
        },
        id: (body as { id?: unknown })?.id ?? null,
        jsonrpc: "2.0"
      })
    );
    return true;
  }
}
```

#### Local node_modules (WITH FIX)

```typescript
// Per-request authentication in stateless mode
if (stateless && authenticate) {
  try {
    const authResult = await authenticate(req);

    // ✅ FIX: Check for both falsy AND { authenticated: false } pattern
    // FastMCP returns { authenticated: false, error: "..." } which is truthy
    if (!authResult || (typeof authResult === 'object' && 'authenticated' in authResult && !authResult.authenticated)) {
      // ✅ Extract error message if available
      const errorMessage =
        authResult && typeof authResult === 'object' && 'error' in authResult && typeof authResult.error === 'string'
          ? authResult.error
          : "Unauthorized: Authentication failed";

      res.setHeader("Content-Type", "application/json");
      res.writeHead(401).end(
        JSON.stringify({
          error: {
            code: -32000,
            message: errorMessage  // ✅ Uses actual error message
          },
          id: (body as { id?: unknown })?.id ?? null,
          jsonrpc: "2.0"
        })
      );
      return true;
    }
  } catch (error) {
    // ✅ Extract error details from thrown errors
    const errorMessage = error instanceof Error ? error.message : "Unauthorized: Authentication error";
    console.error("Authentication error:", error);
    res.setHeader("Content-Type", "application/json");
    res.writeHead(401).end(
      JSON.stringify({
        error: {
          code: -32000,
          message: errorMessage  // ✅ Uses actual error message
        },
        id: (body as { id?: unknown })?.id ?? null,
        jsonrpc: "2.0"
      })
    );
    return true;
  }
}
```

**Differences**:
1. ❌ GitHub: Only checks `if (!authResult)` - misses `{authenticated: false}` objects
2. ✅ Local: Checks both falsy AND `authenticated: false` pattern
3. ❌ GitHub: Hardcoded error message "Unauthorized: Authentication failed"
4. ✅ Local: Extracts actual error message from `authResult.error`
5. ❌ GitHub: Catch block uses hardcoded "Unauthorized: Authentication error"
6. ✅ Local: Catch block extracts error message from thrown Error objects

---

### Fix #2: createServer Catch Block

**Location**: `src/startHTTPServer.ts` lines ~235-245

#### GitHub Repository (gazzadownunder/mcp-proxy)

```typescript
try {
  server = await createServer(req);
} catch (error) {
  if (handleResponseError(error, res)) {
    return true;
  }

  res.writeHead(500).end("Error creating server");  // ❌ MISSING FIX: Returns HTTP 500 for all errors

  return true;
}
```

#### Local node_modules (NEEDS FIX)

**Note**: This fix is only in the **compiled** dist file, not in the source TypeScript file.

The source file in our local node_modules matches the GitHub repo (no fix). However, the compiled `dist/stdio-YLE2JEmW.js` has the fix applied.

**Compiled dist file** (node_modules/mcp-proxy/dist/stdio-YLE2JEmW.js):
```javascript
} catch (error) {
  // ✅ Check if this is an authentication error
  const errorMessage = error instanceof Error ? error.message : String(error);
  const isAuthError = errorMessage.includes('Authentication') ||
                     errorMessage.includes('Invalid JWT') ||
                     errorMessage.includes('Token') ||
                     errorMessage.includes('Unauthorized');

  if (isAuthError) {
    res.setHeader("Content-Type", "application/json");
    res.writeHead(401).end(JSON.stringify({
      error: {
        code: -32000,
        message: errorMessage
      },
      id: (body)?.id ?? null,
      jsonrpc: "2.0"
    }));
    return true;
  }

  if (handleResponseError(error, res)) return true;
  res.writeHead(500).end("Error creating server");
  return true;
}
```

**Differences**:
1. ❌ GitHub: Returns HTTP 500 for ALL errors including authentication failures
2. ✅ Local (compiled): Detects authentication errors and returns HTTP 401
3. ❌ GitHub: Generic "Error creating server" message
4. ✅ Local (compiled): Returns actual error message from exception

---

## Status of Fixes

### ✅ Fix #1: Stateless Auth Check
- **GitHub Repo**: ❌ NOT PRESENT
- **Local Source**: ✅ PRESENT (`node_modules/mcp-proxy/src/startHTTPServer.ts`)
- **Local Compiled**: ✅ PRESENT (`node_modules/mcp-proxy/dist/stdio-YLE2JEmW.js`)

### ⚠️ Fix #2: createServer Catch
- **GitHub Repo**: ❌ NOT PRESENT
- **Local Source**: ❌ NOT PRESENT (`node_modules/mcp-proxy/src/startHTTPServer.ts`)
- **Local Compiled**: ✅ PRESENT (`node_modules/mcp-proxy/dist/stdio-YLE2JEmW.js`)

---

## What This Means

### 1. GitHub Repository is NOT Updated

The GitHub repository at https://github.com/gazzadownunder/mcp-proxy does **NOT** contain either of the authentication fixes we implemented and tested locally.

### 2. Local Changes are Incomplete

Our local node_modules has:
- ✅ Fix #1 in both source and compiled files
- ⚠️ Fix #2 only in compiled dist file (not in source)

### 3. Testing Was Against Compiled Code

When we tested and confirmed the fixes work, we were testing against the **compiled** JavaScript in `dist/stdio-YLE2JEmW.js`, which has both fixes.

---

## Required Actions

### 1. Apply Both Fixes to Source TypeScript

The `node_modules/mcp-proxy/src/startHTTPServer.ts` file needs **both** fixes:

**Fix #1**: ✅ Already present in source
**Fix #2**: ❌ Needs to be added to source

**Add to source** at line ~237:
```typescript
try {
  server = await createServer(req);
} catch (error) {
  // ✅ FIX: Detect authentication errors and return HTTP 401
  const errorMessage = error instanceof Error ? error.message : String(error);
  const isAuthError = errorMessage.includes('Authentication') ||
                     errorMessage.includes('Invalid JWT') ||
                     errorMessage.includes('Token') ||
                     errorMessage.includes('Unauthorized');

  if (isAuthError) {
    res.setHeader("Content-Type", "application/json");
    res.writeHead(401).end(JSON.stringify({
      error: {
        code: -32000,
        message: errorMessage
      },
      id: (body as { id?: unknown })?.id ?? null,
      jsonrpc: "2.0"
    }));
    return true;
  }

  if (handleResponseError(error, res)) {
    return true;
  }

  res.writeHead(500).end("Error creating server");

  return true;
}
```

### 2. Rebuild mcp-proxy

After adding Fix #2 to the source:
```bash
cd node_modules/mcp-proxy
npm run build
```

### 3. Update GitHub Repository (Optional)

If you want to push these fixes to your fork:
```bash
cd node_modules/mcp-proxy
git add src/startHTTPServer.ts
git commit -m "fix: Add OAuth/JWT authentication failure handling

- Check for {authenticated: false} pattern (not just falsy)
- Extract and propagate actual error messages
- Return HTTP 401 for authentication errors (not 500)
- Fixes security vulnerability allowing unauthenticated sessions"
git push origin main
```

### 4. Submit to Upstream

The fixes should be submitted to the **original** punkpeye/mcp-proxy repository, not just your fork, as they fix security vulnerabilities.

---

## Verification Commands

### Check if Fix #1 is in source:
```bash
grep -A 5 "authenticated: false" node_modules/mcp-proxy/src/startHTTPServer.ts
```
Expected: Should find the authentication check

### Check if Fix #2 is in source:
```bash
grep -A 10 "isAuthError" node_modules/mcp-proxy/src/startHTTPServer.ts
```
Expected: Currently returns nothing (fix not in source)

### Check if Fix #2 is in compiled dist:
```bash
grep -A 10 "isAuthError" node_modules/mcp-proxy/dist/stdio-YLE2JEmW.js
```
Expected: Should find the authentication error detection

---

## Conclusion

**Answer to your question**: ❌ No, the GitHub repository (gazzadownunder/mcp-proxy) does **NOT** contain the authentication fixes.

The local node_modules has:
- ✅ Fix #1: In source and compiled (properly applied)
- ⚠️ Fix #2: Only in compiled dist (needs to be added to source)

**Recommendation**:
1. Add Fix #2 to the TypeScript source file
2. Rebuild to ensure both fixes are in compiled code
3. Test to confirm both fixes still work
4. Optionally push to your GitHub fork
5. Submit to upstream punkpeye/mcp-proxy with the complete fixes
