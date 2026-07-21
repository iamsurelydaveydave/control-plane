#!/bin/bash
# status.sh — Check latest deployment status
# Usage: ./status.sh <app-id>
#
# Environment variables:
#   CONTROL_PLANE_URL    - Base URL of Control Plane API (default: http://localhost:5005)
#   CONTROL_PLANE_TOKEN  - API token with deployments:read scope (required)

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

# Validate inputs
if [ -z "$TOKEN" ]; then
  echo -e "${RED}Error: CONTROL_PLANE_TOKEN environment variable not set${NC}"
  exit 1
fi

if [ -z "$APP_ID" ]; then
  echo "Usage: $0 <app-id>"
  exit 1
fi

# Get deployment status
RESPONSE=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "$API_URL/api/apps/$APP_ID/deployments/latest")

# Try to pretty-print JSON
if command -v jq &> /dev/null; then
  STATUS=$(echo "$RESPONSE" | jq -r '.status' 2>/dev/null || echo "unknown")
  
  echo "$RESPONSE" | jq .
  echo ""
  
  case "$STATUS" in
    success)
      echo -e "${GREEN}✓ Deployment succeeded${NC}"
      ;;
    failed)
      echo -e "${RED}✗ Deployment failed${NC}"
      ;;
    running|pending)
      echo -e "${YELLOW}⟳ Deployment in progress${NC}"
      ;;
    none)
      echo -e "${YELLOW}No deployments found${NC}"
      ;;
    *)
      echo "Status: $STATUS"
      ;;
  esac
else
  echo "$RESPONSE"
fi
