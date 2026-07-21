import { ObjectId } from "mongodb";
import {
  modelScheduledTask,
  TScheduledTask,
  TScheduledTaskInput,
  TScheduledTaskUpdateInput,
  TScheduledTaskStatus,
  TTaskRunStatus,
  schemaScheduledTaskUpdate,
} from "./scheduled-task.model";
import {
  modelTaskHistory,
  TTaskHistory,
  TTaskHistoryInput,
} from "./task-history.model";
import {
  BadRequestError,
  NotFoundError,
  InternalServerError,
  logger,
  makeCacheKey,
  paginate,
  useRepo,
} from "../../utils";

// =============================================================================
// Scheduled Task Repository
// =============================================================================

export function useScheduledTaskRepo() {
  const namespace_collection = "cp_scheduled_tasks";
  const repo = useRepo(namespace_collection);

  async function createIndexes() {
    try {
      await repo.collection.createIndexes([
        { key: { status: 1 } },
        { key: { status: 1, nextRunAt: 1 } },
        { key: { type: 1 } },
        { key: { name: "text" } },
        { key: { createdAt: -1 } },
      ]);
    } catch (error) {
      logger.log({
        level: "error",
        message: `Failed to create scheduled task indexes: ${error}`,
      });
    }
  }

  async function getAll({
    page = 1,
    limit = 20,
    status,
    type,
    search,
  }: {
    page?: number;
    limit?: number;
    status?: TScheduledTaskStatus;
    type?: string;
    search?: string;
  } = {}) {
    page = page > 0 ? page - 1 : 0;

    const query: Record<string, any> = {};
    if (status) query.status = status;
    if (type) query.type = type;
    if (search) query.$text = { $search: search };

    const cacheKey = makeCacheKey(namespace_collection, {
      page,
      limit,
      status: status ?? "",
      type: type ?? "",
      search: search ?? "",
      tag: "getAll",
    });

    try {
      const cached = await repo.getCache<Record<string, any>>(cacheKey);
      if (cached) return cached;

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
          message: `Failed to set cache for scheduled tasks getAll: ${err.message}`,
        });
      });

      return data;
    } catch (error) {
      logger.log({ level: "error", message: `${error}` });
      throw new InternalServerError("Failed to get scheduled tasks");
    }
  }

  async function getById(id: string): Promise<TScheduledTask> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid scheduled task ID format");
    }

    const cacheKey = makeCacheKey(namespace_collection, { id, tag: "by-id" });

    try {
      const cached = await repo.getCache<TScheduledTask>(cacheKey);
      if (cached) return cached;

      const task = await repo.collection.findOne({ _id: oid });
      if (!task) throw new NotFoundError("Scheduled task not found");

      repo.setCache(cacheKey, task, 300).catch((err) => {
        logger.log({
          level: "error",
          message: `Failed to set cache for scheduled task by-id: ${err.message}`,
        });
      });

      return task as unknown as TScheduledTask;
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof BadRequestError) throw error;
      logger.log({ level: "error", message: `${error}` });
      throw new InternalServerError("Failed to get scheduled task");
    }
  }

  async function add(data: TScheduledTaskInput): Promise<string> {
    try {
      const task = modelScheduledTask(data);
      const res = await repo.collection.insertOne(task as any);
      repo.delCachedData();
      return res.insertedId.toString();
    } catch (error: any) {
      if (error instanceof BadRequestError) throw error;
      logger.log({ level: "error", message: `${error}` });
      throw new InternalServerError("Failed to create scheduled task");
    }
  }

  async function updateById(id: string, data: TScheduledTaskUpdateInput): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid scheduled task ID format");
    }

    const { error, value } = schemaScheduledTaskUpdate.validate(data, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      throw new BadRequestError(
        `Update validation error: ${error.details.map((d) => d.message).join(", ")}`
      );
    }

    try {
      const result = await repo.collection.updateOne(
        { _id: oid },
        { $set: { ...value, updatedAt: new Date() } }
      );

      if (!result.matchedCount) throw new NotFoundError("Scheduled task not found");
      repo.delCachedData();
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof BadRequestError) throw error;
      logger.log({ level: "error", message: `${error}` });
      throw new InternalServerError("Failed to update scheduled task");
    }
  }

  async function deleteById(id: string): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid scheduled task ID format");
    }

    try {
      const result = await repo.collection.deleteOne({ _id: oid });
      if (!result.deletedCount) throw new NotFoundError("Scheduled task not found");
      repo.delCachedData();
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof BadRequestError) throw error;
      logger.log({ level: "error", message: `${error}` });
      throw new InternalServerError("Failed to delete scheduled task");
    }
  }

  /**
   * Get all active tasks.
   */
  async function getActive(): Promise<TScheduledTask[]> {
    const cacheKey = makeCacheKey(namespace_collection, { tag: "active" });

    try {
      const cached = await repo.getCache<TScheduledTask[]>(cacheKey);
      if (cached) return cached;

      const tasks = await repo.collection
        .find({ status: "active" })
        .toArray();

      repo.setCache(cacheKey, tasks, 60).catch((err) => {
        logger.log({
          level: "error",
          message: `Failed to set cache for active tasks: ${err.message}`,
        });
      });

      return tasks as unknown as TScheduledTask[];
    } catch (error) {
      logger.log({ level: "error", message: `${error}` });
      throw new InternalServerError("Failed to get active tasks");
    }
  }

  /**
   * Get tasks that are due to run now.
   * Returns active tasks where nextRunAt <= now.
   */
  async function getDue(): Promise<TScheduledTask[]> {
    const now = new Date();

    try {
      const tasks = await repo.collection
        .find({
          status: "active",
          nextRunAt: { $lte: now },
        })
        .toArray();

      return tasks as unknown as TScheduledTask[];
    } catch (error) {
      logger.log({ level: "error", message: `${error}` });
      throw new InternalServerError("Failed to get due tasks");
    }
  }

  /**
   * Update task status (pause/resume).
   */
  async function updateStatus(id: string, status: TScheduledTaskStatus): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid scheduled task ID format");
    }

    try {
      const result = await repo.collection.updateOne(
        { _id: oid },
        { $set: { status, updatedAt: new Date() } }
      );

      if (!result.matchedCount) throw new NotFoundError("Scheduled task not found");
      repo.delCachedData();
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof BadRequestError) throw error;
      logger.log({ level: "error", message: `${error}` });
      throw new InternalServerError("Failed to update task status");
    }
  }

  /**
   * Update task after a run completes.
   */
  async function updateRunStatus(
    id: string,
    status: TTaskRunStatus,
    duration: number,
    nextRunAt: Date,
    error?: string
  ): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid scheduled task ID format");
    }

    const now = new Date();
    const updateData: Record<string, any> = {
      lastRunAt: now,
      lastRunStatus: status,
      lastRunDuration: duration,
      nextRunAt,
      updatedAt: now,
      status: "active", // Reset from "running" back to "active"
    };

    if (error) {
      updateData.lastRunError = error;
    } else {
      updateData.lastRunError = null;
    }

    const incData: Record<string, number> = { runCount: 1 };
    if (status === "failed") {
      incData.failCount = 1;
    }

    try {
      const result = await repo.collection.updateOne(
        { _id: oid },
        {
          $set: updateData,
          $inc: incData,
        }
      );

      if (!result.matchedCount) throw new NotFoundError("Scheduled task not found");
      repo.delCachedData();
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof BadRequestError) throw error;
      logger.log({ level: "error", message: `${error}` });
      throw new InternalServerError("Failed to update run status");
    }
  }

  /**
   * Mark task as running (to prevent concurrent executions).
   */
  async function markRunning(id: string): Promise<boolean> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid scheduled task ID format");
    }

    try {
      // Only update if status is "active" (prevents concurrent runs)
      const result = await repo.collection.updateOne(
        { _id: oid, status: "active" },
        { $set: { status: "running", updatedAt: new Date() } }
      );

      if (result.matchedCount > 0) {
        repo.delCachedData();
        return true;
      }
      return false;
    } catch (error) {
      logger.log({ level: "error", message: `${error}` });
      return false;
    }
  }

  /**
   * Update the next run time for a task.
   */
  async function updateNextRunAt(id: string, nextRunAt: Date): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid scheduled task ID format");
    }

    try {
      await repo.collection.updateOne(
        { _id: oid },
        { $set: { nextRunAt, updatedAt: new Date() } }
      );
      repo.delCachedData();
    } catch (error) {
      logger.log({ level: "error", message: `${error}` });
    }
  }

  return {
    createIndexes,
    getAll,
    getById,
    add,
    updateById,
    deleteById,
    getActive,
    getDue,
    updateStatus,
    updateRunStatus,
    markRunning,
    updateNextRunAt,
  };
}

// =============================================================================
// Task History Repository
// =============================================================================

export function useTaskHistoryRepo() {
  const namespace_collection = "cp_task_history";
  const repo = useRepo(namespace_collection);

  async function createIndexes() {
    try {
      await repo.collection.createIndexes([
        { key: { taskId: 1, startedAt: -1 } },
        { key: { startedAt: -1 } },
        { key: { status: 1, startedAt: -1 } },
        // TTL index - automatically delete history older than 90 days
        { key: { startedAt: 1 }, expireAfterSeconds: 90 * 24 * 60 * 60 },
      ]);
    } catch (error) {
      logger.log({
        level: "error",
        message: `Failed to create task history indexes: ${error}`,
      });
    }
  }

  async function add(data: TTaskHistoryInput): Promise<string> {
    try {
      const history = modelTaskHistory(data);
      const res = await repo.collection.insertOne(history as any);
      repo.delCachedData();
      return res.insertedId.toString();
    } catch (error: any) {
      if (error instanceof BadRequestError) throw error;
      logger.log({ level: "error", message: `${error}` });
      throw new InternalServerError("Failed to create task history");
    }
  }

  async function getByTaskId(
    taskId: string,
    { page = 1, limit = 20 }: { page?: number; limit?: number } = {}
  ) {
    let oid: ObjectId;
    try {
      oid = new ObjectId(taskId);
    } catch {
      throw new BadRequestError("Invalid task ID format");
    }

    page = page > 0 ? page - 1 : 0;

    const cacheKey = makeCacheKey(namespace_collection, {
      taskId,
      page,
      limit,
      tag: "by-task",
    });

    try {
      const cached = await repo.getCache<Record<string, any>>(cacheKey);
      if (cached) return cached;

      const query = { taskId: oid };

      const items = await repo.collection
        .aggregate([
          { $match: query },
          { $sort: { startedAt: -1 } },
          { $skip: page * limit },
          { $limit: limit },
        ])
        .toArray();

      const length = await repo.collection.countDocuments(query);
      const data = paginate(items, page, limit, length);

      // Short TTL for history as it updates frequently
      repo.setCache(cacheKey, data, 30).catch((err) => {
        logger.log({
          level: "error",
          message: `Failed to set cache for task history: ${err.message}`,
        });
      });

      return data;
    } catch (error) {
      if (error instanceof BadRequestError) throw error;
      logger.log({ level: "error", message: `${error}` });
      throw new InternalServerError("Failed to get task history");
    }
  }

  /**
   * Delete all history for a task (called when task is deleted).
   */
  async function deleteByTaskId(taskId: string): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(taskId);
    } catch {
      throw new BadRequestError("Invalid task ID format");
    }

    try {
      await repo.collection.deleteMany({ taskId: oid });
      repo.delCachedData();
    } catch (error) {
      logger.log({ level: "error", message: `${error}` });
    }
  }

  return {
    createIndexes,
    add,
    getByTaskId,
    deleteByTaskId,
  };
}
