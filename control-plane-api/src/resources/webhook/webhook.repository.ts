import { ObjectId } from "mongodb";
import { useRepo } from "../../utils/repo";
import { makeCacheKey } from "../../utils/make-cache-key";
import { paginate, TPaginated } from "../../utils/paginate";
import { BadRequestError, NotFoundError } from "../../utils/error";
import { TWebhook, TWebhookEvent, TWebhookStatus, TWebhookUpdate } from "./webhook.model";

const namespace_collection = "cp_webhooks";

export function useWebhookRepo() {
  const repo = useRepo(namespace_collection);
  /**
   * Create indexes for webhook collection
   */
  async function createIndexes() {
    try {
      await repo.collection.createIndexes([
        { key: { enabled: 1 } },
        { key: { type: 1 } },
        { key: { events: 1 } },
        { key: { createdAt: -1 } },
        { key: { enabled: 1, events: 1 } }, // For getByEvent query
        { key: { name: 1 }, unique: true },
      ]);
    } catch (error) {
      throw new BadRequestError("Failed to create webhook indexes.");
    }
  }

  /**
   * Add a new webhook
   */
  async function add(data: Omit<TWebhook, "_id">): Promise<string> {
    const result = await repo.collection.insertOne(data as any);
    repo.delCachedData();
    return result.insertedId.toString();
  }

  /**
   * Get all webhooks with optional filters
   */
  async function getAll(options: {
    page?: number;
    type?: string;
    enabled?: boolean;
  } = {}): Promise<TPaginated<TWebhook> & { total: number }> {
    const { page = 1, type, enabled } = options;
    const limit = 20;

    const cacheKey = makeCacheKey(namespace_collection, {
      page,
      type: type || "",
      enabled: enabled !== undefined ? String(enabled) : "",
      tag: "getAll",
    });
    const cached = await repo.getCache<TPaginated<TWebhook> & { total: number }>(cacheKey);
    if (cached) return cached;

    const query: Record<string, any> = {};
    if (type) query.type = type;
    if (enabled !== undefined) query.enabled = enabled;

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

    const paginated = paginate(items as TWebhook[], page, limit, total);
    const result = { ...paginated, total };
    repo.setCache(cacheKey, result, 300); // 5 min cache
    return result;
  }

  /**
   * Get webhook by ID
   */
  async function getById(id: string): Promise<TWebhook> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid webhook ID format.");
    }

    const cacheKey = makeCacheKey(namespace_collection, { id, tag: "by-id" });
    const cached = await repo.getCache<TWebhook>(cacheKey);
    if (cached) return cached;

    const webhook = await repo.collection.findOne({ _id: oid });
    if (!webhook) throw new NotFoundError("Webhook not found.");

    repo.setCache(cacheKey, webhook, 300);
    return webhook as TWebhook;
  }

  /**
   * Get all webhooks subscribed to a specific event
   */
  async function getByEvent(event: TWebhookEvent): Promise<TWebhook[]> {
    const cacheKey = makeCacheKey(namespace_collection, { event, tag: "by-event" });
    const cached = await repo.getCache<TWebhook[]>(cacheKey);
    if (cached) return cached;

    const webhooks = await repo.collection
      .find({
        enabled: true,
        events: event,
      })
      .toArray();

    repo.setCache(cacheKey, webhooks, 60); // 1 min cache - shorter for event lookups
    return webhooks as TWebhook[];
  }

  /**
   * Update webhook by ID
   */
  async function updateById(id: string, data: TWebhookUpdate): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid webhook ID format.");
    }

    const updateData = {
      ...data,
      updatedAt: new Date(),
    };

    const result = await repo.collection.updateOne(
      { _id: oid },
      { $set: updateData }
    );

    if (!result.matchedCount) throw new NotFoundError("Webhook not found.");
    repo.delCachedData();
  }

  /**
   * Update last trigger information
   */
  async function updateLastTrigger(
    id: string,
    status: TWebhookStatus,
    error?: string
  ): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid webhook ID format.");
    }

    const updateData: Partial<TWebhook> = {
      lastTriggeredAt: new Date(),
      lastStatus: status,
      updatedAt: new Date(),
    };

    if (error) {
      updateData.lastError = error;
    } else {
      // Clear previous error on success
      updateData.lastError = undefined;
    }

    await repo.collection.updateOne(
      { _id: oid },
      { $set: updateData }
    );

    // Don't throw if webhook not found - it may have been deleted
    repo.delCachedData();
  }

  /**
   * Delete webhook by ID
   */
  async function deleteById(id: string): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid webhook ID format.");
    }

    const result = await repo.collection.deleteOne({ _id: oid });
    if (!result.deletedCount) throw new NotFoundError("Webhook not found.");
    repo.delCachedData();
  }

  /**
   * Check if webhook name exists
   */
  async function getByName(name: string): Promise<TWebhook | null> {
    const webhook = await repo.collection.findOne({ name });
    return webhook as TWebhook | null;
  }

  return {
    createIndexes,
    add,
    getAll,
    getById,
    getByEvent,
    updateById,
    updateLastTrigger,
    deleteById,
    getByName,
  };
}
