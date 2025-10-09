# Phase 3 - Build and Start Instructions

**Important:** Avoid common mistakes when building and starting the test server!

---

## Common Mistake: Running npm run build in test-harness Directory ❌

**DON'T DO THIS:**
```batch
cd test-harness
npm run build  # ❌ ERROR: Missing script: "build"
```

**The test-harness directory has its own package.json but NO build script!**

---

## Correct Build Procedure ✅

### Step 1: Build from Root Directory

**Always build from the PROJECT ROOT, not test-harness:**

```batch
# Navigate to PROJECT ROOT
cd "c:\Users\gazza\Local Documents\GitHub\MCP Services\MCP-Oauth"

# Build the project
npm run build
```

**Expected Output:**
```
✓ Built successfully
dist/ directory created with compiled files
```

### Step 2: Start the Test Server

**Now you can start the server from test-harness:**

```batch
# Navigate to test-harness
cd test-harness

# Start Phase 3 server
start-phase3-server.bat
```

**OR use the full path:**

```batch
"c:\Users\gazza\Local Documents\GitHub\MCP Services\MCP-Oauth\test-harness\start-phase3-server.bat"
```

---

## Directory Structure

```
MCP-Oauth/                          ← ROOT (build here!)
├── package.json                    ← Has build script
├── dist/                           ← Created after npm run build
│   ├── index.js
│   ├── test-harness/
│   │   └── v2-test-server.js      ← Server executable
│   └── ...
├── test-harness/                   ← Test directory (NO build script)
│   ├── package.json                ← NO build script!
│   ├── config/
│   │   └── phase3-test-config.json
│   └── start-phase3-server.bat     ← Runs from here
```

---

## Complete Workflow (Step-by-Step)

### Terminal 1: Build and Start Server

```batch
# Step 1: Navigate to ROOT
cd "c:\Users\gazza\Local Documents\GitHub\MCP Services\MCP-Oauth"

# Step 2: Build project
npm run build

# Step 3: Navigate to test-harness
cd test-harness

# Step 4: Start server
start-phase3-server.bat
```

**Keep this terminal open! Server will run here.**

### Terminal 2: Run Tests

```batch
# Navigate to ROOT (not test-harness)
cd "c:\Users\gazza\Local Documents\GitHub\MCP Services\MCP-Oauth"

# Run integration tests
npm run test:phase3

# Run performance tests
npm run test:phase3:performance
```

---

## What Each package.json Contains

### Root package.json (MCP-Oauth/package.json)

**Has build and test scripts:**
```json
{
  "scripts": {
    "build": "tsup",                                    ← Build script
    "test:phase3": "vitest test-harness/phase3-integration-tests.ts --no-coverage",
    "test:phase3:performance": "vitest test-harness/phase3-performance-tests.ts --no-coverage"
  }
}
```

### Test Harness package.json (test-harness/package.json)

**Has verification and legacy test scripts (NO BUILD):**
```json
{
  "scripts": {
    "test": "node --experimental-specifier-resolution=node test-scenarios/scenario-4-azp-security.js",
    "test:all": "bash scripts/run-all-tests.sh",
    "verify": "bash scripts/verify-keycloak.sh"
    // NO BUILD SCRIPT!
  }
}
```

---

## Quick Reference Commands

### Build Project
```batch
cd "c:\Users\gazza\Local Documents\GitHub\MCP Services\MCP-Oauth"
npm run build
```

### Start Server
```batch
cd "c:\Users\gazza\Local Documents\GitHub\MCP Services\MCP-Oauth\test-harness"
start-phase3-server.bat
```

### Run Tests
```batch
cd "c:\Users\gazza\Local Documents\GitHub\MCP Services\MCP-Oauth"
npm run test:phase3
npm run test:phase3:performance
```

### Verify Keycloak Setup
```batch
cd "c:\Users\gazza\Local Documents\GitHub\MCP Services\MCP-Oauth\test-harness"
verify-keycloak-setup.bat
```

---

## Troubleshooting

### Error: "Missing script: build" in test-harness

**Cause:** Running `npm run build` from test-harness directory

**Solution:**
```batch
# Navigate to ROOT directory
cd "c:\Users\gazza\Local Documents\GitHub\MCP Services\MCP-Oauth"

# Then run build
npm run build
```

### Error: "Cannot find module 'dist/test-harness/v2-test-server.js'"

**Cause:** Project not built, or built from wrong directory

**Solution:**
```batch
# Navigate to ROOT
cd "c:\Users\gazza\Local Documents\GitHub\MCP Services\MCP-Oauth"

# Build project
npm run build

# Verify dist/ directory created
dir dist\test-harness\v2-test-server.js
```

### Server starts but can't find config

**Cause:** Running server from wrong directory (should be in test-harness)

**Solution:**
```batch
# Make sure you're in test-harness when starting server
cd "c:\Users\gazza\Local Documents\GitHub\MCP Services\MCP-Oauth\test-harness"
start-phase3-server.bat
```

---

## Summary

✅ **Build:** Always from ROOT directory (`MCP-Oauth/`)
✅ **Start Server:** From test-harness directory (`MCP-Oauth/test-harness/`)
✅ **Run Tests:** From ROOT directory (`MCP-Oauth/`)

**Remember:**
- test-harness package.json has NO build script
- Only root package.json has build script
- Server reads config from test-harness/config/

---

**Document Status:** 🟢 Current
**Last Updated:** 2025-10-09
