import express from "express";
import { requireAuth, requireScope } from "../utils";
import { useAppController } from "../resources";

const router = express.Router();

const {
  add,
  getById,
  getAll,
  updateById,
  deleteById,
  deploy,
  redeploy,
  rollback,
  stop,
  start,
  restart,
  getLogs,
  getVersion,
  appExec,
} = useAppController();

// CRUD
router.get("/", requireAuth, requireScope("apps:read"), getAll);
router.post("/", requireAuth, requireScope("apps:write"), add);
router.get("/:id", requireAuth, requireScope("apps:read"), getById);
router.patch("/:id", requireAuth, requireScope("apps:write"), updateById);
router.delete("/:id", requireAuth, requireScope("apps:write"), deleteById);

// Deployment
router.post("/:id/deploy", requireAuth, requireScope("deployments:write"), deploy);
router.post("/:id/redeploy", requireAuth, requireScope("deployments:write"), redeploy);
router.post("/:id/rollback", requireAuth, requireScope("deployments:write"), rollback);
router.post("/:id/rollback/:version", requireAuth, requireScope("deployments:write"), rollback);

// Lifecycle
router.post("/:id/stop", requireAuth, requireScope("apps:write"), stop);
router.post("/:id/start", requireAuth, requireScope("apps:write"), start);
router.post("/:id/restart", requireAuth, requireScope("apps:write"), restart);

// Inspection
router.get("/:id/logs", requireAuth, requireScope("apps:read"), getLogs);
router.get("/:id/version", requireAuth, requireScope("apps:read"), getVersion);

// Execution
router.post("/:id/exec", requireAuth, requireScope("apps:write"), appExec);

export default router;
