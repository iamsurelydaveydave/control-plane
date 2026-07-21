#!/bin/bash
## Control Plane Installation Script (K8s-Native with Caddy)
## One-liner: curl -fsSL https://get.goweekdays.com/install.sh | bash
##
## Installs K3s and deploys Control Plane via Helm chart.
## Uses Caddy for automatic HTTPS.
##
## Environment variables:
## DOMAIN               - Domain for HTTPS (required for production)
## MONGODB_URI          - External MongoDB URI (optional, installs in-cluster if not set)
## ACME_EMAIL           - Email for Let's Encrypt SSL certificates
## ROOT_USER_EMAIL      - Initial admin email
## ROOT_USER_PASSWORD   - Initial admin password
## VERSION              - Specific version to install (default: latest)
## IMAGE_REGISTRY       - Docker image registry (default: ghcr.io/iamsurelydaveydave)
## SKIP_K3S             - Set to "true" to skip K3s installation (use existing cluster)

set -e
set -o pipefail

# ================================
# Configuration
# ================================

CDN="https://get.goweekdays.com"
NAMESPACE="control-plane"
RELEASE_NAME="control-plane"
DATA_DIR="/data/control-plane"
IMAGE_REGISTRY="${IMAGE_REGISTRY:-ghcr.io/iamsurelydaveydave}"
VERSION="${VERSION:-latest}"

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
        read -rs value < /dev/tty
        echo ""
    else
        read -r value < /dev/tty
    fi
    
    value="${value:-$default_value}"
    eval "$var_name='$value'"
}

generate_password() {
    openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 24
}

check_command() {
    if ! command -v "$1" &> /dev/null; then
        return 1
    fi
    return 0
}

get_public_ip() {
    curl -s https://api.ipify.org 2>/dev/null || curl -s https://ifconfig.me 2>/dev/null || echo "localhost"
}

# ================================
# Pre-flight Checks
# ================================

preflight_checks() {
    log_section "Pre-flight Checks"
    
    # Check if running as root
    if [ "$EUID" -ne 0 ]; then
        log_error "Please run as root (sudo)"
        exit 1
    fi
    log_success "Running as root"
    
    # Check OS
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        log_success "OS: $NAME $VERSION_ID"
    else
        log_warn "Could not detect OS"
    fi
    
    # Check architecture
    ARCH=$(uname -m)
    case $ARCH in
        x86_64|amd64)
            ARCH="amd64"
            ;;
        aarch64|arm64)
            ARCH="arm64"
            ;;
        *)
            log_error "Unsupported architecture: $ARCH"
            exit 1
            ;;
    esac
    log_success "Architecture: $ARCH"
    
    # Check minimum requirements
    TOTAL_MEM=$(free -m | awk '/^Mem:/{print $2}')
    if [ "$TOTAL_MEM" -lt 2048 ]; then
        log_warn "Less than 2GB RAM detected. Recommended: 4GB+"
    else
        log_success "Memory: ${TOTAL_MEM}MB"
    fi
    
    # Check if curl is available
    if ! check_command curl; then
        log "Installing curl..."
        apt-get update -qq && apt-get install -y -qq curl
    fi
    log_success "curl available"
    
    # Create data directory
    mkdir -p "$DATA_DIR"
    log_success "Data directory: $DATA_DIR"
}

# ================================
# Open Firewall Ports
# ================================

open_firewall_ports() {
    log_section "Configuring Firewall"
    
    # Check if iptables has a REJECT rule that would block traffic
    if iptables -L INPUT -n 2>/dev/null | grep -q "REJECT\|DROP"; then
        log "Opening ports 80 and 443 in iptables..."
        
        # Insert rules before any REJECT/DROP rules
        # Find the line number of the first REJECT/DROP rule
        REJECT_LINE=$(iptables -L INPUT -n --line-numbers 2>/dev/null | grep -E "REJECT|DROP" | head -1 | awk '{print $1}')
        
        if [ -n "$REJECT_LINE" ]; then
            # Insert HTTP rule before REJECT
            iptables -I INPUT "$REJECT_LINE" -p tcp --dport 80 -j ACCEPT 2>/dev/null || true
            # Insert HTTPS rule (REJECT_LINE + 1 because we just inserted one)
            iptables -I INPUT "$((REJECT_LINE + 1))" -p tcp --dport 443 -j ACCEPT 2>/dev/null || true
        else
            # No REJECT rule, just append
            iptables -A INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || true
            iptables -A INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || true
        fi
        
        # Also open 6443 for Kubernetes API (for joining nodes later)
        iptables -I INPUT "$REJECT_LINE" -p tcp --dport 6443 -j ACCEPT 2>/dev/null || true
        
        # Save iptables rules
        if command -v netfilter-persistent &>/dev/null; then
            netfilter-persistent save 2>/dev/null || true
        elif [ -d /etc/iptables ]; then
            iptables-save > /etc/iptables/rules.v4 2>/dev/null || true
        fi
        
        log_success "Firewall ports opened (80, 443, 6443)"
    else
        log_success "No restrictive firewall rules detected"
    fi
    
    # Also check for ufw
    if command -v ufw &>/dev/null && ufw status | grep -q "active"; then
        log "Opening ports in UFW..."
        ufw allow 80/tcp >/dev/null 2>&1 || true
        ufw allow 443/tcp >/dev/null 2>&1 || true
        ufw allow 6443/tcp >/dev/null 2>&1 || true
        log_success "UFW ports opened"
    fi
    
    # Check for firewalld
    if command -v firewall-cmd &>/dev/null && systemctl is-active firewalld &>/dev/null; then
        log "Opening ports in firewalld..."
        firewall-cmd --permanent --add-port=80/tcp >/dev/null 2>&1 || true
        firewall-cmd --permanent --add-port=443/tcp >/dev/null 2>&1 || true
        firewall-cmd --permanent --add-port=6443/tcp >/dev/null 2>&1 || true
        firewall-cmd --reload >/dev/null 2>&1 || true
        log_success "Firewalld ports opened"
    fi
}

# ================================
# Install K3s
# ================================

install_k3s() {
    log_section "Installing K3s (Lightweight Kubernetes)"
    
    if [ "$SKIP_K3S" = "true" ]; then
        log "Skipping K3s installation (SKIP_K3S=true)"
        if ! check_command kubectl; then
            log_error "kubectl not found. Please ensure you have a working Kubernetes cluster."
            exit 1
        fi
        return
    fi
    
    if check_command k3s; then
        log_success "K3s already installed"
        K3S_VERSION=$(k3s --version | head -1)
        log "Version: $K3S_VERSION"
    else
        log "Installing K3s..."
        curl -sfL https://get.k3s.io | sh -s - \
            --write-kubeconfig-mode 644 \
            --disable traefik \
            --disable servicelb
        
        # Wait for K3s to be ready
        log "Waiting for K3s to be ready..."
        sleep 10
        
        until kubectl get nodes &>/dev/null; do
            log "Waiting for Kubernetes API..."
            sleep 5
        done
        
        log_success "K3s installed successfully"
    fi
    
    # Set KUBECONFIG for this session
    export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
    
    # Verify cluster is ready
    kubectl wait --for=condition=Ready nodes --all --timeout=120s
    log_success "Kubernetes cluster is ready"
}

# ================================
# Install Helm
# ================================

install_helm() {
    log_section "Installing Helm"
    
    if check_command helm; then
        log_success "Helm already installed"
        HELM_VERSION=$(helm version --short)
        log "Version: $HELM_VERSION"
        return
    fi
    
    log "Installing Helm..."
    curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
    
    log_success "Helm installed successfully"
}

# ================================
# Collect Configuration
# ================================

collect_config() {
    log_section "Configuration"
    
    PUBLIC_IP=$(get_public_ip)
    
    # Domain
    if [ -z "$DOMAIN" ]; then
        prompt DOMAIN "Enter domain for Control Plane (or press Enter to use IP)" "$PUBLIC_IP"
    fi
    log "Domain: $DOMAIN"
    
    # ACME Email for Let's Encrypt
    if [ -z "$ACME_EMAIL" ]; then
        prompt ACME_EMAIL "Enter email for Let's Encrypt SSL (optional)" ""
    fi
    
    # MongoDB URI
    if [ -z "$MONGODB_URI" ]; then
        log ""
        log "MongoDB Options:"
        log "  1. Use external MongoDB (Atlas recommended for production)"
        log "  2. Install MongoDB in-cluster (for testing only)"
        log ""
        prompt MONGODB_CHOICE "Choose option" "1"
        
        if [ "$MONGODB_CHOICE" = "1" ]; then
            prompt MONGODB_URI "Enter MongoDB connection URI" ""
            if [ -z "$MONGODB_URI" ]; then
                log_error "MongoDB URI is required for external MongoDB"
                exit 1
            fi
        else
            INSTALL_MONGODB="true"
            log_warn "In-cluster MongoDB is for testing only. Use MongoDB Atlas for production."
        fi
    fi
    
    # Admin credentials
    if [ -z "$ROOT_USER_EMAIL" ]; then
        prompt ROOT_USER_EMAIL "Enter admin email" "admin@$DOMAIN"
    fi
    log "Admin email: $ROOT_USER_EMAIL"
    
    if [ -z "$ROOT_USER_PASSWORD" ]; then
        DEFAULT_PASSWORD=$(generate_password)
        prompt ROOT_USER_PASSWORD "Enter admin password" "$DEFAULT_PASSWORD" "true"
    fi
    
    # Generate secrets
    JWT_SECRET=$(generate_password)
    SESSION_SECRET=$(generate_password)
    REDIS_PASSWORD=$(generate_password)
}

# ================================
# Install MongoDB (Optional)
# ================================

install_mongodb() {
    if [ "$INSTALL_MONGODB" != "true" ]; then
        return
    fi
    
    log_section "Installing MongoDB (In-Cluster)"
    
    # Add Bitnami repo
    helm repo add bitnami https://charts.bitnami.com/bitnami 2>/dev/null || true
    helm repo update
    
    # Create namespace
    kubectl create namespace $NAMESPACE --dry-run=client -o yaml | kubectl apply -f -
    
    # Generate MongoDB password
    MONGO_ROOT_PASSWORD=$(generate_password)
    
    # Install MongoDB
    helm upgrade --install mongodb bitnami/mongodb \
        --namespace $NAMESPACE \
        --set auth.rootPassword="$MONGO_ROOT_PASSWORD" \
        --set auth.database="controlplane" \
        --set persistence.size=10Gi \
        --wait
    
    # Set MongoDB URI for in-cluster
    MONGODB_URI="mongodb://root:${MONGO_ROOT_PASSWORD}@mongodb.${NAMESPACE}.svc.cluster.local:27017/controlplane?authSource=admin"
    
    log_success "MongoDB installed successfully"
}

# ================================
# Install Redis
# ================================

install_redis() {
    log_section "Installing Redis"
    
    # Add Bitnami repo
    helm repo add bitnami https://charts.bitnami.com/bitnami 2>/dev/null || true
    helm repo update
    
    # Create namespace
    kubectl create namespace $NAMESPACE --dry-run=client -o yaml | kubectl apply -f -
    
    # Check if already installed
    if helm status redis -n $NAMESPACE &>/dev/null; then
        log_success "Redis already installed"
        # Re-read the existing password from the secret so REDIS_URL stays valid
        REDIS_PASSWORD=$(kubectl get secret control-plane-secrets -n $NAMESPACE \
            -o jsonpath='{.data.redis-url}' 2>/dev/null \
            | base64 -d | sed -E 's|.*:([^@]+)@.*|\1|' || echo "$REDIS_PASSWORD")
        REDIS_URL="redis://:${REDIS_PASSWORD}@redis-master.${NAMESPACE}.svc.cluster.local:6379"
        return
    fi
    
    # Install Redis
    helm upgrade --install redis bitnami/redis \
        --namespace $NAMESPACE \
        --set architecture=standalone \
        --set auth.password="$REDIS_PASSWORD" \
        --set master.persistence.size=1Gi \
        --wait
    
    REDIS_URL="redis://:${REDIS_PASSWORD}@redis-master.${NAMESPACE}.svc.cluster.local:6379"
    
    log_success "Redis installed successfully"
}

# ================================
# Deploy Control Plane with Caddy
# ================================

deploy_control_plane() {
    log_section "Deploying Control Plane"
    
    # Create namespace
    kubectl create namespace $NAMESPACE --dry-run=client -o yaml | kubectl apply -f -
    
    # Create secrets
    log "Creating secrets..."
    kubectl create secret generic control-plane-secrets \
        --namespace $NAMESPACE \
        --from-literal=mongodb-uri="$MONGODB_URI" \
        --from-literal=jwt-secret="$JWT_SECRET" \
        --from-literal=session-secret="$SESSION_SECRET" \
        --from-literal=redis-url="$REDIS_URL" \
        --from-literal=root-user-email="$ROOT_USER_EMAIL" \
        --from-literal=root-user-password="$ROOT_USER_PASSWORD" \
        --dry-run=client -o yaml | kubectl apply -f -
    
    # Create Caddyfile ConfigMap
    log "Creating Caddy configuration..."
    
    # Determine if we should use HTTPS
    if [[ "$DOMAIN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        # IP address - use HTTP only
        CADDY_CONFIG="http://$DOMAIN {
    handle /api/* {
        reverse_proxy control-plane-api:5005
    }
    handle {
        reverse_proxy control-plane-web:3000
    }
}"
    else
        # Domain - use HTTPS with automatic certs
        if [ -n "$ACME_EMAIL" ]; then
            CADDY_CONFIG="{
    email $ACME_EMAIL
}

$DOMAIN {
    handle /api/* {
        reverse_proxy control-plane-api:5005
    }
    handle {
        reverse_proxy control-plane-web:3000
    }
}"
        else
            CADDY_CONFIG="$DOMAIN {
    handle /api/* {
        reverse_proxy control-plane-api:5005
    }
    handle {
        reverse_proxy control-plane-web:3000
    }
}"
        fi
    fi
    
    kubectl create configmap caddy-config \
        --namespace $NAMESPACE \
        --from-literal=Caddyfile="$CADDY_CONFIG" \
        --dry-run=client -o yaml | kubectl apply -f -
    
    # Create ServiceAccount and RBAC for API pod
    log "Configuring RBAC for API..."
    cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: ServiceAccount
metadata:
  name: control-plane-api
  namespace: $NAMESPACE
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: control-plane-api-admin
subjects:
  - kind: ServiceAccount
    name: control-plane-api
    namespace: $NAMESPACE
roleRef:
  kind: ClusterRole
  name: cluster-admin
  apiGroup: rbac.authorization.k8s.io
EOF

    # Store k3s join token as a secret for the API pod
    log "Storing K3s join token..."
    local K3S_TOKEN
    K3S_TOKEN=$(cat /var/lib/rancher/k3s/server/token 2>/dev/null || true)
    if [ -n "$K3S_TOKEN" ]; then
        kubectl create secret generic k3s-token -n $NAMESPACE \
            --from-literal=token="$K3S_TOKEN" \
            --dry-run=client -o yaml | kubectl apply -f -
        log_success "K3s join token stored"
    else
        log_warn "K3s token file not found — join token will need to be set manually"
    fi

    # Deploy Control Plane API
    log "Deploying Control Plane API..."
    cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: control-plane-api
  namespace: $NAMESPACE
  labels:
    app: control-plane-api
spec:
  replicas: 1
  selector:
    matchLabels:
      app: control-plane-api
  template:
    metadata:
      labels:
        app: control-plane-api
    spec:
      serviceAccountName: control-plane-api
      containers:
        - name: api
          image: ${IMAGE_REGISTRY}/control-plane-api:${VERSION}
          ports:
            - containerPort: 5005
          env:
            - name: NODE_ENV
              value: "production"
            - name: PORT
              value: "5005"
            - name: MONGODB_URI
              valueFrom:
                secretKeyRef:
                  name: control-plane-secrets
                  key: mongodb-uri
            - name: REDIS_URL
              valueFrom:
                secretKeyRef:
                  name: control-plane-secrets
                  key: redis-url
            - name: JWT_SECRET
              valueFrom:
                secretKeyRef:
                  name: control-plane-secrets
                  key: jwt-secret
            - name: SESSION_SECRET
              valueFrom:
                secretKeyRef:
                  name: control-plane-secrets
                  key: session-secret
            - name: ROOT_USER_EMAIL
              valueFrom:
                secretKeyRef:
                  name: control-plane-secrets
                  key: root-user-email
            - name: ROOT_USER_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: control-plane-secrets
                  key: root-user-password
            - name: COOKIE_DOMAIN
              value: "$DOMAIN"
            - name: ALLOWED_ORIGINS
              value: "$(if [[ "$DOMAIN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then echo "http://$DOMAIN"; else echo "https://$DOMAIN"; fi)"
            - name: K8S_ENABLED
              value: "true"
          volumeMounts:
            - name: k3s-token
              mountPath: /var/lib/rancher/k3s/server
              readOnly: true
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              cpu: 500m
              memory: 512Mi
          readinessProbe:
            httpGet:
              path: /api/health
              port: 5005
            initialDelaySeconds: 10
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /api/health
              port: 5005
            initialDelaySeconds: 15
            periodSeconds: 20
      volumes:
        - name: k3s-token
          secret:
            secretName: k3s-token
            items:
              - key: token
                path: token
---
apiVersion: v1
kind: Service
metadata:
  name: control-plane-api
  namespace: $NAMESPACE
spec:
  selector:
    app: control-plane-api
  ports:
    - port: 5005
      targetPort: 5005
EOF

    # Deploy Control Plane Web
    log "Deploying Control Plane Web..."
    cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: control-plane-web
  namespace: $NAMESPACE
  labels:
    app: control-plane-web
spec:
  replicas: 1
  selector:
    matchLabels:
      app: control-plane-web
  template:
    metadata:
      labels:
        app: control-plane-web
    spec:
      containers:
        - name: web
          image: ${IMAGE_REGISTRY}/control-plane-web:${VERSION}
          ports:
            - containerPort: 3000
          env:
            - name: NODE_ENV
              value: "production"
            - name: NUXT_HOST
              value: "0.0.0.0"
            - name: NUXT_PORT
              value: "3000"
            - name: API_URL
              value: "http://control-plane-api:5005"
            - name: COOKIE_DOMAIN
              value: "$DOMAIN"
          resources:
            requests:
              cpu: 50m
              memory: 128Mi
            limits:
              cpu: 200m
              memory: 256Mi
          readinessProbe:
            httpGet:
              path: /
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: control-plane-web
  namespace: $NAMESPACE
spec:
  selector:
    app: control-plane-web
  ports:
    - port: 3000
      targetPort: 3000
EOF

    # Create PersistentVolumeClaim for Caddy data (certificates)
    log "Creating persistent storage for Caddy certificates..."
    cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: caddy-data
  namespace: $NAMESPACE
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
EOF

    # Deploy Caddy with hostNetwork (required since K3s doesn't have cloud LB)
    log "Deploying Caddy (reverse proxy with auto-SSL)..."
    cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: caddy
  namespace: $NAMESPACE
  labels:
    app: caddy
spec:
  replicas: 1
  strategy:
    type: Recreate  # Required for hostNetwork to avoid port conflicts
  selector:
    matchLabels:
      app: caddy
  template:
    metadata:
      labels:
        app: caddy
    spec:
      hostNetwork: true
      dnsPolicy: ClusterFirstWithHostNet
      containers:
        - name: caddy
          image: caddy:2-alpine
          ports:
            - containerPort: 80
              hostPort: 80
            - containerPort: 443
              hostPort: 443
          volumeMounts:
            - name: caddy-config
              mountPath: /etc/caddy/Caddyfile
              subPath: Caddyfile
            - name: caddy-data
              mountPath: /data
            - name: caddy-config-storage
              mountPath: /config
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              cpu: 200m
              memory: 128Mi
      volumes:
        - name: caddy-config
          configMap:
            name: caddy-config
        - name: caddy-data
          persistentVolumeClaim:
            claimName: caddy-data
        - name: caddy-config-storage
          emptyDir: {}
EOF
    
    log_success "Control Plane deployed successfully"
}

# ================================
# Print Summary
# ================================

print_summary() {
    log_section "Installation Complete! 🎉"
    
    # Wait for pods to be ready
    log "Waiting for pods to be ready..."
    kubectl wait --for=condition=Ready pods --all -n $NAMESPACE --timeout=300s 2>/dev/null || true
    
    # Get public IP of this server
    PUBLIC_IP=$(get_public_ip)
    
    # Determine URL
    if [[ "$DOMAIN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        URL="http://$DOMAIN"
    else
        URL="https://$DOMAIN"
    fi
    
    echo ""
    echo -e "${GREEN}Control Plane is now running!${NC}"
    echo ""
    echo -e "  ${BLUE}URL:${NC}         $URL"
    echo -e "  ${BLUE}Server IP:${NC}   $PUBLIC_IP"
    echo -e "  ${BLUE}Email:${NC}       $ROOT_USER_EMAIL"
    echo -e "  ${BLUE}Password:${NC}    $ROOT_USER_PASSWORD"
    echo ""
    echo -e "${YELLOW}Important:${NC}"
    echo "  • Save your admin credentials securely"
    if [[ ! "$DOMAIN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        echo "  • Make sure your DNS A record for $DOMAIN points to $PUBLIC_IP"
        echo "  • SSL certificate will be provisioned automatically once DNS propagates"
    fi
    echo ""
    echo -e "${PURPLE}Useful Commands:${NC}"
    echo "  • View pods:     kubectl get pods -n $NAMESPACE"
    echo "  • View logs:     kubectl logs -n $NAMESPACE -l app=control-plane-api -f"
    echo "  • Caddy logs:    kubectl logs -n $NAMESPACE -l app=caddy -f"
    echo "  • Reset password: kubectl exec -n $NAMESPACE deployment/control-plane-api -- node dist/cli.js reset-password EMAIL PASSWORD"
    echo ""
    
    # Show pod status
    echo -e "${BLUE}Pod Status:${NC}"
    kubectl get pods -n $NAMESPACE
    echo ""
    
    # Save credentials
    CREDS_FILE="$DATA_DIR/credentials.txt"
    cat > "$CREDS_FILE" <<EOF
Control Plane Credentials
========================
URL:      $URL
Email:    $ROOT_USER_EMAIL
Password: $ROOT_USER_PASSWORD

Generated: $(date)
EOF
    chmod 600 "$CREDS_FILE"
    echo -e "${GREEN}Credentials saved to:${NC} $CREDS_FILE"
    echo ""
}

# ================================
# Main
# ================================

main() {
    echo ""
    echo -e "${PURPLE}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${PURPLE}║                                                           ║${NC}"
    echo -e "${PURPLE}║   ${GREEN}Control Plane Installer${PURPLE}                               ║${NC}"
    echo -e "${PURPLE}║   ${NC}Kubernetes-Native Self-Hosted PaaS${PURPLE}                    ║${NC}"
    echo -e "${PURPLE}║                                                           ║${NC}"
    echo -e "${PURPLE}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    
    preflight_checks
    open_firewall_ports
    install_k3s
    install_helm
    collect_config
    install_mongodb
    install_redis
    deploy_control_plane
    print_summary
}

main "$@"
