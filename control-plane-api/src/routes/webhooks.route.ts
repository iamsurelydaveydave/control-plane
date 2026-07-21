import express from "express";
import { useWebhookController } from "../resources/webhook";
import { requireAuth, requirePermission } from "../utils/auth.middleware";

const router = express.Router();
const controller = useWebhookController();

// All webhook routes require authentication
router.use(requireAuth);

// List available webhook events
router.get("/events", requirePermission("settings:read"), controller.listEvents);

// List webhooks
router.get("/", requirePermission("settings:read"), controller.list);

// Get webhook by ID
router.get("/:id", requirePermission("settings:read"), controller.getById);

// Create webhook
router.post("/", requirePermission("settings:update"), controller.create);

// Update webhook
router.patch("/:id", requirePermission("settings:update"), controller.update);

// Delete webhook
router.delete("/:id", requirePermission("settings:update"), controller.remove);

// Test webhook
router.post("/:id/test", requirePermission("settings:update"), controller.test);

export default router;
