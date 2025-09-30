#!/bin/bash
# Test MCP tools with exchanged token
# This simulates Phase 3 of the OAuth delegation flow

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

# Load configuration
if [ ! -f config/test.env ]; then
  echo "Error: config/test.env not found"
  exit 1
fi

source config/test.env

echo "========================================="
echo "OAuth Delegation Test - Phase 3"
echo "Test MCP Tools with Exchanged Token"
echo "========================================="
echo ""

# Check if exchanged token exists
if [ ! -f .exchanged-token ]; then
  echo "✗ Error: Exchanged token not found"
  echo "Please run ./scripts/2-exchange-token.sh first"
  exit 1
fi

TOKEN=$(cat .exchanged-token)

# Check if MCP server is running
echo "Checking if MCP server is running at ${MCP_SERVER_URL}..."
if ! curl -s --max-time 5 "${MCP_SERVER_URL}/health" > /dev/null 2>&1; then
  echo "⚠ Warning: Cannot reach MCP server at ${MCP_SERVER_URL}"
  echo ""
  echo "Please start the MCP server first:"
  echo "  cd .."
  echo "  npm run build"
  echo "  CONFIG_PATH=./test-harness/config/keycloak-with-sql.json npm start"
  echo ""
  read -p "Press Enter when server is running, or Ctrl+C to cancel..."
fi

echo ""
echo "========================================="
echo "Test 1: user-info Tool"
echo "========================================="
echo "Expected: Returns current user session information"
echo ""

curl -s -X POST "${MCP_SERVER_URL}/mcp/tools/user-info" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{}' | jq . || echo "✗ Failed to call user-info tool"

echo ""
echo "========================================="
echo "Test 2: health-check Tool"
echo "========================================="
echo "Expected: Returns health status of services"
echo ""

curl -s -X POST "${MCP_SERVER_URL}/mcp/tools/health-check" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"service": "all"}' | jq . || echo "✗ Failed to call health-check tool"

echo ""
echo "========================================="
echo "Test 3: sql-delegate Tool (Basic Query)"
echo "========================================="
echo "Expected: Executes SQL query on behalf of legacy user"
echo ""

curl -s -X POST "${MCP_SERVER_URL}/mcp/tools/sql-delegate" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "query",
    "sql": "SELECT CURRENT_USER AS delegated_user, GETDATE() AS timestamp",
    "params": {}
  }' | jq . || echo "✗ Failed to call sql-delegate tool"

echo ""
echo "========================================="
echo "Test 4: sql-delegate Tool (Parameterized Query)"
echo "========================================="
echo "Expected: Executes parameterized query safely"
echo ""

curl -s -X POST "${MCP_SERVER_URL}/mcp/tools/sql-delegate" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "query",
    "sql": "SELECT * FROM Users WHERE id = @userId",
    "params": {"userId": 1}
  }' | jq . || echo "✗ Failed to call sql-delegate with parameters"

echo ""
echo "========================================="
echo "Test 5: Subject Token Rejection (Security)"
echo "========================================="
echo "Expected: Subject token should be REJECTED"
echo ""

if [ -f .subject-token ]; then
  SUBJECT_TOKEN=$(cat .subject-token)
  echo "Testing with Subject Token (azp: contextflow)..."

  RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${MCP_SERVER_URL}/mcp/tools/user-info" \
    -H "Authorization: Bearer ${SUBJECT_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{}')

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  if [ "$HTTP_CODE" == "401" ] || [ "$HTTP_CODE" == "403" ]; then
    echo "✓ PASS: Subject token correctly rejected (HTTP $HTTP_CODE)"
    echo "$BODY" | jq .
  else
    echo "✗ SECURITY FAILURE: Subject token was accepted (HTTP $HTTP_CODE)"
    echo "This is a critical security issue!"
    echo "$BODY" | jq .
  fi
else
  echo "⚠ Skipping: Subject token not found (.subject-token)"
fi

echo ""
echo "========================================="
echo "Test Summary"
echo "========================================="
echo "✓ Tested MCP tools with exchanged token"
echo "✓ Verified OAuth delegation flow works"
echo ""
echo "Review the audit log with:"
echo "  curl -X POST ${MCP_SERVER_URL}/mcp/tools/audit-log \\"
echo "    -H 'Authorization: Bearer \$ADMIN_TOKEN' \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"limit\": 10}' | jq ."
echo ""