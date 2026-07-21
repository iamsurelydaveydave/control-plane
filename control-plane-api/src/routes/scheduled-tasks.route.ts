import express from "express";
import { useScheduledTaskController } from "../resources/scheduled-task";
import { requireAuth, requireScope } from "../utils/auth.middleware";

const router = express.Router();
const controller = useScheduledTaskController();

// All scheduled task routes require authentication
router.use(requireAuth);

// List tasks
router.get("/", controller.list);

// Create task (admin only)
router.post("/", requireScope("settings:write"), controller.create);

// Get task by ID
router.get("/:id", controller.getById);

// Update task (admin only)
router.patch("/:id", requireScope("settings:write"), controller.update);

// Delete task (admin only)
router.delete("/:id", requireScope("settings:write"), controller.remove);

// Run task immediately (admin only)
router.post("/:id/run", requireScope("settings:write"), controller.runNow);

// Pause task (admin only)
router.post("/:id/pause", requireScope("settings:write"), controller.pause);

// Resume task (admin only)
router.post("/:id/resume", requireScope("settings:write"), controller.resume);

// Get task run history
router.get("/:id/history", controller.getHistory);

export default router;
