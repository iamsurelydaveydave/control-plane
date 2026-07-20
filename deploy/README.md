# Control Plane Deployment

This directory contains everything needed to deploy Control Plane as a self-hosted infrastructure management platform.

## Quick Start

### One-liner Installation

```bash
curl -fsSL https://get.controlplane.dev/install.sh | bash
```

Or with options:

```bash
curl -fsSL https://get.controlplane.dev/install.sh | bash -s -- \
  --mongodb-uri "mongodb+srv://..." \
  --domain "cp.example.com"
```

### Environment Variables

You can set these before running the installer:

| Variable | Description | Required |
|----------|-------------|----------|
| `MONGODB_URI` | MongoDB Atlas connection string | For production |
| `REDIS_URL` | Redis connection string | Yes |
| `DOMAIN` | Domain for HTTPS access | Optional |
| `ROOT_USERNAME` | Initial admin username | Optional |
| `ROOT_USER_EMAIL` | Initial admin email | Optional |
| `ROOT_USER_PASSWORD` | Initial admin password | Optional |
| `VERSION` | Specific version to install | Default: `latest` |
| `REGISTRY_URL` | Custom Docker registry | Default: `ghcr.io` |
| `AUTOUPDATE` | Enable auto-updates | Default: `true` |
| `ENABLE_K8S` | Enable K3s for database provisioning | Default: `false` |

## What Gets Installed

```
/data/control-plane/
├── source/                  # Docker Compose files, .env
│   ├── docker-compose.yml
│   ├── docker-compose.dev.yml (if local MongoDB)
│   ├── Caddyfile
│   ├── .env
│   └── upgrade.sh
├── ssh/                     # SSH keys for server management
│   ├── keys/
│   └── mux/
├── logs/                    # Application logs
├── backups/                 # Backup storage
└── ansible/                 # Ansible playbooks (for database provisioning)
```

## Architecture

```
                                    ┌─────────────────────────────────────┐
                                    │            Internet                 │
                                    └─────────────────┬───────────────────┘
                                                      │
                                                      │ :80/:443
                                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Docker Host                                     │
│                                                                              │
│  ┌─────────────────────┐                                                    │
│  │   Caddy (Proxy)     │◀─── Automatic HTTPS (Let's Encrypt)                │
│  │   :80, :443         │                                                    │
│  └──────────┬──────────┘                                                    │
│             │                                                                │
│     ┌───────┴───────┐                                                       │
│     │               │                                                        │
│     ▼               ▼                                                        │
│  ┌──────────┐   ┌──────────┐                                                │
│  │   Web    │   │   API    │───────┐                                        │
│  │  (Nuxt)  │───│(Express) │       │                                        │
│  │  :3000   │   │  :5005   │       │                                        │
│  └──────────┘   └────┬─────┘       │                                        │
│                      │             │                                        │
│              ┌───────┴───────┐     │                                        │
│              │               │     │                                        │
│              ▼               ▼     ▼                                        │
│        ┌──────────┐   ┌────────────────┐                                    │
│        │  Redis   │   │    MongoDB     │                                    │
│        │  :6379   │   │ (Atlas or      │                                    │
│        └──────────┘   │  local:27017)  │                                    │
│                       └────────────────┘                                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Deployment Modes

### 1. Development / Testing (Local MongoDB)

```bash
curl -fsSL https://get.controlplane.dev/install.sh | bash
```

- Uses local MongoDB container
- No domain required (IP access)
- **Not for production** - data on single server

### 2. Production (MongoDB Atlas)

```bash
MONGODB_URI="mongodb+srv://..." \
DOMAIN="cp.example.com" \
curl -fsSL https://get.controlplane.dev/install.sh | bash
```

- Uses MongoDB Atlas for state
- Automatic HTTPS via Caddy/Let's Encrypt
- High availability

### 3. High Availability (Multiple Nodes)

Deploy the same configuration to multiple servers, all pointing to the same Atlas cluster:

```bash
MONGODB_URI="mongodb+srv://..." \
DOMAIN="cp.example.com" \
curl -fsSL https://get.controlplane.dev/install.sh | bash
```

Use a load balancer in front of the nodes.

### 4. With Kubernetes Database Provisioning

Enable K3s for automated database management with Percona Operator:

```bash
MONGODB_URI="mongodb+srv://..." \
DOMAIN="cp.example.com" \
ENABLE_K8S=true \
curl -fsSL https://get.controlplane.dev/install.sh | bash
```

- Installs K3s (lightweight Kubernetes) on the control plane
- Installs Percona MongoDB Operator for automated database provisioning
- Database servers automatically join as K3s agents
- Enables self-healing, automatic TLS, and backup features

## Files

| File | Description |
|------|-------------|
| `install.sh` | Main installer script (curl-able) |
| `upgrade.sh` | Upgrade script (called by auto-update) |
| `docker-compose.yml` | Production compose file |
| `docker-compose.dev.yml` | Development overlay (local MongoDB) |
| `Caddyfile` | Caddy reverse proxy config |
| `.env.template` | Environment variable template |
| `versions.json` | Version information for auto-updates |
| `Dockerfile.api` | API Docker image |
| `Dockerfile.web` | Web Docker image |

## Manual Operations

### Check Status

```bash
cd /data/control-plane/source
docker compose ps
```

### View Logs

```bash
docker logs -f control-plane-api
docker logs -f control-plane-web
```

### Restart Services

```bash
cd /data/control-plane/source
docker compose restart
```

### Upgrade

Run the install script again - it automatically detects an existing installation and upgrades:

```bash
curl -fsSL https://get.controlplane.dev/install.sh | bash
```

Or run the upgrade script directly:

```bash
/data/control-plane/source/upgrade.sh [version]
```

### Backup

The `.env` file contains all secrets. Back it up securely:

```bash
cp /data/control-plane/source/.env ~/control-plane-env-backup
```

## CDN Setup

To self-host the installer, you need a CDN serving these files:

```
https://cdn.controlplane.dev/
├── install.sh
├── upgrade.sh
├── docker-compose.yml
├── docker-compose.dev.yml
├── docker-compose.prod.yml
├── Caddyfile
├── .env.template
└── versions.json
```

And a redirect from `https://get.controlplane.dev/install.sh` to the CDN.

## Docker Images

Images are built and pushed to GitHub Container Registry:

```
ghcr.io/iamsurelydaveydave/control-plane-api:latest
ghcr.io/iamsurelydaveydave/control-plane-web:latest
```

## Security Considerations

1. **Secrets**: All secrets are auto-generated and stored in `.env`
2. **SSH Keys**: Used for server management, stored in `/data/control-plane/ssh/keys/`
3. **HTTPS**: Automatic via Caddy when domain is set
4. **Database**: Use MongoDB Atlas for production (encrypted at rest, HA)
5. **Updates**: Auto-update enabled by default (disable with `AUTOUPDATE=false`)

## Troubleshooting

### Services won't start

```bash
docker logs control-plane-api
docker logs control-plane-web
```

### MongoDB connection issues

Check `MONGODB_URI` in `.env`:
```bash
cat /data/control-plane/source/.env | grep MONGODB
```

### Port conflicts

Check what's using ports 80, 443, 3000, 5005:
```bash
netstat -tlnp | grep -E ':80|:443|:3000|:5005'
```

### Reset installation

```bash
cd /data/control-plane/source
docker compose down -v
rm -rf /data/control-plane
# Re-run installer
```
