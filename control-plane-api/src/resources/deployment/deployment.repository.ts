import { ObjectId } from "mongodb";
import { modelDeployment, TDeployment, TDeploymentInput, TDeploymentStatus } from "./deployment.model";
import {
  BadRequestError,
  InternalServerError,
  logger,
  makeCacheKey,
  paginate,
  useRepo,
} from "../../utils";

export function useDeploymentRepo() {
  const namespace_collection = "cp_deployments";
  const repo = useRepo(namespace_collection);

  async function createIndexes() {
    try {
      await repo.collection.createIndexes([
        { key: { appId: 1, startedAt: -1 } },
        { key: { status: 1 } },
        { key: { triggeredBy: 1 } },
      ]);
    } catch (error) {
      logger.log({
        level: "error",
        message: `Failed to create deployment indexes: ${error}`,
      });
    }
  }

  async function add(value: TDeploymentInput) {
    try {
      const deployment = modelDeployment(value);
      const res = await repo.collection.insertOne(deployment);
      repo.delCachedData();
      return res.insertedId;
    } catch (error: any) {
      logger.log({ level: "error", message: `${error}` });
      throw new InternalServerError("Failed to create deployment");
    }
  }

  async function getById(_id: string | ObjectId) {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid deployment ID");
    }

    try {
      return await repo.collection.findOne<TDeployment>({ _id });
    } catch (error) {
      throw new InternalServerError("Failed to get deployment by id");
    }
  }

  async function getByAppId(appId: string | ObjectId, { page = 1, limit = 10 } = {}) {
    try {
      appId = new ObjectId(appId);
    } catch {
      throw new BadRequestError("Invalid app ID");
    }

    page = page > 0 ? page - 1 : 0;

    const cacheKey = makeCacheKey(namespace_collection, {
      appId: String(appId),
      page,
      limit,
      tag: "by-app",
    });

    try {
      const cached = await repo.getCache<Record<string, any>>(cacheKey);
      if (cached) {
        return cached;
      }

      const items = await repo.collection
        .aggregate([
          { $match: { appId } },
          { $sort: { startedAt: -1 } },
          { $skip: page * limit },
          { $limit: limit },
        ])
        .toArray();

      const length = await repo.collection.countDocuments({ appId });
      const data = paginate(items, page, limit, length);

      repo.setCache(cacheKey, data, 60).catch((err) => {
        logger.log({
          level: "error",
          message: `Failed to set cache for deployments by app: ${err.message}`,
        });
      });

      return data;
    } catch (error) {
      throw new InternalServerError("Failed to get deployments by app");
    }
  }

  async function updateStatus(_id: string | ObjectId, status: TDeploymentStatus, logs?: string) {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid deployment ID");
    }

    try {
      const update: Record<string, any> = { status };

      if (logs !== undefined) {
        update.logs = logs;
      }

      if (status === "success" || status === "failed") {
        update.completedAt = new Date();
      }

      const result = await repo.collection.updateOne({ _id }, { $set: update });

      repo.delCachedData();
      return result;
    } catch (error) {
      throw new InternalServerError("Failed to update deployment status");
    }
  }

  async function appendLogs(_id: string | ObjectId, logs: string) {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid deployment ID");
    }

    try {
      // Use $push with $each to append, but we'll use simple string concat
      const deployment = await repo.collection.findOne<TDeployment>({ _id });
      if (!deployment) return null;

      const newLogs = (deployment.logs || "") + logs;
      const result = await repo.collection.updateOne({ _id }, { $set: { logs: newLogs } });

      return result;
    } catch (error) {
      throw new InternalServerError("Failed to append deployment logs");
    }
  }

  return {
    createIndexes,
    add,
    getById,
    getByAppId,
    updateStatus,
    appendLogs,
  };
}
