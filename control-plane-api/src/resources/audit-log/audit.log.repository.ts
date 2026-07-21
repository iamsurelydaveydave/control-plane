import { ObjectId } from "mongodb";
import {
  modelAuditLog,
  TAuditLog,
  TAuditLogInput,
  TAuditAction,
  TAuditResource,
  TAuditStats,
  TComplianceReport,
  TComplianceReportType,
  TExportParams,
} from "./audit.log.model";
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
        // Primary query patterns
        { key: { createdAt: -1 } },
        { key: { userId: 1, createdAt: -1 } },
        { key: { resource: 1, resourceId: 1, createdAt: -1 } },
        { key: { action: 1, createdAt: -1 } },
        // For compliance/export queries
        { key: { success: 1, createdAt: -1 } },
        { key: { userEmail: 1, createdAt: -1 } },
        // Compound index for filtered exports
        { key: { action: 1, resource: 1, createdAt: -1 } },
        // TTL index for data retention (configurable via separate method)
        // Note: TTL index created separately via setRetentionPolicy
      ]);
    } catch (error) {
      logger.log({
        level: "error",
        message: `Failed to create audit log indexes: ${error}`,
      });
    }
  }

  async function add(value: TAuditLogInput) {
    try {
      const auditLog = modelAuditLog(value);
      const res = await repo.collection.insertOne(auditLog as any);
      // Don't invalidate cache for audit logs - they're append-only
      // But we do need to clear stats cache since counts changed
      repo.delCache(makeCacheKey(namespace_collection, { tag: "stats" })).catch(() => {});
      return res.insertedId;
    } catch (error: any) {
      logger.log({ level: "error", message: `Failed to create audit log: ${error}` });
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
    success,
    search,
  }: {
    page?: number;
    limit?: number;
    userId?: string;
    action?: TAuditAction;
    resource?: TAuditResource;
    resourceId?: string;
    startDate?: Date;
    endDate?: Date;
    success?: boolean;
    search?: string;
  } = {}) {
    const pageIndex = page > 0 ? page - 1 : 0;

    const query: Record<string, any> = {};

    if (userId) {
      try {
        query.userId = new ObjectId(userId);
      } catch {
        throw new BadRequestError("Invalid user ID format");
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

    if (typeof success === "boolean") {
      query.success = success;
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = startDate;
      if (endDate) query.createdAt.$lte = endDate;
    }

    if (search) {
      query.$or = [
        { userEmail: { $regex: search, $options: "i" } },
        { resourceName: { $regex: search, $options: "i" } },
        { resourceId: { $regex: search, $options: "i" } },
      ];
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
      success: success?.toString() ?? "",
      search: search ?? "",
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
          { $sort: { createdAt: -1 } },
          { $skip: pageIndex * limit },
          { $limit: limit },
        ])
        .toArray();

      const length = await repo.collection.countDocuments(query);
      const data = paginate(items, pageIndex, limit, length);

      // Short TTL for audit logs as they're frequently updated
      repo.setCache(cacheKey, data, 30).catch((err) => {
        logger.log({
          level: "error",
          message: `Failed to set cache for audit logs getAll: ${err.message}`,
        });
      });

      return data;
    } catch (error) {
      logger.log({ level: "error", message: `Failed to get audit logs: ${error}` });
      throw new InternalServerError("Failed to get audit logs");
    }
  }

  /**
   * Get all logs for export (no pagination, returns cursor for streaming)
   */
  async function getForExport({
    startDate,
    endDate,
    filters,
  }: {
    startDate: Date;
    endDate: Date;
    filters?: TExportParams["filters"];
  }): Promise<TAuditLog[]> {
    const query: Record<string, any> = {
      createdAt: { $gte: startDate, $lte: endDate },
    };

    if (filters?.userId) {
      try {
        query.userId = new ObjectId(filters.userId);
      } catch {
        throw new BadRequestError("Invalid user ID format");
      }
    }

    if (filters?.action) {
      query.action = filters.action;
    }

    if (filters?.resource) {
      query.resource = filters.resource;
    }

    if (typeof filters?.success === "boolean") {
      query.success = filters.success;
    }

    try {
      const items = await repo.collection
        .find(query)
        .sort({ createdAt: -1 })
        .limit(50000) // Safety limit
        .toArray();

      return items as TAuditLog[];
    } catch (error) {
      logger.log({ level: "error", message: `Failed to get audit logs for export: ${error}` });
      throw new InternalServerError("Failed to get audit logs for export");
    }
  }

  /**
   * Get audit statistics
   */
  async function getStats({
    startDate,
    endDate,
  }: {
    startDate?: Date;
    endDate?: Date;
  } = {}): Promise<TAuditStats> {
    const cacheKey = makeCacheKey(namespace_collection, {
      startDate: startDate?.toISOString() ?? "",
      endDate: endDate?.toISOString() ?? "",
      tag: "stats",
    });

    try {
      const cached = await repo.getCache<TAuditStats>(cacheKey);
      if (cached) return cached;

      const matchStage: Record<string, any> = {};
      if (startDate || endDate) {
        matchStage.createdAt = {};
        if (startDate) matchStage.createdAt.$gte = startDate;
        if (endDate) matchStage.createdAt.$lte = endDate;
      }

      const [
        totalLogs,
        actionCounts,
        resourceCounts,
        dailyCounts,
        failedCount,
        topUsers,
      ] = await Promise.all([
        // Total count
        repo.collection.countDocuments(matchStage),

        // Logs by action
        repo.collection
          .aggregate([
            { $match: matchStage },
            { $group: { _id: "$action", count: { $sum: 1 } } },
          ])
          .toArray(),

        // Logs by resource
        repo.collection
          .aggregate([
            { $match: matchStage },
            { $group: { _id: "$resource", count: { $sum: 1 } } },
          ])
          .toArray(),

        // Logs by day (last 30 days)
        repo.collection
          .aggregate([
            {
              $match: {
                ...matchStage,
                createdAt: {
                  $gte: startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                  ...(endDate ? { $lte: endDate } : {}),
                },
              },
            },
            {
              $group: {
                _id: {
                  $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
                },
                count: { $sum: 1 },
              },
            },
            { $sort: { _id: 1 } },
          ])
          .toArray(),

        // Failed actions count
        repo.collection.countDocuments({ ...matchStage, success: false }),

        // Top users by action count
        repo.collection
          .aggregate([
            { $match: { ...matchStage, userEmail: { $exists: true, $ne: null } } },
            {
              $group: {
                _id: "$userEmail",
                count: { $sum: 1 },
              },
            },
            { $sort: { count: -1 } },
            { $limit: 10 },
          ])
          .toArray(),
      ]);

      const stats: TAuditStats = {
        totalLogs,
        logsByAction: actionCounts.reduce(
          (acc, item) => {
            acc[item._id as string] = item.count;
            return acc;
          },
          {} as Record<string, number>
        ),
        logsByResource: resourceCounts.reduce(
          (acc, item) => {
            acc[item._id as string] = item.count;
            return acc;
          },
          {} as Record<string, number>
        ),
        logsByDay: dailyCounts.map((item) => ({
          date: item._id as string,
          count: item.count,
        })),
        failureRate: totalLogs > 0 ? (failedCount / totalLogs) * 100 : 0,
        topUsers: topUsers.map((item) => ({
          email: item._id as string,
          count: item.count,
        })),
      };

      // Cache for 5 minutes
      repo.setCache(cacheKey, stats, 300).catch(() => {});

      return stats;
    } catch (error) {
      logger.log({ level: "error", message: `Failed to get audit stats: ${error}` });
      throw new InternalServerError("Failed to get audit statistics");
    }
  }

  /**
   * Get data for compliance report
   */
  async function getComplianceData({
    startDate,
    endDate,
    type,
  }: {
    startDate: Date;
    endDate: Date;
    type: TComplianceReportType;
  }): Promise<TComplianceReport> {
    const cacheKey = makeCacheKey(namespace_collection, {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      type,
      tag: "compliance",
    });

    try {
      const cached = await repo.getCache<TComplianceReport>(cacheKey);
      if (cached) return cached;

      const matchStage = {
        createdAt: { $gte: startDate, $lte: endDate },
      };

      const [
        totalActions,
        uniqueUsersResult,
        failedActions,
        userActivity,
        failedLogins,
        permissionChanges,
        apiTokenActivity,
        appStats,
        databaseStats,
        userStats,
      ] = await Promise.all([
        // Total actions
        repo.collection.countDocuments(matchStage),

        // Unique users
        repo.collection.distinct("userId", matchStage),

        // Failed actions
        repo.collection.countDocuments({ ...matchStage, success: false }),

        // User activity
        repo.collection
          .aggregate([
            { $match: { ...matchStage, userEmail: { $exists: true } } },
            {
              $group: {
                _id: { userId: "$userId", email: "$userEmail" },
                actionCount: { $sum: 1 },
                lastActivity: { $max: "$createdAt" },
              },
            },
            { $sort: { actionCount: -1 } },
            { $limit: 100 },
          ])
          .toArray(),

        // Failed logins
        repo.collection
          .find({
            ...matchStage,
            action: "login_failed",
          })
          .sort({ createdAt: -1 })
          .limit(100)
          .toArray(),

        // Permission changes
        repo.collection
          .find({
            ...matchStage,
            action: { $in: ["permission_change", "role_change"] },
          })
          .sort({ createdAt: -1 })
          .limit(100)
          .toArray(),

        // API token activity
        repo.collection
          .find({
            ...matchStage,
            action: { $in: ["api_token_create", "api_token_revoke"] },
          })
          .sort({ createdAt: -1 })
          .limit(100)
          .toArray(),

        // App stats
        repo.collection
          .aggregate([
            { $match: { ...matchStage, resource: "app" } },
            {
              $group: {
                _id: "$action",
                count: { $sum: 1 },
              },
            },
          ])
          .toArray(),

        // Database stats
        repo.collection
          .aggregate([
            { $match: { ...matchStage, resource: "database" } },
            {
              $group: {
                _id: "$action",
                count: { $sum: 1 },
              },
            },
          ])
          .toArray(),

        // User stats
        repo.collection
          .aggregate([
            { $match: { ...matchStage, resource: "user" } },
            {
              $group: {
                _id: "$action",
                count: { $sum: 1 },
              },
            },
          ])
          .toArray(),
      ]);

      const appStatMap = appStats.reduce(
        (acc, s) => {
          acc[s._id as string] = s.count;
          return acc;
        },
        {} as Record<string, number>
      );

      const dbStatMap = databaseStats.reduce(
        (acc, s) => {
          acc[s._id as string] = s.count;
          return acc;
        },
        {} as Record<string, number>
      );

      const userStatMap = userStats.reduce(
        (acc, s) => {
          acc[s._id as string] = s.count;
          return acc;
        },
        {} as Record<string, number>
      );

      const securityEventsCount =
        failedLogins.length + permissionChanges.length + apiTokenActivity.length;

      const report: TComplianceReport = {
        generatedAt: new Date(),
        period: { start: startDate, end: endDate },
        type,
        summary: {
          totalActions,
          uniqueUsers: uniqueUsersResult.length,
          failedActions,
          securityEvents: securityEventsCount,
        },
        userActivity: userActivity.map((u) => ({
          userId: String(u._id.userId),
          email: u._id.email,
          actionCount: u.actionCount,
          lastActivity: u.lastActivity,
        })),
        securityEvents: {
          failedLogins: failedLogins as TAuditLog[],
          permissionChanges: permissionChanges as TAuditLog[],
          apiTokenActivity: apiTokenActivity as TAuditLog[],
        },
        resourceChanges: {
          apps: {
            created: appStatMap["create"] || 0,
            deleted: appStatMap["delete"] || 0,
            deployed: appStatMap["deploy"] || 0,
          },
          databases: {
            created: dbStatMap["create"] || 0,
            deleted: dbStatMap["delete"] || 0,
            backed_up: dbStatMap["backup"] || 0,
          },
          users: {
            created: userStatMap["create"] || 0,
            deleted: userStatMap["delete"] || 0,
            permission_changes: (userStatMap["permission_change"] || 0) + (userStatMap["role_change"] || 0),
          },
        },
      };

      // Cache for 10 minutes
      repo.setCache(cacheKey, report, 600).catch(() => {});

      return report;
    } catch (error) {
      logger.log({ level: "error", message: `Failed to generate compliance report: ${error}` });
      throw new InternalServerError("Failed to generate compliance report");
    }
  }

  /**
   * Delete old audit logs based on retention policy
   * Returns the number of deleted documents
   */
  async function enforceRetentionPolicy(retentionDays: number): Promise<number> {
    if (retentionDays < 1) {
      throw new BadRequestError("Retention days must be at least 1");
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    try {
      const result = await repo.collection.deleteMany({
        createdAt: { $lt: cutoffDate },
      });

      logger.log({
        level: "info",
        message: `Retention policy enforced: deleted ${result.deletedCount} audit logs older than ${retentionDays} days`,
      });

      // Clear all caches since data changed significantly
      repo.delCachedData();

      return result.deletedCount;
    } catch (error) {
      logger.log({ level: "error", message: `Failed to enforce retention policy: ${error}` });
      throw new InternalServerError("Failed to enforce retention policy");
    }
  }

  /**
   * Get the count of logs that would be deleted by retention policy
   */
  async function getRetentionPreview(retentionDays: number): Promise<number> {
    if (retentionDays < 1) {
      throw new BadRequestError("Retention days must be at least 1");
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    try {
      return await repo.collection.countDocuments({
        createdAt: { $lt: cutoffDate },
      });
    } catch (error) {
      logger.log({ level: "error", message: `Failed to preview retention: ${error}` });
      throw new InternalServerError("Failed to preview retention policy");
    }
  }

  return {
    createIndexes,
    add,
    getAll,
    getForExport,
    getStats,
    getComplianceData,
    enforceRetentionPolicy,
    getRetentionPreview,
  };
}
