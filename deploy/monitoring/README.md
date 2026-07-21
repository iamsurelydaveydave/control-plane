# Control Plane Monitoring

Prometheus and Grafana monitoring configuration for Control Plane.

## Overview

This directory contains:

- `prometheus-values.yaml` - Helm values for kube-prometheus-stack
- `control-plane-dashboard.json` - Grafana dashboard for Control Plane API
- `alertmanager-config.yaml` - Alert routing and notification configuration
- `servicemonitor.yaml` - ServiceMonitor for Prometheus to scrape control-plane-api

## Prerequisites

1. **Kubernetes cluster** with Helm 3 installed
2. **control-plane-api** deployed with Prometheus metrics endpoint enabled
3. Add the Prometheus community Helm repo:

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
```

## Quick Start

### 1. Install kube-prometheus-stack

```bash
# Create namespace
kubectl create namespace monitoring

# Install the stack with our values
helm install monitoring prometheus-community/kube-prometheus-stack \
  -f deploy/monitoring/prometheus-values.yaml \
  --namespace monitoring \
  --create-namespace
```

### 2. Deploy ServiceMonitor

```bash
# Ensure control-plane namespace exists
kubectl create namespace control-plane --dry-run=client -o yaml | kubectl apply -f -

# Apply ServiceMonitor
kubectl apply -f deploy/monitoring/servicemonitor.yaml
```

### 3. Import Grafana Dashboard

The dashboard is automatically loaded via the `dashboardsConfigMaps` in `prometheus-values.yaml`.

To manually import:

1. Access Grafana (see below)
2. Go to Dashboards → Import
3. Upload `control-plane-dashboard.json`

## Accessing Services

### Grafana

```bash
# Port forward to access Grafana
kubectl port-forward svc/monitoring-grafana 3001:80 -n monitoring

# Open http://localhost:3001
# Default credentials: admin / changeme
```

### Prometheus

```bash
# Port forward to access Prometheus UI
kubectl port-forward svc/monitoring-kube-prometheus-prometheus 9090:9090 -n monitoring

# Open http://localhost:9090
```

### Alertmanager

```bash
# Port forward to access Alertmanager
kubectl port-forward svc/monitoring-kube-prometheus-alertmanager 9093:9093 -n monitoring

# Open http://localhost:9093
```

## Configuration

### Changing Grafana Admin Password

Update `prometheus-values.yaml`:

```yaml
grafana:
  adminPassword: your-secure-password
```

Then upgrade:

```bash
helm upgrade monitoring prometheus-community/kube-prometheus-stack \
  -f deploy/monitoring/prometheus-values.yaml \
  -n monitoring
```

### Configuring Alertmanager Notifications

1. Edit `alertmanager-config.yaml` to configure your notification channels (Slack, PagerDuty, email, etc.)

2. Update the secret:

```bash
kubectl create secret generic alertmanager-monitoring-kube-prometheus-alertmanager \
  --from-file=alertmanager.yaml=alertmanager-config.yaml \
  -n monitoring \
  --dry-run=client -o yaml | kubectl apply -f -
```

### Adding Custom Alerts

Add new alert rules to the `additionalPrometheusRulesMap` section in `prometheus-values.yaml`:

```yaml
additionalPrometheusRulesMap:
  control-plane-alerts:
    groups:
      - name: control-plane.rules
        rules:
          - alert: YourCustomAlert
            expr: your_metric > threshold
            for: 5m
            labels:
              severity: warning
            annotations:
              summary: "Your alert summary"
              description: "Your alert description"
```

## Metrics Exposed

The control-plane-api exposes the following custom metrics at `/api/prometheus/metrics`:

### HTTP Metrics
- `http_request_duration_seconds` - Request duration histogram (labels: method, route, status_code)
- `http_requests_total` - Total request count (labels: method, route, status_code)

### Business Metrics
- `control_plane_databases_total` - Total number of databases
- `control_plane_apps_total` - Total number of apps
- `control_plane_deployments_active` - Active deployments count
- `control_plane_users_total` - Total users

### MongoDB Metrics
- `mongodb_up` - MongoDB connection status (1 = up, 0 = down)
- `mongodb_pool_size` - Connection pool size
- `mongodb_query_duration_seconds` - Query duration histogram (labels: operation, collection)

### Redis Metrics
- `redis_up` - Redis connection status (1 = up, 0 = down)
- `redis_cache_hits_total` - Cache hit count
- `redis_cache_misses_total` - Cache miss count

### Node.js Metrics (from prom-client)
- `process_cpu_*` - CPU usage
- `process_resident_memory_bytes` - Memory usage
- `nodejs_heap_*` - Heap statistics
- `nodejs_eventloop_lag_seconds` - Event loop lag
- `nodejs_active_handles_total` - Active handles
- `nodejs_active_requests_total` - Active requests

## Dashboard Panels

The Grafana dashboard includes:

1. **Overview Row**
   - Database count
   - App count
   - Active deployments
   - CPU usage
   - Memory usage
   - Active alerts

2. **HTTP Metrics Row**
   - Request rate by method
   - Request rate by status code
   - Response times (p50, p95, p99)
   - Error rate & rate limits

3. **Database & Cache Row**
   - MongoDB query times
   - Redis cache hit/miss
   - Cache hit rate gauge
   - MongoDB/Redis status
   - Connection pool size

4. **System Resources Row**
   - Memory usage (RSS, heap)
   - CPU usage (user, system)
   - Event loop lag
   - Node.js handles & requests

## Alerts

### Configured Alerts

| Alert | Condition | Severity |
|-------|-----------|----------|
| ControlPlaneHighErrorRate | Error rate > 5% for 5m | critical |
| ControlPlaneSlowResponses | p95 latency > 1s for 10m | warning |
| ControlPlaneRateLimitExhaustion | >10 rate limits/s for 5m | warning |
| ControlPlanePodRestarting | >3 restarts/hour | warning |
| ControlPlaneHighMemory | Memory > 85% limit for 10m | warning |
| ControlPlaneMongoConnectionIssues | MongoDB down for 2m | critical |
| ControlPlaneRedisConnectionIssues | Redis down for 2m | critical |
| ControlPlaneSlowMongoQueries | p95 query time > 500ms for 10m | warning |
| ControlPlaneLowCacheHitRate | Cache hit rate < 50% for 15m | warning |

## Troubleshooting

### ServiceMonitor not being picked up

1. Check labels match:
```bash
kubectl get servicemonitor -n control-plane -o yaml
kubectl get prometheus -n monitoring -o yaml | grep -A5 serviceMonitorSelector
```

2. Verify service exists:
```bash
kubectl get svc -n control-plane -l app=control-plane-api
```

### No metrics appearing

1. Check metrics endpoint directly:
```bash
kubectl port-forward svc/control-plane-api 3000:3000 -n control-plane
curl http://localhost:3000/api/prometheus/metrics
```

2. Check Prometheus targets:
```bash
kubectl port-forward svc/monitoring-kube-prometheus-prometheus 9090:9090 -n monitoring
# Open http://localhost:9090/targets
```

### Dashboard not loading

1. Verify ConfigMap exists:
```bash
kubectl get configmap control-plane-dashboard -n monitoring
```

2. Check Grafana sidecar logs:
```bash
kubectl logs -l app.kubernetes.io/name=grafana -c grafana-sc-dashboard -n monitoring
```

## Upgrading

```bash
# Update Helm repos
helm repo update

# Check for new versions
helm search repo prometheus-community/kube-prometheus-stack

# Upgrade
helm upgrade monitoring prometheus-community/kube-prometheus-stack \
  -f deploy/monitoring/prometheus-values.yaml \
  -n monitoring
```

## Uninstalling

```bash
# Remove the stack
helm uninstall monitoring -n monitoring

# Remove CRDs (optional, be careful if other apps use them)
kubectl delete crd alertmanagerconfigs.monitoring.coreos.com
kubectl delete crd alertmanagers.monitoring.coreos.com
kubectl delete crd podmonitors.monitoring.coreos.com
kubectl delete crd probes.monitoring.coreos.com
kubectl delete crd prometheuses.monitoring.coreos.com
kubectl delete crd prometheusrules.monitoring.coreos.com
kubectl delete crd servicemonitors.monitoring.coreos.com
kubectl delete crd thanosrulers.monitoring.coreos.com

# Remove namespace
kubectl delete namespace monitoring
```
