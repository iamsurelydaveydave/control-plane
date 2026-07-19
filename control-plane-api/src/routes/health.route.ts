import express from "express";
import os from "os";
import { useCaddyService } from "../services/caddy.service";

const router = express.Router();

// Basic health check
router.get("/", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

// Detailed health check
router.get("/detailed", async (_req, res) => {
  const caddyService = useCaddyService();
  const caddyHealth = await caddyService.healthCheck();

  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
    },
    system: {
      hostname: os.hostname(),
      platform: os.platform(),
      cpus: os.cpus().length,
      loadAvg: os.loadavg(),
    },
    caddy: {
      enabled: caddyService.isEnabled(),
      healthy: caddyHealth.healthy,
      error: caddyHealth.error,
    },
  });
});

// Caddy-specific health check
router.get("/caddy", async (_req, res) => {
  const caddyService = useCaddyService();
  
  if (!caddyService.isEnabled()) {
    res.json({
      status: "disabled",
      message: "Caddy integration is disabled",
    });
    return;
  }

  const health = await caddyService.healthCheck();
  
  if (health.healthy) {
    const routes = await caddyService.getRoutes();
    res.json({
      status: "ok",
      routeCount: routes?.length || 0,
    });
  } else {
    res.status(503).json({
      status: "unhealthy",
      error: health.error,
    });
  }
});

export default router;
