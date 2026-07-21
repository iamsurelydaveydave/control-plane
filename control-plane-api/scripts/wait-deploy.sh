#!/bin/bash
# wait-deploy.sh — Wait for deployment to complete
# Usage: ./wait-deploy.sh <app-id> [timeout-seconds]
#
# Environment variables:
#   CONTROL_PLANE_URL    - Base URL of Control Plane API (default: http://localhost:5005)
#   CONTROL_PLANE_TOKEN  - API token with deployments:read scope (required)
#
# Exit codes:
#   0 - Deployment succeeded
#   1 - Deployment failed
#   2 - Timeout

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
API_URL="${CONTROL_PLANE_URL:-http://localhost:5005}"
TOKEN="${CONTROL_PLANE_TOKEN}"
APP_ID="$1"
TIMEOUT="${2:-300}"
POLL_INTERVAL="${POLL_INTERVAL:-5}"

# Validate inputs
if [ -z "$TOKEN" ]; then
  echo -e "${RED}Error: CONTROL_PLANE_TOKEN environment variable not set${NC}"
  exit 1
fi

if [ -z "$APP_ID" ]; then
  echo "Usage: $0 <app-id> [timeout-seconds]"
  echo ""
  echo "Arguments:"
  echo "  app-id           The ID of the app (required)"
  echo "  timeout-seconds  Maximum wait time (optional, default: 300)"
  echo ""
  echo "Environment:"
  echo "  POLL_INTERVAL    Seconds between status checks (default: 5)"
  exit 1
fi

echo -e "${YELLOW}Waiting for deployment to complete (timeout: ${TIMEOUT}s)...${NC}"
echo ""

END=$((SECONDS + TIMEOUT))
LAST_STATUS=""

while [ $SECONDS -lt $END ]; do
  # Get current status
  if command -v jq &> /dev/null; then
    RESPONSE=$(curl -s -H "Authorization: Bearer $TOKEN" \
      "$API_URL/api/apps/$APP_ID/deployments/latest")
    STATUS=$(echo "$RESPONSE" | jq -r '.status' 2>/dev/null || echo "unknown")
    VERSION=$(echo "$RESPONSE" | jq -r '.version' 2>/dev/null || echo "")
    DURATION=$(echo "$RESPONSE" | jq -r '.duration // empty' 2>/dev/null || echo "")
  else
    RESPONSE=$(curl -s -H "Authorization: Bearer $TOKEN" \
      "$API_URL/api/apps/$APP_ID/deployments/latest")
    STATUS="unknown"
  fi
  
  # Only print if status changed
  if [ "$STATUS" != "$LAST_STATUS" ]; then
    ELAPSED=$((SECONDS))
    echo "[${ELAPSED}s] Status: $STATUS"
    LAST_STATUS="$STATUS"
  fi
  
  case "$STATUS" in
    success)
      echo ""
      if [ -n "$DURATION" ]; then
        DURATION_SEC=$((DURATION / 1000))
        echo -e "${GREEN}✓ Deployment succeeded in ${DURATION_SEC}s${NC}"
      else
        echo -e "${GREEN}✓ Deployment succeeded!${NC}"
      fi
      exit 0
      ;;
    failed)
      echo ""
      echo -e "${RED}✗ Deployment failed!${NC}"
      # Print logs if available
      if command -v jq &> /dev/null; then
        LOGS=$(echo "$RESPONSE" | jq -r '.logs // empty' 2>/dev/null)
        if [ -n "$LOGS" ]; then
          echo ""
          echo "Logs:"
          echo "$LOGS" | tail -20
        fi
      fi
      exit 1
      ;;
    none)
      echo -e "${YELLOW}No active deployment found${NC}"
      exit 0
      ;;
  esac
  
  sleep "$POLL_INTERVAL"
done

echo ""
echo -e "${RED}Timeout waiting for deployment (${TIMEOUT}s)${NC}"
exit 2
