import { ObjectId } from "mongodb";
import { modelApp, TApp, TAppStatus } from "./app.model";
import {
  BadRequestError,
  InternalServerError,
  NotFoundError,
  logger,
  makeCacheKey,
  paginate,
  useRepo,
  escapeRegex,
} from "../../utils";

export function useAppRepo() {
  const namespace_collection = "cp_apps";
  const repo = useRepo(namespace_collection);

  async function createIndexes() {
    try {
      await repo.collection.createIndexes([
        { key: { name: "text" } },
        { key: { name: 1 }, unique: true },
        { key: { status: 1 } },
        { key: { domain: 1 }, sparse: true },
        { key: { serverIds: 1 } },
      ]);
    } catch (error) {
      logger.log({
        level: "error",
        message: `Failed to create app indexes: ${error}`,
      });
    }
  }

  async function add(value: Partial<TApp>) {
    try {
      const app = modelApp(value);
      const res = await repo.collection.insertOne(app);
      repo.delCachedData();
      return res.insertedId;
    } catch (error: any) {
      logger.log({ level: "error", message: `${error}` });

      if (error.message?.includes("duplicate")) {
        throw new BadRequestError("App with this name already exists");
      }

      throw new InternalServerError("Failed to create app");
    }
  }

  async function getById(_id: string | ObjectId) {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid app ID");
    }

    const cacheKey = makeCacheKey(namespace_collection, { _id: String(_id), tag: "by-id" });

    try {
      const cached = await repo.getCache<TApp>(cacheKey);
      if (cached) {
        return cached;
      }

      const result = await repo.collection.findOne<TApp>({ _id });

      if (result) {
        repo.setCache(cacheKey, result, 300).catch((err) => {
          logger.log({
            level: "error",
            message: `Failed to set cache for app by id: ${err.message}`,
          });
        });
      }

      return result;
    } catch (error) {
      throw new InternalServerError("Failed to get app by id");
    }
  }

  async function getAll({
    search = "",
    page = 1,
    limit = 10,
    status,
  }: {
    search?: string;
    page?: number;
    limit?: number;
    status?: TAppStatus;
  } = {}) {
    page = page > 0 ? page - 1 : 0;

    const query: Record<string, any> = {};

    if (search) {
      query.name = { $regex: escapeRegex(search), $options: "i" };
    }

    if (status) {
      query.status = status;
    }

    const cacheKey = makeCacheKey(namespace_collection, {
      search,
      page,
      limit,
      status: status ?? "",
      tag_query: "getAll",
    });

    try {
      const cached = await repo.getCache<Record<string, any>>(cacheKey);
      if (cached) {
        return cached;
      }

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
          message: `Failed to set cache for apps getAll: ${err.message}`,
        });
      });

      return data;
    } catch (error) {
      logger.log({ level: "error", message: `${error}` });
      throw new InternalServerError("Failed to get apps");
    }
  }

  async function updateById(_id: string | ObjectId, update: Partial<TApp>) {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid app ID");
    }

    try {
      const result = await repo.collection.updateOne(
        { _id },
        { $set: { ...update, updatedAt: new Date() } }
      );

      if (result.matchedCount === 0) {
        throw new NotFoundError("App not found");
      }

      repo.delCachedData();
      return result;
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      throw new InternalServerError("Failed to update app");
    }
  }

  async function updateStatus(_id: string | ObjectId, status: TAppStatus) {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid app ID");
    }

    try {
      const update: Record<string, any> = {
        status,
        updatedAt: new Date(),
      };

      if (status === "running") {
        update.deployedAt = new Date();
      }

      const result = await repo.collection.updateOne({ _id }, { $set: update });

      repo.delCachedData();
      return result;
    } catch (error) {
      throw new InternalServerError("Failed to update app status");
    }
  }

  async function scale(_id: string | ObjectId, desiredReplicas: number) {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid app ID");
    }

    try {
      const result = await repo.collection.updateOne(
        { _id },
        { $set: { desiredReplicas, updatedAt: new Date() } }
      );

      if (result.matchedCount === 0) {
        throw new NotFoundError("App not found");
      }

      repo.delCachedData();
      return result;
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      throw new InternalServerError("Failed to scale app");
    }
  }

  async function deleteById(_id: string | ObjectId) {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid app ID");
    }

    try {
      const result = await repo.collection.deleteOne({ _id });

      if (result.deletedCount === 0) {
        throw new NotFoundError("App not found");
      }

      repo.delCachedData();
      return result;
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      throw new InternalServerError("Failed to delete app");
    }
  }

  return {
    createIndexes,
    add,
    getById,
    getAll,
    updateById,
    updateStatus,
    scale,
    deleteById,
  };
}
