# Dynamic Reverse Proxy with Caddy

A guide for implementing Caddy as the edge reverse proxy on the control plane server to route requests to the correct compute instance and app.

## Overview

The control plane server runs Caddy as a reverse proxy. When compute instances are added and apps are deployed, the control plane dynamically updates Caddy's configuration to route requests for specific subdomains to the correct server and port.

**Key features:**
- One subdomain can point to **multiple instances** (load balancing)
- Automatic failover when instances go unhealthy
- Zero-downtime scaling (add/remove instances live)
- Automatic HTTPS via Let's Encrypt

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Control Plane Server                                │
│                                                                             │
│  ┌─────────────────┐       ┌─────────────────┐                             │
│  │  Control Plane  │       │     Caddy       │                             │
│  │      API        │──────▶│  Reverse Proxy  │◀──── All incoming HTTPS     │
│  │                 │       │                 │                             │
│  │  • Manages apps │       │  • TLS termination                            │
│  │  • Manages instances    │  • Load balancing                             │
│  │  • Updates Caddy│       │  • Health checks                              │
│  └─────────────────┘       └─────────────────┘                             │
│           │                         │                                       │
│           ▼                         │                                       │
│    MongoDB Atlas                    │                                       │
│    (state storage)                  │                                       │
└─────────────────────────────────────┼───────────────────────────────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    │                 │                 │
                    ▼                 ▼                 ▼
             ┌──────────┐      ┌──────────┐      ┌──────────┐
             │ Server 1 │      │ Server 2 │      │ Server 3 │
             │          │      │          │      │          │
             │ App A    │      │ App A    │      │ App B    │
             │ :3001    │      │ :3001    │      │ :3001    │
             └──────────┘      └──────────┘      └──────────┘

Request flow:
  User → app-a.example.com → Caddy → Round Robin → Server 1 or 2 :3001
  User → app-b.example.com → Caddy → Server 3 :3001
```

## How It Works

1. **Caddy runs on the Control Plane server** as the single entry point for all HTTP(S) traffic
2. **Control Plane API manages routing dynamically** — when apps are deployed, scaled, or removed, Caddy config is updated
3. **Caddy Admin API enables hot reloads** — no restart needed, zero downtime

## Implementation

### Option A: JSON Config via Caddy Admin API (Recommended)

Caddy has a powerful [Admin API](https://caddyserver.com/docs/api) that allows live config updates without restarts:

```bash
# Update config via API (no restart needed)
curl -X POST "http://localhost:2019/load" \
  -H "Content-Type: application/json" \
  -d @caddy-config.json
```

#### Service Implementation

```typescript
// src/services/caddy.service.ts

import axios from "axios";
import { TApp } from "../resources/app/app.model";
import { TInstance } from "../resources/instance/instance.model";
import { TServer } from "../resources/server/server.model";

const CADDY_ADMIN_URL = process.env.CADDY_ADMIN_URL || "http://localhost:2019";

interface CaddyUpstream {
  dial: string; // "server-ip:port"
}

interface CaddyRoute {
  match: [{ host: string[] }];
  handle: [{
    handler: "reverse_proxy";
    upstreams: CaddyUpstream[];
    health_checks?: {
      active: {
        uri: string;
        interval: string;
      };
    };
  }];
}

/**
 * Sync routing for a single app after deploy/scale
 */
export async function syncAppRouting(
  app: TApp,
  instances: TInstance[],
  servers: Map<string, TServer>
): Promise<void> {
  if (!app.domain) return; // No domain = no routing

  const runningInstances = instances.filter((i) => i.status === "running");
  
  const upstreams: CaddyUpstream[] = runningInstances.map((instance) => {
    const server = servers.get(instance.serverId.toString());
    return { dial: `${server.ip}:${instance.port}` };
  });

  const route: CaddyRoute = {
    match: [{ host: [app.domain] }],
    handle: [{
      handler: "reverse_proxy",
      upstreams,
      ...(app.healthCheck && {
        health_checks: {
          active: {
            uri: app.healthCheck.path,
            interval: `${app.healthCheck.interval}s`,
          },
        },
      }),
    }],
  };

  // Update Caddy via Admin API
  await axios.post(`${CADDY_ADMIN_URL}/config/apps/http/servers/srv0/routes`, route);
}

/**
 * Remove routing for an app (on delete or domain removal)
 */
export async function removeAppRouting(domain: string): Promise<void> {
  // Remove route for this domain
  // Implementation depends on how you index routes
}

/**
 * Rebuild full Caddy config from database state
 * Call on control plane startup
 */
export async function rebuildFullConfig(
  apps: TApp[],
  instances: TInstance[],
  servers: TServer[]
): Promise<void> {
  const serverMap = new Map(servers.map((s) => [s._id.toString(), s]));
  
  const routes: CaddyRoute[] = apps
    .filter((app) => app.domain && app.status === "running")
    .map((app) => {
      const appInstances = instances.filter(
        (i) => i.appId.equals(app._id!) && i.status === "running"
      );
      
      return {
        match: [{ host: [app.domain!] }],
        handle: [{
          handler: "reverse_proxy",
          upstreams: appInstances.map((instance) => {
            const server = serverMap.get(instance.serverId.toString())!;
            return { dial: `${server.ip}:${instance.port}` };
          }),
        }],
      };
    });

  const config = {
    apps: {
      http: {
        servers: {
          srv0: {
            listen: [":443"],
            routes,
          },
        },
      },
    },
  };

  await axios.post(`${CADDY_ADMIN_URL}/load`, config);
}
```

### Option B: Generate Caddyfile + Reload

Simpler approach — generate a Caddyfile and reload Caddy:

```typescript
/**
 * Generate Caddyfile content from current state
 */
export async function generateCaddyfile(
  apps: TApp[],
  instances: TInstance[],
  servers: TServer[]
): Promise<string> {
  const serverMap = new Map(servers.map((s) => [s._id.toString(), s]));
  
  let caddyfile = "";

  for (const app of apps) {
    if (!app.domain || app.status !== "running") continue;

    const appInstances = instances.filter(
      (i) => i.appId.equals(app._id!) && i.status === "running"
    );

    if (appInstances.length === 0) continue;

    const upstreams = appInstances
      .map((instance) => {
        const server = serverMap.get(instance.serverId.toString())!;
        return `${server.ip}:${instance.port}`;
      })
      .join(" ");

    caddyfile += `
${app.domain} {
    reverse_proxy ${upstreams} {
        lb_policy round_robin
        ${app.healthCheck ? `health_uri ${app.healthCheck.path}` : ""}
        ${app.healthCheck ? `health_interval ${app.healthCheck.interval}s` : ""}
    }
}
`;
  }

  return caddyfile;
}

// Usage:
// const caddyfile = await generateCaddyfile(apps, instances, servers);
// fs.writeFileSync("/etc/caddy/Caddyfile", caddyfile);
// exec("caddy reload --config /etc/caddy/Caddyfile");
```

## Integration Points

Update Caddy routing at these events:

| Event | Action |
|-------|--------|
| `POST /apps` (create app with domain) | Add route to Caddy |
| `POST /apps/:id/deploy` | Sync upstreams after instances are running |
| `POST /apps/:id/scale` | Sync upstreams after instances change |
| `PATCH /apps/:id` (domain change) | Update route in Caddy |
| `DELETE /apps/:id` | Remove route from Caddy |
| Instance health change | Update upstreams (remove unhealthy) |
| Control plane startup | Rebuild full Caddy config from DB |

## Request Flow Example

```
1. User creates app:
   POST /apps { name: "myapp", domain: "myapp.example.com", replicas: 2, serverIds: [...] }

2. Control plane saves app to DB

3. Control plane deploys containers to Server 1 and Server 2 (both on port 3001)

4. Control plane saves instances to DB

5. Control plane updates Caddy:
   POST http://localhost:2019/config/apps/http/servers/srv0/routes
   {
     "match": [{ "host": ["myapp.example.com"] }],
     "handle": [{
       "handler": "reverse_proxy",
       "upstreams": [
         { "dial": "192.168.1.10:3001" },
         { "dial": "192.168.1.11:3001" }
       ]
     }]
   }

6. User visits myapp.example.com:
   → Caddy terminates TLS
   → Caddy load balances to Server 1 or Server 2
   → Response returned to user
```

## Caddyfile Example (Static Reference)

For reference, this is what the generated Caddyfile would look like:

```caddyfile
# Route by subdomain to different apps
app-a.example.com {
    reverse_proxy 192.168.1.10:3001 192.168.1.11:3001 {
        lb_policy round_robin
        health_uri /health
        health_interval 10s
    }
}

app-b.example.com {
    reverse_proxy 192.168.1.12:3001 {
        health_uri /health
        health_interval 10s
    }
}

# Control plane UI and API
cp.example.com {
    reverse_proxy localhost:3000
}
```

## Docker Compose Setup

```yaml
# docker-compose.yml for control plane
services:
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    # Expose admin API internally
    environment:
      - CADDY_ADMIN=0.0.0.0:2019

  control-plane-api:
    build: ./control-plane-api
    restart: unless-stopped
    environment:
      - CADDY_ADMIN_URL=http://caddy:2019
      - MONGODB_URI=mongodb+srv://...
    depends_on:
      - caddy

  control-plane-web:
    build: ./control-plane-web
    restart: unless-stopped
    depends_on:
      - control-plane-api

volumes:
  caddy_data:
  caddy_config:
```

## Load Balancing (Multiple Instances → One Subdomain)

This is a core feature. When an app has multiple instances (replicas), Caddy distributes traffic across all of them:

```
                                    ┌─────────────────┐
                                ┌──▶│ Server 1 :3001  │
                                │   │ (Instance 1)    │
┌────────┐    ┌────────┐        │   └─────────────────┘
│  User  │───▶│ Caddy  │────────┤
└────────┘    └────────┘        │   ┌─────────────────┐
                                ├──▶│ Server 2 :3001  │
 myapp.example.com              │   │ (Instance 2)    │
                                │   └─────────────────┘
                                │
                                │   ┌─────────────────┐
                                └──▶│ Server 3 :3001  │
                                    │ (Instance 3)    │
                                    └─────────────────┘
```

### Load Balancing Policies

| Policy | Behavior | Use Case |
|--------|----------|----------|
| `round_robin` | Rotate sequentially (default) | General purpose |
| `least_conn` | Fewest active connections | Long-lived connections |
| `first` | Always first available | Active-passive failover |
| `random` | Random selection | Simple distribution |
| `ip_hash` | Same client IP → same upstream | Sticky sessions (no state sharing) |
| `cookie` | Sticky sessions via cookie | User sessions |

### Health Checks

Caddy can automatically remove unhealthy instances:

```caddyfile
myapp.example.com {
    reverse_proxy server1:3001 server2:3001 server3:3001 {
        lb_policy round_robin
        
        # Active health checks - Caddy probes each upstream
        health_uri /health
        health_interval 10s
        health_timeout 5s
        
        # Passive health checks - track failures from real requests  
        fail_duration 30s
        max_fails 3
        unhealthy_status 500 502 503 504
    }
}
```

If Instance 2 crashes:
1. Health check fails after 3 attempts
2. Caddy removes it from the pool
3. Traffic only goes to Instance 1 and 3
4. When Instance 2 recovers, Caddy adds it back automatically

### Extracting Load Balancing Config

Add load balancing policy to the App model:

```typescript
// app.model.ts - add to TApp
export type TAppLoadBalancer = {
  policy: 'round_robin' | 'least_conn' | 'ip_hash' | 'first' | 'random';
  stickySessionCookie?: string;  // For cookie-based sticky sessions
};

export type TApp = {
  // ... existing fields
  loadBalancer?: TAppLoadBalancer;
};
```

Then use it when generating Caddy config:

```typescript
const route: CaddyRoute = {
  match: [{ host: [app.domain] }],
  handle: [{
    handler: "reverse_proxy",
    upstreams,
    load_balancing: {
      selection_policy: {
        policy: app.loadBalancer?.policy || "round_robin",
      },
    },
    health_checks: app.healthCheck ? {
      active: {
        uri: app.healthCheck.path,
        interval: `${app.healthCheck.interval}s`,
      },
      passive: {
        fail_duration: "30s",
        max_fails: 3,
        unhealthy_status: [500, 502, 503, 504],
      },
    } : undefined,
  }],
};
```

## Benefits

- ✅ **Automatic HTTPS** — Caddy handles Let's Encrypt certificates automatically
- ✅ **Zero-downtime config updates** — Admin API allows live reloads
- ✅ **Load balancing** — Distribute traffic across multiple instances
- ✅ **Health checks** — Automatically removes unhealthy upstreams
- ✅ **Auto-recovery** — Unhealthy instances rejoin when healthy
- ✅ **Single entry point** — All traffic goes through one place
- ✅ **Simple config** — Much simpler than Nginx for this use case

## Implementation Status

All core features are now implemented:

| Component | Status | File |
|-----------|--------|------|
| Caddy Service | ✅ Done | `src/services/caddy.service.ts` |
| Docker Executor | ✅ Done | `src/services/docker.executor.ts` |
| App Service | ✅ Done | `src/resources/app/app.service.ts` |
| Load Balancer Config | ✅ Done | `src/resources/app/app.model.ts` |
| Startup Hook | ✅ Done | `src/setup.ts` |
| Docker Compose | ✅ Done | `deploy/docker-compose.yml` |
| Caddyfile | ✅ Done | `deploy/Caddyfile` |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CADDY_ADMIN_URL` | `http://localhost:2019` | Caddy Admin API URL |
| `CADDY_ENABLED` | `true` | Set to `false` to disable Caddy integration |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `GET /api/health/caddy` | GET | Check Caddy health and route count |
| `GET /api/apps/:id/instances` | GET | List instances with container status |
| `GET /api/apps/:id/instances/:instanceId/logs` | GET | Get container logs |
| `POST /api/apps/:id/deploy` | POST | Deploy app (containers + routing) |
| `POST /api/apps/:id/stop` | POST | Stop app (containers + routing) |
| `POST /api/apps/:id/restart` | POST | Restart all containers |
| `PATCH /api/apps/:id/scale` | PATCH | Scale app (containers + routing) |
| `DELETE /api/apps/:id` | DELETE | Delete app (containers + routing) |

## Quick Start

```bash
# 1. Start the control plane with Caddy
cd deploy
docker compose up -d

# 2. Create an app
curl -X POST http://localhost:5005/api/apps \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "name": "my-web-app",
    "image": "nginx:alpine",
    "domain": "myapp.example.com",
    "desiredReplicas": 2,
    "serverIds": ["<server-id-1>", "<server-id-2>"],
    "loadBalancer": { "policy": "round_robin" },
    "healthCheck": { "path": "/", "interval": 10, "timeout": 5 }
  }'

# 3. Deploy the app
curl -X POST http://localhost:5005/api/apps/<app-id>/deploy \
  -H "Authorization: Bearer <token>"

# 4. Scale the app
curl -X PATCH http://localhost:5005/api/apps/<app-id>/scale \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"desiredReplicas": 5}'

# 5. View container logs
curl http://localhost:5005/api/apps/<app-id>/instances/<instance-id>/logs?lines=50 \
  -H "Authorization: Bearer <token>"
```

## Flow Diagram

```
User Request                    Control Plane
    │                               │
    │  POST /apps/:id/deploy        │
    │──────────────────────────────▶│
    │                               │
    │                    ┌──────────┴──────────┐
    │                    │   For each server   │
    │                    │   (round-robin)     │
    │                    └──────────┬──────────┘
    │                               │
    │                    ┌──────────▼──────────┐
    │                    │   SSH to server     │
    │                    │   docker pull       │
    │                    │   docker run        │
    │                    └──────────┬──────────┘
    │                               │
    │                    ┌──────────▼──────────┐
    │                    │   Update instance   │
    │                    │   status in DB      │
    │                    └──────────┬──────────┘
    │                               │
    │                    ┌──────────▼──────────┐
    │                    │   Sync Caddy        │
    │                    │   routing           │
    │                    └──────────┬──────────┘
    │                               │
    │  { success, instances }       │
    │◀──────────────────────────────│
```
