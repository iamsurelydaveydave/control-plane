import express from "express";
import { requireAuth } from "../utils";
import { useAPITokenController } from "../resources";

const router = express.Router();
const controller = useAPITokenController();

router.get("/", requireAuth, controller.getAll);
router.get("/scopes", requireAuth, controller.getScopes);
router.post("/", requireAuth, controller.create);
router.delete("/:id", requireAuth, controller.deleteToken);

export default router;
