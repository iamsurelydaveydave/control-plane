import { Request, Response, NextFunction } from "express";
import { useUserService } from "./user.service";
import { useRoleService } from "../role";
import { schemaUserCreate, schemaUserUpdate } from "./user.model";
import { BadRequestError, NotFoundError } from "../../utils";

export function useUserController() {
  const userService = useUserService();
  const roleService = useRoleService();

  /**
   * GET /api/users - List all users (without passwords)
   */
  async function list(req: Request, res: Response, next: NextFunction) {
    try {
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;
      const result = await userService.getAll({ page, limit });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/users - Create a new user
   */
  async function create(req: Request, res: Response, next: NextFunction) {
    try {
      const { error, value } = schemaUserCreate.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      const { email, password, roleId } = value;
      
      // If roleId is provided, verify it exists
      if (roleId) {
        await roleService.getById(roleId);
      }

      const userId = await userService.createUser(email, password, roleId);
      res.status(201).json({ message: "User created", userId: String(userId) });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/users/:id - Get user by ID (with role info)
   */
  async function getById(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = String(req.params.id);
      const user = await userService.getUserWithRole(userId);
      if (!user) {
        next(new NotFoundError("User not found"));
        return;
      }
      res.json(user);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/users/:id - Update user
   */
  async function update(req: Request, res: Response, next: NextFunction) {
    try {
      const { error, value } = schemaUserUpdate.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      const userId = String(req.params.id);
      const { email, password, roleId, customPermissions } = value;

      // Verify user exists
      const user = await userService.getById(userId);
      if (!user) {
        next(new NotFoundError("User not found"));
        return;
      }

      // Update email/password if provided
      if (email || password) {
        await userService.updateProfile(userId, {
          email,
          newPassword: password,
        });
      }

      // Update role if provided (including null to remove)
      if (roleId !== undefined) {
        if (roleId) {
          // Verify role exists
          await roleService.getById(roleId);
        }
        await userService.assignRole(userId, roleId);
      }

      // Update custom permissions if provided
      if (customPermissions !== undefined) {
        await userService.setCustomPermissions(userId, customPermissions);
      }

      res.json({ message: "User updated" });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/users/:id - Delete user
   */
  async function remove(req: Request, res: Response, next: NextFunction) {
    try {
      const currentUserId = req.cookies?.user as string;
      const userId = String(req.params.id);
      
      // Prevent self-deletion
      if (currentUserId === userId) {
        next(new BadRequestError("Cannot delete your own account"));
        return;
      }

      await userService.deleteById(userId);
      res.json({ message: "User deleted" });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/users/:id/permissions - Get effective permissions for a user
   */
  async function getPermissions(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = String(req.params.id);
      
      // Verify user exists
      const user = await userService.getById(userId);
      if (!user) {
        next(new NotFoundError("User not found"));
        return;
      }

      const permissions = await userService.getUserPermissions(userId);
      res.json({
        userId,
        permissions,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/users/:id/role - Assign role to user
   */
  async function assignRole(req: Request, res: Response, next: NextFunction) {
    try {
      const { roleId } = req.body;
      const userId = String(req.params.id);
      
      // Verify user exists
      const user = await userService.getById(userId);
      if (!user) {
        next(new NotFoundError("User not found"));
        return;
      }

      // If roleId is provided, verify it exists
      if (roleId) {
        await roleService.getById(roleId);
      }

      await userService.assignRole(userId, roleId || null);
      res.json({ message: roleId ? "Role assigned" : "Role removed" });
    } catch (error) {
      next(error);
    }
  }

  return {
    list,
    create,
    getById,
    update,
    remove,
    getPermissions,
    assignRole,
  };
}
