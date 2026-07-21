import { ObjectId } from "mongodb";
import { useOrganizationRepo } from "./organization.repository";
import { useOrganizationMemberRepo } from "./organization.member.repository";
import { useOrganizationInviteRepo } from "./organization.invite.repository";
import { TOrganization, TOrganizationPlan, TOrganizationInput, TOrganizationUpdateInput, schemaOrganizationUpdate } from "./organization.model";
import { BadRequestError, ForbiddenError, NotFoundError, ConflictError } from "../../utils/error";
import { logger } from "../../utils/logger";

// =============================================================================
// Billing Integration Hooks (Stubs)
// =============================================================================

/**
 * Stub for billing integration - called when organization plan changes.
 * Implement integration with Stripe/Paddle/etc here.
 */
export async function onPlanChange(orgId: string, newPlan: TOrganizationPlan): Promise<void> {
  logger.log({
    level: "info",
    message: `[billing-stub] Plan changed for org ${orgId} to ${newPlan}`,
  });
  // TODO: Integrate with billing provider
  // - Update subscription in Stripe/Paddle
  // - Send confirmation email
  // - Log audit event
}

/**
 * Stub for billing integration - called when resource usage changes.
 * Implement metered billing or usage alerts here.
 */
export async function onUsageChange(
  orgId: string,
  resource: "apps" | "databases" | "users" | "storage",
  delta: number
): Promise<void> {
  logger.log({
    level: "debug",
    message: `[billing-stub] Usage changed for org ${orgId}: ${resource} ${delta > 0 ? "+" : ""}${delta}`,
  });
  // TODO: Integrate with billing provider for metered billing
  // - Report usage to Stripe/Paddle
  // - Send usage alerts if approaching limits
}

/**
 * Stub for billing integration - check if organization has valid payment status.
 */
export async function checkPaymentStatus(orgId: string): Promise<boolean> {
  logger.log({
    level: "debug",
    message: `[billing-stub] Checking payment status for org ${orgId}`,
  });
  // TODO: Check with billing provider
  // For now, always return true (payment OK)
  return true;
}

// =============================================================================
// Organization Service
// =============================================================================

export function useOrganizationService() {
  const orgRepo = useOrganizationRepo();
  const memberRepo = useOrganizationMemberRepo();
  const inviteRepo = useOrganizationInviteRepo();

  // ---------------------------------------------------------------------------
  // Organization CRUD
  // ---------------------------------------------------------------------------

  /**
   * Create a new organization.
   * - Creates the organization
   * - Adds the owner as the first member with admin role
   */
  async function create(data: { name: string; ownerId: string; slug?: string; billingEmail?: string }) {
    // Create the organization
    const orgId = await orgRepo.add({
      name: data.name,
      slug: data.slug,
      ownerId: data.ownerId,
      billingEmail: data.billingEmail,
    });

    // Add owner as first member
    // Note: In a real implementation, you'd look up or create an admin role
    // For now, we'll use a placeholder roleId that should be replaced with actual role lookup
    try {
      await memberRepo.add({
        organizationId: String(orgId),
        userId: data.ownerId,
        roleId: data.ownerId, // Placeholder - replace with actual admin role ID
      });
    } catch (error) {
      // If adding member fails, delete the org to maintain consistency
      await orgRepo.deleteById(orgId);
      throw error;
    }

    return orgId;
  }

  /**
   * Update an organization.
   * Only the owner can update organization details.
   */
  async function update(
    orgId: string,
    userId: string,
    data: TOrganizationUpdateInput
  ) {
    const org = await orgRepo.getById(orgId);
    if (!org) {
      throw new NotFoundError("Organization not found");
    }

    // Validate update data
    const { error, value } = schemaOrganizationUpdate.validate(data);
    if (error) {
      throw new BadRequestError(error.message);
    }

    // Check if user is owner (or has permission - for now just owner check)
    if (String(org.ownerId) !== userId) {
      throw new ForbiddenError("Only the organization owner can update organization details");
    }

    await orgRepo.updateById(orgId, value);

    // If plan changed, trigger billing hook
    if (value.plan && value.plan !== org.plan) {
      await onPlanChange(orgId, value.plan);
    }

    return true;
  }

  /**
   * Delete an organization and all related data.
   * Only the owner can delete the organization.
   */
  async function remove(orgId: string, userId: string) {
    const org = await orgRepo.getById(orgId);
    if (!org) {
      throw new NotFoundError("Organization not found");
    }

    // Only owner can delete
    if (String(org.ownerId) !== userId) {
      throw new ForbiddenError("Only the organization owner can delete the organization");
    }

    // Delete all members
    await memberRepo.deleteByOrganizationId(orgId);

    // Delete all pending invites
    await inviteRepo.deleteByOrganizationId(orgId);

    // Delete the organization
    await orgRepo.deleteById(orgId);

    // TODO: Delete or transfer org-scoped resources (apps, databases, etc.)
    // This should be handled carefully - either cascade delete or transfer to personal

    return true;
  }

  // ---------------------------------------------------------------------------
  // Membership
  // ---------------------------------------------------------------------------

  /**
   * Check if a user is a member of an organization.
   */
  async function isMember(orgId: string | ObjectId, userId: string | ObjectId): Promise<boolean> {
    return memberRepo.isMember(orgId, userId);
  }

  /**
   * Invite a new member to the organization.
   */
  async function inviteMember(
    orgId: string,
    inviterId: string,
    data: { email: string; roleId: string }
  ) {
    const org = await orgRepo.getById(orgId);
    if (!org) {
      throw new NotFoundError("Organization not found");
    }

    // Check user limit
    const limitCheck = await orgRepo.checkLimit(orgId, "users");
    if (!limitCheck.withinLimit) {
      throw new BadRequestError(
        `Organization user limit reached (${limitCheck.current}/${limitCheck.max}). Upgrade your plan to add more users.`
      );
    }

    // Check if email domain is allowed (if restrictions are set)
    if (org.settings.allowedDomains && org.settings.allowedDomains.length > 0) {
      const emailDomain = data.email.split("@")[1]?.toLowerCase();
      const isAllowed = org.settings.allowedDomains.some(
        (d) => d.toLowerCase() === emailDomain
      );
      if (!isAllowed) {
        throw new BadRequestError(
          `Email domain "${emailDomain}" is not allowed. Allowed domains: ${org.settings.allowedDomains.join(", ")}`
        );
      }
    }

    // Check if there's already a pending invite
    const existingInvite = await inviteRepo.getPendingByOrgAndEmail(orgId, data.email);
    if (existingInvite) {
      throw new ConflictError("An invitation for this email is already pending");
    }

    // Create the invite
    const result = await inviteRepo.add({
      organizationId: orgId,
      email: data.email,
      roleId: data.roleId,
      invitedBy: inviterId,
    });

    // TODO: Send invitation email with link containing the token

    return result;
  }

  /**
   * Accept an invitation and join the organization.
   */
  async function acceptInvite(token: string, userId: string) {
    const invite = await inviteRepo.getByToken(token);
    if (!invite) {
      throw new NotFoundError("Invitation not found or expired");
    }

    // Check if already accepted
    if (invite.acceptedAt) {
      throw new BadRequestError("This invitation has already been accepted");
    }

    // Check if expired
    if (invite.expiresAt < new Date()) {
      throw new BadRequestError("This invitation has expired");
    }

    // Check if user is already a member
    const isAlreadyMember = await memberRepo.isMember(invite.organizationId, userId);
    if (isAlreadyMember) {
      throw new ConflictError("You are already a member of this organization");
    }

    // Add user as member
    await memberRepo.add({
      organizationId: String(invite.organizationId),
      userId,
      roleId: String(invite.roleId),
      invitedBy: String(invite.invitedBy),
      invitedAt: invite.createdAt,
    });

    // Mark invite as accepted
    await inviteRepo.markAccepted(invite._id!);

    // Update usage count
    await orgRepo.updateUsage(invite.organizationId, "users", 1);
    await onUsageChange(String(invite.organizationId), "users", 1);

    return { organizationId: invite.organizationId };
  }

  /**
   * Remove a member from the organization.
   * Owner cannot be removed (must transfer ownership first).
   */
  async function removeMember(orgId: string, targetUserId: string, requesterId: string) {
    const org = await orgRepo.getById(orgId);
    if (!org) {
      throw new NotFoundError("Organization not found");
    }

    // Check if target is the owner
    if (String(org.ownerId) === targetUserId) {
      throw new BadRequestError(
        "Cannot remove the organization owner. Transfer ownership first."
      );
    }

    // Check if requester has permission (owner or self-removal)
    const isOwner = String(org.ownerId) === requesterId;
    const isSelf = targetUserId === requesterId;

    if (!isOwner && !isSelf) {
      throw new ForbiddenError("You don't have permission to remove this member");
    }

    // Remove the member
    await memberRepo.deleteByOrgAndUser(orgId, targetUserId);

    // Update usage count
    await orgRepo.updateUsage(orgId, "users", -1);
    await onUsageChange(orgId, "users", -1);

    return true;
  }

  /**
   * Change a member's role.
   * Only the owner can change roles.
   */
  async function changeMemberRole(
    orgId: string,
    targetUserId: string,
    newRoleId: string,
    requesterId: string
  ) {
    const org = await orgRepo.getById(orgId);
    if (!org) {
      throw new NotFoundError("Organization not found");
    }

    // Only owner can change roles
    if (String(org.ownerId) !== requesterId) {
      throw new ForbiddenError("Only the organization owner can change member roles");
    }

    // Find the member
    const member = await memberRepo.getByOrgAndUser(orgId, targetUserId);
    if (!member) {
      throw new NotFoundError("Member not found");
    }

    // Update the role
    await memberRepo.updateRole(member._id!, newRoleId);

    return true;
  }

  /**
   * Transfer ownership to another member.
   */
  async function transferOwnership(orgId: string, newOwnerId: string, currentOwnerId: string) {
    const org = await orgRepo.getById(orgId);
    if (!org) {
      throw new NotFoundError("Organization not found");
    }

    // Only current owner can transfer
    if (String(org.ownerId) !== currentOwnerId) {
      throw new ForbiddenError("Only the current owner can transfer ownership");
    }

    // Check if new owner is a member
    const isMemberResult = await memberRepo.isMember(orgId, newOwnerId);
    if (!isMemberResult) {
      throw new BadRequestError("New owner must be a member of the organization");
    }

    // Transfer ownership
    await orgRepo.transferOwnership(orgId, newOwnerId);

    return true;
  }

  // ---------------------------------------------------------------------------
  // Resource Limits
  // ---------------------------------------------------------------------------

  /**
   * Check if organization can create a new resource.
   * Throws BadRequestError if limit is exceeded.
   */
  async function checkResourceLimit(
    orgId: string | ObjectId,
    resource: "apps" | "databases" | "users" | "storage"
  ) {
    const limitCheck = await orgRepo.checkLimit(orgId, resource);

    if (!limitCheck.withinLimit) {
      throw new BadRequestError(
        `Organization ${resource} limit reached (${limitCheck.current}/${limitCheck.max}). Upgrade your plan to add more.`
      );
    }

    return true;
  }

  /**
   * Increment resource usage after successful creation.
   */
  async function incrementUsage(
    orgId: string | ObjectId,
    resource: "apps" | "databases" | "users" | "storage",
    amount: number = 1
  ) {
    await orgRepo.updateUsage(orgId, resource, amount);
    await onUsageChange(String(orgId), resource, amount);
  }

  /**
   * Decrement resource usage after deletion.
   */
  async function decrementUsage(
    orgId: string | ObjectId,
    resource: "apps" | "databases" | "users" | "storage",
    amount: number = 1
  ) {
    await orgRepo.updateUsage(orgId, resource, -amount);
    await onUsageChange(String(orgId), resource, -amount);
  }

  // ---------------------------------------------------------------------------
  // User Organization Access
  // ---------------------------------------------------------------------------

  /**
   * Get all organizations a user has access to.
   */
  async function getUserOrganizations(userId: string) {
    // Get all memberships for this user
    const memberships = await memberRepo.getByUserId(userId);

    // Get organization details for each membership
    const organizations: (TOrganization & { membership: { roleId: ObjectId; joinedAt: Date } })[] = [];

    for (const membership of memberships) {
      const org = await orgRepo.getById(membership.organizationId);
      if (org) {
        organizations.push({
          ...org,
          membership: {
            roleId: membership.roleId,
            joinedAt: membership.joinedAt,
          },
        });
      }
    }

    return organizations;
  }

  /**
   * Get usage statistics for an organization.
   */
  async function getUsageStats(orgId: string) {
    const org = await orgRepo.getById(orgId);
    if (!org) {
      throw new NotFoundError("Organization not found");
    }

    return {
      usage: org.usage,
      limits: org.limits,
      plan: org.plan,
      percentages: {
        apps: org.limits.maxApps === -1 ? 0 : (org.usage.apps / org.limits.maxApps) * 100,
        databases: org.limits.maxDatabases === -1 ? 0 : (org.usage.databases / org.limits.maxDatabases) * 100,
        users: org.limits.maxUsers === -1 ? 0 : (org.usage.users / org.limits.maxUsers) * 100,
        storage: org.limits.maxStorage === -1 ? 0 : (org.usage.storage / org.limits.maxStorage) * 100,
      },
    };
  }

  return {
    // Organization CRUD
    create,
    update,
    remove,
    // Membership
    isMember,
    inviteMember,
    acceptInvite,
    removeMember,
    changeMemberRole,
    transferOwnership,
    // Resource limits
    checkResourceLimit,
    incrementUsage,
    decrementUsage,
    // User access
    getUserOrganizations,
    getUsageStats,
  };
}
