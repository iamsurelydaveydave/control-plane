import express from "express";
import { requireAuth } from "../utils/auth.middleware";
import { useMetricsService } from "../services/metrics.service";

const router = express.Router();

// All metrics routes require authentication
router.use(requireAuth);

/**
 * GET /api/metrics/system
 * System metrics (CPU, memory, disk of the control plane server)
 */
router.get("/system", async (_req, res, next) => {
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
router.get("/cluster", async (_req, res, next) => {
  try {
    const metrics = useMetricsService();
    const data = await metrics.getClusterMetrics();
    res.json(data);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/metrics/resources
 * All deployed resources metrics summary
 */
router.get("/resources", async (_req, res, next) => {
  try {
    const metrics = useMetricsService();
    const data = await metrics.getResourceMetrics();
    res.json(data);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/metrics/apps
 * All apps metrics summary
 */
router.get("/apps", async (_req, res, next) => {
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
router.get("/overview", async (_req, res, next) => {
  try {
    const metrics = useMetricsService();
    const data = await metrics.getOverview();
    res.json(data);
  } catch (error) {
    next(error);
  }
});

export default router;
