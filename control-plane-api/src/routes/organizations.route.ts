import express from "express";
import { requireAuth } from "../utils/auth.middleware";
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
router.get("/", requireAuth, list);
router.post("/", requireAuth, create);
router.get("/:id", requireAuth, getById);
router.patch("/:id", requireAuth, update);
router.delete("/:id", requireAuth, remove);

// Members
router.get("/:id/members", requireAuth, listMembers);
router.post("/:id/members", requireAuth, inviteMember);
router.delete("/:id/members/:userId", requireAuth, removeMember);
router.post("/:id/members/:userId/role", requireAuth, changeMemberRole);

// Invitations
router.get("/:id/invites", requireAuth, listInvites);
router.delete("/:id/invites/:inviteId", requireAuth, revokeInvite);

// Usage
router.get("/:id/usage", requireAuth, getUsage);

// Ownership
router.post("/:id/transfer-ownership", requireAuth, transferOwnership);

export default router;
