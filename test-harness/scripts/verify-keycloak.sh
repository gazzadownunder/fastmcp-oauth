#!/bin/bash
# Verify Keycloak configuration matches requirements from oauth2 details.docx

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
echo "Keycloak Configuration Verification"
echo "========================================="
echo ""
echo "Keycloak URL: ${KEYCLOAK_URL}"
echo "Realm: ${KEYCLOAK_REALM}"
echo ""

PASS_COUNT=0
FAIL_COUNT=0

# Test 1: Keycloak is reachable
echo "Test 1: Keycloak Server Reachable"
if curl -s --max-time 5 "${KEYCLOAK_URL}" > /dev/null 2>&1; then
  echo "✓ PASS: Keycloak server is reachable"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  echo "✗ FAIL: Cannot reach Keycloak server"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi
echo ""

# Test 2: Realm exists
echo "Test 2: Realm Configuration"
REALM_RESPONSE=$(curl -s "${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/.well-known/openid-configuration")
if echo "$REALM_RESPONSE" | jq -e '.issuer' > /dev/null 2>&1; then
  ISSUER=$(echo "$REALM_RESPONSE" | jq -r '.issuer')
  echo "✓ PASS: Realm '${KEYCLOAK_REALM}' exists"
  echo "  Issuer: ${ISSUER}"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  echo "✗ FAIL: Realm '${KEYCLOAK_REALM}' not found or not accessible"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi
echo ""

# Test 3: JWKS endpoint accessible
echo "Test 3: JWKS Endpoint"
JWKS_URL="${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/certs"
JWKS_RESPONSE=$(curl -s "$JWKS_URL")
if echo "$JWKS_RESPONSE" | jq -e '.keys' > /dev/null 2>&1; then
  KEY_COUNT=$(echo "$JWKS_RESPONSE" | jq '.keys | length')
  echo "✓ PASS: JWKS endpoint accessible"
  echo "  URL: ${JWKS_URL}"
  echo "  Keys available: ${KEY_COUNT}"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  echo "✗ FAIL: JWKS endpoint not accessible"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi
echo ""

# Test 4: Token exchange grant type supported
echo "Test 4: Token Exchange Support"
TOKEN_EXCHANGE=$(echo "$REALM_RESPONSE" | jq -r '.grant_types_supported[] | select(. == "urn:ietf:params:oauth:grant-type:token-exchange")' 2>/dev/null)
if [ -n "$TOKEN_EXCHANGE" ]; then
  echo "✓ PASS: Token exchange grant type is supported"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  echo "⚠ WARNING: Token exchange grant type may not be supported"
  echo "  Check if it's enabled at the client level"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi
echo ""

# Test 5: contextflow client can authenticate
echo "Test 5: Client 'contextflow' Authentication"
if [ -n "$TEST_USER_USERNAME" ] && [ -n "$TEST_USER_PASSWORD" ]; then
  AUTH_RESPONSE=$(curl -s -X POST \
    "${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token" \
    -d "grant_type=password" \
    -d "client_id=${KEYCLOAK_CLIENT_ID_CONTEXTFLOW}" \
    -d "username=${TEST_USER_USERNAME}" \
    -d "password=${TEST_USER_PASSWORD}" 2>&1)

  if echo "$AUTH_RESPONSE" | jq -e '.access_token' > /dev/null 2>&1; then
    echo "✓ PASS: Client 'contextflow' can obtain tokens"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    ERROR_MSG=$(echo "$AUTH_RESPONSE" | jq -r '.error_description // .error // "Unknown error"')
    echo "✗ FAIL: Cannot obtain token from 'contextflow' client"
    echo "  Error: ${ERROR_MSG}"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
else
  echo "⚠ SKIP: No test user credentials configured"
fi
echo ""

# Test 6: mcp-oauth client credentials
echo "Test 6: Client 'mcp-oauth' Credentials"
if [ -n "$KEYCLOAK_CLIENT_SECRET_MCP" ]; then
  TOKEN_RESPONSE=$(curl -s -X POST \
    "${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token" \
    -u "${KEYCLOAK_CLIENT_ID_MCP}:${KEYCLOAK_CLIENT_SECRET_MCP}" \
    -d "grant_type=client_credentials" 2>&1)

  if echo "$TOKEN_RESPONSE" | jq -e '.access_token' > /dev/null 2>&1; then
    echo "✓ PASS: Client 'mcp-oauth' credentials are valid"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    ERROR_MSG=$(echo "$TOKEN_RESPONSE" | jq -r '.error_description // .error // "Unknown error"')
    echo "✗ FAIL: Invalid credentials for 'mcp-oauth' client"
    echo "  Error: ${ERROR_MSG}"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
else
  echo "⚠ WARNING: mcp-oauth client secret not configured in test.env"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi
echo ""

# Summary
echo "========================================="
echo "Verification Summary"
echo "========================================="
echo "Passed: ${PASS_COUNT}"
echo "Failed: ${FAIL_COUNT}"
echo ""

if [ $FAIL_COUNT -eq 0 ]; then
  echo "✓ All checks passed! Keycloak is configured correctly."
  echo ""
  echo "You can now run the OAuth delegation tests:"
  echo "  ./scripts/1-get-subject-token.sh"
  echo "  ./scripts/2-exchange-token.sh"
  echo "  ./scripts/3-test-mcp-tools.sh"
  exit 0
else
  echo "✗ Some checks failed. Please review configuration."
  echo ""
  echo "Refer to:"
  echo "  - Docs/oauth2 details.docx for Keycloak setup"
  echo "  - test-harness/keycloak-reference/KEYCLOAK-SETUP.md"
  exit 1
fi