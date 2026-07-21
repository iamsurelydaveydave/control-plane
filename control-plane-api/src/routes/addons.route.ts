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

// Scale addon
router.post("/:id/scale", requirePermission("addons:update"), auditMiddleware("scale", "addon"), controller.scale);

// Get addon logs
router.get("/:id/logs", requirePermission("addons:read"), controller.getLogs);

// Get addon events
router.get("/:id/events", requirePermission("addons:read"), controller.getEvents);

// ---------------------------------------------------------------------------
// DNS (MongoDB Atlas-style subdomain)
// ---------------------------------------------------------------------------

// Configure DNS for addon
router.post("/:id/dns", requirePermission("addons:update"), auditMiddleware("update", "addon"), controller.configureDNS);

// Remove DNS configuration
router.delete("/:id/dns", requirePermission("addons:update"), auditMiddleware("update", "addon"), controller.removeDNS);

// ---------------------------------------------------------------------------
// Backup (S3)
// ---------------------------------------------------------------------------

// Configure backup settings
router.post("/:id/backup/config", requirePermission("addons:update"), auditMiddleware("update", "addon"), controller.configureBackup);

// Trigger manual backup
router.post("/:id/backup", requirePermission("addons:update"), auditMiddleware("backup", "addon"), controller.triggerBackup);

// List backups
router.get("/:id/backups", requirePermission("addons:read"), controller.listBackups);

export default router;
