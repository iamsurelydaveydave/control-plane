# MongoDB Replica Set Provisioning via Helm

This document describes how to provision production MongoDB replica sets using the Control Plane's Helm-based resource system with **DNS integration** (MongoDB Atlas-style `mongodb+srv://`) and **S3 backups**.

## Overview

The Control Plane supports two MongoDB deployment options:

| Type | Chart | Use Case |
|------|-------|----------|
| `mongodb` | `bitnami/mongodb` | Development, single-node, or basic replica set |
| `mongodb-replicaset` | `control-plane/mongodb-replicaset` | Production 3-node replica set with TLS, DNS, backups |

## Features

- **3-node replica set** with automatic failover
- **MongoDB Atlas-style DNS** (`mongodb+srv://`) via Cloudflare
- **S3 automated backups** with retention policy
- **TLS encryption** with auto-generated certificates
- **Pod Disruption Budget** for zero-downtime upgrades
- **Prometheus metrics** integration

## Quick Start

### Via API

```bash
# Create a production MongoDB replica set with DNS and backups
curl -X POST http://localhost:5005/api/addons \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "name": "prod-mongodb",
    "type": "mongodb-replicaset",
    "namespace": "databases",
    "config": {
      "replicas": 3,
      "tls": true,
      "rootPassword": "your-secure-password",
      "dns": {
        "enabled": true,
        "subdomain": "mydb"
      },
      "backup": {
        "enabled": true,
        "schedule": "0 2 * * *",
        "retention": 7,
        "s3": {
          "bucket": "my-backups",
          "region": "us-east-1",
          "accessKeyId": "AKIAXXXXXXX",
          "secretAccessKey": "xxxxx"
        }
      }
    }
  }'
```

### Via Helm CLI (Direct)

```bash
# From the control-plane repo root
cd deploy/helm

# Install with production values including DNS and backup
helm install prod-mongodb ./mongodb-replicaset \
  --namespace databases --create-namespace \
  --set mongodb.auth.rootPassword=$(openssl rand -base64 24) \
  --set mongodb.tls.enabled=true \
  --set dns.enabled=true \
  --set dns.subdomain=mydb \
  --set dns.baseDomain=db.example.com \
  --set backup.enabled=true \
  --set backup.s3.bucket=my-backups \
  --set backup.s3.accessKeyId=AKIAXXXXXXX \
  --set backup.s3.secretAccessKey=xxxxx
```

## DNS Configuration (MongoDB Atlas-style)

### Prerequisites

1. Configure Cloudflare in Control Plane settings:
   - Go to **Settings > DNS**
   - Add your Cloudflare API token
   - Set the base domain for databases (e.g., `db.example.com`)

2. Ensure your domain is in Cloudflare

### How It Works

When DNS is enabled, the Control Plane creates:

| Record Type | Name | Value |
|-------------|------|-------|
| A | `node1.mydb.db.example.com` | `<pod-ip-1>` |
| A | `node2.mydb.db.example.com` | `<pod-ip-2>` |
| A | `node3.mydb.db.example.com` | `<pod-ip-3>` |
| SRV | `_mongodb._tcp.mydb.db.example.com` | Points to all nodes |
| TXT | `mydb.db.example.com` | `authSource=admin&replicaSet=rs0&tls=true` |

This enables the `mongodb+srv://` connection string:

```
mongodb+srv://root:password@mydb.db.example.com/
```

The MongoDB driver automatically:
- Discovers all replica set members via SRV lookup
- Reads connection options from the TXT record
- Handles failover automatically

### Configure DNS via API

```bash
# Configure DNS after addon is created
curl -X POST http://localhost:5005/api/addons/<addon-id>/dns \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"subdomain": "mydb"}'

# Response
{
  "message": "DNS configured successfully.",
  "clusterHost": "mydb.db.example.com",
  "srvConnectionString": "mongodb+srv://root:****@mydb.db.example.com/?authSource=admin"
}
```

### Remove DNS

```bash
curl -X DELETE http://localhost:5005/api/addons/<addon-id>/dns \
  -H "Authorization: Bearer <token>"
```

## S3 Backup Configuration

### How It Works

Backups are performed by a Kubernetes CronJob that:
1. Runs `mongodump` against the replica set
2. Compresses the backup (gzip)
3. Uploads to S3
4. Cleans up old backups based on retention policy

### Configure Backup via API

```bash
curl -X POST http://localhost:5005/api/addons/<addon-id>/backup/config \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "schedule": "0 2 * * *",
    "retention": 7,
    "s3": {
      "bucket": "my-mongodb-backups",
      "region": "us-east-1",
      "prefix": "prod-mongodb",
      "accessKeyId": "AKIAXXXXXXX",
      "secretAccessKey": "xxxxx"
    }
  }'
```

### Trigger Manual Backup

```bash
curl -X POST http://localhost:5005/api/addons/<addon-id>/backup \
  -H "Authorization: Bearer <token>"

# Response
{
  "message": "Backup job started.",
  "jobName": "prod-mongodb-backup-manual-1703123456789"
}
```

### List Backups

```bash
curl http://localhost:5005/api/addons/<addon-id>/backups \
  -H "Authorization: Bearer <token>"

# Response
{
  "backups": [
    {
      "name": "prod-mongodb-backup-28391234",
      "status": "completed",
      "startTime": "2024-01-15T02:00:00Z",
      "completionTime": "2024-01-15T02:05:32Z"
    }
  ]
}
```

### S3-Compatible Storage (MinIO)

For self-hosted S3-compatible storage:

```bash
curl -X POST http://localhost:5005/api/addons/<addon-id>/backup/config \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "schedule": "0 2 * * *",
    "s3": {
      "bucket": "mongodb-backups",
      "endpoint": "https://minio.example.com",
      "region": "us-east-1",
      "accessKeyId": "minioadmin",
      "secretAccessKey": "minioadmin"
    }
  }'
```

## Connection Information

After deployment, get connection info:

```bash
curl http://localhost:5005/api/addons/<addon-id>/connection \
  -H "Authorization: Bearer <token>"
```

Response:
```json
{
  "connectionInfo": {
    "host": "prod-mongodb-mongodb-0.prod-mongodb-mongodb-headless.databases.svc.cluster.local",
    "port": 27017,
    "username": "root",
    "password": "actual-password",
    "connectionString": "mongodb://root:****@...:27017/?replicaSet=rs0",
    "srvConnectionString": "mongodb+srv://root:****@mydb.db.example.com/?authSource=admin",
    "dnsClusterHost": "mydb.db.example.com",
    "backupEnabled": true,
    "backupSchedule": "0 2 * * *"
  }
}
```

## Full API Reference

### Addon CRUD

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/addons` | List addons |
| POST | `/api/addons` | Create addon |
| GET | `/api/addons/:id` | Get addon |
| PATCH | `/api/addons/:id` | Update addon |
| DELETE | `/api/addons/:id` | Delete addon |

### Addon Operations

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/addons/:id/connection` | Get connection info |
| POST | `/api/addons/:id/start` | Start addon |
| POST | `/api/addons/:id/stop` | Stop addon |
| POST | `/api/addons/:id/restart` | Restart addon |
| POST | `/api/addons/:id/scale` | Scale replicas |
| GET | `/api/addons/:id/logs` | Get logs |
| GET | `/api/addons/:id/events` | Get K8s events |

### DNS Operations

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/addons/:id/dns` | Configure DNS |
| DELETE | `/api/addons/:id/dns` | Remove DNS |

### Backup Operations

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/addons/:id/backup/config` | Configure backup |
| POST | `/api/addons/:id/backup` | Trigger backup |
| GET | `/api/addons/:id/backups` | List backups |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Control Plane API                                │
│                                                                      │
│  POST /api/addons { type: "mongodb-replicaset", ... }               │
│         │                                                            │
│         ▼                                                            │
│  ┌─────────────────┐    ┌─────────────────┐    ┌───────────────┐   │
│  │  addon.service  │───▶│  helm.service   │───▶│  dns.service  │   │
│  │                 │    │                 │    │               │   │
│  └─────────────────┘    └────────┬────────┘    └───────┬───────┘   │
│                             │                        │               │
└─────────────────────────────┼────────────────────────┼───────────────┘
                              │                        │
                              ▼                        ▼
┌─────────────────────────────────────────┐   ┌─────────────────────┐
│              K3s Cluster                  │   │     Cloudflare      │
│                                           │   │                     │
│  ┌─────────────────────────────────────┐   │   │  A records (nodes)  │
│  │        Bitnami MongoDB Chart        │   │   │  SRV records        │
│  │                                     │   │   │  TXT record         │
│  │  StatefulSet (3 replicas)           │   │   └─────────────────────┘
│  │  Headless Service                   │   │
│  │  Secrets (credentials)              │   │   ┌─────────────────────┐
│  │  PDB (min 2 available)              │   │   │      S3 Bucket      │
│  │                                     │   │   │                     │
│  │  ┌───────────────────────────────┐   │   │   │  • Daily backups    │
│  │  │  CronJob: Backup to S3         │───┼───┼──▶│  • 7-day retention  │
│  │  └───────────────────────────────┘   │   │   │  • Compressed      │
│  └─────────────────────────────────────┘   │   └─────────────────────┘
│                                           │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐   │
│  │   Pod 0    │  │   Pod 1    │  │   Pod 2    │   │
│  │  Primary   │  │ Secondary  │  │ Secondary  │   │
│  │  PVC: 20Gi │  │  PVC: 20Gi │  │  PVC: 20Gi │   │
│  └────────────┘  └────────────┘  └────────────┘   │
│                                           │
└───────────────────────────────────────────┘
```

## Troubleshooting

### DNS Not Working

1. Check DNS settings are configured:
   ```bash
   curl http://localhost:5005/api/settings/dns -H "Authorization: Bearer <token>"
   ```

2. Verify Cloudflare records were created:
   ```bash
   dig SRV _mongodb._tcp.mydb.db.example.com
   dig TXT mydb.db.example.com
   ```

3. Test SRV connection:
   ```bash
   mongosh "mongodb+srv://root:password@mydb.db.example.com/"
   ```

### Backups Failing

1. Check CronJob status:
   ```bash
   kubectl get cronjob -n databases
   kubectl describe cronjob prod-mongodb-backup -n databases
   ```

2. Check backup job logs:
   ```bash
   kubectl get jobs -n databases -l app.kubernetes.io/component=backup
   kubectl logs job/<job-name> -n databases
   ```

3. Verify S3 credentials:
   ```bash
   kubectl get secret prod-mongodb-backup-s3 -n databases -o yaml
   ```

### Replica Set Not Healthy

```bash
# Check rs.status()
kubectl exec -it prod-mongodb-mongodb-0 -n databases -- mongosh --eval "rs.status()"

# Check pod events
kubectl describe pod prod-mongodb-mongodb-0 -n databases
```
