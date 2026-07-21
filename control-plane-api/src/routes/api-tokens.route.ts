import express from "express";
import { requireAuth } from "../utils";
import { useAPITokenController, auditMiddleware } from "../resources";

const router = express.Router();
const controller = useAPITokenController();

router.get("/", requireAuth, controller.getAll);
router.get("/scopes", requireAuth, controller.getScopes);
router.post("/", requireAuth, auditMiddleware("api_token_create", "api_token"), controller.create);
router.delete("/:id", requireAuth, auditMiddleware("api_token_revoke", "api_token"), controller.deleteToken);

export default router;
