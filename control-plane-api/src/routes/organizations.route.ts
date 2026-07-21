import express from "express";
import { requireAuth, requirePermission } from "../utils/auth.middleware";
import { useOrganizationController } from "../resources/organization";

const router = express.Router();

const {
  list,
  create,
  getById,
  update,
  remove,
  listMembers,
  inviteMember,
  removeMember,
  changeMemberRole,
  listInvites,
  revokeInvite,
  getUsage,
  transferOwnership,
} = useOrganizationController();

// Organization CRUD
router.get("/", requireAuth, requirePermission("organizations:read"), list);
router.post("/", requireAuth, requirePermission("organizations:create"), create);
router.get("/:id", requireAuth, requirePermission("organizations:read"), getById);
router.patch("/:id", requireAuth, requirePermission("organizations:update"), update);
router.delete("/:id", requireAuth, requirePermission("organizations:delete"), remove);

// Members
router.get("/:id/members", requireAuth, requirePermission("organizations:read"), listMembers);
router.post("/:id/members", requireAuth, requirePermission("organizations:update"), inviteMember);
router.delete("/:id/members/:userId", requireAuth, requirePermission("organizations:update"), removeMember);
router.post("/:id/members/:userId/role", requireAuth, requirePermission("organizations:update"), changeMemberRole);

// Invitations
router.get("/:id/invites", requireAuth, requirePermission("organizations:read"), listInvites);
router.delete("/:id/invites/:inviteId", requireAuth, requirePermission("organizations:update"), revokeInvite);

// Usage
router.get("/:id/usage", requireAuth, requirePermission("organizations:read"), getUsage);

// Ownership
router.post("/:id/transfer-ownership", requireAuth, requirePermission("organizations:delete"), transferOwnership);

export default router;
