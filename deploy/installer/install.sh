#!/bin/bash
# Control Plane Installer
# https://get.controlplane.dev/install.sh
#
# Usage: curl -sfL https://get.controlplane.dev | sh
#
# Interactive installer for Control Plane - Coolify style
# Walks you through setting up a 3-node HA Kubernetes cluster

set -euo pipefail

# ==============================================================================
# Colors & Formatting
# ==============================================================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# ==============================================================================
# Helper Functions
# ==============================================================================
log_success() { echo -e "      ${GREEN}✓${NC} $1"; }
log_error() { echo -e "      ${RED}✗${NC} $1"; }
log_info() { echo -e "      ${DIM}$1${NC}"; }
log_step() { echo -e "\n${CYAN}[$1]${NC} $2"; }

print_banner() {
  echo -e "${MAGENTA}"
  cat << 'EOF'
╔═══════════════════════════════════════════════════════════════════════════════╗
║                                                                               ║
║     ██████╗ ██████╗ ███╗   ██╗████████╗██████╗  ██████╗ ██╗                   ║
║    ██╔════╝██╔═══██╗████╗  ██║╚══██╔══╝██╔══██╗██╔═══██╗██║                   ║
║    ██║     ██║   ██║██╔██╗ ██║   ██║   ██████╔╝██║   ██║██║                   ║
║    ██║     ██║   ██║██║╚██╗██║   ██║   ██╔══██╗██║   ██║██║                   ║
║    ╚██████╗╚██████╔╝██║ ╚████║   ██║   ██║  ██║╚██████╔╝███████╗              ║
║     ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝ ╚══════╝              ║
║                                                                               ║
║                      ██████╗ ██╗      █████╗ ███╗   ██╗███████╗               ║
║                      ██╔══██╗██║     ██╔══██╗████╗  ██║██╔════╝               ║
║                      ██████╔╝██║     ███████║██╔██╗ ██║█████╗                 ║
║                      ██╔═══╝ ██║     ██╔══██║██║╚██╗██║██╔══╝                 ║
║                      ██║     ███████╗██║  ██║██║ ╚████║███████╗               ║
║                      ╚═╝     ╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝               ║
║                                                                               ║
║                    Kubernetes-native PaaS Installer                           ║
║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝
EOF
  echo -e "${NC}"
}

print_separator() {
  echo -e "\n${DIM}─────────────────────────────────────────────────────────────────────────────────${NC}"
}

print_section() {
  print_separator
  echo -e " ${BOLD}$1${NC}"
  print_separator
}

prompt() {
  local var_name=$1
  local prompt_text=$2
  local default=${3:-}
  local is_secret=${4:-false}
  
  echo ""
  if [[ -n "$default" ]]; then
    echo -e "${prompt_text} ${DIM}[$default]${NC}:"
  else
    echo -e "${prompt_text}:"
  fi
  
  if [[ "$is_secret" == "true" ]]; then
    echo -ne "${GREEN}▸${NC} "
    read -s value
    echo "****"
  else
    echo -ne "${GREEN}▸${NC} "
    read value
  fi
  
  if [[ -z "$value" && -n "$default" ]]; then
    value="$default"
  fi
  
  eval "$var_name='$value'"
}

prompt_confirm() {
  local prompt_text=$1
  local default=${2:-y}
  
  echo ""
  echo -ne "${prompt_text} ${DIM}[Y/n]${NC} ${GREEN}▸${NC} "
  read -n 1 value
  echo ""
  
  value=${value:-$default}
  [[ "$value" =~ ^[Yy]$ ]]
}

mask_password() {
  local str=$1
  # Mask password in MongoDB URI
  echo "$str" | sed -E 's/(mongodb\+srv:\/\/[^:]+:)[^@]+(@)/\1****\2/'
}

# ==============================================================================
# SSH Functions
# ==============================================================================
SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 -o LogLevel=ERROR"

test_ssh() {
  local host=$1
  local key=$2
  ssh $SSH_OPTS -i "$key" "$host" "echo ok" &>/dev/null
}

remote() {
  local host=$1
  local key=$2
  shift 2
  ssh $SSH_OPTS -i "$key" "$host" "$@"
}

remote_sudo() {
  local host=$1
  local key=$2
  shift 2
  ssh $SSH_OPTS -i "$key" "$host" "sudo bash -c '$@'"
}

# ==============================================================================
# Main Installation
# ==============================================================================
main() {
  clear
  print_banner
  
  echo -e "Welcome! This will set up a ${BOLD}3-node HA Control Plane${NC} cluster."
  echo ""
  echo "Before we start, make sure you have:"
  echo -e "  ${GREEN}•${NC} 3 VMs ready (Ubuntu 22.04 recommended, 2+ vCPU, 4+ GB RAM)"
  echo -e "  ${GREEN}•${NC} SSH access to all 3 VMs (root or sudo user)"
  echo -e "  ${GREEN}•${NC} MongoDB Atlas connection string"
  echo -e "  ${GREEN}•${NC} Domain name pointed to master 1 IP (or load balancer)"
  echo ""
  echo -ne "Press ${BOLD}Enter${NC} to continue..."
  read
  
  # ============================================================================
  # STEP 1: Master Nodes
  # ============================================================================
  print_section "STEP 1: Master Nodes"
  
  prompt MASTER1 "Enter SSH connection for Master 1 (e.g., root@168.119.1.1)"
  prompt MASTER2 "Enter SSH connection for Master 2"
  prompt MASTER3 "Enter SSH connection for Master 3"
  
  # ============================================================================
  # STEP 2: Database
  # ============================================================================
  print_section "STEP 2: Database"
  
  prompt MONGODB_URI "Enter MongoDB Atlas connection string"
  
  # ============================================================================
  # STEP 3: Domain & SSL
  # ============================================================================
  print_section "STEP 3: Domain & SSL"
  
  prompt DOMAIN "Enter domain for Control Plane dashboard (e.g., cp.example.com)"
  prompt EMAIL "Enter email for Let's Encrypt SSL certificates"
  
  # ============================================================================
  # STEP 4: SSH Key
  # ============================================================================
  print_section "STEP 4: SSH Key"
  
  prompt SSH_KEY "Enter path to SSH private key" "$HOME/.ssh/id_rsa"
  
  # Expand ~ if present
  SSH_KEY="${SSH_KEY/#\~/$HOME}"
  
  if [[ ! -f "$SSH_KEY" ]]; then
    echo -e "\n${RED}Error: SSH key not found at $SSH_KEY${NC}"
    exit 1
  fi
  
  # ============================================================================
  # Summary
  # ============================================================================
  print_section "SUMMARY"
  echo ""
  echo -e "  ${BOLD}Master 1:${NC}     $MASTER1"
  echo -e "  ${BOLD}Master 2:${NC}     $MASTER2"
  echo -e "  ${BOLD}Master 3:${NC}     $MASTER3"
  echo -e "  ${BOLD}MongoDB:${NC}      $(mask_password "$MONGODB_URI")"
  echo -e "  ${BOLD}Domain:${NC}       $DOMAIN"
  echo -e "  ${BOLD}Email:${NC}        $EMAIL"
  echo -e "  ${BOLD}SSH Key:${NC}      $SSH_KEY"
  
  print_separator
  echo ""
  echo "Ready to install? This will:"
  echo -e "  ${CYAN}1.${NC} Install k3s on all 3 masters (HA cluster)"
  echo -e "  ${CYAN}2.${NC} Install cert-manager for SSL"
  echo -e "  ${CYAN}3.${NC} Install MongoDB operator"
  echo -e "  ${CYAN}4.${NC} Deploy Control Plane"
  
  if ! prompt_confirm "Proceed?"; then
    echo -e "\n${YELLOW}Installation cancelled.${NC}"
    exit 0
  fi
  
  # ============================================================================
  # Installation
  # ============================================================================
  echo ""
  echo -e "${BOLD}═══════════════════════════════════════════════════════════════════════════════${NC}"
  echo -e "${BOLD} INSTALLING${NC}"
  echo -e "${BOLD}═══════════════════════════════════════════════════════════════════════════════${NC}"
  
  # --------------------------------------------------------------------------
  # Test SSH connections
  # --------------------------------------------------------------------------
  log_step "1/7" "Testing SSH connections..."
  
  for host in "$MASTER1" "$MASTER2" "$MASTER3"; do
    if test_ssh "$host" "$SSH_KEY"; then
      log_success "$host"
    else
      log_error "$host - connection failed"
      echo -e "\n${RED}Error: Cannot connect to $host${NC}"
      echo "Please check:"
      echo "  • SSH key is correct"
      echo "  • VM is running"
      echo "  • Firewall allows SSH (port 22)"
      exit 1
    fi
  done
  
  # --------------------------------------------------------------------------
  # Install k3s on master 1
  # --------------------------------------------------------------------------
  log_step "2/7" "Installing k3s on master 1 (cluster-init)..."
  
  MASTER1_IP=$(echo "$MASTER1" | cut -d'@' -f2)
  
  remote "$MASTER1" "$SSH_KEY" "curl -sfL https://get.k3s.io | sh -s - server \
    --cluster-init \
    --tls-san $DOMAIN \
    --tls-san $MASTER1_IP \
    --disable servicelb \
    --write-kubeconfig-mode 644" >/dev/null 2>&1
  
  log_success "k3s installed"
  
  # Wait for k3s to be ready
  sleep 10
  remote "$MASTER1" "$SSH_KEY" "kubectl wait --for=condition=Ready node --all --timeout=120s" >/dev/null 2>&1
  log_success "Cluster initialized"
  
  # Get join token
  JOIN_TOKEN=$(remote "$MASTER1" "$SSH_KEY" "cat /var/lib/rancher/k3s/server/token")
  K3S_URL="https://$MASTER1_IP:6443"
  
  # --------------------------------------------------------------------------
  # Join master 2
  # --------------------------------------------------------------------------
  log_step "3/7" "Joining master 2..."
  
  remote "$MASTER2" "$SSH_KEY" "curl -sfL https://get.k3s.io | K3S_URL=$K3S_URL K3S_TOKEN=$JOIN_TOKEN sh -s - server \
    --server $K3S_URL \
    --disable servicelb \
    --write-kubeconfig-mode 644" >/dev/null 2>&1
  
  log_success "Node joined"
  
  # --------------------------------------------------------------------------
  # Join master 3
  # --------------------------------------------------------------------------
  log_step "4/7" "Joining master 3..."
  
  remote "$MASTER3" "$SSH_KEY" "curl -sfL https://get.k3s.io | K3S_URL=$K3S_URL K3S_TOKEN=$JOIN_TOKEN sh -s - server \
    --server $K3S_URL \
    --disable servicelb \
    --write-kubeconfig-mode 644" >/dev/null 2>&1
  
  log_success "Node joined"
  
  # Wait for all nodes
  sleep 15
  remote "$MASTER1" "$SSH_KEY" "kubectl wait --for=condition=Ready node --all --timeout=180s" >/dev/null 2>&1
  
  # --------------------------------------------------------------------------
  # Install cert-manager
  # --------------------------------------------------------------------------
  log_step "5/7" "Installing cert-manager..."
  
  remote "$MASTER1" "$SSH_KEY" "kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.14.0/cert-manager.yaml" >/dev/null 2>&1
  sleep 10
  remote "$MASTER1" "$SSH_KEY" "kubectl wait --for=condition=Available deployment/cert-manager -n cert-manager --timeout=120s" >/dev/null 2>&1
  remote "$MASTER1" "$SSH_KEY" "kubectl wait --for=condition=Available deployment/cert-manager-webhook -n cert-manager --timeout=120s" >/dev/null 2>&1
  log_success "cert-manager deployed"
  
  # Create ClusterIssuer
  remote "$MASTER1" "$SSH_KEY" "cat <<EOF | kubectl apply -f -
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: $EMAIL
    privateKeySecretRef:
      name: letsencrypt-prod-account-key
    solvers:
    - http01:
        ingress:
          class: traefik
EOF" >/dev/null 2>&1
  log_success "ClusterIssuer created"
  
  # --------------------------------------------------------------------------
  # Install MongoDB Operator
  # --------------------------------------------------------------------------
  log_step "6/7" "Installing MongoDB operator..."
  
  remote "$MASTER1" "$SSH_KEY" "helm repo add mongodb https://mongodb.github.io/helm-charts && helm repo update" >/dev/null 2>&1
  remote "$MASTER1" "$SSH_KEY" "helm install mongodb-operator mongodb/community-operator \
    --namespace mongodb-operator --create-namespace --wait" >/dev/null 2>&1
  log_success "Operator deployed"
  
  # --------------------------------------------------------------------------
  # Deploy Control Plane
  # --------------------------------------------------------------------------
  log_step "7/7" "Deploying Control Plane..."
  
  remote "$MASTER1" "$SSH_KEY" "helm repo add controlplane https://charts.controlplane.dev && helm repo update" >/dev/null 2>&1
  
  # Escape special characters in MongoDB URI for helm
  MONGODB_URI_ESCAPED=$(printf '%s' "$MONGODB_URI" | sed 's/,/\\,/g')
  
  remote "$MASTER1" "$SSH_KEY" "helm install controlplane controlplane/controlplane \
    --namespace controlplane --create-namespace \
    --set api.mongodb.uri='$MONGODB_URI_ESCAPED' \
    --set ingress.host='$DOMAIN' \
    --set ingress.tls.enabled=true \
    --set ingress.tls.issuer=letsencrypt-prod \
    --wait --timeout=300s" >/dev/null 2>&1
  
  log_success "API deployed"
  log_success "Web deployed"
  log_success "Ingress configured"
  
  # --------------------------------------------------------------------------
  # Save kubeconfig locally
  # --------------------------------------------------------------------------
  mkdir -p ~/.kube
  remote "$MASTER1" "$SSH_KEY" "cat /etc/rancher/k3s/k3s.yaml" | \
    sed "s/127.0.0.1/$MASTER1_IP/g" > ~/.kube/controlplane-config
  chmod 600 ~/.kube/controlplane-config
  
  # --------------------------------------------------------------------------
  # Success!
  # --------------------------------------------------------------------------
  echo ""
  echo -e "${GREEN}═══════════════════════════════════════════════════════════════════════════════${NC}"
  echo ""
  echo -e "  ${GREEN}✅ Control Plane installed successfully!${NC}"
  echo ""
  echo -e "  ${BOLD}Dashboard:${NC}    https://$DOMAIN"
  echo -e "                ${DIM}(SSL certificate may take 1-2 minutes)${NC}"
  echo ""
  echo -e "  ${BOLD}Kubeconfig:${NC}   Saved to ~/.kube/controlplane-config"
  echo -e "                ${DIM}Run: export KUBECONFIG=~/.kube/controlplane-config${NC}"
  echo ""
  echo -e "  ${BOLD}Next steps:${NC}"
  echo -e "    1. Open https://$DOMAIN"
  echo -e "    2. Create your admin account"
  echo -e "    3. Add worker nodes to run your apps"
  echo ""
  echo -e "  ${BOLD}Worker join token (save this!):${NC}"
  echo -e "  ┌─────────────────────────────────────────────────────────────────────────┐"
  echo -e "  │ ${CYAN}$JOIN_TOKEN${NC}"
  echo -e "  └─────────────────────────────────────────────────────────────────────────┘"
  echo ""
  echo -e "${GREEN}═══════════════════════════════════════════════════════════════════════════════${NC}"
}

# ==============================================================================
# Run
# ==============================================================================
main "$@"
