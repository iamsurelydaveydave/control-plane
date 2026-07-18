import express from "express";
import os from "os";

const router = express.Router();

// Basic health check
router.get("/", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

// Detailed health check
router.get("/detailed", (_req, res) => {
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
  });
});

export default router;
