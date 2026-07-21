import express from "express";
import { useAddonController, auditMiddleware } from "../resources";
import { requireAuth, requirePermission } from "../utils/auth.middleware";

const router = express.Router();
const controller = useAddonController();

// All addon routes require authentication
router.use(requireAuth);

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

// Get available addon types
router.get("/catalog", requirePermission("addons:read"), controller.getCatalog);

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

// List addons (paginated)
router.get("/", requirePermission("addons:read"), controller.list);

// Create addon (deploys Helm chart)
router.post("/", requirePermission("addons:create"), auditMiddleware("create", "addon"), controller.create);

// Get addon by ID
router.get("/:id", requirePermission("addons:read"), controller.getById);

// Update addon (triggers Helm upgrade)
router.patch("/:id", requirePermission("addons:update"), auditMiddleware("update", "addon"), controller.update);

// Delete addon (uninstalls Helm release)
router.delete("/:id", requirePermission("addons:delete"), auditMiddleware("delete", "addon"), controller.remove);

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

// Get connection info (sensitive)
router.get("/:id/connection", requirePermission("addons:update"), controller.getConnection);

// Refresh addon status from Helm
router.post("/:id/refresh", requirePermission("addons:read"), controller.refresh);

// Start addon
router.post("/:id/start", requirePermission("addons:update"), auditMiddleware("start", "addon"), controller.start);

// Stop addon
router.post("/:id/stop", requirePermission("addons:update"), auditMiddleware("stop", "addon"), controller.stop);

// Restart addon
router.post("/:id/restart", requirePermission("addons:update"), auditMiddleware("restart", "addon"), controller.restart);

// Get addon logs
router.get("/:id/logs", requirePermission("addons:read"), controller.getLogs);

// Get addon events
router.get("/:id/events", requirePermission("addons:read"), controller.getEvents);

export default router;
