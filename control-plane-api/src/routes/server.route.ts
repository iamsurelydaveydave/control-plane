import express from "express";
import { requireAuth, requireScope } from "../utils";
import { useServerController } from "../resources";

const router = express.Router();

const { add, getById, getAll, updateById, deleteById, getStatus } = useServerController();

router.get("/", requireAuth, requireScope("servers:read"), getAll);
router.post("/", requireAuth, requireScope("servers:write"), add);
router.get("/:id", requireAuth, requireScope("servers:read"), getById);
router.patch("/:id", requireAuth, requireScope("servers:write"), updateById);
router.delete("/:id", requireAuth, requireScope("servers:write"), deleteById);
router.get("/:id/status", requireAuth, requireScope("servers:read"), getStatus);

export default router;
