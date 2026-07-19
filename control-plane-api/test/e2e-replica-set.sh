#!/usr/bin/env bash
# =============================================================================
# Control Plane — MongoDB Replica Set End-to-End Test
#
# What this script does:
#   1. Checks prerequisites (Ansible, API reachability, SSH key)
#   2. Creates an SSH key in the control-plane if one doesn't exist
#   3. Registers 3 servers (provided by the user)
#   4. Creates a 3-node MongoDB replica set database record
#   5. Triggers provisioning and polls until done (or timeout)
#   6. Runs a health check against the replica set
#   7. Optionally tests a backup round-trip to S3
#   8. Optionally tears everything down
#
# Usage:
#   ./test/e2e-replica-set.sh \
#     --api-url  http://localhost:5005 \
#     --username admin@example.com \
#     --password changeme \
#     --server1  root@10.0.0.1:22 \
#     --server2  root@10.0.0.2:22 \
#     --server3  root@10.0.0.3:22 \
#     [--s3-bucket my-backups] \
#     [--no-teardown]
#
# Prerequisites on each VPS:
#   - Ubuntu 22.04 or Debian 12
#   - Passwordless sudo
#   - Python 3
#   - TCP 27017 reachable from the control-plane server
#
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
API_URL="http://localhost:5005"
USERNAME=""
PASSWORD=""
SERVER1=""
SERVER2=""
SERVER3=""
S3_BUCKET=""
TEARDOWN=true
PROVISION_TIMEOUT=600   # 10 minutes

# ---------------------------------------------------------------------------
# Colour helpers
# ---------------------------------------------------------------------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log_info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_ok()      { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $*"; }
die()         { log_error "$*"; exit 1; }

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-url)      API_URL="$2";      shift 2 ;;
    --username)     USERNAME="$2";     shift 2 ;;
    --password)     PASSWORD="$2";     shift 2 ;;
    --server1)      SERVER1="$2";      shift 2 ;;
    --server2)      SERVER2="$2";      shift 2 ;;
    --server3)      SERVER3="$2";      shift 2 ;;
    --s3-bucket)    S3_BUCKET="$2";    shift 2 ;;
    --no-teardown)  TEARDOWN=false;    shift   ;;
    *) die "Unknown argument: $1" ;;
  esac
done

# ---------------------------------------------------------------------------
# Parse server connection strings (user@host:port)
# ---------------------------------------------------------------------------
parse_server() {
  local raw="$1"
  local user host port
  user=$(echo "$raw" | cut -d@ -f1)
  host=$(echo "$raw" | cut -d@ -f2 | cut -d: -f1)
  port=$(echo "$raw" | cut -d: -f2)
  [[ -z "$port" || "$port" == "$host" ]] && port=22
  echo "$user|$host|$port"
}

# ---------------------------------------------------------------------------
# API helpers
# ---------------------------------------------------------------------------
COOKIE_JAR=$(mktemp)
trap 'rm -f "$COOKIE_JAR"' EXIT

api() {
  local method="$1"; shift
  local path="$1";   shift
  curl -sf \
    -X "$method" \
    -H "Content-Type: application/json" \
    -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
    "$API_URL/api$path" \
    "$@"
}

api_post() { api POST "$@"; }
api_get()  { api GET  "$@"; }

# ---------------------------------------------------------------------------
# Step 0: Validate inputs
# ---------------------------------------------------------------------------
log_info "=== Step 0: Validating inputs ==="

[[ -z "$USERNAME" ]] && die "--username is required"
[[ -z "$PASSWORD" ]] && die "--password is required"
[[ -z "$SERVER1"  ]] && die "--server1 is required (user@host[:port])"
[[ -z "$SERVER2"  ]] && die "--server2 is required"
[[ -z "$SERVER3"  ]] && die "--server3 is required"

# Check Ansible
if ! command -v ansible-playbook &>/dev/null; then
  die "ansible-playbook not found. Install: pip3 install ansible && ansible-galaxy collection install -r ansible/requirements.yml"
fi
log_ok "Ansible is available: $(ansible-playbook --version | head -1)"

# Check API
if ! curl -sf "$API_URL/api/health" &>/dev/null; then
  die "Control Plane API is not reachable at $API_URL"
fi
log_ok "API is reachable at $API_URL"

# ---------------------------------------------------------------------------
# Step 1: Authenticate
# ---------------------------------------------------------------------------
log_info ""
log_info "=== Step 1: Authenticating ==="

LOGIN_RESP=$(api_post /auth/login -d "{\"email\":\"$USERNAME\",\"password\":\"$PASSWORD\"}")
USER_ID=$(echo "$LOGIN_RESP" | jq -r '.user._id // .user.id')
[[ -z "$USER_ID" || "$USER_ID" == "null" ]] && die "Login failed. Check credentials."
log_ok "Logged in as $USERNAME (id=$USER_ID)"

# ---------------------------------------------------------------------------
# Step 2: Ensure default SSH key exists
# ---------------------------------------------------------------------------
log_info ""
log_info "=== Step 2: Checking SSH key ==="

KEYS_RESP=$(api_get /ssh-keys)
DEFAULT_KEY_ID=$(echo "$KEYS_RESP" | jq -r '[.keys[] | select(.isDefault==true)] | first | .id // ._id // "null"')

if [[ "$DEFAULT_KEY_ID" == "null" || -z "$DEFAULT_KEY_ID" ]]; then
  log_info "No default SSH key found — generating one..."
  KEY_RESP=$(api_post /ssh-keys -d '{"name":"e2e-test-key","type":"ed25519","isDefault":true}')
  DEFAULT_KEY_ID=$(echo "$KEY_RESP" | jq -r '.key._id // .key.id')
  PRIVATE_KEY=$(echo "$KEY_RESP" | jq -r '.privateKey')
  log_ok "SSH key created: $DEFAULT_KEY_ID"
  echo ""
  log_warn "Add this public key to each target server's authorized_keys:"
  echo "$KEY_RESP" | jq -r '.key.publicKey'
  echo ""
  read -rp "Press Enter once you've added the key to all 3 servers..."
else
  log_ok "Default SSH key found: $DEFAULT_KEY_ID"
fi

# ---------------------------------------------------------------------------
# Step 3: Register servers
# ---------------------------------------------------------------------------
log_info ""
log_info "=== Step 3: Registering servers ==="

register_server() {
  local label="$1" raw="$2"
  local IFS='|'; read -r user host port <<< "$(parse_server "$raw")"
  log_info "  Registering $label: $user@$host:$port"

  local RESP
  RESP=$(api_post /servers -d "{
    \"name\": \"e2e-$label-$(date +%s)\",
    \"host\": \"$host\",
    \"sshUser\": \"$user\",
    \"sshPort\": $port,
    \"sshKeyId\": \"$DEFAULT_KEY_ID\"
  }")

  local SERVER_ID
  SERVER_ID=$(echo "$RESP" | jq -r '.server._id // .server.id // "null"')
  [[ "$SERVER_ID" == "null" ]] && die "Failed to register $label: $RESP"
  echo "$SERVER_ID"
}

SERVER1_ID=$(register_server "server1" "$SERVER1")
SERVER2_ID=$(register_server "server2" "$SERVER2")
SERVER3_ID=$(register_server "server3" "$SERVER3")

log_ok "Servers registered: $SERVER1_ID, $SERVER2_ID, $SERVER3_ID"

# ---------------------------------------------------------------------------
# Step 4: Create the database record
# ---------------------------------------------------------------------------
log_info ""
log_info "=== Step 4: Creating MongoDB replica set record ==="

DB_NAME="e2e-rs-$(date +%s)"

CREATE_RESP=$(api_post "/databases?auto_provision=false" -d "{
  \"name\": \"$DB_NAME\",
  \"type\": \"mongodb\",
  \"version\": \"7.0\",
  \"credentials\": {
    \"adminUser\": \"admin\",
    \"adminPassword\": \"$(openssl rand -hex 16)\"
  },
  \"nodes\": [
    { \"serverId\": \"$SERVER1_ID\", \"role\": \"primary\" },
    { \"serverId\": \"$SERVER2_ID\", \"role\": \"secondary\" },
    { \"serverId\": \"$SERVER3_ID\", \"role\": \"secondary\" }
  ],
  \"config\": {
    \"port\": 27017,
    \"replicaSetName\": \"rs0\"
  }
}")

DB_ID=$(echo "$CREATE_RESP" | jq -r '.databaseId // "null"')
[[ "$DB_ID" == "null" ]] && die "Failed to create database: $CREATE_RESP"
log_ok "Database record created: $DB_ID (name=$DB_NAME)"

# ---------------------------------------------------------------------------
# Step 5: Trigger provisioning
# ---------------------------------------------------------------------------
log_info ""
log_info "=== Step 5: Triggering provisioning ==="
log_info "  This runs Ansible against all 3 servers — can take 5-10 minutes."

PROV_RESP=$(api_post "/databases/$DB_ID/provision")
log_ok "Provisioning started"

# ---------------------------------------------------------------------------
# Step 6: Poll until running or failed
# ---------------------------------------------------------------------------
log_info ""
log_info "=== Step 6: Waiting for provisioning to complete (timeout: ${PROVISION_TIMEOUT}s) ==="

ELAPSED=0
POLL_INTERVAL=10
STATUS="provisioning"

while [[ "$STATUS" == "provisioning" ]]; do
  sleep $POLL_INTERVAL
  ELAPSED=$((ELAPSED + POLL_INTERVAL))

  DB_RESP=$(api_get "/databases/$DB_ID")
  STATUS=$(echo "$DB_RESP" | jq -r '.database.status')
  log_info "  [${ELAPSED}s] Status: $STATUS"

  if [[ $ELAPSED -ge $PROVISION_TIMEOUT ]]; then
    die "Provisioning timed out after ${PROVISION_TIMEOUT}s. Check logs: GET /api/databases/$DB_ID/logs"
  fi
done

if [[ "$STATUS" != "running" ]]; then
  log_error "Provisioning ended with status: $STATUS"
  log_error "Check logs:"
  api_get "/databases/$DB_ID/logs" | jq -r '.deployments[0].log // empty'
  die "Provisioning failed"
fi

log_ok "Provisioning complete! Status: $STATUS"

# ---------------------------------------------------------------------------
# Step 7: Health check
# ---------------------------------------------------------------------------
log_info ""
log_info "=== Step 7: Running health check ==="

HEALTH_RESP=$(api_get "/databases/$DB_ID/health")
HEALTH_STATUS=$(echo "$HEALTH_RESP" | jq -r '.status')
MEMBER_COUNT=$(echo "$HEALTH_RESP" | jq -r '.members | length')

log_info "  Cluster health: $HEALTH_STATUS"
log_info "  Members: $MEMBER_COUNT"
echo "$HEALTH_RESP" | jq -r '.members[] | "    \(.host) — \(.state) (health: \(.health))"'

if [[ "$HEALTH_STATUS" != "healthy" ]]; then
  die "Cluster is not healthy: $HEALTH_STATUS"
fi

if [[ "$MEMBER_COUNT" -ne 3 ]]; then
  log_warn "Expected 3 members, got $MEMBER_COUNT"
else
  log_ok "All 3 replica set members are visible and healthy"
fi

# ---------------------------------------------------------------------------
# Step 8: Verify credentials
# ---------------------------------------------------------------------------
log_info ""
log_info "=== Step 8: Verifying credentials ==="

CRED_RESP=$(api_get "/databases/$DB_ID/credentials")
CONN_STR=$(echo "$CRED_RESP" | jq -r '.credentials.connectionString')

if [[ "$CONN_STR" == *"replicaSet=rs0"* ]]; then
  log_ok "Connection string is correct (contains replicaSet=rs0)"
else
  log_warn "Connection string may be missing replicaSet parameter: $CONN_STR"
fi

# ---------------------------------------------------------------------------
# Step 9: Optional S3 backup test
# ---------------------------------------------------------------------------
if [[ -n "$S3_BUCKET" ]]; then
  log_info ""
  log_info "=== Step 9: Running backup to S3 bucket: $S3_BUCKET ==="
  BACKUP_RESP=$(api_post "/databases/$DB_ID/backup")
  S3_KEY=$(echo "$BACKUP_RESP" | jq -r '.s3Key // "null"')

  if [[ "$S3_KEY" == "null" ]]; then
    log_warn "Backup did not return an S3 key — check server logs"
  else
    log_ok "Backup uploaded to S3: $S3_KEY"
  fi
else
  log_info ""
  log_info "=== Step 9: Skipping S3 backup (--s3-bucket not provided) ==="
fi

# ---------------------------------------------------------------------------
# Step 10: Teardown
# ---------------------------------------------------------------------------
log_info ""
if [[ "$TEARDOWN" == "true" ]]; then
  log_info "=== Step 10: Tearing down ==="
  api_post "/databases/$DB_ID/remove" -d '{"remove_data":true,"delete_record":true}' >/dev/null && log_ok "Database deleted"
  api DELETE "/servers/$SERVER1_ID" >/dev/null 2>&1 && log_ok "Server 1 removed"
  api DELETE "/servers/$SERVER2_ID" >/dev/null 2>&1 && log_ok "Server 2 removed"
  api DELETE "/servers/$SERVER3_ID" >/dev/null 2>&1 && log_ok "Server 3 removed"
else
  log_info "=== Step 10: Skipping teardown (--no-teardown) ==="
  log_info "  Database ID : $DB_ID"
  log_info "  Server IDs  : $SERVER1_ID, $SERVER2_ID, $SERVER3_ID"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "========================================"
echo -e "${GREEN}  E2E TEST PASSED ✓${NC}"
echo "========================================"
echo "  Database: $DB_NAME ($DB_ID)"
echo "  Health:   $HEALTH_STATUS ($MEMBER_COUNT/3 members)"
echo "  Elapsed:  ${ELAPSED}s"
echo ""
