import { ObjectId } from "mongodb";
import { TAPIToken, modelAPIToken } from "./api-token.model";
import {
  BadRequestError,
  InternalServerError,
  NotFoundError,
  logger,
  makeCacheKey,
  useRepo,
} from "../../utils";

const namespace_collection = "api_tokens";

export function useAPITokenRepo() {
  const repo = useRepo(namespace_collection);

  async function createIndexes() {
    try {
      await repo.collection.createIndexes([
        { key: { name: 1, userId: 1 }, unique: true },
        { key: { token: 1 }, unique: true },
        { key: { tokenPrefix: 1 } },
        { key: { userId: 1 } },
        { key: { expiresAt: 1 }, sparse: true },
      ]);
    } catch (error) {
      logger.log({
        level: "error",
        message: `Failed to create indexes for ${namespace_collection}: ${error}`,
      });
    }
  }

  async function add(data: Partial<TAPIToken>): Promise<ObjectId> {
    const value = modelAPIToken(data);

    try {
      const result = await repo.collection.insertOne(value);
      await repo.delCachedData();
      return result.insertedId;
    } catch (error: any) {
      if (error.code === 11000) {
        throw new BadRequestError("API token with this name already exists");
      }
      logger.log({
        level: "error",
        message: `Failed to add API token: ${error.message}`,
      });
      throw new InternalServerError("Failed to add API token");
    }
  }

  async function getById(_id: string | ObjectId): Promise<TAPIToken | null> {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid API token ID");
    }

    try {
      return await repo.collection.findOne<TAPIToken>({ _id });
    } catch (error: any) {
      logger.log({
        level: "error",
        message: `Failed to get API token by id: ${error.message}`,
      });
      throw new InternalServerError("Failed to get API token");
    }
  }

  async function getByToken(token: string): Promise<TAPIToken | null> {
    try {
      return await repo.collection.findOne<TAPIToken>({ token });
    } catch (error: any) {
      logger.log({
        level: "error",
        message: `Failed to get API token: ${error.message}`,
      });
      throw new InternalServerError("Failed to get API token");
    }
  }

  async function getAllByUser(userId: string | ObjectId): Promise<TAPIToken[]> {
    try {
      userId = new ObjectId(userId);
    } catch {
      throw new BadRequestError("Invalid user ID");
    }

    const cacheKey = makeCacheKey(namespace_collection, { userId: String(userId), tag: "by-user" });

    try {
      const cached = await repo.getCache<TAPIToken[]>(cacheKey);
      if (cached) return cached;

      const items = await repo.collection
        .find<TAPIToken>({ userId })
        .sort({ createdAt: -1 })
        .toArray();

      repo.setCache(cacheKey, items, 300).catch((err) => {
        logger.log({
          level: "error",
          message: `Failed to set cache for API tokens: ${err.message}`,
        });
      });

      return items;
    } catch (error: any) {
      logger.log({
        level: "error",
        message: `Failed to get API tokens for user: ${error.message}`,
      });
      throw new InternalServerError("Failed to get API tokens");
    }
  }

  async function updateLastUsed(_id: ObjectId): Promise<void> {
    try {
      await repo.collection.updateOne(
        { _id },
        { $set: { lastUsedAt: new Date() } }
      );
    } catch (error: any) {
      logger.log({
        level: "error",
        message: `Failed to update API token last used: ${error.message}`,
      });
    }
  }

  async function deleteById(_id: string | ObjectId): Promise<boolean> {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid API token ID");
    }

    try {
      const result = await repo.collection.deleteOne({ _id });

      if (result.deletedCount === 0) {
        throw new NotFoundError("API token not found");
      }

      await repo.delCachedData();
      return true;
    } catch (error: any) {
      if (error instanceof NotFoundError) throw error;
      logger.log({
        level: "error",
        message: `Failed to delete API token: ${error.message}`,
      });
      throw new InternalServerError("Failed to delete API token");
    }
  }

  async function deleteAllByUser(userId: string | ObjectId): Promise<number> {
    try {
      userId = new ObjectId(userId);
    } catch {
      throw new BadRequestError("Invalid user ID");
    }

    try {
      const result = await repo.collection.deleteMany({ userId });
      await repo.delCachedData();
      return result.deletedCount;
    } catch (error: any) {
      logger.log({
        level: "error",
        message: `Failed to delete API tokens for user: ${error.message}`,
      });
      throw new InternalServerError("Failed to delete API tokens");
    }
  }

  return {
    createIndexes,
    add,
    getById,
    getByToken,
    getAllByUser,
    updateLastUsed,
    deleteById,
    deleteAllByUser,
  };
}
