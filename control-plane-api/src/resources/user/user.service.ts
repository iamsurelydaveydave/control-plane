import { useUserRepo } from "./user.repository";
import { hashPassword } from "../../utils";
import { useRoleService } from "../role";
import type { TPermission } from "../role";
import { ObjectId } from "mongodb";

export function useUserService() {
  const repo = useUserRepo();
  const roleService = useRoleService();

  async function createUser(email: string, password: string, roleId?: string) {
    const hashedPassword = await hashPassword(password);
    return repo.add({
      email,
      password: hashedPassword,
      roleId: roleId ? new ObjectId(roleId) : undefined,
    });
  }

  async function ensureDefaultAdmin(email: string, password: string) {
    const count = await repo.count();
    if (count === 0) {
      // Get admin role ID
      const adminRoleId = await roleService.getAdminRoleId();
      return createUser(email, password, adminRoleId || undefined);
    }
    return null;
  }

  async function updateProfile(
    userId: string,
    updates: { email?: string; newPassword?: string }
  ) {
    if (updates.email) {
      await repo.updateEmail(userId, updates.email);
    }
    if (updates.newPassword) {
      const hashed = await hashPassword(updates.newPassword);
      await repo.updatePassword(userId, hashed);
    }
  }

  async function assignRole(userId: string, roleId: string | null) {
    if (roleId) {
      await roleService.assignRoleToUser(userId, roleId);
    } else {
      await roleService.removeRoleFromUser(userId);
    }
  }

  async function setCustomPermissions(userId: string, permissions: TPermission[]) {
    await roleService.setCustomPermissions(userId, permissions);
  }

  async function getUserPermissions(userId: string): Promise<TPermission[]> {
    return roleService.getUserPermissions(userId);
  }

  /**
   * Get user with role information included
   */
  async function getUserWithRole(userId: string) {
    const user = await repo.getById(userId);
    if (!user) return null;

    let role = null;
    if (user.roleId) {
      try {
        role = await roleService.getById(String(user.roleId));
      } catch {
        // Role not found, ignore
      }
    }

    // Get effective permissions
    const permissions = await getUserPermissions(userId);

    return {
      _id: user._id,
      email: user.email,
      role: user.role, // Legacy field
      roleId: user.roleId,
      roleName: role?.name,
      customPermissions: user.customPermissions,
      permissions, // Effective permissions
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  return {
    createUser,
    ensureDefaultAdmin,
    updateProfile,
    assignRole,
    setCustomPermissions,
    getUserPermissions,
    getUserWithRole,
    getByEmail: repo.getByEmail,
    getById: repo.getById,
    getAll: repo.getAll,
    updateById: repo.updateById,
    deleteById: repo.deleteById,
    count: repo.count,
  };
}
