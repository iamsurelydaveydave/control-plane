# MongoDB Provisioning Migration: Ansible → Kubernetes

This document describes the migration from Ansible-based MongoDB provisioning to Kubernetes (K3s) with the Percona Operator.

## Why K8s?

The Ansible-based provisioner had recurring issues:
- Complex state machine for replica set initialization
- Fragile error recovery
- Difficult to debug YAML/Jinja2 errors
- No automatic failover handling

The Percona Operator solves all of this:
- Battle-tested replica set management
- Automatic failover and recovery
- Built-in TLS certificate management
- Integrated backup/restore

## Architecture

```
Before (Ansible):
  Control Plane → Ansible → SSH → Docker containers on each server

After (K8s):
  Control Plane → K8s API → Percona Operator → MongoDB Pods on K3s agents
```

## Setup Steps

### 1. Install K3s Server on Control Plane

```bash
cd k8s
chmod +x setup-k3s-server.sh
sudo ./setup-k3s-server.sh
```

This installs:
- K3s server (control plane)
- Percona MongoDB Operator

### 2. Configure Environment Variables

Add to `.env`:
```env
K8S_ENABLED=true
K8S_KUBECONFIG=/etc/rancher/k3s/k3s.yaml
K3S_SERVER_URL=https://<control-plane-ip>:6443
K3S_TOKEN=<token-from-setup-script>
```

### 3. Add Database Servers as K3s Agents

When you add a server through the Control Plane UI and provision a database:
- The K8s provisioner automatically installs K3s agent on the server
- The server joins the K3s cluster
- MongoDB pods are scheduled on the new nodes

Or manually:
```bash
curl -sfL https://get.k3s.io | K3S_URL=https://<control-plane-ip>:6443 K3S_TOKEN=<token> sh -
```

## Provisioning Flow

### Creating a MongoDB Cluster

1. **API receives request** with database configuration
2. **K8s provisioner**:
   - Checks all servers are K3s agents (installs if not)
   - Creates Secret with MongoDB credentials
   - Creates PerconaServerMongoDB CustomResource
3. **Percona Operator**:
   - Schedules MongoDB pods on available nodes
   - Initializes replica set
   - Creates admin user
   - Configures internal TLS (if cert-manager is installed)
4. **Control Plane** polls status until ready

### What the Operator Handles Automatically

| Feature | Ansible (Manual) | Percona Operator (Automatic) |
|---------|------------------|------------------------------|
| Replica set init | Complex multi-phase | Automatic |
| Primary election | Wait loops | Automatic |
| Node failure | Manual intervention | Automatic failover |
| TLS certificates | Custom playbook | cert-manager integration |
| Backups | Custom S3 scripts | Built-in scheduler |
| Scaling | Add node playbook | `kubectl scale` |
| Version upgrades | Rolling restart scripts | Rolling update strategy |

## API Changes

The API remains the same. The provisioner is selected by `K8S_ENABLED`:

```typescript
// Automatic selection based on K8S_ENABLED env var
const provisioner = getMongoDBProvisioner();

// Always same interface:
await provisioner.provision({ databaseId, triggeredBy, onLog });
await provisioner.addNode({ databaseId, serverId, role, triggeredBy, onLog });
await provisioner.remove(databaseId, keepData, onLog);
```

## Files Changed/Added

### New Files
- `k8s/README.md` - K8s setup documentation
- `k8s/setup-k3s-server.sh` - K3s server installation script
- `k8s/setup-k3s-agent.sh` - K3s agent installation script
- `k8s/mongodb-cluster-example.yaml` - Example Percona manifest
- `src/services/k8s.service.ts` - K8s API client
- `src/services/mongodb.provisioner.k8s.ts` - K8s-based provisioner
- `src/services/mongodb.provisioner.factory.ts` - Provisioner selection

### Modified Files
- `src/services/index.ts` - Added exports
- `src/resources/database/database.controller.ts` - Uses factory
- `package.json` - Added `yaml` dependency

### Unchanged (Still Available)
- `ansible/` - All Ansible playbooks remain for `K8S_ENABLED=false`
- `src/services/mongodb.provisioner.ts` - Ansible provisioner
- `src/services/ansible.executor.ts` - Ansible executor

## Rollback

To revert to Ansible provisioning:

1. Set `K8S_ENABLED=false` in `.env`
2. Restart the API

The factory will automatically use the Ansible provisioner.

## Resource Requirements

| Component | Memory | CPU |
|-----------|--------|-----|
| K3s server (control plane) | ~512 MB | 0.5 core |
| K3s agent (per DB server) | ~256 MB | 0.25 core |
| Percona Operator | ~128 MB | 0.1 core |
| MongoDB pod | Configurable (default 1 GB) | Configurable |

## Monitoring

Check cluster status:
```bash
# On control plane server
kubectl get nodes
kubectl get psmdb -n databases
kubectl get pods -n databases
```

Check MongoDB replica set:
```bash
kubectl exec -it <pod-name> -n databases -- mongosh --eval "rs.status()"
```
