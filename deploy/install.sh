#!/bin/bash
## Control Plane Installation Script
## One-liner: curl -fsSL https://get.controlplane.dev/install.sh | bash
##
## If Control Plane is already running, this script automatically
## delegates to upgrade.sh to perform an in-place update.
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
## ENABLE_K8S           - Set to "true" to install K3s for database provisioning

set -e
set -o pipefail

# ================================
# Configuration
# ================================

CDN="https://get.goweekdays.com"
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

prompt() {
    local var_name="$1"
    local prompt_text="$2"
    local default_value="$3"
    local is_secret="$4"
    local value
    
    if [ -n "$default_value" ]; then
        prompt_text="$prompt_text [$default_value]"
    fi
    
    echo -ne "${GREEN}→${NC} $prompt_text: "
    
    if [ "$is_secret" = "true" ]; then
        read -s value
        echo ""
    else
        read value
    fi
    
    if [ -z "$value" ] && [ -n "$default_value" ]; then
        value="$default_value"
    fi
    
    eval "$var_name=\"$value\""
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
# Check for Existing Installation
# ================================

# If Control Plane is already running, delegate to upgrade script
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^control-plane-api$'; then
    log "Control Plane is already running - switching to upgrade mode"
    
    # Ensure upgrade script exists
    if [ -f "$SOURCE_DIR/upgrade.sh" ]; then
        exec "$SOURCE_DIR/upgrade.sh" "${VERSION:-latest}"
    else
        # Download upgrade script if missing
        log "Downloading upgrade script..."
        mkdir -p "$SOURCE_DIR"
        curl -fsSL "$CDN/upgrade.sh" -o "$SOURCE_DIR/upgrade.sh"
        chmod +x "$SOURCE_DIR/upgrade.sh"
        exec "$SOURCE_DIR/upgrade.sh" "${VERSION:-latest}"
    fi
fi

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
echo "Source: https://github.com/iamsurelydaveydave/control-plane"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "| Operating System  | $OS_TYPE $OS_VERSION"
echo "| Install Date      | $DATE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ================================
# Interactive Configuration
# ================================

log_section "Configuration"

echo "Please provide your database credentials."
echo "You can get free MongoDB at: https://mongodb.com/atlas"
echo "You can get free Redis at: https://upstash.com or https://redis.com"
echo ""

# MongoDB URI (required)
if [ -z "${MONGODB_URI:-}" ]; then
    echo -e "${YELLOW}MongoDB Connection (required)${NC}"
    echo "  Example: mongodb+srv://user:pass@cluster.mongodb.net/control-plane"
    echo ""
    
    while [ -z "${MONGODB_URI:-}" ]; do
        echo -ne "${GREEN}→${NC} MongoDB URI: "
        read MONGODB_URI < /dev/tty
        if [ -z "$MONGODB_URI" ]; then
            echo -e "${RED}  MongoDB URI is required${NC}"
        fi
    done
    echo ""
fi

# Redis URL (required)
if [ -z "${REDIS_URL:-}" ]; then
    echo -e "${YELLOW}Redis Connection (required)${NC}"
    echo "  Example: redis://default:password@host:port"
    echo "  Upstash: rediss://default:xxx@xxx.upstash.io:6379"
    echo ""
    
    while [ -z "${REDIS_URL:-}" ]; do
        echo -ne "${GREEN}→${NC} Redis URL: "
        read REDIS_URL < /dev/tty
        if [ -z "$REDIS_URL" ]; then
            echo -e "${RED}  Redis URL is required${NC}"
        fi
    done
    echo ""
fi

# Domain (optional)
if [ -z "${DOMAIN:-}" ]; then
    echo -e "${YELLOW}Domain Configuration (optional)${NC}"
    echo "  Enter your domain for HTTPS (e.g., cp.example.com)"
    echo "  Leave empty to access via IP address (HTTP only)"
    echo ""
    echo -ne "${GREEN}→${NC} Domain: "
    read DOMAIN < /dev/tty
    echo ""
fi

# Admin credentials
if [ -z "${ROOT_USER_EMAIL:-}" ]; then
    echo -e "${YELLOW}Admin Account${NC}"
    echo "  Create the initial administrator account"
    echo ""
    
    echo -ne "${GREEN}→${NC} Admin email: "
    read ROOT_USER_EMAIL < /dev/tty
    
    while [ -z "$ROOT_USER_EMAIL" ]; do
        echo -e "${RED}  Email is required${NC}"
        echo -ne "${GREEN}→${NC} Admin email: "
        read ROOT_USER_EMAIL < /dev/tty
    done
    
    echo -ne "${GREEN}→${NC} Admin password: "
    read -s ROOT_USER_PASSWORD < /dev/tty
    echo ""
    
    while [ -z "$ROOT_USER_PASSWORD" ] || [ ${#ROOT_USER_PASSWORD} -lt 8 ]; do
        echo -e "${RED}  Password must be at least 8 characters${NC}"
        echo -ne "${GREEN}→${NC} Admin password: "
        read -s ROOT_USER_PASSWORD < /dev/tty
        echo ""
    done
    
    echo -ne "${GREEN}→${NC} Confirm password: "
    read -s ROOT_USER_PASSWORD_CONFIRM < /dev/tty
    echo ""
    
    while [ "$ROOT_USER_PASSWORD" != "$ROOT_USER_PASSWORD_CONFIRM" ]; do
        echo -e "${RED}  Passwords do not match${NC}"
        echo -ne "${GREEN}→${NC} Admin password: "
        read -s ROOT_USER_PASSWORD < /dev/tty
        echo ""
        echo -ne "${GREEN}→${NC} Confirm password: "
        read -s ROOT_USER_PASSWORD_CONFIRM < /dev/tty
        echo ""
    done
    
    ROOT_USERNAME=${ROOT_USER_EMAIL%%@*}
    echo ""
fi

# Confirmation
echo ""
echo -e "${BLUE}━━━ Configuration Summary ━━━${NC}"
echo -e "  MongoDB:  ${MONGODB_URI:0:50}..."
echo -e "  Redis:    ${REDIS_URL:0:50}..."
echo -e "  Domain:   ${DOMAIN:-${YELLOW}IP access only${NC}}"
echo -e "  Admin:    $ROOT_USER_EMAIL"
echo ""
echo -ne "${GREEN}→${NC} Proceed with installation? [Y/n]: "
read CONFIRM < /dev/tty
if [[ "$CONFIRM" =~ ^[Nn] ]]; then
    echo "Installation cancelled."
    exit 0
fi

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

# MongoDB (user provided)
update_env "MONGODB_URI" "$MONGODB_URI"
log_success "MongoDB configured"

# Redis (user provided)
update_env "REDIS_URL" "$REDIS_URL"
log_success "Redis configured"

# Optional: Domain configuration
if [ -n "${DOMAIN:-}" ]; then
    update_env "DOMAIN" "$DOMAIN"
    update_env "COOKIE_DOMAIN" ".$DOMAIN"
    update_env "ALLOWED_ORIGINS" "https://$DOMAIN"
    log_success "Domain configured: $DOMAIN"
else
    log "No DOMAIN set - will use HTTP on public IP"
fi

# Admin credentials
if [ -n "${ROOT_USER_EMAIL:-}" ] && [ -n "${ROOT_USER_PASSWORD:-}" ]; then
    update_env "ROOT_USERNAME" "${ROOT_USERNAME:-admin}"
    update_env "ROOT_USER_EMAIL" "$ROOT_USER_EMAIL"
    update_env "ROOT_USER_PASSWORD" "$ROOT_USER_PASSWORD"
    log_success "Admin credentials saved"
fi

# Auto-update setting
update_env "AUTOUPDATE" "${AUTOUPDATE:-true}"

# K8s settings will be configured after K3s installation (Step 6b)

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
# Install K3s (Optional - for K8s-based database provisioning)
# ================================

# Ask about K3s if not set via env var
if [ -z "${ENABLE_K8S:-}" ]; then
    echo ""
    echo -e "${YELLOW}Kubernetes Database Provisioning (optional)${NC}"
    echo "  K3s enables advanced database provisioning with automatic failover,"
    echo "  TLS management, and self-healing via the Percona MongoDB Operator."
    echo ""
    echo "  Without K3s: Uses Ansible-based provisioning (traditional)"
    echo "  With K3s: Uses Kubernetes operators (recommended for production)"
    echo ""
    echo -ne "${GREEN}→${NC} Enable K3s for database provisioning? [y/N]: "
    read ENABLE_K8S_ANSWER < /dev/tty
    if [[ "$ENABLE_K8S_ANSWER" =~ ^[Yy] ]]; then
        ENABLE_K8S="true"
    else
        ENABLE_K8S="false"
    fi
fi

if [ "$ENABLE_K8S" = "true" ]; then
    log_section "Step 6b/7: Installing K3s + Percona Operator"
    
    # Check if K3s is already installed
    if command -v k3s >/dev/null 2>&1; then
        log_success "K3s is already installed"
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
            log_warn "Continuing without K3s - will use Ansible for database provisioning"
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
    
    # Install Percona Operator
    if [ "$ENABLE_K8S" = "true" ]; then
        log "Installing Percona MongoDB Operator..."
        
        # Apply Percona Operator
        kubectl apply --server-side -f https://raw.githubusercontent.com/percona/percona-server-mongodb-operator/v1.16.0/deploy/bundle.yaml 2>&1 || {
            log_warn "Failed to install Percona Operator - continuing anyway"
        }
        
        # Create databases namespace
        kubectl create namespace databases --dry-run=client -o yaml | kubectl apply -f - 2>/dev/null || true
        
        # Install operator in databases namespace too
        kubectl apply --server-side -f https://raw.githubusercontent.com/percona/percona-server-mongodb-operator/v1.16.0/deploy/bundle.yaml -n databases 2>&1 || true
        
        # Get K3s token for agent nodes
        K3S_TOKEN=$(cat /var/lib/rancher/k3s/server/node-token 2>/dev/null || echo "")
        K3S_SERVER_URL="https://${PUBLIC_IP}:6443"
        
        # Update .env with K8s configuration
        update_env "K8S_ENABLED" "true"
        update_env "K8S_KUBECONFIG" "/etc/rancher/k3s/k3s.yaml"
        update_env "K3S_SERVER_URL" "$K3S_SERVER_URL"
        update_env "K3S_TOKEN" "$K3S_TOKEN"
        
        log_success "Percona Operator installed"
        log "K3s Server URL: $K3S_SERVER_URL"
    fi
else
    # K8s not enabled - use Ansible provisioning
    update_env "K8S_ENABLED" "false"
    
    # Create empty kubeconfig placeholder so Docker volume mount doesn't fail
    mkdir -p /etc/rancher/k3s
    if [ ! -f /etc/rancher/k3s/k3s.yaml ]; then
        echo "# K8s not enabled - placeholder file" > /etc/rancher/k3s/k3s.yaml
    fi
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
log "Starting services..."
$COMPOSE_CMD up -d

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

if [ "$ENABLE_K8S" = "true" ]; then
    echo -e "${GREEN}Kubernetes Database Provisioning: ENABLED${NC}"
    echo "  • K3s Server URL: $K3S_SERVER_URL"
    echo "  • To add a database server as K3s agent:"
    echo "    curl -sfL https://get.k3s.io | K3S_URL=$K3S_SERVER_URL K3S_TOKEN=<token> sh -"
    echo "  • K3s token is stored in: /var/lib/rancher/k3s/server/node-token"
    echo ""
else
    echo -e "${YELLOW}Kubernetes Database Provisioning: DISABLED${NC}"
    echo "  Using Ansible-based database provisioning."
    echo "  To enable K8s later, run the installer again with ENABLE_K8S=true"
    echo ""
fi

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
echo "Support: https://github.com/iamsurelydaveydave/control-plane/issues"
