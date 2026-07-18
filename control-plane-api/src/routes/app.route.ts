import express from "express";
import { requireAuth, requireScope } from "../utils";
import { useAppController } from "../resources";

const router = express.Router();

const { add, getById, getAll, updateById, deleteById, scale, restart, deploy } = useAppController();

router.get("/", requireAuth, requireScope("apps:read"), getAll);
router.post("/", requireAuth, requireScope("apps:write"), add);
router.get("/:id", requireAuth, requireScope("apps:read"), getById);
router.patch("/:id", requireAuth, requireScope("apps:write"), updateById);
router.delete("/:id", requireAuth, requireScope("apps:write"), deleteById);
router.patch("/:id/scale", requireAuth, requireScope("apps:write"), scale);
router.post("/:id/restart", requireAuth, requireScope("deployments:write"), restart);
router.post("/:id/deploy", requireAuth, requireScope("deployments:write"), deploy);

export default router;
