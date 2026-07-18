# MongoDB Provisioning

This document describes how to provision MongoDB databases using the Control Plane API.

## Overview

The Control Plane provisions MongoDB databases on managed servers using:
- **Ansible** for orchestration
- **Docker** for containerization
- **MongoDB official images** for consistency

## Supported Configurations

### Standalone (Single Node)
A single MongoDB instance, suitable for:
- Development environments
- Small applications
- Testing

### Replica Set (3+ Nodes)
A MongoDB replica set with:
- 1 Primary node (handles writes)
- 1+ Secondary nodes (replicate data)
- Optional Arbiter node (voting only)

## API Usage

### Create a Standalone MongoDB

```bash
POST /api/databases
Content-Type: application/json

{
  "name": "my-mongodb",
  "type": "mongodb",
  "version": "7.0",
  "credentials": {
    "adminUser": "admin",
    "adminPassword": "securepassword123"
  },
  "nodes": [
    {
      "serverId": "64abc123...",
      "role": "standalone"
    }
  ],
  "config": {
    "port": 27017,
    "cacheSizeGB": 1
  }
}
```

### Create a Replica Set

```bash
POST /api/databases
Content-Type: application/json

{
  "name": "my-replicaset",
  "type": "mongodb",
  "version": "7.0",
  "credentials": {
    "adminUser": "admin",
    "adminPassword": "securepassword123"
  },
  "nodes": [
    {
      "serverId": "64abc123...",
      "role": "primary"
    },
    {
      "serverId": "64abc456...",
      "role": "secondary"
    },
    {
      "serverId": "64abc789...",
      "role": "secondary"
    }
  ],
  "config": {
    "port": 27017,
    "replicaSetName": "rs0",
    "cacheSizeGB": 2
  }
}
```

### Manually Trigger Provisioning

If you created the database with `?auto_provision=false`:

```bash
POST /api/databases/:id/provision
```

### Get Connection Credentials

```bash
GET /api/databases/:id/credentials

Response:
{
  "credentials": {
    "adminUser": "admin",
    "adminPassword": "...",
    "connectionString": "mongodb://admin:...@host1:27017,host2:27017/admin?replicaSet=rs0"
  }
}
```

### Remove MongoDB (Keep Data)

```bash
POST /api/databases/:id/remove
```

### Remove MongoDB (Delete Data)

```bash
POST /api/databases/:id/remove?remove_data=true&delete_record=true
```

## Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `version` | `7.0` | MongoDB version |
| `port` | `27017` | MongoDB port |
| `replicaSetName` | `rs_<name>` | Replica set name |
| `cacheSizeGB` | `0.5` | WiredTiger cache size |
| `dataDir` | `/opt/mongodb/data` | Data directory |
| `configDir` | `/opt/mongodb/config` | Config directory |
| `logDir` | `/opt/mongodb/logs` | Log directory |
| `allowedIps` | `['any']` | Firewall allowed IPs |

## What Gets Deployed

On each server, the provisioner:

1. **Installs Docker** (if not present)
2. **Pulls MongoDB image** (`mongo:<version>`)
3. **Creates directories**:
   - `/opt/mongodb/data` - Database files
   - `/opt/mongodb/config` - Configuration
   - `/opt/mongodb/logs` - Logs
   - `/opt/mongodb/keyfile` - Replica set auth (if replica set)
4. **Configures firewall** (UFW)
5. **Runs MongoDB container** with:
   - Persistent storage
   - Auth enabled
   - Health checks
   - Automatic restart
6. **Initializes replica set** (if multi-node)
7. **Creates admin user**

## Ansible Playbooks

The playbooks are in `ansible/playbooks/`:

| Playbook | Use |
|----------|-----|
| `mongodb-standalone.yml` | Single node deployment |
| `mongodb-replicaset.yml` | Replica set deployment |
| `mongodb-remove.yml` | Remove deployment |

### Manual Execution

```bash
cd ansible

# Standalone
ansible-playbook playbooks/mongodb-standalone.yml \
  -i inventory.ini \
  -e mongodb_admin_user=admin \
  -e mongodb_admin_password=secret \
  -e mongodb_version=7.0

# Replica set
ansible-playbook playbooks/mongodb-replicaset.yml \
  -i inventory.ini \
  -e mongodb_admin_user=admin \
  -e mongodb_admin_password=secret \
  -e mongodb_replicaset_name=rs0
```

## Prerequisites

The Control Plane server needs:

1. **Ansible installed**:
   ```bash
   pip install ansible
   ```

2. **SSH access** to target servers (key-based auth)

3. **Target servers** with:
   - Ubuntu 20.04+ or Debian 11+
   - Passwordless sudo
   - Python 3

## Security Notes

- Passwords are stored in the database (should be encrypted in production)
- All MongoDB instances have auth enabled
- Replica sets use keyfile authentication
- Firewall rules limit access to specified IPs

## Troubleshooting

### Check provisioning logs
```bash
GET /api/databases/:id/logs
```

### SSH into server and check container
```bash
docker logs mongodb_<name>
docker exec -it mongodb_<name> mongosh
```

### Check MongoDB status
```bash
docker exec mongodb_<name> mongosh --eval "rs.status()"
```
