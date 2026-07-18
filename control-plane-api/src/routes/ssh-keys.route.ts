import express from "express";
import { requireAuth } from "../utils";
import { useSSHKeyController } from "../resources";

const router = express.Router();
const controller = useSSHKeyController();

router.get("/", requireAuth, controller.getAll);
router.get("/:id", requireAuth, controller.getById);
router.post("/", requireAuth, controller.create);
router.post("/import", requireAuth, controller.importKey);
router.patch("/:id", requireAuth, controller.update);
router.delete("/:id", requireAuth, controller.deleteKey);
router.post("/:id/default", requireAuth, controller.setDefault);

export default router;
