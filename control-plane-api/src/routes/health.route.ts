import express from "express";
import os from "os";
import { useK8sService } from "../services/k8s.service";

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
  // K8s health check
  let k8sHealth: { enabled: boolean; available: boolean; nodes: number; error?: string } = {
    enabled: process.env.K8S_ENABLED === "true",
    available: false,
    nodes: 0,
  };

  if (k8sHealth.enabled) {
    try {
      const k8s = useK8sService();
      k8sHealth.available = await k8s.isAvailable();
      if (k8sHealth.available) {
        const nodes = await k8s.getNodes();
        k8sHealth.nodes = nodes.length;
      }
    } catch (err: any) {
      k8sHealth.available = false;
      k8sHealth.error = err.message || "K8s health check failed";
    }
  }

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
    kubernetes: k8sHealth,
  });
});

export default router;
