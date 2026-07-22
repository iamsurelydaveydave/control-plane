# Control Plane Deployment

This directory contains everything needed to deploy Control Plane as a self-hosted infrastructure management platform.

## Architecture

Control Plane uses a split deployment architecture:

- **API**: Deployed on K3s (Kubernetes) with Caddy for HTTPS
- **Frontend**: Deployed on Cloudflare Workers (SPA mode)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Cloudflare Workers                             │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │   control-plane-web (SPA)                                             │  │
│  │   https://cplane.goweekdays.com                                       │  │
│  └─────────────────────────────────────┬─────────────────────────────────┘  │
│                                        │                                    │
└────────────────────────────────────────┼────────────────────────────────────┘
                                         │ HTTPS (API calls)
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              K3s Cluster                                    │
│                                                                             │
│  ┌─────────────────────┐                                                   │
│  │   Caddy (Proxy)     │◀─── Automatic HTTPS (Let's Encrypt)               │
│  │   :80, :443         │     https://api.cplane.goweekdays.com             │
│  └──────────┬──────────┘                                                   │
│             │                                                               │
│             ▼                                                               │
│  ┌──────────────────────┐                                                  │
│  │   Control Plane API  │───────┐                                          │
│  │   (Express)          │       │                                          │
│  │   :5005              │       │                                          │
│  └──────────┬───────────┘       │                                          │
│             │                   │                                          │
│     ┌───────┴───────┐           │                                          │
│     │               │           │                                          │
│     ▼               ▼           ▼                                          │
│  ┌──────────┐   ┌────────────────────┐                                     │
│  │  Redis   │   │    MongoDB Atlas   │                                     │
│  │  :6379   │   │   (external)       │                                     │
│  └──────────┘   └────────────────────┘                                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Step 1: Deploy the API

Run the installer on your K3s server:

```bash
curl -fsSL https://get.goweekdays.com/install-api.sh | bash
```

The installer will prompt you for:
- **API subdomain**: e.g., `api.cplane.goweekdays.com`
- **Frontend origin**: e.g., `https://cplane.goweekdays.com` (for CORS)
- **MongoDB URI**: Use MongoDB Atlas for production
- **Admin credentials**: Email and password

### Step 2: Configure DNS

Point your API subdomain to the server's IP:

```
api.cplane.goweekdays.com  →  A  →  203.0.113.10
```

The SSL certificate will be provisioned automatically once DNS propagates.

### Step 3: Deploy the Frontend

The frontend is deployed separately to Cloudflare Workers. See [Frontend Deployment](#frontend-deployment) below.

## Environment Variables

### API Installation (`install-api.sh`)

| Variable | Description | Required |
|----------|-------------|----------|
| `API_SUBDOMAIN` | Subdomain for the API (e.g., `api.cplane.goweekdays.com`) | Yes |
| `WEB_ORIGIN` | Frontend origin for CORS (e.g., `https://cplane.goweekdays.com`) | Yes |
| `MONGODB_URI` | MongoDB Atlas connection string | For production |
| `ACME_EMAIL` | Email for Let's Encrypt certificates | Optional |
| `ROOT_USER_EMAIL` | Initial admin email | Optional |
| `ROOT_USER_PASSWORD` | Initial admin password | Optional |
| `VERSION` | Specific version to install | Default: `latest` |
| `IMAGE_REGISTRY` | Docker image registry | Default: `ghcr.io/iamsurelydaveydave` |
| `SKIP_K3S` | Skip K3s installation (use existing cluster) | Default: `false` |
| `BUILD_LOCAL` | Build images locally vs pull from registry | Default: `true` |

### Frontend Deployment

Set these when building/deploying the frontend:

| Variable | Description | Example |
|----------|-------------|---------|
| `API_URL` | Full URL to the API | `https://api.cplane.goweekdays.com` |
| `COOKIE_DOMAIN` | Domain for auth cookies | `.cplane.goweekdays.com` |

## Frontend Deployment

### Manual Deployment

1. Clone the repository:
   ```bash
   git clone https://github.com/iamsurelydaveydave/control-plane
   cd control-plane/control-plane-web
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Build with your API URL:
   ```bash
   API_URL=https://api.cplane.goweekdays.com \
   COOKIE_DOMAIN=.cplane.goweekdays.com \
   pnpm build
   ```

4. Deploy to Cloudflare Workers:
   ```bash
   pnpm deploy:production
   ```

### GitHub Actions (CI/CD)

The repository includes a GitHub Actions workflow (`.github/workflows/deploy-web.yaml`) that automatically deploys the frontend on push to `main`, `staging`, or `develop`.

**Required GitHub Secrets:**
- `CF_API_TOKEN`: Cloudflare API token
- `CF_ACCOUNT_ID`: Cloudflare account ID

**Required GitHub Variables (per environment):**
- `API_URL_PRODUCTION`: e.g., `https://api.cplane.goweekdays.com`
- `COOKIE_DOMAIN_PRODUCTION`: e.g., `.cplane.goweekdays.com`
- `API_URL_STAGING`, `COOKIE_DOMAIN_STAGING`
- `API_URL_DEVELOPMENT`, `COOKIE_DOMAIN_DEVELOPMENT`

## What Gets Installed (API Server)

```
/data/control-plane/
├── source/                  # Git clone of the repository
│   ├── control-plane-api/
│   └── control-plane-web/
├── ssh/                     # SSH keys for server management
│   ├── keys/
│   └── mux/
├── logs/                    # Application logs
└── credentials.txt          # Saved credentials (chmod 600)
```

## Kubernetes Resources

The API installer creates these resources in the `control-plane` namespace:

| Resource | Description |
|----------|-------------|
| `control-plane-api` | Deployment + Service for the API |
| `caddy` | Deployment for the reverse proxy |
| `redis` | Helm chart (Bitnami) for caching |
| `control-plane-secrets` | Secret with all credentials |
| `caddy-config` | ConfigMap with Caddyfile |
| `caddy-data` | PVC for SSL certificates |

## Manual Operations

### Check Status

```bash
kubectl get pods -n control-plane
kubectl get services -n control-plane
```

### View Logs

```bash
kubectl logs -n control-plane -l app=control-plane-api -f
kubectl logs -n control-plane -l app=caddy -f
```

### Restart Services

```bash
kubectl rollout restart deployment/control-plane-api -n control-plane
```

### Reset Admin Password

```bash
kubectl exec -n control-plane deployment/control-plane-api -- \
  node dist/cli.js reset-password admin@example.com newpassword123
```

## Files

| File | Description |
|------|-------------|
| `install-api.sh` | API installer script (K3s + API only) |
| `install.sh` | Legacy full-stack installer |
| `upgrade.sh` | Upgrade script |
| `docker-compose.yml` | Docker Compose file (legacy) |
| `Caddyfile` | Caddy config template |
| `versions.json` | Version information |
| `Dockerfile.api` | API Docker image |
| `Dockerfile.web` | Web Docker image (legacy) |

## Security Considerations

1. **Secrets**: Auto-generated and stored in Kubernetes secrets
2. **SSH Keys**: Used for server management, stored in `/data/control-plane/ssh/keys/`
3. **HTTPS**: Automatic via Caddy when domain is set
4. **CORS**: Configured during setup for the frontend origin
5. **Cookies**: Cross-subdomain cookies for seamless auth
6. **Database**: Use MongoDB Atlas for production (encrypted at rest, HA)

## Troubleshooting

### API won't start

```bash
kubectl logs -n control-plane -l app=control-plane-api --tail=50
kubectl describe pod -n control-plane -l app=control-plane-api
```

### MongoDB connection issues

Check the secret:
```bash
kubectl get secret control-plane-secrets -n control-plane -o jsonpath='{.data.mongodb-uri}' | base64 -d
```

### SSL certificate issues

Check Caddy logs:
```bash
kubectl logs -n control-plane -l app=caddy --tail=50
```

### CORS errors in browser

Verify the API's `ALLOWED_ORIGINS` includes your frontend:
```bash
kubectl exec -n control-plane deployment/control-plane-api -- env | grep ALLOWED_ORIGINS
```

### Reset installation

```bash
kubectl delete namespace control-plane
rm -rf /data/control-plane
# Re-run installer
```
