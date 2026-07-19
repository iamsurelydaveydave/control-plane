#!/bin/bash
## Control Plane Upgrade Script
## This script is called by the installer and auto-update system
##
## Usage: ./upgrade.sh [version]
##        version: specific version or "latest" (default)

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
