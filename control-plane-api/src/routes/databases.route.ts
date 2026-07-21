import express from "express";
import { useDatabaseController, auditMiddleware } from "../resources";
import { requireAuth, requirePermission } from "../utils/auth.middleware";

const router = express.Router();
const controller = useDatabaseController();

// All database routes require authentication
router.use(requireAuth);

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

// List databases (paginated)
router.get("/", requirePermission("databases:read"), controller.list);

// Create database
router.post("/", requirePermission("databases:create"), auditMiddleware("create", "database"), controller.create);

// Get database by ID
router.get("/:id", requirePermission("databases:read"), controller.getById);

// Update database
router.patch("/:id", requirePermission("databases:update"), auditMiddleware("update", "database"), controller.update);

// Delete database
router.delete("/:id", requirePermission("databases:delete"), auditMiddleware("delete", "database"), controller.remove);

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

// Reprovision database
router.post("/:id/reprovision", requirePermission("databases:update"), auditMiddleware("update", "database"), controller.reprovision);

// Get credentials (sensitive — requires update permission)
router.get("/:id/credentials", requirePermission("databases:update"), controller.getCredentials);

// Get replica set health
router.get("/:id/health", requirePermission("databases:read"), controller.getHealth);

// Get deployment logs
router.get("/:id/logs", requirePermission("databases:read"), controller.getLogs);

// ---------------------------------------------------------------------------
// Node Management
// ---------------------------------------------------------------------------

// Add node
router.post("/:id/nodes", requirePermission("databases:update"), auditMiddleware("update", "database"), controller.addNode);

// Remove node
router.delete("/:id/nodes/:serverId", requirePermission("databases:update"), auditMiddleware("update", "database"), controller.removeNode);

// ---------------------------------------------------------------------------
// DNS Management
// ---------------------------------------------------------------------------

// Configure DNS
router.post("/:id/dns", requirePermission("databases:update"), auditMiddleware("update", "database"), controller.configureDNS);

// Remove DNS
router.delete("/:id/dns", requirePermission("databases:update"), auditMiddleware("update", "database"), controller.removeDNS);

// ---------------------------------------------------------------------------
// TLS Management
// ---------------------------------------------------------------------------

// Enable TLS
router.post("/:id/tls", requirePermission("databases:update"), auditMiddleware("update", "database"), controller.enableTLS);

// Disable TLS
router.delete("/:id/tls", requirePermission("databases:update"), auditMiddleware("update", "database"), controller.disableTLS);

// Get TLS status
router.get("/:id/tls", requirePermission("databases:read"), controller.getTLSStatus);

// Download CA certificate
router.get("/:id/tls/ca", requirePermission("databases:read"), controller.getCACertificate);

// ---------------------------------------------------------------------------
// Backup Management
// ---------------------------------------------------------------------------

// Configure backup
router.post("/:id/backup/config", requirePermission("databases:backup"), auditMiddleware("backup", "database"), controller.configureBackup);

// Trigger manual backup
router.post("/:id/backup", requirePermission("databases:backup"), auditMiddleware("backup", "database"), controller.triggerBackup);

// List backups
router.get("/:id/backups", requirePermission("databases:read"), controller.listBackups);

// Restore from backup
router.post("/:id/backup/restore", requirePermission("databases:backup"), auditMiddleware("restore", "database"), controller.restoreBackup);

export default router;
