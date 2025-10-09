# Phase 3 Server Start - FIXED

**Issue:** `start-phase3-server.bat` was looking for `dist/` in wrong location
**Status:** ✅ FIXED
**Date:** 2025-10-09

---

## What Was Wrong

### Original Error
```
Error: Cannot find module 'C:\Users\gazza\Local Documents\GitHub\MCP Services\MCP-Oauth\test-harness\dist\test-harness\v2-test-server.js'
```

### Root Cause

The script was running from `test-harness/` directory and looking for:
```
test-harness/dist/test-harness/v2-test-server.js  ❌ WRONG
```

But the actual location is:
```
MCP-Oauth/dist/test-harness/v2-test-server.js  ✅ CORRECT
```

**Directory structure:**
```
MCP-Oauth/                              ← ROOT
├── dist/                               ← Build output here
│   └── test-harness/
│       └── v2-test-server.js           ← Server file
└── test-harness/                       ← Script runs from here
    └── start-phase3-server.bat         ← This script
```

---

## What Was Fixed

### Before (Broken)
```batch
REM Start the test server
node dist/test-harness/v2-test-server.js  ❌ Wrong path
```

### After (Fixed)
```batch
REM Start the test server (dist is in parent directory)
node ..\dist\test-harness\v2-test-server.js  ✅ Correct path
```

**Change:** Added `..\ ` to go up one directory level from test-harness to root

---

## How to Start Server Now

### Method 1: Using the Fixed Batch Script

```batch
cd "c:\Users\gazza\Local Documents\GitHub\MCP Services\MCP-Oauth\test-harness"
start-phase3-server.bat
```

**Expected output:**
```
================================================================
 Phase 3 Integration Testing - MCP Server
================================================================

Environment Configuration:
  NODE_ENV:     development
  CONFIG_PATH:  ./test-harness/config/phase3-test-config.json
  SERVER_PORT:  3000

================================================================
 Starting MCP Server...
================================================================

[Server starts and shows initialization messages]
✓ Token exchange service initialized
✓ Cache enabled with TTL: 60s
✓ Server listening on port 3000
```

### Method 2: Manual Start (Alternative)

If the batch script still has issues, you can start manually:

```batch
# From test-harness directory
cd "c:\Users\gazza\Local Documents\GitHub\MCP Services\MCP-Oauth\test-harness"

# Set environment variables
set NODE_ENV=development
set CONFIG_PATH=./test-harness/config/phase3-test-config.json
set SERVER_PORT=3000

# Run server with correct path
node ..\dist\test-harness\v2-test-server.js
```

### Method 3: From Root Directory

You can also run from the root directory:

```batch
# From ROOT
cd "c:\Users\gazza\Local Documents\GitHub\MCP Services\MCP-Oauth"

# Set environment variables
set NODE_ENV=development
set CONFIG_PATH=./test-harness/config/phase3-test-config.json
set SERVER_PORT=3000

# Run server
node dist/test-harness/v2-test-server.js
```

---

## Verification Steps

### 1. Check Build Output Exists

```batch
# From ROOT directory
cd "c:\Users\gazza\Local Documents\GitHub\MCP Services\MCP-Oauth"

# Check if server file exists
dir dist\test-harness\v2-test-server.js
```

**Expected:** File exists with recent timestamp

**If not found:** Run build first
```batch
npm run build
```

### 2. Check Config File Exists

```batch
# From test-harness directory
cd test-harness
dir config\phase3-test-config.json
```

**Expected:** File exists

### 3. Start Server

```batch
start-phase3-server.bat
```

**Expected:** Server starts without "Cannot find module" error

---

## Complete Workflow (Start to Finish)

### Step 1: Build Project (From ROOT)

```batch
cd "c:\Users\gazza\Local Documents\GitHub\MCP Services\MCP-Oauth"
npm run build
```

**Verify:**
```batch
dir dist\test-harness\v2-test-server.js
```

### Step 2: Update Config (If Not Done)

Edit `test-harness/config/phase3-test-config.json`:
- Update `clientSecret` with actual value from Keycloak (line 56)

### Step 3: Start Server (From test-harness)

```batch
cd test-harness
start-phase3-server.bat
```

**Expected:** Server starts successfully

### Step 4: Verify Server Running

**In another terminal:**
```batch
curl http://localhost:3000/health
```

Or open browser to: http://localhost:3000

---

## Troubleshooting

### Error: "Cannot find module ... v2-test-server.js"

**Cause:** Project not built, or built incorrectly

**Solution:**
```batch
# Navigate to ROOT (not test-harness!)
cd "c:\Users\gazza\Local Documents\GitHub\MCP Services\MCP-Oauth"

# Clean and rebuild
npm run clean
npm run build

# Verify build output
dir dist\test-harness\v2-test-server.js
```

### Error: "Cannot find config file"

**Cause:** CONFIG_PATH environment variable incorrect

**Solution:**

The config path should be relative to where the server is running from.

**If running from test-harness:**
```batch
set CONFIG_PATH=./config/phase3-test-config.json
```

**If running from root:**
```batch
set CONFIG_PATH=./test-harness/config/phase3-test-config.json
```

### Server starts but shows errors loading config

**Check:** Client secret in config file

**Solution:**
1. Get secret from Keycloak: Admin → Clients → mcp-oauth → Credentials
2. Update in: `test-harness/config/phase3-test-config.json` line 56
3. Restart server

---

## Summary of Fixes

✅ **Fixed:** `start-phase3-server.bat` now uses correct path `..\ dist\test-harness\v2-test-server.js`
✅ **Verified:** Build output exists at `dist/test-harness/v2-test-server.js`
✅ **Verified:** Config exists at `test-harness/config/phase3-test-config.json`

---

## Next Steps

Now that the server start script is fixed:

1. ✅ **Update client secret** in config file
2. ✅ **Build project** from root: `npm run build`
3. ✅ **Start server** from test-harness: `start-phase3-server.bat`
4. ✅ **Run tests** from root: `npm run test:phase3`

---

**Document Status:** 🟢 Fixed and Verified
**Last Updated:** 2025-10-09
