import { ObjectId } from "mongodb";
import { useRoleRepo } from "./role.repository";
import { useUserRepo } from "../user";
import { TPermission, hasPermission } from "./role.model";
import { NotFoundError, BadRequestError, logger } from "../../utils";
import type { TUser } from "../user";

export function useRoleService() {
  const roleRepo = useRoleRepo();
  const userRepo = useUserRepo();

  /**
   * Get all permissions for a user.
   * Combines role permissions with any custom permissions.
   */
  async function getUserPermissions(userId: string): Promise<TPermission[]> {
    const user = await userRepo.getById(userId);
    if (!user) {
      throw new NotFoundError("User not found");
    }

    const permissions: Set<TPermission> = new Set();

    // Get role permissions if user has a role assigned
    if (user.roleId) {
      try {
        const rolePermissions = await roleRepo.getPermissions(String(user.roleId));
        for (const p of rolePermissions) {
          permissions.add(p);
        }
      } catch (error) {
        logger.log({
          level: "warn",
          message: `Failed to get role permissions for user ${userId}: ${error}`,
        });
      }
    }

    // Add custom permissions
    if (user.customPermissions && Array.isArray(user.customPermissions)) {
      for (const p of user.customPermissions) {
        permissions.add(p);
      }
    }

    return Array.from(permissions);
  }

  /**
   * Check if a user has a specific permission.
   */
  async function checkUserPermission(
    userId: string,
    requiredPermission: TPermission
  ): Promise<boolean> {
    const permissions = await getUserPermissions(userId);
    return hasPermission(permissions, requiredPermission);
  }

  /**
   * Check if a user object has a specific permission.
   * Use this when you already have the user object to avoid an extra DB lookup.
   */
  async function checkUserPermissionFromUser(
    user: TUser,
    requiredPermission: TPermission
  ): Promise<boolean> {
    const permissions: Set<TPermission> = new Set();

    // Get role permissions if user has a role assigned
    if (user.roleId) {
      try {
        const rolePermissions = await roleRepo.getPermissions(String(user.roleId));
        for (const p of rolePermissions) {
          permissions.add(p);
        }
      } catch (error) {
        logger.log({
          level: "warn",
          message: `Failed to get role permissions for user: ${error}`,
        });
      }
    }

    // Add custom permissions
    if (user.customPermissions && Array.isArray(user.customPermissions)) {
      for (const p of user.customPermissions) {
        permissions.add(p);
      }
    }

    return hasPermission(Array.from(permissions), requiredPermission);
  }

  /**
   * Assign a role to a user.
   */
  async function assignRoleToUser(userId: string, roleId: string): Promise<void> {
    // Verify the role exists
    await roleRepo.getById(roleId);
    // Update user - convert string to ObjectId
    await userRepo.updateById(userId, { roleId: new ObjectId(roleId) });
  }

  /**
   * Remove role from a user.
   */
  async function removeRoleFromUser(userId: string): Promise<void> {
    await userRepo.updateById(userId, { roleId: undefined });
  }

  /**
   * Set custom permissions for a user.
   */
  async function setCustomPermissions(
    userId: string,
    permissions: TPermission[]
  ): Promise<void> {
    await userRepo.updateById(userId, { customPermissions: permissions });
  }

  /**
   * Get the admin role ID.
   * Used to assign admin role to the first user.
   */
  async function getAdminRoleId(): Promise<string | null> {
    const adminRole = await roleRepo.getByName("admin");
    return adminRole ? String(adminRole._id) : null;
  }

  return {
    getUserPermissions,
    checkUserPermission,
    checkUserPermissionFromUser,
    assignRoleToUser,
    removeRoleFromUser,
    setCustomPermissions,
    getAdminRoleId,
    // Expose repo methods
    getAll: roleRepo.getAll,
    getById: roleRepo.getById,
    getByName: roleRepo.getByName,
    create: roleRepo.add,
    update: roleRepo.updateById,
    delete: roleRepo.deleteById,
    seedDefaultRoles: roleRepo.seedDefaultRoles,
    getPermissions: roleRepo.getPermissions,
  };
}
