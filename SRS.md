# Control Plane — Software Requirements Specification

## 1. Introduction

### 1.1 Purpose
This document specifies the requirements for the Control Plane, a self-hosted infrastructure management platform for deploying applications, provisioning databases, and managing servers.

### 1.2 Scope
The Control Plane will:
- Manage deployment of Docker-based applications across multiple servers
- Provision and manage databases (MongoDB replica sets, Redis, PostgreSQL, MySQL)
- Monitor health and automatically recover from failures
- Provide a web UI for all management operations
- Support both single-node and high-availability deployments

### 1.3 Definitions

| Term | Definition |
|------|------------|
| **App** | A stateless Docker container deployed to one or more servers |
| **Instance** | A single running container of an app on a specific server |
| **Replica** | The desired number of instances for an app |
| **Server/Node** | A VPS or bare-metal machine managed by the control plane |
| **Database Cluster** | A self-hosted database provisioned for apps to use |
| **Health Check** | Periodic verification that an app/database is responding |
| **Self-Healing** | Automatic recovery from detected failures |
| **Control Plane State** | The control plane's own data (stored in MongoDB Atlas) |
| **Provisioned Database** | A database the control plane creates for your apps (self-hosted) |

### 1.4 Key Architecture Distinction

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           TWO MONGODB CONTEXTS                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   1. MONGODB ATLAS (Control Plane State)                                    │
│      ════════════════════════════════════                                   │
│      • Stores: users, servers, apps, configs, audit logs                    │
│      • Managed by: Atlas (not you)                                          │
│      • Why: Zero-ops, always available, HA built-in                         │
│      • Connection: MP_MONGODB_URI environment variable                      │
│                                                                             │
│   2. SELF-HOSTED MONGODB (Provisioned for Apps)                             │
│      ═══════════════════════════════════════════                            │
│      • Stores: your app's data (e.g., GoWeekdays API data)                  │
│      • Managed by: Control Plane (via Ansible)                              │
│      • Why: Cost savings, data control, lower latency                       │
│      • Runs on: Your servers as 3-node replica set                          │
│      • Features: TLS, auth, backups, self-healing                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

The control plane **uses** Atlas but **provisions** self-hosted databases.

---

## 2. System Overview

### 2.1 System Context

```
┌─────────────────────────────────────────────────────────────┐
│                        Users                                │
│   (Developers, DevOps, Admins)                              │
└─────────────────────────────────┬───────────────────────────┘
                                  │ HTTPS
                                  ▼
┌─────────────────────────────────────────────────────────────┐
│                    Control Plane                            │
│  ┌─────────┐  ┌─────────┐  ┌─────────────────────────────┐ │
│  │   UI    │  │   API   │  │     Background Services     │ │
│  └─────────┘  └─────────┘  └─────────────────────────────┘ │
└───────────────────────────────┬─────────────────────────────┘
                                │ SSH
                                ▼
┌─────────────────────────────────────────────────────────────┐
│                    Managed Servers                          │
│   ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐       │
│   │ Server1 │  │ Server2 │  │ Server3 │  │ ServerN │       │
│   └─────────┘  └─────────┘  └─────────┘  └─────────┘       │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 System Components

| Component | Responsibility |
|-----------|----------------|
| **UI (Nuxt)** | Web dashboard for all user interactions |
| **API (Express)** | REST API, authentication, business logic |
| **State Store (MongoDB Atlas)** | Control plane's own state (managed, zero-ops) |
| **App Deployer** | Deploy/scale/restart Docker containers via SSH |
| **Database Provisioner** | Provision self-hosted databases via Ansible + Docker |
| **Health Checker** | Monitor apps and databases, trigger recovery |
| **Reconciler** | Ensure actual state matches desired state |

#### Important: Two MongoDB Contexts

1. **MongoDB Atlas** — Stores control plane state (users, servers, apps, configs). Managed by Atlas, not by you.

2. **Self-Hosted MongoDB** — Provisioned by the control plane for your apps to use. Runs as Docker containers on your servers, orchestrated by Ansible.

### 2.3 Database Provisioning Flow

```
User clicks "Create MongoDB Cluster"
            │
            ▼
┌───────────────────────────────────────────────────────────┐
│  Control Plane API                                        │
│  1. Validate request                                      │
│  2. Generate credentials (admin password, keyfile)        │
│  3. Store cluster config in Atlas                         │
│  4. Build Ansible inventory                               │
│  5. Execute Ansible playbook                              │
└───────────────────────────┬───────────────────────────────┘
                            │
                            ▼
┌───────────────────────────────────────────────────────────┐
│  Ansible Playbook (provision-database.yml)                │
│                                                           │
│  For each node:                                           │
│    1. Setup block storage (if configured)                 │
│    2. Install Docker (if not present)                     │
│    3. Deploy MongoDB container                            │
│    4. Wait for container ready                            │
│                                                           │
│  On primary node:                                         │
│    5. Initialize replica set (rs.initiate)                │
│    6. Wait for primary election                           │
│    7. Create admin user                                   │
│    8. Create app users (if specified)                     │
│    9. Configure backups (if enabled)                      │
└───────────────────────────┬───────────────────────────────┘
                            │
                            ▼
┌───────────┐  ┌───────────┐  ┌───────────┐
│  Server 1 │  │  Server 2 │  │  Server 3 │
│           │  │           │  │           │
│  Docker   │  │  Docker   │  │  Docker   │
│  MongoDB  │◄──│  MongoDB  │──►│  MongoDB  │
│  (Primary)│  │(Secondary)│  │(Secondary)│
│           │  │           │  │           │
│  /data    │  │  /data    │  │  /data    │
│  (volume) │  │  (volume) │  │  (volume) │
└───────────┘  └───────────┘  └───────────┘
         \____________|____________/
                      │
              Replica Set: rs0
                      │
                      ▼
            Connection String:
            mongodb://admin:***@server1,server2,server3/?replicaSet=rs0
```

---

## 3. Functional Requirements

### 3.1 Authentication & Authorization

| ID | Requirement | Priority |
|----|-------------|----------|
| AUTH-01 | System shall support email/password authentication | Must |
| AUTH-02 | System shall use JWT tokens for API authentication | Must |
| AUTH-03 | System shall support multiple admin users | Should |
| AUTH-04 | System shall log all authentication attempts | Must |
| AUTH-05 | System shall enforce session expiry (configurable, default 7 days) | Must |

### 3.2 Setup & Initialization

| ID | Requirement | Priority |
|----|-------------|----------|
| SETUP-01 | System shall detect first-run and show setup wizard | Must |
| SETUP-02 | Setup shall create initial admin account | Must |
| SETUP-03 | Setup shall configure S3 backup credentials | Should |
| SETUP-04 | Setup shall be completable only once | Must |
| SETUP-05 | System shall generate SSH keypair on first install | Must |

### 3.3 Server Management

| ID | Requirement | Priority |
|----|-------------|----------|
| SRV-01 | User shall be able to add a server by IP address | Must |
| SRV-02 | System shall verify SSH connectivity when adding server | Must |
| SRV-03 | User shall be able to remove a server | Must |
| SRV-04 | System shall prevent removing servers with running apps | Should |
| SRV-05 | System shall display server health status | Must |
| SRV-06 | System shall display server resource usage (CPU, memory, disk) | Should |
| SRV-07 | User shall be able to configure server metadata (name, tags) | Should |
| SRV-08 | System shall support server labels for placement constraints | Could |

### 3.4 Application Management

| ID | Requirement | Priority |
|----|-------------|----------|
| APP-01 | User shall be able to create an app with name and Docker image | Must |
| APP-02 | User shall be able to set desired replica count (1-N) | Must |
| APP-03 | System shall distribute replicas across available servers | Must |
| APP-04 | User shall be able to scale app up or down via UI | Must |
| APP-05 | User shall be able to set environment variables per app | Must |
| APP-06 | User shall be able to restart all instances of an app | Must |
| APP-07 | User shall be able to delete an app | Must |
| APP-08 | System shall perform zero-downtime deploys when updating | Should |
| APP-09 | User shall be able to specify resource limits (memory, CPU) | Should |
| APP-10 | User shall be able to specify placement constraints | Could |
| APP-11 | System shall auto-generate subdomain for apps (if domain configured) | Should |
| APP-12 | User shall be able to specify custom domain for app | Should |
| APP-13 | System shall display app status (running, stopped, deploying) | Must |
| APP-14 | System shall display instance-level status | Must |
| APP-15 | User shall be able to view logs for an app | Should |

### 3.5 Database Provisioning

The control plane provisions **self-hosted databases** for your applications to use. These are separate from the control plane's own MongoDB Atlas instance.

**Implementation: Ansible + Docker**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Why Ansible + Docker?                                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Docker provides:                 Ansible provides:                         │
│  • Consistent MongoDB image       • Multi-node orchestration                │
│  • No OS package differences      • Block volume management                 │
│  • Easy version upgrades          • Replica set initialization              │
│  • Built-in restart policy        • User/role creation                      │
│                                   • TLS certificate setup                   │
│                                   • Backup configuration                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

| ID | Requirement | Priority |
|----|-------------|----------|
| DB-01 | User shall be able to provision a MongoDB replica set (3 nodes) | Must |
| DB-02 | User shall be able to provision a Redis instance | Must |
| DB-03 | User shall be able to provision a PostgreSQL database | Should |
| DB-04 | User shall be able to provision a MySQL database | Could |
| DB-05 | System shall configure TLS for databases (via Let's Encrypt) | Should |
| DB-06 | System shall configure authentication for databases | Must |
| DB-07 | System shall generate and store connection strings | Must |
| DB-08 | User shall be able to view connection string (reveal on demand) | Must |
| DB-09 | System shall display database cluster health | Must |
| DB-10 | User shall be able to trigger database backup (to S3) | Should |
| DB-11 | System shall support scheduled database backups | Should |
| DB-12 | User shall be able to reprovision a failed database | Should |
| DB-13 | User shall be able to delete a database cluster | Must |
| DB-14 | System shall warn before deleting database (data loss) | Must |
| DB-15 | Databases shall run as Docker containers (not apt packages) | Must |
| DB-16 | Provisioning shall use Ansible for orchestration | Must |
| DB-17 | System shall support block volume storage for databases | Must |
| DB-18 | Storage setup shall never destroy existing MongoDB data | Must |
| DB-19 | User shall be able to add database users via API | Must |
| DB-20 | User shall be able to create databases via API | Should |

### 3.6 Health Monitoring & Self-Healing

| ID | Requirement | Priority |
|----|-------------|----------|
| HEALTH-01 | System shall check app health every 30 seconds | Must |
| HEALTH-02 | System shall check database health every 60 seconds | Must |
| HEALTH-03 | Health check shall use HTTP endpoint for apps | Must |
| HEALTH-04 | Health check shall use native protocol for databases | Must |
| HEALTH-05 | System shall restart unhealthy containers automatically | Must |
| HEALTH-06 | System shall retry restart up to 3 times before escalating | Must |
| HEALTH-07 | System shall attempt VPS reboot if container restarts fail | Should |
| HEALTH-08 | System shall alert if recovery fails | Must |
| HEALTH-09 | System shall log all health events | Must |
| HEALTH-10 | User shall be able to view health history | Should |

### 3.7 Backup & Recovery

| ID | Requirement | Priority |
|----|-------------|----------|
| BACKUP-01 | System shall backup control plane state to S3 | Must |
| BACKUP-02 | User shall be able to trigger manual backup | Must |
| BACKUP-03 | User shall be able to restore from backup | Should |
| BACKUP-04 | System shall support scheduled backups | Should |
| BACKUP-05 | System shall retain backups for configurable duration | Should |
| BACKUP-06 | System shall backup database configs (not data) | Must |

### 3.8 Audit Logging

| ID | Requirement | Priority |
|----|-------------|----------|
| AUDIT-01 | System shall log all mutating API operations | Must |
| AUDIT-02 | Audit log shall include user, action, resource, timestamp | Must |
| AUDIT-03 | User shall be able to view audit logs | Must |
| AUDIT-04 | User shall be able to filter audit logs | Should |
| AUDIT-05 | Audit logs shall be retained for 90 days minimum | Should |

### 3.9 Deployment & Installation

| ID | Requirement | Priority |
|----|-------------|----------|
| INSTALL-01 | System shall be installable via single curl command | Must |
| INSTALL-02 | Install script shall install Docker if missing | Must |
| INSTALL-03 | Install script shall generate required secrets | Must |
| INSTALL-04 | Install script shall support single-node mode (with local MongoDB for state) | Must |
| INSTALL-05 | Install script shall support HA mode (requires MongoDB Atlas URI) | Must |
| INSTALL-06 | System shall be packaged as single Docker image | Must |
| INSTALL-07 | System shall include Ansible playbooks in image | Must |
| INSTALL-08 | User shall be able to update via docker compose pull | Must |

---

## 4. Non-Functional Requirements

### 4.1 Performance

| ID | Requirement | Target |
|----|-------------|--------|
| PERF-01 | API response time for list operations | < 500ms |
| PERF-02 | API response time for single resource | < 200ms |
| PERF-03 | Health check cycle completion | < 30s for 100 instances |
| PERF-04 | UI initial load time | < 3s |
| PERF-05 | Concurrent users supported | 10+ |

### 4.2 Reliability

| ID | Requirement | Target |
|----|-------------|--------|
| REL-01 | Control plane uptime (HA mode) | 99.9% |
| REL-02 | Data durability (with backups) | No data loss |
| REL-03 | Recovery time from container crash | < 60s |
| REL-04 | Recovery time from VPS reboot | < 5m |

### 4.3 Security

| ID | Requirement |
|----|-------------|
| SEC-01 | All API endpoints (except health/setup) shall require authentication |
| SEC-02 | Passwords shall be hashed with bcrypt (cost 12) |
| SEC-03 | JWT secrets shall be minimum 32 characters |
| SEC-04 | Sensitive config (passwords, keys) shall not appear in logs |
| SEC-05 | SSH private keys shall have 0400 permissions |
| SEC-06 | Database credentials shall be encrypted at rest |
| SEC-07 | API shall enforce HTTPS in production |

### 4.4 Scalability

| ID | Requirement | Target |
|----|-------------|--------|
| SCALE-01 | Servers managed per control plane | 50+ |
| SCALE-02 | Apps managed per control plane | 100+ |
| SCALE-03 | Total instances managed | 500+ |
| SCALE-04 | Database clusters managed | 20+ |

### 4.5 Portability

| ID | Requirement |
|----|-------------|
| PORT-01 | System shall run on Ubuntu 22.04+ |
| PORT-02 | System shall run on Debian 12+ |
| PORT-03 | System shall support AMD64 and ARM64 architectures |
| PORT-04 | System shall work with Hetzner Cloud API |
| PORT-05 | System shall work with DigitalOcean API |
| PORT-06 | System shall work with AWS EC2 API |

---

## 5. Data Model

### 5.1 Core Entities

```typescript
// User - Control plane admin
interface User {
  _id: string
  email: string
  password: string  // bcrypt hash
  role: 'admin'
  createdAt: Date
  updatedAt: Date
}

// Server - Managed VPS/machine
interface Server {
  _id: string
  name: string
  host: string  // IP or hostname
  sshUser: string
  sshPort: number
  privateIp?: string
  provider?: 'hetzner' | 'digitalocean' | 'aws' | 'manual'
  providerId?: string  // For cloud API operations
  status: 'online' | 'offline' | 'unknown'
  resources?: {
    cpuCores: number
    memoryMb: number
    diskGb: number
  }
  tags: string[]
  createdAt: Date
  updatedAt: Date
  lastHealthCheck?: Date
}

// App - Deployed application
interface App {
  _id: string
  name: string
  image: string  // Docker image
  domain?: string
  desiredReplicas: number
  placement: 'spread' | 'pack' | 'manual'
  env: Record<string, string>
  resources?: {
    memoryLimit: string  // e.g., "512m"
    cpuQuota: number     // e.g., 0.5
  }
  healthCheck?: {
    path: string
    interval: number
    timeout: number
  }
  status: 'running' | 'stopped' | 'deploying' | 'failed'
  createdAt: Date
  updatedAt: Date
  deployedAt?: Date
}

// Instance - Single container of an app
interface Instance {
  _id: string
  appId: string
  serverId: string
  containerId?: string
  port: number
  status: 'running' | 'stopped' | 'starting' | 'unhealthy'
  createdAt: Date
  updatedAt: Date
  lastHealthCheck?: Date
}

// Database - Provisioned database cluster (self-hosted, for apps to use)
interface Database {
  _id: string
  name: string
  type: 'mongodb' | 'redis' | 'postgresql' | 'mysql'
  version: string
  status: 'provisioning' | 'running' | 'failed' | 'stopped'
  config: Record<string, any>  // Type-specific config (replicaSetName, etc.)
  credentials: {
    adminUser: string
    adminPassword: string  // encrypted
    connectionString: string  // encrypted, for apps to use
  }
  nodes: DatabaseNode[]  // Which servers host this database
  backup?: {
    enabled: boolean
    schedule: string
    s3Bucket: string
    lastBackup?: Date
  }
  createdAt: Date
  updatedAt: Date
}

// DatabaseNode - Single node in a database cluster
interface DatabaseNode {
  serverId: string
  role: 'primary' | 'secondary' | 'arbiter' | 'standalone'
  status: 'running' | 'stopped' | 'syncing' | 'unhealthy'
}

// Deployment - Record of a deploy action
interface Deployment {
  _id: string
  appId: string
  image: string
  status: 'pending' | 'running' | 'success' | 'failed'
  triggeredBy: string  // userId
  logs?: string
  startedAt: Date
  completedAt?: Date
}

// AuditLog - Record of user actions
interface AuditLog {
  _id: string
  timestamp: Date
  userId: string
  userEmail: string
  action: string  // 'create' | 'update' | 'delete' | 'scale' | etc.
  resource: string  // 'app' | 'server' | 'database' | etc.
  resourceId: string
  details?: Record<string, any>
  ip?: string
}

// Settings - Platform configuration
interface Settings {
  _id: string  // setting key
  value: string
  updatedAt: Date
}
```

### 5.2 Collections

| Collection | Description |
|------------|-------------|
| `cp_users` | Admin users |
| `cp_servers` | Managed servers |
| `cp_apps` | Deployed applications |
| `cp_instances` | App instances (containers) |
| `cp_databases` | Provisioned databases |
| `cp_deployments` | Deployment history |
| `cp_audit_logs` | Audit trail |
| `cp_settings` | Platform settings |

---

## 6. API Specification

### 6.1 Authentication

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/login` | POST | Authenticate user, return JWT |
| `/api/auth/logout` | POST | Invalidate session |
| `/api/auth/me` | GET | Get current user |

### 6.2 Setup

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/setup/status` | GET | Check if initialized |
| `/api/setup/init` | POST | Initialize platform |

### 6.3 Servers

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/servers` | GET | List all servers |
| `/api/servers` | POST | Add a server |
| `/api/servers/:id` | GET | Get server details |
| `/api/servers/:id` | PATCH | Update server |
| `/api/servers/:id` | DELETE | Remove server |
| `/api/servers/:id/status` | GET | Get server health status |

### 6.4 Apps

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/apps` | GET | List all apps |
| `/api/apps` | POST | Create an app |
| `/api/apps/:id` | GET | Get app details |
| `/api/apps/:id` | PATCH | Update app |
| `/api/apps/:id` | DELETE | Delete app |
| `/api/apps/:id/scale` | PATCH | Scale app replicas |
| `/api/apps/:id/restart` | POST | Restart all instances |
| `/api/apps/:id/deploy` | POST | Deploy new version |
| `/api/apps/:id/logs` | GET | Get app logs |

### 6.5 Databases

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/databases` | GET | List all databases |
| `/api/databases` | POST | Provision a database |
| `/api/databases/:id` | GET | Get database details |
| `/api/databases/:id` | DELETE | Delete database |
| `/api/databases/:id/reprovision` | POST | Reprovision failed database |
| `/api/databases/:id/backup` | POST | Trigger backup |
| `/api/databases/:id/credentials` | GET | Get connection string |

### 6.6 Backups

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/backups` | GET | List backups |
| `/api/backups` | POST | Trigger backup |
| `/api/backups/:id/restore` | POST | Restore from backup |

### 6.7 Audit

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/audit-logs` | GET | List audit logs (with filters) |

### 6.8 Health

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Basic health check |
| `/api/health/detailed` | GET | Detailed health info |

---

## 7. UI Screens

### 7.1 Screen List

| Screen | Path | Description |
|--------|------|-------------|
| Setup | `/setup` | First-run setup wizard |
| Login | `/login` | Authentication |
| Dashboard | `/` | Overview of all resources |
| Servers | `/servers` | Server list and management |
| Server Detail | `/servers/:id` | Single server details |
| Apps | `/apps` | App list and management |
| App Detail | `/apps/:id` | Single app details, scaling |
| Databases | `/databases` | Database list and management |
| Database Detail | `/databases/:id` | Single database details |
| Backups | `/backups` | Backup list and restore |
| Settings | `/settings` | Platform settings |
| Audit Log | `/audit` | Audit log viewer |

### 7.2 Dashboard Wireframe

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Control Plane                                          [user@email] [Logout]│
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Overview                                                                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │   Servers   │  │    Apps     │  │  Databases  │  │  Instances  │        │
│  │      3      │  │      5      │  │      2      │  │     12      │        │
│  │   online    │  │   running   │  │   healthy   │  │   running   │        │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘        │
│                                                                             │
│  Recent Activity                                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 10:30  App "api" scaled to 3 replicas                    by admin   │   │
│  │ 10:15  Server "web-2" health check passed                           │   │
│  │ 09:45  Database "mongodb-prod" backup completed                     │   │
│  │ 09:00  App "web" deployed v1.2.3                         by admin   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Health Alerts                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ⚠ Instance api-2 on server-1 restarted 3 times in last hour         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 8. Milestones

### Phase 1: Core Infrastructure (MVP)
- [ ] Project setup (Nuxt + Express monorepo)
- [ ] Authentication (login, JWT, sessions)
- [ ] Server management (add, remove, health check)
- [ ] App deployment (create, deploy, restart)
- [ ] Basic UI (servers, apps)
- [ ] Docker image + install script

### Phase 2: Scaling & Databases
- [ ] App scaling (replicas, distribution)
- [ ] MongoDB provisioning (via Ansible)
- [ ] Redis provisioning
- [ ] Database UI (provision, credentials)
- [ ] Instance-level management

### Phase 3: Self-Healing & HA
- [ ] Health check loop
- [ ] Automatic container restart
- [ ] VPS reboot integration
- [ ] HA mode (3 control plane instances)
- [ ] Leader election for background tasks

### Phase 4: Polish & Production
- [ ] PostgreSQL provisioning
- [ ] Backup/restore UI
- [ ] Audit log UI
- [ ] App logs viewer
- [ ] Resource monitoring
- [ ] Alerting (webhook, email)

---

## 9. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Ansible playbooks fail on different OS versions | High | Test on Ubuntu 22.04, 24.04; Debian 12 |
| Health checker causes high load | Medium | Rate limiting, configurable intervals |
| Self-healing causes flapping | Medium | Backoff strategy, cooldown periods |
| MongoDB Atlas required for HA adds cost | Low | Document self-hosted MongoDB option |
| SSH key management is error-prone | Medium | Clear setup instructions, key validation |

---

## 10. Glossary

| Term | Definition |
|------|------------|
| **Control Plane** | The management system itself |
| **Managed Server** | A VPS controlled by the control plane |
| **Provisioning** | Setting up a database from scratch |
| **Reconciliation** | Process of making actual state match desired state |
| **Replica Set** | MongoDB cluster with primary + secondaries |
| **Spread Placement** | Distribute instances across different servers |
| **Pack Placement** | Fill one server before using others |
