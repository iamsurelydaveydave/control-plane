import { ObjectId } from "mongodb";
import { modelInstance, TInstance, TInstanceStatus } from "./instance.model";
import {
  BadRequestError,
  InternalServerError,
  NotFoundError,
  logger,
  makeCacheKey,
  useRepo,
} from "../../utils";

export function useInstanceRepo() {
  const namespace_collection = "cp_instances";
  const repo = useRepo(namespace_collection);

  async function createIndexes() {
    try {
      await repo.collection.createIndexes([
        { key: { appId: 1 } },
        { key: { serverId: 1 } },
        { key: { appId: 1, serverId: 1 } },
        { key: { status: 1 } },
      ]);
    } catch (error) {
      logger.log({
        level: "error",
        message: `Failed to create instance indexes: ${error}`,
      });
    }
  }

  async function add(value: Partial<TInstance>) {
    try {
      const instance = modelInstance(value);
      const res = await repo.collection.insertOne(instance);
      repo.delCachedData();
      return res.insertedId;
    } catch (error: any) {
      logger.log({ level: "error", message: `${error}` });
      throw new InternalServerError("Failed to create instance");
    }
  }

  async function getById(_id: string | ObjectId) {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid instance ID");
    }

    try {
      return await repo.collection.findOne<TInstance>({ _id });
    } catch (error) {
      throw new InternalServerError("Failed to get instance by id");
    }
  }

  async function getByAppId(appId: string | ObjectId) {
    try {
      appId = new ObjectId(appId);
    } catch {
      throw new BadRequestError("Invalid app ID");
    }

    const cacheKey = makeCacheKey(namespace_collection, { appId: String(appId), tag: "by-app" });

    try {
      const cached = await repo.getCache<TInstance[]>(cacheKey);
      if (cached) {
        return cached;
      }

      const result = await repo.collection.find<TInstance>({ appId }).toArray();

      repo.setCache(cacheKey, result, 60).catch((err) => {
        logger.log({
          level: "error",
          message: `Failed to set cache for instances by app: ${err.message}`,
        });
      });

      return result;
    } catch (error) {
      throw new InternalServerError("Failed to get instances by app");
    }
  }

  async function getByServerId(serverId: string | ObjectId) {
    try {
      serverId = new ObjectId(serverId);
    } catch {
      throw new BadRequestError("Invalid server ID");
    }

    try {
      return await repo.collection.find<TInstance>({ serverId }).toArray();
    } catch (error) {
      throw new InternalServerError("Failed to get instances by server");
    }
  }

  async function updateStatus(_id: string | ObjectId, status: TInstanceStatus, containerId?: string) {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid instance ID");
    }

    try {
      const update: Record<string, any> = {
        status,
        lastHealthCheck: new Date(),
        updatedAt: new Date(),
      };

      if (containerId !== undefined) {
        update.containerId = containerId;
      }

      const result = await repo.collection.updateOne({ _id }, { $set: update });

      repo.delCachedData();
      return result;
    } catch (error) {
      throw new InternalServerError("Failed to update instance status");
    }
  }

  async function deleteById(_id: string | ObjectId) {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid instance ID");
    }

    try {
      const result = await repo.collection.deleteOne({ _id });

      if (result.deletedCount === 0) {
        throw new NotFoundError("Instance not found");
      }

      repo.delCachedData();
      return result;
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      throw new InternalServerError("Failed to delete instance");
    }
  }

  async function deleteByAppId(appId: string | ObjectId) {
    try {
      appId = new ObjectId(appId);
    } catch {
      throw new BadRequestError("Invalid app ID");
    }

    try {
      const result = await repo.collection.deleteMany({ appId });
      repo.delCachedData();
      return result;
    } catch (error) {
      throw new InternalServerError("Failed to delete instances by app");
    }
  }

  return {
    createIndexes,
    add,
    getById,
    getByAppId,
    getByServerId,
    updateStatus,
    deleteById,
    deleteByAppId,
  };
}
