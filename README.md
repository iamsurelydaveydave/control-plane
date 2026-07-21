# Control Plane

A self-hosted platform for managing MongoDB databases and containerized applications on Kubernetes (K3s).

## Features

- 🗄️ **MongoDB Provisioning** — Full replica sets via Percona Operator with TLS, backups, and proper auth
- 🚀 **App Deployment** — Docker containers with scaling, zero-downtime deploys, and self-healing
- 🔐 **TLS Certificate Management** — Automatic HTTPS via Caddy/Let's Encrypt
- 💾 **Automated Backups** — Scheduled backups to S3-compatible storage
- 📊 **Monitoring Dashboard** — System, cluster, and application metrics
- 🔔 **Alerting System** — Health checks with automatic recovery
- 📝 **Centralized Logs** — Deployment logs and audit trail

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Control Plane                                     │
│                                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │       UI        │  │       API       │  │   Background    │             │
│  │     (Nuxt)      │──│    (Express)    │──│    Workers      │             │
│  │                 │  │                 │  │                 │             │
│  │  • Dashboard    │  │  • REST API     │  │  • Health Check │             │
│  │  • Apps         │  │  • Auth (JWT)   │  │  • Reconciler   │             │
│  │  • Databases    │  │  • Audit Log    │  │  • Self-Healing │             │
│  │  • Servers      │  │                 │  │                 │             │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘             │
│                                │                                            │
│                    ┌───────────┴───────────┐                               │
│                    │      Executors        │                               │
│                    ├───────────────────────┤                               │
│                    │  Apps: Docker/Kamal   │                               │
│                    │  DBs:  Percona/K8s    │                               │
│                    └───────────┬───────────┘                               │
│                                │                                            │
│                     MongoDB Atlas (state)                                   │
└────────────────────────────────┼────────────────────────────────────────────┘
                                 │
                                 │ K8s API / SSH
                                 │
          ┌──────────────────────┼──────────────────────┐
          ▼                      ▼                      ▼
    ┌──────────┐          ┌──────────┐          ┌──────────┐
    │  Node 1  │          │  Node 2  │          │  Node 3  │
    │          │          │          │          │          │
    │  App A   │          │  App A   │          │ MongoDB  │
    │  App B   │          │  App B   │          │ Primary  │
    │  Redis   │          │          │          │          │
    └──────────┘          └──────────┘          └──────────┘
```

## Tech Stack

| Component | Technology |
|-----------|------------|
| **Backend** | Express + MongoDB + TypeScript |
| **Frontend** | Nuxt 4 + @nuxt/ui + Tailwind CSS |
| **Orchestration** | K3s (lightweight Kubernetes) |
| **Database Operator** | Percona MongoDB Operator |
| **Reverse Proxy** | Caddy (automatic HTTPS) |
| **State Storage** | MongoDB Atlas |

## Quick Start

### One-Liner Installation

```bash
curl -fsSL https://get.controlplane.dev/install.sh | bash
```

### Production with MongoDB Atlas

```bash
MONGODB_URI="mongodb+srv://..." \
DOMAIN="cp.example.com" \
curl -fsSL https://get.controlplane.dev/install.sh | bash
```

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `MONGODB_URI` | MongoDB Atlas connection string | Production |
| `DOMAIN` | Domain for HTTPS access | Recommended |
| `ACME_EMAIL` | Email for Let's Encrypt certificates | If using domain |
| `ROOT_USER_EMAIL` | Initial admin email | Auto-prompted |
| `ROOT_USER_PASSWORD` | Initial admin password | Auto-prompted |
| `ENABLE_K8S` | Enable K3s for database provisioning | Default: `true` |

## Project Structure

```
control-plane/
├── control-plane-api/     # Express + MongoDB backend
├── control-plane-web/     # Nuxt 4 + @nuxt/ui frontend
├── deploy/                # Docker, install scripts, Caddyfile
├── docs/                  # Extended documentation
└── .agents/skills/        # AI agent operational patterns
```

## Documentation

- [**API Documentation**](./control-plane-api/README.md) — Backend setup, endpoints, authentication
- [**Frontend Documentation**](./control-plane-web/README.md) — Web UI setup, components, composables
- [**Architecture**](./docs/ARCHITECTURE.md) — System design and data flow
- [**API Reference**](./docs/API.md) — Full endpoint reference
- [**Deployment Guide**](./docs/DEPLOYMENT.md) — Production deployment
- [**Development Guide**](./docs/DEVELOPMENT.md) — Local development setup

## What It Does

### Apps (Stateless)
- Deploy Docker containers to K8s cluster
- Scale to N replicas across nodes
- Zero-downtime deploys with rollback
- Environment variable and secret management
- Self-healing (health checks + automatic restart)

### Databases (Stateful)
- **MongoDB** — Full 3-node replica set via Percona Operator
- Automated TLS encryption
- Scheduled backups to S3
- Connection string management

### Clusters & Nodes
- K3s cluster management
- Worker node provisioning via SSH
- Node cordoning, draining, and removal
- Resource monitoring

## License

MIT
