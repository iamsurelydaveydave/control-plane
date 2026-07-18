# Control Plane — Overview

A self-hosted infrastructure management platform. Deploy apps, provision databases, and manage servers from a single dashboard. Like Coolify, but with **scaling as a first-class feature**.

## Why Build This?

| Problem with Coolify | Our Solution |
|---------------------|--------------|
| Single-server mindset, multi-node feels bolted on | Multi-server, multi-instance from day one |
| No real scaling — just "deploy to these servers" | Replicas per app, automatic distribution |
| Database provisioning is fragile | Production-grade MongoDB replica sets, Redis, PostgreSQL |
| No self-healing | Health checks + automatic recovery |
| Hard to deploy for multiple clients | One Docker image, one curl command, works anywhere |

## What It Does

### Apps (Stateless)
- Deploy Docker containers to your servers
- Scale to N replicas across M servers
- Zero-downtime deploys
- Environment variable management
- Automatic restart on failure
- Self-healing (detect unhealthy → restart → reboot VPS if needed)

### Databases (Stateful)
- **MongoDB**: Full 3-node replica set with TLS, backups, and proper auth
- **Redis**: Single instance or Sentinel HA
- **PostgreSQL**: Primary with optional replicas
- **MySQL**: Single instance

> **Note**: These are databases provisioned for your apps to use (e.g., GoWeekdays API connects to a self-hosted MongoDB). The control plane itself uses MongoDB Atlas for its own state — you don't manage that.

All databases include:
- Automated provisioning via Ansible
- TLS encryption (Let's Encrypt)
- Scheduled backups to S3
- Firewall configuration
- User/role management

### Servers
- Add servers via SSH (just need the IP and SSH access)
- Health monitoring
- Resource tracking
- Automatic recovery (reboot via cloud API)

### Self-Healing
- Continuous health checks for all apps and databases
- Container crashed → restart automatically
- Container unhealthy → restart, then escalate
- VPS unreachable → reboot via cloud provider API
- VPS dead → alert (optionally provision replacement)

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
│                    │  DBs:  Ansible        │                               │
│                    └───────────┬───────────┘                               │
│                                │                                            │
│                          MongoDB                                            │
│                     (state storage)                                         │
└────────────────────────────────┼────────────────────────────────────────────┘
                                 │
                                 │ SSH
                                 │
          ┌──────────────────────┼──────────────────────┐
          ▼                      ▼                      ▼
    ┌──────────┐          ┌──────────┐          ┌──────────┐
    │ Server 1 │          │ Server 2 │          │ Server 3 │
    │          │          │          │          │          │
    │  App A   │          │  App A   │          │ MongoDB  │
    │  App B   │          │  App B   │          │ Primary  │
    │  Redis   │          │          │          │          │
    └──────────┘          └──────────┘          └──────────┘
```

## Deployment Modes

### Single Node (Development/Testing)
- One control plane instance
- Local MongoDB container for state (not Atlas)
- Good for: testing, development, trying it out
- **Not recommended for production** — if the server dies, you lose state

```bash
curl -fsSL https://get.controlplane.dev/install.sh | bash
```

### Production (Recommended)
- 1-3 control plane instances
- MongoDB Atlas for state (managed, HA)
- Good for: production, any real deployment

```bash
# Single production node with Atlas
MONGODB_URI="mongodb+srv://..." \
DOMAIN="cp.example.com" \
curl -fsSL https://get.controlplane.dev/install.sh | bash

# Or 3 nodes for HA (same command on each server, behind load balancer)
MONGODB_URI="mongodb+srv://..." \
DOMAIN="cp.example.com" \
curl -fsSL https://get.controlplane.dev/install.sh | bash
```

## Tech Stack

| Component | Technology | Why |
|-----------|------------|-----|
| API | Express + TypeScript | Already have patterns from api-core |
| UI | Nuxt 3 | Already know it, full-stack capable |
| Control Plane State | MongoDB Atlas | Managed, HA, zero maintenance |
| App Deployment | Docker over SSH | Simple, reliable, consistent |
| Database Provisioning | Ansible + Docker | Orchestration + consistency |
| Background Jobs | Custom worker loop | Simple, no extra deps |

### Database Provisioning: Ansible + Docker

Databases (MongoDB, Redis, PostgreSQL) run as **Docker containers** but are orchestrated by **Ansible**:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   Ansible handles:                  Docker provides:                        │
│   ────────────────                  ─────────────────                       │
│   • Block volume setup             • Consistent MongoDB image                │
│   • Filesystem formatting          • Same version everywhere                 │
│   • Volume mounting                • No apt/yum package issues               │
│   • Deploy containers              • Easy upgrades (change tag)              │
│   • Replica set init               • Built-in restart on crash               │
│   • User creation                  • Isolated environment                    │
│   • TLS certificates                                                        │
│   • Backup scheduling                                                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Why not just Docker/Kamal?**
- MongoDB replica set needs coordination (init on one node, after all running)
- Block storage requires OS-level setup before Docker can use it
- TLS certificates need renewal hooks
- Ansible handles all this orchestration

**Why not just Ansible with apt packages?**
- Different Ubuntu/Debian versions have different packages
- MongoDB apt repo setup is complex
- Package version pinning is fragile
- Docker image = guaranteed consistency

### Important: Two Different MongoDBs

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   MongoDB Atlas (Managed)              Self-Hosted MongoDB (Provisioned)   │
│   ════════════════════════             ════════════════════════════════    │
│                                                                             │
│   Control Plane's own state:           For your apps to use:               │
│   • Users, sessions                    • Your API's data                   │
│   • Server inventory                   • Your app's collections            │
│   • App configurations                 • Full replica set (3 nodes)        │
│   • Deployment history                 • TLS, backups, proper auth         │
│   • Audit logs                                                             │
│                                                                             │
│   You don't manage this.               Control plane provisions this       │
│   Atlas handles it.                    via Ansible + Docker containers.    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Why Atlas for Control Plane?**
- Zero ops — no database to manage for the management tool itself
- Always available — control plane can't provision if its own DB is down
- HA built-in — works across multiple control plane instances

**Why Self-Hosted (Docker) for Apps?**
- Cost — Atlas gets expensive at scale
- Control — your data on your servers
- Performance — lower latency, same region as app
- Consistency — Docker image = same MongoDB everywhere

## Key Design Decisions

### 1. Docker Image + One-Liner Install
Like Coolify: `curl | bash` and you're running. No manual setup, no config files to create.

### 2. Ansible for Databases, Docker for Apps
- **Databases are complex** — replica set init, TLS, backups, firewall rules. Ansible handles this well.
- **Apps are simple** — just pull image and run. Docker commands over SSH are enough.

### 3. MongoDB for Control Plane State
- Already using MongoDB, know it well
- Supports HA (replica set or Atlas)
- Good for document-based config storage

### 4. Self-Healing is Built-In, Not Bolted On
Health checking and recovery are core features, not afterthoughts.

### 5. Multi-Tenant by Design
Same control plane image works for any client. Configure via environment variables.

## Target Users

1. **Ourselves (GoWeekdays)** — Deploy our own infrastructure
2. **Client Projects** — Deploy control plane on their VPS, manage their apps
3. **Potentially: SaaS** — Managed control plane service (future)

## Non-Goals (For Now)

- Git integration / build from source (just deploy Docker images)
- Kubernetes support (we're the alternative to K8s complexity)
- Auto-scaling based on metrics (manual scaling via UI first)
- Multi-cloud orchestration (one control plane per environment)

## Success Criteria

1. **Install in < 5 minutes** — One curl command, works on fresh VPS
2. **Deploy app in < 2 minutes** — Add server, create app, running
3. **MongoDB replica set in < 10 minutes** — Full HA database, TLS, backups
4. **Self-healing works** — Kill a container, it comes back automatically
5. **Works for clients** — Same image, different config, no code changes
