import { ObjectId } from "mongodb";
import { TSSHKey, modelSSHKey } from "./ssh-key.model";
import {
  BadRequestError,
  InternalServerError,
  NotFoundError,
  logger,
  makeCacheKey,
  useRepo,
} from "../../utils";

const namespace_collection = "ssh_keys";

export function useSSHKeyRepo() {
  const repo = useRepo(namespace_collection);

  async function createIndexes() {
    try {
      await repo.collection.createIndexes([
        { key: { name: 1 }, unique: true },
        { key: { fingerprint: 1 }, unique: true },
        { key: { isDefault: 1 } },
      ]);
    } catch (error) {
      logger.log({
        level: "error",
        message: `Failed to create indexes for ${namespace_collection}: ${error}`,
      });
    }
  }

  async function add(data: Partial<TSSHKey>): Promise<ObjectId> {
    const value = modelSSHKey(data);

    // If this is set as default, unset other defaults
    if (value.isDefault) {
      await repo.collection.updateMany(
        { isDefault: true },
        { $set: { isDefault: false } }
      );
    }

    try {
      const result = await repo.collection.insertOne(value);
      await repo.delCachedData();
      return result.insertedId;
    } catch (error: any) {
      if (error.code === 11000) {
        throw new BadRequestError("SSH key with this name or fingerprint already exists");
      }
      logger.log({
        level: "error",
        message: `Failed to add SSH key: ${error.message}`,
      });
      throw new InternalServerError("Failed to add SSH key");
    }
  }

  async function getById(_id: string | ObjectId): Promise<TSSHKey | null> {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid SSH key ID");
    }

    const cacheKey = makeCacheKey(namespace_collection, { _id: String(_id), tag: "by-id" });

    try {
      const cached = await repo.getCache<TSSHKey>(cacheKey);
      if (cached) return cached;

      const result = await repo.collection.findOne<TSSHKey>({ _id });

      if (result) {
        repo.setCache(cacheKey, result, 300).catch((err) => {
          logger.log({
            level: "error",
            message: `Failed to set cache for SSH key: ${err.message}`,
          });
        });
      }

      return result;
    } catch (error: any) {
      logger.log({
        level: "error",
        message: `Failed to get SSH key by id: ${error.message}`,
      });
      throw new InternalServerError("Failed to get SSH key");
    }
  }

  async function getDefault(): Promise<TSSHKey | null> {
    const cacheKey = makeCacheKey(namespace_collection, { tag: "default" });

    try {
      const cached = await repo.getCache<TSSHKey>(cacheKey);
      if (cached) return cached;

      const result = await repo.collection.findOne<TSSHKey>({ isDefault: true });

      if (result) {
        repo.setCache(cacheKey, result, 300).catch((err) => {
          logger.log({
            level: "error",
            message: `Failed to set cache for default SSH key: ${err.message}`,
          });
        });
      }

      return result;
    } catch (error: any) {
      logger.log({
        level: "error",
        message: `Failed to get default SSH key: ${error.message}`,
      });
      throw new InternalServerError("Failed to get default SSH key");
    }
  }

  async function getAll(): Promise<TSSHKey[]> {
    const cacheKey = makeCacheKey(namespace_collection, { tag: "all" });

    try {
      const cached = await repo.getCache<TSSHKey[]>(cacheKey);
      if (cached) return cached;

      const items = await repo.collection.find<TSSHKey>({}).sort({ createdAt: -1 }).toArray();

      repo.setCache(cacheKey, items, 300).catch((err) => {
        logger.log({
          level: "error",
          message: `Failed to set cache for SSH keys: ${err.message}`,
        });
      });

      return items;
    } catch (error: any) {
      logger.log({
        level: "error",
        message: `Failed to get all SSH keys: ${error.message}`,
      });
      throw new InternalServerError("Failed to get SSH keys");
    }
  }

  async function updateById(_id: string | ObjectId, data: Partial<TSSHKey>): Promise<boolean> {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid SSH key ID");
    }

    // If setting as default, unset other defaults
    if (data.isDefault) {
      await repo.collection.updateMany(
        { isDefault: true, _id: { $ne: _id } },
        { $set: { isDefault: false } }
      );
    }

    try {
      const result = await repo.collection.updateOne(
        { _id },
        { $set: { ...data, updatedAt: new Date() } }
      );

      if (result.matchedCount === 0) {
        throw new NotFoundError("SSH key not found");
      }

      await repo.delCachedData();
      return result.modifiedCount > 0;
    } catch (error: any) {
      if (error instanceof NotFoundError) throw error;
      logger.log({
        level: "error",
        message: `Failed to update SSH key: ${error.message}`,
      });
      throw new InternalServerError("Failed to update SSH key");
    }
  }

  async function deleteById(_id: string | ObjectId): Promise<boolean> {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid SSH key ID");
    }

    try {
      const result = await repo.collection.deleteOne({ _id });

      if (result.deletedCount === 0) {
        throw new NotFoundError("SSH key not found");
      }

      await repo.delCachedData();
      return true;
    } catch (error: any) {
      if (error instanceof NotFoundError) throw error;
      logger.log({
        level: "error",
        message: `Failed to delete SSH key: ${error.message}`,
      });
      throw new InternalServerError("Failed to delete SSH key");
    }
  }

  async function count(): Promise<number> {
    try {
      return await repo.collection.countDocuments();
    } catch (error: any) {
      logger.log({
        level: "error",
        message: `Failed to count SSH keys: ${error.message}`,
      });
      return 0;
    }
  }

  return {
    createIndexes,
    add,
    getById,
    getDefault,
    getAll,
    updateById,
    deleteById,
    count,
  };
}
