import { Request, Response, NextFunction } from "express";
import { useRoleService } from "./role.service";
import { useRoleRepo } from "./role.repository";
import { schemaRoleCreate, schemaRoleUpdate, permissions } from "./role.model";
import { BadRequestError } from "../../utils";

export function useRoleController() {
  const roleService = useRoleService();
  const roleRepo = useRoleRepo();

  /**
   * GET /api/roles - List all roles
   */
  async function list(req: Request, res: Response, next: NextFunction) {
    try {
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;
      const result = await roleService.getAll({ page, limit });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/roles - Create a new role
   */
  async function create(req: Request, res: Response, next: NextFunction) {
    try {
      const { error, value } = schemaRoleCreate.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      // Don't allow creating system roles via API
      value.isSystem = false;

      const roleId = await roleService.create(value);
      res.status(201).json({ message: "Role created", roleId });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/roles/:id - Get a role by ID
   */
  async function getById(req: Request, res: Response, next: NextFunction) {
    try {
      const role = await roleService.getById(String(req.params.id));
      res.json(role);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/roles/:id - Update a role
   */
  async function update(req: Request, res: Response, next: NextFunction) {
    try {
      const { error, value } = schemaRoleUpdate.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      // Check if it's a system role - system roles can only update description
      const role = await roleService.getById(String(req.params.id));
      if (role.isSystem && (value.name || value.permissions)) {
        next(new BadRequestError("Cannot modify name or permissions of a system role"));
        return;
      }

      await roleService.update(String(req.params.id), value);
      res.json({ message: "Role updated" });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/roles/:id - Delete a role
   */
  async function remove(req: Request, res: Response, next: NextFunction) {
    try {
      await roleService.delete(String(req.params.id));
      res.json({ message: "Role deleted" });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/roles/permissions - List all available permissions
   */
  async function listPermissions(req: Request, res: Response, next: NextFunction) {
    try {
      // Group permissions by resource
      const grouped: Record<string, string[]> = {};

      for (const permission of permissions) {
        const [resource] = permission.split(":");
        if (!grouped[resource]) {
          grouped[resource] = [];
        }
        grouped[resource].push(permission);
      }

      res.json({
        permissions,
        grouped,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/users/:id/permissions - Get effective permissions for a user
   */
  async function getUserPermissions(req: Request, res: Response, next: NextFunction) {
    try {
      const userPermissions = await roleService.getUserPermissions(String(req.params.id));
      res.json({
        userId: String(req.params.id),
        permissions: userPermissions,
      });
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
    listPermissions,
    getUserPermissions,
  };
}
