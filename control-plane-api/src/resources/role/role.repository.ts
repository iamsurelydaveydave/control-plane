import { ObjectId } from "mongodb";
import {
  modelRole,
  TRole,
  DEFAULT_ROLES,
  TPermission,
} from "./role.model";
import {
  BadRequestError,
  NotFoundError,
  InternalServerError,
  logger,
  makeCacheKey,
  useRepo,
  paginate,
} from "../../utils";

export function useRoleRepo() {
  const namespace_collection = "cp_roles";
  const repo = useRepo(namespace_collection);

  /**
   * Create indexes for the roles collection.
   */
  async function createIndexes() {
    try {
      await repo.collection.createIndexes([
        { key: { name: 1 }, unique: true },
        { key: { isSystem: 1 } },
      ]);
    } catch (error) {
      logger.log({
        level: "error",
        message: `Failed to create role indexes: ${error}`,
      });
    }
  }

  /**
   * Get all roles (paginated).
   */
  async function getAll({ page = 1, limit = 20 } = {}) {
    const cacheKey = makeCacheKey(namespace_collection, { page, limit, tag: "getAll" });

    try {
      const cached = await repo.getCache<ReturnType<typeof paginate>>(cacheKey);
      if (cached) {
        return cached;
      }

      const skip = (page > 0 ? page - 1 : 0) * limit;
      const [items, total] = await Promise.all([
        repo.collection
          .find<TRole>({})
          .sort({ isSystem: -1, name: 1 })
          .skip(skip)
          .limit(limit)
          .toArray(),
        repo.collection.countDocuments({}),
      ]);

      const result = paginate(items, page, limit, total);
      repo.setCache(cacheKey, result, 300).catch((err) => {
        logger.log({
          level: "error",
          message: `Failed to set cache for roles: ${err.message}`,
        });
      });

      return result;
    } catch (error) {
      throw new InternalServerError("Failed to get roles");
    }
  }

  /**
   * Get role by ID.
   */
  async function getById(id: string) {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid role ID format");
    }

    const cacheKey = makeCacheKey(namespace_collection, { id, tag: "by-id" });

    try {
      const cached = await repo.getCache<TRole>(cacheKey);
      if (cached) {
        return cached;
      }

      const role = await repo.collection.findOne<TRole>({ _id: oid });
      if (!role) {
        throw new NotFoundError("Role not found");
      }

      repo.setCache(cacheKey, role, 300).catch((err) => {
        logger.log({
          level: "error",
          message: `Failed to set cache for role: ${err.message}`,
        });
      });

      return role;
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof BadRequestError) {
        throw error;
      }
      throw new InternalServerError("Failed to get role");
    }
  }

  /**
   * Get role by name.
   */
  async function getByName(name: string) {
    const cacheKey = makeCacheKey(namespace_collection, { name, tag: "by-name" });

    try {
      const cached = await repo.getCache<TRole>(cacheKey);
      if (cached) {
        return cached;
      }

      const role = await repo.collection.findOne<TRole>({ name });
      if (role) {
        repo.setCache(cacheKey, role, 300).catch((err) => {
          logger.log({
            level: "error",
            message: `Failed to set cache for role by name: ${err.message}`,
          });
        });
      }

      return role;
    } catch (error) {
      throw new InternalServerError("Failed to get role by name");
    }
  }

  /**
   * Create a new role.
   */
  async function add(data: Partial<TRole>) {
    try {
      const role = modelRole(data);
      const result = await repo.collection.insertOne(role as any);
      repo.delCachedData();
      return result.insertedId.toString();
    } catch (error: any) {
      logger.log({ level: "error", message: `${error}` });

      if (error.message?.includes("duplicate") || error.code === 11000) {
        throw new BadRequestError("A role with this name already exists");
      }

      if (error instanceof BadRequestError) {
        throw error;
      }

      throw new InternalServerError("Failed to create role");
    }
  }

  /**
   * Update a role by ID.
   */
  async function updateById(id: string, data: Partial<Omit<TRole, "_id" | "createdAt" | "isSystem">>) {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid role ID format");
    }

    try {
      const result = await repo.collection.updateOne(
        { _id: oid },
        { $set: { ...data, updatedAt: new Date() } }
      );

      if (!result.matchedCount) {
        throw new NotFoundError("Role not found");
      }

      repo.delCachedData();
      return result;
    } catch (error: any) {
      if (error instanceof NotFoundError || error instanceof BadRequestError) {
        throw error;
      }

      if (error.message?.includes("duplicate") || error.code === 11000) {
        throw new BadRequestError("A role with this name already exists");
      }

      throw new InternalServerError("Failed to update role");
    }
  }

  /**
   * Delete a role by ID.
   */
  async function deleteById(id: string) {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid role ID format");
    }

    try {
      // Check if it's a system role first
      const role = await repo.collection.findOne<TRole>({ _id: oid });
      if (!role) {
        throw new NotFoundError("Role not found");
      }
      if (role.isSystem) {
        throw new BadRequestError("Cannot delete a system role");
      }

      const result = await repo.collection.deleteOne({ _id: oid });
      if (!result.deletedCount) {
        throw new NotFoundError("Role not found");
      }

      repo.delCachedData();
      return result;
    } catch (error) {
      if (
        error instanceof NotFoundError ||
        error instanceof BadRequestError
      ) {
        throw error;
      }
      throw new InternalServerError("Failed to delete role");
    }
  }

  /**
   * Get permissions for a role by ID.
   */
  async function getPermissions(id: string): Promise<TPermission[]> {
    const role = await getById(id);
    return role.permissions;
  }

  /**
   * Seed default roles on first run.
   * Only creates roles that don't already exist.
   */
  async function seedDefaultRoles() {
    let created = 0;
    let skipped = 0;

    for (const roleData of DEFAULT_ROLES) {
      const existing = await getByName(roleData.name);
      if (existing) {
        skipped++;
        continue;
      }

      try {
        await add(roleData);
        created++;
        logger.log({
          level: "info",
          message: `Created default role: ${roleData.name}`,
        });
      } catch (error) {
        logger.log({
          level: "error",
          message: `Failed to create default role ${roleData.name}: ${error}`,
        });
      }
    }

    return { created, skipped };
  }

  /**
   * Count total roles.
   */
  async function count() {
    try {
      return await repo.collection.countDocuments();
    } catch (error) {
      throw new InternalServerError("Failed to count roles");
    }
  }

  return {
    createIndexes,
    getAll,
    getById,
    getByName,
    add,
    updateById,
    deleteById,
    getPermissions,
    seedDefaultRoles,
    count,
  };
}
