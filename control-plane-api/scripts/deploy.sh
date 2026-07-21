#!/bin/bash
# deploy.sh — Deploy an app to Control Plane
# Usage: ./deploy.sh <app-id> [version]
#
# Environment variables:
#   CONTROL_PLANE_URL    - Base URL of Control Plane API (default: http://localhost:5005)
#   CONTROL_PLANE_TOKEN  - API token with deployments:write scope (required)
#
# Examples:
#   ./deploy.sh abc123def456 v1.2.0
#   ./deploy.sh abc123def456 $(git rev-parse HEAD)
#   CONTROL_PLANE_TOKEN=cp_xxx ./deploy.sh abc123def456

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
VERSION="${2:-latest}"

# Validate inputs
if [ -z "$TOKEN" ]; then
  echo -e "${RED}Error: CONTROL_PLANE_TOKEN environment variable not set${NC}"
  echo ""
  echo "Get a token from Control Plane Settings → API Tokens"
  echo "Required scope: deployments:write"
  exit 1
fi

if [ -z "$APP_ID" ]; then
  echo "Usage: $0 <app-id> [version]"
  echo ""
  echo "Arguments:"
  echo "  app-id    The ID of the app to deploy (required)"
  echo "  version   Version/tag to deploy (optional, default: latest)"
  echo ""
  echo "Examples:"
  echo "  $0 abc123def456 v1.2.0"
  echo "  $0 abc123def456 \$(git rev-parse HEAD)"
  exit 1
fi

echo -e "${YELLOW}Deploying version '${VERSION}' to app '${APP_ID}'...${NC}"
echo ""

# Trigger deployment
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"version\": \"$VERSION\"}" \
  "$API_URL/api/apps/$APP_ID/deploy")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

# Try to pretty-print JSON, fallback to raw output
if command -v jq &> /dev/null; then
  echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
else
  echo "$BODY"
fi

echo ""

# Check for errors
if [ "$HTTP_CODE" -ge 400 ]; then
  echo -e "${RED}Error: HTTP $HTTP_CODE${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Deployment triggered successfully!${NC}"
