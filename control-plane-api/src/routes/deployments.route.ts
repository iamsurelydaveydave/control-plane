import express from "express";
import { requireAuth } from "../utils";
import { requirePermission } from "../utils/auth.middleware";
import { useDeploymentApprovalController } from "../resources/deployment-approval";

const router = express.Router();

const approvalController = useDeploymentApprovalController();

// =============================================================================
// Deployment Approval Endpoints
// =============================================================================

/**
 * Get all pending approvals
 * GET /api/deployments/approvals/pending
 */
router.get(
  "/approvals/pending",
  requireAuth,
  requirePermission("deployments:read"),
  approvalController.getPending
);

/**
 * Get deployment approval by ID
 * GET /api/deployments/:id
 */
router.get(
  "/:id",
  requireAuth,
  requirePermission("deployments:read"),
  approvalController.getById
);

/**
 * Approve a deployment
 * POST /api/deployments/:id/approve
 */
router.post(
  "/:id/approve",
  requireAuth,
  requirePermission("deployments:update"),
  approvalController.approve
);

/**
 * Reject a deployment
 * POST /api/deployments/:id/reject
 */
router.post(
  "/:id/reject",
  requireAuth,
  requirePermission("deployments:update"),
  approvalController.reject
);

export default router;
