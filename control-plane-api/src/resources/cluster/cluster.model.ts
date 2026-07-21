import Joi from "joi";
import { ObjectId } from "mongodb";
import { BadRequestError } from "../../utils/error";

// =============================================================================
// Enums
// =============================================================================

export const clusterTypes = ["local", "remote"] as const;
export type TClusterType = (typeof clusterTypes)[number];

export const clusterStatuses = ["connected", "unreachable", "unknown"] as const;
export type TClusterStatus = (typeof clusterStatuses)[number];

// =============================================================================
// Types
// =============================================================================

export type TCluster = {
  _id?: ObjectId;
  name: string;
  type: TClusterType;
  status: TClusterStatus;

  // Connection info (remote clusters only - encrypted)
  kubeconfig?: string;
  context?: string;

  // Cluster info (synced from K8s)
  version?: string;
  platform?: string;
  nodesCount?: number;

  // API server URL (for display)
  apiServerUrl?: string;

  // Join token for workers (k3s)
  joinToken?: string;

  // Timestamps
  lastSyncedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

// =============================================================================
// Joi Schemas
// =============================================================================

const schemaClusterBase = {
  name: Joi.string().max(100).required(),
  type: Joi.string().valid(...clusterTypes).default("local"),
  kubeconfig: Joi.string().optional().allow(null, ""),
  context: Joi.string().optional().allow(null, ""),
  apiServerUrl: Joi.string().uri().optional().allow(null, ""),
};

export const schemaClusterCreate = Joi.object({
  ...schemaClusterBase,
});

export const schemaClusterUpdate = Joi.object({
  name: Joi.string().max(100).optional(),
  kubeconfig: Joi.string().optional().allow(null, ""),
  context: Joi.string().optional().allow(null, ""),
  apiServerUrl: Joi.string().uri().optional().allow(null, ""),
});

// =============================================================================
// Model Function
// =============================================================================

export function modelCluster(data: Partial<TCluster>): TCluster {
  const { error, value } = schemaClusterCreate.validate(data);

  if (error) {
    throw new BadRequestError(`Cluster validation error: ${error.message}`);
  }

  if (data._id && typeof data._id === "string") {
    try {
      data._id = new ObjectId(data._id);
    } catch {
      throw new BadRequestError(`Invalid _id format: ${data._id}`);
    }
  }

  const now = new Date();

  return {
    _id: data._id,
    name: value.name,
    type: value.type,
    status: "unknown",
    kubeconfig: value.kubeconfig || undefined,
    context: value.context || undefined,
    apiServerUrl: value.apiServerUrl || undefined,
    createdAt: data.createdAt ?? now,
    updatedAt: data.updatedAt ?? now,
  };
}
