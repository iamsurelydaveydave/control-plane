import express from "express";
import { useWebhookController } from "../resources/webhook";
import { requireAuth, requireScope } from "../utils/auth.middleware";

const router = express.Router();
const controller = useWebhookController();

// All webhook routes require authentication
router.use(requireAuth);

// List available webhook events (public to authenticated users)
router.get("/events", controller.listEvents);

// List webhooks
router.get("/", controller.list);

// Get webhook by ID
router.get("/:id", controller.getById);

// Create webhook (requires settings:write scope for API tokens)
router.post("/", requireScope("settings:write"), controller.create);

// Update webhook (requires settings:write scope for API tokens)
router.patch("/:id", requireScope("settings:write"), controller.update);

// Delete webhook (requires settings:write scope for API tokens)
router.delete("/:id", requireScope("settings:write"), controller.remove);

// Test webhook (requires settings:write scope for API tokens)
router.post("/:id/test", requireScope("settings:write"), controller.test);

export default router;
