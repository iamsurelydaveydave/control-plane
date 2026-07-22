# Control Plane Helm Chart (API Only)

A Helm chart for deploying Control Plane API - a Kubernetes cluster management platform.

> **Note:** The frontend is deployed separately to Cloudflare Workers.

## Overview

This chart deploys:
- **API** (Express backend) - Deployment, Service, ConfigMap, Secret
- **Ingress** - Standard Kubernetes Ingress or Traefik IngressRoute
- **RBAC** - ServiceAccount, ClusterRole, ClusterRoleBinding for K8s API access
- **Redis** - Optional Bitnami Redis subchart

## Prerequisites

- Kubernetes 1.24+
- Helm 3.8+
- MongoDB Atlas (external) or MongoDB instance
- Optional: cert-manager for automatic TLS certificates
- Optional: Traefik for IngressRoute support

## Installation

### Install from Local Chart

```bash
# Create namespace
kubectl create namespace control-plane

# Install with custom values
helm install control-plane ./deploy/helm/control-plane \
  --namespace control-plane \
  --set api.mongodb.uri="mongodb+srv://user:pass@cluster.mongodb.net/controlplane" \
  --set api.cors.allowedOrigins="https://cplane.goweekdays.com" \
  --set api.cookieDomain=".cplane.goweekdays.com" \
  --set ingress.host="api.cplane.goweekdays.com"
```

### Install with Values File

```bash
# Create a custom values file
cat > my-values.yaml <<EOF
api:
  mongodb:
    uri: "mongodb+srv://user:pass@cluster.mongodb.net/controlplane"
  redis:
    host: "redis.example.com"
  cors:
    allowedOrigins: "https://cplane.goweekdays.com"
  cookieDomain: ".cplane.goweekdays.com"

ingress:
  host: "api.cplane.goweekdays.com"
  tls:
    enabled: true
    issuer: letsencrypt-prod

global:
  imagePullSecrets:
    - name: ghcr-credentials
EOF

# Install
helm install control-plane ./deploy/helm/control-plane \
  --namespace control-plane \
  -f my-values.yaml
```

## Configuration

### Required Values

| Parameter | Description |
|-----------|-------------|
| `api.mongodb.uri` | MongoDB connection URI (required) |
| `api.cors.allowedOrigins` | Frontend URL for CORS (required) |
| `ingress.host` | Hostname for the API ingress (required when ingress enabled) |

### Key Values

| Parameter | Description | Default |
|-----------|-------------|---------|
| `api.image.repository` | API image repository | `ghcr.io/iamsurelydaveydave/control-plane-api` |
| `api.image.tag` | API image tag | Chart appVersion |
| `api.replicas` | Number of API replicas | `2` |
| `api.mongodb.uri` | MongoDB connection string | `""` |
| `api.mongodb.existingSecret` | Use existing secret for MongoDB URI | `""` |
| `api.redis.host` | Redis host | `""` |
| `api.redis.port` | Redis port | `6379` |
| `api.jwt.secret` | JWT secret (auto-generated if empty) | `""` |
| `api.jwt.expiresIn` | JWT expiration | `7d` |
| `api.cors.allowedOrigins` | CORS allowed origins (frontend URL) | `""` |
| `api.cookieDomain` | Cookie domain for cross-subdomain auth | `""` |
| `api.env` | Additional environment variables | `{}` |
| `ingress.enabled` | Enable ingress | `true` |
| `ingress.className` | Ingress class name | `traefik` |
| `ingress.host` | Ingress hostname | `""` |
| `ingress.tls.enabled` | Enable TLS | `true` |
| `ingress.tls.issuer` | cert-manager ClusterIssuer | `letsencrypt-prod` |
| `ingressRoute.enabled` | Use Traefik IngressRoute CRD | `false` |
| `serviceAccount.create` | Create ServiceAccount | `true` |
| `rbac.create` | Create RBAC resources | `true` |
| `redis.enabled` | Enable Redis subchart | `false` |

### Using External Redis

```yaml
api:
  redis:
    host: "redis.example.com"
    port: 6379
    password: "your-password"
    # Or use existing secret
    existingSecret: "redis-credentials"
    existingSecretKey: "password"

redis:
  enabled: false
```

### Using Redis Subchart

```yaml
api:
  redis:
    host: ""  # Will be auto-configured

redis:
  enabled: true
  architecture: standalone
  auth:
    enabled: true
    password: "secure-password"
  master:
    persistence:
      enabled: true
      size: 1Gi
```

### Using Existing Secrets

```yaml
api:
  mongodb:
    existingSecret: "my-mongodb-secret"
    existingSecretKey: "uri"
  
  jwt:
    existingSecret: "my-jwt-secret"
    existingSecretKey: "secret"
  
  redis:
    existingSecret: "my-redis-secret"
    existingSecretKey: "password"
```

### Traefik IngressRoute

For Traefik-specific features, use IngressRoute instead of standard Ingress:

```yaml
ingress:
  enabled: false  # Disable standard ingress
  host: "api.cplane.goweekdays.com"

ingressRoute:
  enabled: true
  entryPoints:
    - websecure
  tls:
    enabled: true
    certResolver: letsencrypt
  middlewares:
    - name: redirect-https
      namespace: traefik
```

### Resource Limits

```yaml
api:
  resources:
    requests:
      cpu: 100m
      memory: 256Mi
    limits:
      cpu: 500m
      memory: 512Mi
```

### Autoscaling

```yaml
autoscaling:
  api:
    enabled: true
    minReplicas: 2
    maxReplicas: 10
    targetCPUUtilizationPercentage: 80
```

### Pod Disruption Budget

```yaml
podDisruptionBudget:
  api:
    enabled: true
    minAvailable: 1
```

## Frontend Deployment

The frontend is deployed separately to Cloudflare Workers. When building the frontend, set these environment variables:

```bash
API_URL=https://api.cplane.goweekdays.com
COOKIE_DOMAIN=.cplane.goweekdays.com
```

## RBAC Permissions

The Control Plane API requires cluster-wide permissions to manage Kubernetes resources. The ClusterRole includes permissions for:

| API Group | Resources | Verbs |
|-----------|-----------|-------|
| `""` (core) | nodes | get, list, watch, patch, update, delete |
| `""` (core) | pods, pods/log, pods/exec | get, list, watch, create, delete |
| `""` (core) | services, secrets, configmaps, namespaces, persistentvolumeclaims | full CRUD |
| `apps` | deployments, statefulsets, daemonsets | full CRUD |
| `networking.k8s.io` | ingresses, networkpolicies | full CRUD |
| `batch` | jobs, cronjobs | full CRUD |
| `autoscaling` | horizontalpodautoscalers | full CRUD |
| `mongodbcommunity.mongodb.com` | mongodbcommunity | full CRUD |
| `traefik.io` | ingressroutes, middlewares, etc. | full CRUD |
| `cert-manager.io` | certificates, issuers, etc. | full CRUD |

## Upgrading

```bash
helm upgrade control-plane ./deploy/helm/control-plane \
  --namespace control-plane \
  -f my-values.yaml
```

## Uninstalling

```bash
helm uninstall control-plane --namespace control-plane
kubectl delete namespace control-plane
```

**Note:** The ClusterRole and ClusterRoleBinding are cluster-scoped and will be deleted with the release. PersistentVolumeClaims created by the Redis subchart are retained by default.

## Troubleshooting

### Check Pod Status

```bash
kubectl get pods -n control-plane
kubectl describe pod <pod-name> -n control-plane
kubectl logs <pod-name> -n control-plane
```

### Check API Health

```bash
kubectl exec -it <api-pod> -n control-plane -- curl localhost:5005/api/health
```

### Check RBAC

```bash
kubectl auth can-i list pods --as=system:serviceaccount:control-plane:control-plane
kubectl auth can-i create deployments --as=system:serviceaccount:control-plane:control-plane
```

### MongoDB Connection Issues

Ensure the MongoDB URI is correctly formatted and the network allows connections from the cluster. For MongoDB Atlas, ensure the cluster's IP is whitelisted.

## Docker Image

The API is pulled from GitHub Container Registry:

```bash
docker pull ghcr.io/iamsurelydaveydave/control-plane-api:latest
```

## License

MIT
