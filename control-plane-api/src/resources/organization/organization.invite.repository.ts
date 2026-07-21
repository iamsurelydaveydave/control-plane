import { ObjectId } from "mongodb";
import {
  TOrganizationInvite,
  modelOrganizationInvite,
  TOrganizationInviteInput,
} from "./organization.invite.model";
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

const namespace_collection = "cp_organization_invites";

export function useOrganizationInviteRepo() {
  const repo = useRepo(namespace_collection);

  // ---------------------------------------------------------------------------
  // Indexes
  // ---------------------------------------------------------------------------

  async function createIndexes() {
    try {
      await repo.collection.createIndexes([
        { key: { token: 1 }, unique: true },
        { key: { organizationId: 1, email: 1 } },
        { key: { organizationId: 1 } },
        { key: { email: 1 } },
        { key: { expiresAt: 1 }, expireAfterSeconds: 0 }, // TTL index for auto-cleanup
        { key: { createdAt: -1 } },
      ]);
    } catch (error) {
      logger.log({
        level: "error",
        message: `Failed to create organization invite indexes: ${error}`,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  async function add(data: TOrganizationInviteInput) {
    try {
      const invite = modelOrganizationInvite(data);
      const result = await repo.collection.insertOne(invite);
      repo.delCachedData();
      return { insertedId: result.insertedId, token: invite.token };
    } catch (error: any) {
      logger.log({ level: "error", message: `${error}` });

      if (error.code === 11000 || error.message?.includes("duplicate")) {
        throw new ConflictError("An invite for this email already exists");
      }

      if (error instanceof BadRequestError) throw error;
      throw new InternalServerError("Failed to create invitation");
    }
  }

  async function getById(_id: string | ObjectId) {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid invite ID format");
    }

    const cacheKey = makeCacheKey(namespace_collection, { _id: String(_id), tag: "by-id" });

    try {
      const cached = await repo.getCache<TOrganizationInvite>(cacheKey);
      if (cached) return cached;

      const result = await repo.collection.findOne<TOrganizationInvite>({ _id });

      if (result) {
        repo.setCache(cacheKey, result, 300).catch((err) => {
          logger.log({
            level: "error",
            message: `Failed to set cache for invite by id: ${err.message}`,
          });
        });
      }

      return result;
    } catch (error) {
      if (error instanceof BadRequestError) throw error;
      throw new InternalServerError("Failed to get invite by id");
    }
  }

  async function getByToken(token: string) {
    if (!token || typeof token !== "string") {
      throw new BadRequestError("Invalid invite token");
    }

    const cacheKey = makeCacheKey(namespace_collection, { token, tag: "by-token" });

    try {
      const cached = await repo.getCache<TOrganizationInvite>(cacheKey);
      if (cached) return cached;

      const result = await repo.collection.findOne<TOrganizationInvite>({ token });

      if (result) {
        repo.setCache(cacheKey, result, 300).catch((err) => {
          logger.log({
            level: "error",
            message: `Failed to set cache for invite by token: ${err.message}`,
          });
        });
      }

      return result;
    } catch (error) {
      throw new InternalServerError("Failed to get invite by token");
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

      // Only return pending (non-accepted) invites
      const query = { organizationId, acceptedAt: { $exists: false } };

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
          message: `Failed to set cache for invites by org: ${err.message}`,
        });
      });

      return data;
    } catch (error) {
      if (error instanceof BadRequestError) throw error;
      throw new InternalServerError("Failed to get organization invites");
    }
  }

  async function getByEmail(email: string) {
    if (!email || typeof email !== "string") {
      throw new BadRequestError("Invalid email");
    }

    const normalizedEmail = email.toLowerCase().trim();

    const cacheKey = makeCacheKey(namespace_collection, { email: normalizedEmail, tag: "by-email" });

    try {
      const cached = await repo.getCache<TOrganizationInvite[]>(cacheKey);
      if (cached) return cached;

      // Only return pending (non-accepted) invites
      const result = await repo.collection
        .find<TOrganizationInvite>({
          email: normalizedEmail,
          acceptedAt: { $exists: false },
        })
        .sort({ createdAt: -1 })
        .toArray();

      repo.setCache(cacheKey, result, 300).catch((err) => {
        logger.log({
          level: "error",
          message: `Failed to set cache for invites by email: ${err.message}`,
        });
      });

      return result;
    } catch (error) {
      throw new InternalServerError("Failed to get invites by email");
    }
  }

  async function markAccepted(_id: string | ObjectId) {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid invite ID format");
    }

    try {
      const result = await repo.collection.updateOne(
        { _id },
        { $set: { acceptedAt: new Date() } }
      );

      if (result.matchedCount === 0) {
        throw new NotFoundError("Invite not found");
      }

      repo.delCachedData();
      return result;
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      if (error instanceof BadRequestError) throw error;
      throw new InternalServerError("Failed to mark invite as accepted");
    }
  }

  async function deleteById(_id: string | ObjectId) {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid invite ID format");
    }

    try {
      const result = await repo.collection.deleteOne({ _id });

      if (result.deletedCount === 0) {
        throw new NotFoundError("Invite not found");
      }

      repo.delCachedData();
      return result;
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      if (error instanceof BadRequestError) throw error;
      throw new InternalServerError("Failed to delete invite");
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
      throw new InternalServerError("Failed to delete organization invites");
    }
  }

  async function getPendingByOrgAndEmail(organizationId: string | ObjectId, email: string) {
    try {
      organizationId = new ObjectId(organizationId);
    } catch {
      throw new BadRequestError("Invalid organization ID format");
    }

    const normalizedEmail = email.toLowerCase().trim();

    try {
      return await repo.collection.findOne<TOrganizationInvite>({
        organizationId,
        email: normalizedEmail,
        acceptedAt: { $exists: false },
        expiresAt: { $gt: new Date() },
      });
    } catch (error) {
      throw new InternalServerError("Failed to check for pending invite");
    }
  }

  return {
    createIndexes,
    add,
    getById,
    getByToken,
    getByOrganizationId,
    getByEmail,
    markAccepted,
    deleteById,
    deleteByOrganizationId,
    getPendingByOrgAndEmail,
  };
}
