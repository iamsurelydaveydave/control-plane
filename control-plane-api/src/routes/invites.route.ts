import express from "express";
import { requireAuth } from "../utils/auth.middleware";
import { useOrganizationController } from "../resources/organization";

const router = express.Router();

const { getInviteByToken, acceptInvite } = useOrganizationController();

// Get invite details (public - no auth required to view, but needs to be valid)
router.get("/:token", getInviteByToken);

// Accept invite (requires auth)
router.post("/:token/accept", requireAuth, acceptInvite);

export default router;
