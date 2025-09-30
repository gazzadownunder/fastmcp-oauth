# How to Start the MCP Server

## The Problem

The `start-mcp-test.bat` file opens a **new command window** instead of running in the current one. This makes it hard to see if the server is actually running.

## Solution

**Open a new command prompt manually and run:**

```bash
cd "C:\Users\gazza\Local Documents\GitHub\MCP Services\MCP-Oauth"
set NODE_ENV=development
set CONFIG_PATH=config/oauth-obo-test.json
set SERVER_PORT=3000
set MCP_ENDPOINT=/mcp
node dist/start-server.js
```

## What You Should See

If the server starts successfully:

```
Starting MCP OAuth Server with TEST configuration...

Configuration:
  NODE_ENV = development
  CONFIG_PATH = config/oauth-obo-test.json
  SERVER_PORT = 3000
  MCP_ENDPOINT = /mcp

========================================

Starting FastMCP OAuth OBO Server...
Transport: HTTP Stream
Port: 3000
Endpoint: /mcp
Config: config/oauth-obo-test.json

[SERVER] Configuration loaded from: config/oauth-obo-test.json
[SERVER] Trusted IDPs: 1
[SERVER] Starting HTTP Stream transport
[SERVER] Using stateless mode (stateless: true)
[FastMCP info] server is running on HTTP Stream at http://localhost:3000/mcp

✓ Server is ready!
```

## If You See Errors

### Error: Cannot find configuration file

```
Failed to start server: ENOENT: no such file or directory,
open 'C:\Users\gazza\...\config\oauth-obo.json'
```

**Solution:** The CONFIG_PATH is wrong. Make sure you set:
```bash
set CONFIG_PATH=config/oauth-obo-test.json
```

### Error: Port already in use

```
Error: listen EADDRINUSE: address already in use :::3000
```

**Solution:** Another process is using port 3000. Kill it:
```bash
taskkill /F /IM node.exe
```

Then restart the server.

## Checking If Server Is Running

In another command prompt:

```bash
netstat -ano | findstr :3000
```

You should see:
```
TCP    0.0.0.0:3000    0.0.0.0:0    LISTENING    <PID>
TCP    [::]:3000       [::]:0       LISTENING    <PID>
```

## Testing the Server

Once running, you can test with curl:

```bash
curl -X OPTIONS http://localhost:3000/mcp -H "Origin: http://localhost:8000" -v
```

Should return CORS headers including:
```
Access-Control-Allow-Headers: Content-Type, Authorization, Accept, Mcp-Session-Id, Last-Event-Id
Access-Control-Expose-Headers: Mcp-Session-Id
```

## Server Logs to Watch For

When you test with the web harness, you should see:

```
[AUTH DEBUG] ========== Authentication Request ==========
[AUTH DEBUG] Request method: POST
[AUTH DEBUG] Request URL: /mcp
[AUTH DEBUG] Request headers: {...}
[AUTH DEBUG] Authorization: present
[JWT VALIDATOR] ✓ Token decoded successfully
[AUTH DEBUG] ✓ Successfully authenticated user: greynolds
```

If you DON'T see `[AUTH DEBUG]` logs, the server isn't processing requests.

## Keep the Window Open

**Important:** Keep the command window open while testing. The server runs in the foreground and logs to the console.

Press `Ctrl+C` to stop the server when done.

## Alternative: Run in Background (Advanced)

If you want the server to run in the background:

```bash
start /B node dist/start-server.js > server.log 2>&1
```

Then check logs:
```bash
type server.log
```

Kill with:
```bash
taskkill /F /IM node.exe
```