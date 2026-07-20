#!/bin/bash
# =============================================================================
# K3s Server Installation Script
# Run this on the Control Plane server
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
# Check if running as root
# ---------------------------------------------------------------------------
if [[ $EUID -ne 0 ]]; then
  log_error "This script must be run as root"
  exit 1
fi

# ---------------------------------------------------------------------------
# Install K3s Server
# ---------------------------------------------------------------------------
log_info "Installing K3s server..."

curl -sfL https://get.k3s.io | sh -s - server \
  --disable traefik \
  --disable servicelb \
  --write-kubeconfig-mode 644 \
  --tls-san "$(hostname -I | awk '{print $1}')"

# Wait for K3s to be ready
log_info "Waiting for K3s to be ready..."
sleep 10

until kubectl get nodes &>/dev/null; do
  log_info "  Waiting for K3s API..."
  sleep 5
done

log_info "K3s server installed successfully!"

# ---------------------------------------------------------------------------
# Install Percona Operator
# ---------------------------------------------------------------------------
log_info "Installing Percona MongoDB Operator..."

kubectl apply --server-side -f https://raw.githubusercontent.com/percona/percona-server-mongodb-operator/v1.16.0/deploy/bundle.yaml

# Wait for operator to be ready
log_info "Waiting for Percona Operator to be ready..."
kubectl wait --for=condition=available --timeout=300s deployment/percona-server-mongodb-operator -n default || true

log_info "Percona Operator installed!"

# ---------------------------------------------------------------------------
# Create namespace for databases
# ---------------------------------------------------------------------------
log_info "Creating databases namespace..."
kubectl create namespace databases --dry-run=client -o yaml | kubectl apply -f -

# Install operator in databases namespace too
kubectl apply --server-side -f https://raw.githubusercontent.com/percona/percona-server-mongodb-operator/v1.16.0/deploy/bundle.yaml -n databases

# ---------------------------------------------------------------------------
# Output info
# ---------------------------------------------------------------------------
echo ""
echo "=============================================="
echo -e "${GREEN}K3s Server Setup Complete!${NC}"
echo "=============================================="
echo ""
echo "K3s Config: /etc/rancher/k3s/k3s.yaml"
echo ""
echo "Node Token (for adding agents):"
cat /var/lib/rancher/k3s/server/node-token
echo ""
echo "Server URL: https://$(hostname -I | awk '{print $1}'):6443"
echo ""
echo "Add this to your .env:"
echo "  K8S_ENABLED=true"
echo "  K8S_KUBECONFIG=/etc/rancher/k3s/k3s.yaml"
echo ""
echo "To add a database server as an agent:"
echo "  curl -sfL https://get.k3s.io | K3S_URL=https://$(hostname -I | awk '{print $1}'):6443 K3S_TOKEN=<token> sh -"
echo ""
