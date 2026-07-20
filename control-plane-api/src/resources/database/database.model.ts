import Joi from "joi";
import { ObjectId } from "mongodb";
import { BadRequestError } from "../../utils";

export const databaseTypes = ["mongodb", "redis", "postgresql", "mysql"] as const;
export type TDatabaseType = (typeof databaseTypes)[number];

export const databaseStatuses = ["provisioning", "running", "failed", "stopped", "deleting"] as const;
export type TDatabaseStatus = (typeof databaseStatuses)[number];

export const databaseNodeRoles = ["primary", "secondary", "arbiter", "standalone"] as const;
export type TDatabaseNodeRole = (typeof databaseNodeRoles)[number];

export const databaseNodeStatuses = ["running", "stopped", "syncing", "unhealthy"] as const;
export type TDatabaseNodeStatus = (typeof databaseNodeStatuses)[number];

export const provisionerTypes = ["ansible", "k8s"] as const;
export type TProvisionerType = (typeof provisionerTypes)[number];

export type TDatabaseNode = {
  serverId: ObjectId | string;
  role: TDatabaseNodeRole;
  status: TDatabaseNodeStatus;
};

export type TDatabaseCredentials = {
  adminUser: string;
  adminPassword: string; // encrypted
  connectionString: string; // encrypted
};

export type TDatabaseBackup = {
  enabled: boolean;
  schedule: string;
  s3Bucket: string;
  s3Region?: string;
  lastBackup?: Date;
};

/**
 * DNS configuration stored on the database document once DNS records are
 * provisioned. The `records` array holds every Cloudflare record ID so
 * they can be deleted when the cluster is torn down.
 */
export type TDatabaseDNS = {
  enabled: boolean;
  provider: string;            // e.g. "cloudflare"
  clusterHost: string;         // e.g. "mydb.example.com"
  nodeHosts: string[];         // e.g. ["node1.mydb.example.com", …]
  srvConnectionString: string; // mongodb+srv://admin:***@mydb.example.com/…
  records: Array<{
    id: string;                // provider record ID (for deletion)
    type: string;              // "A" | "SRV" | "TXT"
    name: string;              // full DNS name
  }>;
  configuredAt: Date;
};

/**
 * TLS configuration stored on the database document once TLS is enabled.
 * The CA certificate is stored for client distribution.
 */
export type TDatabaseTLS = {
  enabled: boolean;
  caCert: string;              // PEM-encoded CA certificate for client connections
  tlsConnectionString: string; // Connection string with tls=true&tlsCAFile param
  configuredAt: Date;
};

export type TDatabaseBackupRecord = {
  _id?: ObjectId;
  s3Key: string;
  s3Bucket: string;
  s3Region: string;
  sizeBytes?: number;
  createdAt: Date;
  status: "success" | "failed";
  error?: string;
};

export type TDatabase = {
  _id?: ObjectId;
  name: string;
  type: TDatabaseType;
  version: string;
  status: TDatabaseStatus;
  provisionedWith?: TProvisionerType; // Tracks which provisioner created this database
  config: Record<string, any>;
  credentials: TDatabaseCredentials;
  nodes: TDatabaseNode[];
  backup?: TDatabaseBackup;
  backupRecords?: TDatabaseBackupRecord[];
  dns?: TDatabaseDNS;
  tls?: TDatabaseTLS;
  createdAt?: Date;
  updatedAt?: Date;
  deletedAt?: Date;
};

const schemaCredentials = Joi.object({
  adminUser: Joi.string().required(),
  adminPassword: Joi.string().required(),
  connectionString: Joi.string().optional().allow(""),
});

const schemaNode = Joi.object({
  serverId: Joi.string().required(),
  role: Joi.string().valid(...databaseNodeRoles).required(),
  status: Joi.string().valid(...databaseNodeStatuses).default("stopped"),
});

const schemaBackup = Joi.object({
  enabled: Joi.boolean().default(false),
  schedule: Joi.string().default("0 0 * * *"),
  s3Bucket: Joi.string().required(),
});

export const schemaDatabaseCreate = Joi.object({
  name: Joi.string().max(100).required(),
  type: Joi.string().valid(...databaseTypes).required(),
  version: Joi.string().required(),
  config: Joi.object().default({}),
  credentials: schemaCredentials.required(),
  nodes: Joi.array().items(schemaNode).min(1).required(),
  backup: schemaBackup.optional(),
});

export const schemaDatabaseUpdate = Joi.object({
  name: Joi.string().max(100).optional(),
  version: Joi.string().optional(),
  config: Joi.object().optional(),
  backup: schemaBackup.optional(),
});

export function modelDatabase(data: Partial<TDatabase>): TDatabase {
  const { error, value } = schemaDatabaseCreate.validate(data);

  if (error) {
    throw new BadRequestError(`Database validation error: ${error.message}`);
  }

  if (data._id && typeof data._id === "string") {
    try {
      data._id = new ObjectId(data._id);
    } catch {
      throw new BadRequestError(`Invalid _id format: ${data._id}`);
    }
  }

  // Convert serverId strings to ObjectIds
  const nodes = value.nodes.map((node: TDatabaseNode) => ({
    ...node,
    serverId: typeof node.serverId === "string" ? new ObjectId(node.serverId) : node.serverId,
  }));

  return {
    _id: data._id,
    name: value.name,
    type: value.type,
    version: value.version,
    status: "provisioning",
    config: value.config,
    credentials: value.credentials,
    nodes,
    backup: value.backup,
    createdAt: data.createdAt ?? new Date(),
    updatedAt: data.updatedAt ?? new Date(),
  };
}
