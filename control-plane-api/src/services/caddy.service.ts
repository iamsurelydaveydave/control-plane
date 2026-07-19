import { ObjectId } from "mongodb";
import { logger, InternalServerError } from "../utils";

// Types
export type TLoadBalancerPolicy =
  | "round_robin"
  | "least_conn"
  | "first"
  | "random"
  | "ip_hash"
  | "uri_hash"
  | "cookie";

export type TCaddyUpstream = {
  dial: string; // "ip:port"
};

export type TCaddyHealthCheck = {
  active?: {
    uri: string;
    interval: string;
    timeout: string;
  };
  passive?: {
    fail_duration: string;
    max_fails: number;
    unhealthy_status: number[];
  };
};

export type TCaddyLoadBalancing = {
  selection_policy: {
    policy: TLoadBalancerPolicy;
    cookie?: { name: string }; // For cookie-based sticky sessions
  };
};

export type TCaddyHandler = {
  handler: "reverse_proxy";
  upstreams: TCaddyUpstream[];
  load_balancing?: TCaddyLoadBalancing;
  health_checks?: TCaddyHealthCheck;
};

export type TCaddyRoute = {
  "@id"?: string; // Route ID for updates/deletes
  match: [{ host: string[] }];
  handle: TCaddyHandler[];
  terminal?: boolean;
};

export type TCaddyServer = {
  listen: string[];
  routes: TCaddyRoute[];
};

export type TCaddyConfig = {
  apps: {
    http: {
      servers: {
        srv0: TCaddyServer;
      };
    };
  };
};

// App types (imported from app.model but defined here for service independence)
export type TAppForCaddy = {
  _id: ObjectId;
  domain?: string;
  healthCheck?: {
    path: string;
    interval: number;
    timeout: number;
  };
  loadBalancer?: {
    policy: TLoadBalancerPolicy;
    stickySessionCookie?: string;
  };
};

export type TInstanceForCaddy = {
  _id: ObjectId;
  appId: ObjectId;
  serverId: ObjectId;
  port: number;
  status: string;
};

export type TServerForCaddy = {
  _id: ObjectId;
  host: string;
  privateIp?: string;
};

// Configuration
const CADDY_ADMIN_URL = process.env.CADDY_ADMIN_URL || "http://localhost:2019";
const CADDY_ENABLED = process.env.CADDY_ENABLED !== "false"; // Enabled by default
const CADDY_TIMEOUT_MS = 5000;

/**
 * Caddy Service
 * Manages dynamic reverse proxy configuration via Caddy Admin API
 */
export function useCaddyService() {
  /**
   * Check if Caddy integration is enabled
   */
  function isEnabled(): boolean {
    return CADDY_ENABLED;
  }

  /**
   * Make HTTP request to Caddy Admin API
   */
  async function caddyRequest<T = any>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    body?: any
  ): Promise<T | null> {
    if (!CADDY_ENABLED) {
      logger.log({
        level: "debug",
        message: `Caddy disabled, skipping ${method} ${path}`,
      });
      return null;
    }

    const url = `${CADDY_ADMIN_URL}${path}`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CADDY_TIMEOUT_MS);

      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        logger.log({
          level: "error",
          message: `Caddy API error: ${response.status} ${errorText}`,
        });
        throw new InternalServerError(`Caddy API error: ${response.status}`);
      }

      // Some endpoints return empty response
      const text = await response.text();
      if (!text) return null;

      return JSON.parse(text) as T;
    } catch (error: any) {
      if (error.name === "AbortError") {
        logger.log({
          level: "error",
          message: `Caddy API timeout after ${CADDY_TIMEOUT_MS}ms`,
        });
        throw new InternalServerError("Caddy API timeout");
      }

      if (error instanceof InternalServerError) throw error;

      logger.log({
        level: "error",
        message: `Caddy API request failed: ${error.message}`,
      });

      // Don't throw on connection errors - Caddy might not be running yet
      if (error.code === "ECONNREFUSED" || error.cause?.code === "ECONNREFUSED") {
        logger.log({
          level: "warn",
          message: "Caddy not reachable - reverse proxy routing not updated",
        });
        return null;
      }

      throw new InternalServerError(`Caddy API failed: ${error.message}`);
    }
  }

  /**
   * Build a Caddy route for an app
   */
  function buildRoute(
    app: TAppForCaddy,
    instances: TInstanceForCaddy[],
    servers: Map<string, TServerForCaddy>
  ): TCaddyRoute | null {
    if (!app.domain) return null;

    const runningInstances = instances.filter((i) => i.status === "running");
    if (runningInstances.length === 0) return null;

    // Build upstreams from running instances
    const upstreams: TCaddyUpstream[] = runningInstances.map((instance) => {
      const server = servers.get(instance.serverId.toString());
      if (!server) {
        logger.log({
          level: "warn",
          message: `Server ${instance.serverId} not found for instance ${instance._id}`,
        });
        return { dial: `unknown:${instance.port}` };
      }
      // Prefer privateIp for internal routing, fall back to public host
      const ip = server.privateIp || server.host;
      return { dial: `${ip}:${instance.port}` };
    });

    // Filter out any unknown upstreams
    const validUpstreams = upstreams.filter((u) => !u.dial.startsWith("unknown:"));
    if (validUpstreams.length === 0) return null;

    // Build handler
    const handler: TCaddyHandler = {
      handler: "reverse_proxy",
      upstreams: validUpstreams,
    };

    // Add load balancing config
    const policy = app.loadBalancer?.policy || "round_robin";
    handler.load_balancing = {
      selection_policy: {
        policy,
        ...(policy === "cookie" && app.loadBalancer?.stickySessionCookie
          ? { cookie: { name: app.loadBalancer.stickySessionCookie } }
          : {}),
      },
    };

    // Add health checks if configured
    if (app.healthCheck) {
      handler.health_checks = {
        active: {
          uri: app.healthCheck.path,
          interval: `${app.healthCheck.interval}s`,
          timeout: `${app.healthCheck.timeout}s`,
        },
        passive: {
          fail_duration: "30s",
          max_fails: 3,
          unhealthy_status: [500, 502, 503, 504],
        },
      };
    }

    return {
      "@id": `app-${app._id.toString()}`,
      match: [{ host: [app.domain] }],
      handle: [handler],
      terminal: true,
    };
  }

  /**
   * Sync routing for a single app
   * Call after deploy, scale, or instance status change
   */
  async function syncAppRouting(
    app: TAppForCaddy,
    instances: TInstanceForCaddy[],
    servers: Map<string, TServerForCaddy>
  ): Promise<void> {
    if (!CADDY_ENABLED) return;

    const routeId = `app-${app._id.toString()}`;
    const route = buildRoute(app, instances, servers);

    if (!route) {
      // No valid route - remove existing if any
      await removeAppRouting(app._id.toString());
      return;
    }

    logger.log({
      level: "info",
      message: `Syncing Caddy route for ${app.domain} with ${route.handle[0].upstreams.length} upstreams`,
    });

    // Try to update existing route first, create if not exists
    try {
      await caddyRequest("PATCH", `/id/${routeId}`, route);
    } catch {
      // Route doesn't exist, add to routes array
      await caddyRequest(
        "POST",
        "/config/apps/http/servers/srv0/routes",
        route
      );
    }
  }

  /**
   * Remove routing for an app
   * Call when app is deleted or domain is removed
   */
  async function removeAppRouting(appId: string): Promise<void> {
    if (!CADDY_ENABLED) return;

    const routeId = `app-${appId}`;

    logger.log({
      level: "info",
      message: `Removing Caddy route ${routeId}`,
    });

    try {
      await caddyRequest("DELETE", `/id/${routeId}`);
    } catch (error) {
      // Route might not exist, that's fine
      logger.log({
        level: "debug",
        message: `Route ${routeId} not found or already removed`,
      });
    }
  }

  /**
   * Rebuild full Caddy configuration from database state
   * Call on control plane startup
   */
  async function rebuildFullConfig(
    apps: TAppForCaddy[],
    instances: TInstanceForCaddy[],
    servers: TServerForCaddy[]
  ): Promise<void> {
    if (!CADDY_ENABLED) return;

    const serverMap = new Map(
      servers.map((s) => [s._id.toString(), s])
    );

    // Build routes for all apps with domains
    const routes: TCaddyRoute[] = [];

    for (const app of apps) {
      if (!app.domain) continue;

      const appInstances = instances.filter((i) =>
        i.appId.equals(app._id)
      );

      const route = buildRoute(app, appInstances, serverMap);
      if (route) {
        routes.push(route);
      }
    }

    logger.log({
      level: "info",
      message: `Rebuilding Caddy config with ${routes.length} routes`,
    });

    const config: TCaddyConfig = {
      apps: {
        http: {
          servers: {
            srv0: {
              listen: [":443", ":80"],
              routes,
            },
          },
        },
      },
    };

    await caddyRequest("POST", "/load", config);
  }

  /**
   * Health check for Caddy
   */
  async function healthCheck(): Promise<{ healthy: boolean; error?: string }> {
    if (!CADDY_ENABLED) {
      return { healthy: true }; // Caddy disabled, consider healthy
    }

    try {
      const config = await caddyRequest<any>("GET", "/config/");
      return { healthy: config !== null };
    } catch (error: any) {
      return { healthy: false, error: error.message };
    }
  }

  /**
   * Get current Caddy configuration
   */
  async function getConfig(): Promise<TCaddyConfig | null> {
    return caddyRequest<TCaddyConfig>("GET", "/config/");
  }

  /**
   * Get routes for debugging
   */
  async function getRoutes(): Promise<TCaddyRoute[] | null> {
    const routes = await caddyRequest<TCaddyRoute[]>(
      "GET",
      "/config/apps/http/servers/srv0/routes"
    );
    return routes;
  }

  return {
    isEnabled,
    syncAppRouting,
    removeAppRouting,
    rebuildFullConfig,
    healthCheck,
    getConfig,
    getRoutes,
  };
}
