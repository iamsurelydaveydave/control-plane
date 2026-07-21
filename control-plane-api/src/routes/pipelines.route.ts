import express from "express";
import { requireAuth, requirePermission } from "../utils";
import { usePipelineController } from "../resources/pipeline";

const router = express.Router();

const {
  list,
  create,
  getById,
  update,
  remove,
  getStatus,
  setupStages,
  deployToStage,
  rollbackStage,
  requestPromotion,
  listPromotions,
  approvePromotion,
  rejectPromotion,
  getPromotion,
} = usePipelineController();

// ---------------------------------------------------------------------------
// Pipeline CRUD
// ---------------------------------------------------------------------------

router.get("/", requireAuth, requirePermission("pipelines:read"), list);
router.post("/", requireAuth, requirePermission("pipelines:create"), create);
router.get("/:id", requireAuth, requirePermission("pipelines:read"), getById);
router.get("/:id/status", requireAuth, requirePermission("pipelines:read"), getStatus);
router.patch("/:id", requireAuth, requirePermission("pipelines:update"), update);
router.delete("/:id", requireAuth, requirePermission("pipelines:delete"), remove);

// ---------------------------------------------------------------------------
// Stage Operations
// ---------------------------------------------------------------------------

router.post("/:id/setup", requireAuth, requirePermission("pipelines:update"), setupStages);
router.post("/:id/deploy/:stage", requireAuth, requirePermission("pipelines:deploy"), deployToStage);
router.post("/:id/rollback/:stage", requireAuth, requirePermission("pipelines:deploy"), rollbackStage);

// ---------------------------------------------------------------------------
// Promotions
// ---------------------------------------------------------------------------

router.post("/:id/promote", requireAuth, requirePermission("pipelines:deploy"), requestPromotion);
router.get("/:id/promotions", requireAuth, requirePermission("pipelines:read"), listPromotions);

export default router;
