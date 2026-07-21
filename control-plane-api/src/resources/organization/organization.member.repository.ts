import { ObjectId } from "mongodb";
import {
  TOrganizationMember,
  modelOrganizationMember,
  TOrganizationMemberInput,
} from "./organization.member.model";
import {
  BadRequestError,
  ConflictError,
  InternalServerError,
  NotFoundError,
} from "../../utils/error";
import { useRepo } from "../../utils/repo";
import { makeCacheKey } from "../../utils/make-cache-key";
import { paginate } from "../../utils/paginate";
import { logger } from "../../utils/logger";

const namespace_collection = "cp_organization_members";

export function useOrganizationMemberRepo() {
  const repo = useRepo(namespace_collection);

  // ---------------------------------------------------------------------------
  // Indexes
  // ---------------------------------------------------------------------------

  async function createIndexes() {
    try {
      await repo.collection.createIndexes([
        { key: { organizationId: 1, userId: 1 }, unique: true },
        { key: { organizationId: 1 } },
        { key: { userId: 1 } },
        { key: { roleId: 1 } },
        { key: { joinedAt: -1 } },
      ]);
    } catch (error) {
      logger.log({
        level: "error",
        message: `Failed to create organization member indexes: ${error}`,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  async function add(data: TOrganizationMemberInput) {
    try {
      const member = modelOrganizationMember(data);
      const result = await repo.collection.insertOne(member);
      repo.delCachedData();
      return result.insertedId;
    } catch (error: any) {
      logger.log({ level: "error", message: `${error}` });

      if (error.code === 11000 || error.message?.includes("duplicate")) {
        throw new ConflictError("User is already a member of this organization");
      }

      if (error instanceof BadRequestError) throw error;
      throw new InternalServerError("Failed to add organization member");
    }
  }

  async function getById(_id: string | ObjectId) {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid member ID format");
    }

    const cacheKey = makeCacheKey(namespace_collection, { _id: String(_id), tag: "by-id" });

    try {
      const cached = await repo.getCache<TOrganizationMember>(cacheKey);
      if (cached) return cached;

      const result = await repo.collection.findOne<TOrganizationMember>({ _id });

      if (result) {
        repo.setCache(cacheKey, result, 300).catch((err) => {
          logger.log({
            level: "error",
            message: `Failed to set cache for member by id: ${err.message}`,
          });
        });
      }

      return result;
    } catch (error) {
      if (error instanceof BadRequestError) throw error;
      throw new InternalServerError("Failed to get member by id");
    }
  }

  async function getByOrgAndUser(organizationId: string | ObjectId, userId: string | ObjectId) {
    try {
      organizationId = new ObjectId(organizationId);
      userId = new ObjectId(userId);
    } catch {
      throw new BadRequestError("Invalid ID format");
    }

    const cacheKey = makeCacheKey(namespace_collection, {
      organizationId: String(organizationId),
      userId: String(userId),
      tag: "by-org-user",
    });

    try {
      const cached = await repo.getCache<TOrganizationMember>(cacheKey);
      if (cached) return cached;

      const result = await repo.collection.findOne<TOrganizationMember>({
        organizationId,
        userId,
      });

      if (result) {
        repo.setCache(cacheKey, result, 300).catch((err) => {
          logger.log({
            level: "error",
            message: `Failed to set cache for member by org-user: ${err.message}`,
          });
        });
      }

      return result;
    } catch (error) {
      if (error instanceof BadRequestError) throw error;
      throw new InternalServerError("Failed to get member by org and user");
    }
  }

  async function getByOrganizationId(
    organizationId: string | ObjectId,
    { page = 1, limit = 20 }: { page?: number; limit?: number } = {}
  ) {
    try {
      organizationId = new ObjectId(organizationId);
    } catch {
      throw new BadRequestError("Invalid organization ID format");
    }

    page = page > 0 ? page - 1 : 0;

    const cacheKey = makeCacheKey(namespace_collection, {
      organizationId: String(organizationId),
      page,
      limit,
      tag: "by-org",
    });

    try {
      const cached = await repo.getCache<Record<string, any>>(cacheKey);
      if (cached) return cached;

      const query = { organizationId };

      const items = await repo.collection
        .aggregate([
          { $match: query },
          { $sort: { joinedAt: -1 } },
          { $skip: page * limit },
          { $limit: limit },
        ])
        .toArray();

      const length = await repo.collection.countDocuments(query);
      const data = paginate(items, page, limit, length);

      repo.setCache(cacheKey, data, 300).catch((err) => {
        logger.log({
          level: "error",
          message: `Failed to set cache for members by org: ${err.message}`,
        });
      });

      return data;
    } catch (error) {
      if (error instanceof BadRequestError) throw error;
      throw new InternalServerError("Failed to get organization members");
    }
  }

  async function getByUserId(userId: string | ObjectId) {
    try {
      userId = new ObjectId(userId);
    } catch {
      throw new BadRequestError("Invalid user ID format");
    }

    const cacheKey = makeCacheKey(namespace_collection, {
      userId: String(userId),
      tag: "by-user",
    });

    try {
      const cached = await repo.getCache<TOrganizationMember[]>(cacheKey);
      if (cached) return cached;

      const result = await repo.collection
        .find<TOrganizationMember>({ userId })
        .sort({ joinedAt: -1 })
        .toArray();

      repo.setCache(cacheKey, result, 300).catch((err) => {
        logger.log({
          level: "error",
          message: `Failed to set cache for members by user: ${err.message}`,
        });
      });

      return result;
    } catch (error) {
      if (error instanceof BadRequestError) throw error;
      throw new InternalServerError("Failed to get user memberships");
    }
  }

  async function updateRole(_id: string | ObjectId, roleId: string | ObjectId) {
    try {
      _id = new ObjectId(_id);
      roleId = new ObjectId(roleId);
    } catch {
      throw new BadRequestError("Invalid ID format");
    }

    try {
      const result = await repo.collection.updateOne({ _id }, { $set: { roleId } });

      if (result.matchedCount === 0) {
        throw new NotFoundError("Member not found");
      }

      repo.delCachedData();
      return result;
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      if (error instanceof BadRequestError) throw error;
      throw new InternalServerError("Failed to update member role");
    }
  }

  async function deleteById(_id: string | ObjectId) {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid member ID format");
    }

    try {
      const result = await repo.collection.deleteOne({ _id });

      if (result.deletedCount === 0) {
        throw new NotFoundError("Member not found");
      }

      repo.delCachedData();
      return result;
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      if (error instanceof BadRequestError) throw error;
      throw new InternalServerError("Failed to remove member");
    }
  }

  async function deleteByOrgAndUser(organizationId: string | ObjectId, userId: string | ObjectId) {
    try {
      organizationId = new ObjectId(organizationId);
      userId = new ObjectId(userId);
    } catch {
      throw new BadRequestError("Invalid ID format");
    }

    try {
      const result = await repo.collection.deleteOne({ organizationId, userId });

      if (result.deletedCount === 0) {
        throw new NotFoundError("Member not found");
      }

      repo.delCachedData();
      return result;
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      if (error instanceof BadRequestError) throw error;
      throw new InternalServerError("Failed to remove member");
    }
  }

  async function deleteByOrganizationId(organizationId: string | ObjectId) {
    try {
      organizationId = new ObjectId(organizationId);
    } catch {
      throw new BadRequestError("Invalid organization ID format");
    }

    try {
      const result = await repo.collection.deleteMany({ organizationId });
      repo.delCachedData();
      return result;
    } catch (error) {
      if (error instanceof BadRequestError) throw error;
      throw new InternalServerError("Failed to remove organization members");
    }
  }

  async function countByOrganizationId(organizationId: string | ObjectId): Promise<number> {
    try {
      organizationId = new ObjectId(organizationId);
    } catch {
      throw new BadRequestError("Invalid organization ID format");
    }

    try {
      return await repo.collection.countDocuments({ organizationId });
    } catch (error) {
      throw new InternalServerError("Failed to count organization members");
    }
  }

  async function isMember(organizationId: string | ObjectId, userId: string | ObjectId): Promise<boolean> {
    try {
      organizationId = new ObjectId(organizationId);
      userId = new ObjectId(userId);
    } catch {
      return false;
    }

    try {
      const count = await repo.collection.countDocuments({ organizationId, userId });
      return count > 0;
    } catch (error) {
      return false;
    }
  }

  return {
    createIndexes,
    add,
    getById,
    getByOrgAndUser,
    getByOrganizationId,
    getByUserId,
    updateRole,
    deleteById,
    deleteByOrgAndUser,
    deleteByOrganizationId,
    countByOrganizationId,
    isMember,
  };
}
