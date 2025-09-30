#!/bin/bash
# Get Subject Token from Web Application
# This script expects you to obtain a token from the web application first

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

# Load configuration
if [ ! -f config/test.env ]; then
  echo "Error: config/test.env not found"
  echo "Please copy config/test.env.example to config/test.env and configure it"
  exit 1
fi

source config/test.env

echo "========================================="
echo "OAuth Delegation Test - Phase 1"
echo "Get Subject Token from Web Application"
echo "========================================="
echo ""

echo "IMPORTANT: You need to obtain a token from the web application first!"
echo ""
echo "Steps to get your token:"
echo "1. Open the Sample-client-auth application in your browser"
echo "2. Click 'Login with Keycloak' and complete SSO authentication"
echo "3. Open browser DevTools (F12)"
echo "4. In the Console tab, type: keycloak.token"
echo "5. Copy the token value (long string of characters)"
echo "6. Paste it below when prompted"
echo ""

# Check if token is provided as first argument
if [ -n "$1" ]; then
  SUBJECT_TOKEN="$1"
  echo "Using token provided as argument..."
else
  # Prompt for token
  echo "Paste your access token here (or press Ctrl+C to cancel):"
  read -r SUBJECT_TOKEN
fi

# Validate token format (should be JWT with 3 parts)
TOKEN_PARTS=$(echo "$SUBJECT_TOKEN" | tr '.' '\n' | wc -l)
if [ "$TOKEN_PARTS" -ne 3 ]; then
  echo ""
  echo "✗ Invalid token format. JWT tokens should have 3 parts separated by dots."
  echo "Make sure you copied the entire token."
  exit 1
fi

# Save token to file
echo "$SUBJECT_TOKEN" > .subject-token
echo ""
echo "✓ Token saved successfully"

# Decode and display JWT claims
PAYLOAD=$(echo "$SUBJECT_TOKEN" | cut -d. -f2)
# Add padding if needed
case $((${#PAYLOAD} % 4)) in
  2) PAYLOAD="${PAYLOAD}==" ;;
  3) PAYLOAD="${PAYLOAD}=" ;;
esac

DECODED=$(echo "$PAYLOAD" | base64 -d 2>/dev/null || echo "$PAYLOAD" | base64 -D 2>/dev/null)

if [ -n "$DECODED" ]; then
  echo ""
  echo "Subject Token Claims:"
  echo "$DECODED" | jq -C '.'

  # Extract and validate critical claims
  ISS=$(echo "$DECODED" | jq -r '.iss // "NOT_PRESENT"')
  AUD=$(echo "$DECODED" | jq -r '.aud // "NOT_PRESENT"')
  AZP=$(echo "$DECODED" | jq -r '.azp // "NOT_PRESENT"')
  SUB=$(echo "$DECODED" | jq -r '.sub // "NOT_PRESENT"')
  EXP=$(echo "$DECODED" | jq -r '.exp // "NOT_PRESENT"')

  echo ""
  echo "Key Claims:"
  echo "  iss (issuer): $ISS"
  echo "  aud (audience): $AUD"
  echo "  azp (authorized party): $AZP"
  echo "  sub (subject): $SUB"

  # Check if token is expired
  if [ "$EXP" != "NOT_PRESENT" ]; then
    CURRENT_TIME=$(date +%s)
    if [ "$EXP" -lt "$CURRENT_TIME" ]; then
      echo ""
      echo "⚠ WARNING: Token is EXPIRED!"
      echo "You need to obtain a fresh token from the web application."
      exit 1
    else
      TIME_LEFT=$((EXP - CURRENT_TIME))
      echo "  Token expires in: ${TIME_LEFT}s"
    fi
  fi

  # CRITICAL: Validate azp claim
  echo ""
  if [ "$AZP" = "${KEYCLOAK_CLIENT_ID_CONTEXTFLOW}" ]; then
    echo "✓ PASS: azp claim is '${KEYCLOAK_CLIENT_ID_CONTEXTFLOW}' (correct for subject token)"
  else
    echo "✗ FAIL: azp claim is '${AZP}', expected '${KEYCLOAK_CLIENT_ID_CONTEXTFLOW}'"
    echo ""
    echo "This token was not issued for the correct client."
    echo "Make sure you're using the token from the contextflow client."
    exit 1
  fi
fi

echo ""
echo "Token saved to: .subject-token"
echo ""
echo "Next step: Run ./2-exchange-token.sh to exchange this token"