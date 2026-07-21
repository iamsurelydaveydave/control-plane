/**
 * Prometheus Metrics Utility
 *
 * Provides Prometheus-format metrics for monitoring with prom-client.
 * Exposes HTTP request metrics, Node.js runtime metrics, and custom
 * business metrics for Control Plane.
 */
import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from "prom-client";
import { Request, Response, NextFunction } from "express";

// Create a custom registry
const register = new Registry();

// Collect default Node.js metrics (CPU, memory, event loop, etc.)
collectDefaultMetrics({
  register,
  prefix: "",
  labels: { app: "control-plane-api" },
});

// =============================================================================
// HTTP Request Metrics
// =============================================================================

// HTTP request duration histogram
const httpRequestDuration = new Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

// HTTP request counter
const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status_code"],
  registers: [register],
});

// =============================================================================
// MongoDB Metrics
// =============================================================================

// MongoDB connection status
export const mongodbUp = new Gauge({
  name: "mongodb_up",
  help: "MongoDB connection status (1 = up, 0 = down)",
  registers: [register],
});

// MongoDB connection pool size
export const mongodbPoolSize = new Gauge({
  name: "mongodb_pool_size",
  help: "MongoDB connection pool size",
  registers: [register],
});

// MongoDB query duration histogram
export const mongodbQueryDuration = new Histogram({
  name: "mongodb_query_duration_seconds",
  help: "Duration of MongoDB queries in seconds",
  labelNames: ["operation", "collection"],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

// =============================================================================
// Redis Metrics
// =============================================================================

// Redis connection status
export const redisUp = new Gauge({
  name: "redis_up",
  help: "Redis connection status (1 = up, 0 = down)",
  registers: [register],
});

// Redis cache hits
export const redisCacheHits = new Counter({
  name: "redis_cache_hits_total",
  help: "Total number of Redis cache hits",
  registers: [register],
});

// Redis cache misses
export const redisCacheMisses = new Counter({
  name: "redis_cache_misses_total",
  help: "Total number of Redis cache misses",
  registers: [register],
});

// =============================================================================
// Business Metrics (Control Plane specific)
// =============================================================================

// Total databases
export const databasesTotal = new Gauge({
  name: "control_plane_databases_total",
  help: "Total number of databases managed by Control Plane",
  registers: [register],
});

// Total apps
export const appsTotal = new Gauge({
  name: "control_plane_apps_total",
  help: "Total number of apps managed by Control Plane",
  registers: [register],
});

// Active deployments
export const deploymentsActive = new Gauge({
  name: "control_plane_deployments_active",
  help: "Number of currently active deployments",
  registers: [register],
});

// Total users
export const usersTotal = new Gauge({
  name: "control_plane_users_total",
  help: "Total number of users",
  registers: [register],
});

// =============================================================================
// Middleware
// =============================================================================

/**
 * Express middleware to track HTTP request metrics.
 * Should be applied early in the middleware chain.
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip metrics endpoint itself to avoid self-referential metrics
  if (req.path === "/api/prometheus/metrics") {
    return next();
  }

  const startTime = process.hrtime.bigint();

  // Override res.end to capture metrics after response is sent
  const originalEnd = res.end.bind(res);
  res.end = function (this: Response, ...args: unknown[]): Response {
    const endTime = process.hrtime.bigint();
    const durationSeconds = Number(endTime - startTime) / 1e9;

    // Normalize route for better aggregation (replace IDs with :id)
    const route = normalizeRoute(req.route?.path || req.path);

    const labels = {
      method: req.method,
      route,
      status_code: String(res.statusCode),
    };

    httpRequestDuration.observe(labels, durationSeconds);
    httpRequestsTotal.inc(labels);

    return originalEnd.apply(this, args as Parameters<typeof originalEnd>);
  };

  next();
}

/**
 * Normalize route paths by replacing dynamic segments with placeholders.
 * e.g., "/api/users/507f1f77bcf86cd799439011" -> "/api/users/:id"
 */
function normalizeRoute(path: string): string {
  // Replace MongoDB ObjectIds
  let normalized = path.replace(/\/[a-f0-9]{24}(?=\/|$)/gi, "/:id");
  // Replace UUIDs
  normalized = normalized.replace(/\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}(?=\/|$)/gi, "/:id");
  // Replace numeric IDs
  normalized = normalized.replace(/\/\d+(?=\/|$)/g, "/:id");
  return normalized;
}

// =============================================================================
// Metrics Endpoint Handler
// =============================================================================

/**
 * Handler for /api/prometheus/metrics endpoint.
 * Returns metrics in Prometheus exposition format.
 */
export async function getMetrics(_req: Request, res: Response): Promise<void> {
  try {
    res.set("Content-Type", register.contentType);
    res.end(await register.metrics());
  } catch (error) {
    res.status(500).end("Error collecting metrics");
  }
}

/**
 * Get the metrics registry (for testing or advanced use cases).
 */
export function getRegistry(): Registry {
  return register;
}

// =============================================================================
// Helper Functions for Updating Business Metrics
// =============================================================================

/**
 * Update business metrics (call periodically from a worker or on-demand).
 */
export async function updateBusinessMetrics(counts: {
  databases?: number;
  apps?: number;
  deployments?: number;
  users?: number;
}): Promise<void> {
  if (counts.databases !== undefined) databasesTotal.set(counts.databases);
  if (counts.apps !== undefined) appsTotal.set(counts.apps);
  if (counts.deployments !== undefined) deploymentsActive.set(counts.deployments);
  if (counts.users !== undefined) usersTotal.set(counts.users);
}

/**
 * Record a cache hit.
 */
export function recordCacheHit(): void {
  redisCacheHits.inc();
}

/**
 * Record a cache miss.
 */
export function recordCacheMiss(): void {
  redisCacheMisses.inc();
}

/**
 * Record a MongoDB query duration.
 */
export function recordMongoQuery(operation: string, collection: string, durationMs: number): void {
  mongodbQueryDuration.observe({ operation, collection }, durationMs / 1000);
}

/**
 * Set MongoDB connection status.
 */
export function setMongoStatus(isUp: boolean): void {
  mongodbUp.set(isUp ? 1 : 0);
}

/**
 * Set Redis connection status.
 */
export function setRedisStatus(isUp: boolean): void {
  redisUp.set(isUp ? 1 : 0);
}
