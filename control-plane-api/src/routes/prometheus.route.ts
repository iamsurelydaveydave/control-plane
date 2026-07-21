/**
 * Prometheus Metrics Route
 *
 * Exposes Prometheus-format metrics at /api/prometheus/metrics.
 * This endpoint is separate from the application metrics endpoint
 * and is designed to be scraped by Prometheus.
 *
 * Note: This endpoint is intentionally unauthenticated to allow
 * Prometheus to scrape metrics. In production, consider:
 * - Network-level security (only allow Prometheus to access)
 * - Basic auth via ServiceMonitor
 * - IP whitelisting
 */
import express from "express";
import { getMetrics } from "../utils/prometheus";

const router = express.Router();

/**
 * GET /api/prometheus/metrics
 *
 * Returns metrics in Prometheus exposition format.
 * Includes:
 * - HTTP request metrics (duration, count by status)
 * - Node.js runtime metrics (memory, CPU, event loop)
 * - MongoDB metrics (connection status, query times)
 * - Redis metrics (cache hits/misses)
 * - Business metrics (databases, apps, deployments)
 */
router.get("/metrics", getMetrics);

export default router;
