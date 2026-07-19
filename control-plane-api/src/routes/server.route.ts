import express from "express";
import { requireAuth, requireScope } from "../utils";
import { useServerController } from "../resources";

const router = express.Router();

const {
  add,
  getById,
  getAll,
  updateById,
  deleteById,
  getStatus,
  validateConnection,
  checkHealth,
  testConnection,
  bootstrap,
  setup,
  getSetupStatus,
  setupStream,
  getServerApps,
  getServerDatabases,
} = useServerController();

// Test connection before adding (no server ID required)
router.post("/test-connection", requireAuth, requireScope("servers:write"), testConnection);

router.get("/", requireAuth, requireScope("servers:read"), getAll);
router.post("/", requireAuth, requireScope("servers:write"), add);
router.get("/:id", requireAuth, requireScope("servers:read"), getById);
router.patch("/:id", requireAuth, requireScope("servers:write"), updateById);
router.delete("/:id", requireAuth, requireScope("servers:write"), deleteById);
router.get("/:id/status", requireAuth, requireScope("servers:read"), getStatus);

// Validate existing server's SSH connection
router.post("/:id/validate", requireAuth, requireScope("servers:write"), validateConnection);

// Check server health - tests SSH and gathers system resources
router.post("/:id/check-health", requireAuth, requireScope("servers:write"), checkHealth);

// Bootstrap server for deployments (Docker setup)
router.post("/:id/bootstrap", requireAuth, requireScope("servers:write"), bootstrap);

// Setup server for deployments (async — returns immediately, runs in background)
router.post("/:id/setup", requireAuth, requireScope("servers:write"), setup);

// Get current setup status and step log
router.get("/:id/setup-status", requireAuth, requireScope("servers:read"), getSetupStatus);

// SSE stream for real-time setup progress
router.get("/:id/setup-stream", requireAuth, requireScope("servers:read"), setupStream);

// Resources hosted on this server
router.get("/:id/apps", requireAuth, requireScope("servers:read"), getServerApps);
router.get("/:id/databases", requireAuth, requireScope("servers:read"), getServerDatabases);

export default router;
