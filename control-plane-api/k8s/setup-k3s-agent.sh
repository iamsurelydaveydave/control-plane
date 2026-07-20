#!/bin/bash
# =============================================================================
# K3s Agent Installation Script
# Run this on database servers to join them to the K3s cluster
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
K3S_SERVER_URL=""
K3S_TOKEN=""
NODE_NAME=""
NODE_LABELS=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server-url)  K3S_SERVER_URL="$2"; shift 2 ;;
    --token)       K3S_TOKEN="$2";      shift 2 ;;
    --node-name)   NODE_NAME="$2";      shift 2 ;;
    --labels)      NODE_LABELS="$2";    shift 2 ;;
    *) log_error "Unknown argument: $1"; exit 1 ;;
  esac
done

if [[ -z "$K3S_SERVER_URL" ]]; then
  log_error "--server-url is required (e.g., https://10.0.0.1:6443)"
  exit 1
fi

if [[ -z "$K3S_TOKEN" ]]; then
  log_error "--token is required (get from /var/lib/rancher/k3s/server/node-token on server)"
  exit 1
fi

# ---------------------------------------------------------------------------
# Check if running as root
# ---------------------------------------------------------------------------
if [[ $EUID -ne 0 ]]; then
  log_error "This script must be run as root"
  exit 1
fi

# ---------------------------------------------------------------------------
# Build K3s agent options
# ---------------------------------------------------------------------------
K3S_OPTS=""

if [[ -n "$NODE_NAME" ]]; then
  K3S_OPTS="$K3S_OPTS --node-name $NODE_NAME"
fi

if [[ -n "$NODE_LABELS" ]]; then
  # Labels should be comma-separated: role=database,zone=us-east-1
  for label in ${NODE_LABELS//,/ }; do
    K3S_OPTS="$K3S_OPTS --node-label $label"
  done
fi

# ---------------------------------------------------------------------------
# Install K3s Agent
# ---------------------------------------------------------------------------
log_info "Installing K3s agent..."
log_info "  Server: $K3S_SERVER_URL"
log_info "  Node name: ${NODE_NAME:-<auto>}"
log_info "  Labels: ${NODE_LABELS:-<none>}"

curl -sfL https://get.k3s.io | K3S_URL="$K3S_SERVER_URL" K3S_TOKEN="$K3S_TOKEN" sh -s - agent $K3S_OPTS

# Wait for agent to be ready
log_info "Waiting for K3s agent to connect..."
sleep 10

# Check if agent service is running
if systemctl is-active --quiet k3s-agent; then
  log_info "K3s agent is running!"
else
  log_error "K3s agent failed to start"
  journalctl -u k3s-agent --no-pager -n 50
  exit 1
fi

# ---------------------------------------------------------------------------
# Output info
# ---------------------------------------------------------------------------
echo ""
echo "=============================================="
echo -e "${GREEN}K3s Agent Setup Complete!${NC}"
echo "=============================================="
echo ""
echo "This node has joined the K3s cluster."
echo ""
echo "Verify on the control plane server with:"
echo "  kubectl get nodes"
echo ""
