#!/bin/bash
## Control Plane Upgrade Script
## This script is called by the installer and auto-update system
##
## Usage: ./upgrade.sh [version]
##        version: specific version or "latest" (default)
##
## Environment variables:
## ENABLE_K8S    - Set to "true" to install K3s for database provisioning

set -e
set -o pipefail

DATA_DIR="/data/control-plane"
SOURCE_DIR="$DATA_DIR/source"
ENV_FILE="$SOURCE_DIR/.env"
CDN="https://get.goweekdays.com"
DATE=$(date +"%Y%m%d-%H%M%S")
STATUS_FILE="$SOURCE_DIR/.upgrade-status"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() {
    echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[$(date '+%H:%M:%S')] ✓${NC} $1"
}

log_error() {
    echo -e "${RED}[$(date '+%H:%M:%S')] ✗${NC} $1"
}

# Write status for installer to read
write_status() {
    echo "$1|$2|$(date +%s)" > "$STATUS_FILE"
}

cleanup_status() {
    sleep 10
    rm -f "$STATUS_FILE"
}

# ================================
# Version Check
# ================================

TARGET_VERSION="${1:-latest}"

# Fetch version info from CDN
VERSIONS_JSON=$(curl -fsSL "$CDN/versions.json" 2>/dev/null || echo '{}')

if [ "$TARGET_VERSION" = "latest" ]; then
    TARGET_VERSION=$(echo "$VERSIONS_JSON" | jq -r '.version // "latest"')
fi

# Get current version
CURRENT_VERSION=$(grep "^VERSION=" "$ENV_FILE" 2>/dev/null | cut -d'=' -f2 || echo "unknown")

log "Upgrade: $CURRENT_VERSION → $TARGET_VERSION"
write_status "1" "Starting upgrade to $TARGET_VERSION"

# ================================
# Pre-upgrade Backup
# ================================

write_status "2" "Creating backup"

BACKUP_DIR="$DATA_DIR/backups/upgrade-$DATE"
mkdir -p "$BACKUP_DIR"

# Backup docker-compose files
cp "$SOURCE_DIR/docker-compose.yml" "$BACKUP_DIR/" 2>/dev/null || true
cp "$SOURCE_DIR/docker-compose.dev.yml" "$BACKUP_DIR/" 2>/dev/null || true
cp "$SOURCE_DIR/docker-compose.prod.yml" "$BACKUP_DIR/" 2>/dev/null || true

# Backup environment
cp "$ENV_FILE" "$BACKUP_DIR/.env" 2>/dev/null || true

# Backup Caddyfile
cp "$SOURCE_DIR/Caddyfile" "$BACKUP_DIR/" 2>/dev/null || true

log_success "Backup created: $BACKUP_DIR"

# ================================
# Download New Files
# ================================

write_status "3" "Downloading new configuration files"

log "Downloading updated configuration files..."

curl -fsSL "$CDN/docker-compose.yml" -o "$SOURCE_DIR/docker-compose.yml.new"
curl -fsSL "$CDN/docker-compose.prod.yml" -o "$SOURCE_DIR/docker-compose.prod.yml.new" 2>/dev/null || true
curl -fsSL "$CDN/docker-compose.dev.yml" -o "$SOURCE_DIR/docker-compose.dev.yml.new" 2>/dev/null || true
curl -fsSL "$CDN/Caddyfile" -o "$SOURCE_DIR/Caddyfile.new"
curl -fsSL "$CDN/.env.template" -o "$SOURCE_DIR/.env.template.new"

# Move new files into place
mv "$SOURCE_DIR/docker-compose.yml.new" "$SOURCE_DIR/docker-compose.yml"
mv "$SOURCE_DIR/Caddyfile.new" "$SOURCE_DIR/Caddyfile"
mv "$SOURCE_DIR/.env.template.new" "$SOURCE_DIR/.env.template"

# Optional files
[ -f "$SOURCE_DIR/docker-compose.prod.yml.new" ] && mv "$SOURCE_DIR/docker-compose.prod.yml.new" "$SOURCE_DIR/docker-compose.prod.yml"
[ -f "$SOURCE_DIR/docker-compose.dev.yml.new" ] && mv "$SOURCE_DIR/docker-compose.dev.yml.new" "$SOURCE_DIR/docker-compose.dev.yml"

log_success "Configuration files updated"

# ================================
# Update Version in .env
# ================================

write_status "4" "Updating version"

if grep -q "^VERSION=" "$ENV_FILE"; then
    sed -i "s|^VERSION=.*|VERSION=$TARGET_VERSION|" "$ENV_FILE"
else
    echo "VERSION=$TARGET_VERSION" >> "$ENV_FILE"
fi

log_success "Version set to $TARGET_VERSION"

# ================================
# Install/Update K3s (Optional)
# ================================

# Check if K8s should be enabled
ENABLE_K8S="${ENABLE_K8S:-}"

# If not set via env var, check if already configured in .env
if [ -z "$ENABLE_K8S" ]; then
    if grep -q "^K8S_ENABLED=true" "$ENV_FILE" 2>/dev/null; then
        ENABLE_K8S="true"
    fi
fi

# If still not set, ask interactively (only if terminal is available)
if [ -z "$ENABLE_K8S" ] && [ -t 0 ]; then
    # Check if K3s is already installed
    if command -v k3s >/dev/null 2>&1; then
        log "K3s is already installed"
        ENABLE_K8S="true"
    else
        echo ""
        echo -e "${YELLOW}Kubernetes Database Provisioning${NC}"
        echo "  K3s enables advanced database provisioning with automatic failover."
        echo ""
        echo -ne "${GREEN}→${NC} Enable K3s for database provisioning? [y/N]: "
        read -r ENABLE_K8S_ANSWER < /dev/tty
        if [[ "$ENABLE_K8S_ANSWER" =~ ^[Yy] ]]; then
            ENABLE_K8S="true"
        else
            ENABLE_K8S="false"
        fi
    fi
fi

if [ "$ENABLE_K8S" = "true" ]; then
    write_status "4b" "Setting up Kubernetes"
    
    # Check if K3s is already installed
    if command -v k3s >/dev/null 2>&1 && systemctl is-active --quiet k3s 2>/dev/null; then
        log_success "K3s is already installed and running"
    else
        log "Installing K3s server..."
        
        # Get public IP for K3s TLS SAN
        PUBLIC_IP=$(curl -4s --max-time 5 https://ifconfig.io 2>/dev/null || hostname -I | awk '{print $1}')
        
        curl -sfL https://get.k3s.io | sh -s - server \
            --disable traefik \
            --disable servicelb \
            --write-kubeconfig-mode 644 \
            --tls-san "$PUBLIC_IP" 2>&1 || {
            log_error "K3s installation failed"
            log "Continuing without K3s - will use Ansible for database provisioning"
            ENABLE_K8S="false"
        }
        
        if [ "$ENABLE_K8S" = "true" ]; then
            # Wait for K3s to be ready
            log "Waiting for K3s to be ready..."
            sleep 10
            WAITED=0
            while ! kubectl get nodes >/dev/null 2>&1 && [ $WAITED -lt 60 ]; do
                sleep 5
                WAITED=$((WAITED + 5))
            done
            
            if kubectl get nodes >/dev/null 2>&1; then
                log_success "K3s server installed"
            else
                log_error "K3s did not become ready"
                ENABLE_K8S="false"
            fi
        fi
    fi
    
    # Install Percona Operator if K3s is running
    if [ "$ENABLE_K8S" = "true" ]; then
        # Check if Percona Operator is already installed
        if kubectl get deployment percona-server-mongodb-operator >/dev/null 2>&1; then
            log_success "Percona Operator is already installed"
        else
            log "Installing Percona MongoDB Operator..."
            
            kubectl apply --server-side -f https://raw.githubusercontent.com/percona/percona-server-mongodb-operator/v1.16.0/deploy/bundle.yaml 2>&1 || {
                log_error "Failed to install Percona Operator"
            }
            
            # Create databases namespace
            kubectl create namespace databases --dry-run=client -o yaml | kubectl apply -f - 2>/dev/null || true
            
            # Install operator in databases namespace too
            kubectl apply --server-side -f https://raw.githubusercontent.com/percona/percona-server-mongodb-operator/v1.16.0/deploy/bundle.yaml -n databases 2>&1 || true
            
            log_success "Percona Operator installed"
        fi
        
        # Get K3s token and update .env
        K3S_TOKEN=$(cat /var/lib/rancher/k3s/server/node-token 2>/dev/null || echo "")
        PUBLIC_IP=$(curl -4s --max-time 5 https://ifconfig.io 2>/dev/null || hostname -I | awk '{print $1}')
        K3S_SERVER_URL="https://${PUBLIC_IP}:6443"
        
        # Update .env with K8s configuration
        update_env() {
            local key="$1"
            local value="$2"
            if grep -q "^${key}=" "$ENV_FILE"; then
                sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
            else
                echo "${key}=${value}" >> "$ENV_FILE"
            fi
        }
        
        update_env "K8S_ENABLED" "true"
        update_env "K8S_KUBECONFIG" "/etc/rancher/k3s/k3s.yaml"
        update_env "K3S_SERVER_URL" "$K3S_SERVER_URL"
        update_env "K3S_TOKEN" "$K3S_TOKEN"
        
        log_success "K8s configuration added to .env"
        log "K3s Server URL: $K3S_SERVER_URL"
    fi
else
    # Ensure K8S_ENABLED is set to false if not using K8s
    if ! grep -q "^K8S_ENABLED=" "$ENV_FILE"; then
        echo "K8S_ENABLED=false" >> "$ENV_FILE"
    fi
    
    # Create placeholder kubeconfig so docker mount doesn't fail
    mkdir -p /etc/rancher/k3s
    if [ ! -f /etc/rancher/k3s/k3s.yaml ]; then
        echo "# K8s not enabled - placeholder file" > /etc/rancher/k3s/k3s.yaml
    fi
fi

# ================================
# Pull New Images
# ================================

write_status "5" "Pulling new Docker images"

cd "$SOURCE_DIR"

COMPOSE_CMD="docker compose"
if ! docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD="docker-compose"
fi

log "Pulling new images..."
$COMPOSE_CMD pull

# ================================
# Restart Services
# ================================

log "Restarting services..."

# Determine if using local MongoDB
if grep -q "control-plane-mongodb" "$ENV_FILE" 2>/dev/null || [ -z "$(grep '^MONGODB_URI=' "$ENV_FILE" | cut -d'=' -f2-)" ]; then
    # Development mode with local MongoDB
    $COMPOSE_CMD -f docker-compose.yml -f docker-compose.dev.yml up -d
else
    # Production mode with Atlas
    $COMPOSE_CMD up -d
fi

# ================================
# Health Check
# ================================

log "Waiting for services to be healthy..."

MAX_WAIT=120
WAITED=0

while [ $WAITED -lt $MAX_WAIT ]; do
    API_HEALTH=$(docker inspect --format='{{.State.Health.Status}}' control-plane-api 2>/dev/null || echo "starting")
    WEB_HEALTH=$(docker inspect --format='{{.State.Health.Status}}' control-plane-web 2>/dev/null || echo "starting")
    
    if [ "$API_HEALTH" = "healthy" ] && [ "$WEB_HEALTH" = "healthy" ]; then
        break
    fi
    
    sleep 2
    WAITED=$((WAITED + 2))
done

if [ "$API_HEALTH" != "healthy" ] || [ "$WEB_HEALTH" != "healthy" ]; then
    log_error "Services did not become healthy. Rolling back..."
    write_status "error" "Upgrade failed - services unhealthy"
    
    # Rollback
    cp "$BACKUP_DIR/docker-compose.yml" "$SOURCE_DIR/" 2>/dev/null || true
    cp "$BACKUP_DIR/.env" "$ENV_FILE" 2>/dev/null || true
    
    $COMPOSE_CMD up -d
    
    exit 1
fi

# ================================
# Cleanup Old Images
# ================================

log "Cleaning up old images..."
docker image prune -f >/dev/null 2>&1 || true

# ================================
# Complete
# ================================

write_status "6" "Upgrade complete"
log_success "Upgrade to $TARGET_VERSION complete!"

# Clean up status file after delay
cleanup_status &

# Log upgrade
echo "$DATE: Upgraded from $CURRENT_VERSION to $TARGET_VERSION" >> "$DATA_DIR/logs/upgrades.log"
