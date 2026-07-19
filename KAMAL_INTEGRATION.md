# Kamal Integration Implementation Plan

## Overview

Integrate [Kamal](https://kamal-deploy.org/) (by 37signals) for zero-downtime deployments of web applications on managed servers.

**Approach:** Hybrid - Generate Kamal configs from Control Plane app settings and execute Kamal CLI commands.

## Benefits

- ✅ Zero-downtime deployments (rolling deploys via kamal-proxy)
- ✅ Battle-tested deployment logic from 37signals
- ✅ Automatic SSL via Let's Encrypt
- ✅ Built-in health checks and rollback
- ✅ Asset bridging for frontend apps
- ✅ Multi-server support out of the box

---

## Prerequisites

### On Control Plane Server
- [ ] Ruby 3.x installed
- [ ] Kamal gem installed (`gem install kamal`)
- [ ] Docker installed (for building images)

### On Managed Servers
- [ ] Docker installed
- [ ] SSH access configured (already done)
- [ ] Ports 80, 443 open
- [ ] kamal-proxy container running

---

## Implementation Phases

### Phase 1: App Model Enhancement
**Status:** 🔲 Not Started

Update the app model to support Kamal configuration options.

**Files to modify:**
- [ ] `control-plane-api/src/resources/app/app.model.ts`

**New fields:**
```typescript
type TAppSource = {
  type: 'image' | 'git';
  // For pre-built images
  image?: string;
  // For git-based builds
  gitUrl?: string;
  gitBranch?: string;
  dockerfile?: string;
  buildContext?: string;
};

type TAppRegistry = {
  server: string;          // e.g., ghcr.io, docker.io
  username: string;
  password: string;        // encrypted
};

type TAppProxy = {
  ssl: boolean;
  host: string;            // Domain for the app
  appPort: number;         // Container port (default 3000)
  healthcheckPath?: string;
  healthcheckInterval?: number;
  responseTimeout?: number;
  buffering?: {
    requests: boolean;
    responses: boolean;
    maxRequestBody?: number;
  };
};

type TAppDeploy = {
  timeout?: number;        // Deploy timeout in seconds
  drainTimeout?: number;   // Drain timeout before stopping old containers
  readinessDelay?: number; // Seconds to wait after container starts
};

type TApp = {
  // ... existing fields ...
  source: TAppSource;
  registry?: TAppRegistry;
  proxy?: TAppProxy;
  deploy?: TAppDeploy;
  secrets?: string[];      // Secret env var names (values from secret store)
  volumes?: string[];      // Volume mounts
  currentVersion?: string; // Currently deployed image tag/SHA
  versions?: string[];     // History of deployed versions (for rollback)
};
```

---

### Phase 2: Secret Store
**Status:** 🔲 Not Started

Create a secure secret store for sensitive values (registry passwords, API keys).

**Files to create:**
- [ ] `control-plane-api/src/resources/secret/secret.model.ts`
- [ ] `control-plane-api/src/resources/secret/secret.repository.ts`
- [ ] `control-plane-api/src/resources/secret/secret.controller.ts`
- [ ] `control-plane-api/src/routes/secret.route.ts`

**Features:**
- Secrets encrypted at rest (AES-256)
- Scoped to app or global
- Referenced by name in app config
- Never returned in plain text via API (write-only)

**Schema:**
```typescript
type TSecret = {
  _id: ObjectId;
  name: string;           // e.g., "REGISTRY_PASSWORD", "DATABASE_URL"
  value: string;          // encrypted
  appId?: ObjectId;       // null = global secret
  createdAt: Date;
  updatedAt: Date;
};
```

---

### Phase 3: Kamal Config Generator
**Status:** 🔲 Not Started

Service to generate `deploy.yml` from app configuration.

**Files to create:**
- [ ] `control-plane-api/src/services/kamal.generator.ts`

**Functions:**
```typescript
function generateDeployYaml(app: TApp, servers: TServer[], secrets: TSecret[]): string
function generateSecretsEnv(app: TApp, secrets: TSecret[]): string
```

**Generated config structure:**
```yaml
service: myapp
image: ghcr.io/user/myapp

servers:
  web:
    - 192.168.1.1
    - 192.168.1.2
    hosts:
      192.168.1.1:
        tags:
          - primary

registry:
  server: ghcr.io
  username: user
  password:
    - KAMAL_REGISTRY_PASSWORD

env:
  clear:
    RAILS_ENV: production
    DATABASE_HOST: db.example.com
  secret:
    - DATABASE_PASSWORD
    - REDIS_URL

proxy:
  ssl: true
  host: myapp.example.com
  app_port: 3000
  healthcheck:
    path: /up
    interval: 3

ssh:
  user: root

builder:
  multiarch: false
  cache:
    type: gha
```

---

### Phase 4: Kamal Executor Service
**Status:** 🔲 Not Started

Service to execute Kamal CLI commands and stream output.

**Files to create:**
- [ ] `control-plane-api/src/services/kamal.executor.ts`

**Functions:**
```typescript
// Core deployment
async function deploy(appId: string, options?: { version?: string }): Promise<TDeployResult>
async function redeploy(appId: string): Promise<TDeployResult>
async function rollback(appId: string, version?: string): Promise<TDeployResult>

// App lifecycle
async function stop(appId: string): Promise<void>
async function start(appId: string): Promise<void>
async function restart(appId: string): Promise<void>

// Inspection
async function logs(appId: string, options?: { lines?: number; follow?: boolean }): AsyncGenerator<string>
async function details(appId: string): Promise<TAppDetails>
async function version(appId: string): Promise<string>

// Execution
async function exec(appId: string, command: string, options?: { interactive?: boolean }): Promise<string>
async function console(appId: string): Promise<void> // Rails console

// Server management
async function setupProxy(serverId: string): Promise<void>
async function removeProxy(serverId: string): Promise<void>
```

**Execution approach:**
1. Create temp directory for app
2. Generate `deploy.yml` and `.kamal/secrets`
3. Copy SSH key to temp location
4. Execute `kamal` command via child_process
5. Stream stdout/stderr
6. Parse exit code and output
7. Cleanup temp files

---

### Phase 5: Server Bootstrap for Kamal
**Status:** 🔲 Not Started

Prepare servers for Kamal deployments.

**Files to modify:**
- [ ] `control-plane-api/src/resources/server/server.controller.ts`
- [ ] `control-plane-api/src/services/kamal.executor.ts`

**New endpoint:**
```
POST /servers/:id/bootstrap
```

**Bootstrap steps:**
1. Install Docker (if not present)
2. Run `kamal proxy boot` to start kamal-proxy
3. Configure firewall (80, 443)
4. Mark server as "ready for apps"

**Server model addition:**
```typescript
type TServer = {
  // ... existing fields ...
  kamalReady: boolean;      // Has kamal-proxy running
  kamalProxyVersion?: string;
};
```

---

### Phase 6: Deployment History & Versions
**Status:** 🔲 Not Started

Track deployment history for rollbacks and audit.

**Files to modify:**
- [ ] `control-plane-api/src/resources/deployment/deployment.model.ts`

**Enhanced deployment model:**
```typescript
type TDeployment = {
  _id: ObjectId;
  appId: ObjectId;
  version: string;         // Image tag or git SHA
  image: string;           // Full image URL
  status: 'pending' | 'building' | 'pushing' | 'deploying' | 'success' | 'failed' | 'rolled_back';
  triggeredBy: ObjectId;   // User who triggered
  startedAt: Date;
  completedAt?: Date;
  duration?: number;       // seconds
  logs?: string;           // Deployment logs
  error?: string;          // Error message if failed
  rollbackOf?: ObjectId;   // If this is a rollback, reference original deployment
};
```

---

### Phase 7: API Endpoints
**Status:** 🔲 Not Started

**Files to modify:**
- [ ] `control-plane-api/src/resources/app/app.controller.ts`
- [ ] `control-plane-api/src/routes/app.route.ts`

**Endpoints:**
```
# App CRUD
POST   /apps                      # Create app
GET    /apps                      # List apps
GET    /apps/:id                  # Get app details
PATCH  /apps/:id                  # Update app config
DELETE /apps/:id                  # Delete app

# Deployment
POST   /apps/:id/deploy           # Deploy (build if git, then deploy)
POST   /apps/:id/redeploy         # Redeploy current version
POST   /apps/:id/rollback         # Rollback to previous version
POST   /apps/:id/rollback/:version # Rollback to specific version

# Lifecycle
POST   /apps/:id/stop             # Stop all containers
POST   /apps/:id/start            # Start containers
POST   /apps/:id/restart          # Restart containers

# Inspection
GET    /apps/:id/logs             # Get recent logs
GET    /apps/:id/logs/stream      # Stream logs (SSE)
GET    /apps/:id/instances        # List running instances
GET    /apps/:id/versions         # List deployed versions
GET    /apps/:id/deployments      # Deployment history

# Execution
POST   /apps/:id/exec             # Execute command
POST   /apps/:id/console          # Rails/Node console

# Environment
GET    /apps/:id/env              # Get env vars (secrets masked)
PATCH  /apps/:id/env              # Update env vars
POST   /apps/:id/secrets          # Add secret
DELETE /apps/:id/secrets/:name    # Remove secret
```

---

### Phase 8: Frontend - Apps UI
**Status:** 🔲 Not Started

**Files to create:**
```
control-plane-web/app/pages/dashboard/apps/
├── index.vue              # List all apps with status
├── new.vue                # Create new app wizard
└── [id]/
    ├── index.vue          # App overview (status, quick actions, recent deploys)
    ├── deploy.vue         # Deploy form with live logs
    ├── env.vue            # Environment variables management
    ├── servers.vue        # Server selection and status
    ├── logs.vue           # Live logs viewer
    ├── settings.vue       # Domain, proxy, health check config
    ├── versions.vue       # Deployment history, rollback
    └── terminal.vue       # Interactive terminal (exec/console)
```

**Composables:**
- [ ] `control-plane-web/app/composables/useApp.ts` (enhance existing)
- [ ] `control-plane-web/app/composables/useDeployment.ts`
- [ ] `control-plane-web/app/composables/useSecret.ts`

---

### Phase 9: Registry Management
**Status:** 🔲 Not Started

Global registry configurations that can be reused across apps.

**Files to create:**
- [ ] `control-plane-api/src/resources/registry/registry.model.ts`
- [ ] `control-plane-api/src/resources/registry/registry.repository.ts`
- [ ] `control-plane-api/src/resources/registry/registry.controller.ts`

**Schema:**
```typescript
type TRegistry = {
  _id: ObjectId;
  name: string;            // "GitHub Container Registry"
  server: string;          // "ghcr.io"
  username: string;
  password: string;        // encrypted
  isDefault: boolean;
  createdAt: Date;
};
```

---

### Phase 10: Build Service (Optional)
**Status:** 🔲 Not Started

For git-based deployments, build images remotely.

**Options:**
1. Build on Control Plane server (requires Docker)
2. Build on a dedicated build server
3. Build on target server (Kamal default)
4. Use GitHub Actions / CI (recommended for production)

**For MVP:** Use Kamal's default (build on deploy server) or require pre-built images.

---

## Testing Checklist

- [ ] Deploy pre-built image to single server
- [ ] Deploy pre-built image to multiple servers
- [ ] Zero-downtime rolling deploy
- [ ] Rollback to previous version
- [ ] Environment variable updates
- [ ] Secret management
- [ ] Health check failure handling
- [ ] SSL certificate provisioning
- [ ] Logs streaming
- [ ] Container exec

---

## Migration Path

For apps deployed with the old (non-Kamal) method:

1. Stop old containers manually
2. Create app in Control Plane with Kamal config
3. Deploy via Kamal
4. Remove old container artifacts

---

## Open Questions

1. **Build strategy:** Should we support git-based builds in MVP or require pre-built images?
   - Recommendation: MVP = pre-built images only, Phase 2 = git builds

2. **Multi-role apps:** Should we support separate web/worker/cron roles?
   - Recommendation: MVP = web only, Phase 2 = accessories for workers

3. **Accessories:** Should we integrate Kamal accessories for Redis/etc?
   - Recommendation: No, use our database provisioning instead

4. **Builder:** Local vs remote vs CI?
   - Recommendation: MVP = pre-built, Phase 2 = Kamal remote builder

---

## Progress Tracking

| Phase | Description | Status | Notes |
|-------|-------------|--------|-------|
| 1 | App Model Enhancement | ✅ | `app.model.ts` rewritten with source, registry, proxy, deploy config |
| 2 | Secret Store | ✅ | Model, repo (AES-256-GCM encryption), controller, route |
| 3 | Kamal Config Generator | ✅ | `kamal.generator.ts` — generates deploy.yml + secrets file |
| 4 | Kamal Executor Service | ✅ | `kamal.executor.ts` — deploy, redeploy, rollback, stop, start, logs, exec |
| 5 | Server Bootstrap | ✅ | `POST /servers/:id/bootstrap` — Docker + kamal-proxy + firewall |
| 6 | Deployment History | 🔄 | Existing deployment model used, needs version tracking |
| 7 | API Endpoints | ✅ | App controller rewritten, secrets route added |
| 8 | Frontend UI | ✅ | Apps list + detail page, composable, types |
| 9 | Registry Management | 🔲 | |
| 10 | Build Service | 🔲 | Optional |

**Legend:** 🔲 Not Started | 🔄 In Progress | ✅ Complete | ⏸️ Blocked

---

## References

- [Kamal Documentation](https://kamal-deploy.org/docs/installation/)
- [Kamal GitHub](https://github.com/basecamp/kamal)
- [kamal-proxy](https://github.com/basecamp/kamal-proxy)
- [Kamal Configuration Reference](https://kamal-deploy.org/docs/configuration/)
