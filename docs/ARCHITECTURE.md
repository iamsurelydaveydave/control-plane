# Architecture

Control Plane is a self-hosted infrastructure management platform built with a modern, layered architecture.

## High-Level Overview

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                    INTERNET                                          │
└───────────────────────────────────────┬─────────────────────────────────────────────┘
                                        │
                                        │ HTTPS (:443)
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              DOCKER HOST                                             │
│                                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────────┐   │
│  │                     CADDY (Reverse Proxy)                                    │   │
│  │                                                                              │   │
│  │  • Automatic HTTPS via Let's Encrypt                                        │   │
│  │  • Routes / → Web (:3000)                                                   │   │
│  │  • Routes /api/* → API (:3001)                                              │   │
│  └──────────────────────┬─────────────────────┬─────────────────────────────────┘   │
│                         │                     │                                      │
│                         ▼                     ▼                                      │
│  ┌─────────────────────────────┐   ┌─────────────────────────────────────────┐     │
│  │     CONTROL PLANE WEB       │   │          CONTROL PLANE API              │     │
│  │                             │   │                                         │     │
│  │  Nuxt 4 + @nuxt/ui          │   │  Express + TypeScript                   │     │
│  │  SSR on port 3000           │   │  REST API on port 3001                  │     │
│  │                             │   │                                         │     │
│  │  • Dashboard                │   │  • Authentication (JWT/Session/Token)  │     │
│  │  • App Management           │   │  • App Management                       │     │
│  │  • Database Management      │   │  • Database Provisioning               │     │
│  │  • Node Management          │   │  • K8s Integration                     │     │
│  │  • Settings                 │   │  • Background Workers                  │     │
│  └─────────────────────────────┘   └─────────────────┬───────────────────────┘     │
│                                                       │                              │
│                                    ┌──────────────────┼──────────────────┐          │
│                                    │                  │                  │          │
│                                    ▼                  ▼                  ▼          │
│                           ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   │
│                           │    REDIS     │   │   MONGODB    │   │     K3S      │   │
│                           │              │   │   (Atlas)    │   │              │   │
│                           │  • Sessions  │   │  • State     │   │  • Workloads │   │
│                           │  • Cache     │   │  • Audit     │   │  • Databases │   │
│                           └──────────────┘   └──────────────┘   └──────────────┘   │
│                                                                         │           │
└─────────────────────────────────────────────────────────────────────────┼───────────┘
                                                                          │
                                                                          │ K8s API
                                                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              K3S CLUSTER                                             │
│                                                                                      │
│  ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐                   │
│  │   CONTROL NODE  │   │   WORKER NODE   │   │   WORKER NODE   │                   │
│  │   (Master)      │   │                 │   │                 │                   │
│  │                 │   │   App Pods      │   │   MongoDB Pods  │                   │
│  │   API Server    │   │   via Percona   │   │   via Percona   │                   │
│  │   Scheduler     │   │   Operator      │   │   Operator      │                   │
│  └─────────────────┘   └─────────────────┘   └─────────────────┘                   │
│                                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────────┐   │
│  │                    PERCONA MONGODB OPERATOR                                  │   │
│  │                                                                              │   │
│  │  • Provisions MongoDB replica sets as Custom Resources                      │   │
│  │  • Manages TLS certificates, backups, scaling                               │   │
│  │  • Handles failover and recovery                                            │   │
│  └─────────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

## Component Details

### Frontend (control-plane-web)

**Stack:** Nuxt 4 + @nuxt/ui + Tailwind CSS + TypeScript

```
┌─────────────────────────────────────────────────────────────────┐
│                         NUXT APPLICATION                         │
│                                                                  │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌──────────┐  │
│  │   Pages    │  │ Components │  │Composables │  │  Plugins │  │
│  ├────────────┤  ├────────────┤  ├────────────┤  ├──────────┤  │
│  │ /login     │  │ AppForm    │  │ useApp     │  │ api.ts   │  │
│  │ /setup     │  │ AppShell   │  │ useAuth    │  │ secure   │  │
│  │ /dashboard │  │ NodeForm   │  │ useNode    │  │          │  │
│  │ /apps      │  │ DBForm     │  │ useDB      │  │          │  │
│  │ /databases │  │ Confirm    │  │ useCluster │  │          │  │
│  │ /nodes     │  │ ...        │  │ ...        │  │          │  │
│  └────────────┘  └────────────┘  └────────────┘  └──────────┘  │
│                                                                  │
│                              │                                   │
│                              ▼                                   │
│                    ┌──────────────────┐                         │
│                    │   $api Plugin    │                         │
│                    │                  │                         │
│                    │ Typed $fetch     │                         │
│                    │ to /api/*        │                         │
│                    └──────────────────┘                         │
└─────────────────────────────────────────────────────────────────┘
```

### Backend (control-plane-api)

**Stack:** Express + MongoDB + Redis + TypeScript

```
┌─────────────────────────────────────────────────────────────────┐
│                       EXPRESS APPLICATION                        │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                         ROUTES                              │ │
│  │  /health  /auth  /apps  /databases  /clusters  /nodes ...  │ │
│  └─────────────────────────────┬──────────────────────────────┘ │
│                                │                                 │
│                                ▼                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                      MIDDLEWARE                             │ │
│  │  requireAuth  requireScope  sanitizeMongo  errorHandler     │ │
│  └─────────────────────────────┬──────────────────────────────┘ │
│                                │                                 │
│                                ▼                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                     RESOURCE LAYER                        │   │
│  │                                                           │   │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐          │   │
│  │  │ Controller │  │  Service   │  │ Repository │          │   │
│  │  │            │  │            │  │            │          │   │
│  │  │ HTTP       │──│ Business   │──│ Database   │          │   │
│  │  │ Handling   │  │ Logic      │  │ Access     │          │   │
│  │  └────────────┘  └────────────┘  └────────────┘          │   │
│  │                                                           │   │
│  │  ┌────────────┐                                          │   │
│  │  │   Model    │                                          │   │
│  │  │            │                                          │   │
│  │  │ Types +    │                                          │   │
│  │  │ Validation │                                          │   │
│  │  └────────────┘                                          │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                       SERVICES                              │ │
│  │  K8sService  PerconaService  DNSService  MetricsService    │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│                    │                    │                        │
│                    ▼                    ▼                        │
│             ┌────────────┐       ┌────────────┐                 │
│             │  MongoDB   │       │   Redis    │                 │
│             │  (Atlas)   │       │   Cache    │                 │
│             └────────────┘       └────────────┘                 │
└─────────────────────────────────────────────────────────────────┘
```

### Resource Layer Pattern

Each resource follows a strict 4-layer architecture:

```
┌─────────────────────────────────────────────────────────────────┐
│                        HTTP REQUEST                              │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  CONTROLLER                                                      │
│  • Validates request (Joi schemas)                              │
│  • Extracts params, query, body                                 │
│  • Delegates to service or repository                           │
│  • Calls next(error) on failure                                 │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  SERVICE (optional)                                              │
│  • Business logic                                               │
│  • Coordinates multiple repositories                            │
│  • Manages transactions                                         │
│  • Integrates external services (K8s, DNS, etc.)               │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  REPOSITORY                                                      │
│  • Database access ONLY                                         │
│  • CRUD operations                                              │
│  • Index management (createIndexes)                             │
│  • Cache read/write/invalidate                                  │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  MODEL                                                           │
│  • TypeScript types                                             │
│  • Joi validation schemas                                       │
│  • model<Resource>() factory                                    │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

### Authentication Flow

```
┌──────────┐     ┌────────────┐     ┌────────────┐     ┌──────────┐
│  Client  │     │   Caddy    │     │    API     │     │  Redis   │
└────┬─────┘     └─────┬──────┘     └─────┬──────┘     └────┬─────┘
     │                 │                   │                 │
     │  POST /api/auth/login              │                 │
     │ ───────────────────────────────────>                 │
     │                 │                   │                 │
     │                 │                   │  Verify creds   │
     │                 │                   │ ───────────────>│
     │                 │                   │                 │
     │                 │                   │  Create session │
     │                 │                   │ ───────────────>│
     │                 │                   │                 │
     │                 │  Set-Cookie: sid  │                 │
     │ <───────────────────────────────────                 │
     │                 │                   │                 │
     │  GET /api/apps (Cookie: sid)       │                 │
     │ ───────────────────────────────────>                 │
     │                 │                   │                 │
     │                 │                   │  Validate sid   │
     │                 │                   │ ───────────────>│
     │                 │                   │                 │
```

### Database Provisioning Flow

```
┌──────────┐     ┌────────────┐     ┌────────────┐     ┌──────────┐
│  Client  │     │    API     │     │ K8sService │     │ Percona  │
└────┬─────┘     └─────┬──────┘     └─────┬──────┘     └────┬─────┘
     │                 │                   │                 │
     │  POST /api/databases               │                 │
     │  { name, replicas, ... }           │                 │
     │ ───────────────────────────────────>                 │
     │                 │                   │                 │
     │                 │  Create PSMDB CR  │                 │
     │                 │ ─────────────────>│                 │
     │                 │                   │                 │
     │                 │                   │  Apply CR       │
     │                 │                   │ ───────────────>│
     │                 │                   │                 │
     │                 │                   │  Operator       │
     │                 │                   │  provisions     │
     │                 │                   │  replica set    │
     │                 │                   │ <───────────────│
     │                 │                   │                 │
     │  201 Created    │                   │                 │
     │  { id, status: 'provisioning' }    │                 │
     │ <───────────────────────────────────                 │
```

### App Deployment Flow

```
┌──────────┐     ┌────────────┐     ┌────────────┐     ┌──────────┐
│  Client  │     │    API     │     │ K8sService │     │   K3s    │
└────┬─────┘     └─────┬──────┘     └─────┬──────┘     └────┬─────┘
     │                 │                   │                 │
     │  POST /api/apps/:id/deploy         │                 │
     │ ───────────────────────────────────>                 │
     │                 │                   │                 │
     │                 │  Create/Update    │                 │
     │                 │  Deployment       │                 │
     │                 │ ─────────────────>│                 │
     │                 │                   │                 │
     │                 │                   │  Apply manifest │
     │                 │                   │ ───────────────>│
     │                 │                   │                 │
     │                 │  Create Service   │                 │
     │                 │ ─────────────────>│                 │
     │                 │                   │  Apply manifest │
     │                 │                   │ ───────────────>│
     │                 │                   │                 │
     │                 │  Create Ingress   │                 │
     │                 │ ─────────────────>│                 │
     │                 │                   │  Apply manifest │
     │                 │                   │ ───────────────>│
     │                 │                   │                 │
     │  SSE: deploy progress              │                 │
     │ <───────────────────────────────────                 │
```

## Data Model

### Collections

```
┌─────────────────────────────────────────────────────────────────┐
│                        MONGODB ATLAS                             │
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │  cp_users   │  │  cp_apps    │  │cp_databases │             │
│  │             │  │             │  │             │             │
│  │  _id        │  │  _id        │  │  _id        │             │
│  │  email      │  │  name       │  │  name       │             │
│  │  password   │  │  image      │  │  engine     │             │
│  │  createdAt  │  │  replicas   │  │  replicas   │             │
│  └─────────────┘  │  envVars    │  │  status     │             │
│                   │  status     │  │  credentials│             │
│  ┌─────────────┐  └─────────────┘  └─────────────┘             │
│  │ cp_clusters │                                                │
│  │             │  ┌─────────────┐  ┌─────────────┐             │
│  │  _id        │  │  cp_nodes   │  │cp_deployments             │
│  │  name       │  │             │  │             │             │
│  │  apiServer  │  │  _id        │  │  _id        │             │
│  │  joinToken  │  │  name       │  │  appId      │             │
│  └─────────────┘  │  clusterId  │  │  version    │             │
│                   │  status     │  │  status     │             │
│  ┌─────────────┐  └─────────────┘  │  logs       │             │
│  │cp_settings  │                   └─────────────┘             │
│  │             │  ┌─────────────┐                               │
│  │  _id (key)  │  │cp_audit_logs│  ┌─────────────┐             │
│  │  value      │  │             │  │cp_api_tokens│             │
│  │  updatedAt  │  │  _id        │  │             │             │
│  └─────────────┘  │  userId     │  │  _id        │             │
│                   │  action     │  │  name       │             │
│  ┌─────────────┐  │  resource   │  │  tokenHash  │             │
│  │ cp_ssh_keys │  │  timestamp  │  │  scopes     │             │
│  │             │  └─────────────┘  └─────────────┘             │
│  │  _id        │                                                │
│  │  name       │  ┌─────────────┐                               │
│  │  publicKey  │  │ cp_secrets  │                               │
│  │  fingerprint│  │             │                               │
│  └─────────────┘  │  _id        │                               │
│                   │  key        │                               │
│                   │  value (enc)│                               │
│                   └─────────────┘                               │
└─────────────────────────────────────────────────────────────────┘
```

## Security

### Authentication Layers

1. **Session Cookie** — Primary for web UI
   - HttpOnly, Secure, SameSite
   - Stored in Redis with TTL
   - Rolling refresh

2. **JWT Bearer** — Short-lived API access
   - Access token: 15m
   - Refresh token: 30d

3. **API Token** — Long-lived CI/CD access
   - Prefix: `cp_`
   - Stored as SHA256 hash
   - Scope-based permissions

### Authorization Scopes

```
┌─────────────────────────────────────────────────────────────────┐
│                      API TOKEN SCOPES                            │
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   apps:read     │  │ databases:read  │  │ deployments:read│ │
│  │   apps:write    │  │ databases:write │  │deployments:write│ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐                       │
│  │ settings:read   │  │       *         │                       │
│  │ settings:write  │  │  (full access)  │                       │
│  └─────────────────┘  └─────────────────┘                       │
└─────────────────────────────────────────────────────────────────┘
```

## Deployment Topology

### Single Node (Development)

```
┌─────────────────────────────────────────────────────────────────┐
│                         SINGLE VPS                               │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Docker Compose                        │   │
│  │                                                          │   │
│  │  Caddy ─── Web ─── API ─── Redis                        │   │
│  │                      │                                   │   │
│  │                      └─── MongoDB (container)           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                      K3s Cluster                         │   │
│  │                                                          │   │
│  │  [control-plane] ─── [Percona Operator] ─── [DBs]       │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Production (Multi-Node)

```
┌─────────────────────────────────────────────────────────────────┐
│                      LOAD BALANCER                               │
└───────────────────────────────┬─────────────────────────────────┘
                                │
          ┌─────────────────────┼─────────────────────┐
          ▼                     ▼                     ▼
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│  Control Plane  │   │  Control Plane  │   │  Control Plane  │
│     Node 1      │   │     Node 2      │   │     Node 3      │
│                 │   │                 │   │                 │
│  Caddy+Web+API  │   │  Caddy+Web+API  │   │  Caddy+Web+API  │
└────────┬────────┘   └────────┬────────┘   └────────┬────────┘
         │                     │                     │
         └─────────────────────┼─────────────────────┘
                               │
                               ▼
                  ┌─────────────────────────┐
                  │     MongoDB Atlas       │
                  │     (Shared State)      │
                  └─────────────────────────┘
                               │
                               ▼
                  ┌─────────────────────────┐
                  │      K3s Cluster        │
                  │                         │
                  │  Worker ── Worker ──    │
                  │    │         │          │
                  │   Apps    Databases     │
                  └─────────────────────────┘
```
