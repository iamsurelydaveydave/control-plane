import express from "express";
import { requireAuth, requirePermission } from "../utils";
import { usePipelineController } from "../resources/pipeline";

const router = express.Router();

const {
  approvePromotion,
  rejectPromotion,
  getPromotion,
} = usePipelineController();

// ---------------------------------------------------------------------------
// Promotion Actions (separate from pipeline routes for cleaner URLs)
// ---------------------------------------------------------------------------

router.get("/:id", requireAuth, requirePermission("pipelines:read"), getPromotion);
router.post("/:id/approve", requireAuth, requirePermission("pipelines:approve"), approvePromotion);
router.post("/:id/reject", requireAuth, requirePermission("pipelines:approve"), rejectPromotion);

export default router;
