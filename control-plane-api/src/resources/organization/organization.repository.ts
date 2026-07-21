import { ObjectId } from "mongodb";
import {
  TOrganization,
  TOrganizationPlan,
  PLAN_LIMITS,
  modelOrganization,
  TOrganizationInput,
} from "./organization.model";
import {
  BadRequestError,
  ConflictError,
  InternalServerError,
  NotFoundError,
} from "../../utils/error";
import { useRepo } from "../../utils/repo";
import { makeCacheKey } from "../../utils/make-cache-key";
import { paginate } from "../../utils/paginate";
import { escapeRegex } from "../../utils/escape-regex";
import { logger } from "../../utils/logger";

const namespace_collection = "cp_organizations";

export function useOrganizationRepo() {
  const repo = useRepo(namespace_collection);

  // ---------------------------------------------------------------------------
  // Indexes
  // ---------------------------------------------------------------------------

  async function createIndexes() {
    try {
      await repo.collection.createIndexes([
        { key: { slug: 1 }, unique: true },
        { key: { ownerId: 1 } },
        { key: { name: "text" } },
        { key: { plan: 1 } },
        { key: { createdAt: -1 } },
      ]);
    } catch (error) {
      logger.log({
        level: "error",
        message: `Failed to create organization indexes: ${error}`,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  async function add(data: TOrganizationInput) {
    try {
      const org = modelOrganization(data);
      const result = await repo.collection.insertOne(org);
      repo.delCachedData();
      return result.insertedId;
    } catch (error: any) {
      logger.log({ level: "error", message: `${error}` });

      if (error.code === 11000 || error.message?.includes("duplicate")) {
        const keyPattern = error.keyPattern || {};
        if (keyPattern.slug) {
          throw new ConflictError("Organization with this slug already exists", keyPattern);
        }
        throw new ConflictError("Organization already exists", keyPattern);
      }

      if (error instanceof BadRequestError) throw error;
      throw new InternalServerError("Failed to create organization");
    }
  }

  async function getById(_id: string | ObjectId) {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid organization ID format");
    }

    const cacheKey = makeCacheKey(namespace_collection, { _id: String(_id), tag: "by-id" });

    try {
      const cached = await repo.getCache<TOrganization>(cacheKey);
      if (cached) return cached;

      const result = await repo.collection.findOne<TOrganization>({ _id });

      if (result) {
        repo.setCache(cacheKey, result, 300).catch((err) => {
          logger.log({
            level: "error",
            message: `Failed to set cache for organization by id: ${err.message}`,
          });
        });
      }

      return result;
    } catch (error) {
      if (error instanceof BadRequestError) throw error;
      throw new InternalServerError("Failed to get organization by id");
    }
  }

  async function getBySlug(slug: string) {
    if (!slug || typeof slug !== "string") {
      throw new BadRequestError("Invalid organization slug");
    }

    const cacheKey = makeCacheKey(namespace_collection, { slug, tag: "by-slug" });

    try {
      const cached = await repo.getCache<TOrganization>(cacheKey);
      if (cached) return cached;

      const result = await repo.collection.findOne<TOrganization>({ slug });

      if (result) {
        repo.setCache(cacheKey, result, 300).catch((err) => {
          logger.log({
            level: "error",
            message: `Failed to set cache for organization by slug: ${err.message}`,
          });
        });
      }

      return result;
    } catch (error) {
      throw new InternalServerError("Failed to get organization by slug");
    }
  }

  async function getByOwnerId(ownerId: string | ObjectId) {
    try {
      ownerId = new ObjectId(ownerId);
    } catch {
      throw new BadRequestError("Invalid owner ID format");
    }

    const cacheKey = makeCacheKey(namespace_collection, { ownerId: String(ownerId), tag: "by-owner" });

    try {
      const cached = await repo.getCache<TOrganization[]>(cacheKey);
      if (cached) return cached;

      const result = await repo.collection
        .find<TOrganization>({ ownerId })
        .sort({ createdAt: -1 })
        .toArray();

      repo.setCache(cacheKey, result, 300).catch((err) => {
        logger.log({
          level: "error",
          message: `Failed to set cache for organizations by owner: ${err.message}`,
        });
      });

      return result;
    } catch (error) {
      if (error instanceof BadRequestError) throw error;
      throw new InternalServerError("Failed to get organizations by owner");
    }
  }

  async function getAll({
    search = "",
    page = 1,
    limit = 10,
    plan,
  }: {
    search?: string;
    page?: number;
    limit?: number;
    plan?: TOrganizationPlan;
  } = {}) {
    page = page > 0 ? page - 1 : 0;

    const query: Record<string, any> = {};

    if (search) {
      query.name = { $regex: escapeRegex(search), $options: "i" };
    }

    if (plan) {
      query.plan = plan;
    }

    const cacheKey = makeCacheKey(namespace_collection, {
      search,
      page,
      limit,
      plan: plan ?? "",
      tag: "getAll",
    });

    try {
      const cached = await repo.getCache<Record<string, any>>(cacheKey);
      if (cached) return cached;

      const items = await repo.collection
        .aggregate([
          { $match: query },
          { $sort: { createdAt: -1 } },
          { $skip: page * limit },
          { $limit: limit },
        ])
        .toArray();

      const length = await repo.collection.countDocuments(query);
      const data = paginate(items, page, limit, length);

      repo.setCache(cacheKey, data, 300).catch((err) => {
        logger.log({
          level: "error",
          message: `Failed to set cache for organizations getAll: ${err.message}`,
        });
      });

      return data;
    } catch (error) {
      logger.log({ level: "error", message: `${error}` });
      throw new InternalServerError("Failed to get organizations");
    }
  }

  async function updateById(_id: string | ObjectId, update: Partial<TOrganization>) {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid organization ID format");
    }

    try {
      const result = await repo.collection.updateOne(
        { _id },
        { $set: { ...update, updatedAt: new Date() } }
      );

      if (result.matchedCount === 0) {
        throw new NotFoundError("Organization not found");
      }

      repo.delCachedData();
      return result;
    } catch (error: any) {
      if (error instanceof NotFoundError) throw error;
      if (error instanceof BadRequestError) throw error;

      if (error.code === 11000 || error.message?.includes("duplicate")) {
        throw new ConflictError("Organization with this slug already exists");
      }

      throw new InternalServerError("Failed to update organization");
    }
  }

  async function deleteById(_id: string | ObjectId) {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid organization ID format");
    }

    try {
      const result = await repo.collection.deleteOne({ _id });

      if (result.deletedCount === 0) {
        throw new NotFoundError("Organization not found");
      }

      repo.delCachedData();
      return result;
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      if (error instanceof BadRequestError) throw error;
      throw new InternalServerError("Failed to delete organization");
    }
  }

  // ---------------------------------------------------------------------------
  // Usage & Limits
  // ---------------------------------------------------------------------------

  async function updateUsage(
    _id: string | ObjectId,
    resource: "apps" | "databases" | "users" | "storage",
    delta: number
  ) {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid organization ID format");
    }

    try {
      const result = await repo.collection.updateOne(
        { _id },
        {
          $inc: { [`usage.${resource}`]: delta },
          $set: { updatedAt: new Date() },
        }
      );

      if (result.matchedCount === 0) {
        throw new NotFoundError("Organization not found");
      }

      repo.delCachedData();
      return result;
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      if (error instanceof BadRequestError) throw error;
      throw new InternalServerError("Failed to update organization usage");
    }
  }

  async function checkLimit(
    _id: string | ObjectId,
    resource: "apps" | "databases" | "users" | "storage"
  ): Promise<{ withinLimit: boolean; current: number; max: number }> {
    const org = await getById(_id);
    if (!org) {
      throw new NotFoundError("Organization not found");
    }

    const current = org.usage[resource];
    const max = org.limits[`max${resource.charAt(0).toUpperCase() + resource.slice(1)}` as keyof typeof org.limits] as number;

    // -1 means unlimited
    const withinLimit = max === -1 || current < max;

    return { withinLimit, current, max };
  }

  async function updatePlan(_id: string | ObjectId, plan: TOrganizationPlan) {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid organization ID format");
    }

    const limits = { ...PLAN_LIMITS[plan] };

    try {
      const result = await repo.collection.updateOne(
        { _id },
        {
          $set: {
            plan,
            limits,
            updatedAt: new Date(),
          },
        }
      );

      if (result.matchedCount === 0) {
        throw new NotFoundError("Organization not found");
      }

      repo.delCachedData();
      return result;
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      if (error instanceof BadRequestError) throw error;
      throw new InternalServerError("Failed to update organization plan");
    }
  }

  async function transferOwnership(_id: string | ObjectId, newOwnerId: string | ObjectId) {
    try {
      _id = new ObjectId(_id);
      newOwnerId = new ObjectId(newOwnerId);
    } catch {
      throw new BadRequestError("Invalid ID format");
    }

    try {
      const result = await repo.collection.updateOne(
        { _id },
        {
          $set: {
            ownerId: newOwnerId,
            updatedAt: new Date(),
          },
        }
      );

      if (result.matchedCount === 0) {
        throw new NotFoundError("Organization not found");
      }

      repo.delCachedData();
      return result;
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      if (error instanceof BadRequestError) throw error;
      throw new InternalServerError("Failed to transfer organization ownership");
    }
  }

  return {
    createIndexes,
    add,
    getById,
    getBySlug,
    getByOwnerId,
    getAll,
    updateById,
    deleteById,
    updateUsage,
    checkLimit,
    updatePlan,
    transferOwnership,
  };
}
