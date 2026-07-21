import express from "express";
import { requireAuth, requirePermission } from "../utils";
import { useAuditLogController } from "../resources";

const router = express.Router();

const {
  getAll,
  getStats,
  exportLogs,
  exportCSV,
  exportJSON,
  exportPDF,
  getComplianceReport,
  enforceRetention,
  previewRetention,
} = useAuditLogController();

// List audit logs with filtering and pagination
router.get("/", requireAuth, requirePermission("admin:*"), getAll);

// Get audit statistics
router.get("/stats", requireAuth, requirePermission("admin:*"), getStats);

// Export routes
router.get("/export", requireAuth, requirePermission("admin:*"), exportLogs);
router.get("/export/csv", requireAuth, requirePermission("admin:*"), exportCSV);
router.get("/export/json", requireAuth, requirePermission("admin:*"), exportJSON);
router.get("/export/pdf", requireAuth, requirePermission("admin:*"), exportPDF);

// Compliance report
router.get("/report", requireAuth, requirePermission("admin:*"), getComplianceReport);

// Data retention
router.get("/retention/preview", requireAuth, requirePermission("admin:*"), previewRetention);
router.post("/retention", requireAuth, requirePermission("admin:*"), enforceRetention);

export default router;
