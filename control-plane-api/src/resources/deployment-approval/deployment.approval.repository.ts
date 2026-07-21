import { ObjectId } from "mongodb";
import { useRepo } from "../../utils/repo";
import { makeCacheKey } from "../../utils/make-cache-key";
import { paginate, TPaginated } from "../../utils/paginate";
import { BadRequestError, NotFoundError } from "../../utils/error";
import {
  TDeploymentApproval,
  TDeploymentApprovalStatus,
  TDeploymentEnvironment,
} from "./deployment.approval.model";

const namespace_collection = "cp_deployment_approvals";

export function useDeploymentApprovalRepo() {
  const repo = useRepo(namespace_collection);
  /**
   * Create indexes for deployment approval collection
   */
  async function createIndexes() {
    try {
      await repo.collection.createIndexes([
        { key: { appId: 1, status: 1 } },
        { key: { status: 1, expiresAt: 1 } },
        { key: { requestedBy: 1 } },
        { key: { requestedAt: -1 } },
        { key: { appId: 1, environment: 1, status: 1 } },
        // TTL index to auto-delete expired pending approvals after 7 days
        { key: { expiresAt: 1 }, expireAfterSeconds: 7 * 24 * 60 * 60 },
      ]);
    } catch (error) {
      throw new BadRequestError("Failed to create deployment approval indexes.");
    }
  }

  /**
   * Add a new deployment approval request
   */
  async function add(data: Omit<TDeploymentApproval, "_id">): Promise<string> {
    const result = await repo.collection.insertOne(data as any);
    repo.delCachedData();
    return result.insertedId.toString();
  }

  /**
   * Get approval by ID
   */
  async function getById(id: string): Promise<TDeploymentApproval> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid approval ID format.");
    }

    const cacheKey = makeCacheKey(namespace_collection, { id, tag: "by-id" });
    const cached = await repo.getCache<TDeploymentApproval>(cacheKey);
    if (cached) return cached;

    const approval = await repo.collection.findOne({ _id: oid });
    if (!approval) throw new NotFoundError("Deployment approval not found.");

    repo.setCache(cacheKey, approval, 60);
    return approval as TDeploymentApproval;
  }

  /**
   * Get pending approvals for an app
   */
  async function getPendingByAppId(appId: string): Promise<TDeploymentApproval[]> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(appId);
    } catch {
      throw new BadRequestError("Invalid app ID format.");
    }

    const cacheKey = makeCacheKey(namespace_collection, {
      appId,
      status: "pending",
      tag: "pending-by-app",
    });
    const cached = await repo.getCache<TDeploymentApproval[]>(cacheKey);
    if (cached) return cached;

    const approvals = await repo.collection
      .find({
        appId: oid,
        status: "pending",
        expiresAt: { $gt: new Date() },
      })
      .sort({ requestedAt: -1 })
      .toArray();

    repo.setCache(cacheKey, approvals, 60);
    return approvals as TDeploymentApproval[];
  }

  /**
   * Get all pending approvals (for admin dashboard)
   */
  async function getAllPending(options: {
    page?: number;
    environment?: TDeploymentEnvironment;
  } = {}): Promise<TPaginated<TDeploymentApproval> & { total: number }> {
    const { page = 1, environment } = options;
    const limit = 20;

    const cacheKey = makeCacheKey(namespace_collection, {
      page,
      environment: environment || "",
      tag: "all-pending",
    });
    const cached = await repo.getCache<TPaginated<TDeploymentApproval> & { total: number }>(
      cacheKey
    );
    if (cached) return cached;

    const query: Record<string, any> = {
      status: "pending",
      expiresAt: { $gt: new Date() },
    };
    if (environment) query.environment = environment;

    const skip = (page > 0 ? page - 1 : 0) * limit;

    const [items, total] = await Promise.all([
      repo.collection
        .find(query)
        .sort({ requestedAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      repo.collection.countDocuments(query),
    ]);

    const paginated = paginate(items as TDeploymentApproval[], page, limit, total);
    const result = { ...paginated, total };
    repo.setCache(cacheKey, result, 60);
    return result;
  }

  /**
   * Get approval history for an app
   */
  async function getByAppId(
    appId: string,
    options: { page?: number; limit?: number } = {}
  ): Promise<TPaginated<TDeploymentApproval>> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(appId);
    } catch {
      throw new BadRequestError("Invalid app ID format.");
    }

    const { page = 1, limit = 10 } = options;
    const skip = (page > 0 ? page - 1 : 0) * limit;

    const cacheKey = makeCacheKey(namespace_collection, {
      appId,
      page,
      limit,
      tag: "by-app",
    });
    const cached = await repo.getCache<TPaginated<TDeploymentApproval>>(cacheKey);
    if (cached) return cached;

    const [items, total] = await Promise.all([
      repo.collection
        .find({ appId: oid })
        .sort({ requestedAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      repo.collection.countDocuments({ appId: oid }),
    ]);

    const paginated = paginate(items as TDeploymentApproval[], page, limit, total);
    repo.setCache(cacheKey, paginated, 120);
    return paginated;
  }

  /**
   * Update approval status to approved
   */
  async function approve(
    id: string,
    approvedBy: string,
    deploymentId?: string
  ): Promise<void> {
    let oid: ObjectId;
    let approvedByOid: ObjectId;

    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid approval ID format.");
    }

    try {
      approvedByOid = new ObjectId(approvedBy);
    } catch {
      throw new BadRequestError("Invalid user ID format.");
    }

    const update: Record<string, any> = {
      status: "approved",
      approvedBy: approvedByOid,
      approvedAt: new Date(),
    };

    if (deploymentId) {
      update.deploymentId = new ObjectId(deploymentId);
    }

    const result = await repo.collection.updateOne(
      { _id: oid, status: "pending" },
      { $set: update }
    );

    if (!result.matchedCount) {
      throw new NotFoundError("Pending approval not found.");
    }

    repo.delCachedData();
  }

  /**
   * Update approval status to rejected
   */
  async function reject(
    id: string,
    rejectedBy: string,
    reason?: string
  ): Promise<void> {
    let oid: ObjectId;
    let rejectedByOid: ObjectId;

    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid approval ID format.");
    }

    try {
      rejectedByOid = new ObjectId(rejectedBy);
    } catch {
      throw new BadRequestError("Invalid user ID format.");
    }

    const update: Record<string, any> = {
      status: "rejected",
      rejectedBy: rejectedByOid,
      rejectedAt: new Date(),
    };

    if (reason) {
      update.rejectionReason = reason;
    }

    const result = await repo.collection.updateOne(
      { _id: oid, status: "pending" },
      { $set: update }
    );

    if (!result.matchedCount) {
      throw new NotFoundError("Pending approval not found.");
    }

    repo.delCachedData();
  }

  /**
   * Check if there's already a pending approval for this app/environment/version
   */
  async function findExisting(
    appId: string,
    environment: TDeploymentEnvironment,
    version: string
  ): Promise<TDeploymentApproval | null> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(appId);
    } catch {
      throw new BadRequestError("Invalid app ID format.");
    }

    const approval = await repo.collection.findOne({
      appId: oid,
      environment,
      version,
      status: "pending",
      expiresAt: { $gt: new Date() },
    });

    return approval as TDeploymentApproval | null;
  }

  /**
   * Set the deployment ID after a deployment is triggered
   */
  async function setDeploymentId(id: string, deploymentId: string): Promise<void> {
    let oid: ObjectId;
    let deploymentOid: ObjectId;

    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid approval ID format.");
    }

    try {
      deploymentOid = new ObjectId(deploymentId);
    } catch {
      throw new BadRequestError("Invalid deployment ID format.");
    }

    await repo.collection.updateOne(
      { _id: oid },
      { $set: { deploymentId: deploymentOid } }
    );

    repo.delCachedData();
  }

  return {
    createIndexes,
    add,
    getById,
    getPendingByAppId,
    getAllPending,
    getByAppId,
    approve,
    reject,
    findExisting,
    setDeploymentId,
  };
}
