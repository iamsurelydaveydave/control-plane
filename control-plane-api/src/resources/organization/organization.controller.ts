import { Request, Response, NextFunction } from "express";
import { useOrganizationRepo } from "./organization.repository";
import { useOrganizationMemberRepo } from "./organization.member.repository";
import { useOrganizationInviteRepo } from "./organization.invite.repository";
import { useOrganizationService } from "./organization.service";
import {
  schemaOrganizationCreate,
  schemaOrganizationUpdate,
  TOrganizationPlan,
} from "./organization.model";
import { schemaInviteMember } from "./organization.invite.model";
import { schemaOrganizationMemberUpdateRole } from "./organization.member.model";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../utils/error";

// Helper to safely get string param
function getStringParam(param: string | string[] | undefined): string {
  if (!param) return "";
  return Array.isArray(param) ? param[0] : param;
}

export function useOrganizationController() {
  const orgRepo = useOrganizationRepo();
  const memberRepo = useOrganizationMemberRepo();
  const inviteRepo = useOrganizationInviteRepo();
  const orgService = useOrganizationService();

  // ---------------------------------------------------------------------------
  // Organization CRUD
  // ---------------------------------------------------------------------------

  async function list(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.cookies?.user;
      if (!userId) {
        next(new BadRequestError("User not authenticated"));
        return;
      }

      // Get organizations the user is a member of
      const organizations = await orgService.getUserOrganizations(userId);

      res.json({ organizations });
    } catch (error) {
      next(error);
    }
  }

  async function create(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.cookies?.user;
      if (!userId) {
        next(new BadRequestError("User not authenticated"));
        return;
      }

      const { error, value } = schemaOrganizationCreate.validate({
        ...req.body,
        ownerId: userId,
      });

      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      const orgId = await orgService.create({
        name: value.name,
        slug: value.slug,
        ownerId: userId,
        billingEmail: value.billingEmail,
      });

      res.status(201).json({
        message: "Organization created",
        organizationId: orgId,
      });
    } catch (error) {
      next(error);
    }
  }

  async function getById(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.cookies?.user;
      const orgId = getStringParam(req.params.id);

      // Check if user is a member
      const isMember = await orgService.isMember(orgId, userId);
      if (!isMember) {
        next(new ForbiddenError("Not a member of this organization"));
        return;
      }

      const org = await orgRepo.getById(orgId);
      if (!org) {
        next(new NotFoundError("Organization not found"));
        return;
      }

      res.json({ organization: org });
    } catch (error) {
      next(error);
    }
  }

  async function update(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.cookies?.user;
      const orgId = getStringParam(req.params.id);

      const { error, value } = schemaOrganizationUpdate.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      await orgService.update(orgId, userId, value);

      res.json({ message: "Organization updated" });
    } catch (error) {
      next(error);
    }
  }

  async function remove(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.cookies?.user;
      const orgId = getStringParam(req.params.id);

      await orgService.remove(orgId, userId);

      res.json({ message: "Organization deleted" });
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Members
  // ---------------------------------------------------------------------------

  async function listMembers(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.cookies?.user;
      const orgId = getStringParam(req.params.id);
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;

      // Check if user is a member
      const isMember = await orgService.isMember(orgId, userId);
      if (!isMember) {
        next(new ForbiddenError("Not a member of this organization"));
        return;
      }

      const members = await memberRepo.getByOrganizationId(orgId, { page, limit });

      res.json(members);
    } catch (error) {
      next(error);
    }
  }

  async function inviteMember(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.cookies?.user;
      const orgId = getStringParam(req.params.id);

      const { error, value } = schemaInviteMember.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      // Check if user is owner (only owner can invite)
      const org = await orgRepo.getById(orgId);
      if (!org) {
        next(new NotFoundError("Organization not found"));
        return;
      }

      if (String(org.ownerId) !== userId) {
        next(new ForbiddenError("Only the organization owner can invite members"));
        return;
      }

      const result = await orgService.inviteMember(orgId, userId, value);

      res.status(201).json({
        message: "Invitation sent",
        inviteId: result.insertedId,
        // In production, don't expose the token - send it via email only
        token: result.token,
      });
    } catch (error) {
      next(error);
    }
  }

  async function removeMember(req: Request, res: Response, next: NextFunction) {
    try {
      const requesterId = req.cookies?.user;
      const orgId = getStringParam(req.params.id);
      const targetUserId = getStringParam(req.params.userId);

      await orgService.removeMember(orgId, targetUserId, requesterId);

      res.json({ message: "Member removed" });
    } catch (error) {
      next(error);
    }
  }

  async function changeMemberRole(req: Request, res: Response, next: NextFunction) {
    try {
      const requesterId = req.cookies?.user;
      const orgId = getStringParam(req.params.id);
      const targetUserId = getStringParam(req.params.userId);

      const { error, value } = schemaOrganizationMemberUpdateRole.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      await orgService.changeMemberRole(orgId, targetUserId, value.roleId, requesterId);

      res.json({ message: "Member role updated" });
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Invitations
  // ---------------------------------------------------------------------------

  async function listInvites(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.cookies?.user;
      const orgId = getStringParam(req.params.id);
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;

      // Check if user is owner (only owner can see invites)
      const org = await orgRepo.getById(orgId);
      if (!org) {
        next(new NotFoundError("Organization not found"));
        return;
      }

      if (String(org.ownerId) !== userId) {
        next(new ForbiddenError("Only the organization owner can view invitations"));
        return;
      }

      const invites = await inviteRepo.getByOrganizationId(orgId, { page, limit });

      res.json(invites);
    } catch (error) {
      next(error);
    }
  }

  async function getInviteByToken(req: Request, res: Response, next: NextFunction) {
    try {
      const token = getStringParam(req.params.token);

      const invite = await inviteRepo.getByToken(token);
      if (!invite) {
        next(new NotFoundError("Invitation not found or expired"));
        return;
      }

      // Get organization details
      const org = await orgRepo.getById(invite.organizationId);

      res.json({
        invite: {
          email: invite.email,
          expiresAt: invite.expiresAt,
          acceptedAt: invite.acceptedAt,
          organization: org ? { name: org.name, slug: org.slug } : null,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async function acceptInvite(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.cookies?.user;
      const token = getStringParam(req.params.token);

      if (!userId) {
        next(new BadRequestError("You must be logged in to accept an invitation"));
        return;
      }

      const result = await orgService.acceptInvite(token, userId);

      res.json({
        message: "Invitation accepted",
        organizationId: result.organizationId,
      });
    } catch (error) {
      next(error);
    }
  }

  async function revokeInvite(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.cookies?.user;
      const orgId = getStringParam(req.params.id);
      const inviteId = getStringParam(req.params.inviteId);

      // Check if user is owner
      const org = await orgRepo.getById(orgId);
      if (!org) {
        next(new NotFoundError("Organization not found"));
        return;
      }

      if (String(org.ownerId) !== userId) {
        next(new ForbiddenError("Only the organization owner can revoke invitations"));
        return;
      }

      await inviteRepo.deleteById(inviteId);

      res.json({ message: "Invitation revoked" });
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Usage & Stats
  // ---------------------------------------------------------------------------

  async function getUsage(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.cookies?.user;
      const orgId = getStringParam(req.params.id);

      // Check if user is a member
      const isMember = await orgService.isMember(orgId, userId);
      if (!isMember) {
        next(new ForbiddenError("Not a member of this organization"));
        return;
      }

      const stats = await orgService.getUsageStats(orgId);

      res.json(stats);
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Ownership
  // ---------------------------------------------------------------------------

  async function transferOwnership(req: Request, res: Response, next: NextFunction) {
    try {
      const currentOwnerId = req.cookies?.user;
      const orgId = getStringParam(req.params.id);
      const { newOwnerId } = req.body;

      if (!newOwnerId) {
        next(new BadRequestError("newOwnerId is required"));
        return;
      }

      await orgService.transferOwnership(orgId, newOwnerId, currentOwnerId);

      res.json({ message: "Ownership transferred" });
    } catch (error) {
      next(error);
    }
  }

  return {
    // Organizations
    list,
    create,
    getById,
    update,
    remove,
    // Members
    listMembers,
    inviteMember,
    removeMember,
    changeMemberRole,
    // Invitations
    listInvites,
    getInviteByToken,
    acceptInvite,
    revokeInvite,
    // Usage
    getUsage,
    // Ownership
    transferOwnership,
  };
}
