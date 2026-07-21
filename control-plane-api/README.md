# control-plane-api

Express + MongoDB + TypeScript backend for the Control Plane.

## Setup

### Prerequisites

- Node.js 20+
- Yarn 1.x
- MongoDB (local or Atlas)
- Redis

### Installation

```bash
cd control-plane-api
yarn install
```

### Environment Variables

Create a `.env` file:

```env
# MongoDB
MONGODB_URI=mongodb://localhost:27017
MONGO_DB=control_plane

# Redis
REDIS_URL=redis://localhost:6379
# Or use separate config:
# REDIS_HOST=localhost
# REDIS_PORT=6379
# REDIS_PASSWORD=

# Server
PORT=3001
SECRET_KEY=your-secret-key-here

# JWT
ACCESS_TOKEN_SECRET=your-access-token-secret
REFRESH_TOKEN_SECRET=your-refresh-token-secret
ACCESS_TOKEN_EXPIRY=15m
REFRESH_TOKEN_EXPIRY=30d

# Session
SESSION_TTL_SECONDS=14400

# Cookie
COOKIE_SAMESITE=lax
COOKIE_DOMAIN=localhost

# Kubernetes (optional)
K8S_ENABLED=true
K8S_KUBECONFIG=/etc/rancher/k3s/k3s.yaml
K8S_NAMESPACE=controlplane

# Initial Admin (for automated setup)
ROOT_USER_EMAIL=admin@example.com
ROOT_USER_PASSWORD=changeme
```

### Running

```bash
# Development (with hot reload)
yarn dev

# Build
yarn build

# Production
yarn start
```

### Testing

```bash
# Start test containers (MongoDB + Redis)
./test.sh setup

# Run all tests
yarn test

# Run specific test suite
yarn test:app
yarn test:database

# Watch mode
yarn test:watch

# Teardown test containers
./test.sh teardown
```

---

## Resource Pattern

Each resource follows a strict 4-layer architecture:

```
src/resources/<resource>/
  resource.model.ts       # Types, Joi schemas, model factory
  resource.repository.ts  # DB queries, indexes, caching
  resource.service.ts     # Business logic (optional)
  resource.controller.ts  # HTTP handlers
  index.ts                # Barrel exports
```

| Layer | Responsibility |
|-------|---------------|
| **Model** | TypeScript types, Joi validation schemas, `model<Resource>()` factory |
| **Repository** | Database access only — queries, indexes, cache read/invalidate |
| **Service** | Business logic, transactions, external integrations (optional) |
| **Controller** | HTTP validation, delegation, error forwarding |

---

## Authentication

Three authentication methods are supported:

### 1. Session Cookie (`sid`)

Primary method for web UI. HttpOnly, rolling refresh.

```typescript
// Login
POST /api/auth/login
{ "email": "admin@example.com", "password": "secret" }
// Returns: Set-Cookie: sid=...

// Logout
DELETE /api/auth/logout
```

### 2. JWT Bearer Token

Short-lived access tokens for API calls.

```typescript
// Issue token
POST /api/auth/token
// Returns: { accessToken, refreshToken }

// Use token
Authorization: Bearer <accessToken>
```

### 3. API Token

Long-lived tokens for CI/CD. Prefix: `cp_`. Stored as SHA256 hash.

```typescript
// Create token
POST /api/api-tokens
{ "name": "CI Deploy", "scopes": ["apps:read", "apps:write", "deployments:write"] }
// Returns plaintext token ONCE: { token: "cp_abc123..." }

// Use token
Authorization: Bearer cp_abc123...
```

### API Token Scopes

| Scope | Access |
|-------|--------|
| `apps:read` | List/view apps |
| `apps:write` | Create/update/delete apps, start/stop/restart |
| `databases:read` | List/view databases |
| `databases:write` | Create/update/delete databases, manage backups |
| `deployments:read` | View deployment history |
| `deployments:write` | Deploy, rollback |
| `settings:read` | View settings, SSH keys |
| `settings:write` | Modify settings, manage SSH keys |
| `*` | Full access |

---

## API Endpoints

### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Basic health check |
| `GET` | `/api/health/detailed` | Memory, CPU, K8s status |

### Setup

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/setup/status` | Check if initialized |
| `POST` | `/api/setup/init` | Create first admin user |
| `GET` | `/api/setup/ssh-key` | Get SSH public key |

### Auth

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/login` | Login with email/password |
| `DELETE` | `/api/auth/logout` | Logout (clear session) |
| `GET` | `/api/auth/me` | Get current user |
| `PATCH` | `/api/auth/me` | Update current user |
| `POST` | `/api/auth/token` | Issue JWT token |

### Apps

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/apps` | List apps |
| `POST` | `/api/apps` | Create app |
| `GET` | `/api/apps/:id` | Get app |
| `PATCH` | `/api/apps/:id` | Update app |
| `DELETE` | `/api/apps/:id` | Delete app |
| `POST` | `/api/apps/:id/deploy` | Deploy app |
| `POST` | `/api/apps/:id/redeploy` | Redeploy current version |
| `POST` | `/api/apps/:id/rollback` | Rollback to previous |
| `POST` | `/api/apps/:id/rollback/:version` | Rollback to specific version |
| `POST` | `/api/apps/:id/stop` | Stop app |
| `POST` | `/api/apps/:id/start` | Start app |
| `POST` | `/api/apps/:id/restart` | Restart app |
| `PATCH` | `/api/apps/:id/scale` | Scale replicas |
| `GET` | `/api/apps/:id/logs` | Get logs |
| `GET` | `/api/apps/:id/status` | Get runtime status |
| `GET` | `/api/apps/:id/deployments` | Deployment history |
| `GET` | `/api/apps/:id/deploy/stream` | SSE deployment log stream |

### Databases

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/databases` | List databases |
| `POST` | `/api/databases` | Create database |
| `GET` | `/api/databases/:id` | Get database |
| `PATCH` | `/api/databases/:id` | Update database |
| `DELETE` | `/api/databases/:id` | Delete database |
| `POST` | `/api/databases/:id/reprovision` | Reprovision |
| `GET` | `/api/databases/:id/credentials` | Get credentials |
| `GET` | `/api/databases/:id/health` | Get replica set health |
| `GET` | `/api/databases/:id/logs` | Get provisioning logs |
| `POST` | `/api/databases/:id/dns` | Configure DNS |
| `DELETE` | `/api/databases/:id/dns` | Remove DNS |
| `POST` | `/api/databases/:id/tls` | Enable TLS |
| `DELETE` | `/api/databases/:id/tls` | Disable TLS |
| `GET` | `/api/databases/:id/tls` | Get TLS status |
| `GET` | `/api/databases/:id/tls/ca` | Download CA certificate |
| `POST` | `/api/databases/:id/backup/config` | Configure backup |
| `POST` | `/api/databases/:id/backup` | Trigger manual backup |
| `GET` | `/api/databases/:id/backups` | List backups |
| `POST` | `/api/databases/:id/backup/restore` | Restore from backup |

### Clusters

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/clusters` | List clusters |
| `POST` | `/api/clusters` | Create cluster |
| `GET` | `/api/clusters/:id` | Get cluster |
| `PATCH` | `/api/clusters/:id` | Update cluster |
| `DELETE` | `/api/clusters/:id` | Delete cluster |
| `POST` | `/api/clusters/:id/sync` | Sync cluster status |
| `GET` | `/api/clusters/:id/join-token` | Get join token |
| `POST` | `/api/clusters/:id/refresh-token` | Refresh join token |

### Nodes

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/nodes` | List all nodes |
| `GET` | `/api/nodes/cluster/:clusterId` | List nodes by cluster |
| `POST` | `/api/nodes/join-token` | Generate join token |
| `POST` | `/api/nodes/test-connection` | Test SSH connection |
| `POST` | `/api/nodes/provision` | Provision new node |
| `POST` | `/api/nodes/sync-all` | Sync all nodes |
| `GET` | `/api/nodes/:id` | Get node |
| `GET` | `/api/nodes/:id/provisioning-status` | Get provisioning status |
| `POST` | `/api/nodes/:id/retry-provision` | Retry failed provision |
| `POST` | `/api/nodes/:id/sync` | Sync single node |
| `POST` | `/api/nodes/:id/cordon` | Mark unschedulable |
| `POST` | `/api/nodes/:id/uncordon` | Mark schedulable |
| `POST` | `/api/nodes/:id/drain` | Evict pods |
| `DELETE` | `/api/nodes/:id` | Remove node |
| `POST` | `/api/nodes/:id/labels` | Add label |
| `DELETE` | `/api/nodes/:id/labels/:key` | Remove label |

### SSH Keys

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/ssh-keys` | List SSH keys |
| `POST` | `/api/ssh-keys` | Generate new key |
| `POST` | `/api/ssh-keys/import` | Import existing key |
| `GET` | `/api/ssh-keys/:id` | Get key |
| `PATCH` | `/api/ssh-keys/:id` | Update key |
| `POST` | `/api/ssh-keys/:id/default` | Set as default |
| `DELETE` | `/api/ssh-keys/:id` | Delete key |

### API Tokens

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/api-tokens` | List tokens |
| `GET` | `/api/api-tokens/scopes` | List available scopes |
| `POST` | `/api/api-tokens` | Create token |
| `DELETE` | `/api/api-tokens/:id` | Revoke token |

### Secrets

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/secrets` | List secrets (metadata only) |
| `GET` | `/api/secrets/global` | List global secrets |
| `POST` | `/api/secrets` | Create secret |
| `GET` | `/api/secrets/:id` | Get secret metadata |
| `PATCH` | `/api/secrets/:id` | Update secret |
| `DELETE` | `/api/secrets/:id` | Delete secret |

### Settings

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/settings` | List all settings |
| `PUT` | `/api/settings/:key` | Set a setting |
| `GET` | `/api/settings/dns` | Get DNS config |
| `POST` | `/api/settings/dns/verify` | Verify Cloudflare token |
| `PUT` | `/api/settings/dns/token` | Save API token |
| `PUT` | `/api/settings/dns/apps` | Configure apps DNS |
| `PUT` | `/api/settings/dns/db` | Configure database DNS |
| `DELETE` | `/api/settings/dns/:scope` | Clear DNS config |
| `GET` | `/api/settings/k8s` | Get K8s status |
| `GET` | `/api/settings/k8s/nodes` | List K8s nodes |
| `GET` | `/api/settings/k8s/agent-command` | Get K3s join command |
| `GET` | `/api/settings/k8s/operator` | Get Percona Operator status |
| `POST` | `/api/settings/k8s/refresh-token` | Refresh K3s token |

### Metrics

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/metrics/system` | System metrics (CPU, memory, disk) |
| `GET` | `/api/metrics/cluster` | K8s cluster metrics |
| `GET` | `/api/metrics/databases` | Database metrics |
| `GET` | `/api/metrics/apps` | App metrics |
| `GET` | `/api/metrics/overview` | Combined dashboard data |

### Audit

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/audit-logs` | List audit logs |

---

## Error Handling

All errors use typed classes from `src/utils/error.ts`:

```typescript
import { BadRequestError, NotFoundError, ForbiddenError } from '../utils/error'

// Examples
throw new BadRequestError('Invalid server ID format.')
throw new NotFoundError('App not found.')
throw new ForbiddenError('Insufficient permissions.')
```

| Error | Status Code |
|-------|-------------|
| `BadRequestError` | 400 |
| `UnauthorizedError` | 401 |
| `ForbiddenError` | 403 |
| `NotFoundError` | 404 |
| `ConflictError` | 409 |
| `InternalServerError` | 500 |

---

## Collections

All collections are prefixed with `cp_`:

| Collection | Description |
|------------|-------------|
| `cp_users` | Admin users |
| `cp_apps` | Deployed applications |
| `cp_databases` | Provisioned databases |
| `cp_deployments` | Deployment history |
| `cp_clusters` | K8s clusters |
| `cp_nodes` | K8s worker nodes |
| `cp_audit_logs` | Audit trail |
| `cp_settings` | Platform configuration |
| `cp_ssh_keys` | SSH keypairs |
| `cp_api_tokens` | API tokens |
| `cp_secrets` | Encrypted secrets |
