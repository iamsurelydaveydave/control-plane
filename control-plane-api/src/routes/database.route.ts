import express from "express";
import { requireAuth, requireScope } from "../utils";
import { useDatabaseController } from "../resources";

const router = express.Router();

const {
  add,
  getById,
  getAll,
  deleteById,
  provision,
  reprovision,
  remove,
  backup,
  getCredentials,
  getLogs,
} = useDatabaseController();

router.get("/", requireAuth, requireScope("databases:read"), getAll);
router.post("/", requireAuth, requireScope("databases:write"), add);
router.get("/:id", requireAuth, requireScope("databases:read"), getById);
router.delete("/:id", requireAuth, requireScope("databases:write"), deleteById);
router.post("/:id/provision", requireAuth, requireScope("databases:write"), provision);
router.post("/:id/reprovision", requireAuth, requireScope("databases:write"), reprovision);
router.post("/:id/remove", requireAuth, requireScope("databases:write"), remove);
router.post("/:id/backup", requireAuth, requireScope("databases:write"), backup);
router.get("/:id/credentials", requireAuth, requireScope("databases:read"), getCredentials);
router.get("/:id/logs", requireAuth, requireScope("databases:read"), getLogs);

export default router;
