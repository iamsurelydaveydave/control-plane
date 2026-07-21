import express from "express";
import { requireAuth } from "../utils";
import { requirePermission } from "../utils/auth.middleware";
import { useAPITokenController, auditMiddleware } from "../resources";

const router = express.Router();
const controller = useAPITokenController();

router.get("/", requireAuth, requirePermission("settings:read"), controller.getAll);
router.get("/scopes", requireAuth, requirePermission("settings:read"), controller.getScopes);
router.post("/", requireAuth, requirePermission("settings:update"), auditMiddleware("api_token_create", "api_token"), controller.create);
router.delete("/:id", requireAuth, requirePermission("settings:update"), auditMiddleware("api_token_revoke", "api_token"), controller.deleteToken);

export default router;
