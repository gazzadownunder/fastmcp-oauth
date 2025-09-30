#!/bin/bash
# Exchange Subject Token for Delegated Token using "mcp-oauth" client
# This implements Phase 2 of the OAuth delegation flow (RFC 8693)

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
echo "OAuth Delegation Test - Phase 2"
echo "Token Exchange (RFC 8693)"
echo "========================================="
echo ""

# Check if subject token exists
if [ ! -f .subject-token ]; then
  echo "✗ Error: Subject token not found"
  echo "Please run ./scripts/1-get-subject-token.sh first"
  exit 1
fi

SUBJECT_TOKEN=$(cat .subject-token)

echo "Exchange Details:"
echo "Client: ${KEYCLOAK_CLIENT_ID_MCP}"
echo "Target Audience: mcp-oauth"
echo "Grant Type: urn:ietf:params:oauth:grant-type:token-exchange"
echo ""
echo "Performing token exchange..."

# RFC 8693 Token Exchange
EXCHANGE_RESPONSE=$(curl -s -X POST \
  "${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -u "${KEYCLOAK_CLIENT_ID_MCP}:${KEYCLOAK_CLIENT_SECRET_MCP}" \
  -d "grant_type=urn:ietf:params:oauth:grant-type:token-exchange" \
  -d "subject_token=${SUBJECT_TOKEN}" \
  -d "subject_token_type=urn:ietf:params:oauth:token-type:access_token" \
  -d "audience=mcp-oauth" \
  -d "requested_token_type=urn:ietf:params:oauth:token-type:access_token")

# Check for errors
if echo "$EXCHANGE_RESPONSE" | jq -e '.error' > /dev/null 2>&1; then
  echo ""
  echo "✗ Token exchange failed:"
  echo "$EXCHANGE_RESPONSE" | jq .
  echo ""
  echo "Common issues:"
  echo "  1. Token exchange grant not enabled on mcp-oauth client"
  echo "  2. Invalid client secret"
  echo "  3. Subject token expired"
  echo "  4. Audience not configured correctly"
  exit 1
fi

# Extract exchanged token
EXCHANGED_TOKEN=$(echo "$EXCHANGE_RESPONSE" | jq -r '.access_token')

if [ -z "$EXCHANGED_TOKEN" ] || [ "$EXCHANGED_TOKEN" == "null" ]; then
  echo ""
  echo "✗ Failed to extract exchanged token"
  echo "Response: $EXCHANGE_RESPONSE"
  exit 1
fi

# Save exchanged token
echo "$EXCHANGED_TOKEN" > .exchanged-token

echo ""
echo "✓ Token exchange successful!"
echo ""
echo "Exchanged Token saved to: .exchanged-token"
echo ""

# Decode and display token claims
echo "========================================="
echo "Exchanged Token Claims:"
echo "========================================="
PAYLOAD=$(echo "$EXCHANGED_TOKEN" | cut -d'.' -f2 | base64 -d 2>/dev/null || echo "{}")
echo "$PAYLOAD" | jq .

# Extract and display key claims
AZP=$(echo "$PAYLOAD" | jq -r '.azp // "N/A"')
AUD=$(echo "$PAYLOAD" | jq -r '.aud // "N/A"')
ISS=$(echo "$PAYLOAD" | jq -r '.iss // "N/A"')
SUB=$(echo "$PAYLOAD" | jq -r '.sub // "N/A"')
LEGACY_USER=$(echo "$PAYLOAD" | jq -r '.legacy_sam_account // "N/A"')
ACT=$(echo "$PAYLOAD" | jq -r '.act // "N/A"')

echo ""
echo "========================================="
echo "Key Claims Comparison:"
echo "========================================="
echo "Issuer (iss):           $ISS"
echo "Audience (aud):         $AUD"
echo "Authorized Party (azp): $AZP"
echo "Subject (sub):          $SUB"
echo "Legacy Username:        $LEGACY_USER"
if [ "$ACT" != "N/A" ]; then
  echo "Actor (act):            $ACT"
fi
echo ""

# Critical security validation: azp claim must be "mcp-oauth"
echo "========================================="
echo "Security Validation:"
echo "========================================="

if [ "$AZP" == "mcp-oauth" ]; then
  echo "✓ PASS: azp claim is 'mcp-oauth' (correct for exchanged token)"
  echo "  This token can be accepted by the resource server"
else
  echo "✗ FAIL: azp claim is '${AZP}', expected 'mcp-oauth'"
  echo "  WARNING: This may indicate token exchange did not work correctly"
  exit 1
fi

if [[ "$AUD" == *"mcp-oauth"* ]]; then
  echo "✓ PASS: Audience includes 'mcp-oauth'"
else
  echo "⚠ WARNING: Audience does not include 'mcp-oauth': ${AUD}"
fi

echo ""
echo "========================================="
echo "Next Step:"
echo "========================================="
echo "Run: ./scripts/3-test-mcp-tools.sh"
echo "Or start the MCP server and test manually"
echo ""