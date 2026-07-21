import express from "express";
import { requireAuth, requirePermission } from "../utils";
import { useSSHKeyController } from "../resources/ssh-key";

const router = express.Router();
const controller = useSSHKeyController();

// All SSH key routes require authentication
router.use(requireAuth);

// List SSH keys (metadata only)
router.get("/", requirePermission("settings:read"), controller.list);

// Generate new SSH key (returns private key once)
router.post("/", requirePermission("settings:update"), controller.create);

// Import existing SSH key
router.post("/import", requirePermission("settings:update"), controller.importKey);

// Get SSH key by ID
router.get("/:id", requirePermission("settings:read"), controller.getById);

// Update SSH key
router.patch("/:id", requirePermission("settings:update"), controller.update);

// Set SSH key as default
router.post("/:id/default", requirePermission("settings:update"), controller.setDefault);

// Delete SSH key
router.delete("/:id", requirePermission("settings:update"), controller.remove);

export default router;
