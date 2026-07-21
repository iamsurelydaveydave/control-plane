import { ObjectId } from "mongodb";
import { useRepo } from "../../utils/repo";
import { makeCacheKey } from "../../utils/make-cache-key";
import { paginate } from "../../utils/paginate";
import { BadRequestError, NotFoundError, ConflictError } from "../../utils/error";
import {
  TAddon,
  TAddonInput,
  TAddonStatus,
  TAddonType,
  TAddonConnectionInfo,
  modelAddon,
} from "./addon.model";

const namespace_collection = "cp_addons";

// =============================================================================
// List item type (without sensitive data)
// =============================================================================

export type TAddonListItem = Omit<TAddon, "connectionInfo"> & {
  connectionInfo?: Omit<TAddonConnectionInfo, "password">;
};

// =============================================================================
// Repository
// =============================================================================

export function useAddonRepo() {
  const repo = useRepo(namespace_collection);
  /**
   * Create indexes for the addons collection.
   * Indexes cover: name (unique per org), type, status, namespace, organizationId
   */
  async function createIndexes() {
    try {
      await repo.collection.createIndexes([
        { key: { name: 1, organizationId: 1 }, unique: true },
        { key: { releaseName: 1 }, unique: true },
        { key: { type: 1 } },
        { key: { status: 1 } },
        { key: { namespace: 1 } },
        { key: { organizationId: 1 } },
        { key: { type: 1, status: 1 } },
        { key: { name: "text" } },
      ]);
    } catch (error) {
      throw new BadRequestError("Failed to create addon indexes.");
    }
  }

  /**
   * Add a new addon.
   * Throws ConflictError if name already exists within the same organization.
   */
  async function add(data: Partial<TAddon> | TAddonInput): Promise<string> {
    // Model validates and normalizes data
    const addon = modelAddon(data);

    try {
      const result = await repo.collection.insertOne(addon as any);
      repo.delCachedData();
      return result.insertedId.toString();
    } catch (error: any) {
      // Handle duplicate key error
      if (error.code === 11000) {
        if (error.keyPattern?.releaseName) {
          // Extremely unlikely collision — retry with new suffix
          throw new ConflictError("Release name collision. Please try again.");
        }
        throw new ConflictError(
          `Addon with name "${addon.name}" already exists.`
        );
      }
      throw error;
    }
  }

  /**
   * Get addon by ID.
   * Returns full addon including connectionInfo.
   */
  async function getById(id: string): Promise<TAddon | null> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid addon ID format.");
    }

    const cacheKey = makeCacheKey(namespace_collection, { id, tag: "by-id" });
    const cached = await repo.getCache<TAddon>(cacheKey);
    if (cached) {
      // Convert date strings back to Date objects
      return {
        ...cached,
        createdAt: new Date(cached.createdAt),
        updatedAt: new Date(cached.updatedAt),
      };
    }

    const addon = await repo.collection.findOne({ _id: oid });
    if (!addon) return null;

    repo.setCache(cacheKey, addon, 600);
    return addon as unknown as TAddon;
  }

  /**
   * Get addon by release name.
   */
  async function getByReleaseName(releaseName: string): Promise<TAddon | null> {
    const cacheKey = makeCacheKey(namespace_collection, { releaseName, tag: "by-release" });
    const cached = await repo.getCache<TAddon>(cacheKey);
    if (cached) {
      return {
        ...cached,
        createdAt: new Date(cached.createdAt),
        updatedAt: new Date(cached.updatedAt),
      };
    }

    const addon = await repo.collection.findOne({ releaseName });
    if (!addon) return null;

    repo.setCache(cacheKey, addon, 600);
    return addon as unknown as TAddon;
  }

  /**
   * Get addon by name within an organization.
   */
  async function getByName(name: string, organizationId?: string): Promise<TAddon | null> {
    let orgOid: ObjectId | undefined;
    if (organizationId) {
      try {
        orgOid = new ObjectId(organizationId);
      } catch {
        throw new BadRequestError("Invalid organizationId format.");
      }
    }

    const cacheKey = makeCacheKey(namespace_collection, { name, organizationId: organizationId || "", tag: "by-name" });
    const cached = await repo.getCache<TAddon>(cacheKey);
    if (cached) {
      return {
        ...cached,
        createdAt: new Date(cached.createdAt),
        updatedAt: new Date(cached.updatedAt),
      };
    }

    const query: Record<string, any> = { name };
    if (orgOid) {
      query.organizationId = orgOid;
    } else {
      query.organizationId = { $exists: false };
    }

    const addon = await repo.collection.findOne(query);
    if (!addon) return null;

    repo.setCache(cacheKey, addon, 600);
    return addon as unknown as TAddon;
  }

  /**
   * Get all addons with pagination and filtering.
   * Masks connection passwords in list results.
   */
  async function getAll({
    page = 1,
    limit = 20,
    type,
    status,
    namespace,
    organizationId,
    search,
  }: {
    page?: number;
    limit?: number;
    type?: TAddonType;
    status?: TAddonStatus;
    namespace?: string;
    organizationId?: string;
    search?: string;
  } = {}) {
    const cacheKey = makeCacheKey(namespace_collection, {
      page,
      limit,
      type: type || "",
      status: status || "",
      namespace: namespace || "",
      organizationId: organizationId || "",
      search: search || "",
      tag: "getAll",
    });

    const cached = await repo.getCache<ReturnType<typeof paginate<TAddonListItem>>>(cacheKey);
    if (cached) return cached;

    // Build query
    const query: Record<string, any> = {};
    if (type) query.type = type;
    if (status) query.status = status;
    if (namespace) query.namespace = namespace;
    if (organizationId) {
      try {
        query.organizationId = new ObjectId(organizationId);
      } catch {
        throw new BadRequestError("Invalid organizationId format.");
      }
    }
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.name = { $regex: escaped, $options: "i" };
    }

    const skip = (page > 0 ? page - 1 : 0) * limit;

    // Project out password from connectionInfo for list
    const projection = {
      "connectionInfo.password": 0,
    };

    const [items, total] = await Promise.all([
      repo.collection
        .find(query)
        .project(projection)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      repo.collection.countDocuments(query),
    ]);

    const result = paginate(items as unknown as TAddonListItem[], page, limit, total);
    repo.setCache(cacheKey, result, 600);
    return result;
  }

  /**
   * Update addon by ID.
   */
  async function updateById(id: string, data: Partial<TAddon>): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid addon ID format.");
    }

    const updateData = {
      ...data,
      updatedAt: new Date(),
    };

    const result = await repo.collection.updateOne(
      { _id: oid },
      { $set: updateData }
    );

    if (!result.matchedCount) {
      throw new NotFoundError("Addon not found.");
    }

    repo.delCachedData();
  }

  /**
   * Update addon status.
   */
  async function updateStatus(id: string, status: TAddonStatus, lastError?: string): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid addon ID format.");
    }

    const updateData: Record<string, any> = {
      status,
      updatedAt: new Date(),
    };

    if (lastError !== undefined) {
      updateData.lastError = lastError;
    } else if (status !== "failed") {
      // Clear error when status is not failed
      updateData.lastError = null;
    }

    const result = await repo.collection.updateOne(
      { _id: oid },
      { $set: updateData }
    );

    if (!result.matchedCount) {
      throw new NotFoundError("Addon not found.");
    }

    repo.delCachedData();
  }

  /**
   * Update connection info for an addon.
   */
  async function updateConnectionInfo(id: string, connectionInfo: TAddonConnectionInfo): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid addon ID format.");
    }

    const result = await repo.collection.updateOne(
      { _id: oid },
      {
        $set: {
          connectionInfo,
          updatedAt: new Date(),
        },
      }
    );

    if (!result.matchedCount) {
      throw new NotFoundError("Addon not found.");
    }

    repo.delCachedData();
  }

  /**
   * Delete addon by ID.
   */
  async function deleteById(id: string): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid addon ID format.");
    }

    const result = await repo.collection.deleteOne({ _id: oid });

    if (!result.deletedCount) {
      throw new NotFoundError("Addon not found.");
    }

    repo.delCachedData();
  }

  /**
   * Get addons by status (for scheduled status checks).
   */
  async function getByStatus(status: TAddonStatus): Promise<TAddon[]> {
    const addons = await repo.collection.find({ status }).toArray();
    return addons as unknown as TAddon[];
  }

  /**
   * Get addons by namespace.
   */
  async function getByNamespace(namespace: string): Promise<TAddon[]> {
    const cacheKey = makeCacheKey(namespace_collection, { namespace, tag: "by-namespace" });
    const cached = await repo.getCache<TAddon[]>(cacheKey);
    if (cached) return cached;

    const addons = await repo.collection.find({ namespace }).toArray();
    repo.setCache(cacheKey, addons, 300);
    return addons as unknown as TAddon[];
  }

  /**
   * Count addons by organization.
   */
  async function countByOrganization(organizationId: string): Promise<number> {
    let orgOid: ObjectId;
    try {
      orgOid = new ObjectId(organizationId);
    } catch {
      throw new BadRequestError("Invalid organizationId format.");
    }

    const cacheKey = makeCacheKey(namespace_collection, { organizationId, tag: "count-by-org" });
    const cached = await repo.getCache<number>(cacheKey);
    if (cached !== null && cached !== undefined) return cached;

    const count = await repo.collection.countDocuments({ organizationId: orgOid });
    repo.setCache(cacheKey, count, 300);
    return count;
  }

  return {
    createIndexes,
    add,
    getById,
    getByReleaseName,
    getByName,
    getAll,
    updateById,
    updateStatus,
    updateConnectionInfo,
    deleteById,
    getByStatus,
    getByNamespace,
    countByOrganization,
  };
}
