#!/bin/bash
# Run complete OAuth delegation test suite

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

echo "========================================="
echo "FastMCP OAuth OBO Test Suite"
echo "Complete OAuth Delegation Testing"
echo "========================================="
echo ""

# Step 1: Verify Keycloak configuration
echo "Step 1: Verifying Keycloak configuration..."
./scripts/verify-keycloak.sh
if [ $? -ne 0 ]; then
  echo "✗ Keycloak verification failed. Aborting tests."
  exit 1
fi
echo ""

# Step 2: Get Subject Token
echo "Step 2: Obtaining Subject Token..."
./scripts/1-get-subject-token.sh
if [ $? -ne 0 ]; then
  echo "✗ Failed to obtain Subject Token. Aborting tests."
  exit 1
fi
echo ""

# Step 3: Exchange Token
echo "Step 3: Performing Token Exchange (RFC 8693)..."
./scripts/2-exchange-token.sh
if [ $? -ne 0 ]; then
  echo "✗ Token exchange failed. Aborting tests."
  exit 1
fi
echo ""

# Step 4: Test MCP Tools
echo "Step 4: Testing MCP Tools..."
./scripts/3-test-mcp-tools.sh
if [ $? -ne 0 ]; then
  echo "✗ MCP tool tests failed."
  exit 1
fi
echo ""

# Step 5: Run TypeScript test scenarios (if available)
echo "Step 5: Running test scenarios..."
if [ -d "test-scenarios" ] && command -v node > /dev/null 2>&1; then
  echo "Running TypeScript test scenarios..."

  # Check if scenarios are compiled
  if [ ! -d "../dist-test" ]; then
    echo "Compiling test scenarios..."
    npm run build:tests 2>/dev/null || echo "⚠ Test compilation skipped"
  fi

  # Run test scenarios
  for scenario in test-scenarios/*.ts; do
    if [ -f "$scenario" ]; then
      echo "Running: $(basename $scenario)"
      npx tsx "$scenario" || echo "⚠ Scenario failed: $(basename $scenario)"
    fi
  done
else
  echo "⚠ Skipping TypeScript scenarios (node not available or scenarios missing)"
fi
echo ""

# Cleanup
echo "========================================="
echo "Cleanup"
echo "========================================="
echo "Token files generated:"
ls -lh .subject-token .exchanged-token 2>/dev/null || echo "No token files found"
echo ""
echo "⚠ Remember to delete token files when done:"
echo "  rm .subject-token .exchanged-token"
echo ""

# Summary
echo "========================================="
echo "Test Suite Complete"
echo "========================================="
echo "✓ Keycloak configuration verified"
echo "✓ Subject token obtained"
echo "✓ Token exchange successful"
echo "✓ MCP tools tested"
echo ""
echo "Next steps:"
echo "  1. Review audit logs on MCP server"
echo "  2. Test with different user roles"
echo "  3. Test SQL delegation with real queries"
echo "  4. Test error scenarios"
echo ""