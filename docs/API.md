# API Reference

Complete reference for the Control Plane REST API.

**Base URL:** `/api`

**Authentication:** All endpoints except `/health`, `/setup/status`, and `/auth/login` require authentication via session cookie, JWT bearer token, or API token.

---

## Table of Contents

- [Health](#health)
- [Setup](#setup)
- [Authentication](#authentication)
- [Apps](#apps)
- [Databases](#databases)
- [Clusters](#clusters)
- [Nodes](#nodes)
- [SSH Keys](#ssh-keys)
- [API Tokens](#api-tokens)
- [Secrets](#secrets)
- [Settings](#settings)
- [Metrics](#metrics)
- [Audit Logs](#audit-logs)

---

## Health

### GET /api/health

Basic health check.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### GET /api/health/detailed

Detailed health with system metrics.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 86400,
  "memory": { "used": 256, "total": 512 },
  "system": {
    "hostname": "control-plane-1",
    "platform": "linux",
    "cpus": 4,
    "loadAvg": [0.5, 0.6, 0.7]
  },
  "kubernetes": {
    "enabled": true,
    "available": true,
    "nodes": 3
  }
}
```

---

## Setup

### GET /api/setup/status

Check if the platform has been initialized.

**Response:**
```json
{ "initialized": false }
```

### POST /api/setup/init

Initialize the platform with the first admin user.

**Request:**
```json
{
  "email": "admin@example.com",
  "password": "securepassword"
}
```

**Response:**
```json
{
  "message": "Platform initialized successfully",
  "userId": "507f1f77bcf86cd799439011"
}
```

### GET /api/setup/ssh-key

Get the SSH public key for adding to servers. **Requires authentication.**

**Response:**
```json
{
  "publicKey": "ssh-ed25519 AAAAC3Nz... control-plane",
  "copyCommand": "echo \"ssh-ed25519 AAAAC3Nz...\" >> ~/.ssh/authorized_keys"
}
```

---

## Authentication

### POST /api/auth/login

Login with email and password.

**Request:**
```json
{
  "email": "admin@example.com",
  "password": "securepassword"
}
```

**Response:**
```json
{
  "user": {
    "_id": "507f1f77bcf86cd799439011",
    "email": "admin@example.com"
  }
}
```

Sets `sid` cookie for session authentication.

### DELETE /api/auth/logout

Logout and clear session.

**Response:**
```json
{ "message": "Logged out" }
```

### GET /api/auth/me

Get current authenticated user.

**Response:**
```json
{
  "_id": "507f1f77bcf86cd799439011",
  "email": "admin@example.com",
  "createdAt": "2024-01-01T00:00:00.000Z"
}
```

### PATCH /api/auth/me

Update current user.

**Request:**
```json
{
  "email": "newemail@example.com",
  "password": "newpassword"
}
```

### POST /api/auth/token

Issue JWT access and refresh tokens.

**Response:**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
  "expiresIn": "15m"
}
```

---

## Apps

### GET /api/apps

List all apps with pagination.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `page` | number | Page number (default: 1) |
| `search` | string | Search by name |
| `status` | string | Filter by status |

**Response:**
```json
{
  "items": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "name": "my-app",
      "image": "nginx:latest",
      "replicas": 2,
      "status": "running",
      "domain": "my-app.example.com",
      "envVars": { "NODE_ENV": "production" },
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "page": 1,
  "pages": 5,
  "total": 50
}
```

### POST /api/apps

Create a new app.

**Request:**
```json
{
  "name": "my-app",
  "image": "nginx:latest",
  "replicas": 2,
  "domain": "my-app.example.com",
  "envVars": { "NODE_ENV": "production" },
  "port": 80
}
```

**Response:**
```json
{
  "message": "App created",
  "appId": "507f1f77bcf86cd799439011"
}
```

### GET /api/apps/:id

Get app by ID.

### PATCH /api/apps/:id

Update app.

**Request:**
```json
{
  "replicas": 4,
  "envVars": { "NODE_ENV": "staging" }
}
```

### DELETE /api/apps/:id

Delete app.

### POST /api/apps/:id/deploy

Deploy the app.

**Request:**
```json
{
  "version": "v1.2.0",
  "force": false
}
```

**Response:**
```json
{
  "message": "Deployment started",
  "deploymentId": "507f1f77bcf86cd799439012"
}
```

### POST /api/apps/:id/redeploy

Redeploy current version.

### POST /api/apps/:id/rollback

Rollback to previous version.

### POST /api/apps/:id/rollback/:version

Rollback to specific version.

### POST /api/apps/:id/stop

Stop the app.

### POST /api/apps/:id/start

Start the app.

### POST /api/apps/:id/restart

Restart the app.

### PATCH /api/apps/:id/scale

Scale app replicas.

**Request:**
```json
{ "replicas": 5 }
```

### GET /api/apps/:id/logs

Get app logs.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `lines` | number | Number of lines (default: 100) |
| `follow` | boolean | Stream logs |

### GET /api/apps/:id/status

Get runtime status.

**Response:**
```json
{
  "status": "running",
  "replicas": { "desired": 3, "ready": 3 },
  "pods": [
    { "name": "my-app-abc123", "status": "Running", "restarts": 0 }
  ]
}
```

### GET /api/apps/:id/deployments

Get deployment history.

**Response:**
```json
{
  "items": [
    {
      "_id": "507f1f77bcf86cd799439012",
      "version": "v1.2.0",
      "status": "success",
      "startedAt": "2024-01-15T10:00:00.000Z",
      "completedAt": "2024-01-15T10:02:00.000Z"
    }
  ]
}
```

### GET /api/apps/:id/deploy/stream

SSE stream for deployment logs.

**Response (SSE):**
```
data: {"line": "Pulling image nginx:latest..."}

data: {"line": "Creating deployment..."}

data: {"done": true, "status": "success"}
```

---

## Databases

### GET /api/databases

List databases with pagination.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `page` | number | Page number |
| `search` | string | Search by name |
| `status` | string | Filter by status |

### POST /api/databases

Create a new database.

**Request:**
```json
{
  "name": "my-db",
  "engine": "mongodb",
  "replicas": 3,
  "version": "7.0",
  "storage": "10Gi"
}
```

### GET /api/databases/:id

Get database by ID.

### PATCH /api/databases/:id

Update database.

### DELETE /api/databases/:id

Delete database.

### POST /api/databases/:id/reprovision

Reprovision the database.

### GET /api/databases/:id/credentials

Get database credentials. **Requires `databases:write` scope.**

**Response:**
```json
{
  "connectionString": "mongodb://user:pass@host:27017/db?replicaSet=rs0",
  "username": "admin",
  "password": "generated-password",
  "host": "my-db-mongodb.cp-databases.svc.cluster.local",
  "port": 27017
}
```

### GET /api/databases/:id/health

Get replica set health.

**Response:**
```json
{
  "status": "healthy",
  "members": [
    { "name": "rs0-0", "state": "PRIMARY", "health": 1 },
    { "name": "rs0-1", "state": "SECONDARY", "health": 1 },
    { "name": "rs0-2", "state": "SECONDARY", "health": 1 }
  ]
}
```

### GET /api/databases/:id/logs

Get provisioning logs.

### POST /api/databases/:id/dns

Configure DNS for database.

**Request:**
```json
{
  "subdomain": "db1"
}
```

### DELETE /api/databases/:id/dns

Remove DNS configuration.

### POST /api/databases/:id/tls

Enable TLS.

### DELETE /api/databases/:id/tls

Disable TLS.

### GET /api/databases/:id/tls

Get TLS status.

**Response:**
```json
{
  "enabled": true,
  "issuer": "letsencrypt",
  "expiresAt": "2024-04-15T00:00:00.000Z"
}
```

### GET /api/databases/:id/tls/ca

Download CA certificate.

### POST /api/databases/:id/backup/config

Configure backup schedule.

**Request:**
```json
{
  "enabled": true,
  "schedule": "0 2 * * *",
  "retention": 7,
  "destination": {
    "type": "s3",
    "bucket": "my-backups",
    "region": "us-east-1"
  }
}
```

### POST /api/databases/:id/backup

Trigger manual backup.

### GET /api/databases/:id/backups

List backups.

**Response:**
```json
{
  "items": [
    {
      "_id": "507f1f77bcf86cd799439013",
      "type": "scheduled",
      "status": "completed",
      "size": "1.2GB",
      "createdAt": "2024-01-15T02:00:00.000Z"
    }
  ]
}
```

### POST /api/databases/:id/backup/restore

Restore from backup.

**Request:**
```json
{
  "backupId": "507f1f77bcf86cd799439013"
}
```

---

## Clusters

### GET /api/clusters

List all clusters.

### POST /api/clusters

Create a cluster.

**Request:**
```json
{
  "name": "production",
  "apiServerUrl": "https://192.168.1.100:6443"
}
```

### GET /api/clusters/:id

Get cluster by ID.

### PATCH /api/clusters/:id

Update cluster.

### DELETE /api/clusters/:id

Delete cluster.

### POST /api/clusters/:id/sync

Sync cluster status from K8s.

### GET /api/clusters/:id/join-token

Get join token for adding worker nodes.

**Response:**
```json
{
  "token": "K10xxx...",
  "command": "curl -sfL https://get.k3s.io | K3S_URL=... K3S_TOKEN=... sh -s - agent"
}
```

### POST /api/clusters/:id/refresh-token

Refresh the join token.

---

## Nodes

### GET /api/nodes

List all nodes across all clusters.

### GET /api/nodes/cluster/:clusterId

List nodes for a specific cluster.

### POST /api/nodes/join-token

Generate a join token for manual node addition.

### POST /api/nodes/test-connection

Test SSH connection before provisioning.

**Request:**
```json
{
  "host": "192.168.1.101",
  "port": 22,
  "username": "root",
  "sshKeyId": "507f1f77bcf86cd799439014"
}
```

### POST /api/nodes/provision

Provision a new worker node.

**Request:**
```json
{
  "name": "worker-1",
  "host": "192.168.1.101",
  "sshKeyId": "507f1f77bcf86cd799439014",
  "clusterId": "507f1f77bcf86cd799439015",
  "labels": { "node-type": "database" }
}
```

### POST /api/nodes/sync-all

Sync all nodes from K8s.

### GET /api/nodes/:id

Get node by ID.

### GET /api/nodes/:id/provisioning-status

Get provisioning status.

**Response:**
```json
{
  "status": "provisioning",
  "step": "installing-k3s",
  "progress": 60,
  "logs": ["Connecting to server...", "Installing K3s agent..."]
}
```

### POST /api/nodes/:id/retry-provision

Retry failed provisioning.

### POST /api/nodes/:id/sync

Sync single node from K8s.

### POST /api/nodes/:id/cordon

Mark node as unschedulable.

### POST /api/nodes/:id/uncordon

Mark node as schedulable.

### POST /api/nodes/:id/drain

Evict all pods from node.

### DELETE /api/nodes/:id

Remove node from cluster.

### POST /api/nodes/:id/labels

Add label to node.

**Request:**
```json
{
  "key": "node-type",
  "value": "database"
}
```

### DELETE /api/nodes/:id/labels/:key

Remove label from node.

---

## SSH Keys

### GET /api/ssh-keys

List SSH keys (metadata only).

**Response:**
```json
{
  "items": [
    {
      "_id": "507f1f77bcf86cd799439014",
      "name": "Production Key",
      "fingerprint": "SHA256:xxx...",
      "isDefault": true,
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

### POST /api/ssh-keys

Generate new SSH key. **Returns private key only once.**

**Request:**
```json
{
  "name": "Production Key",
  "type": "ed25519"
}
```

**Response:**
```json
{
  "key": {
    "_id": "507f1f77bcf86cd799439014",
    "name": "Production Key",
    "fingerprint": "SHA256:xxx...",
    "publicKey": "ssh-ed25519 AAAAC3Nz..."
  },
  "privateKey": "-----BEGIN OPENSSH PRIVATE KEY-----\n..."
}
```

### POST /api/ssh-keys/import

Import existing SSH key.

**Request:**
```json
{
  "name": "Imported Key",
  "privateKey": "-----BEGIN OPENSSH PRIVATE KEY-----\n..."
}
```

### GET /api/ssh-keys/:id

Get SSH key by ID.

### PATCH /api/ssh-keys/:id

Update SSH key name.

### POST /api/ssh-keys/:id/default

Set as default SSH key.

### DELETE /api/ssh-keys/:id

Delete SSH key.

---

## API Tokens

### GET /api/api-tokens

List API tokens.

**Response:**
```json
{
  "items": [
    {
      "_id": "507f1f77bcf86cd799439016",
      "name": "CI Deploy Token",
      "scopes": ["apps:read", "apps:write", "deployments:write"],
      "lastUsedAt": "2024-01-15T10:00:00.000Z",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

### GET /api/api-tokens/scopes

List available token scopes.

**Response:**
```json
{
  "scopes": [
    { "name": "apps:read", "description": "Read app information" },
    { "name": "apps:write", "description": "Create, update, delete apps" },
    { "name": "databases:read", "description": "Read database information" },
    { "name": "databases:write", "description": "Manage databases" },
    { "name": "deployments:read", "description": "Read deployment history" },
    { "name": "deployments:write", "description": "Deploy and rollback apps" },
    { "name": "settings:read", "description": "Read settings, SSH keys" },
    { "name": "settings:write", "description": "Modify settings, manage keys" },
    { "name": "*", "description": "Full access" }
  ]
}
```

### POST /api/api-tokens

Create API token. **Returns plaintext token only once.**

**Request:**
```json
{
  "name": "CI Deploy Token",
  "scopes": ["apps:read", "apps:write", "deployments:write"]
}
```

**Response:**
```json
{
  "token": "cp_abc123def456...",
  "id": "507f1f77bcf86cd799439016"
}
```

### DELETE /api/api-tokens/:id

Revoke API token.

---

## Secrets

### GET /api/secrets

List secrets (metadata only, values never returned).

**Response:**
```json
{
  "items": [
    {
      "_id": "507f1f77bcf86cd799439017",
      "key": "DATABASE_URL",
      "appId": "507f1f77bcf86cd799439011",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

### GET /api/secrets/global

List global secrets (not tied to specific app).

### POST /api/secrets

Create secret.

**Request:**
```json
{
  "key": "DATABASE_URL",
  "value": "mongodb://...",
  "appId": "507f1f77bcf86cd799439011"
}
```

### GET /api/secrets/:id

Get secret metadata.

### PATCH /api/secrets/:id

Update secret.

**Request:**
```json
{
  "value": "new-secret-value"
}
```

### DELETE /api/secrets/:id

Delete secret.

---

## Settings

### GET /api/settings

List all settings (sensitive values masked).

**Response:**
```json
{
  "settings": [
    { "key": "dns.provider", "value": "cloudflare", "updatedAt": "..." },
    { "key": "dns.cloudflare.apiToken", "value": "****", "updatedAt": "..." }
  ]
}
```

### PUT /api/settings/:key

Set a setting.

**Request:**
```json
{ "value": "new-value" }
```

### GET /api/settings/dns

Get DNS configuration.

**Response:**
```json
{
  "provider": "cloudflare",
  "apiToken": "****..****",
  "apps": {
    "configured": true,
    "zoneId": "abc123",
    "baseDomain": "apps.example.com"
  },
  "db": {
    "configured": true,
    "zoneId": "abc123",
    "baseDomain": "db.example.com"
  }
}
```

### POST /api/settings/dns/verify

Verify Cloudflare token and domain.

**Request:**
```json
{
  "apiToken": "cloudflare-api-token",
  "baseDomain": "example.com"
}
```

**Response:**
```json
{
  "valid": true,
  "zoneId": "abc123",
  "zoneName": "example.com",
  "tokenId": "token-123"
}
```

### PUT /api/settings/dns/token

Save Cloudflare API token.

### PUT /api/settings/dns/apps

Configure DNS for apps.

**Request:**
```json
{
  "baseDomain": "apps.example.com",
  "apiToken": "cloudflare-api-token"
}
```

### PUT /api/settings/dns/db

Configure DNS for databases.

### DELETE /api/settings/dns/:scope

Clear DNS config for scope (`apps` or `db`).

### GET /api/settings/k8s

Get Kubernetes configuration status.

**Response:**
```json
{
  "kubernetes": {
    "enabled": true,
    "available": true,
    "nodes": 3,
    "serverUrl": "https://192.168.1.100:6443"
  },
  "provisioner": "k8s",
  "hasK3sToken": true
}
```

### GET /api/settings/k8s/nodes

List K8s cluster nodes.

### GET /api/settings/k8s/agent-command

Get K3s agent join command.

**Response:**
```json
{
  "serverUrl": "https://192.168.1.100:6443",
  "command": "curl -sfL https://get.k3s.io | K3S_URL=... K3S_TOKEN=... sh -s - agent",
  "instructions": [...]
}
```

### GET /api/settings/k8s/operator

Get Percona MongoDB Operator status.

**Response:**
```json
{
  "installed": true,
  "version": "1.15.0",
  "namespace": "cp-databases",
  "status": "running"
}
```

### POST /api/settings/k8s/refresh-token

Refresh K3s join token.

---

## Metrics

### GET /api/metrics/system

System metrics (CPU, memory, disk).

**Response:**
```json
{
  "cpu": { "usage": 25.5, "cores": 4 },
  "memory": { "used": 2048, "total": 8192 },
  "disk": { "used": 50, "total": 200 }
}
```

### GET /api/metrics/cluster

K8s cluster resource usage.

**Response:**
```json
{
  "nodes": 3,
  "pods": { "running": 15, "total": 20 },
  "cpu": { "requests": "2000m", "limits": "4000m" },
  "memory": { "requests": "4Gi", "limits": "8Gi" }
}
```

### GET /api/metrics/databases

All databases metrics summary.

**Response:**
```json
{
  "total": 5,
  "byStatus": { "running": 4, "provisioning": 1 },
  "totalStorage": "50Gi"
}
```

### GET /api/metrics/apps

All apps metrics summary.

**Response:**
```json
{
  "total": 10,
  "byStatus": { "running": 8, "stopped": 2 },
  "totalReplicas": 25
}
```

### GET /api/metrics/overview

Combined dashboard data.

**Response:**
```json
{
  "system": { ... },
  "cluster": { ... },
  "databases": { ... },
  "apps": { ... }
}
```

---

## Audit Logs

### GET /api/audit-logs

List audit logs.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `page` | number | Page number |
| `userId` | string | Filter by user |
| `action` | string | Filter by action |
| `resource` | string | Filter by resource type |

**Response:**
```json
{
  "items": [
    {
      "_id": "507f1f77bcf86cd799439018",
      "userId": "507f1f77bcf86cd799439011",
      "action": "create",
      "resource": "app",
      "resourceId": "507f1f77bcf86cd799439012",
      "details": { "name": "my-app" },
      "ipAddress": "192.168.1.1",
      "timestamp": "2024-01-15T10:00:00.000Z"
    }
  ],
  "page": 1,
  "pages": 10,
  "total": 100
}
```

---

## Error Responses

All errors follow this format:

```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": { ... }
}
```

### HTTP Status Codes

| Code | Description |
|------|-------------|
| 400 | Bad Request — Invalid input |
| 401 | Unauthorized — Not authenticated |
| 403 | Forbidden — Insufficient permissions |
| 404 | Not Found — Resource doesn't exist |
| 409 | Conflict — Resource already exists |
| 500 | Internal Server Error |

---

## Authentication Headers

### Session Cookie

Set automatically on login. Include in subsequent requests:

```
Cookie: sid=session-id-here
```

### JWT Bearer Token

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

### API Token

```
Authorization: Bearer cp_abc123def456...
```
