import { expect } from "chai";
import { describe, it, afterEach } from "mocha";
import { ObjectId } from "mongodb";
import { useRoleRepo } from "../src/resources/role/role.repository";
import { useRoleService } from "../src/resources/role/role.service";
import {
  TRole,
  TPermission,
  permissions,
  DEFAULT_ROLES,
  hasPermission,
  hasPermissionMatch,
} from "../src/resources/role/role.model";
import { useUserRepo } from "../src/resources/user";
import { hashPassword } from "../src/utils";

describe("Role Resource (RBAC)", function () {
  this.timeout(10000);

  const createdRoleIds: string[] = [];
  const createdUserIds: string[] = [];

  afterEach(async () => {
    // Clean up created roles
    const repo = useRoleRepo();
    for (const id of createdRoleIds) {
      try {
        // Only delete non-system roles
        const role = await repo.getById(id);
        if (role && !role.isSystem) {
          await repo.deleteById(id);
        }
      } catch {
        // Ignore errors
      }
    }
    createdRoleIds.length = 0;

    // Clean up created users
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

  describe("Role Model", () => {
    it("should export all permission types", () => {
      expect(permissions).to.be.an("array");
      expect(permissions).to.include("apps:read");
      expect(permissions).to.include("apps:create");
      expect(permissions).to.include("apps:update");
      expect(permissions).to.include("apps:delete");
      expect(permissions).to.include("apps:deploy");
      expect(permissions).to.include("databases:read");
      expect(permissions).to.include("databases:backup");
      expect(permissions).to.include("nodes:read");
      expect(permissions).to.include("roles:read");
      expect(permissions).to.include("roles:create");
      expect(permissions).to.include("users:read");
      expect(permissions).to.include("admin:*");
    });

    it("should export default system roles", () => {
      expect(DEFAULT_ROLES).to.be.an("array");
      expect(DEFAULT_ROLES.length).to.be.at.least(4);

      const roleNames = DEFAULT_ROLES.map((r) => r.name);
      expect(roleNames).to.include("admin");
      expect(roleNames).to.include("developer");
      expect(roleNames).to.include("viewer");
      expect(roleNames).to.include("operator");
    });

    it("should have admin role with admin:* permission", () => {
      const adminRole = DEFAULT_ROLES.find((r) => r.name === "admin");
      expect(adminRole).to.exist;
      expect(adminRole?.permissions).to.include("admin:*");
      expect(adminRole?.isSystem).to.be.true;
    });

    it("should have viewer role with read-only permissions", () => {
      const viewerRole = DEFAULT_ROLES.find((r) => r.name === "viewer");
      expect(viewerRole).to.exist;
      expect(viewerRole?.permissions).to.include("apps:read");
      expect(viewerRole?.permissions).to.include("databases:read");
      expect(viewerRole?.permissions).to.not.include("apps:create");
      expect(viewerRole?.permissions).to.not.include("apps:delete");
    });
  });

  // ===========================================================================
  // Permission Helper Tests
  // ===========================================================================

  describe("Permission Helpers", () => {
    it("should match exact permissions", () => {
      expect(hasPermissionMatch("apps:read", "apps:read")).to.be.true;
      expect(hasPermissionMatch("apps:create", "apps:create")).to.be.true;
    });

    it("should not match different permissions", () => {
      expect(hasPermissionMatch("apps:read", "apps:create")).to.be.false;
      expect(hasPermissionMatch("apps:read", "databases:read")).to.be.false;
    });

    it("should grant all permissions with admin:*", () => {
      expect(hasPermissionMatch("admin:*", "apps:read")).to.be.true;
      expect(hasPermissionMatch("admin:*", "apps:create")).to.be.true;
      expect(hasPermissionMatch("admin:*", "databases:delete")).to.be.true;
      expect(hasPermissionMatch("admin:*", "roles:create")).to.be.true;
    });

    it("should check permission in array", () => {
      const userPermissions: TPermission[] = ["apps:read", "apps:create", "databases:read"];

      expect(hasPermission(userPermissions, "apps:read")).to.be.true;
      expect(hasPermission(userPermissions, "apps:create")).to.be.true;
      expect(hasPermission(userPermissions, "databases:read")).to.be.true;
      expect(hasPermission(userPermissions, "apps:delete")).to.be.false;
      expect(hasPermission(userPermissions, "databases:create")).to.be.false;
    });

    it("should grant all permissions when admin:* is in array", () => {
      const adminPermissions: TPermission[] = ["admin:*"];

      expect(hasPermission(adminPermissions, "apps:read")).to.be.true;
      expect(hasPermission(adminPermissions, "apps:delete")).to.be.true;
      expect(hasPermission(adminPermissions, "databases:backup")).to.be.true;
      expect(hasPermission(adminPermissions, "roles:create")).to.be.true;
    });
  });

  // ===========================================================================
  // Repository Tests
  // ===========================================================================

  describe("Role Repository", () => {
    it("should create a new custom role", async () => {
      const repo = useRoleRepo();

      const roleId = await repo.add({
        name: `Test Role ${Date.now()}`,
        description: "A test role",
        permissions: ["apps:read", "apps:create"],
        isSystem: false,
      });

      createdRoleIds.push(roleId);

      expect(roleId).to.exist;
      expect(roleId).to.be.a("string");
      expect(roleId).to.have.lengthOf(24);
    });

    it("should get role by ID", async () => {
      const repo = useRoleRepo();
      const name = `Test Role ${Date.now()}`;

      const roleId = await repo.add({
        name,
        description: "A role to retrieve",
        permissions: ["databases:read", "databases:create"],
        isSystem: false,
      });

      createdRoleIds.push(roleId);

      const role = await repo.getById(roleId);

      expect(role).to.exist;
      expect(role.name).to.equal(name);
      expect(role.permissions).to.deep.equal(["databases:read", "databases:create"]);
      expect(role.isSystem).to.be.false;
    });

    it("should get role by name", async () => {
      const repo = useRoleRepo();
      const name = `Unique Role ${Date.now()}`;

      const roleId = await repo.add({
        name,
        permissions: ["apps:read"],
        isSystem: false,
      });

      createdRoleIds.push(roleId);

      const role = await repo.getByName(name);

      expect(role).to.exist;
      expect(role?.name).to.equal(name);
    });

    it("should return null for non-existent role by name", async () => {
      const repo = useRoleRepo();
      const role = await repo.getByName(`NonExistent-${Date.now()}`);

      expect(role).to.be.null;
    });

    it("should update role by ID", async () => {
      const repo = useRoleRepo();

      const roleId = await repo.add({
        name: `Update Test ${Date.now()}`,
        description: "Original description",
        permissions: ["apps:read"],
        isSystem: false,
      });

      createdRoleIds.push(roleId);

      await repo.updateById(roleId, {
        description: "Updated description",
        permissions: ["apps:read", "apps:create", "apps:update"],
      });

      const role = await repo.getById(roleId);

      expect(role.description).to.equal("Updated description");
      expect(role.permissions).to.deep.equal(["apps:read", "apps:create", "apps:update"]);
    });

    it("should delete custom role by ID", async () => {
      const repo = useRoleRepo();

      const roleId = await repo.add({
        name: `Delete Test ${Date.now()}`,
        permissions: ["apps:read"],
        isSystem: false,
      });

      await repo.deleteById(roleId);

      try {
        await repo.getById(roleId);
        expect.fail("Should have thrown NotFoundError");
      } catch (error: any) {
        expect(error.message).to.include("not found");
      }
    });

    it("should not allow deleting system roles", async () => {
      const repo = useRoleRepo();

      // First ensure system roles exist
      await repo.seedDefaultRoles();

      const adminRole = await repo.getByName("admin");
      expect(adminRole).to.exist;

      try {
        await repo.deleteById(String(adminRole!._id));
        expect.fail("Should have thrown BadRequestError");
      } catch (error: any) {
        expect(error.message).to.include("system role");
      }
    });

    it("should reject duplicate role names", async () => {
      const repo = useRoleRepo();
      const name = `Duplicate Test ${Date.now()}`;

      const roleId = await repo.add({
        name,
        permissions: ["apps:read"],
        isSystem: false,
      });

      createdRoleIds.push(roleId);

      try {
        await repo.add({
          name,
          permissions: ["databases:read"],
          isSystem: false,
        });
        expect.fail("Should have thrown error");
      } catch (error: any) {
        expect(error.message).to.include("already exists");
      }
    });

    it("should reject invalid role ID format", async () => {
      const repo = useRoleRepo();

      try {
        await repo.getById("invalid-id");
        expect.fail("Should have thrown BadRequestError");
      } catch (error: any) {
        expect(error.message).to.include("Invalid role ID format");
      }
    });

    it("should throw NotFoundError for non-existent role ID", async () => {
      const repo = useRoleRepo();
      const fakeId = new ObjectId().toString();

      try {
        await repo.getById(fakeId);
        expect.fail("Should have thrown NotFoundError");
      } catch (error: any) {
        expect(error.message).to.include("not found");
      }
    });

    it("should get all roles with pagination", async () => {
      const repo = useRoleRepo();

      // Create some roles
      for (let i = 0; i < 3; i++) {
        const roleId = await repo.add({
          name: `Pagination Test ${Date.now()}-${i}`,
          permissions: ["apps:read"],
          isSystem: false,
        });
        createdRoleIds.push(roleId);
      }

      const result = await repo.getAll({ page: 1, limit: 20 });

      expect(result.items).to.be.an("array");
      expect(result.pages).to.be.at.least(1);
      expect(result.items.length).to.be.at.least(3);
    });

    it("should get permissions for a role", async () => {
      const repo = useRoleRepo();
      const expectedPermissions: TPermission[] = ["apps:read", "apps:create", "databases:read"];

      const roleId = await repo.add({
        name: `Permissions Test ${Date.now()}`,
        permissions: expectedPermissions,
        isSystem: false,
      });

      createdRoleIds.push(roleId);

      const permissions = await repo.getPermissions(roleId);

      expect(permissions).to.deep.equal(expectedPermissions);
    });

    it("should seed default roles", async () => {
      const repo = useRoleRepo();

      const result = await repo.seedDefaultRoles();

      expect(result).to.have.property("created");
      expect(result).to.have.property("skipped");
      expect(result.created + result.skipped).to.equal(DEFAULT_ROLES.length);

      // Verify roles exist
      const adminRole = await repo.getByName("admin");
      const developerRole = await repo.getByName("developer");
      const viewerRole = await repo.getByName("viewer");
      const operatorRole = await repo.getByName("operator");

      expect(adminRole).to.exist;
      expect(developerRole).to.exist;
      expect(viewerRole).to.exist;
      expect(operatorRole).to.exist;
    });

    it("should count total roles", async () => {
      const repo = useRoleRepo();

      const initialCount = await repo.count();

      const roleId = await repo.add({
        name: `Count Test ${Date.now()}`,
        permissions: ["apps:read"],
        isSystem: false,
      });

      createdRoleIds.push(roleId);

      const newCount = await repo.count();

      expect(newCount).to.equal(initialCount + 1);
    });
  });

  // ===========================================================================
  // Service Tests
  // ===========================================================================

  describe("Role Service", () => {
    it("should get user permissions from role", async () => {
      const service = useRoleService();
      const roleRepo = useRoleRepo();
      const userRepo = useUserRepo();

      // Create a custom role
      const roleId = await roleRepo.add({
        name: `Service Test Role ${Date.now()}`,
        permissions: ["apps:read", "apps:create", "databases:read"],
        isSystem: false,
      });
      createdRoleIds.push(roleId);

      // Create a user with this role
      const hashedPassword = await hashPassword("testpassword123");
      const userId = await userRepo.add({
        email: `service-test-${Date.now()}@example.com`,
        password: hashedPassword,
        roleId: new ObjectId(roleId),
      });
      createdUserIds.push(userId.toString());

      // Get user permissions
      const permissions = await service.getUserPermissions(userId.toString());

      expect(permissions).to.be.an("array");
      expect(permissions).to.include("apps:read");
      expect(permissions).to.include("apps:create");
      expect(permissions).to.include("databases:read");
    });

    it("should check user permission correctly", async () => {
      const service = useRoleService();
      const roleRepo = useRoleRepo();
      const userRepo = useUserRepo();

      // Create a role with limited permissions
      const roleId = await roleRepo.add({
        name: `Permission Check Role ${Date.now()}`,
        permissions: ["apps:read", "databases:read"],
        isSystem: false,
      });
      createdRoleIds.push(roleId);

      // Create a user with this role
      const hashedPassword = await hashPassword("testpassword123");
      const userId = await userRepo.add({
        email: `perm-check-${Date.now()}@example.com`,
        password: hashedPassword,
        roleId: new ObjectId(roleId),
      });
      createdUserIds.push(userId.toString());

      // Check permissions
      const hasAppsRead = await service.checkUserPermission(userId.toString(), "apps:read");
      const hasAppsCreate = await service.checkUserPermission(userId.toString(), "apps:create");
      const hasDatabasesRead = await service.checkUserPermission(userId.toString(), "databases:read");
      const hasRolesCreate = await service.checkUserPermission(userId.toString(), "roles:create");

      expect(hasAppsRead).to.be.true;
      expect(hasAppsCreate).to.be.false;
      expect(hasDatabasesRead).to.be.true;
      expect(hasRolesCreate).to.be.false;
    });

    it("should assign role to user", async () => {
      const service = useRoleService();
      const roleRepo = useRoleRepo();
      const userRepo = useUserRepo();

      // Create a new role
      const roleId = await roleRepo.add({
        name: `Assign Role Test ${Date.now()}`,
        permissions: ["apps:read", "apps:delete"],
        isSystem: false,
      });
      createdRoleIds.push(roleId);

      // Create a user without role
      const hashedPassword = await hashPassword("testpassword123");
      const userId = await userRepo.add({
        email: `assign-role-${Date.now()}@example.com`,
        password: hashedPassword,
      });
      createdUserIds.push(userId.toString());

      // Assign role
      await service.assignRoleToUser(userId.toString(), roleId);

      // Verify user has the role's permissions
      const hasAppsDelete = await service.checkUserPermission(userId.toString(), "apps:delete");
      expect(hasAppsDelete).to.be.true;
    });

    it("should remove role from user", async () => {
      const service = useRoleService();
      const roleRepo = useRoleRepo();
      const userRepo = useUserRepo();

      // Create a role
      const roleId = await roleRepo.add({
        name: `Remove Role Test ${Date.now()}`,
        permissions: ["apps:read"],
        isSystem: false,
      });
      createdRoleIds.push(roleId);

      // Create user with role
      const hashedPassword = await hashPassword("testpassword123");
      const userId = await userRepo.add({
        email: `remove-role-${Date.now()}@example.com`,
        password: hashedPassword,
        roleId: new ObjectId(roleId),
      });
      createdUserIds.push(userId.toString());

      // Verify user has permission
      let hasAppsRead = await service.checkUserPermission(userId.toString(), "apps:read");
      expect(hasAppsRead).to.be.true;

      // Remove role
      await service.removeRoleFromUser(userId.toString());

      // Verify user no longer has permission
      hasAppsRead = await service.checkUserPermission(userId.toString(), "apps:read");
      expect(hasAppsRead).to.be.false;
    });

    it("should set custom permissions for user", async () => {
      const service = useRoleService();
      const userRepo = useUserRepo();

      // Create user without role
      const hashedPassword = await hashPassword("testpassword123");
      const userId = await userRepo.add({
        email: `custom-perms-${Date.now()}@example.com`,
        password: hashedPassword,
      });
      createdUserIds.push(userId.toString());

      // Set custom permissions
      await service.setCustomPermissions(userId.toString(), ["databases:backup", "alerts:acknowledge"]);

      // Verify custom permissions
      const hasBackup = await service.checkUserPermission(userId.toString(), "databases:backup");
      const hasAcknowledge = await service.checkUserPermission(userId.toString(), "alerts:acknowledge");
      const hasAppsRead = await service.checkUserPermission(userId.toString(), "apps:read");

      expect(hasBackup).to.be.true;
      expect(hasAcknowledge).to.be.true;
      expect(hasAppsRead).to.be.false;
    });

    it("should combine role and custom permissions", async () => {
      const service = useRoleService();
      const roleRepo = useRoleRepo();
      const userRepo = useUserRepo();

      // Create a role
      const roleId = await roleRepo.add({
        name: `Combined Perms Role ${Date.now()}`,
        permissions: ["apps:read", "apps:create"],
        isSystem: false,
      });
      createdRoleIds.push(roleId);

      // Create user with role
      const hashedPassword = await hashPassword("testpassword123");
      const userId = await userRepo.add({
        email: `combined-perms-${Date.now()}@example.com`,
        password: hashedPassword,
        roleId: new ObjectId(roleId),
        customPermissions: ["databases:backup"],
      });
      createdUserIds.push(userId.toString());

      // Verify combined permissions
      const permissions = await service.getUserPermissions(userId.toString());

      expect(permissions).to.include("apps:read");
      expect(permissions).to.include("apps:create");
      expect(permissions).to.include("databases:backup");
    });

    it("should get admin role ID", async () => {
      const service = useRoleService();
      const roleRepo = useRoleRepo();

      // Ensure system roles exist
      await roleRepo.seedDefaultRoles();

      const adminRoleId = await service.getAdminRoleId();

      expect(adminRoleId).to.exist;
      expect(adminRoleId).to.be.a("string");
      expect(adminRoleId).to.have.lengthOf(24);

      // Verify it's actually the admin role
      const role = await roleRepo.getById(adminRoleId!);
      expect(role.name).to.equal("admin");
      expect(role.permissions).to.include("admin:*");
    });

    it("should throw NotFoundError for non-existent user", async () => {
      const service = useRoleService();
      const fakeUserId = new ObjectId().toString();

      try {
        await service.getUserPermissions(fakeUserId);
        expect.fail("Should have thrown NotFoundError");
      } catch (error: any) {
        expect(error.message).to.include("not found");
      }
    });
  });

  // ===========================================================================
  // Validation Tests
  // ===========================================================================

  describe("Validation", () => {
    it("should reject role without name", async () => {
      const repo = useRoleRepo();

      try {
        await repo.add({
          name: "",
          permissions: ["apps:read"],
        } as any);
        expect.fail("Should have thrown error");
      } catch (error: any) {
        expect(error.message).to.include("validation");
      }
    });

    it("should reject role without permissions", async () => {
      const repo = useRoleRepo();

      try {
        await repo.add({
          name: `No Perms ${Date.now()}`,
          permissions: [],
        });
        expect.fail("Should have thrown error");
      } catch (error: any) {
        expect(error.message).to.include("validation");
      }
    });

    it("should reject invalid permission", async () => {
      const repo = useRoleRepo();

      try {
        await repo.add({
          name: `Invalid Perm ${Date.now()}`,
          permissions: ["invalid:permission"] as any,
        });
        expect.fail("Should have thrown error");
      } catch (error: any) {
        expect(error.message).to.include("validation");
      }
    });

    it("should reject role name that is too long", async () => {
      const repo = useRoleRepo();

      try {
        await repo.add({
          name: "a".repeat(100),
          permissions: ["apps:read"],
        });
        expect.fail("Should have thrown error");
      } catch (error: any) {
        expect(error.message).to.include("validation");
      }
    });
  });
});
