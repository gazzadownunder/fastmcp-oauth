#!/bin/bash
# Verify forked dependencies are correctly configured

echo "=== Verifying Forked Dependencies ==="
echo ""

echo "1. Checking package.json configuration..."
echo "   FastMCP:"
grep -o '"fastmcp": "[^"]*"' package.json
echo "   MCP-Proxy:"
grep -o '"mcp-proxy": "[^"]*"' package.json
echo ""

echo "2. Checking installed versions..."
npm list fastmcp 2>/dev/null | grep fastmcp
npm list mcp-proxy 2>/dev/null | grep mcp-proxy
echo ""

echo "3. Checking if forks are accessible..."
curl -s -o /dev/null -w "   FastMCP fork: HTTP %{http_code}\n" https://github.com/gazzadownunder/fastmcp
curl -s -o /dev/null -w "   MCP-Proxy fork: HTTP %{http_code}\n" https://github.com/gazzadownunder/mcp-proxy
echo ""

echo "=== Verification Complete ==="
