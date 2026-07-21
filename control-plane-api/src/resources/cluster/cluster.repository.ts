import { ObjectId } from "mongodb";
import { useRepo } from "../../utils/repo";
import { makeCacheKey } from "../../utils/make-cache-key";
import { BadRequestError, NotFoundError } from "../../utils/error";
import { TCluster, TClusterStatus } from "./cluster.model";

const namespace_collection = "cp_clusters";

export function useClusterRepo() {
  const repo = useRepo(namespace_collection);
  /**
   * Create indexes for cluster collection
   */
  async function createIndexes() {
    try {
      await repo.collection.createIndexes([
        { key: { name: 1 }, unique: true },
        { key: { type: 1 } },
        { key: { status: 1 } },
      ]);
    } catch (error) {
      throw new BadRequestError("Failed to create cluster indexes.");
    }
  }

  /**
   * Get all clusters
   */
  async function getAll(): Promise<TCluster[]> {
    const cacheKey = makeCacheKey(namespace_collection, { tag: "getAll" });
    const cached = await repo.getCache<TCluster[]>(cacheKey);
    if (cached) return cached;

    const clusters = await repo.collection.find({}).toArray();
    repo.setCache(cacheKey, clusters, 300); // 5 min cache
    return clusters as TCluster[];
  }

  /**
   * Get cluster by ID
   */
  async function getById(id: string): Promise<TCluster> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid cluster ID format.");
    }

    const cacheKey = makeCacheKey(namespace_collection, { id, tag: "by-id" });
    const cached = await repo.getCache<TCluster>(cacheKey);
    if (cached) return cached;

    const cluster = await repo.collection.findOne({ _id: oid });
    if (!cluster) throw new NotFoundError("Cluster not found.");

    repo.setCache(cacheKey, cluster, 300);
    return cluster as TCluster;
  }

  /**
   * Get cluster by name
   */
  async function getByName(name: string): Promise<TCluster | null> {
    const cacheKey = makeCacheKey(namespace_collection, { name, tag: "by-name" });
    const cached = await repo.getCache<TCluster | null>(cacheKey);
    if (cached !== undefined) return cached;

    const cluster = await repo.collection.findOne({ name });
    repo.setCache(cacheKey, cluster, 300);
    return cluster as TCluster | null;
  }

  /**
   * Get the local cluster (there should only be one)
   */
  async function getLocalCluster(): Promise<TCluster | null> {
    const cacheKey = makeCacheKey(namespace_collection, { tag: "local" });
    const cached = await repo.getCache<TCluster | null>(cacheKey);
    if (cached !== undefined) return cached;

    const cluster = await repo.collection.findOne({ type: "local" });
    repo.setCache(cacheKey, cluster, 300);
    return cluster as TCluster | null;
  }

  /**
   * Add a new cluster
   */
  async function add(data: Omit<TCluster, "_id">): Promise<string> {
    const result = await repo.collection.insertOne(data as any);
    repo.delCachedData();
    return result.insertedId.toString();
  }

  /**
   * Update cluster by ID
   */
  async function updateById(id: string, data: Partial<TCluster>): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid cluster ID format.");
    }

    const result = await repo.collection.updateOne(
      { _id: oid },
      { $set: { ...data, updatedAt: new Date() } }
    );

    if (!result.matchedCount) throw new NotFoundError("Cluster not found.");
    repo.delCachedData();
  }

  /**
   * Update cluster status
   */
  async function updateStatus(
    id: string,
    status: TClusterStatus,
    info?: { version?: string; platform?: string; nodesCount?: number }
  ): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid cluster ID format.");
    }

    const update: Partial<TCluster> = {
      status,
      lastSyncedAt: new Date(),
      updatedAt: new Date(),
    };

    if (info?.version) update.version = info.version;
    if (info?.platform) update.platform = info.platform;
    if (info?.nodesCount !== undefined) update.nodesCount = info.nodesCount;

    await repo.collection.updateOne({ _id: oid }, { $set: update });
    repo.delCachedData();
  }

  /**
   * Update join token
   */
  async function updateJoinToken(id: string, joinToken: string): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid cluster ID format.");
    }

    await repo.collection.updateOne(
      { _id: oid },
      { $set: { joinToken, updatedAt: new Date() } }
    );
    repo.delCachedData();
  }

  /**
   * Delete cluster by ID
   */
  async function deleteById(id: string): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid cluster ID format.");
    }

    const result = await repo.collection.deleteOne({ _id: oid });
    if (!result.deletedCount) throw new NotFoundError("Cluster not found.");
    repo.delCachedData();
  }

  /**
   * Count clusters
   */
  async function count(): Promise<number> {
    return repo.collection.countDocuments({});
  }

  return {
    createIndexes,
    getAll,
    getById,
    getByName,
    getLocalCluster,
    add,
    updateById,
    updateStatus,
    updateJoinToken,
    deleteById,
    count,
  };
}
