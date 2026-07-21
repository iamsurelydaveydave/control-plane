import express from "express";
import { requireAuth, requirePermission } from "../utils";
import { useSecretController } from "../resources/secret";

const router = express.Router();

const { add, getById, getAll, getGlobal, updateById, deleteById } = useSecretController();

// List secrets (metadata only, values never returned)
router.get("/", requireAuth, requirePermission("settings:read"), getAll);
router.get("/global", requireAuth, requirePermission("settings:read"), getGlobal);

// CRUD
router.post("/", requireAuth, requirePermission("settings:update"), add);
router.get("/:id", requireAuth, requirePermission("settings:read"), getById);
router.patch("/:id", requireAuth, requirePermission("settings:update"), updateById);
router.delete("/:id", requireAuth, requirePermission("settings:update"), deleteById);

export default router;
