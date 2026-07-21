import express from "express";
import { useRoleController } from "../resources/role";
import { requireAuth, requirePermission } from "../utils/auth.middleware";

const router = express.Router();
const controller = useRoleController();

// All role routes require authentication
router.use(requireAuth);

// List all available permissions (anyone authenticated can see this)
router.get("/permissions", controller.listPermissions);

// List roles
router.get("/", requirePermission("roles:read"), controller.list);

// Create role (admin only)
router.post("/", requirePermission("roles:create"), controller.create);

// Get role by ID
router.get("/:id", requirePermission("roles:read"), controller.getById);

// Update role (admin only)
router.patch("/:id", requirePermission("roles:update"), controller.update);

// Delete role (admin only)
router.delete("/:id", requirePermission("roles:delete"), controller.remove);

export default router;
