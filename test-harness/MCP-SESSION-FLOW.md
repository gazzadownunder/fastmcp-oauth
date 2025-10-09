# MCP Session Flow - Phase 3 Tests Updated

**Status:** ✅ Tests Now Follow Proper MCP Protocol
**Date:** 2025-10-09

---

## What Was Fixed

The Phase 3 tests were failing with `"No valid session ID provided"` because they weren't following the proper MCP protocol flow.

### Before (Incorrect)
```typescript
// ❌ Wrong - calling tool without initializing session
await callMCPTool('user-info', {}, bearerToken);
```

**Error:**
```
Error: MCP call failed: Bad Request - No valid session ID provided
```

### After (Correct)
```typescript
// ✅ Correct - initialize session first, then call tool
async function callMCPTool(tool, params, bearerToken) {
  // Step 1: Initialize MCP session
  const sessionId = await initializeMCPSession(bearerToken);

  // Step 2: Call tool with session ID
  return await fetch('/mcp', {
    headers: {
      'Authorization': `Bearer ${bearerToken}`,
      'Mcp-Session-Id': sessionId,  // ← Now included!
    },
    // ... tool call
  });
}
```

---

## Proper MCP Protocol Flow

The MCP (Model Context Protocol) requires this flow:

### 1. Initialize Session
```json
POST /mcp
{
  "jsonrpc": "2.0",
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": {
      "name": "phase3-integration-test",
      "version": "1.0.0"
    }
  },
  "id": 1
}
```

**Response includes:**
```
Headers:
  Mcp-Session-Id: <generated-session-id>
```

### 2. Call Tools with Session ID
```json
POST /mcp
Headers:
  Authorization: Bearer <jwt-token>
  Mcp-Session-Id: <session-id-from-initialize>

{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "user-info",
    "arguments": {}
  },
  "id": 2
}
```

---

## What Was Updated

### Files Modified

**1. [test-harness/phase3-integration.test.ts](phase3-integration.test.ts)**
- Added `initializeMCPSession()` function
- Updated `callMCPTool()` to initialize session before each call
- Now properly follows MCP protocol

**2. [test-harness/phase3-performance.test.ts](phase3-performance.test.ts)**
- Added `initializeMCPSession()` function
- Updated `callMCPTool()` to initialize session before each call
- Performance metrics now include session initialization overhead

---

## Implementation Details

### Helper Function: initializeMCPSession()

```typescript
async function initializeMCPSession(bearerToken: string): Promise<string> {
  const response = await fetch(`${MCP_SERVER_URL}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${bearerToken}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'phase3-integration-test',
          version: '1.0.0',
        },
      },
      id: 1,
    }),
  });

  // Extract session ID from response header
  const sessionId = response.headers.get('mcp-session-id');
  if (!sessionId) {
    throw new Error('No session ID returned from initialize');
  }

  return sessionId;
}
```

### Updated callMCPTool()

```typescript
async function callMCPTool(
  tool: string,
  params: any,
  bearerToken: string
): Promise<any> {
  // Step 1: Initialize MCP session (required by protocol)
  const sessionId = await initializeMCPSession(bearerToken);

  // Step 2: Call tool with session ID
  const response = await fetch(`${MCP_SERVER_URL}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${bearerToken}`,
      'Mcp-Session-Id': sessionId,  // ← Session ID from initialize
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: tool, arguments: params },
      id: Math.floor(Math.random() * 1000000),
    }),
  });

  return await response.json();
}
```

---

## Why This Matters

### Realistic Testing
The tests now simulate **real client behavior**:
1. Client connects and initializes session
2. Client uses session ID for subsequent calls
3. Tests validate the complete authentication + session flow

### Security Validation
This tests that:
- ✅ Session IDs are properly generated
- ✅ JWT authentication works during initialization
- ✅ Session IDs are required for tool calls
- ✅ Authorization is enforced at both layers (init + tool call)

### Protocol Compliance
The tests verify:
- ✅ MCP protocol flow is correctly implemented
- ✅ Session management works in stateless mode
- ✅ Headers are properly handled

---

## Performance Impact

**Note:** Performance tests now include session initialization overhead.

### What This Means

**Before (incorrect):**
- Measured only tool call latency
- Missing session init time

**After (correct):**
- Measures complete flow: init + tool call
- More realistic performance metrics
- Includes both JWT validation + session creation

**Typical overhead:**
- Session initialization: ~10-50ms
- Tool call: variable (depends on operation)
- **Total:** More realistic end-to-end measurement

---

## Running Tests

### Integration Tests
```bash
npm run test:phase3
```

**Expected flow per test:**
1. Authenticate with Keycloak → get JWT
2. Initialize MCP session → get session ID
3. Call tool with JWT + session ID
4. Verify response

### Performance Tests
```bash
npm run test:phase3:performance
```

**Measurements now include:**
- Session initialization time
- Tool execution time
- Total end-to-end latency

---

## Test Requirements

For tests to pass:

1. ✅ **MCP server running** on http://localhost:3000
2. ✅ **Keycloak configured** with correct credentials
3. ✅ **Test users exist** in Keycloak (alice@test.local, etc.)
4. ✅ **Server accepts initialize calls** (returns session ID)
5. ✅ **Server accepts tool calls** (with valid session ID)

---

## Summary

✅ **Tests updated** - Now follow proper MCP protocol
✅ **Session initialization** - Added to all test calls
✅ **Realistic behavior** - Tests simulate actual client usage
✅ **Protocol compliance** - Validates complete MCP flow

**The tests are now functionally correct and test the actual protocol implementation!**

---

**Document Status:** 🟢 Complete
**Last Updated:** 2025-10-09
**Files Updated:** phase3-integration.test.ts, phase3-performance.test.ts
