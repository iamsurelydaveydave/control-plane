import express from "express";
import { useAlertController } from "../resources/alert";
import { requireAuth, requirePermission } from "../utils/auth.middleware";

const router = express.Router();
const controller = useAlertController();

// All alert routes require authentication
router.use(requireAuth);

// List alerts (with optional filters: status, severity, source)
router.get("/", requirePermission("alerts:read"), controller.list);

// Get active alert count with breakdown
router.get("/count", requirePermission("alerts:read"), controller.getCount);

// Manually trigger health checks (admin only)
router.post("/check", requirePermission("admin:*"), controller.runHealthChecks);

// Get alert by ID
router.get("/:id", requirePermission("alerts:read"), controller.getById);

// Acknowledge alert
router.post("/:id/acknowledge", requirePermission("alerts:acknowledge"), controller.acknowledge);

// Resolve alert
router.post("/:id/resolve", requirePermission("alerts:resolve"), controller.resolve);

// Delete alert (admin only)
router.delete("/:id", requirePermission("admin:*"), controller.remove);

export default router;
