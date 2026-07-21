import { expect } from "chai";
import { describe, it, afterEach } from "mocha";
import { ObjectId } from "mongodb";
import { useOrganizationRepo } from "../src/resources/organization/organization.repository";
import { useOrganizationMemberRepo } from "../src/resources/organization/organization.member.repository";
import { useOrganizationInviteRepo } from "../src/resources/organization/organization.invite.repository";
import { useOrganizationService } from "../src/resources/organization/organization.service";
import {
  TOrganization,
  TOrganizationPlan,
  organizationPlans,
  PLAN_LIMITS,
  generateSlug,
} from "../src/resources/organization/organization.model";
import { generateInviteToken } from "../src/resources/organization/organization.invite.model";
import { useUserRepo } from "../src/resources/user";
import { hashPassword } from "../src/utils";

describe("Organization Resource", function () {
  this.timeout(10000);

  const createdOrgIds: (string | ObjectId)[] = [];
  const createdUserIds: string[] = [];
  const createdMemberIds: (string | ObjectId)[] = [];
  const createdInviteIds: (string | ObjectId)[] = [];

  afterEach(async () => {
    // Clean up invites
    const inviteRepo = useOrganizationInviteRepo();
    for (const id of createdInviteIds) {
      try {
        await inviteRepo.deleteById(id);
      } catch {
        // Ignore errors
      }
    }
    createdInviteIds.length = 0;

    // Clean up members
    const memberRepo = useOrganizationMemberRepo();
    for (const id of createdMemberIds) {
      try {
        await memberRepo.deleteById(id);
      } catch {
        // Ignore errors
      }
    }
    createdMemberIds.length = 0;

    // Clean up organizations
    const orgRepo = useOrganizationRepo();
    for (const id of createdOrgIds) {
      try {
        await orgRepo.deleteById(id);
      } catch {
        // Ignore errors
      }
    }
    createdOrgIds.length = 0;

    // Clean up users
    const userRepo = useUserRepo();
    for (const id of createdUserIds) {
      try {
        await userRepo.deleteById(id);
      } catch {
        // Ignore errors
      }
    }
    createdUserIds.length = 0;
  });

  // ===========================================================================
  // Model Tests
  // ===========================================================================

  describe("Organization Model", () => {
    it("should export all plan types", () => {
      expect(organizationPlans).to.be.an("array");
      expect(organizationPlans).to.include("free");
      expect(organizationPlans).to.include("starter");
      expect(organizationPlans).to.include("pro");
      expect(organizationPlans).to.include("enterprise");
    });

    it("should have plan limits defined for all plans", () => {
      for (const plan of organizationPlans) {
        expect(PLAN_LIMITS[plan]).to.exist;
        expect(PLAN_LIMITS[plan]).to.have.property("maxApps");
        expect(PLAN_LIMITS[plan]).to.have.property("maxDatabases");
        expect(PLAN_LIMITS[plan]).to.have.property("maxUsers");
        expect(PLAN_LIMITS[plan]).to.have.property("maxStorage");
      }
    });

    it("should have enterprise plan with unlimited (-1) limits", () => {
      const enterpriseLimits = PLAN_LIMITS.enterprise;

      expect(enterpriseLimits.maxApps).to.equal(-1);
      expect(enterpriseLimits.maxDatabases).to.equal(-1);
      expect(enterpriseLimits.maxUsers).to.equal(-1);
      expect(enterpriseLimits.maxStorage).to.equal(-1);
    });

    it("should generate valid slug from name", () => {
      expect(generateSlug("My Company")).to.equal("my-company");
      expect(generateSlug("Test Org 123")).to.equal("test-org-123");
      expect(generateSlug("  Spaces  Everywhere  ")).to.equal("spaces-everywhere");
      expect(generateSlug("Special!@#$%Characters")).to.equal("specialcharacters");
      expect(generateSlug("Multiple---Hyphens")).to.equal("multiple-hyphens");
    });

    it("should truncate long slugs to 50 characters", () => {
      const longName = "a".repeat(100);
      const slug = generateSlug(longName);

      expect(slug.length).to.be.at.most(50);
    });
  });

  describe("Organization Invite Model", () => {
    it("should generate unique invite tokens", () => {
      const token1 = generateInviteToken();
      const token2 = generateInviteToken();

      expect(token1).to.be.a("string");
      expect(token2).to.be.a("string");
      expect(token1.length).to.equal(64); // 32 bytes = 64 hex chars
      expect(token1).to.not.equal(token2);
    });
  });

  // ===========================================================================
  // Organization Repository Tests
  // ===========================================================================

  describe("Organization Repository", () => {
    it("should create a new organization", async () => {
      const repo = useOrganizationRepo();
      const ownerId = new ObjectId();

      const orgId = await repo.add({
        name: `Test Org ${Date.now()}`,
        ownerId: ownerId.toString(),
      });

      createdOrgIds.push(orgId);

      expect(orgId).to.exist;
      expect(orgId.toString()).to.have.lengthOf(24);
    });

    it("should create organization with correct default plan", async () => {
      const repo = useOrganizationRepo();
      const ownerId = new ObjectId();

      const orgId = await repo.add({
        name: `Default Plan Org ${Date.now()}`,
        ownerId: ownerId.toString(),
      });

      createdOrgIds.push(orgId);

      const org = await repo.getById(orgId);

      expect(org).to.exist;
      expect(org!.plan).to.equal("free");
      expect(org!.limits).to.deep.equal(PLAN_LIMITS.free);
    });

    it("should create organization with specified plan", async () => {
      const repo = useOrganizationRepo();
      const ownerId = new ObjectId();

      const orgId = await repo.add({
        name: `Pro Plan Org ${Date.now()}`,
        ownerId: ownerId.toString(),
        plan: "pro",
      });

      createdOrgIds.push(orgId);

      const org = await repo.getById(orgId);

      expect(org!.plan).to.equal("pro");
      expect(org!.limits).to.deep.equal(PLAN_LIMITS.pro);
    });

    it("should get organization by ID", async () => {
      const repo = useOrganizationRepo();
      const ownerId = new ObjectId();
      const name = `Get By ID Org ${Date.now()}`;

      const orgId = await repo.add({
        name,
        ownerId: ownerId.toString(),
      });

      createdOrgIds.push(orgId);

      const org = await repo.getById(orgId);

      expect(org).to.exist;
      expect(org!.name).to.equal(name);
      expect(org!.ownerId.toString()).to.equal(ownerId.toString());
    });

    it("should get organization by slug", async () => {
      const repo = useOrganizationRepo();
      const ownerId = new ObjectId();
      const slug = `unique-slug-${Date.now()}`;

      const orgId = await repo.add({
        name: `Slug Test Org`,
        slug,
        ownerId: ownerId.toString(),
      });

      createdOrgIds.push(orgId);

      const org = await repo.getBySlug(slug);

      expect(org).to.exist;
      expect(org!.slug).to.equal(slug);
    });

    it("should return null for non-existent slug", async () => {
      const repo = useOrganizationRepo();
      const org = await repo.getBySlug(`nonexistent-${Date.now()}`);

      expect(org).to.be.null;
    });

    it("should get organizations by owner ID", async () => {
      const repo = useOrganizationRepo();
      const ownerId = new ObjectId();

      // Create multiple orgs for same owner
      for (let i = 0; i < 3; i++) {
        const orgId = await repo.add({
          name: `Owner Org ${Date.now()}-${i}`,
          ownerId: ownerId.toString(),
        });
        createdOrgIds.push(orgId);
      }

      const orgs = await repo.getByOwnerId(ownerId);

      expect(orgs).to.be.an("array");
      expect(orgs.length).to.be.at.least(3);
    });

    it("should update organization by ID", async () => {
      const repo = useOrganizationRepo();
      const ownerId = new ObjectId();

      const orgId = await repo.add({
        name: `Update Test Org ${Date.now()}`,
        ownerId: ownerId.toString(),
      });

      createdOrgIds.push(orgId);

      await repo.updateById(orgId, {
        name: "Updated Name",
        billingEmail: "billing@example.com",
      });

      const org = await repo.getById(orgId);

      expect(org!.name).to.equal("Updated Name");
      expect(org!.billingEmail).to.equal("billing@example.com");
    });

    it("should delete organization by ID", async () => {
      const repo = useOrganizationRepo();
      const ownerId = new ObjectId();

      const orgId = await repo.add({
        name: `Delete Test Org ${Date.now()}`,
        ownerId: ownerId.toString(),
      });

      await repo.deleteById(orgId);

      const org = await repo.getById(orgId);
      expect(org).to.be.null;
    });

    it("should throw NotFoundError when deleting non-existent organization", async () => {
      const repo = useOrganizationRepo();
      const fakeId = new ObjectId();

      try {
        await repo.deleteById(fakeId);
        expect.fail("Should have thrown NotFoundError");
      } catch (error: any) {
        expect(error.message).to.include("not found");
      }
    });

    it("should reject invalid organization ID format", async () => {
      const repo = useOrganizationRepo();

      try {
        await repo.getById("invalid-id");
        expect.fail("Should have thrown BadRequestError");
      } catch (error: any) {
        expect(error.message).to.include("Invalid");
      }
    });

    it("should reject duplicate slug", async () => {
      const repo = useOrganizationRepo();
      const ownerId = new ObjectId();
      const slug = `duplicate-slug-${Date.now()}`;

      const orgId1 = await repo.add({
        name: "First Org",
        slug,
        ownerId: ownerId.toString(),
      });

      createdOrgIds.push(orgId1);

      try {
        await repo.add({
          name: "Second Org",
          slug,
          ownerId: ownerId.toString(),
        });
        expect.fail("Should have thrown ConflictError");
      } catch (error: any) {
        expect(error.message).to.include("already exists");
      }
    });

    it("should update usage correctly", async () => {
      const repo = useOrganizationRepo();
      const ownerId = new ObjectId();

      const orgId = await repo.add({
        name: `Usage Test Org ${Date.now()}`,
        ownerId: ownerId.toString(),
      });

      createdOrgIds.push(orgId);

      // Initial usage should be 0 for apps, databases, storage
      let org = await repo.getById(orgId);
      expect(org!.usage.apps).to.equal(0);
      expect(org!.usage.users).to.equal(1); // Owner counts as first user

      // Increment apps usage
      await repo.updateUsage(orgId, "apps", 3);
      org = await repo.getById(orgId);
      expect(org!.usage.apps).to.equal(3);

      // Decrement apps usage
      await repo.updateUsage(orgId, "apps", -1);
      org = await repo.getById(orgId);
      expect(org!.usage.apps).to.equal(2);
    });

    it("should check limits correctly", async () => {
      const repo = useOrganizationRepo();
      const ownerId = new ObjectId();

      const orgId = await repo.add({
        name: `Limit Check Org ${Date.now()}`,
        ownerId: ownerId.toString(),
        plan: "free",
      });

      createdOrgIds.push(orgId);

      // Free plan has maxApps = 2
      let result = await repo.checkLimit(orgId, "apps");
      expect(result.withinLimit).to.be.true;
      expect(result.current).to.equal(0);
      expect(result.max).to.equal(2);

      // Add 2 apps
      await repo.updateUsage(orgId, "apps", 2);
      result = await repo.checkLimit(orgId, "apps");
      expect(result.withinLimit).to.be.false;
      expect(result.current).to.equal(2);
    });

    it("should handle unlimited limits (-1)", async () => {
      const repo = useOrganizationRepo();
      const ownerId = new ObjectId();

      const orgId = await repo.add({
        name: `Enterprise Org ${Date.now()}`,
        ownerId: ownerId.toString(),
        plan: "enterprise",
      });

      createdOrgIds.push(orgId);

      // Add many apps
      await repo.updateUsage(orgId, "apps", 1000);

      const result = await repo.checkLimit(orgId, "apps");
      expect(result.withinLimit).to.be.true;
      expect(result.max).to.equal(-1);
    });

    it("should update plan and limits", async () => {
      const repo = useOrganizationRepo();
      const ownerId = new ObjectId();

      const orgId = await repo.add({
        name: `Plan Upgrade Org ${Date.now()}`,
        ownerId: ownerId.toString(),
        plan: "free",
      });

      createdOrgIds.push(orgId);

      await repo.updatePlan(orgId, "pro");

      const org = await repo.getById(orgId);
      expect(org!.plan).to.equal("pro");
      expect(org!.limits).to.deep.equal(PLAN_LIMITS.pro);
    });

    it("should transfer ownership", async () => {
      const repo = useOrganizationRepo();
      const originalOwner = new ObjectId();
      const newOwner = new ObjectId();

      const orgId = await repo.add({
        name: `Transfer Org ${Date.now()}`,
        ownerId: originalOwner.toString(),
      });

      createdOrgIds.push(orgId);

      await repo.transferOwnership(orgId, newOwner);

      const org = await repo.getById(orgId);
      expect(org!.ownerId.toString()).to.equal(newOwner.toString());
    });

    it("should get all organizations with pagination", async () => {
      const repo = useOrganizationRepo();
      const ownerId = new ObjectId();

      // Create some organizations
      for (let i = 0; i < 3; i++) {
        const orgId = await repo.add({
          name: `Pagination Org ${Date.now()}-${i}`,
          ownerId: ownerId.toString(),
        });
        createdOrgIds.push(orgId);
      }

      const result = await repo.getAll({ page: 1, limit: 10 });

      expect(result.items).to.be.an("array");
      expect(result.pages).to.be.at.least(1);
      expect(result.items.length).to.be.at.least(3);
    });

    it("should filter organizations by plan", async () => {
      const repo = useOrganizationRepo();
      const ownerId = new ObjectId();

      const orgId = await repo.add({
        name: `Pro Filter Org ${Date.now()}`,
        ownerId: ownerId.toString(),
        plan: "pro",
      });

      createdOrgIds.push(orgId);

      const result = await repo.getAll({ plan: "pro" });

      expect(result.items).to.be.an("array");
      const found = result.items.find((o: any) => o._id.toString() === orgId.toString());
      expect(found).to.exist;
      expect(found.plan).to.equal("pro");
    });

    it("should search organizations by name", async () => {
      const repo = useOrganizationRepo();
      const ownerId = new ObjectId();
      const searchTerm = `UniqueSearch${Date.now()}`;

      const orgId = await repo.add({
        name: `${searchTerm} Organization`,
        ownerId: ownerId.toString(),
      });

      createdOrgIds.push(orgId);

      const result = await repo.getAll({ search: searchTerm });

      expect(result.items).to.be.an("array");
      expect(result.items.length).to.be.at.least(1);
    });
  });

  // ===========================================================================
  // Organization Member Repository Tests
  // ===========================================================================

  describe("Organization Member Repository", () => {
    it("should add a member to organization", async () => {
      const orgRepo = useOrganizationRepo();
      const memberRepo = useOrganizationMemberRepo();
      const ownerId = new ObjectId();
      const userId = new ObjectId();
      const roleId = new ObjectId();

      const orgId = await orgRepo.add({
        name: `Member Test Org ${Date.now()}`,
        ownerId: ownerId.toString(),
      });
      createdOrgIds.push(orgId);

      const memberId = await memberRepo.add({
        organizationId: orgId.toString(),
        userId: userId.toString(),
        roleId: roleId.toString(),
      });

      createdMemberIds.push(memberId);

      expect(memberId).to.exist;
    });

    it("should check if user is a member", async () => {
      const orgRepo = useOrganizationRepo();
      const memberRepo = useOrganizationMemberRepo();
      const ownerId = new ObjectId();
      const userId = new ObjectId();
      const roleId = new ObjectId();

      const orgId = await orgRepo.add({
        name: `IsMember Test Org ${Date.now()}`,
        ownerId: ownerId.toString(),
      });
      createdOrgIds.push(orgId);

      // Before adding
      let isMember = await memberRepo.isMember(orgId, userId);
      expect(isMember).to.be.false;

      // Add member
      const memberId = await memberRepo.add({
        organizationId: orgId.toString(),
        userId: userId.toString(),
        roleId: roleId.toString(),
      });
      createdMemberIds.push(memberId);

      // After adding
      isMember = await memberRepo.isMember(orgId, userId);
      expect(isMember).to.be.true;
    });

    it("should get member by organization and user", async () => {
      const orgRepo = useOrganizationRepo();
      const memberRepo = useOrganizationMemberRepo();
      const ownerId = new ObjectId();
      const userId = new ObjectId();
      const roleId = new ObjectId();

      const orgId = await orgRepo.add({
        name: `GetByOrgUser Test ${Date.now()}`,
        ownerId: ownerId.toString(),
      });
      createdOrgIds.push(orgId);

      const memberId = await memberRepo.add({
        organizationId: orgId.toString(),
        userId: userId.toString(),
        roleId: roleId.toString(),
      });
      createdMemberIds.push(memberId);

      const member = await memberRepo.getByOrgAndUser(orgId, userId);

      expect(member).to.exist;
      expect(member!.userId.toString()).to.equal(userId.toString());
      expect(member!.roleId.toString()).to.equal(roleId.toString());
    });

    it("should get all members by organization", async () => {
      const orgRepo = useOrganizationRepo();
      const memberRepo = useOrganizationMemberRepo();
      const ownerId = new ObjectId();

      const orgId = await orgRepo.add({
        name: `Members List Test ${Date.now()}`,
        ownerId: ownerId.toString(),
      });
      createdOrgIds.push(orgId);

      // Add multiple members
      for (let i = 0; i < 3; i++) {
        const memberId = await memberRepo.add({
          organizationId: orgId.toString(),
          userId: new ObjectId().toString(),
          roleId: new ObjectId().toString(),
        });
        createdMemberIds.push(memberId);
      }

      const result = await memberRepo.getByOrganizationId(orgId);

      expect(result.items).to.be.an("array");
      expect(result.items.length).to.be.at.least(3);
    });

    it("should get all memberships for a user", async () => {
      const orgRepo = useOrganizationRepo();
      const memberRepo = useOrganizationMemberRepo();
      const userId = new ObjectId();

      // Create multiple orgs and add user to each
      for (let i = 0; i < 3; i++) {
        const orgId = await orgRepo.add({
          name: `User Memberships Test ${Date.now()}-${i}`,
          ownerId: new ObjectId().toString(),
        });
        createdOrgIds.push(orgId);

        const memberId = await memberRepo.add({
          organizationId: orgId.toString(),
          userId: userId.toString(),
          roleId: new ObjectId().toString(),
        });
        createdMemberIds.push(memberId);
      }

      const memberships = await memberRepo.getByUserId(userId);

      expect(memberships).to.be.an("array");
      expect(memberships.length).to.be.at.least(3);
    });

    it("should update member role", async () => {
      const orgRepo = useOrganizationRepo();
      const memberRepo = useOrganizationMemberRepo();
      const ownerId = new ObjectId();
      const userId = new ObjectId();
      const originalRoleId = new ObjectId();
      const newRoleId = new ObjectId();

      const orgId = await orgRepo.add({
        name: `Update Role Test ${Date.now()}`,
        ownerId: ownerId.toString(),
      });
      createdOrgIds.push(orgId);

      const memberId = await memberRepo.add({
        organizationId: orgId.toString(),
        userId: userId.toString(),
        roleId: originalRoleId.toString(),
      });
      createdMemberIds.push(memberId);

      await memberRepo.updateRole(memberId, newRoleId);

      const member = await memberRepo.getById(memberId);
      expect(member!.roleId.toString()).to.equal(newRoleId.toString());
    });

    it("should delete member by organization and user", async () => {
      const orgRepo = useOrganizationRepo();
      const memberRepo = useOrganizationMemberRepo();
      const ownerId = new ObjectId();
      const userId = new ObjectId();

      const orgId = await orgRepo.add({
        name: `Delete Member Test ${Date.now()}`,
        ownerId: ownerId.toString(),
      });
      createdOrgIds.push(orgId);

      await memberRepo.add({
        organizationId: orgId.toString(),
        userId: userId.toString(),
        roleId: new ObjectId().toString(),
      });

      await memberRepo.deleteByOrgAndUser(orgId, userId);

      const isMember = await memberRepo.isMember(orgId, userId);
      expect(isMember).to.be.false;
    });

    it("should not allow duplicate membership", async () => {
      const orgRepo = useOrganizationRepo();
      const memberRepo = useOrganizationMemberRepo();
      const ownerId = new ObjectId();
      const userId = new ObjectId();

      const orgId = await orgRepo.add({
        name: `Duplicate Member Test ${Date.now()}`,
        ownerId: ownerId.toString(),
      });
      createdOrgIds.push(orgId);

      const memberId = await memberRepo.add({
        organizationId: orgId.toString(),
        userId: userId.toString(),
        roleId: new ObjectId().toString(),
      });
      createdMemberIds.push(memberId);

      try {
        await memberRepo.add({
          organizationId: orgId.toString(),
          userId: userId.toString(),
          roleId: new ObjectId().toString(),
        });
        expect.fail("Should have thrown ConflictError");
      } catch (error: any) {
        expect(error.message).to.include("already a member");
      }
    });

    it("should count members by organization", async () => {
      const orgRepo = useOrganizationRepo();
      const memberRepo = useOrganizationMemberRepo();
      const ownerId = new ObjectId();

      const orgId = await orgRepo.add({
        name: `Count Members Test ${Date.now()}`,
        ownerId: ownerId.toString(),
      });
      createdOrgIds.push(orgId);

      // Add members
      for (let i = 0; i < 5; i++) {
        const memberId = await memberRepo.add({
          organizationId: orgId.toString(),
          userId: new ObjectId().toString(),
          roleId: new ObjectId().toString(),
        });
        createdMemberIds.push(memberId);
      }

      const count = await memberRepo.countByOrganizationId(orgId);
      expect(count).to.equal(5);
    });
  });

  // ===========================================================================
  // Organization Invite Repository Tests
  // ===========================================================================

  describe("Organization Invite Repository", () => {
    it("should create an invite", async () => {
      const orgRepo = useOrganizationRepo();
      const inviteRepo = useOrganizationInviteRepo();
      const ownerId = new ObjectId();

      const orgId = await orgRepo.add({
        name: `Invite Test Org ${Date.now()}`,
        ownerId: ownerId.toString(),
      });
      createdOrgIds.push(orgId);

      const result = await inviteRepo.add({
        organizationId: orgId.toString(),
        email: `invite-${Date.now()}@example.com`,
        roleId: new ObjectId().toString(),
        invitedBy: ownerId.toString(),
      });

      createdInviteIds.push(result.insertedId);

      expect(result.insertedId).to.exist;
      expect(result.token).to.be.a("string");
      expect(result.token.length).to.equal(64);
    });

    it("should get invite by token", async () => {
      const orgRepo = useOrganizationRepo();
      const inviteRepo = useOrganizationInviteRepo();
      const ownerId = new ObjectId();
      const email = `invite-token-${Date.now()}@example.com`;

      const orgId = await orgRepo.add({
        name: `Invite Token Test ${Date.now()}`,
        ownerId: ownerId.toString(),
      });
      createdOrgIds.push(orgId);

      const result = await inviteRepo.add({
        organizationId: orgId.toString(),
        email,
        roleId: new ObjectId().toString(),
        invitedBy: ownerId.toString(),
      });
      createdInviteIds.push(result.insertedId);

      const invite = await inviteRepo.getByToken(result.token);

      expect(invite).to.exist;
      expect(invite!.email).to.equal(email.toLowerCase());
      expect(invite!.token).to.equal(result.token);
    });

    it("should return null for invalid token", async () => {
      const inviteRepo = useOrganizationInviteRepo();
      const invite = await inviteRepo.getByToken("nonexistent-token");

      expect(invite).to.be.null;
    });

    it("should get invites by organization", async () => {
      const orgRepo = useOrganizationRepo();
      const inviteRepo = useOrganizationInviteRepo();
      const ownerId = new ObjectId();

      const orgId = await orgRepo.add({
        name: `Org Invites Test ${Date.now()}`,
        ownerId: ownerId.toString(),
      });
      createdOrgIds.push(orgId);

      // Create multiple invites
      for (let i = 0; i < 3; i++) {
        const result = await inviteRepo.add({
          organizationId: orgId.toString(),
          email: `invite-org-${Date.now()}-${i}@example.com`,
          roleId: new ObjectId().toString(),
          invitedBy: ownerId.toString(),
        });
        createdInviteIds.push(result.insertedId);
      }

      const result = await inviteRepo.getByOrganizationId(orgId);

      expect(result.items).to.be.an("array");
      expect(result.items.length).to.be.at.least(3);
    });

    it("should get invites by email", async () => {
      const orgRepo = useOrganizationRepo();
      const inviteRepo = useOrganizationInviteRepo();
      const email = `multi-invite-${Date.now()}@example.com`;

      // Create multiple orgs and invite same email
      for (let i = 0; i < 2; i++) {
        const orgId = await orgRepo.add({
          name: `Email Invite Test ${Date.now()}-${i}`,
          ownerId: new ObjectId().toString(),
        });
        createdOrgIds.push(orgId);

        const result = await inviteRepo.add({
          organizationId: orgId.toString(),
          email,
          roleId: new ObjectId().toString(),
          invitedBy: new ObjectId().toString(),
        });
        createdInviteIds.push(result.insertedId);
      }

      const invites = await inviteRepo.getByEmail(email);

      expect(invites).to.be.an("array");
      expect(invites.length).to.be.at.least(2);
    });

    it("should mark invite as accepted", async () => {
      const orgRepo = useOrganizationRepo();
      const inviteRepo = useOrganizationInviteRepo();
      const ownerId = new ObjectId();

      const orgId = await orgRepo.add({
        name: `Accept Invite Test ${Date.now()}`,
        ownerId: ownerId.toString(),
      });
      createdOrgIds.push(orgId);

      const result = await inviteRepo.add({
        organizationId: orgId.toString(),
        email: `accept-${Date.now()}@example.com`,
        roleId: new ObjectId().toString(),
        invitedBy: ownerId.toString(),
      });
      createdInviteIds.push(result.insertedId);

      await inviteRepo.markAccepted(result.insertedId);

      const invite = await inviteRepo.getById(result.insertedId);
      expect(invite!.acceptedAt).to.exist;
    });

    it("should check for pending invite by org and email", async () => {
      const orgRepo = useOrganizationRepo();
      const inviteRepo = useOrganizationInviteRepo();
      const ownerId = new ObjectId();
      const email = `pending-check-${Date.now()}@example.com`;

      const orgId = await orgRepo.add({
        name: `Pending Check Test ${Date.now()}`,
        ownerId: ownerId.toString(),
      });
      createdOrgIds.push(orgId);

      // Check before creating invite
      let pending = await inviteRepo.getPendingByOrgAndEmail(orgId, email);
      expect(pending).to.be.null;

      // Create invite
      const result = await inviteRepo.add({
        organizationId: orgId.toString(),
        email,
        roleId: new ObjectId().toString(),
        invitedBy: ownerId.toString(),
      });
      createdInviteIds.push(result.insertedId);

      // Check after creating invite
      pending = await inviteRepo.getPendingByOrgAndEmail(orgId, email);
      expect(pending).to.exist;
    });

    it("should not return accepted invites as pending", async () => {
      const orgRepo = useOrganizationRepo();
      const inviteRepo = useOrganizationInviteRepo();
      const ownerId = new ObjectId();
      const email = `accepted-pending-${Date.now()}@example.com`;

      const orgId = await orgRepo.add({
        name: `Accepted Pending Test ${Date.now()}`,
        ownerId: ownerId.toString(),
      });
      createdOrgIds.push(orgId);

      const result = await inviteRepo.add({
        organizationId: orgId.toString(),
        email,
        roleId: new ObjectId().toString(),
        invitedBy: ownerId.toString(),
      });
      createdInviteIds.push(result.insertedId);

      // Mark as accepted
      await inviteRepo.markAccepted(result.insertedId);

      // Should not be found as pending
      const pending = await inviteRepo.getPendingByOrgAndEmail(orgId, email);
      expect(pending).to.be.null;
    });

    it("should delete invites by organization", async () => {
      const orgRepo = useOrganizationRepo();
      const inviteRepo = useOrganizationInviteRepo();
      const ownerId = new ObjectId();

      const orgId = await orgRepo.add({
        name: `Delete Org Invites Test ${Date.now()}`,
        ownerId: ownerId.toString(),
      });
      createdOrgIds.push(orgId);

      // Create invites
      for (let i = 0; i < 3; i++) {
        await inviteRepo.add({
          organizationId: orgId.toString(),
          email: `delete-org-invite-${Date.now()}-${i}@example.com`,
          roleId: new ObjectId().toString(),
          invitedBy: ownerId.toString(),
        });
      }

      await inviteRepo.deleteByOrganizationId(orgId);

      const result = await inviteRepo.getByOrganizationId(orgId);
      expect(result.items.length).to.equal(0);
    });
  });

  // ===========================================================================
  // Organization Service Tests
  // ===========================================================================

  describe("Organization Service", () => {
    it("should create organization and add owner as member", async () => {
      const service = useOrganizationService();
      const memberRepo = useOrganizationMemberRepo();
      const userRepo = useUserRepo();

      // Create a user first
      const hashedPassword = await hashPassword("testpassword123");
      const userId = await userRepo.add({
        email: `owner-${Date.now()}@example.com`,
        password: hashedPassword,
      });
      createdUserIds.push(userId.toString());

      const orgId = await service.create({
        name: `Service Create Test ${Date.now()}`,
        ownerId: userId.toString(),
      });

      createdOrgIds.push(orgId);

      // Verify owner is a member
      const isMember = await memberRepo.isMember(orgId, userId);
      expect(isMember).to.be.true;
    });

    it("should not allow non-owner to update organization", async () => {
      const service = useOrganizationService();
      const userRepo = useUserRepo();
      const hashedPassword = await hashPassword("testpassword123");

      // Create owner
      const ownerId = await userRepo.add({
        email: `update-owner-${Date.now()}@example.com`,
        password: hashedPassword,
      });
      createdUserIds.push(ownerId.toString());

      // Create another user
      const otherId = await userRepo.add({
        email: `update-other-${Date.now()}@example.com`,
        password: hashedPassword,
      });
      createdUserIds.push(otherId.toString());

      const orgId = await service.create({
        name: `Permission Test Org ${Date.now()}`,
        ownerId: ownerId.toString(),
      });
      createdOrgIds.push(orgId);

      try {
        await service.update(orgId.toString(), otherId.toString(), {
          name: "Hacked Name",
        });
        expect.fail("Should have thrown ForbiddenError");
      } catch (error: any) {
        expect(error.message).to.include("owner");
      }
    });

    it("should allow owner to update organization", async () => {
      const service = useOrganizationService();
      const orgRepo = useOrganizationRepo();
      const userRepo = useUserRepo();
      const hashedPassword = await hashPassword("testpassword123");

      const ownerId = await userRepo.add({
        email: `owner-update-${Date.now()}@example.com`,
        password: hashedPassword,
      });
      createdUserIds.push(ownerId.toString());

      const orgId = await service.create({
        name: `Owner Update Test ${Date.now()}`,
        ownerId: ownerId.toString(),
      });
      createdOrgIds.push(orgId);

      await service.update(orgId.toString(), ownerId.toString(), {
        name: "Updated By Owner",
      });

      const org = await orgRepo.getById(orgId);
      expect(org!.name).to.equal("Updated By Owner");
    });

    it("should not allow non-owner to delete organization", async () => {
      const service = useOrganizationService();
      const userRepo = useUserRepo();
      const hashedPassword = await hashPassword("testpassword123");

      const ownerId = await userRepo.add({
        email: `delete-owner-${Date.now()}@example.com`,
        password: hashedPassword,
      });
      createdUserIds.push(ownerId.toString());

      const otherId = await userRepo.add({
        email: `delete-other-${Date.now()}@example.com`,
        password: hashedPassword,
      });
      createdUserIds.push(otherId.toString());

      const orgId = await service.create({
        name: `Delete Permission Test ${Date.now()}`,
        ownerId: ownerId.toString(),
      });
      createdOrgIds.push(orgId);

      try {
        await service.remove(orgId.toString(), otherId.toString());
        expect.fail("Should have thrown ForbiddenError");
      } catch (error: any) {
        expect(error.message).to.include("owner");
      }
    });

    it("should check membership correctly", async () => {
      const service = useOrganizationService();
      const memberRepo = useOrganizationMemberRepo();
      const userRepo = useUserRepo();
      const hashedPassword = await hashPassword("testpassword123");

      const ownerId = await userRepo.add({
        email: `membership-owner-${Date.now()}@example.com`,
        password: hashedPassword,
      });
      createdUserIds.push(ownerId.toString());

      const memberId = await userRepo.add({
        email: `membership-member-${Date.now()}@example.com`,
        password: hashedPassword,
      });
      createdUserIds.push(memberId.toString());

      const nonMemberId = new ObjectId();

      const orgId = await service.create({
        name: `Membership Test ${Date.now()}`,
        ownerId: ownerId.toString(),
      });
      createdOrgIds.push(orgId);

      // Add member
      const memberAddedId = await memberRepo.add({
        organizationId: orgId.toString(),
        userId: memberId.toString(),
        roleId: new ObjectId().toString(),
      });
      createdMemberIds.push(memberAddedId);

      // Check membership
      const ownerIsMember = await service.isMember(orgId, ownerId);
      const userIsMember = await service.isMember(orgId, memberId);
      const nonMemberIs = await service.isMember(orgId, nonMemberId);

      expect(ownerIsMember).to.be.true;
      expect(userIsMember).to.be.true;
      expect(nonMemberIs).to.be.false;
    });

    it("should check resource limits", async () => {
      const service = useOrganizationService();
      const orgRepo = useOrganizationRepo();
      const userRepo = useUserRepo();
      const hashedPassword = await hashPassword("testpassword123");

      const ownerId = await userRepo.add({
        email: `limit-owner-${Date.now()}@example.com`,
        password: hashedPassword,
      });
      createdUserIds.push(ownerId.toString());

      const orgId = await service.create({
        name: `Limit Test ${Date.now()}`,
        ownerId: ownerId.toString(),
      });
      createdOrgIds.push(orgId);

      // Should pass when within limit
      await service.checkResourceLimit(orgId, "apps");

      // Use up the limit
      await orgRepo.updateUsage(orgId, "apps", 2);

      // Should throw when limit exceeded
      try {
        await service.checkResourceLimit(orgId, "apps");
        expect.fail("Should have thrown BadRequestError");
      } catch (error: any) {
        expect(error.message).to.include("limit reached");
      }
    });

    it("should increment and decrement usage", async () => {
      const service = useOrganizationService();
      const orgRepo = useOrganizationRepo();
      const userRepo = useUserRepo();
      const hashedPassword = await hashPassword("testpassword123");

      const ownerId = await userRepo.add({
        email: `usage-owner-${Date.now()}@example.com`,
        password: hashedPassword,
      });
      createdUserIds.push(ownerId.toString());

      const orgId = await service.create({
        name: `Usage Test ${Date.now()}`,
        ownerId: ownerId.toString(),
      });
      createdOrgIds.push(orgId);

      // Increment
      await service.incrementUsage(orgId, "databases", 3);
      let org = await orgRepo.getById(orgId);
      expect(org!.usage.databases).to.equal(3);

      // Decrement
      await service.decrementUsage(orgId, "databases", 1);
      org = await orgRepo.getById(orgId);
      expect(org!.usage.databases).to.equal(2);
    });

    it("should get usage stats", async () => {
      const service = useOrganizationService();
      const orgRepo = useOrganizationRepo();
      const userRepo = useUserRepo();
      const hashedPassword = await hashPassword("testpassword123");

      const ownerId = await userRepo.add({
        email: `stats-owner-${Date.now()}@example.com`,
        password: hashedPassword,
      });
      createdUserIds.push(ownerId.toString());

      const orgId = await service.create({
        name: `Stats Test ${Date.now()}`,
        ownerId: ownerId.toString(),
      });
      createdOrgIds.push(orgId);

      // Add some usage
      await orgRepo.updateUsage(orgId, "apps", 1);

      const stats = await service.getUsageStats(orgId.toString());

      expect(stats).to.have.property("usage");
      expect(stats).to.have.property("limits");
      expect(stats).to.have.property("plan");
      expect(stats).to.have.property("percentages");
      expect(stats.usage.apps).to.equal(1);
      expect(stats.percentages.apps).to.equal(50); // 1/2 * 100 for free plan
    });

    it("should transfer ownership", async () => {
      const service = useOrganizationService();
      const orgRepo = useOrganizationRepo();
      const memberRepo = useOrganizationMemberRepo();
      const userRepo = useUserRepo();
      const hashedPassword = await hashPassword("testpassword123");

      // Create original owner
      const originalOwnerId = await userRepo.add({
        email: `original-owner-${Date.now()}@example.com`,
        password: hashedPassword,
      });
      createdUserIds.push(originalOwnerId.toString());

      // Create new owner
      const newOwnerId = await userRepo.add({
        email: `new-owner-${Date.now()}@example.com`,
        password: hashedPassword,
      });
      createdUserIds.push(newOwnerId.toString());

      // Create org
      const orgId = await service.create({
        name: `Transfer Test ${Date.now()}`,
        ownerId: originalOwnerId.toString(),
      });
      createdOrgIds.push(orgId);

      // Add new owner as member first
      const memberId = await memberRepo.add({
        organizationId: orgId.toString(),
        userId: newOwnerId.toString(),
        roleId: new ObjectId().toString(),
      });
      createdMemberIds.push(memberId);

      // Transfer ownership
      await service.transferOwnership(
        orgId.toString(),
        newOwnerId.toString(),
        originalOwnerId.toString()
      );

      // Verify
      const org = await orgRepo.getById(orgId);
      expect(org!.ownerId.toString()).to.equal(newOwnerId.toString());
    });

    it("should not transfer to non-member", async () => {
      const service = useOrganizationService();
      const userRepo = useUserRepo();
      const hashedPassword = await hashPassword("testpassword123");

      const ownerId = await userRepo.add({
        email: `transfer-owner-${Date.now()}@example.com`,
        password: hashedPassword,
      });
      createdUserIds.push(ownerId.toString());

      const nonMemberId = new ObjectId();

      const orgId = await service.create({
        name: `Transfer Fail Test ${Date.now()}`,
        ownerId: ownerId.toString(),
      });
      createdOrgIds.push(orgId);

      try {
        await service.transferOwnership(
          orgId.toString(),
          nonMemberId.toString(),
          ownerId.toString()
        );
        expect.fail("Should have thrown BadRequestError");
      } catch (error: any) {
        expect(error.message).to.include("member");
      }
    });

    it("should get all organizations for a user", async () => {
      const service = useOrganizationService();
      const memberRepo = useOrganizationMemberRepo();
      const userRepo = useUserRepo();
      const hashedPassword = await hashPassword("testpassword123");

      const userId = await userRepo.add({
        email: `user-orgs-${Date.now()}@example.com`,
        password: hashedPassword,
      });
      createdUserIds.push(userId.toString());

      // Create multiple orgs where user is a member
      for (let i = 0; i < 3; i++) {
        const ownerId = await userRepo.add({
          email: `user-orgs-owner-${Date.now()}-${i}@example.com`,
          password: hashedPassword,
        });
        createdUserIds.push(ownerId.toString());

        const orgId = await service.create({
          name: `User Orgs Test ${Date.now()}-${i}`,
          ownerId: ownerId.toString(),
        });
        createdOrgIds.push(orgId);

        const memberId = await memberRepo.add({
          organizationId: orgId.toString(),
          userId: userId.toString(),
          roleId: new ObjectId().toString(),
        });
        createdMemberIds.push(memberId);
      }

      const orgs = await service.getUserOrganizations(userId.toString());

      expect(orgs).to.be.an("array");
      expect(orgs.length).to.be.at.least(3);
      orgs.forEach((org) => {
        expect(org).to.have.property("membership");
        expect(org.membership).to.have.property("roleId");
        expect(org.membership).to.have.property("joinedAt");
      });
    });
  });

  // ===========================================================================
  // Validation Tests
  // ===========================================================================

  describe("Validation", () => {
    it("should reject organization without name", async () => {
      const repo = useOrganizationRepo();

      try {
        await repo.add({
          name: "",
          ownerId: new ObjectId().toString(),
        } as any);
        expect.fail("Should have thrown error");
      } catch (error: any) {
        expect(error.message).to.include("validation");
      }
    });

    it("should reject organization without ownerId", async () => {
      const repo = useOrganizationRepo();

      try {
        await repo.add({
          name: "Test Org",
        } as any);
        expect.fail("Should have thrown error");
      } catch (error: any) {
        expect(error.message).to.include("required");
      }
    });

    it("should reject invalid slug format", async () => {
      const repo = useOrganizationRepo();

      try {
        await repo.add({
          name: "Test Org",
          slug: "Invalid Slug With Spaces",
          ownerId: new ObjectId().toString(),
        });
        expect.fail("Should have thrown error");
      } catch (error: any) {
        expect(error.message.toLowerCase()).to.include("slug");
      }
    });

    it("should reject invalid plan", async () => {
      const repo = useOrganizationRepo();

      try {
        await repo.add({
          name: "Test Org",
          plan: "invalid-plan" as any,
          ownerId: new ObjectId().toString(),
        });
        expect.fail("Should have thrown error");
      } catch (error: any) {
        expect(error.message).to.include("validation");
      }
    });

    it("should reject invalid email format for invite", async () => {
      const orgRepo = useOrganizationRepo();
      const inviteRepo = useOrganizationInviteRepo();
      const ownerId = new ObjectId();

      const orgId = await orgRepo.add({
        name: `Invalid Email Test ${Date.now()}`,
        ownerId: ownerId.toString(),
      });
      createdOrgIds.push(orgId);

      try {
        await inviteRepo.add({
          organizationId: orgId.toString(),
          email: "not-an-email",
          roleId: new ObjectId().toString(),
          invitedBy: ownerId.toString(),
        });
        expect.fail("Should have thrown error");
      } catch (error: any) {
        expect(error.message).to.include("validation");
      }
    });

    it("should reject invalid member data", async () => {
      const memberRepo = useOrganizationMemberRepo();

      try {
        await memberRepo.add({
          organizationId: "invalid-id",
          userId: new ObjectId().toString(),
          roleId: new ObjectId().toString(),
        });
        expect.fail("Should have thrown error");
      } catch (error: any) {
        expect(error.message).to.include("Invalid");
      }
    });
  });
});
