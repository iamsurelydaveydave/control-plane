import { ObjectId } from "mongodb";
import { modelAuditLog, TAuditLog, TAuditAction, TAuditResource } from "./audit.log.model";
import {
  BadRequestError,
  InternalServerError,
  logger,
  makeCacheKey,
  paginate,
  useRepo,
} from "../../utils";

export function useAuditLogRepo() {
  const namespace_collection = "cp_audit_logs";
  const repo = useRepo(namespace_collection);

  async function createIndexes() {
    try {
      await repo.collection.createIndexes([
        { key: { timestamp: -1 } },
        { key: { userId: 1, timestamp: -1 } },
        { key: { resource: 1, resourceId: 1, timestamp: -1 } },
        { key: { action: 1, timestamp: -1 } },
      ]);
    } catch (error) {
      logger.log({
        level: "error",
        message: `Failed to create audit log indexes: ${error}`,
      });
    }
  }

  async function add(value: Partial<TAuditLog>) {
    try {
      const auditLog = modelAuditLog(value);
      const res = await repo.collection.insertOne(auditLog);
      // Don't invalidate cache for audit logs - they're append-only
      return res.insertedId;
    } catch (error: any) {
      logger.log({ level: "error", message: `${error}` });
      throw new InternalServerError("Failed to create audit log");
    }
  }

  async function getAll({
    page = 1,
    limit = 50,
    userId,
    action,
    resource,
    resourceId,
    startDate,
    endDate,
  }: {
    page?: number;
    limit?: number;
    userId?: string;
    action?: TAuditAction;
    resource?: TAuditResource;
    resourceId?: string;
    startDate?: Date;
    endDate?: Date;
  } = {}) {
    page = page > 0 ? page - 1 : 0;

    const query: Record<string, any> = {};

    if (userId) {
      try {
        query.userId = new ObjectId(userId);
      } catch {
        throw new BadRequestError("Invalid user ID");
      }
    }

    if (action) {
      query.action = action;
    }

    if (resource) {
      query.resource = resource;
    }

    if (resourceId) {
      query.resourceId = resourceId;
    }

    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = startDate;
      if (endDate) query.timestamp.$lte = endDate;
    }

    const cacheKey = makeCacheKey(namespace_collection, {
      page,
      limit,
      userId: userId ?? "",
      action: action ?? "",
      resource: resource ?? "",
      resourceId: resourceId ?? "",
      startDate: startDate?.toISOString() ?? "",
      endDate: endDate?.toISOString() ?? "",
      tag: "getAll",
    });

    try {
      const cached = await repo.getCache<Record<string, any>>(cacheKey);
      if (cached) {
        return cached;
      }

      const items = await repo.collection
        .aggregate([
          { $match: query },
          { $sort: { timestamp: -1 } },
          { $skip: page * limit },
          { $limit: limit },
        ])
        .toArray();

      const length = await repo.collection.countDocuments(query);
      const data = paginate(items, page, limit, length);

      // Short TTL for audit logs as they're frequently updated
      repo.setCache(cacheKey, data, 30).catch((err) => {
        logger.log({
          level: "error",
          message: `Failed to set cache for audit logs getAll: ${err.message}`,
        });
      });

      return data;
    } catch (error) {
      logger.log({ level: "error", message: `${error}` });
      throw new InternalServerError("Failed to get audit logs");
    }
  }

  return {
    createIndexes,
    add,
    getAll,
  };
}
