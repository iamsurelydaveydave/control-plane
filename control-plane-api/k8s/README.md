# Kubernetes-based Database Provisioning

This directory contains the K8s setup for database provisioning using K3s and operators.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Control Plane Server                               │
│                                                                              │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────────┐   │
│  │   Nuxt Web UI    │  │   Express API    │  │  K3s Server (embedded)   │   │
│  │                  │  │                  │  │  • API server            │   │
│  │                  │  │  k8s.service.ts ─┼──│  • Scheduler             │   │
│  │                  │  │                  │  │  • Controller manager    │   │
│  └──────────────────┘  └──────────────────┘  └──────────────────────────┘   │
│                                                                              │
│                              K3s manages:                                    │
│                              • Percona MongoDB Operator                      │
│                              • Database CustomResources                      │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ K3s agent connection
                                      │
┌─────────────────────────────────────┼───────────────────────────────────────┐
│                    Database Servers (K3s Agents)                             │
│                                      │                                       │
│  ┌─────────────────┐  ┌─────────────┴───┐  ┌─────────────────┐              │
│  │   DB Server 1   │  │   DB Server 2   │  │   DB Server 3   │              │
│  │   (K3s agent)   │  │   (K3s agent)   │  │   (K3s agent)   │              │
│  │                 │  │                 │  │                 │              │
│  │  MongoDB Pod    │  │  MongoDB Pod    │  │  MongoDB Pod    │              │
│  │  (Primary)      │  │  (Secondary)    │  │  (Secondary)    │              │
│  │                 │  │                 │  │                 │              │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘              │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Setup

### 1. Install K3s on Control Plane Server

```bash
# Install K3s server (control plane)
curl -sfL https://get.k3s.io | sh -s - server \
  --disable traefik \
  --disable servicelb \
  --write-kubeconfig-mode 644

# Get the node token for adding agents
cat /var/lib/rancher/k3s/server/node-token
```

### 2. Install K3s Agent on Database Servers

```bash
# On each database server, join the K3s cluster
curl -sfL https://get.k3s.io | K3S_URL=https://<control-plane-ip>:6443 \
  K3S_TOKEN=<node-token> sh -
```

### 3. Install Percona Operator

```bash
# From the control plane server
kubectl apply -f https://raw.githubusercontent.com/percona/percona-server-mongodb-operator/v1.16.0/deploy/bundle.yaml
```

### 4. Configure Control Plane API

Add to `.env`:
```
K8S_ENABLED=true
K8S_KUBECONFIG=/etc/rancher/k3s/k3s.yaml
```

## How It Works

1. **Server Registration**: When you add a database server, the control plane:
   - SSHs into the server
   - Installs K3s agent
   - Joins it to the cluster

2. **Database Provisioning**: When you create a MongoDB database:
   - Control plane generates a `PerconaServerMongoDB` manifest
   - Applies it via K8s API
   - Percona Operator handles everything:
     - Starts MongoDB pods on the correct nodes
     - Initializes replica set
     - Creates users
     - Configures TLS
     - Sets up backups

3. **Monitoring**: Control plane watches the CustomResource status:
   - `status.state: ready` = cluster is healthy
   - `status.members` = list of replica set members

## Files

- `setup-k3s-server.sh` - Install K3s server on control plane
- `setup-k3s-agent.sh` - Install K3s agent on database server
- `percona-operator.yaml` - Percona Operator deployment
- `mongodb-cluster-template.yaml` - Template for MongoDB clusters

## Comparison to Ansible

| Aspect | Ansible (Old) | K8s + Operator (New) |
|--------|---------------|----------------------|
| Lines of code | 3500+ | ~200 |
| Replica set init | Manual orchestration | Automatic |
| Failure recovery | Manual | Automatic |
| TLS setup | Complex playbook | Built-in |
| Backups | Custom playbook | Built-in |
| Scaling | Complex | `kubectl scale` |
