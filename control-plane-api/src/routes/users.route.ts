import express from "express";
import { useUserController } from "../resources/user";
import { requireAuth, requirePermission } from "../utils/auth.middleware";

const router = express.Router();
const controller = useUserController();

// All user routes require authentication
router.use(requireAuth);

// List users
router.get("/", requirePermission("users:read"), controller.list);

// Create user (admin only)
router.post("/", requirePermission("users:create"), controller.create);

// Get user by ID
router.get("/:id", requirePermission("users:read"), controller.getById);

// Update user (admin only)
router.patch("/:id", requirePermission("users:update"), controller.update);

// Delete user (admin only)
router.delete("/:id", requirePermission("users:delete"), controller.remove);

// Get effective permissions for a user
router.get("/:id/permissions", requirePermission("users:read"), controller.getPermissions);

// Assign role to user
router.patch("/:id/role", requirePermission("users:update"), controller.assignRole);

export default router;
