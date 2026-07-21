import express from "express";
import { useScheduledTaskController } from "../resources/scheduled-task";
import { requireAuth, requirePermission } from "../utils/auth.middleware";

const router = express.Router();
const controller = useScheduledTaskController();

// All scheduled task routes require authentication
router.use(requireAuth);

// List tasks
router.get("/", requirePermission("tasks:read"), controller.list);

// Create task
router.post("/", requirePermission("tasks:update"), controller.create);

// Get task by ID
router.get("/:id", requirePermission("tasks:read"), controller.getById);

// Update task
router.patch("/:id", requirePermission("tasks:update"), controller.update);

// Delete task
router.delete("/:id", requirePermission("tasks:update"), controller.remove);

// Run task immediately
router.post("/:id/run", requirePermission("tasks:update"), controller.runNow);

// Pause task
router.post("/:id/pause", requirePermission("tasks:update"), controller.pause);

// Resume task
router.post("/:id/resume", requirePermission("tasks:update"), controller.resume);

// Get task run history
router.get("/:id/history", requirePermission("tasks:read"), controller.getHistory);

export default router;
