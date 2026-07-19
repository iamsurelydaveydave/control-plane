import { ObjectId } from "mongodb";
import {
  modelDatabase,
  TDatabase,
  TDatabaseBackupRecord,
  TDatabaseDNS,
  TDatabaseNode,
  TDatabaseNodeStatus,
  TDatabaseStatus,
} from "./database.model";
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

  async function addBackupRecord(_id: string | ObjectId, record: TDatabaseBackupRecord): Promise<void> {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid database ID");
    }

    try {
      await repo.collection.updateOne(
        { _id },
        {
          $push: {
            backupRecords: {
              $each: [{ ...record, _id: new ObjectId() }],
              $slice: -50,
            },
          } as any,
          $set: { "backup.lastBackup": new Date(), updatedAt: new Date() },
        }
      );

      repo.delCachedData();
    } catch (error) {
      throw new InternalServerError("Failed to add backup record");
    }
  }

  async function getBackupRecords(_id: string | ObjectId): Promise<TDatabaseBackupRecord[]> {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid database ID");
    }

    const cacheKey = makeCacheKey(namespace_collection, { _id: String(_id), tag: "backup-records" });

    try {
      const cached = await repo.getCache<TDatabaseBackupRecord[]>(cacheKey);
      if (cached) return cached;

      const result = await repo.collection.findOne<TDatabase>(
        { _id },
        { projection: { backupRecords: 1 } }
      );

      const records = result?.backupRecords ?? [];

      repo.setCache(cacheKey, records, 60).catch((err) => {
        logger.log({
          level: "error",
          message: `Failed to set cache for backup records: ${err.message}`,
        });
      });

      return records;
    } catch (error) {
      throw new InternalServerError("Failed to get backup records");
    }
  }

  async function deleteBackupRecord(_id: string | ObjectId, recordIndex: number): Promise<void> {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid database ID");
    }

    try {
      // Pull the record at the given index by unsetting then pulling nulls
      const database = await repo.collection.findOne<TDatabase>({ _id });
      if (!database) throw new NotFoundError("Database not found");

      const records = database.backupRecords ?? [];
      if (recordIndex < 0 || recordIndex >= records.length) {
        throw new BadRequestError("Backup record index out of range");
      }

      records.splice(recordIndex, 1);

      await repo.collection.updateOne(
        { _id },
        { $set: { backupRecords: records, updatedAt: new Date() } }
      );

      repo.delCachedData();
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof BadRequestError) throw error;
      throw new InternalServerError("Failed to delete backup record");
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

  async function countByServerId(serverId: string | ObjectId): Promise<number> {
    let id: ObjectId;
    try {
      id = new ObjectId(serverId);
    } catch {
      throw new BadRequestError("Invalid server ID");
    }

    try {
      return await repo.collection.countDocuments({ "nodes.serverId": id });
    } catch (error) {
      throw new InternalServerError("Failed to count databases for server");
    }
  }

  /**
   * Add a node to an existing database
   */
  async function addNode(_id: string | ObjectId, node: TDatabaseNode) {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid database ID");
    }

    // Convert serverId to ObjectId if needed
    const nodeWithObjectId: TDatabaseNode = {
      ...node,
      serverId:
        typeof node.serverId === "string" ? new ObjectId(node.serverId) : node.serverId,
    };

    try {
      const result = await repo.collection.updateOne(
        { _id },
        {
          $push: { nodes: nodeWithObjectId } as any,
          $set: { updatedAt: new Date() },
        }
      );

      if (result.matchedCount === 0) {
        throw new NotFoundError("Database not found");
      }

      repo.delCachedData();
      return result;
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      throw new InternalServerError("Failed to add node to database");
    }
  }

  /**
   * Remove a node from an existing database
   */
  async function removeNode(_id: string | ObjectId, serverId: string | ObjectId) {
    try {
      _id = new ObjectId(_id);
      serverId = new ObjectId(serverId);
    } catch {
      throw new BadRequestError("Invalid ID format");
    }

    try {
      const result = await repo.collection.updateOne(
        { _id },
        {
          $pull: { nodes: { serverId } } as any,
          $set: { updatedAt: new Date() },
        }
      );

      if (result.matchedCount === 0) {
        throw new NotFoundError("Database not found");
      }

      repo.delCachedData();
      return result;
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      throw new InternalServerError("Failed to remove node from database");
    }
  }

  /**
   * Update the status of a specific node in a database
   */
  async function updateNodeStatus(
    _id: string | ObjectId,
    serverId: string | ObjectId,
    status: TDatabaseNodeStatus
  ) {
    try {
      _id = new ObjectId(_id);
      serverId = new ObjectId(serverId);
    } catch {
      throw new BadRequestError("Invalid ID format");
    }

    try {
      const result = await repo.collection.updateOne(
        { _id, "nodes.serverId": serverId },
        {
          $set: {
            "nodes.$.status": status,
            updatedAt: new Date(),
          },
        }
      );

      if (result.matchedCount === 0) {
        throw new NotFoundError("Database or node not found");
      }

      repo.delCachedData();
      return result;
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      throw new InternalServerError("Failed to update node status");
    }
  }

  /**
   * Store (or clear) the DNS configuration on a database document.
   * Pass `null` to remove existing DNS info (e.g. after teardown).
   */
  async function updateDNS(_id: string | ObjectId, dns: TDatabaseDNS | null) {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid database ID");
    }

    try {
      const result = await repo.collection.updateOne(
        { _id },
        dns
          ? { $set: { dns, updatedAt: new Date() } }
          : { $unset: { dns: "" }, $set: { updatedAt: new Date() } }
      );

      if (result.matchedCount === 0) {
        throw new NotFoundError("Database not found");
      }

      repo.delCachedData();
      return result;
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      throw new InternalServerError("Failed to update database DNS");
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
    addBackupRecord,
    getBackupRecords,
    deleteBackupRecord,
    deleteById,
    getByServerId,
    countByServerId,
    addNode,
    removeNode,
    updateNodeStatus,
    updateDNS,
  };
}
