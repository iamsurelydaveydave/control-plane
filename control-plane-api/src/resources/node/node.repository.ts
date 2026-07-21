import { ObjectId } from "mongodb";
import { useRepo } from "../../utils/repo";
import { makeCacheKey } from "../../utils/make-cache-key";
import { paginate } from "../../utils/paginate";
import { BadRequestError, NotFoundError } from "../../utils/error";
import { TNode, TNodeStatus, TNodeCondition, TNodeTaint, TNodeResources } from "./node.model";

const namespace_collection = "cp_nodes";

export function useNodeRepo() {
  const repo = useRepo(namespace_collection);
  /**
   * Create indexes for node collection
   */
  async function createIndexes() {
    try {
      await repo.collection.createIndexes([
        { key: { clusterId: 1, name: 1 }, unique: true },
        { key: { clusterId: 1, status: 1 } },
        { key: { clusterId: 1, role: 1 } },
        { key: { k8sName: 1 } },
        { key: { status: 1 } },
      ]);
    } catch (error) {
      throw new BadRequestError("Failed to create node indexes.");
    }
  }

  /**
   * Get all nodes for a cluster
   */
  async function getAllByCluster(
    clusterId: string,
    options: { page?: number; role?: string; status?: string } = {}
  ): Promise<{ items: TNode[]; pages: number; total: number }> {
    let clusterOid: ObjectId;
    try {
      clusterOid = new ObjectId(clusterId);
    } catch {
      throw new BadRequestError("Invalid cluster ID format.");
    }

    const { page = 1, role, status } = options;
    const limit = 50;

    const cacheKey = makeCacheKey(namespace_collection, {
      clusterId,
      page,
      role: role || "",
      status: status || "",
      tag: "getAllByCluster",
    });
    const cached = await repo.getCache<{ items: TNode[]; pages: number; total: number }>(cacheKey);
    if (cached) return cached;

    const query: Record<string, any> = { clusterId: clusterOid };
    if (role) query.role = role;
    if (status) query.status = status;

    const skip = (page > 0 ? page - 1 : 0) * limit;

    const [items, total] = await Promise.all([
      repo.collection
        .find(query)
        .sort({ role: 1, name: 1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      repo.collection.countDocuments(query),
    ]);

    const result = {
      items: items as TNode[],
      pages: Math.ceil(total / limit),
      total,
    };

    repo.setCache(cacheKey, result, 60); // 1 min cache
    return result;
  }

  /**
   * Get all nodes (across all clusters)
   */
  async function getAll(): Promise<TNode[]> {
    const cacheKey = makeCacheKey(namespace_collection, { tag: "getAll" });
    const cached = await repo.getCache<TNode[]>(cacheKey);
    if (cached) return cached;

    const nodes = await repo.collection.find({}).sort({ clusterId: 1, role: 1, name: 1 }).toArray();
    repo.setCache(cacheKey, nodes, 60);
    return nodes as TNode[];
  }

  /**
   * Get node by ID
   */
  async function getById(id: string): Promise<TNode> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid node ID format.");
    }

    const cacheKey = makeCacheKey(namespace_collection, { id, tag: "by-id" });
    const cached = await repo.getCache<TNode>(cacheKey);
    if (cached) return cached;

    const node = await repo.collection.findOne({ _id: oid });
    if (!node) throw new NotFoundError("Node not found.");

    repo.setCache(cacheKey, node, 60);
    return node as TNode;
  }

  /**
   * Get node by K8s name
   */
  async function getByK8sName(k8sName: string): Promise<TNode | null> {
    const cacheKey = makeCacheKey(namespace_collection, { k8sName, tag: "by-k8s-name" });
    const cached = await repo.getCache<TNode | null>(cacheKey);
    if (cached !== undefined) return cached;

    const node = await repo.collection.findOne({ k8sName });
    repo.setCache(cacheKey, node, 60);
    return node as TNode | null;
  }

  /**
   * Get node by name within a cluster
   */
  async function getByName(clusterId: string, name: string): Promise<TNode | null> {
    let clusterOid: ObjectId;
    try {
      clusterOid = new ObjectId(clusterId);
    } catch {
      throw new BadRequestError("Invalid cluster ID format.");
    }

    const node = await repo.collection.findOne({ clusterId: clusterOid, name });
    return node as TNode | null;
  }

  /**
   * Add a new node
   */
  async function add(data: Omit<TNode, "_id">): Promise<string> {
    const result = await repo.collection.insertOne(data as any);
    repo.delCachedData();
    return result.insertedId.toString();
  }

  /**
   * Update node by ID
   */
  async function updateById(id: string, data: Partial<TNode>): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid node ID format.");
    }

    const result = await repo.collection.updateOne(
      { _id: oid },
      { $set: { ...data, updatedAt: new Date() } }
    );

    if (!result.matchedCount) throw new NotFoundError("Node not found.");
    repo.delCachedData();
  }

  /**
   * Update node status
   */
  async function updateStatus(
    id: string,
    status: TNodeStatus,
    statusMessage?: string
  ): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid node ID format.");
    }

    const update: Partial<TNode> = {
      status,
      lastSeenAt: new Date(),
      updatedAt: new Date(),
    };
    if (statusMessage !== undefined) update.statusMessage = statusMessage;

    await repo.collection.updateOne({ _id: oid }, { $set: update });
    repo.delCachedData();
  }

  /**
   * Sync node data from K8s
   */
  async function syncFromK8s(
    id: string,
    data: {
      k8sName: string;
      k8sStatus: string;
      k8sVersion?: string;
      containerRuntime?: string;
      osImage?: string;
      architecture?: string;
      resources?: TNodeResources;
      conditions?: TNodeCondition[];
      labels?: Record<string, string>;
      taints?: TNodeTaint[];
      unschedulable?: boolean;
    }
  ): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid node ID format.");
    }

    // Determine status based on k8sStatus
    let status: TNodeStatus = "not-ready";
    if (data.k8sStatus === "Ready" || data.k8sStatus === "True") {
      status = "ready";
    }

    const update: Partial<TNode> = {
      ...data,
      status,
      lastSeenAt: new Date(),
      updatedAt: new Date(),
    };

    // Set joinedAt if transitioning to ready for the first time
    const existing = await repo.collection.findOne({ _id: oid });
    if (existing && !existing.joinedAt && status === "ready") {
      update.joinedAt = new Date();
    }

    await repo.collection.updateOne({ _id: oid }, { $set: update });
    repo.delCachedData();
  }

  /**
   * Update join token
   */
  async function updateJoinToken(id: string, joinToken: string, joinCommand: string): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid node ID format.");
    }

    await repo.collection.updateOne(
      { _id: oid },
      { $set: { joinToken, joinCommand, updatedAt: new Date() } }
    );
    repo.delCachedData();
  }

  /**
   * Delete node by ID
   */
  async function deleteById(id: string): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid node ID format.");
    }

    const result = await repo.collection.deleteOne({ _id: oid });
    if (!result.deletedCount) throw new NotFoundError("Node not found.");
    repo.delCachedData();
  }

  /**
   * Delete all nodes for a cluster
   */
  async function deleteByCluster(clusterId: string): Promise<number> {
    let clusterOid: ObjectId;
    try {
      clusterOid = new ObjectId(clusterId);
    } catch {
      throw new BadRequestError("Invalid cluster ID format.");
    }

    const result = await repo.collection.deleteMany({ clusterId: clusterOid });
    repo.delCachedData();
    return result.deletedCount;
  }

  /**
   * Count nodes by cluster
   */
  async function countByCluster(clusterId: string): Promise<number> {
    let clusterOid: ObjectId;
    try {
      clusterOid = new ObjectId(clusterId);
    } catch {
      throw new BadRequestError("Invalid cluster ID format.");
    }
    return repo.collection.countDocuments({ clusterId: clusterOid });
  }

  /**
   * Count ready nodes by cluster
   */
  async function countReadyByCluster(clusterId: string): Promise<number> {
    let clusterOid: ObjectId;
    try {
      clusterOid = new ObjectId(clusterId);
    } catch {
      throw new BadRequestError("Invalid cluster ID format.");
    }
    return repo.collection.countDocuments({ clusterId: clusterOid, status: "ready" });
  }

  /**
   * Update provisioning status
   */
  async function updateProvisioningStatus(
    id: string,
    status: "idle" | "running" | "success" | "failed",
    log?: any[]
  ): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid node ID format.");
    }

    const update: Record<string, any> = {
      provisioningStatus: status,
      updatedAt: new Date(),
    };

    if (status === "running" && !log) {
      update.provisioningStartedAt = new Date();
    }
    if (status === "success" || status === "failed") {
      update.provisioningCompletedAt = new Date();
    }
    if (log) {
      update.provisioningLog = log;
    }

    await repo.collection.updateOne({ _id: oid }, { $set: update });
    repo.delCachedData();
  }

  /**
   * Append to provisioning log
   */
  async function appendProvisioningLog(
    id: string,
    step: {
      name: string;
      label: string;
      status: string;
      output?: string;
      error?: string;
      startedAt?: Date;
      completedAt?: Date;
    }
  ): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid node ID format.");
    }

    // First check if step exists
    const node = await repo.collection.findOne({ _id: oid });
    if (!node) throw new NotFoundError("Node not found.");

    const log = node.provisioningLog || [];
    const existingIndex = log.findIndex((s: any) => s.name === step.name);

    if (existingIndex >= 0) {
      // Update existing step
      log[existingIndex] = { ...log[existingIndex], ...step };
    } else {
      // Add new step
      log.push(step);
    }

    await repo.collection.updateOne(
      { _id: oid },
      { $set: { provisioningLog: log, updatedAt: new Date() } }
    );
    repo.delCachedData();
  }

  return {
    createIndexes,
    getAllByCluster,
    getAll,
    getById,
    getByK8sName,
    getByName,
    add,
    updateById,
    updateStatus,
    syncFromK8s,
    updateJoinToken,
    deleteById,
    deleteByCluster,
    countByCluster,
    countReadyByCluster,
    updateProvisioningStatus,
    appendProvisioningLog,
  };
}
