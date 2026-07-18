#!/bin/bash
## Control Plane Installation Script
## One-liner: curl -fsSL https://get.controlplane.dev/install.sh | bash
##
## Environment variables:
## MONGODB_URI          - MongoDB Atlas connection string (production)
## DOMAIN               - Domain for HTTPS (optional, uses IP if not set)
## ROOT_USERNAME        - Initial admin username
## ROOT_USER_EMAIL      - Initial admin email
## ROOT_USER_PASSWORD   - Initial admin password
## VERSION              - Specific version to install (default: latest)
## REGISTRY_URL         - Custom Docker registry (default: ghcr.io)
## AUTOUPDATE           - Set to "false" to disable auto-updates

set -e
set -o pipefail

# ================================
# Configuration
# ================================

CDN="https://cdn.controlplane.dev"
DATE=$(date +"%Y%m%d-%H%M%S")
DATA_DIR="/data/control-plane"
SOURCE_DIR="$DATA_DIR/source"
ENV_FILE="$SOURCE_DIR/.env"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

# ================================
# Helper Functions
# ================================

log() {
    echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[$(date '+%H:%M:%S')] ✓${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[$(date '+%H:%M:%S')] ⚠${NC} $1"
}

log_error() {
    echo -e "${RED}[$(date '+%H:%M:%S')] ✗${NC} $1"
}

log_section() {
    echo ""
    echo -e "${PURPLE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${PURPLE}  $1${NC}"
    echo -e "${PURPLE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

# ================================
# Pre-flight Checks
# ================================

if [ "$EUID" -ne 0 ]; then
    log_error "Please run this script as root or with sudo"
    exit 1
fi

# Detect OS
OS_TYPE=$(grep -w "ID" /etc/os-release 2>/dev/null | cut -d "=" -f 2 | tr -d '"' || echo "unknown")
OS_VERSION=$(grep -w "VERSION_ID" /etc/os-release 2>/dev/null | cut -d "=" -f 2 | tr -d '"' || echo "unknown")

# Map similar distros
case "$OS_TYPE" in
    manjaro|manjaro-arm|endeavouros|cachyos) OS_TYPE="arch" ;;
    fedora-asahi-remix) OS_TYPE="fedora" ;;
    pop|linuxmint|zorin) OS_TYPE="ubuntu" ;;
esac

# Check supported OS
case "$OS_TYPE" in
    arch|ubuntu|debian|raspbian|centos|fedora|rhel|ol|rocky|sles|opensuse-leap|opensuse-tumbleweed|almalinux|amzn|alpine) ;;
    *)
        log_error "Unsupported OS: $OS_TYPE"
        log_error "This script supports: Debian, Ubuntu, RHEL, Arch, Alpine, and SLES-based distributions"
        exit 1
        ;;
esac

# ================================
# Banner
# ================================

echo -e "${PURPLE}"
cat << 'EOF'
   ____            _             _   ____  _                  
  / ___|___  _ __ | |_ _ __ ___ | | |  _ \| | __ _ _ __   ___ 
 | |   / _ \| '_ \| __| '__/ _ \| | | |_) | |/ _` | '_ \ / _ \
 | |__| (_) | | | | |_| | | (_) | | |  __/| | (_| | | | |  __/
  \____\___/|_| |_|\__|_|  \___/|_| |_|   |_|\__,_|_| |_|\___|
                                                               
EOF
echo -e "${NC}"

echo "Welcome to Control Plane Installer!"
echo "Source: https://github.com/goweekdays/control-plane"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "| Operating System  | $OS_TYPE $OS_VERSION"
echo "| Install Date      | $DATE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ================================
# Check Disk Space
# ================================

TOTAL_SPACE=$(df -BG / | awk 'NR==2 {print $2}' | sed 's/G//')
AVAILABLE_SPACE=$(df -BG / | awk 'NR==2 {print $4}' | sed 's/G//')
REQUIRED_AVAILABLE=10

if [ "$AVAILABLE_SPACE" -lt "$REQUIRED_AVAILABLE" ]; then
    log_warn "Low disk space: ${AVAILABLE_SPACE}GB available, ${REQUIRED_AVAILABLE}GB recommended"
    log_warn "Continuing in 5 seconds..."
    sleep 5
fi

# ================================
# Create Directories
# ================================

log_section "Step 1/7: Creating directories"

mkdir -p "$DATA_DIR"/{source,ssh,logs,backups,ansible}
mkdir -p "$DATA_DIR"/ssh/{keys,mux}

# Set permissions (9999 is the controlplane user in the container)
chown -R 9999:root "$DATA_DIR" 2>/dev/null || true
chmod -R 700 "$DATA_DIR"

log_success "Directories created at $DATA_DIR"

# Start logging to file
INSTALL_LOG="$DATA_DIR/source/install-${DATE}.log"
exec > >(tee -a "$INSTALL_LOG") 2>&1

# ================================
# Install Dependencies
# ================================

log_section "Step 2/7: Installing dependencies"

install_packages() {
    case "$OS_TYPE" in
        arch)
            pacman -Sy --noconfirm --needed curl wget git jq openssl >/dev/null
            ;;
        alpine)
            apk update >/dev/null
            apk add curl wget git jq openssl bash >/dev/null
            ;;
        ubuntu|debian|raspbian)
            apt-get update -y >/dev/null
            apt-get install -y curl wget git jq openssl ca-certificates >/dev/null
            ;;
        centos|fedora|rhel|ol|rocky|almalinux|amzn)
            if command -v dnf >/dev/null; then
                dnf install -y curl wget git jq openssl >/dev/null
            else
                yum install -y curl wget git jq openssl >/dev/null
            fi
            ;;
        sles|opensuse-leap|opensuse-tumbleweed)
            zypper refresh >/dev/null
            zypper install -y curl wget git jq openssl >/dev/null
            ;;
    esac
}

# Check if packages are already installed
ALL_INSTALLED=true
for pkg in curl wget git jq openssl; do
    if ! command -v "$pkg" >/dev/null 2>&1; then
        ALL_INSTALLED=false
        break
    fi
done

if [ "$ALL_INSTALLED" = true ]; then
    log_success "All required packages already installed"
else
    log "Installing curl, wget, git, jq, openssl..."
    install_packages
    log_success "Dependencies installed"
fi

# ================================
# Install Docker
# ================================

log_section "Step 3/7: Installing Docker"

install_docker() {
    log "Installing Docker..."
    curl -fsSL https://get.docker.com | sh 2>&1 || {
        log_error "Docker installation failed"
        log_error "Please install Docker manually: https://docs.docker.com/engine/install/"
        exit 1
    }
}

if ! command -v docker >/dev/null 2>&1; then
    install_docker
    
    # Enable and start Docker
    if command -v systemctl >/dev/null 2>&1; then
        systemctl enable docker >/dev/null 2>&1
        systemctl start docker >/dev/null 2>&1
    elif command -v service >/dev/null 2>&1; then
        service docker start >/dev/null 2>&1
    fi
    
    log_success "Docker installed and started"
else
    log_success "Docker is already installed"
fi

# Verify Docker is running
if ! docker info >/dev/null 2>&1; then
    log_error "Docker is installed but not running"
    log_error "Please start Docker and try again"
    exit 1
fi

# Check Docker version
DOCKER_VERSION=$(docker version --format '{{.Server.Version}}' 2>/dev/null | cut -d. -f1)
if [ -n "$DOCKER_VERSION" ] && [ "$DOCKER_VERSION" -lt 24 ]; then
    log_warn "Docker version $DOCKER_VERSION is old. Version 24+ is recommended."
fi

# ================================
# Download Configuration Files
# ================================

log_section "Step 4/7: Downloading configuration files"

# Fetch latest version info
log "Fetching version information..."
VERSIONS_JSON=$(curl -fsSL "$CDN/versions.json" 2>/dev/null || echo '{"version":"latest"}')
LATEST_VERSION=$(echo "$VERSIONS_JSON" | jq -r '.version // "latest"')

# Allow version override
VERSION=${VERSION:-$LATEST_VERSION}
REGISTRY_URL=${REGISTRY_URL:-ghcr.io}

log "| Version           | $VERSION"
log "| Registry          | $REGISTRY_URL"

# Download files
log "Downloading docker-compose.yml..."
curl -fsSL "$CDN/docker-compose.yml" -o "$SOURCE_DIR/docker-compose.yml"

log "Downloading docker-compose.prod.yml..."
curl -fsSL "$CDN/docker-compose.prod.yml" -o "$SOURCE_DIR/docker-compose.prod.yml"

log "Downloading Caddyfile..."
curl -fsSL "$CDN/Caddyfile" -o "$SOURCE_DIR/Caddyfile"

log "Downloading .env.template..."
curl -fsSL "$CDN/.env.template" -o "$SOURCE_DIR/.env.template"

log "Downloading upgrade.sh..."
curl -fsSL "$CDN/upgrade.sh" -o "$SOURCE_DIR/upgrade.sh"
chmod +x "$SOURCE_DIR/upgrade.sh"

log_success "Configuration files downloaded"

# ================================
# Configure Environment
# ================================

log_section "Step 5/7: Configuring environment"

# Generate secrets if not provided
generate_secret() {
    openssl rand -base64 32 | tr -d '\n/+=' | cut -c1-32
}

# Create or update .env file
if [ -f "$ENV_FILE" ]; then
    log "Backing up existing .env to .env-$DATE"
    cp "$ENV_FILE" "$ENV_FILE-$DATE"
fi

# Start with template
cp "$SOURCE_DIR/.env.template" "$ENV_FILE"

# Update environment variable (add if missing, update if empty)
update_env() {
    local key="$1"
    local value="$2"
    
    if grep -q "^${key}=$" "$ENV_FILE"; then
        # Variable exists but is empty
        sed -i "s|^${key}=$|${key}=${value}|" "$ENV_FILE"
    elif ! grep -q "^${key}=" "$ENV_FILE"; then
        # Variable doesn't exist
        echo "${key}=${value}" >> "$ENV_FILE"
    fi
}

# Set version and registry
update_env "VERSION" "$VERSION"
update_env "REGISTRY_URL" "$REGISTRY_URL"

# Generate secrets
log "Generating secrets..."
update_env "JWT_SECRET" "$(generate_secret)"
update_env "SESSION_SECRET" "$(generate_secret)"
update_env "REDIS_PASSWORD" "$(generate_secret)"

# Check for MongoDB URI (required for production)
if [ -n "${MONGODB_URI:-}" ]; then
    update_env "MONGODB_URI" "$MONGODB_URI"
    log_success "MongoDB URI configured (Atlas)"
else
    # Development mode: use local MongoDB
    MONGO_ROOT_PASSWORD=$(generate_secret)
    update_env "MONGO_ROOT_PASSWORD" "$MONGO_ROOT_PASSWORD"
    update_env "MONGODB_URI" "mongodb://controlplane:${MONGO_ROOT_PASSWORD}@control-plane-mongodb:27017/control-plane?authSource=admin"
    log_warn "No MONGODB_URI provided - using local MongoDB container"
    log_warn "For production, set MONGODB_URI to a MongoDB Atlas connection string"
fi

# Optional: Domain configuration
if [ -n "${DOMAIN:-}" ]; then
    update_env "DOMAIN" "$DOMAIN"
    update_env "COOKIE_DOMAIN" ".$DOMAIN"
    update_env "ALLOWED_ORIGINS" "https://$DOMAIN"
    log_success "Domain configured: $DOMAIN"
else
    log "No DOMAIN set - will use HTTP on public IP"
fi

# Optional: Initial admin user
if [ -n "${ROOT_USERNAME:-}" ] && [ -n "${ROOT_USER_EMAIL:-}" ] && [ -n "${ROOT_USER_PASSWORD:-}" ]; then
    update_env "ROOT_USERNAME" "$ROOT_USERNAME"
    update_env "ROOT_USER_EMAIL" "$ROOT_USER_EMAIL"
    update_env "ROOT_USER_PASSWORD" "$ROOT_USER_PASSWORD"
    log_success "Initial admin user configured"
fi

# Auto-update setting
update_env "AUTOUPDATE" "${AUTOUPDATE:-true}"

log_success "Environment configured"

# ================================
# Generate SSH Key
# ================================

log_section "Step 6/7: Setting up SSH access"

SSH_KEY_FILE="$DATA_DIR/ssh/keys/id.controlplane"

if [ ! -f "$SSH_KEY_FILE" ]; then
    log "Generating SSH key for server management..."
    ssh-keygen -t ed25519 -a 100 -f "$SSH_KEY_FILE" -q -N "" -C "control-plane"
    chown 9999:root "$SSH_KEY_FILE" 2>/dev/null || true
    chmod 600 "$SSH_KEY_FILE"
    
    # Add to authorized_keys for localhost access
    mkdir -p ~/.ssh
    chmod 700 ~/.ssh
    touch ~/.ssh/authorized_keys
    chmod 600 ~/.ssh/authorized_keys
    
    # Remove old control-plane key and add new one
    sed -i '/control-plane$/d' ~/.ssh/authorized_keys
    cat "${SSH_KEY_FILE}.pub" >> ~/.ssh/authorized_keys
    
    log_success "SSH key generated and added to authorized_keys"
else
    log_success "SSH key already exists"
fi

# ================================
# Start Control Plane
# ================================

log_section "Step 7/7: Starting Control Plane"

cd "$SOURCE_DIR"

# Determine which compose file to use
COMPOSE_CMD="docker compose"
if ! docker compose version >/dev/null 2>&1; then
    if command -v docker-compose >/dev/null 2>&1; then
        COMPOSE_CMD="docker-compose"
    else
        log_error "Docker Compose not found. Please install Docker Compose."
        exit 1
    fi
fi

# Pull images
log "Pulling Docker images (this may take a while)..."
$COMPOSE_CMD pull

# Start services
if [ -z "${MONGODB_URI:-}" ]; then
    # Development mode: include local MongoDB
    log "Starting services with local MongoDB..."
    $COMPOSE_CMD -f docker-compose.yml -f docker-compose.dev.yml up -d
else
    # Production mode: Atlas MongoDB
    log "Starting services with Atlas MongoDB..."
    $COMPOSE_CMD up -d
fi

# Wait for services to be healthy
log "Waiting for services to be healthy..."
MAX_WAIT=120
WAITED=0

while [ $WAITED -lt $MAX_WAIT ]; do
    API_HEALTH=$(docker inspect --format='{{.State.Health.Status}}' control-plane-api 2>/dev/null || echo "starting")
    WEB_HEALTH=$(docker inspect --format='{{.State.Health.Status}}' control-plane-web 2>/dev/null || echo "starting")
    
    if [ "$API_HEALTH" = "healthy" ] && [ "$WEB_HEALTH" = "healthy" ]; then
        break
    fi
    
    if [ $((WAITED % 10)) -eq 0 ]; then
        log "API: $API_HEALTH, Web: $WEB_HEALTH (${WAITED}s)..."
    fi
    
    sleep 2
    WAITED=$((WAITED + 2))
done

if [ "$API_HEALTH" != "healthy" ] || [ "$WEB_HEALTH" != "healthy" ]; then
    log_error "Services did not become healthy within ${MAX_WAIT}s"
    log_error "API: $API_HEALTH, Web: $WEB_HEALTH"
    log_error "Check logs: docker logs control-plane-api"
    exit 1
fi

log_success "All services are running!"

# ================================
# Complete!
# ================================

echo ""
echo -e "${GREEN}"
cat << 'EOF'
   ____                            _       _       _   _                 _ 
  / ___|___  _ __   __ _ _ __ __ _| |_ ___| | __ _| |_(_) ___  _ __  ___| |
 | |   / _ \| '_ \ / _` | '__/ _` | __/ _ \ |/ _` | __| |/ _ \| '_ \/ __| |
 | |__| (_) | | | | (_| | | | (_| | ||  __/ | (_| | |_| | (_) | | | \__ \_|
  \____\___/|_| |_|\__, |_|  \__,_|\__\___|_|\__,_|\__|_|\___/|_| |_|___(_)
                   |___/                                                   
EOF
echo -e "${NC}"

# Get public IPs
IPV4=$(curl -4s --max-time 5 https://ifconfig.io 2>/dev/null || true)
IPV6=$(curl -6s --max-time 5 https://ifconfig.io 2>/dev/null || true)

echo "Your Control Plane is ready!"
echo ""

if [ -n "${DOMAIN:-}" ]; then
    echo -e "  ${GREEN}→${NC} https://$DOMAIN"
else
    if [ -n "$IPV4" ]; then
        echo -e "  ${GREEN}→${NC} http://$IPV4:3000"
    fi
    if [ -n "$IPV6" ]; then
        echo -e "  ${GREEN}→${NC} http://[$IPV6]:3000"
    fi
fi

echo ""
echo "Next steps:"
echo "  1. Open the URL above in your browser"
echo "  2. Complete the setup wizard"
echo "  3. Add your first server"
echo ""
echo -e "${YELLOW}Important:${NC}"
echo "  • Back up your .env file: $ENV_FILE"
echo "  • Installation log: $INSTALL_LOG"
echo ""

if [ -z "${MONGODB_URI:-}" ]; then
    echo -e "${YELLOW}Warning:${NC} Using local MongoDB. For production:"
    echo "  • Create a MongoDB Atlas cluster"
    echo "  • Update MONGODB_URI in $ENV_FILE"
    echo "  • Restart: cd $SOURCE_DIR && docker compose up -d"
    echo ""
fi

echo "Documentation: https://docs.controlplane.dev"
echo "Support: https://github.com/goweekdays/control-plane/issues"
