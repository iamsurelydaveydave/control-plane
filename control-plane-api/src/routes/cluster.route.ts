import express from "express";
import { useClusterController } from "../resources/cluster";
import { requireAuth, requirePermission, rateLimitHeavy, rateLimitModerate } from "../utils";

const router = express.Router();
const controller = useClusterController();

// All cluster routes require authentication
router.use(requireAuth);

// List clusters
router.get("/", requirePermission("nodes:read"), controller.list);

// Get cluster by ID
router.get("/:id", requirePermission("nodes:read"), controller.getById);

// Create cluster - heavy operation
router.post("/", requirePermission("nodes:create"), rateLimitHeavy, controller.add);

// Update cluster
router.patch("/:id", requirePermission("nodes:update"), rateLimitModerate, controller.update);

// Delete cluster - heavy operation
router.delete("/:id", requirePermission("nodes:delete"), rateLimitHeavy, controller.remove);

// Sync cluster status
router.post("/:id/sync", requirePermission("nodes:read"), rateLimitModerate, controller.sync);

// Get join token info (for adding worker nodes)
router.get("/:id/join-token", requirePermission("nodes:read"), controller.getJoinToken);

// Refresh join token
router.post("/:id/refresh-token", requirePermission("nodes:update"), rateLimitModerate, controller.refreshToken);

export default router;
