import { ObjectId } from "mongodb";
import { modelDatabase, TDatabase, TDatabaseStatus } from "./database.model";
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

export function useDatabaseRepo() {
  const namespace_collection = "cp_databases";
  const repo = useRepo(namespace_collection);

  async function createIndexes() {
    try {
      await repo.collection.createIndexes([
        { key: { name: "text" } },
        { key: { name: 1 }, unique: true },
        { key: { type: 1 } },
        { key: { status: 1 } },
        { key: { "nodes.serverId": 1 } },
      ]);
    } catch (error) {
      logger.log({
        level: "error",
        message: `Failed to create database indexes: ${error}`,
      });
    }
  }

  async function add(value: Partial<TDatabase>) {
    try {
      const database = modelDatabase(value);
      const res = await repo.collection.insertOne(database);
      repo.delCachedData();
      return res.insertedId;
    } catch (error: any) {
      logger.log({ level: "error", message: `${error}` });

      if (error.message?.includes("duplicate")) {
        throw new BadRequestError("Database with this name already exists");
      }

      throw new InternalServerError("Failed to create database");
    }
  }

  async function getById(_id: string | ObjectId) {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid database ID");
    }

    const cacheKey = makeCacheKey(namespace_collection, { _id: String(_id), tag: "by-id" });

    try {
      const cached = await repo.getCache<TDatabase>(cacheKey);
      if (cached) {
        return cached;
      }

      const result = await repo.collection.findOne<TDatabase>({ _id });

      if (result) {
        repo.setCache(cacheKey, result, 300).catch((err) => {
          logger.log({
            level: "error",
            message: `Failed to set cache for database by id: ${err.message}`,
          });
        });
      }

      return result;
    } catch (error) {
      throw new InternalServerError("Failed to get database by id");
    }
  }

  async function getAll({
    search = "",
    page = 1,
    limit = 10,
    type,
    status,
  }: {
    search?: string;
    page?: number;
    limit?: number;
    type?: string;
    status?: TDatabaseStatus;
  } = {}) {
    page = page > 0 ? page - 1 : 0;

    const query: Record<string, any> = {};

    if (search) {
      query.name = { $regex: escapeRegex(search), $options: "i" };
    }

    if (type) {
      query.type = type;
    }

    if (status) {
      query.status = status;
    }

    const cacheKey = makeCacheKey(namespace_collection, {
      search,
      page,
      limit,
      type: type ?? "",
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
          // Exclude sensitive credentials from list view
          {
            $project: {
              "credentials.adminPassword": 0,
              "credentials.connectionString": 0,
            },
          },
        ])
        .toArray();

      const length = await repo.collection.countDocuments(query);
      const data = paginate(items, page, limit, length);

      repo.setCache(cacheKey, data, 300).catch((err) => {
        logger.log({
          level: "error",
          message: `Failed to set cache for databases getAll: ${err.message}`,
        });
      });

      return data;
    } catch (error) {
      logger.log({ level: "error", message: `${error}` });
      throw new InternalServerError("Failed to get databases");
    }
  }

  async function updateById(_id: string | ObjectId, update: Partial<TDatabase>) {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid database ID");
    }

    try {
      const result = await repo.collection.updateOne(
        { _id },
        { $set: { ...update, updatedAt: new Date() } }
      );

      if (result.matchedCount === 0) {
        throw new NotFoundError("Database not found");
      }

      repo.delCachedData();
      return result;
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      throw new InternalServerError("Failed to update database");
    }
  }

  async function updateStatus(_id: string | ObjectId, status: TDatabaseStatus) {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid database ID");
    }

    try {
      const result = await repo.collection.updateOne(
        { _id },
        { $set: { status, updatedAt: new Date() } }
      );

      repo.delCachedData();
      return result;
    } catch (error) {
      throw new InternalServerError("Failed to update database status");
    }
  }

  async function updateBackupTime(_id: string | ObjectId) {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid database ID");
    }

    try {
      const result = await repo.collection.updateOne(
        { _id },
        { $set: { "backup.lastBackup": new Date(), updatedAt: new Date() } }
      );

      repo.delCachedData();
      return result;
    } catch (error) {
      throw new InternalServerError("Failed to update backup time");
    }
  }

  async function deleteById(_id: string | ObjectId) {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid database ID");
    }

    try {
      const result = await repo.collection.deleteOne({ _id });

      if (result.deletedCount === 0) {
        throw new NotFoundError("Database not found");
      }

      repo.delCachedData();
      return result;
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      throw new InternalServerError("Failed to delete database");
    }
  }

  async function getByServerId(serverId: string | ObjectId) {
    try {
      serverId = new ObjectId(serverId);
    } catch {
      throw new BadRequestError("Invalid server ID");
    }

    try {
      return await repo.collection.find<TDatabase>({ "nodes.serverId": serverId }).toArray();
    } catch (error) {
      throw new InternalServerError("Failed to get databases by server id");
    }
  }

  return {
    createIndexes,
    add,
    getById,
    getAll,
    updateById,
    updateStatus,
    updateBackupTime,
    deleteById,
    getByServerId,
  };
}
