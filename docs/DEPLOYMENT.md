# Deployment Guide

Complete deployment documentation for Control Plane — a self-hosted Kubernetes cluster management platform.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
  - [One-Liner Installation](#one-liner-installation-docker-compose)
  - [Helm Installation](#helm-installation-kubernetes)
- [Full Production Setup](#full-production-setup)
  - [Infrastructure Planning](#infrastructure-planning)
  - [K3s Cluster Setup](#k3s-cluster-setup)
  - [MongoDB Atlas Configuration](#mongodb-atlas-configuration)
  - [Redis Setup](#redis-setup)
  - [Ingress & TLS Configuration](#ingress--tls-configuration)
  - [Environment Variables Reference](#environment-variables-reference)
- [Post-Installation](#post-installation)
  - [First-Time Setup Wizard](#first-time-setup-wizard)
  - [Creating Initial Admin User](#creating-initial-admin-user)
  - [Configuring DNS Settings](#configuring-dns-settings)
  - [Adding Worker Nodes](#adding-worker-nodes)
- [Upgrading](#upgrading)
  - [Docker Compose Upgrades](#docker-compose-upgrades)
  - [Helm Upgrades](#helm-upgrades)
  - [Database Migrations](#database-migrations)
  - [Rolling Updates](#rolling-updates)
- [Backup & Recovery](#backup--recovery)
  - [What to Backup](#what-to-backup)
  - [Backup Procedures](#backup-procedures)
  - [Disaster Recovery](#disaster-recovery)
- [Troubleshooting](#troubleshooting)
  - [Common Issues](#common-issues)
  - [Log Locations](#log-locations)
  - [Health Check Endpoints](#health-check-endpoints)
- [Security Best Practices](#security-best-practices)

---

## Prerequisites

### Infrastructure Requirements

| Component | Minimum | Recommended | Notes |
|-----------|---------|-------------|-------|
| VMs/Nodes | 1 | 3+ | For HA, use 3 control plane nodes |
| CPU per node | 2 cores | 4 cores | More for heavy workloads |
| RAM per node | 4 GB | 8 GB | K3s + workloads need headroom |
| Disk per node | 20 GB | 50 GB SSD | SSDs strongly recommended |
| OS | Ubuntu 20.04+ | Ubuntu 22.04 LTS | Also supports Debian, RHEL, Alpine |

**Supported Cloud Providers:**
- Hetzner Cloud
- DigitalOcean
- AWS EC2
- Google Cloud Platform
- Azure
- Vultr
- Linode
- Any VPS with root access

### Network Requirements

| Port | Protocol | Purpose | Required |
|------|----------|---------|----------|
| 22 | TCP | SSH access | Yes |
| 80 | TCP | HTTP (redirects to HTTPS) | Yes |
| 443 | TCP | HTTPS | Yes |
| 6443 | TCP | K3s API server | Yes (for K3s) |
| 10250 | TCP | Kubelet metrics | Optional |
| 2379-2380 | TCP | etcd (HA only) | HA clusters only |
| 8472 | UDP | Flannel VXLAN (multi-node) | Multi-node only |

### DNS Requirements

Point your domain to your master node (or load balancer for HA):

```
cp.example.com        → Master Node IP (or Load Balancer)
*.apps.example.com    → Same IP (wildcard for deployed apps)
```

### External Services

| Service | Required | Purpose |
|---------|----------|---------|
| **MongoDB Atlas** | Production | State storage (control plane data) |
| **Redis** | Yes | Session storage, caching, pub/sub |
| **S3-compatible storage** | Optional | Backups, artifacts |

> **Note:** For development/testing, the installer can run MongoDB locally in Docker. For production, always use MongoDB Atlas.

---

## Quick Start

### One-Liner Installation (Docker Compose)

For single-node deployments or quick testing:

```bash
curl -fsSL https://get.controlplane.dev/install.sh | bash
```

**With production options:**

```bash
MONGODB_URI="mongodb+srv://user:pass@cluster.mongodb.net/control_plane?retryWrites=true&w=majority" \
DOMAIN="cp.example.com" \
ACME_EMAIL="admin@example.com" \
ROOT_USER_EMAIL="admin@example.com" \
ROOT_USER_PASSWORD="your-secure-password" \
curl -fsSL https://get.controlplane.dev/install.sh | bash
```

This installs:
- Docker & Docker Compose (if needed)
- K3s (lightweight Kubernetes)
- Control Plane API (Express + TypeScript)
- Control Plane Web (Nuxt 4)
- Caddy (reverse proxy + auto HTTPS)
- Percona MongoDB Operator (for database provisioning)

---

### Helm Installation (Kubernetes)

For existing Kubernetes clusters or production deployments:

```bash
# Add the Helm repository (when published)
helm repo add control-plane https://charts.controlplane.dev
helm repo update

# Or use the local chart from the repository
git clone https://github.com/yourorg/control-plane.git
cd control-plane

# Install with required values
helm install control-plane ./deploy/helm/control-plane \
  --namespace control-plane \
  --create-namespace \
  --set api.mongodb.uri="mongodb+srv://user:pass@cluster.mongodb.net/control_plane?retryWrites=true&w=majority" \
  --set ingress.host="cp.example.com" \
  --set ingress.tls.enabled=true
```

**With a values file:**

```bash
# Create values-production.yaml
cat > values-production.yaml << 'EOF'
api:
  replicas: 3
  mongodb:
    uri: "mongodb+srv://user:pass@cluster.mongodb.net/control_plane"
  redis:
    host: "redis-master.redis.svc.cluster.local"
    port: 6379
  resources:
    requests:
      cpu: 250m
      memory: 512Mi
    limits:
      cpu: 1000m
      memory: 1Gi

web:
  replicas: 3
  resources:
    requests:
      cpu: 100m
      memory: 256Mi
    limits:
      cpu: 500m
      memory: 512Mi

ingress:
  enabled: true
  className: traefik
  host: "cp.example.com"
  tls:
    enabled: true
    issuer: letsencrypt-prod

redis:
  enabled: true
  architecture: standalone
  auth:
    enabled: true
    password: "your-redis-password"

autoscaling:
  api:
    enabled: true
    minReplicas: 3
    maxReplicas: 10
  web:
    enabled: true
    minReplicas: 3
    maxReplicas: 10
EOF

# Install with values file
helm install control-plane ./deploy/helm/control-plane \
  --namespace control-plane \
  --create-namespace \
  -f values-production.yaml
```

---

## Full Production Setup

### Infrastructure Planning

#### Single Node (Development/Testing)

```
┌─────────────────────────────────────────────────────────────────┐
│                         SINGLE VPS                              │
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐│
│  │                    Docker Compose                          ││
│  │                                                            ││
│  │  Caddy ─── Web ─── API ─── Redis ─── MongoDB (local)       ││
│  └────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐│
│  │                      K3s Cluster                           ││
│  │                                                            ││
│  │  [Percona Operator] ─── [MongoDB Pods for deployments]     ││
│  └────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

#### High Availability (3+ Nodes)

```
                     ┌─────────────────────────────────────┐
                     │         LOAD BALANCER               │
                     │   (Cloudflare, HAProxy, etc.)       │
                     └─────────────────┬───────────────────┘
                                       │
           ┌───────────────────────────┼───────────────────────────┐
           │                           │                           │
           ▼                           ▼                           ▼
┌─────────────────────┐   ┌─────────────────────┐   ┌─────────────────────┐
│   Node 1 (Master)   │   │   Node 2 (Master)   │   │   Node 3 (Master)   │
│                     │   │                     │   │                     │
│  K3s Server         │   │  K3s Server         │   │  K3s Server         │
│  Control Plane      │   │  Control Plane      │   │  Control Plane      │
│  (API + Web)        │   │  (API + Web)        │   │  (API + Web)        │
└─────────┬───────────┘   └─────────┬───────────┘   └─────────┬───────────┘
          │                         │                         │
          └─────────────────────────┼─────────────────────────┘
                                    │
                                    ▼
                     ┌─────────────────────────────────────┐
                     │          MongoDB Atlas              │
                     │        (Shared State Store)         │
                     └─────────────────────────────────────┘
```

---

### K3s Cluster Setup

#### Single Master (Development)

```bash
# On the master node
curl -sfL https://get.k3s.io | sh -s - server \
  --disable traefik \
  --disable servicelb \
  --write-kubeconfig-mode 644 \
  --tls-san "$(curl -4s https://ifconfig.io)"

# Verify
kubectl get nodes
```

#### High Availability (3 Masters)

**Step 1: Initialize the first master**

```bash
# On Node 1 (first master)
PUBLIC_IP=$(curl -4s https://ifconfig.io)

curl -sfL https://get.k3s.io | sh -s - server \
  --cluster-init \
  --disable traefik \
  --disable servicelb \
  --write-kubeconfig-mode 644 \
  --tls-san "$PUBLIC_IP" \
  --tls-san "cp.example.com"

# Get the token for other masters
cat /var/lib/rancher/k3s/server/node-token
```

**Step 2: Join additional masters**

```bash
# On Node 2 and Node 3
FIRST_MASTER_IP="<node1-ip>"
TOKEN="<token-from-node1>"
PUBLIC_IP=$(curl -4s https://ifconfig.io)

curl -sfL https://get.k3s.io | sh -s - server \
  --server "https://${FIRST_MASTER_IP}:6443" \
  --token "${TOKEN}" \
  --disable traefik \
  --disable servicelb \
  --write-kubeconfig-mode 644 \
  --tls-san "$PUBLIC_IP" \
  --tls-san "cp.example.com"
```

**Step 3: Verify the cluster**

```bash
kubectl get nodes
# NAME     STATUS   ROLES                       AGE   VERSION
# node1    Ready    control-plane,etcd,master   5m    v1.28.x
# node2    Ready    control-plane,etcd,master   3m    v1.28.x
# node3    Ready    control-plane,etcd,master   2m    v1.28.x
```

---

### MongoDB Atlas Configuration

**Step 1: Create a cluster**

1. Go to [MongoDB Atlas](https://cloud.mongodb.com)
2. Create a new project
3. Build a new cluster:
   - **Cluster tier:** M10+ for production (M0 free tier for testing)
   - **Provider:** AWS, GCP, or Azure
   - **Region:** Same as your VMs for lowest latency
   - **Cluster name:** `control-plane-prod`

**Step 2: Configure network access**

1. Go to **Network Access** → **Add IP Address**
2. Add your node IPs (or `0.0.0.0/0` for anywhere — less secure)

**Step 3: Create a database user**

1. Go to **Database Access** → **Add New Database User**
2. Authentication method: **Password**
3. Username: `control-plane`
4. Password: Generate a strong password
5. Role: **Atlas Admin** (or `readWriteAnyDatabase` for production)

**Step 4: Get the connection string**

1. Go to **Database** → **Connect**
2. Select **Drivers** → **Node.js**
3. Copy the connection string:

```
mongodb+srv://control-plane:<password>@cluster0.xxxxx.mongodb.net/control_plane?retryWrites=true&w=majority
```

---

### Redis Setup

#### Option A: Internal Redis (Helm subchart)

Enable the Redis subchart in your Helm values:

```yaml
redis:
  enabled: true
  architecture: standalone
  auth:
    enabled: true
    password: "your-secure-redis-password"
  master:
    persistence:
      enabled: true
      size: 2Gi
```

#### Option B: External Redis (Recommended for HA)

Use a managed Redis service (AWS ElastiCache, Redis Cloud, etc.) or deploy your own:

```yaml
# values.yaml
redis:
  enabled: false

api:
  redis:
    host: "your-redis-cluster.example.com"
    port: 6379
    password: "your-redis-password"
```

#### Option C: Docker Compose (Single Node)

The installer automatically configures Redis. For manual setup:

```bash
# In .env
REDIS_URL=redis://localhost:6379
```

---

### Ingress & TLS Configuration

#### Traefik (Default with K3s)

Install Traefik and cert-manager:

```bash
# Install Traefik
kubectl apply -f https://raw.githubusercontent.com/traefik/traefik/v2.11/docs/content/reference/dynamic-configuration/kubernetes-crd-definition-v1.yml

helm repo add traefik https://traefik.github.io/charts
helm install traefik traefik/traefik \
  --namespace traefik \
  --create-namespace \
  --set ingressClass.enabled=true \
  --set ingressClass.isDefaultClass=true

# Install cert-manager
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.14.0/cert-manager.yaml

# Create ClusterIssuer for Let's Encrypt
cat <<EOF | kubectl apply -f -
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: admin@example.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
    - http01:
        ingress:
          class: traefik
EOF
```

Helm values for Traefik ingress:

```yaml
ingress:
  enabled: true
  className: traefik
  host: "cp.example.com"
  annotations:
    traefik.ingress.kubernetes.io/router.entrypoints: websecure
    traefik.ingress.kubernetes.io/router.tls: "true"
  tls:
    enabled: true
    issuer: letsencrypt-prod
```

#### Nginx Ingress

```bash
# Install nginx-ingress
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm install nginx-ingress ingress-nginx/ingress-nginx \
  --namespace ingress-nginx \
  --create-namespace
```

Helm values for Nginx ingress:

```yaml
ingress:
  enabled: true
  className: nginx
  host: "cp.example.com"
  annotations:
    nginx.ingress.kubernetes.io/proxy-body-size: "50m"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
  tls:
    enabled: true
    issuer: letsencrypt-prod
```

---

### Environment Variables Reference

#### API Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | `production` | Environment mode |
| `PORT` | No | `5005` | API listen port |
| `MONGODB_URI` | **Yes** | — | MongoDB connection string |
| `REDIS_URL` | **Yes** | — | Redis connection string |
| `JWT_SECRET` | **Yes** | Auto-generated | JWT signing secret |
| `SESSION_SECRET` | **Yes** | Auto-generated | Session signing secret |
| `COOKIE_DOMAIN` | No | — | Cookie domain (e.g., `.example.com`) |
| `ALLOWED_ORIGINS` | No | `*` | CORS allowed origins |
| `ROOT_USERNAME` | No | — | Initial admin username |
| `ROOT_USER_EMAIL` | No | — | Initial admin email |
| `ROOT_USER_PASSWORD` | No | — | Initial admin password |
| `K8S_ENABLED` | No | `false` | Enable K8s integration |
| `K8S_KUBECONFIG` | No | `/etc/rancher/k3s/k3s.yaml` | Path to kubeconfig |
| `K3S_SERVER_URL` | No | — | K3s API server URL |
| `K3S_TOKEN` | No | — | K3s join token |
| `CADDY_ENABLED` | No | `true` | Enable Caddy integration |
| `CADDY_ADMIN_URL` | No | `http://localhost:2019` | Caddy admin API URL |

#### Web Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | `production` | Environment mode |
| `NUXT_HOST` | No | `0.0.0.0` | Listen host |
| `NUXT_PORT` | No | `3000` | Listen port |
| `API_URL` | **Yes** | — | Backend API URL |
| `COOKIE_DOMAIN` | No | — | Cookie domain |

---

## Post-Installation

### First-Time Setup Wizard

After installation, access the web UI at `https://cp.example.com`. The first-time setup wizard will guide you through:

1. **Create admin account** — If `ROOT_USER_*` env vars weren't set
2. **Connect cloud providers** — AWS, GCP, Hetzner credentials
3. **Configure defaults** — Default cluster settings, namespaces
4. **Import existing clusters** — Bring in existing K8s clusters

### Creating Initial Admin User

**Option A: Environment variables (during install)**

```bash
ROOT_USERNAME="admin" \
ROOT_USER_EMAIL="admin@example.com" \
ROOT_USER_PASSWORD="secure-password-here" \
curl -fsSL https://get.controlplane.dev/install.sh | bash
```

**Option B: CLI (after install)**

```bash
docker exec -it control-plane-api node -e "
  const { createUser } = require('./dist/resources/user/user.service');
  createUser({
    username: 'admin',
    email: 'admin@example.com',
    password: 'secure-password-here',
    role: 'admin'
  }).then(u => console.log('Created:', u.email));
"
```

**Option C: API (after install)**

```bash
# Only works if initial setup hasn't been completed
curl -X POST https://cp.example.com/api/setup/admin \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "email": "admin@example.com",
    "password": "secure-password-here"
  }'
```

### Configuring DNS Settings

1. **Point domain to Control Plane:**
   ```
   cp.example.com  →  YOUR_SERVER_IP
   ```

2. **Configure wildcard for deployed apps:**
   ```
   *.apps.example.com  →  YOUR_SERVER_IP
   ```

3. **Update Control Plane settings:**
   - Go to **Settings** → **DNS**
   - Set **Base Domain**: `apps.example.com`
   - Set **DNS Provider**: Cloudflare, Route53, etc.
   - Add API credentials for automatic DNS management

### Adding Worker Nodes

**Get join credentials from the Control Plane dashboard:**

1. Go to **Infrastructure** → **Clusters** → **Your Cluster**
2. Click **Add Node**
3. Copy the join command

**Or manually from the master:**

```bash
# On the master node, get the token
cat /var/lib/rancher/k3s/server/node-token

# On the worker node
K3S_URL="https://MASTER_IP:6443"
K3S_TOKEN="your-node-token"

curl -sfL https://get.k3s.io | K3S_URL="$K3S_URL" K3S_TOKEN="$K3S_TOKEN" sh -s - agent
```

**Verify the node joined:**

```bash
kubectl get nodes
```

---

## Upgrading

### Docker Compose Upgrades

**Automatic upgrades (default):**

Auto-updates are enabled by default. The system checks daily for new versions.

**Manual upgrade:**

```bash
# Re-run the installer (detects existing installation)
curl -fsSL https://get.controlplane.dev/install.sh | bash

# Or use the upgrade script directly
/data/control-plane/source/upgrade.sh [version]

# Examples
/data/control-plane/source/upgrade.sh           # Latest
/data/control-plane/source/upgrade.sh v1.5.0    # Specific version
```

**Disable auto-updates:**

```bash
echo "AUTOUPDATE=false" >> /data/control-plane/source/.env
docker compose up -d
```

### Helm Upgrades

**Standard upgrade:**

```bash
# Update the repo
helm repo update

# Upgrade with existing values
helm upgrade control-plane ./deploy/helm/control-plane \
  --namespace control-plane \
  --reuse-values

# Or with new values
helm upgrade control-plane ./deploy/helm/control-plane \
  --namespace control-plane \
  -f values-production.yaml
```

**Upgrade to specific version:**

```bash
helm upgrade control-plane ./deploy/helm/control-plane \
  --namespace control-plane \
  --reuse-values \
  --set api.image.tag=v1.5.0 \
  --set web.image.tag=v1.5.0
```

**Check upgrade status:**

```bash
helm history control-plane -n control-plane
kubectl rollout status deployment/control-plane-api -n control-plane
kubectl rollout status deployment/control-plane-web -n control-plane
```

**Rollback if needed:**

```bash
helm rollback control-plane 1 -n control-plane
```

### Database Migrations

Database migrations run automatically on startup. The API checks for pending migrations and applies them before accepting traffic.

**Manual migration (if needed):**

```bash
# Docker Compose
docker exec -it control-plane-api npm run migrate

# Kubernetes
kubectl exec -it deploy/control-plane-api -n control-plane -- npm run migrate
```

**Check migration status:**

```bash
# View migration history
docker exec -it control-plane-api npm run migrate:status
```

### Rolling Updates

Helm deployments use rolling updates by default:

```yaml
# In deployment template
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxUnavailable: 0
    maxSurge: 1
```

**Monitor rolling update:**

```bash
kubectl rollout status deployment/control-plane-api -n control-plane
```

**Pause/resume rollout:**

```bash
kubectl rollout pause deployment/control-plane-api -n control-plane
kubectl rollout resume deployment/control-plane-api -n control-plane
```

---

## Backup & Recovery

### What to Backup

| Component | Location | Criticality | Frequency |
|-----------|----------|-------------|-----------|
| MongoDB Atlas | Automatic snapshots | **Critical** | Continuous |
| `.env` file | `/data/control-plane/source/.env` | **Critical** | On change |
| K8s Secrets | `kubectl get secrets` | **Critical** | Daily |
| SSH keys | `/data/control-plane/ssh/` | High | On change |
| TLS certificates | Caddy data volume | Medium | Weekly |
| Caddy config | `/data/control-plane/source/Caddyfile` | Medium | On change |

### Backup Procedures

#### MongoDB Atlas (Automatic)

MongoDB Atlas provides automatic backups:

1. Go to **Atlas** → **Backup**
2. Enable **Continuous Backup** or **Cloud Backup**
3. Set retention policy (e.g., 7 days)
4. Enable point-in-time recovery

#### Configuration Backup

```bash
#!/bin/bash
# backup-config.sh

BACKUP_DIR="/backups/control-plane/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

# Backup .env (contains secrets!)
cp /data/control-plane/source/.env "$BACKUP_DIR/"

# Backup Docker Compose files
cp /data/control-plane/source/docker-compose*.yml "$BACKUP_DIR/"
cp /data/control-plane/source/Caddyfile "$BACKUP_DIR/"

# Backup SSH keys
cp -r /data/control-plane/ssh/keys "$BACKUP_DIR/"

# Backup K8s secrets
kubectl get secrets -n control-plane -o yaml > "$BACKUP_DIR/k8s-secrets.yaml"

# Encrypt and upload to S3
tar -czf - "$BACKUP_DIR" | \
  gpg --symmetric --cipher-algo AES256 | \
  aws s3 cp - "s3://your-bucket/control-plane-backup-$(date +%Y%m%d).tar.gz.gpg"

echo "Backup completed: $BACKUP_DIR"
```

#### Kubernetes Secrets Backup

```bash
# Backup all secrets in the namespace
kubectl get secrets -n control-plane -o yaml > k8s-secrets-backup.yaml

# Backup specific secrets
kubectl get secret control-plane-secrets -n control-plane -o yaml > secrets.yaml
```

### Disaster Recovery

#### Scenario 1: Single Node Failure (HA Cluster)

With 3+ masters, the cluster continues operating:

```bash
# Check cluster health
kubectl get nodes
kubectl get pods -A

# If a node is unresponsive, drain it
kubectl drain failed-node --ignore-daemonsets --delete-emptydir-data
kubectl delete node failed-node

# Provision a new node and join
curl -sfL https://get.k3s.io | K3S_URL="https://..." K3S_TOKEN="..." sh -s - server
```

#### Scenario 2: Complete Cluster Loss

1. **Provision new infrastructure:**
   ```bash
   # Use your IaC (Terraform, Pulumi, etc.)
   terraform apply
   ```

2. **Restore K3s cluster:**
   ```bash
   # On first master
   curl -sfL https://get.k3s.io | sh -s - server --cluster-init ...
   
   # Join other masters
   curl -sfL https://get.k3s.io | sh -s - server --server https://... ...
   ```

3. **Restore secrets:**
   ```bash
   # Decrypt backup
   gpg --decrypt backup.tar.gz.gpg | tar -xz
   
   # Apply K8s secrets
   kubectl apply -f k8s-secrets-backup.yaml
   ```

4. **Redeploy Control Plane:**
   ```bash
   helm install control-plane ./deploy/helm/control-plane \
     --namespace control-plane \
     -f values-production.yaml
   ```

5. **MongoDB Atlas connection:**
   - Data is safe in Atlas
   - Update connection string if cluster URL changed
   - Verify connectivity

#### Scenario 3: MongoDB Atlas Data Corruption

1. **Restore from Atlas snapshot:**
   - Go to **Atlas** → **Backup** → **Restore**
   - Select point-in-time or snapshot
   - Restore to same or new cluster

2. **Update connection string (if new cluster):**
   ```bash
   # Update .env or Helm values
   api.mongodb.uri: "mongodb+srv://new-cluster..."
   
   # Restart API
   kubectl rollout restart deployment/control-plane-api -n control-plane
   ```

---

## Troubleshooting

### Common Issues

#### Services Won't Start

```bash
# Check container/pod status
docker compose ps                              # Docker Compose
kubectl get pods -n control-plane              # Kubernetes

# Check logs
docker logs control-plane-api                  # Docker Compose
kubectl logs deploy/control-plane-api -n control-plane  # Kubernetes

# Common causes:
# - MongoDB URI incorrect
# - Redis not reachable
# - Port conflicts
# - Insufficient resources
```

#### MongoDB Connection Issues

```bash
# Check connection string
cat /data/control-plane/source/.env | grep MONGODB

# Test connection
docker exec -it control-plane-api node -e "
  const { MongoClient } = require('mongodb');
  MongoClient.connect(process.env.MONGODB_URI)
    .then(() => console.log('✓ Connected'))
    .catch(e => console.error('✗ Error:', e.message));
"

# Common causes:
# - IP not whitelisted in Atlas
# - Wrong credentials
# - DNS resolution failure (try IP instead of hostname)
```

#### K3s Not Starting

```bash
# Check K3s service
systemctl status k3s
journalctl -u k3s -f

# Common causes:
# - Port 6443 blocked by firewall
# - Insufficient disk space
# - Network issues between nodes

# Restart K3s
systemctl restart k3s
```

#### SSL Certificate Issues

```bash
# Check Caddy logs (Docker)
docker logs control-plane-proxy

# Check cert-manager (Kubernetes)
kubectl get certificates -n control-plane
kubectl describe certificate control-plane-tls -n control-plane
kubectl logs deploy/cert-manager -n cert-manager

# Force renewal
docker exec control-plane-proxy caddy reload --config /etc/caddy/Caddyfile
```

#### Pod Stuck in Pending

```bash
# Check why pod is pending
kubectl describe pod <pod-name> -n control-plane

# Common causes:
# - Insufficient resources (CPU/memory)
# - PVC not bound
# - Node selector doesn't match

# Check node resources
kubectl describe nodes | grep -A 5 "Allocated resources"
```

### Log Locations

| Component | Docker Compose | Kubernetes |
|-----------|---------------|------------|
| API | `docker logs control-plane-api` | `kubectl logs deploy/control-plane-api -n control-plane` |
| Web | `docker logs control-plane-web` | `kubectl logs deploy/control-plane-web -n control-plane` |
| Caddy | `docker logs control-plane-proxy` | `kubectl logs deploy/traefik -n traefik` |
| K3s | `journalctl -u k3s` | N/A |
| MongoDB | `docker logs control-plane-mongodb` | Atlas Console |

**Aggregate logs:**

```bash
# Docker Compose
cd /data/control-plane/source
docker compose logs -f

# Kubernetes
kubectl logs -f -l app.kubernetes.io/instance=control-plane -n control-plane
```

### Health Check Endpoints

| Endpoint | Purpose | Expected Response |
|----------|---------|-------------------|
| `GET /api/health` | Basic liveness | `{ "status": "ok" }` |
| `GET /api/health/ready` | Readiness (all deps) | `{ "status": "ok", "mongodb": "ok", "redis": "ok" }` |
| `GET /api/health/detailed` | Full diagnostics | Detailed JSON (auth required) |
| `GET /health` (Web) | Frontend health | `200 OK` |

**Check health:**

```bash
# Basic health
curl https://cp.example.com/api/health

# Readiness
curl https://cp.example.com/api/health/ready

# Detailed (requires auth)
curl -H "Authorization: Bearer $TOKEN" https://cp.example.com/api/health/detailed
```

### Reset Installation

**Docker Compose:**

```bash
# Stop everything
cd /data/control-plane/source
docker compose down -v

# Remove K3s
/usr/local/bin/k3s-uninstall.sh

# Remove data
rm -rf /data/control-plane

# Re-install
curl -fsSL https://get.controlplane.dev/install.sh | bash
```

**Kubernetes:**

```bash
# Uninstall Helm release
helm uninstall control-plane -n control-plane

# Delete namespace
kubectl delete namespace control-plane

# Delete PVCs if needed
kubectl delete pvc -l app.kubernetes.io/instance=control-plane -n control-plane

# Re-install
helm install control-plane ./deploy/helm/control-plane ...
```

---

## Security Best Practices

1. **Use MongoDB Atlas for production**
   - Encrypted at rest and in transit
   - Automatic backups
   - IP whitelisting

2. **Enable firewall**
   ```bash
   ufw allow 22/tcp
   ufw allow 80/tcp
   ufw allow 443/tcp
   ufw allow 6443/tcp  # Only from trusted IPs
   ufw enable
   ```

3. **Use strong, unique secrets**
   - Auto-generated by installer
   - Rotate periodically
   - Never commit to version control

4. **Keep software updated**
   - Enable auto-updates or upgrade regularly
   - Monitor security advisories

5. **Restrict API access**
   - Use API tokens with minimal scopes
   - Enable rate limiting
   - Review audit logs

6. **Network policies (Kubernetes)**
   ```yaml
   apiVersion: networking.k8s.io/v1
   kind: NetworkPolicy
   metadata:
     name: control-plane-api
     namespace: control-plane
   spec:
     podSelector:
       matchLabels:
         app: control-plane-api
     ingress:
     - from:
       - podSelector:
           matchLabels:
             app: control-plane-web
       - podSelector:
           matchLabels:
             app.kubernetes.io/name: traefik
   ```

7. **Pod security standards**
   - Run as non-root
   - Read-only filesystem where possible
   - Drop all capabilities

---

## CI/CD Integration

The repository includes GitHub Actions workflows for automated builds and deployments:

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yaml` | Push/PR | Lint, test, type-check |
| `build-push.yaml` | Push to main, tags | Build & push Docker images |
| `deploy.yaml` | Manual dispatch | Deploy to staging/production |
| `release.yaml` | Tag `v*` | Create GitHub release |

**Manual deployment via GitHub Actions:**

1. Go to **Actions** → **Deploy**
2. Click **Run workflow**
3. Select environment (staging/production)
4. Enter version (e.g., `v1.5.0` or `latest`)
5. Optionally enable dry-run

**Required secrets:**

| Secret | Purpose |
|--------|---------|
| `KUBECONFIG` | Base64-encoded kubeconfig |
| `GITHUB_TOKEN` | Auto-provided for GHCR |

---

## Support

- **Documentation:** https://docs.controlplane.dev
- **GitHub Issues:** https://github.com/yourorg/control-plane/issues
- **Discord:** https://discord.gg/controlplane
- **Email:** support@controlplane.dev
