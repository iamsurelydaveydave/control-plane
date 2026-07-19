import express from "express";
import { requireAuth, requireScope } from "../utils";
import { useSecretController } from "../resources/secret";

const router = express.Router();

const { add, getById, getAll, getGlobal, updateById, deleteById } = useSecretController();

// List secrets (metadata only, values never returned)
router.get("/", requireAuth, requireScope("settings:read"), getAll);
router.get("/global", requireAuth, requireScope("settings:read"), getGlobal);

// CRUD
router.post("/", requireAuth, requireScope("settings:write"), add);
router.get("/:id", requireAuth, requireScope("settings:read"), getById);
router.patch("/:id", requireAuth, requireScope("settings:write"), updateById);
router.delete("/:id", requireAuth, requireScope("settings:write"), deleteById);

export default router;
