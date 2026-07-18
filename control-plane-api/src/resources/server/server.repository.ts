import { ObjectId } from "mongodb";
import { modelServer, TServer, TServerStatus } from "./server.model";
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

export function useServerRepo() {
  const namespace_collection = "cp_servers";
  const repo = useRepo(namespace_collection);

  async function createIndexes() {
    try {
      await repo.collection.createIndexes([
        { key: { name: "text", host: "text" } },
        { key: { host: 1 }, unique: true },
        { key: { status: 1 } },
        { key: { tags: 1 } },
      ]);
    } catch (error) {
      logger.log({
        level: "error",
        message: `Failed to create server indexes: ${error}`,
      });
    }
  }

  async function add(value: Partial<TServer>) {
    try {
      const server = modelServer(value);
      const res = await repo.collection.insertOne(server);
      repo.delCachedData();
      return res.insertedId;
    } catch (error: any) {
      logger.log({ level: "error", message: `${error}` });

      if (error.message?.includes("duplicate")) {
        throw new BadRequestError("Server with this host already exists");
      }

      throw new InternalServerError("Failed to create server");
    }
  }

  async function getById(_id: string | ObjectId) {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid server ID");
    }

    const cacheKey = makeCacheKey(namespace_collection, { _id: String(_id), tag: "by-id" });

    try {
      const cached = await repo.getCache<TServer>(cacheKey);
      if (cached) {
        return cached;
      }

      const result = await repo.collection.findOne<TServer>({ _id });

      if (result) {
        repo.setCache(cacheKey, result, 300).catch((err) => {
          logger.log({
            level: "error",
            message: `Failed to set cache for server by id: ${err.message}`,
          });
        });
      }

      return result;
    } catch (error) {
      throw new InternalServerError("Failed to get server by id");
    }
  }

  async function getAll({
    search = "",
    page = 1,
    limit = 10,
    status,
    tag,
  }: {
    search?: string;
    page?: number;
    limit?: number;
    status?: TServerStatus;
    tag?: string;
  } = {}) {
    page = page > 0 ? page - 1 : 0;

    const query: Record<string, any> = {};

    if (search) {
      query.$or = [
        { name: { $regex: escapeRegex(search), $options: "i" } },
        { host: { $regex: escapeRegex(search), $options: "i" } },
      ];
    }

    if (status) {
      query.status = status;
    }

    if (tag) {
      query.tags = tag;
    }

    const cacheKey = makeCacheKey(namespace_collection, {
      search,
      page,
      limit,
      status: status ?? "",
      tag: tag ?? "",
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
          message: `Failed to set cache for servers getAll: ${err.message}`,
        });
      });

      return data;
    } catch (error) {
      logger.log({ level: "error", message: `${error}` });
      throw new InternalServerError("Failed to get servers");
    }
  }

  async function updateById(_id: string | ObjectId, update: Partial<TServer>) {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid server ID");
    }

    try {
      const result = await repo.collection.updateOne(
        { _id },
        { $set: { ...update, updatedAt: new Date() } }
      );

      if (result.matchedCount === 0) {
        throw new NotFoundError("Server not found");
      }

      repo.delCachedData();
      return result;
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      throw new InternalServerError("Failed to update server");
    }
  }

  async function updateStatus(_id: string | ObjectId, status: TServerStatus) {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid server ID");
    }

    try {
      const result = await repo.collection.updateOne(
        { _id },
        {
          $set: {
            status,
            lastHealthCheck: new Date(),
            updatedAt: new Date(),
          },
        }
      );

      repo.delCachedData();
      return result;
    } catch (error) {
      throw new InternalServerError("Failed to update server status");
    }
  }

  async function deleteById(_id: string | ObjectId) {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid server ID");
    }

    try {
      const result = await repo.collection.deleteOne({ _id });

      if (result.deletedCount === 0) {
        throw new NotFoundError("Server not found");
      }

      repo.delCachedData();
      return result;
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      throw new InternalServerError("Failed to delete server");
    }
  }

  return {
    createIndexes,
    add,
    getById,
    getAll,
    updateById,
    updateStatus,
    deleteById,
  };
}
