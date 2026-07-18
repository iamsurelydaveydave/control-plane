import { ObjectId } from "mongodb";
import {
  BadRequestError,
  InternalServerError,
  logger,
  makeCacheKey,
  useRepo,
} from "../../utils";

export type TSettings = {
  _id: string; // Setting key
  value: string;
  updatedAt: Date;
};

export function useSettingsRepo() {
  const namespace_collection = "cp_settings";
  const repo = useRepo(namespace_collection);

  async function createIndexes() {
    // _id is already indexed by MongoDB
  }

  async function get(key: string): Promise<string | null> {
    const cacheKey = makeCacheKey(namespace_collection, { key, tag: "get" });

    try {
      const cached = await repo.getCache<TSettings>(cacheKey);
      if (cached) {
        return cached.value;
      }

      const result = await repo.collection.findOne<TSettings>({ _id: key as any });

      if (result) {
        repo.setCache(cacheKey, result, 600).catch((err) => {
          logger.log({
            level: "error",
            message: `Failed to set cache for setting: ${err.message}`,
          });
        });
        return result.value;
      }

      return null;
    } catch (error) {
      throw new InternalServerError("Failed to get setting");
    }
  }

  async function set(key: string, value: string) {
    try {
      const result = await repo.collection.updateOne(
        { _id: key as any },
        { $set: { value, updatedAt: new Date() } },
        { upsert: true }
      );

      repo.delCachedData();
      return result;
    } catch (error) {
      throw new InternalServerError("Failed to set setting");
    }
  }

  async function getAll() {
    const cacheKey = makeCacheKey(namespace_collection, { tag: "getAll" });

    try {
      const cached = await repo.getCache<TSettings[]>(cacheKey);
      if (cached) {
        return cached;
      }

      const result = await repo.collection.find<TSettings>({}).toArray();

      repo.setCache(cacheKey, result, 600).catch((err) => {
        logger.log({
          level: "error",
          message: `Failed to set cache for settings: ${err.message}`,
        });
      });

      return result;
    } catch (error) {
      throw new InternalServerError("Failed to get settings");
    }
  }

  return {
    createIndexes,
    get,
    set,
    getAll,
  };
}
