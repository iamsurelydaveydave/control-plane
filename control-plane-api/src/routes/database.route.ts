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
  restore,
  getBackupRecords,
  getCredentials,
  getLogs,
  addNode,
  removeNode,
  getHealth,
  configureDNS,
  removeDNS,
} = useDatabaseController();

router.get("/", requireAuth, requireScope("databases:read"), getAll);
router.post("/", requireAuth, requireScope("databases:write"), add);
router.get("/:id", requireAuth, requireScope("databases:read"), getById);
router.delete("/:id", requireAuth, requireScope("databases:write"), deleteById);
router.post("/:id/provision", requireAuth, requireScope("databases:write"), provision);
router.post("/:id/reprovision", requireAuth, requireScope("databases:write"), reprovision);
router.post("/:id/remove", requireAuth, requireScope("databases:write"), remove);
router.post("/:id/backup", requireAuth, requireScope("databases:write"), backup);
router.post("/:id/restore", requireAuth, requireScope("databases:write"), restore);
router.get("/:id/backups", requireAuth, requireScope("databases:read"), getBackupRecords);
router.get("/:id/credentials", requireAuth, requireScope("databases:read"), getCredentials);
router.get("/:id/logs", requireAuth, requireScope("databases:read"), getLogs);

// Node management
router.post("/:id/nodes", requireAuth, requireScope("databases:write"), addNode);
router.delete("/:id/nodes/:serverId", requireAuth, requireScope("databases:write"), removeNode);
router.get("/:id/health", requireAuth, requireScope("databases:read"), getHealth);

// DNS management
// POST   /:id/dns  — create/re-create DNS records (needs Cloudflare config in settings)
// DELETE /:id/dns  — remove DNS records
router.post("/:id/dns", requireAuth, requireScope("databases:write"), configureDNS);
router.delete("/:id/dns", requireAuth, requireScope("databases:write"), removeDNS);

export default router;
