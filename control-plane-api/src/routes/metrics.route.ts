import express from "express";
import { requireAuth, requirePermission } from "../utils/auth.middleware";
import { useMetricsService } from "../services/metrics.service";

const router = express.Router();

// All metrics routes require authentication
router.use(requireAuth);

/**
 * GET /api/metrics/system
 * System metrics (CPU, memory, disk of the control plane server)
 */
router.get("/system", requirePermission("settings:read"), async (_req, res, next) => {
  try {
    const metrics = useMetricsService();
    const data = await metrics.getSystemMetrics();
    res.json(data);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/metrics/cluster
 * K8s cluster resource usage
 */
router.get("/cluster", requirePermission("nodes:read"), async (_req, res, next) => {
  try {
    const metrics = useMetricsService();
    const data = await metrics.getClusterMetrics();
    res.json(data);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/metrics/databases
 * All databases metrics summary
 */
router.get("/databases", requirePermission("databases:read"), async (_req, res, next) => {
  try {
    const metrics = useMetricsService();
    const data = await metrics.getDatabaseMetrics();
    res.json(data);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/metrics/apps
 * All apps metrics summary
 */
router.get("/apps", requirePermission("apps:read"), async (_req, res, next) => {
  try {
    const metrics = useMetricsService();
    const data = await metrics.getAppMetrics();
    res.json(data);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/metrics/overview
 * Combined dashboard data
 */
router.get("/overview", requirePermission("apps:read"), async (_req, res, next) => {
  try {
    const metrics = useMetricsService();
    const data = await metrics.getOverview();
    res.json(data);
  } catch (error) {
    next(error);
  }
});

export default router;
