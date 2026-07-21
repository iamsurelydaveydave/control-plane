# Control Plane Overhaul Plan

> **Goal:** Transform control-plane from a Docker/SSH-based deployment tool into a Kubernetes-native PaaS (inspired by Kubero).

## Priority Targets

| Priority | Target | Why |
|----------|--------|-----|
| ⭐ **1st** | **Node Management** | Must add worker nodes before anything can run (masters are tainted) |
| ⭐ **2nd** | **MongoDB Replica Set Provisioning** | Core infrastructure need — production-grade DB for apps |
| ⭐ **3rd** | **Web App / API Deployment** | Deploy stateless apps connected to MongoDB |
| 4th | Other Addons | Redis, PostgreSQL, etc. |
| 5th | Pipeline Stages | Dev/staging/prod environments |

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture: Before & After](#2-architecture-before--after)
3. [Infrastructure Design](#3-infrastructure-design)
4. [Data Model Changes](#4-data-model-changes)
5. [API Changes](#5-api-changes)
6. [Services Changes](#6-services-changes)
7. [Dependencies](#7-dependencies)
8. [File Structure](#8-file-structure)
9. [Implementation Phases](#9-implementation-phases)
10. [Migration Checklist](#10-migration-checklist)
11. [Installation & Bootstrap](#11-installation--bootstrap)
12. [Open Questions](#12-open-questions)

---

## 1. Executive Summary

### What's Changing

| Aspect | Before (Docker/SSH) | After (Kubernetes) |
|--------|---------------------|-------------------|
| Execution model | Docker containers via SSH | K8s Deployments via API |
| Target servers | Manual VPS with SSH access | K8s worker nodes |
| Scaling | Deploy to N servers | K8s replicas + HPA |
| Networking | kamal-proxy / Caddy | K8s Ingress (Traefik) |
| Databases | Ansible + Docker containers | Helm charts / Operators |
| Control plane hosting | Docker on a VPS | K8s on 3 master nodes |
| High availability | Manual multi-node | K8s HA (3 masters + etcd) |

### Why

1. **Kubero model** — proven K8s-native PaaS architecture
2. **True scaling** — replicas, HPA, resource limits handled by K8s
3. **Self-healing** — K8s handles container restarts, node failures
4. **Pipeline stages** — dev/staging/prod as first-class concept
5. **Addons** — attach databases via Helm, not custom provisioning

---

## 2. Architecture: Before & After

### Before: Docker/SSH

```
┌─────────────────────────────────────────────────────────────────┐
│                      Control Plane                              │
│  ┌─────────┐  ┌─────────┐  ┌──────────────┐                    │
│  │   UI    │  │   API   │  │   Workers    │                    │
│  │ (Nuxt)  │  │(Express)│  │ (cron jobs)  │                    │
│  └─────────┘  └─────────┘  └──────────────┘                    │
│                    │                                            │
│              SSH / Docker                                       │
│                    │                                            │
│      ┌─────────────┼─────────────┐                             │
│      ▼             ▼             ▼                             │
│  ┌───────┐    ┌───────┐    ┌───────┐                          │
│  │Server1│    │Server2│    │Server3│   ← Manual VPS           │
│  │ Docker│    │ Docker│    │ Docker│                          │
│  └───────┘    └───────┘    └───────┘                          │
└─────────────────────────────────────────────────────────────────┘
```

### After: Kubernetes-Native

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      Control Plane Cluster (3-node HA)                          │
│                                                                                 │
│      ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐           │
│      │  Master Node 1  │   │  Master Node 2  │   │  Master Node 3  │           │
│      │                 │   │                 │   │                 │           │
│      │  k3s server     │   │  k3s server     │   │  k3s server     │           │
│      │  + etcd         │◄──►  + etcd         │◄──►  + etcd         │           │
│      │                 │   │                 │   │                 │           │
│      │  ┌───────────┐  │   │  ┌───────────┐  │   │  ┌───────────┐  │           │
│      │  │ cp-api    │  │   │  │ cp-api    │  │   │  │ cp-api    │  │           │
│      │  │ cp-web    │  │   │  │ cp-web    │  │   │  │ cp-web    │  │           │
│      │  └───────────┘  │   │  └───────────┘  │   │  └───────────┘  │           │
│      └────────┬────────┘   └────────┬────────┘   └────────┬────────┘           │
│               │                     │                     │                     │
│               └─────────────────────┼─────────────────────┘                     │
│                                     │                                           │
│                          Load Balancer / DNS                                    │
│                          cp.example.com ──► Ingress                             │
│                                     │                                           │
│                                     │ K8s API                                   │
│                                     ▼                                           │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │                           Worker Nodes                                    │  │
│  │                                                                          │  │
│  │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                  │  │
│  │   │  Worker 1    │  │  Worker 2    │  │  Worker 3    │                  │  │
│  │   │              │  │              │  │              │                  │  │
│  │   │ ┌──────────┐ │  │ ┌──────────┐ │  │ ┌──────────┐ │                  │  │
│  │   │ │ App Pods │ │  │ │ App Pods │ │  │ │ DB Pods  │ │                  │  │
│  │   │ └──────────┘ │  │ └──────────┘ │  │ │ (addons) │ │                  │  │
│  │   └──────────────┘  └──────────────┘  └──────────────┘                  │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Infrastructure Design

### Cluster Topology

| Node Type | Count | Purpose | Taints |
|-----------|-------|---------|--------|
| Master | 3 | k3s server + etcd + control-plane app | `node-role.kubernetes.io/master:NoSchedule` (user workloads) |
| Worker | N | User apps + addons | None |

### K8s Distribution: k3s

**Why k3s:**
- Single binary, easy install
- Built-in HA with embedded etcd
- Includes Traefik ingress by default
- Lightweight (runs well on 2GB RAM nodes)
- Simple agent join for workers

**Cluster setup:**
```bash
# Master 1 (init)
curl -sfL https://get.k3s.io | sh -s - server \
  --cluster-init \
  --tls-san cp.example.com \
  --disable servicelb

# Master 2 & 3 (join)
curl -sfL https://get.k3s.io | sh -s - server \
  --server https://master1:6443 \
  --token <token>

# Workers (join via control-plane UI)
curl -sfL https://get.k3s.io | sh -s - agent \
  --server https://cp.example.com:6443 \
  --token <token>
```

### Networking

| Component | Technology |
|-----------|------------|
| Ingress Controller | Traefik (k3s default) or nginx-ingress |
| TLS | cert-manager + Let's Encrypt |
| Service Mesh | None (keep simple for MVP) |
| DNS | External (Cloudflare, Route53) via API |

### Storage

| Use Case | Solution |
|----------|----------|
| Control-plane state | MongoDB Atlas (external, HA) |
| Addon databases | Local PVs or cloud block storage |
| App persistent data | PVCs with default StorageClass |

---

## 4. Data Model Changes

### Resources to DELETE

These are Docker/SSH concepts that don't exist in K8s:

| Resource | Reason |
|----------|--------|
| `Server` | K8s abstracts nodes; we don't SSH into them |
| `Instance` | K8s Pods replace container instances |
| `SshKey` | No SSH needed; K8s API for everything |

**Files to delete:**
```
src/resources/server/          # Entire directory
src/resources/instance/        # Entire directory
src/resources/ssh-key/         # Entire directory
src/services/ssh.service.ts
src/services/ansible.executor.ts
src/services/docker.executor.ts
src/services/kamal.executor.ts
src/services/kamal.generator.ts
src/services/caddy.service.ts
```

### Resources to ADD

#### Cluster

Represents the K8s cluster connection. Single-cluster for now, multi-cluster ready.

```typescript
// src/resources/cluster/cluster.model.ts

export const clusterTypes = ["local", "remote"] as const;
export type TClusterType = (typeof clusterTypes)[number];

export const clusterStatuses = ["connected", "unreachable", "unknown"] as const;
export type TClusterStatus = (typeof clusterStatuses)[number];

export type TCluster = {
  _id?: ObjectId;
  name: string;
  type: TClusterType;
  status: TClusterStatus;
  
  // Connection (remote only, encrypted)
  kubeconfig?: string;
  context?: string;
  
  // Cluster info (synced from K8s)
  version?: string;           // K8s version
  nodesCount?: number;
  
  // Timestamps
  lastSyncedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};
```

#### Node

Represents a K8s node (master or worker). Used for UI visibility and worker management.

```typescript
// src/resources/node/node.model.ts

export const nodeRoles = ["master", "worker"] as const;
export type TNodeRole = (typeof nodeRoles)[number];

export const nodeStatuses = ["pending", "joining", "ready", "not-ready", "offline"] as const;
export type TNodeStatus = (typeof nodeStatuses)[number];

export type TNode = {
  _id?: ObjectId;
  clusterId: ObjectId;
  name: string;
  role: TNodeRole;
  host: string;               // IP or hostname (for display/join)
  status: TNodeStatus;
  
  // K8s node info (synced from cluster)
  k8sName?: string;
  k8sStatus?: string;
  k8sVersion?: string;
  resources?: {
    cpuCapacity: string;
    cpuAllocatable: string;
    memoryCapacity: string;
    memoryAllocatable: string;
    podsCapacity: string;
  };
  conditions?: Array<{
    type: string;
    status: string;
    reason?: string;
    message?: string;
  }>;
  
  // Labels & taints
  labels?: Record<string, string>;
  taints?: Array<{
    key: string;
    value?: string;
    effect: string;
  }>;
  
  // Join info (for workers)
  joinToken?: string;         // Encrypted
  joinCommand?: string;
  
  // Timestamps
  joinedAt?: Date;
  lastSeenAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};
```

#### Pipeline

Logical application with multiple environment stages (Kubero concept).

```typescript
// src/resources/pipeline/pipeline.model.ts

export const pipelinePhases = ["development", "staging", "production"] as const;
export type TPipelinePhase = (typeof pipelinePhases)[number];

export type TPipelineStage = {
  phase: TPipelinePhase;
  enabled: boolean;
  namespace: string;          // Auto: {pipeline}-{phase}
  
  // Stage-specific config
  replicas: number;
  image?: string;             // Override (for tagged releases)
  env: Record<string, string>;
  
  // Resources
  resources?: {
    requests?: { cpu?: string; memory?: string };
    limits?: { cpu?: string; memory?: string };
  };
  
  // Deployment settings
  autoDeploy: boolean;        // Deploy on image push
  
  // Routing
  domain?: string;            // Stage-specific domain
  
  // State (synced from K8s)
  status: "pending" | "deploying" | "running" | "failed" | "stopped";
  availableReplicas?: number;
  deployedImage?: string;
  deployedAt?: Date;
};

export type TPipeline = {
  _id?: ObjectId;
  clusterId: ObjectId;
  name: string;               // e.g., "goweekdays-api"
  
  // Source
  image: string;              // Base image (e.g., "ghcr.io/org/app")
  
  // Git (optional, for builds)
  gitUrl?: string;
  gitBranch?: string;
  dockerfile?: string;
  buildContext?: string;
  
  // Registry auth (if private)
  registryId?: ObjectId;
  
  // Container config (defaults for all stages)
  port: number;
  healthCheck?: {
    path: string;
    port?: number;
    initialDelaySeconds?: number;
    periodSeconds?: number;
  };
  
  // Environment (inherited by all stages)
  env: Record<string, string>;
  secretNames: string[];      // Secrets to mount
  
  // Attached addons
  addonIds: ObjectId[];
  
  // Stages
  stages: TPipelineStage[];
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
};
```

#### MongoCluster (NEW - Primary Target)

Production-grade MongoDB replica sets via the MongoDB Community Operator.

```typescript
// src/resources/mongo-cluster/mongo-cluster.model.ts

export const mongoClusterStatuses = [
  "pending",
  "provisioning",
  "ready",
  "degraded",
  "failed",
  "deleting",
] as const;
export type TMongoClusterStatus = (typeof mongoClusterStatuses)[number];

export type TMongoUser = {
  username: string;
  password?: string;              // Encrypted, auto-generated if not provided
  database: string;               // e.g., "goweekdays"
  roles: string[];                // e.g., ["readWrite", "dbAdmin"]
};

export type TMongoCluster = {
  _id?: ObjectId;
  clusterId: ObjectId;            // K8s cluster reference
  name: string;                   // e.g., "goweekdays-prod"
  namespace: string;              // e.g., "databases"
  
  // Replica set configuration
  members: number;                // 3 for HA (primary + 2 secondaries)
  version: string;                // MongoDB version, e.g., "7.0.12"
  
  // Resources per member
  resources: {
    cpu: string;                  // e.g., "500m", "2"
    memory: string;               // e.g., "1Gi", "4Gi"
    storage: string;              // e.g., "10Gi", "100Gi"
    storageClass?: string;        // e.g., "hcloud-volumes", "do-block-storage"
  };
  
  // Authentication
  auth: {
    enabled: boolean;
    rootUsername: string;         // Usually "admin"
    rootPassword?: string;        // Encrypted, auto-generated
  };
  
  // TLS configuration
  tls: {
    enabled: boolean;
    certManagerIssuer?: string;   // e.g., "letsencrypt-prod"
  };
  
  // Application users
  users: TMongoUser[];
  
  // Connection info (populated when ready)
  connection?: {
    replicaSetName: string;
    hosts: string[];              // Individual member hosts
    connectionString: string;     // mongodb://user:pass@host1,host2,host3/db?replicaSet=rs
    internalUri: string;          // For apps in same cluster
    externalUri?: string;         // If exposed via LoadBalancer/NodePort
  };
  
  // K8s resources created
  k8s?: {
    customResource: string;       // MongoDBCommunity CR name
    statefulSet: string;
    service: string;
    headlessService: string;
    secrets: string[];            // Credential secrets
  };
  
  // Status (synced from operator)
  status: TMongoClusterStatus;
  phase?: string;                 // Operator phase (Running, Pending, etc.)
  message?: string;               // Status message
  membersStatus?: Array<{
    name: string;                 // Pod name
    state: string;                // PRIMARY, SECONDARY, ARBITER, RECOVERING
    health: boolean;
    uptime?: number;
  }>;
  
  // Timestamps
  provisionedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};
```


```typescript
// src/resources/addon/addon.model.ts

export const addonTypes = [
  "postgresql",
  "mysql", 
  "mongodb",
  "redis",
  "rabbitmq",
  "elasticsearch",
] as const;
export type TAddonType = (typeof addonTypes)[number];

export const addonStatuses = [
  "pending",
  "provisioning", 
  "ready",
  "failed",
  "deleting",
] as const;
export type TAddonStatus = (typeof addonStatuses)[number];

export type TAddon = {
  _id?: ObjectId;
  clusterId: ObjectId;
  name: string;
  type: TAddonType;
  namespace: string;
  
  // Helm release
  helmRelease: string;
  helmChart: string;          // e.g., "bitnami/postgresql"
  helmVersion?: string;       // Chart version
  helmValues: Record<string, any>;
  
  // Connection info (populated after provisioning)
  connection?: {
    host: string;
    port: number;
    database?: string;
    username?: string;
    password?: string;        // Encrypted
    connectionString?: string;
  };
  
  // K8s resources created
  k8sResources?: {
    statefulSet?: string;
    service?: string;
    secret?: string;
    pvc?: string;
  };
  
  // Status
  status: TAddonStatus;
  statusMessage?: string;
  
  // Timestamps
  provisionedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};
```

### Resources to REFACTOR

#### App → Simplified (Stage Instance)

The `App` resource becomes a lightweight record of a deployed stage, not the full config.

```typescript
// src/resources/app/app.model.ts (refactored)

export const appStatuses = [
  "pending",
  "deploying",
  "running",
  "failed",
  "stopped",
] as const;
export type TAppStatus = (typeof appStatuses)[number];

export type TApp = {
  _id?: ObjectId;
  pipelineId: ObjectId;
  phase: TPipelinePhase;      // "development" | "staging" | "production"
  
  // K8s references
  namespace: string;
  deploymentName: string;
  serviceName: string;
  ingressName?: string;
  
  // Current state (synced from K8s)
  status: TAppStatus;
  replicas: number;
  availableReplicas: number;
  image: string;
  
  // Routing
  domain?: string;
  internalUrl: string;        // service.namespace.svc.cluster.local
  
  // Timestamps
  deployedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};
```

#### Deployment (Audit Record)

Keep as audit trail, add K8s-specific fields.

```typescript
// src/resources/deployment/deployment.model.ts (refactored)

export const deploymentTriggers = [
  "manual",
  "git-push",
  "promote",
  "rollback",
  "webhook",
] as const;
export type TDeploymentTrigger = (typeof deploymentTriggers)[number];

export const deploymentStatuses = [
  "pending",
  "running",
  "success",
  "failed",
  "cancelled",
] as const;
export type TDeploymentStatus = (typeof deploymentStatuses)[number];

export type TDeployment = {
  _id?: ObjectId;
  pipelineId: ObjectId;
  phase: TPipelinePhase;
  
  // What was deployed
  image: string;
  replicas: number;
  
  // Who/what triggered it
  trigger: TDeploymentTrigger;
  triggeredBy?: ObjectId;     // User ID (if manual)
  promotedFrom?: TPipelinePhase; // If trigger=promote
  
  // K8s deployment tracking
  k8sDeploymentName?: string;
  k8sRevision?: number;
  
  // Status & logs
  status: TDeploymentStatus;
  logs: string;
  errorMessage?: string;
  
  // Timestamps
  startedAt: Date;
  completedAt?: Date;
};
```

#### Database → Deprecated

The `Database` resource is replaced by `Addon`. Keep for backward compatibility during migration, then remove.

```typescript
// Mark as @deprecated, will be removed
// Use Addon with type: "postgresql" | "mongodb" | etc.
```

---

## 5. API Changes

### Endpoints to DELETE

```
DELETE /api/servers/*           # No more server management
DELETE /api/ssh-keys/*          # No SSH keys
DELETE /api/instances/*         # K8s pods replace this
```

### Endpoints to ADD

#### Cluster

```
GET    /api/clusters                    # List clusters (single for now)
GET    /api/clusters/:id                # Get cluster details
GET    /api/clusters/:id/nodes          # List nodes in cluster
POST   /api/clusters/:id/sync           # Sync state from K8s
```

#### Node

```
GET    /api/nodes                       # List all nodes
GET    /api/nodes/:id                   # Get node details
POST   /api/nodes/join-token            # Generate worker join token
DELETE /api/nodes/:id                   # Remove node (drain + delete)
POST   /api/nodes/:id/cordon            # Mark unschedulable
POST   /api/nodes/:id/uncordon          # Mark schedulable
POST   /api/nodes/:id/drain             # Drain workloads
```

#### Pipeline

```
GET    /api/pipelines                   # List pipelines
POST   /api/pipelines                   # Create pipeline
GET    /api/pipelines/:id               # Get pipeline + stages
PUT    /api/pipelines/:id               # Update pipeline config
DELETE /api/pipelines/:id               # Delete pipeline (all stages)

# Stage operations
POST   /api/pipelines/:id/stages/:phase/deploy    # Deploy to stage
POST   /api/pipelines/:id/stages/:phase/promote   # Promote to next stage
POST   /api/pipelines/:id/stages/:phase/rollback  # Rollback stage
POST   /api/pipelines/:id/stages/:phase/restart   # Restart pods
POST   /api/pipelines/:id/stages/:phase/stop      # Scale to 0
POST   /api/pipelines/:id/stages/:phase/scale     # Set replicas
GET    /api/pipelines/:id/stages/:phase/logs      # Stream pod logs
GET    /api/pipelines/:id/stages/:phase/pods      # List pods
POST   /api/pipelines/:id/stages/:phase/exec      # Exec into pod
```

#### Addon

```
GET    /api/addons                      # List addons
GET    /api/addons/catalog              # Available addon types + charts
POST   /api/addons                      # Provision addon
GET    /api/addons/:id                  # Get addon details
DELETE /api/addons/:id                  # Delete addon
POST   /api/addons/:id/attach/:pipelineId   # Attach to pipeline
DELETE /api/addons/:id/detach/:pipelineId   # Detach from pipeline
```

### Endpoints to REFACTOR

#### App

```
# Simplified — app is now a view of a pipeline stage
GET    /api/apps                        # List all deployed apps (across pipelines)
GET    /api/apps/:id                    # Get app details
GET    /api/apps/:id/logs               # Stream logs
GET    /api/apps/:id/pods               # List pods
POST   /api/apps/:id/exec               # Exec into pod
```

#### Deployment

```
GET    /api/deployments                 # List deployment history
GET    /api/deployments/:id             # Get deployment details + logs
POST   /api/deployments/:id/cancel      # Cancel in-progress deployment
```

---

## 6. Services Changes

### Services to DELETE

| Service | Reason |
|---------|--------|
| `ssh.service.ts` | No SSH in K8s model |
| `ansible.executor.ts` | No Ansible; use Helm |
| `docker.executor.ts` | No direct Docker; K8s API |
| `kamal.executor.ts` | No Kamal; K8s Deployments |
| `kamal.generator.ts` | No Kamal config generation |
| `caddy.service.ts` | No Caddy; K8s Ingress |
| `mongodb.provisioner.ts` | Replaced by Addon + Helm |

### Services to ADD

#### kubernetes.service.ts

Core K8s client wrapper.

```typescript
// src/services/kubernetes.service.ts

import * as k8s from "@kubernetes/client-node";

export class KubernetesService {
  private kc: k8s.KubeConfig;
  private coreApi: k8s.CoreV1Api;
  private appsApi: k8s.AppsV1Api;
  private networkingApi: k8s.NetworkingV1Api;
  private batchApi: k8s.BatchV1Api;

  constructor(cluster: TCluster) {
    this.kc = new k8s.KubeConfig();
    if (cluster.type === "local") {
      this.kc.loadFromCluster(); // In-cluster service account
    } else {
      this.kc.loadFromString(cluster.kubeconfig!);
    }
    this.coreApi = this.kc.makeApiClient(k8s.CoreV1Api);
    this.appsApi = this.kc.makeApiClient(k8s.AppsV1Api);
    this.networkingApi = this.kc.makeApiClient(k8s.NetworkingV1Api);
  }

  // Namespace
  async createNamespace(name: string): Promise<void>;
  async deleteNamespace(name: string): Promise<void>;
  
  // Deployment
  async createDeployment(namespace: string, spec: k8s.V1Deployment): Promise<void>;
  async updateDeployment(namespace: string, name: string, spec: k8s.V1Deployment): Promise<void>;
  async deleteDeployment(namespace: string, name: string): Promise<void>;
  async getDeployment(namespace: string, name: string): Promise<k8s.V1Deployment>;
  async scaleDeployment(namespace: string, name: string, replicas: number): Promise<void>;
  async restartDeployment(namespace: string, name: string): Promise<void>;
  
  // Service
  async createService(namespace: string, spec: k8s.V1Service): Promise<void>;
  async deleteService(namespace: string, name: string): Promise<void>;
  
  // Ingress
  async createIngress(namespace: string, spec: k8s.V1Ingress): Promise<void>;
  async updateIngress(namespace: string, name: string, spec: k8s.V1Ingress): Promise<void>;
  async deleteIngress(namespace: string, name: string): Promise<void>;
  
  // Secrets
  async createSecret(namespace: string, name: string, data: Record<string, string>): Promise<void>;
  async updateSecret(namespace: string, name: string, data: Record<string, string>): Promise<void>;
  async deleteSecret(namespace: string, name: string): Promise<void>;
  
  // Pods
  async listPods(namespace: string, labelSelector?: string): Promise<k8s.V1Pod[]>;
  async getPodLogs(namespace: string, podName: string, container?: string): Promise<string>;
  async execIntoPod(namespace: string, podName: string, command: string[]): Promise<string>;
  async deletePod(namespace: string, podName: string): Promise<void>;
  
  // Nodes
  async listNodes(): Promise<k8s.V1Node[]>;
  async getNode(name: string): Promise<k8s.V1Node>;
  async cordonNode(name: string): Promise<void>;
  async uncordonNode(name: string): Promise<void>;
  async drainNode(name: string): Promise<void>;
  async deleteNode(name: string): Promise<void>;
}
```

#### helm.service.ts

Helm chart management for addons.

```typescript
// src/services/helm.service.ts

export class HelmService {
  constructor(private k8s: KubernetesService) {}

  async addRepo(name: string, url: string): Promise<void>;
  async updateRepos(): Promise<void>;
  
  async install(
    releaseName: string,
    chart: string,
    namespace: string,
    values: Record<string, any>,
    version?: string
  ): Promise<HelmRelease>;
  
  async upgrade(
    releaseName: string,
    chart: string,
    namespace: string,
    values: Record<string, any>,
    version?: string
  ): Promise<HelmRelease>;
  
  async uninstall(releaseName: string, namespace: string): Promise<void>;
  
  async getRelease(releaseName: string, namespace: string): Promise<HelmRelease>;
  async listReleases(namespace?: string): Promise<HelmRelease[]>;
}
```

#### pipeline.service.ts

Pipeline deployment orchestration.

```typescript
// src/services/pipeline.service.ts

export class PipelineService {
  constructor(
    private k8s: KubernetesService,
    private pipelineRepo: PipelineRepository,
    private deploymentRepo: DeploymentRepository
  ) {}

  async deploy(pipelineId: ObjectId, phase: TPipelinePhase, options?: {
    image?: string;
    triggeredBy?: ObjectId;
    trigger?: TDeploymentTrigger;
  }): Promise<TDeployment>;
  
  async promote(
    pipelineId: ObjectId,
    fromPhase: TPipelinePhase,
    toPhase: TPipelinePhase,
    triggeredBy: ObjectId
  ): Promise<TDeployment>;
  
  async rollback(
    pipelineId: ObjectId,
    phase: TPipelinePhase,
    toDeploymentId: ObjectId,
    triggeredBy: ObjectId
  ): Promise<TDeployment>;
  
  async scale(pipelineId: ObjectId, phase: TPipelinePhase, replicas: number): Promise<void>;
  async restart(pipelineId: ObjectId, phase: TPipelinePhase): Promise<void>;
  async stop(pipelineId: ObjectId, phase: TPipelinePhase): Promise<void>;
  
  async getLogs(pipelineId: ObjectId, phase: TPipelinePhase): Promise<AsyncIterable<string>>;
  async exec(pipelineId: ObjectId, phase: TPipelinePhase, command: string[]): Promise<string>;
}
```

#### addon.service.ts

Addon provisioning via Helm.

```typescript
// src/services/addon.service.ts

export const ADDON_CATALOG: Record<TAddonType, AddonCatalogEntry> = {
  postgresql: {
    name: "PostgreSQL",
    chart: "bitnami/postgresql",
    defaultVersion: "15.x",
    defaultValues: { auth: { postgresPassword: "GENERATED" } },
  },
  redis: {
    name: "Redis",
    chart: "bitnami/redis",
    defaultVersion: "7.x",
    defaultValues: { auth: { enabled: true, password: "GENERATED" } },
  },
  mongodb: {
    name: "MongoDB",
    chart: "bitnami/mongodb",
    defaultVersion: "7.x",
    defaultValues: { auth: { rootPassword: "GENERATED" } },
  },
  mysql: {
    name: "MySQL",
    chart: "bitnami/mysql",
    defaultVersion: "8.x",
    defaultValues: { auth: { rootPassword: "GENERATED" } },
  },
  // ...
};

export class AddonService {
  constructor(
    private helm: HelmService,
    private addonRepo: AddonRepository
  ) {}

  async provision(addon: TAddonInput): Promise<TAddon>;
  async delete(addonId: ObjectId): Promise<void>;
  async getConnectionInfo(addonId: ObjectId): Promise<AddonConnection>;
  
  async attachToPipeline(addonId: ObjectId, pipelineId: ObjectId): Promise<void>;
  async detachFromPipeline(addonId: ObjectId, pipelineId: ObjectId): Promise<void>;
}
```

### Services to KEEP (refactor)

| Service | Changes |
|---------|---------|
| `k8s.service.ts` | Expand to full K8s client (currently minimal) |
| `dns.service.ts` | Keep for external DNS management |

---

## 7. Dependencies

### To ADD

```json
{
  "dependencies": {
    "@kubernetes/client-node": "^0.21.0",
    "js-yaml": "^4.1.0"
  }
}
```

### To REMOVE

```json
{
  "dependencies": {
    "ssh2": "^1.16.0"  // No more SSH
  },
  "devDependencies": {
    "@types/ssh2": "^1.15.5"
  }
}
```

**Note:** Helm operations can be done via:
1. **Shell exec** — call `helm` CLI (simpler, requires helm installed)
2. **Helm SDK** — use `@helm-ts/core` or similar (no CLI dependency)

Recommend option 1 for MVP (shell exec), option 2 for production.

---

## 8. File Structure

### After Overhaul

```
src/
├── resources/
│   ├── index.ts
│   │
│   ├── cluster/                 # NEW
│   │   ├── index.ts
│   │   ├── cluster.model.ts
│   │   ├── cluster.repository.ts
│   │   ├── cluster.service.ts
│   │   └── cluster.controller.ts
│   │
│   ├── node/                    # NEW ⭐ PRIMARY TARGET
│   │   ├── index.ts
│   │   ├── node.model.ts
│   │   ├── node.repository.ts
│   │   ├── node.service.ts
│   │   └── node.controller.ts
│   │
│   ├── mongo-cluster/           # NEW ⭐ SECONDARY TARGET
│   │   ├── index.ts
│   │   ├── mongo-cluster.model.ts
│   │   ├── mongo-cluster.repository.ts
│   │   ├── mongo-cluster.service.ts
│   │   └── mongo-cluster.controller.ts
│   │
│   ├── app/                     # REFACTOR ⭐ TERTIARY TARGET
│   │   ├── index.ts
│   │   ├── app.model.ts         # Simplified for K8s
│   │   ├── app.repository.ts
│   │   ├── app.service.ts       # K8s deployment logic
│   │   └── app.controller.ts
│   │
│   ├── deployment/              # REFACTOR
│   │   ├── index.ts
│   │   ├── deployment.model.ts
│   │   ├── deployment.repository.ts
│   │   └── deployment.controller.ts
│   │
│   ├── registry/                # NEW (for private image registries)
│   │   ├── index.ts
│   │   ├── registry.model.ts
│   │   ├── registry.repository.ts
│   │   ├── registry.service.ts
│   │   └── registry.controller.ts
│   │
│   ├── addon/                   # LATER (other databases, Redis, etc.)
│   │   └── ...
│   │
│   ├── pipeline/                # LATER (dev/staging/prod stages)
│   │   └── ...
│   │
│   ├── auth/                    # KEEP
│   ├── user/                    # KEEP
│   ├── settings/                # KEEP
│   ├── api-token/               # KEEP
│   ├── audit-log/               # KEEP
│   └── secret/                  # KEEP
│
├── services/
│   ├── index.ts
│   ├── kubernetes.service.ts    # NEW (core K8s client)
│   ├── mongo-operator.service.ts # NEW (MongoDB operator interaction)
│   ├── helm.service.ts          # NEW (Helm operations, for later)
│   ├── dns.service.ts           # KEEP
│   └── k8s.service.ts           # DELETE (replaced by kubernetes.service.ts)
│
├── workers/                     # NEW (background jobs)
│   ├── index.ts
│   ├── sync.worker.ts           # Sync K8s state to DB
│   └── mongo-sync.worker.ts     # Sync MongoDB cluster status
│
├── routes/
│   └── index.ts
│
├── utils/
│   └── ...
│
├── app.ts
├── config.ts
├── setup.ts
└── server.ts

# DELETED directories:
# src/resources/server/
# src/resources/instance/
# src/resources/ssh-key/
# src/resources/database/       # Replaced by mongo-cluster + addon
```

---

## 9. Implementation Phases

> **Priority Order:**
> 1. Node Management (must add workers before anything can run)
> 2. MongoDB replica set provisioning
> 3. Web app / RESTful API deployment
> 4. Everything else (registry, addons catalog, etc.)

---

### Phase 1: Foundation (Week 1)

**Goal:** Core K8s integration, clean slate

- [ ] Delete Docker/SSH resources and services
- [ ] Add `@kubernetes/client-node` dependency
- [ ] Create `KubernetesService` with basic operations
- [ ] Create `Cluster` resource (local cluster only)
- [ ] Test: can connect to K8s API, list namespaces

**Deliverable:** Clean codebase with working K8s client

---

### Phase 2: Node Management (Week 1-2) ⭐ PRIMARY

**Goal:** Add/remove worker nodes via UI

> ⚠️ **Why first:** Masters are tainted (`node-role.kubernetes.io/master:NoSchedule`). 
> No user workloads (MongoDB, apps) can run until we add worker nodes.

#### Node Model

```typescript
// src/resources/node/node.model.ts

export const nodeRoles = ["master", "worker"] as const;
export type TNodeRole = (typeof nodeRoles)[number];

export const nodeStatuses = [
  "pending",      // Created in DB, not yet joined
  "joining",      // Join command executed, waiting for Ready
  "ready",        // K8s node is Ready
  "not-ready",    // K8s node exists but not Ready
  "offline",      // Node unreachable
  "draining",     // Being drained before removal
  "deleting",     // Being removed from cluster
] as const;
export type TNodeStatus = (typeof nodeStatuses)[number];

export type TNode = {
  _id?: ObjectId;
  clusterId: ObjectId;
  name: string;                   // Display name, e.g., "worker-1"
  role: TNodeRole;
  host: string;                   // IP address or hostname
  
  // K8s node info (synced from cluster)
  k8sName?: string;               // Actual K8s node name
  k8sStatus?: string;             // Ready, NotReady, Unknown
  k8sVersion?: string;            // kubelet version
  
  // Resources (synced from K8s)
  resources?: {
    cpuCapacity: string;          // e.g., "4"
    cpuAllocatable: string;       // e.g., "3800m"
    memoryCapacity: string;       // e.g., "8Gi"
    memoryAllocatable: string;    // e.g., "7Gi"
    podsCapacity: string;         // e.g., "110"
    podsRunning?: number;         // Current pod count
  };
  
  // Conditions (synced from K8s)
  conditions?: Array<{
    type: string;                 // Ready, MemoryPressure, DiskPressure, etc.
    status: string;               // True, False, Unknown
    reason?: string;
    message?: string;
    lastTransitionTime?: Date;
  }>;
  
  // Labels & taints
  labels?: Record<string, string>;
  taints?: Array<{
    key: string;
    value?: string;
    effect: string;               // NoSchedule, PreferNoSchedule, NoExecute
  }>;
  
  // Join info (for workers)
  joinToken?: string;             // k3s token (encrypted)
  joinCommand?: string;           // Full command for copy/paste
  
  // Status
  status: TNodeStatus;
  statusMessage?: string;
  
  // Timestamps
  joinedAt?: Date;
  lastSeenAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};
```

#### Node Service

```typescript
// src/resources/node/node.service.ts

export class NodeService {
  constructor(
    private k8s: KubernetesService,
    private nodeRepo: NodeRepository,
    private clusterRepo: ClusterRepository
  ) {}

  // List all nodes (synced from K8s)
  async list(clusterId: ObjectId): Promise<TNode[]>;
  
  // Get single node
  async get(id: ObjectId): Promise<TNode>;
  
  // Generate join command for new worker
  async generateJoinToken(clusterId: ObjectId, nodeName: string): Promise<{
    node: TNode;
    joinCommand: string;
  }>;
  
  // Sync node status from K8s
  async syncStatus(id: ObjectId): Promise<TNode>;
  
  // Sync all nodes from K8s (discovery)
  async syncAllNodes(clusterId: ObjectId): Promise<TNode[]>;
  
  // Mark node as unschedulable
  async cordon(id: ObjectId): Promise<void>;
  
  // Mark node as schedulable
  async uncordon(id: ObjectId): Promise<void>;
  
  // Drain workloads from node
  async drain(id: ObjectId, options?: {
    gracePeriodSeconds?: number;
    ignoreDaemonSets?: boolean;
    deleteEmptyDirData?: boolean;
  }): Promise<void>;
  
  // Remove node from cluster
  async remove(id: ObjectId): Promise<void>;
  
  // Add/remove labels
  async addLabel(id: ObjectId, key: string, value: string): Promise<void>;
  async removeLabel(id: ObjectId, key: string): Promise<void>;
  
  // Add/remove taints
  async addTaint(id: ObjectId, taint: { key: string; value?: string; effect: string }): Promise<void>;
  async removeTaint(id: ObjectId, key: string): Promise<void>;
}
```

#### Join Token Generation (k3s)

```typescript
// How join token works with k3s:

// 1. Get the k3s server token (stored during cluster init)
const serverToken = await this.getK3sToken(); // from /var/lib/rancher/k3s/server/token or stored in DB

// 2. Get the API server URL
const serverUrl = cluster.apiServerUrl; // e.g., "https://cp.example.com:6443"

// 3. Generate join command
const joinCommand = `curl -sfL https://get.k3s.io | K3S_URL="${serverUrl}" K3S_TOKEN="${serverToken}" sh -s - agent`;

// 4. Store in node record
await this.nodeRepo.update(node._id, {
  joinToken: encrypt(serverToken),
  joinCommand,
  status: "pending",
});

// 5. User runs command on their VM
// 6. Background worker detects new node via K8s API, updates status to "ready"
```

#### API Endpoints

```
GET    /api/nodes                       # List all nodes
GET    /api/nodes/:id                   # Get node details
POST   /api/nodes/join-token            # Generate worker join command
POST   /api/nodes/:id/sync              # Force status sync
POST   /api/nodes/:id/cordon            # Mark unschedulable
POST   /api/nodes/:id/uncordon          # Mark schedulable
POST   /api/nodes/:id/drain             # Drain workloads
DELETE /api/nodes/:id                   # Remove from cluster
POST   /api/nodes/:id/labels            # Add label
DELETE /api/nodes/:id/labels/:key       # Remove label
POST   /api/nodes/:id/taints            # Add taint
DELETE /api/nodes/:id/taints/:key       # Remove taint
```

#### Background Worker

```typescript
// src/workers/node-sync.worker.ts

// Runs every 30 seconds:
// 1. List nodes from K8s API
// 2. For each K8s node:
//    - If exists in DB: update status, resources, conditions
//    - If not in DB (new node joined): create record
// 3. For each DB node not in K8s:
//    - If status was "pending": keep (waiting to join)
//    - If status was "ready": mark as "offline"
```

**Deliverable:** Can generate join command, add worker nodes, see them in dashboard

---

### Phase 3: MongoDB Replica Set (Week 2-3) ⭐ SECONDARY

**Goal:** Provision production-grade MongoDB replica sets on K8s

> ⚠️ **Prerequisite:** At least one worker node must be ready (from Phase 2)

#### Approach: MongoDB Community Operator

Why operator over Helm chart:
- Proper replica set initialization (not just 3 standalone instances)
- Automatic failover handling
- Rolling upgrades
- Built-in TLS support
- Backup integration ready

#### Implementation

- [ ] Install MongoDB Community Operator in cluster (one-time setup)
- [ ] Create `MongoCluster` resource model:

```typescript
export type TMongoCluster = {
  _id?: ObjectId;
  clusterId: ObjectId;
  name: string;                    // e.g., "goweekdays-prod"
  namespace: string;               // e.g., "databases"
  
  // Replica set config
  members: number;                 // 3 for HA (primary + 2 secondaries)
  version: string;                 // e.g., "7.0.12"
  
  // Resources per member
  resources: {
    cpu: string;                   // e.g., "500m", "2"
    memory: string;                // e.g., "1Gi", "4Gi"
    storage: string;               // e.g., "10Gi", "100Gi"
    storageClass?: string;         // e.g., "hcloud-volumes"
  };
  
  // Authentication
  auth: {
    enabled: boolean;
    rootUsername: string;
    rootPassword?: string;         // Encrypted, auto-generated
  };
  
  // TLS
  tls: {
    enabled: boolean;
    certManagerIssuer?: string;    // e.g., "letsencrypt-prod"
  };
  
  // Users (application access)
  users: Array<{
    username: string;
    password?: string;             // Encrypted
    database: string;              // e.g., "goweekdays"
    roles: string[];               // e.g., ["readWrite", "dbAdmin"]
  }>;
  
  // Connection info (populated after ready)
  connection?: {
    replicaSetName: string;        // e.g., "goweekdays-prod"
    hosts: string[];               // e.g., ["goweekdays-prod-0.goweekdays-prod-svc:27017", ...]
    connectionString: string;      // Full URI with auth
    internalConnectionString: string;  // For apps in same cluster
    externalConnectionString?: string; // If exposed externally
  };
  
  // Status (synced from operator)
  status: "pending" | "provisioning" | "ready" | "degraded" | "failed";
  phase?: string;                  // Operator phase
  members_status?: Array<{
    name: string;
    state: string;                 // "PRIMARY", "SECONDARY", "ARBITER"
    health: boolean;
  }>;
  
  // Timestamps
  provisionedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};
```

- [ ] Create `MongoClusterService`:

```typescript
export class MongoClusterService {
  // Provision new replica set
  async create(input: TMongoClusterInput): Promise<TMongoCluster>;
  
  // Creates MongoDBCommunity CR:
  // - Namespace (if not exists)
  // - Secret for credentials
  // - MongoDBCommunity custom resource
  // - Waits for operator to reconcile
  
  // Scale replica set
  async scale(id: ObjectId, members: number): Promise<void>;
  
  // Add database user
  async addUser(id: ObjectId, user: TMongoUser): Promise<void>;
  
  // Remove database user
  async removeUser(id: ObjectId, username: string): Promise<void>;
  
  // Get connection string for app
  async getConnectionString(id: ObjectId, username?: string): Promise<string>;
  
  // Delete replica set
  async delete(id: ObjectId): Promise<void>;
  
  // Sync status from K8s
  async syncStatus(id: ObjectId): Promise<void>;
}
```

- [ ] Create API endpoints:

```
POST   /api/mongo-clusters              # Provision new replica set
GET    /api/mongo-clusters              # List all
GET    /api/mongo-clusters/:id          # Get details + status
PUT    /api/mongo-clusters/:id          # Update config
DELETE /api/mongo-clusters/:id          # Delete replica set
POST   /api/mongo-clusters/:id/users    # Add user
DELETE /api/mongo-clusters/:id/users/:username  # Remove user
GET    /api/mongo-clusters/:id/connection-string  # Get connection URI
POST   /api/mongo-clusters/:id/sync     # Force status sync
```

- [ ] Background worker: sync MongoDB status every 30s
- [ ] Test: provision 3-node replica set, connect from app

#### MongoDB Community Operator Setup

```bash
# Install operator (one-time, part of cluster bootstrap)
helm repo add mongodb https://mongodb.github.io/helm-charts
helm install mongodb-operator mongodb/community-operator \
  --namespace mongodb-operator --create-namespace
```

#### Example MongoDBCommunity CR (what we generate)

```yaml
apiVersion: mongodbcommunity.mongodb.com/v1
kind: MongoDBCommunity
metadata:
  name: goweekdays-prod
  namespace: databases
spec:
  members: 3
  type: ReplicaSet
  version: "7.0.12"
  
  security:
    authentication:
      modes: ["SCRAM"]
  
  users:
    - name: admin
      db: admin
      passwordSecretRef:
        name: goweekdays-prod-admin-password
      roles:
        - name: root
          db: admin
    - name: goweekdays-api
      db: goweekdays
      passwordSecretRef:
        name: goweekdays-prod-api-password
      roles:
        - name: readWrite
          db: goweekdays
  
  statefulSet:
    spec:
      template:
        spec:
          containers:
            - name: mongod
              resources:
                limits:
                  cpu: "2"
                  memory: 4Gi
                requests:
                  cpu: "500m"
                  memory: 1Gi
      volumeClaimTemplates:
        - metadata:
            name: data-volume
          spec:
            accessModes: ["ReadWriteOnce"]
            resources:
              requests:
                storage: 50Gi
            storageClass: hcloud-volumes
```

**Deliverable:** Can provision MongoDB replica sets via API, get connection strings

---

### Phase 4: App Deployment (Week 3-4) ⭐ TERTIARY

**Goal:** Deploy web apps and RESTful APIs to K8s

> ⚠️ **Prerequisite:** MongoDB cluster ready (from Phase 3) for apps that need a database

#### Simplified Model (No Pipeline Stages for MVP)

For MVP, skip the full pipeline concept. Just deploy apps directly:

```typescript
export type TApp = {
  _id?: ObjectId;
  clusterId: ObjectId;
  name: string;                    // e.g., "goweekdays-api"
  namespace: string;               // e.g., "goweekdays-prod"
  
  // Source
  image: string;                   // e.g., "ghcr.io/org/goweekdays-api:latest"
  
  // Registry auth (if private)
  imagePullSecret?: string;        // K8s secret name
  registryId?: ObjectId;           // Reference to registry credentials
  
  // Replicas
  replicas: number;
  
  // Container config
  port: number;                    // e.g., 3000
  command?: string[];
  args?: string[];
  
  // Environment
  env: Record<string, string>;     // Plain env vars
  envFrom?: Array<{                // From secrets/configmaps
    secretRef?: string;
    configMapRef?: string;
  }>;
  
  // Resources
  resources?: {
    requests?: { cpu?: string; memory?: string };
    limits?: { cpu?: string; memory?: string };
  };
  
  // Health checks
  healthCheck?: {
    path: string;                  // e.g., "/health"
    port?: number;
    initialDelaySeconds?: number;
    periodSeconds?: number;
  };
  
  // Ingress (optional)
  ingress?: {
    enabled: boolean;
    host: string;                  // e.g., "api.goweekdays.com"
    path?: string;                 // e.g., "/" or "/api"
    tls: boolean;                  // Use cert-manager
    annotations?: Record<string, string>;
  };
  
  // Linked resources
  mongoClusterId?: ObjectId;       // Auto-inject MONGODB_URI
  
  // K8s resource names (generated)
  k8s?: {
    deployment: string;
    service: string;
    ingress?: string;
    namespace: string;
  };
  
  // Status (synced from K8s)
  status: "pending" | "deploying" | "running" | "failed" | "stopped";
  availableReplicas?: number;
  currentImage?: string;
  
  // Timestamps
  deployedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};
```

#### Implementation

- [ ] Create `AppService`:

```typescript
export class AppService {
  // Create app (Namespace + Deployment + Service + Ingress)
  async create(input: TAppInput): Promise<TApp>;
  
  // Update app config
  async update(id: ObjectId, input: Partial<TAppInput>): Promise<TApp>;
  
  // Deploy new image version
  async deploy(id: ObjectId, image: string): Promise<TDeployment>;
  
  // Scale replicas
  async scale(id: ObjectId, replicas: number): Promise<void>;
  
  // Restart (rolling restart)
  async restart(id: ObjectId): Promise<void>;
  
  // Stop (scale to 0)
  async stop(id: ObjectId): Promise<void>;
  
  // Delete app
  async delete(id: ObjectId): Promise<void>;
  
  // Get logs
  async getLogs(id: ObjectId, options?: { tail?: number; follow?: boolean }): Promise<string | AsyncIterable<string>>;
  
  // Exec into pod
  async exec(id: ObjectId, command: string[]): Promise<string>;
  
  // Sync status from K8s
  async syncStatus(id: ObjectId): Promise<void>;
}
```

- [ ] Implement K8s resource generation:
  - Deployment with proper probes, resources, env
  - Service (ClusterIP)
  - Ingress with TLS (cert-manager annotation)
  - ImagePullSecret handling

- [ ] Auto-inject MongoDB connection:
  - If `mongoClusterId` set, inject `MONGODB_URI` env var
  - Get connection string from MongoCluster

- [ ] Create API endpoints:

```
POST   /api/apps                        # Create app
GET    /api/apps                        # List all
GET    /api/apps/:id                    # Get details
PUT    /api/apps/:id                    # Update config
DELETE /api/apps/:id                    # Delete app
POST   /api/apps/:id/deploy             # Deploy new image
POST   /api/apps/:id/scale              # Scale replicas
POST   /api/apps/:id/restart            # Rolling restart
POST   /api/apps/:id/stop               # Scale to 0
GET    /api/apps/:id/logs               # Get/stream logs
POST   /api/apps/:id/exec               # Exec command
GET    /api/apps/:id/pods               # List pods
```

- [ ] Background worker: sync app status every 30s
- [ ] Test: deploy goweekdays-api connected to MongoDB

**Deliverable:** Can deploy apps, connect to MongoDB, expose via Ingress

---

### Phase 5: Registry & Secrets (Week 4)

**Goal:** Manage private registries and secrets

- [ ] `Registry` resource for private image registries
- [ ] Auto-create ImagePullSecrets in namespaces
- [ ] `Secret` resource improvements (K8s Secret sync)
- [ ] Environment variable encryption at rest

**Deliverable:** Can pull from private registries (GHCR, etc.)

---

### Phase 6: Pipeline Stages (Week 5+, Optional)

**Goal:** Dev/staging/prod environments

Only if needed after MVP:
- [ ] Pipeline model with stages
- [ ] Promote between stages
- [ ] Rollback support

---

### Phase 7: Installation & Bootstrap (Parallel)

**Goal:** One-command installer

- [ ] Installer script
- [ ] k3s HA setup
- [ ] MongoDB operator pre-installed
- [ ] Control-plane Helm chart

---

### Phase 8: Frontend (Parallel)

**Goal:** UI for Nodes + MongoDB + Apps

- [ ] Nodes page (list, join command, cordon/drain/remove)
- [ ] MongoDB clusters page (list, create, details, users)
- [ ] Apps page (list, create, deploy, logs)
- [ ] Logs viewer
- [ ] Pod shell (xterm.js)

---

## 10. Migration Checklist

### Pre-Migration

- [ ] Document current deployments (if any)
- [ ] Backup MongoDB
- [ ] Review and close open PRs on old model

### Code Migration

- [ ] Delete `src/resources/server/`
- [ ] Delete `src/resources/instance/`
- [ ] Delete `src/resources/ssh-key/`
- [ ] Delete `src/services/ssh.service.ts`
- [ ] Delete `src/services/ansible.executor.ts`
- [ ] Delete `src/services/docker.executor.ts`
- [ ] Delete `src/services/kamal.executor.ts`
- [ ] Delete `src/services/kamal.generator.ts`
- [ ] Delete `src/services/caddy.service.ts`
- [ ] Delete `src/services/mongodb.provisioner.ts`
- [ ] Remove `ssh2` from package.json
- [ ] Add `@kubernetes/client-node` to package.json
- [ ] Create new resources (cluster, node, pipeline, addon)
- [ ] Create new services (kubernetes, helm, pipeline, addon)
- [ ] Update routes
- [ ] Update tests

### Database Migration

- [ ] Create new collections: `clusters`, `nodes`, `pipelines`, `addons`
- [ ] Drop old collections: `servers`, `instances`, `sshKeys`
- [ ] Migrate `apps` schema (or recreate)
- [ ] Migrate `deployments` schema

### Documentation

- [ ] Update OVERVIEW.md
- [ ] Update SRS.md
- [ ] Update API documentation
- [ ] Create installation guide
- [ ] Create user guide

---

## 11. Installation & Bootstrap

### The Chicken-and-Egg Problem

```
Control Plane runs ON Kubernetes
         ↓
Kubernetes must be set up FIRST
         ↓
THEN deploy Control Plane as K8s workloads
```

### Installation Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         HOW TO INSTALL                                         │
│                                                                                 │
│  1. Provision 3 VMs (Hetzner, DO, AWS, etc.)                                    │
│  2. Point your domain to master 1 IP                                            │
│  3. Run the installer from your laptop:                                         │
│                                                                                 │
│     curl -sfL https://get.controlplane.dev | sh                                 │
│                                                                                 │
│  4. Follow the prompts:                                                         │
│     • Enter SSH connections for 3 masters                                       │
│     • Enter MongoDB Atlas URI                                                   │
│     • Enter domain + email                                                      │
│                                                                                 │
│  5. Script does everything automatically:                                       │
│     • SSHs into all 3 masters                                                   │
│     • Installs k3s HA cluster                                                   │
│     • Installs cert-manager + MongoDB operator                                  │
│     • Deploys Control Plane                                                     │
│                                                                                 │
│  6. Open https://your-domain.com and create admin account                       │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Interactive Installer Script

```bash
#!/bin/bash
# https://get.controlplane.dev/install.sh
# Interactive installer for Control Plane - Coolify style

set -euo pipefail

# ==============================================================================
# Colors & Formatting
# ==============================================================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# ==============================================================================
# Helper Functions
# ==============================================================================
log_success() { echo -e "      ${GREEN}✓${NC} $1"; }
log_error() { echo -e "      ${RED}✗${NC} $1"; }
log_info() { echo -e "      ${DIM}$1${NC}"; }
log_step() { echo -e "\n${CYAN}[$1]${NC} $2"; }

print_banner() {
  echo -e "${MAGENTA}"
  cat << 'EOF'
╔═══════════════════════════════════════════════════════════════════════════════╗
║                                                                               ║
║     ██████╗ ██████╗ ███╗   ██╗████████╗██████╗  ██████╗ ██╗                   ║
║    ██╔════╝██╔═══██╗████╗  ██║╚══██╔══╝██╔══██╗██╔═══██╗██║                   ║
║    ██║     ██║   ██║██╔██╗ ██║   ██║   ██████╔╝██║   ██║██║                   ║
║    ██║     ██║   ██║██║╚██╗██║   ██║   ██╔══██╗██║   ██║██║                   ║
║    ╚██████╗╚██████╔╝██║ ╚████║   ██║   ██║  ██║╚██████╔╝███████╗              ║
║     ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝ ╚══════╝              ║
║                                                                               ║
║                      ██████╗ ██╗      █████╗ ███╗   ██╗███████╗               ║
║                      ██╔══██╗██║     ██╔══██╗████╗  ██║██╔════╝               ║
║                      ██████╔╝██║     ███████║██╔██╗ ██║█████╗                 ║
║                      ██╔═══╝ ██║     ██╔══██║██║╚██╗██║██╔══╝                 ║
║                      ██║     ███████╗██║  ██║██║ ╚████║███████╗               ║
║                      ╚═╝     ╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝               ║
║                                                                               ║
║                    Kubernetes-native PaaS Installer                           ║
║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝
EOF
  echo -e "${NC}"
}

print_separator() {
  echo -e "\n${DIM}─────────────────────────────────────────────────────────────────────────────────${NC}"
}

print_section() {
  print_separator
  echo -e " ${BOLD}$1${NC}"
  print_separator
}

prompt() {
  local var_name=$1
  local prompt_text=$2
  local default=${3:-}
  local is_secret=${4:-false}
  
  echo ""
  if [[ -n "$default" ]]; then
    echo -e "${prompt_text} ${DIM}[$default]${NC}:"
  else
    echo -e "${prompt_text}:"
  fi
  
  if [[ "$is_secret" == "true" ]]; then
    echo -ne "${GREEN}▸${NC} "
    read -s value
    echo "****"
  else
    echo -ne "${GREEN}▸${NC} "
    read value
  fi
  
  if [[ -z "$value" && -n "$default" ]]; then
    value="$default"
  fi
  
  eval "$var_name='$value'"
}

prompt_confirm() {
  local prompt_text=$1
  local default=${2:-y}
  
  echo ""
  echo -ne "${prompt_text} ${DIM}[Y/n]${NC} ${GREEN}▸${NC} "
  read -n 1 value
  echo ""
  
  value=${value:-$default}
  [[ "$value" =~ ^[Yy]$ ]]
}

mask_password() {
  local str=$1
  # Mask password in MongoDB URI
  echo "$str" | sed -E 's/(mongodb\+srv:\/\/[^:]+:)[^@]+(@)/\1****\2/'
}

# ==============================================================================
# SSH Functions
# ==============================================================================
SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 -o LogLevel=ERROR"

test_ssh() {
  local host=$1
  local key=$2
  ssh $SSH_OPTS -i "$key" "$host" "echo ok" &>/dev/null
}

remote() {
  local host=$1
  local key=$2
  shift 2
  ssh $SSH_OPTS -i "$key" "$host" "$@"
}

remote_sudo() {
  local host=$1
  local key=$2
  shift 2
  ssh $SSH_OPTS -i "$key" "$host" "sudo bash -c '$@'"
}

# ==============================================================================
# Main Installation
# ==============================================================================
main() {
  clear
  print_banner
  
  echo -e "Welcome! This will set up a ${BOLD}3-node HA Control Plane${NC} cluster."
  echo ""
  echo "Before we start, make sure you have:"
  echo -e "  ${GREEN}•${NC} 3 VMs ready (Ubuntu 22.04 recommended, 2+ vCPU, 4+ GB RAM)"
  echo -e "  ${GREEN}•${NC} SSH access to all 3 VMs (root or sudo user)"
  echo -e "  ${GREEN}•${NC} MongoDB Atlas connection string"
  echo -e "  ${GREEN}•${NC} Domain name pointed to master 1 IP (or load balancer)"
  echo ""
  echo -ne "Press ${BOLD}Enter${NC} to continue..."
  read
  
  # ============================================================================
  # STEP 1: Master Nodes
  # ============================================================================
  print_section "STEP 1: Master Nodes"
  
  prompt MASTER1 "Enter SSH connection for Master 1 (e.g., root@168.119.1.1)"
  prompt MASTER2 "Enter SSH connection for Master 2"
  prompt MASTER3 "Enter SSH connection for Master 3"
  
  # ============================================================================
  # STEP 2: Database
  # ============================================================================
  print_section "STEP 2: Database"
  
  prompt MONGODB_URI "Enter MongoDB Atlas connection string"
  
  # ============================================================================
  # STEP 3: Domain & SSL
  # ============================================================================
  print_section "STEP 3: Domain & SSL"
  
  prompt DOMAIN "Enter domain for Control Plane dashboard (e.g., cp.example.com)"
  prompt EMAIL "Enter email for Let's Encrypt SSL certificates"
  
  # ============================================================================
  # STEP 4: SSH Key
  # ============================================================================
  print_section "STEP 4: SSH Key"
  
  prompt SSH_KEY "Enter path to SSH private key" "$HOME/.ssh/id_rsa"
  
  # Expand ~ if present
  SSH_KEY="${SSH_KEY/#\~/$HOME}"
  
  if [[ ! -f "$SSH_KEY" ]]; then
    echo -e "\n${RED}Error: SSH key not found at $SSH_KEY${NC}"
    exit 1
  fi
  
  # ============================================================================
  # Summary
  # ============================================================================
  print_section "SUMMARY"
  echo ""
  echo -e "  ${BOLD}Master 1:${NC}     $MASTER1"
  echo -e "  ${BOLD}Master 2:${NC}     $MASTER2"
  echo -e "  ${BOLD}Master 3:${NC}     $MASTER3"
  echo -e "  ${BOLD}MongoDB:${NC}      $(mask_password "$MONGODB_URI")"
  echo -e "  ${BOLD}Domain:${NC}       $DOMAIN"
  echo -e "  ${BOLD}Email:${NC}        $EMAIL"
  echo -e "  ${BOLD}SSH Key:${NC}      $SSH_KEY"
  
  print_separator
  echo ""
  echo "Ready to install? This will:"
  echo -e "  ${CYAN}1.${NC} Install k3s on all 3 masters (HA cluster)"
  echo -e "  ${CYAN}2.${NC} Install cert-manager for SSL"
  echo -e "  ${CYAN}3.${NC} Install MongoDB operator"
  echo -e "  ${CYAN}4.${NC} Deploy Control Plane"
  
  if ! prompt_confirm "Proceed?"; then
    echo -e "\n${YELLOW}Installation cancelled.${NC}"
    exit 0
  fi
  
  # ============================================================================
  # Installation
  # ============================================================================
  echo ""
  echo -e "${BOLD}═══════════════════════════════════════════════════════════════════════════════${NC}"
  echo -e "${BOLD} INSTALLING${NC}"
  echo -e "${BOLD}═══════════════════════════════════════════════════════════════════════════════${NC}"
  
  # --------------------------------------------------------------------------
  # Test SSH connections
  # --------------------------------------------------------------------------
  log_step "1/7" "Testing SSH connections..."
  
  for host in "$MASTER1" "$MASTER2" "$MASTER3"; do
    if test_ssh "$host" "$SSH_KEY"; then
      log_success "$host"
    else
      log_error "$host - connection failed"
      echo -e "\n${RED}Error: Cannot connect to $host${NC}"
      echo "Please check:"
      echo "  • SSH key is correct"
      echo "  • VM is running"
      echo "  • Firewall allows SSH (port 22)"
      exit 1
    fi
  done
  
  # --------------------------------------------------------------------------
  # Install k3s on master 1
  # --------------------------------------------------------------------------
  log_step "2/7" "Installing k3s on master 1 (cluster-init)..."
  
  MASTER1_IP=$(echo "$MASTER1" | cut -d'@' -f2)
  
  remote "$MASTER1" "$SSH_KEY" "curl -sfL https://get.k3s.io | sh -s - server \
    --cluster-init \
    --tls-san $DOMAIN \
    --tls-san $MASTER1_IP \
    --disable servicelb \
    --write-kubeconfig-mode 644" >/dev/null 2>&1
  
  log_success "k3s installed"
  
  # Wait for k3s to be ready
  sleep 10
  remote "$MASTER1" "$SSH_KEY" "kubectl wait --for=condition=Ready node --all --timeout=120s" >/dev/null 2>&1
  log_success "Cluster initialized"
  
  # Get join token
  JOIN_TOKEN=$(remote "$MASTER1" "$SSH_KEY" "cat /var/lib/rancher/k3s/server/token")
  K3S_URL="https://$MASTER1_IP:6443"
  
  # --------------------------------------------------------------------------
  # Join master 2
  # --------------------------------------------------------------------------
  log_step "3/7" "Joining master 2..."
  
  remote "$MASTER2" "$SSH_KEY" "curl -sfL https://get.k3s.io | K3S_URL=$K3S_URL K3S_TOKEN=$JOIN_TOKEN sh -s - server \
    --server $K3S_URL \
    --disable servicelb \
    --write-kubeconfig-mode 644" >/dev/null 2>&1
  
  log_success "Node joined"
  
  # --------------------------------------------------------------------------
  # Join master 3
  # --------------------------------------------------------------------------
  log_step "4/7" "Joining master 3..."
  
  remote "$MASTER3" "$SSH_KEY" "curl -sfL https://get.k3s.io | K3S_URL=$K3S_URL K3S_TOKEN=$JOIN_TOKEN sh -s - server \
    --server $K3S_URL \
    --disable servicelb \
    --write-kubeconfig-mode 644" >/dev/null 2>&1
  
  log_success "Node joined"
  
  # Wait for all nodes
  sleep 15
  remote "$MASTER1" "$SSH_KEY" "kubectl wait --for=condition=Ready node --all --timeout=180s" >/dev/null 2>&1
  
  # --------------------------------------------------------------------------
  # Install cert-manager
  # --------------------------------------------------------------------------
  log_step "5/7" "Installing cert-manager..."
  
  remote "$MASTER1" "$SSH_KEY" "kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.14.0/cert-manager.yaml" >/dev/null 2>&1
  sleep 10
  remote "$MASTER1" "$SSH_KEY" "kubectl wait --for=condition=Available deployment/cert-manager -n cert-manager --timeout=120s" >/dev/null 2>&1
  remote "$MASTER1" "$SSH_KEY" "kubectl wait --for=condition=Available deployment/cert-manager-webhook -n cert-manager --timeout=120s" >/dev/null 2>&1
  log_success "cert-manager deployed"
  
  # Create ClusterIssuer
  remote "$MASTER1" "$SSH_KEY" "cat <<EOF | kubectl apply -f -
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: $EMAIL
    privateKeySecretRef:
      name: letsencrypt-prod-account-key
    solvers:
    - http01:
        ingress:
          class: traefik
EOF" >/dev/null 2>&1
  log_success "ClusterIssuer created"
  
  # --------------------------------------------------------------------------
  # Install MongoDB Operator
  # --------------------------------------------------------------------------
  log_step "6/7" "Installing MongoDB operator..."
  
  remote "$MASTER1" "$SSH_KEY" "helm repo add mongodb https://mongodb.github.io/helm-charts && helm repo update" >/dev/null 2>&1
  remote "$MASTER1" "$SSH_KEY" "helm install mongodb-operator mongodb/community-operator \
    --namespace mongodb-operator --create-namespace --wait" >/dev/null 2>&1
  log_success "Operator deployed"
  
  # --------------------------------------------------------------------------
  # Deploy Control Plane
  # --------------------------------------------------------------------------
  log_step "7/7" "Deploying Control Plane..."
  
  remote "$MASTER1" "$SSH_KEY" "helm repo add controlplane https://charts.controlplane.dev && helm repo update" >/dev/null 2>&1
  
  # Escape special characters in MongoDB URI for helm
  MONGODB_URI_ESCAPED=$(printf '%s' "$MONGODB_URI" | sed 's/,/\\,/g')
  
  remote "$MASTER1" "$SSH_KEY" "helm install controlplane controlplane/controlplane \
    --namespace controlplane --create-namespace \
    --set api.mongodb.uri='$MONGODB_URI_ESCAPED' \
    --set ingress.host='$DOMAIN' \
    --set ingress.tls.enabled=true \
    --set ingress.tls.issuer=letsencrypt-prod \
    --wait --timeout=300s" >/dev/null 2>&1
  
  log_success "API deployed"
  log_success "Web deployed"
  log_success "Ingress configured"
  
  # --------------------------------------------------------------------------
  # Save kubeconfig locally
  # --------------------------------------------------------------------------
  mkdir -p ~/.kube
  remote "$MASTER1" "$SSH_KEY" "cat /etc/rancher/k3s/k3s.yaml" | \
    sed "s/127.0.0.1/$MASTER1_IP/g" > ~/.kube/controlplane-config
  chmod 600 ~/.kube/controlplane-config
  
  # --------------------------------------------------------------------------
  # Success!
  # --------------------------------------------------------------------------
  echo ""
  echo -e "${GREEN}═══════════════════════════════════════════════════════════════════════════════${NC}"
  echo ""
  echo -e "  ${GREEN}✅ Control Plane installed successfully!${NC}"
  echo ""
  echo -e "  ${BOLD}Dashboard:${NC}    https://$DOMAIN"
  echo -e "                ${DIM}(SSL certificate may take 1-2 minutes)${NC}"
  echo ""
  echo -e "  ${BOLD}Kubeconfig:${NC}   Saved to ~/.kube/controlplane-config"
  echo -e "                ${DIM}Run: export KUBECONFIG=~/.kube/controlplane-config${NC}"
  echo ""
  echo -e "  ${BOLD}Next steps:${NC}"
  echo -e "    1. Open https://$DOMAIN"
  echo -e "    2. Create your admin account"
  echo -e "    3. Add worker nodes to run your apps"
  echo ""
  echo -e "  ${BOLD}Worker join token (save this!):${NC}"
  echo -e "  ┌─────────────────────────────────────────────────────────────────────────┐"
  echo -e "  │ ${CYAN}$JOIN_TOKEN${NC}"
  echo -e "  └─────────────────────────────────────────────────────────────────────────┘"
  echo ""
  echo -e "${GREEN}═══════════════════════════════════════════════════════════════════════════════${NC}"
}

# ==============================================================================
# Run
# ==============================================================================
main
```

### Helm Chart Structure

```
charts/controlplane/
├── Chart.yaml
├── values.yaml
├── templates/
│   ├── _helpers.tpl
│   ├── namespace.yaml
│   │
│   ├── # API
│   ├── api-configmap.yaml
│   ├── api-secret.yaml           # MongoDB URI, JWT secret
│   ├── api-deployment.yaml
│   ├── api-service.yaml
│   │
│   ├── # Web
│   ├── web-deployment.yaml
│   ├── web-service.yaml
│   │
│   ├── # Ingress
│   ├── ingress.yaml              # Routes to both api and web
│   │
│   ├── # RBAC (for K8s API access)
│   ├── serviceaccount.yaml
│   ├── clusterrole.yaml          # Permissions to manage nodes, deployments, etc.
│   └── clusterrolebinding.yaml
```

### values.yaml

```yaml
# charts/controlplane/values.yaml

api:
  image:
    repository: ghcr.io/yourorg/controlplane-api
    tag: latest
    pullPolicy: Always
  
  replicas: 2
  
  resources:
    requests:
      cpu: 100m
      memory: 256Mi
    limits:
      cpu: 500m
      memory: 512Mi
  
  mongodb:
    uri: ""  # Required: mongodb+srv://...
  
  jwt:
    secret: ""  # Auto-generated if empty
    expiresIn: "7d"

web:
  image:
    repository: ghcr.io/yourorg/controlplane-web
    tag: latest
    pullPolicy: Always
  
  replicas: 2
  
  resources:
    requests:
      cpu: 50m
      memory: 128Mi
    limits:
      cpu: 200m
      memory: 256Mi

ingress:
  enabled: true
  host: ""  # Required: cp.example.com
  className: traefik
  
  tls:
    enabled: true
    issuer: letsencrypt-prod  # cert-manager ClusterIssuer
  
  annotations: {}

serviceAccount:
  create: true
  name: controlplane

rbac:
  create: true
```

### RBAC: What Control Plane Needs

```yaml
# templates/clusterrole.yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: {{ include "controlplane.fullname" . }}
rules:
  # Nodes (list, get, watch for node management)
  - apiGroups: [""]
    resources: ["nodes"]
    verbs: ["get", "list", "watch", "patch", "update", "delete"]
  
  # Pods (for logs, exec, list)
  - apiGroups: [""]
    resources: ["pods", "pods/log", "pods/exec"]
    verbs: ["get", "list", "watch", "create", "delete"]
  
  # Deployments, Services, Ingresses (for app deployment)
  - apiGroups: ["apps"]
    resources: ["deployments", "statefulsets"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: [""]
    resources: ["services"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: ["networking.k8s.io"]
    resources: ["ingresses"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  
  # Namespaces (create per-app namespaces)
  - apiGroups: [""]
    resources: ["namespaces"]
    verbs: ["get", "list", "watch", "create", "delete"]
  
  # Secrets, ConfigMaps (for app config, registry credentials)
  - apiGroups: [""]
    resources: ["secrets", "configmaps"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  
  # MongoDB CRDs (for MongoDB operator)
  - apiGroups: ["mongodbcommunity.mongodb.com"]
    resources: ["mongodbcommunity"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  
  # PVCs (for database storage)
  - apiGroups: [""]
    resources: ["persistentvolumeclaims"]
    verbs: ["get", "list", "watch", "create", "delete"]
```

### State Storage: MongoDB Atlas (External)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                                                                 │
│   Control Plane State: MongoDB Atlas (EXTERNAL)                                 │
│   ═══════════════════════════════════════════════                               │
│                                                                                 │
│   Stored in Atlas (not in the K8s cluster):                                     │
│   • Users & sessions                                                            │
│   • Cluster configuration                                                       │
│   • Node records                                                                │
│   • MongoDB cluster definitions                                                 │
│   • App configurations                                                          │
│   • Deployment history                                                          │
│   • Audit logs                                                                  │
│                                                                                 │
│   WHY EXTERNAL?                                                                 │
│   • If K8s cluster dies, control plane state survives                           │
│   • Can restore control plane on a new cluster                                  │
│   • No chicken-and-egg: Atlas is always available                               │
│   • Zero-ops for the management database                                        │
│                                                                                 │
│   User Databases: MongoDB on K8s (INTERNAL)                                     │
│   ═══════════════════════════════════════════                                   │
│                                                                                 │
│   Provisioned via MongoDB Operator:                                             │
│   • User app databases (goweekdays-api, etc.)                                   │
│   • Running as StatefulSets on worker nodes                                     │
│   • Managed by control plane                                                    │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Prerequisites

Before running the installer, user needs:

| Prerequisite | How to Get |
|--------------|------------|
| 3 VMs (masters) | Hetzner, DigitalOcean, AWS, etc. |
| MongoDB Atlas account | https://cloud.mongodb.com (free tier works) |
| Domain name | Point to master 1 IP (or load balancer) |
| DNS configured | A record: `cp.example.com` → master IP |

### Minimum VM Requirements

| Role | CPU | RAM | Disk | Count |
|------|-----|-----|------|-------|
| Master | 2 vCPU | 4 GB | 50 GB | 3 |
| Worker | 2+ vCPU | 4+ GB | 50+ GB | 1+ |


---

## 12. Open Questions

### Decided

| Question | Decision |
|----------|----------|
| Single or multi-cluster? | Single-cluster first, design for multi |
| Pipeline stages? | Yes, dev/staging/prod |
| Addon approach? | Helm charts (Bitnami) |
| K8s distro? | k3s |
| Control-plane hosting? | 3 master nodes (HA) |

### To Decide

| Question | Options | Recommendation |
|----------|---------|----------------|
| Helm execution | Shell (`helm` CLI) vs SDK | Shell for MVP |
| Git builds | Buildpacks vs Dockerfile vs both | Dockerfile first, buildpacks later |
| Review apps | PR-based ephemeral environments | Phase 2 |
| Metrics/monitoring | Prometheus + Grafana | Phase 2 |
| Log aggregation | Loki vs ELK | Phase 2 |
| Multi-tenancy | Namespace isolation vs separate clusters | Namespace isolation |

---

## Summary

This overhaul transforms control-plane from a Docker/SSH tool into a proper Kubernetes-native PaaS. The key changes are:

1. **Delete** all SSH/Docker/Ansible/Kamal code
2. **Add** Kubernetes client, Helm integration
3. **Introduce** Pipeline model with stages (dev/staging/prod)
4. **Introduce** Addon model for database provisioning via Helm
5. **Deploy** control-plane itself on 3-node k3s HA cluster
6. **Manage** worker nodes dynamically via UI

The result is a Kubero-like platform with better UX, running on your own infrastructure.
