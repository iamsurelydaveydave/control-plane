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

// Bootstrap server for Kamal deployments (Docker + kamal-proxy)
router.post("/:id/bootstrap", requireAuth, requireScope("servers:write"), bootstrap);

export default router;
