import { ObjectId } from "mongodb";
import { useRepo } from "../../utils/repo";
import { makeCacheKey } from "../../utils/make-cache-key";
import { paginate, TPaginated } from "../../utils/paginate";
import { BadRequestError, NotFoundError } from "../../utils/error";
import { TAlert, TAlertStatus, TAlertSeverity, TAlertSource } from "./alert.model";

const namespace_collection = "cp_alerts";

export function useAlertRepo() {
  const repo = useRepo(namespace_collection);
  /**
   * Create indexes for alert collection
   */
  async function createIndexes() {
    try {
      await repo.collection.createIndexes([
        { key: { severity: 1 } },
        { key: { status: 1 } },
        { key: { source: 1 } },
        { key: { createdAt: -1 } },
        { key: { status: 1, severity: 1 } },
        { key: { source: 1, sourceId: 1, status: 1, createdAt: -1 } },
        { key: { status: 1, createdAt: -1 } },
      ]);
    } catch (error) {
      throw new BadRequestError("Failed to create alert indexes.");
    }
  }

  /**
   * Add a new alert
   */
  async function add(data: Omit<TAlert, "_id">): Promise<string> {
    const result = await repo.collection.insertOne(data as any);
    repo.delCachedData();
    return result.insertedId.toString();
  }

  /**
   * Get all alerts with optional filters
   */
  async function getAll(options: {
    page?: number;
    status?: TAlertStatus;
    severity?: TAlertSeverity;
    source?: TAlertSource;
  } = {}): Promise<TPaginated<TAlert> & { total: number }> {
    const { page = 1, status, severity, source } = options;
    const limit = 20;

    const cacheKey = makeCacheKey(namespace_collection, {
      page,
      status: status || "",
      severity: severity || "",
      source: source || "",
      tag: "getAll",
    });
    const cached = await repo.getCache<TPaginated<TAlert> & { total: number }>(cacheKey);
    if (cached) return cached;

    const query: Record<string, any> = {};
    if (status) query.status = status;
    if (severity) query.severity = severity;
    if (source) query.source = source;

    const skip = (page > 0 ? page - 1 : 0) * limit;

    const [items, total] = await Promise.all([
      repo.collection
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      repo.collection.countDocuments(query),
    ]);

    const paginated = paginate(items as TAlert[], page, limit, total);
    const result = { ...paginated, total };
    repo.setCache(cacheKey, result, 60); // 1 min cache
    return result;
  }

  /**
   * Get alert by ID
   */
  async function getById(id: string): Promise<TAlert> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid alert ID format.");
    }

    const cacheKey = makeCacheKey(namespace_collection, { id, tag: "by-id" });
    const cached = await repo.getCache<TAlert>(cacheKey);
    if (cached) return cached;

    const alert = await repo.collection.findOne({ _id: oid });
    if (!alert) throw new NotFoundError("Alert not found.");

    repo.setCache(cacheKey, alert, 60);
    return alert as TAlert;
  }

  /**
   * Acknowledge an alert
   */
  async function acknowledge(id: string, userId?: string): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid alert ID format.");
    }

    const now = new Date();
    const update: Partial<TAlert> = {
      status: "acknowledged",
      acknowledgedAt: now,
      updatedAt: now,
    };
    if (userId) {
      update.acknowledgedBy = userId;
    }

    const result = await repo.collection.updateOne(
      { _id: oid },
      { $set: update }
    );

    if (!result.matchedCount) throw new NotFoundError("Alert not found.");
    repo.delCachedData();
  }

  /**
   * Resolve an alert
   */
  async function resolve(id: string): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid alert ID format.");
    }

    const now = new Date();
    const result = await repo.collection.updateOne(
      { _id: oid },
      {
        $set: {
          status: "resolved",
          resolvedAt: now,
          updatedAt: now,
        },
      }
    );

    if (!result.matchedCount) throw new NotFoundError("Alert not found.");
    repo.delCachedData();
  }

  /**
   * Delete alert by ID
   */
  async function deleteById(id: string): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid alert ID format.");
    }

    const result = await repo.collection.deleteOne({ _id: oid });
    if (!result.deletedCount) throw new NotFoundError("Alert not found.");
    repo.delCachedData();
  }

  /**
   * Get count of active alerts
   */
  async function getActiveCount(): Promise<{ total: number; bySource: Record<string, number>; bySeverity: Record<string, number> }> {
    const cacheKey = makeCacheKey(namespace_collection, { tag: "active-count" });
    const cached = await repo.getCache<{ total: number; bySource: Record<string, number>; bySeverity: Record<string, number> }>(cacheKey);
    if (cached) return cached;

    const [total, bySourceResult, bySeverityResult] = await Promise.all([
      repo.collection.countDocuments({ status: "active" }),
      repo.collection.aggregate([
        { $match: { status: "active" } },
        { $group: { _id: "$source", count: { $sum: 1 } } },
      ]).toArray(),
      repo.collection.aggregate([
        { $match: { status: "active" } },
        { $group: { _id: "$severity", count: { $sum: 1 } } },
      ]).toArray(),
    ]);

    const bySource: Record<string, number> = {};
    for (const item of bySourceResult) {
      bySource[item._id as string] = item.count;
    }

    const bySeverity: Record<string, number> = {};
    for (const item of bySeverityResult) {
      bySeverity[item._id as string] = item.count;
    }

    const result = { total, bySource, bySeverity };
    repo.setCache(cacheKey, result, 30); // 30 sec cache
    return result;
  }

  /**
   * Get recent alerts for a specific source and sourceId (for deduplication)
   */
  async function getRecentBySource(
    source: TAlertSource,
    sourceId: string | undefined,
    hours: number = 1
  ): Promise<TAlert[]> {
    const cacheKey = makeCacheKey(namespace_collection, {
      source,
      sourceId: sourceId || "",
      hours,
      tag: "recent-by-source",
    });
    const cached = await repo.getCache<TAlert[]>(cacheKey);
    if (cached) return cached;

    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - hours);

    const query: Record<string, any> = {
      source,
      status: { $in: ["active", "acknowledged"] },
      createdAt: { $gte: cutoff },
    };
    if (sourceId) query.sourceId = sourceId;

    const alerts = await repo.collection
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();

    repo.setCache(cacheKey, alerts, 60); // 1 min cache
    return alerts as TAlert[];
  }

  /**
   * Auto-resolve alerts by source and sourceId
   */
  async function autoResolve(source: TAlertSource, sourceId?: string): Promise<number> {
    const query: Record<string, any> = {
      source,
      status: { $in: ["active", "acknowledged"] },
    };
    if (sourceId) query.sourceId = sourceId;

    const now = new Date();
    const result = await repo.collection.updateMany(query, {
      $set: {
        status: "resolved",
        resolvedAt: now,
        updatedAt: now,
      },
    });

    if (result.modifiedCount > 0) {
      repo.delCachedData();
    }

    return result.modifiedCount;
  }

  /**
   * Bulk auto-resolve alerts for multiple sourceIds
   */
  async function autoResolveMany(source: TAlertSource, sourceIds: string[]): Promise<number> {
    if (sourceIds.length === 0) return 0;

    const now = new Date();
    const result = await repo.collection.updateMany(
      {
        source,
        sourceId: { $in: sourceIds },
        status: { $in: ["active", "acknowledged"] },
      },
      {
        $set: {
          status: "resolved",
          resolvedAt: now,
          updatedAt: now,
        },
      }
    );

    if (result.modifiedCount > 0) {
      repo.delCachedData();
    }

    return result.modifiedCount;
  }

  return {
    createIndexes,
    add,
    getAll,
    getById,
    acknowledge,
    resolve,
    deleteById,
    getActiveCount,
    getRecentBySource,
    autoResolve,
    autoResolveMany,
  };
}
