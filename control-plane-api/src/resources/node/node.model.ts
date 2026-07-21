import Joi from "joi";
import { ObjectId } from "mongodb";
import { BadRequestError } from "../../utils/error";

// =============================================================================
// Enums
// =============================================================================

export const nodeRoles = ["master", "worker"] as const;
export type TNodeRole = (typeof nodeRoles)[number];

export const nodeStatuses = [
  "pending",       // Created in DB, waiting for provisioning
  "provisioning",  // SSH connected, installing k3s agent
  "joining",       // k3s agent installed, waiting for K8s Ready
  "ready",         // K8s node is Ready
  "not-ready",     // K8s node exists but not Ready
  "offline",       // Node unreachable
  "draining",      // Being drained before removal
  "deleting",      // Being removed from cluster
  "failed",        // Provisioning failed
] as const;
export type TNodeStatus = (typeof nodeStatuses)[number];

// Provisioning step statuses
export const provisioningStepStatuses = [
  "pending",
  "running",
  "success",
  "failed",
  "skipped",
] as const;
export type TProvisioningStepStatus = (typeof provisioningStepStatuses)[number];

export type TProvisioningStep = {
  name: string;
  label: string;
  status: TProvisioningStepStatus;
  output?: string;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
};

// =============================================================================
// Types
// =============================================================================

export type TNodeCondition = {
  type: string;           // Ready, MemoryPressure, DiskPressure, PIDPressure, NetworkUnavailable
  status: string;         // True, False, Unknown
  reason?: string;
  message?: string;
  lastTransitionTime?: Date;
};

export type TNodeTaint = {
  key: string;
  value?: string;
  effect: string;         // NoSchedule, PreferNoSchedule, NoExecute
};

export type TNodeResources = {
  cpuCapacity: string;        // e.g., "4"
  cpuAllocatable: string;     // e.g., "3800m"
  memoryCapacity: string;     // e.g., "8Gi"
  memoryAllocatable: string;  // e.g., "7Gi"
  podsCapacity: string;       // e.g., "110"
  podsRunning?: number;       // Current pod count
};

export type TNode = {
  _id?: ObjectId;
  clusterId: ObjectId;
  name: string;               // Display name, e.g., "worker-1"
  role: TNodeRole;
  host: string;               // IP address or hostname

  // SSH connection info (for provisioning)
  sshUser?: string;           // SSH username (default: root)
  sshPort?: number;           // SSH port (default: 22)
  sshKeyId?: string;          // Reference to SSH key in secrets

  // K8s node info (synced from cluster)
  k8sName?: string;           // Actual K8s node name
  k8sStatus?: string;         // Ready, NotReady, Unknown
  k8sVersion?: string;        // kubelet version
  containerRuntime?: string;  // e.g., "containerd://1.7.0"
  osImage?: string;           // e.g., "Ubuntu 22.04.3 LTS"
  architecture?: string;      // e.g., "amd64"

  // Resources (synced from K8s)
  resources?: TNodeResources;

  // Conditions (synced from K8s)
  conditions?: TNodeCondition[];

  // Labels & taints
  labels?: Record<string, string>;
  taints?: TNodeTaint[];

  // Scheduling
  unschedulable?: boolean;

  // Join info (for workers)
  joinToken?: string;         // Encrypted k3s token
  joinCommand?: string;       // Full command for copy/paste

  // Provisioning status
  provisioningStatus?: "idle" | "running" | "success" | "failed";
  provisioningLog?: TProvisioningStep[];
  provisioningStartedAt?: Date;
  provisioningCompletedAt?: Date;

  // Status
  status: TNodeStatus;
  statusMessage?: string;

  // Timestamps
  joinedAt?: Date;
  lastSeenAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

// =============================================================================
// Input type for creating a node
// =============================================================================

export type TNodeInput = {
  clusterId: string;
  name: string;
  role?: TNodeRole;
  host?: string;              // Optional for manual join token method
  sshUser?: string;
  sshPort?: number;
  sshKeyId?: string;
};

// =============================================================================
// Joi Schemas
// =============================================================================

const schemaNodeBase = {
  clusterId: Joi.string().required(),
  name: Joi.string().max(100).required(),
  role: Joi.string().valid(...nodeRoles).default("worker"),
  host: Joi.string().optional().allow(""),
  sshUser: Joi.string().default("root"),
  sshPort: Joi.number().integer().min(1).max(65535).default(22),
  sshKeyId: Joi.string().optional(),
};

export const schemaNodeCreate = Joi.object({
  ...schemaNodeBase,
});

export const schemaNodeUpdate = Joi.object({
  name: Joi.string().max(100).optional(),
  host: Joi.string().optional().allow(null, ""),
  labels: Joi.object().pattern(Joi.string(), Joi.string()).optional(),
});

export const schemaNodeProvision = Joi.object({
  clusterId: Joi.string().required(),
  name: Joi.string().max(100).required(),
  host: Joi.string().required(),
  sshUser: Joi.string().default("root"),
  sshPort: Joi.number().integer().min(1).max(65535).default(22),
  sshKeyId: Joi.string().required(),
});

export const schemaJoinToken = Joi.object({
  clusterId: Joi.string().required(),
  nodeName: Joi.string().max(100).required(),
});

export const schemaNodeLabel = Joi.object({
  key: Joi.string().required(),
  value: Joi.string().required(),
});

export const schemaNodeTaint = Joi.object({
  key: Joi.string().required(),
  value: Joi.string().optional().allow(null, ""),
  effect: Joi.string().valid("NoSchedule", "PreferNoSchedule", "NoExecute").required(),
});

// =============================================================================
// Model Function
// =============================================================================

export function modelNode(data: TNodeInput): Omit<TNode, "_id"> {
  const { error, value } = schemaNodeCreate.validate(data);

  if (error) {
    throw new BadRequestError(`Node validation error: ${error.message}`);
  }

  let clusterId: ObjectId;
  try {
    clusterId = new ObjectId(value.clusterId);
  } catch {
    throw new BadRequestError(`Invalid clusterId format: ${value.clusterId}`);
  }

  const now = new Date();

  return {
    clusterId,
    name: value.name,
    role: value.role,
    host: value.host || "",
    sshUser: value.sshUser || "root",
    sshPort: value.sshPort || 22,
    sshKeyId: value.sshKeyId,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
}
