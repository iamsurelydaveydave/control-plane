import Joi from "joi";
import { ObjectId } from "mongodb";
import { BadRequestError } from "../../utils";

export const serverProviders = ["hetzner", "digitalocean", "aws", "manual"] as const;
export type TServerProvider = (typeof serverProviders)[number];

export const serverStatuses = ["online", "offline", "unknown", "provisioning"] as const;
export type TServerStatus = (typeof serverStatuses)[number];

export const setupStatuses = ["idle", "running", "success", "failed"] as const;
export type TSetupStatus = (typeof setupStatuses)[number];

export type TSetupStep = {
  name: string;
  label: string;
  status: "pending" | "running" | "success" | "failed" | "skipped";
  output?: string;
  error?: string;
  duration?: number;
};

export type TServerResources = {
  cpuCores?: number;
  memoryMb?: number;
  diskGb?: number;
};

export type THealthCheck = {
  timestamp: Date;
  status: "online" | "offline";
  resources?: TServerResources;
  serverInfo?: {
    os: string;
    hostname: string;
    uptime: string;
  };
  error?: string;
  durationMs?: number;
};

export type TServer = {
  _id?: ObjectId;
  name: string;
  host: string;
  sshUser: string;
  sshPort: number;
  sshKeyId?: ObjectId; // Reference to SSH key
  privateIp?: string;
  provider?: TServerProvider;
  providerId?: string;
  status: TServerStatus;
  resources?: TServerResources;
  tags: string[];
  sshConnectTimeout?: number;
  timezone?: string;
  dockerInstalled?: boolean;
  setupStatus?: TSetupStatus;
  setupLog?: TSetupStep[];
  setupStartedAt?: Date;
  setupCompletedAt?: Date;
  bootstrappedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
  lastHealthCheck?: Date;
  healthChecks?: THealthCheck[];
};

const schemaServerBase = {
  name: Joi.string().max(100).required(),
  host: Joi.string().required(),
  sshUser: Joi.string().default("root"),
  sshPort: Joi.number().default(22),
  sshKeyId: Joi.string().optional().allow(null, ""),
  privateIp: Joi.string().optional().allow(null, ""),
  provider: Joi.string().valid(...serverProviders).optional(),
  providerId: Joi.string().optional().allow(null, ""),
  tags: Joi.array().items(Joi.string()).default([]),
};

export const schemaServerCreate = Joi.object({
  ...schemaServerBase,
});

export const schemaServerUpdate = Joi.object({
  name: Joi.string().max(100).optional(),
  host: Joi.string().optional(),
  sshUser: Joi.string().optional(),
  sshPort: Joi.number().optional(),
  sshKeyId: Joi.string().optional().allow(null, ""),
  privateIp: Joi.string().optional().allow(null, ""),
  provider: Joi.string().valid(...serverProviders).optional(),
  providerId: Joi.string().optional().allow(null, ""),
  tags: Joi.array().items(Joi.string()).optional(),
  sshConnectTimeout: Joi.number().min(5).max(300).optional(),
  timezone: Joi.string().max(100).optional().allow(null, ''),
});

export function modelServer(data: Partial<TServer>): TServer {
  const { error, value } = schemaServerCreate.validate(data);

  if (error) {
    throw new BadRequestError(`Server validation error: ${error.message}`);
  }

  if (data._id && typeof data._id === "string") {
    try {
      data._id = new ObjectId(data._id);
    } catch {
      throw new BadRequestError(`Invalid _id format: ${data._id}`);
    }
  }

  return {
    _id: data._id,
    name: value.name,
    host: value.host,
    sshUser: value.sshUser,
    sshPort: value.sshPort,
    sshKeyId: value.sshKeyId ? new ObjectId(value.sshKeyId) : undefined,
    privateIp: value.privateIp ?? "",
    provider: value.provider,
    providerId: value.providerId ?? "",
    status: "unknown",
    resources: data.resources,
    tags: value.tags,
    createdAt: data.createdAt ?? new Date(),
    updatedAt: data.updatedAt ?? new Date(),
  };
}
