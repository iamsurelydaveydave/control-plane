import Joi from "joi";
import { ObjectId } from "mongodb";
import { BadRequestError } from "../../utils/error";

// =============================================================================
// Enums
// =============================================================================

export const databaseTypes = ["mongodb"] as const;
export type TDatabaseType = (typeof databaseTypes)[number];

export const databaseNodeRoles = ["primary", "secondary", "arbiter", "standalone"] as const;
export type TDatabaseNodeRole = (typeof databaseNodeRoles)[number];

export const databaseNodeStatuses = ["running", "stopped", "syncing", "unhealthy"] as const;
export type TDatabaseNodeStatus = (typeof databaseNodeStatuses)[number];

export const databaseStatuses = [
  "provisioning",
  "running",
  "stopped",
  "failed",
  "deleting",
  "unknown",
] as const;
export type TDatabaseStatus = (typeof databaseStatuses)[number];

// =============================================================================
// Types
// =============================================================================

export type TDatabaseNode = {
  serverId: ObjectId;
  role: TDatabaseNodeRole;
  status: TDatabaseNodeStatus;
  sslipHost?: string;
  sslipConnectionHost?: string;
};

export type TDatabaseCredentials = {
  adminUser: string;
  adminPassword: string; // Encrypted at rest
  connectionString: string;
  srvConnectionString?: string; // mongodb+srv:// — present when DNS is configured
};

export type TDatabaseConfig = {
  port?: number;
  replicaSetName?: string;
  cacheSizeGB?: number;
};

export type TDatabaseDNS = {
  enabled: boolean;
  provider: string;
  clusterHost: string;
  nodeHosts: string[];
  srvConnectionString: string;
  records: Array<{ id: string; type: string; name: string }>;
  configuredAt: Date;
};

export type TDatabaseTLS = {
  enabled: boolean;
  caCert: string;
  tlsConnectionString: string;
  configuredAt: Date;
};

export type TDatabaseBackup = {
  enabled: boolean;
  schedule: string;
  s3Bucket?: string;
  s3Endpoint?: string;
  s3Region?: string;
  credentialsSecret?: string;
  lastBackup?: Date;
};

export type TBackupConfigInput = {
  enabled: boolean;
  schedule: string;
  s3Bucket: string;
  s3Endpoint?: string;
  s3Region?: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export type TBackupInfo = {
  name: string;
  status: string;
  type: string;
  storageName: string;
  completed?: Date;
  pbmName?: string;
  size?: number;
};

export type TDatabase = {
  _id?: ObjectId;
  organizationId?: ObjectId;   // Organization this database belongs to (multi-tenancy)
  name: string;
  type: TDatabaseType;
  version: string;
  status: TDatabaseStatus;
  credentials: TDatabaseCredentials;
  nodes: TDatabaseNode[];
  config: TDatabaseConfig;
  dns?: TDatabaseDNS;
  tls?: TDatabaseTLS;
  backup?: TDatabaseBackup;
  deploymentLogs?: string[];
  createdAt: Date;
  updatedAt: Date;
};

// =============================================================================
// Input type for creating a database
// =============================================================================

export type TDatabaseInput = {
  name: string;
  type: TDatabaseType;
  version: string;
  credentials: {
    adminUser: string;
    adminPassword: string;
    connectionString?: string;
  };
  nodes: Array<{
    serverId: string;
    role: TDatabaseNodeRole;
    status?: TDatabaseNodeStatus;
  }>;
  config?: Partial<TDatabaseConfig>;
  backup?: TDatabaseBackup;
};

// =============================================================================
// Joi Schemas
// =============================================================================

const schemaNodeBase = Joi.object({
  serverId: Joi.alternatives()
    .try(Joi.string().length(24), Joi.object().instance(ObjectId))
    .required(),
  role: Joi.string()
    .valid(...databaseNodeRoles)
    .required(),
  status: Joi.string()
    .valid(...databaseNodeStatuses)
    .default("stopped"),
  sslipHost: Joi.string().optional(),
  sslipConnectionHost: Joi.string().optional(),
});

const schemaCredentialsBase = Joi.object({
  adminUser: Joi.string().required(),
  adminPassword: Joi.string().required(),
  connectionString: Joi.string().allow("").default(""),
});

const schemaConfigBase = Joi.object({
  port: Joi.number().integer().min(1024).max(65535).optional(),
  replicaSetName: Joi.string().optional(),
  cacheSizeGB: Joi.number().positive().optional(),
});

const schemaDNSRecord = Joi.object({
  id: Joi.string().required(),
  type: Joi.string().required(),
  name: Joi.string().required(),
});

const schemaDNS = Joi.object({
  enabled: Joi.boolean().required(),
  provider: Joi.string().required(),
  clusterHost: Joi.string().required(),
  nodeHosts: Joi.array().items(Joi.string()).required(),
  srvConnectionString: Joi.string().required(),
  records: Joi.array().items(schemaDNSRecord).required(),
  configuredAt: Joi.date().required(),
});

const schemaTLS = Joi.object({
  enabled: Joi.boolean().required(),
  caCert: Joi.string().required(),
  tlsConnectionString: Joi.string().required(),
  configuredAt: Joi.date().required(),
});

const schemaBackup = Joi.object({
  enabled: Joi.boolean().required(),
  schedule: Joi.string().required(),
  s3Bucket: Joi.string().optional(),
  s3Endpoint: Joi.string().optional(),
  s3Region: Joi.string().optional(),
  credentialsSecret: Joi.string().optional(),
  lastBackup: Joi.date().optional(),
});

export const schemaBackupConfig = Joi.object({
  enabled: Joi.boolean().required(),
  schedule: Joi.string().required().pattern(/^[\d*,\-/\s]+$/, 'cron expression'),
  s3Bucket: Joi.string().required(),
  s3Endpoint: Joi.string().optional(),
  s3Region: Joi.string().default('us-east-1'),
  accessKeyId: Joi.string().required(),
  secretAccessKey: Joi.string().required(),
});

export const schemaRestoreBackup = Joi.object({
  backupName: Joi.string().required(),
});

export const schemaDatabaseCreate = Joi.object({
  organizationId: Joi.string().length(24).optional(), // Optional for backwards compat
  name: Joi.string().min(1).max(100).required(),
  type: Joi.string()
    .valid(...databaseTypes)
    .required(),
  version: Joi.string().required(),
  credentials: schemaCredentialsBase.required(),
  nodes: Joi.array().items(schemaNodeBase).min(1).required(),
  config: schemaConfigBase.default({}),
  dns: schemaDNS.optional(),
  tls: schemaTLS.optional(),
  backup: schemaBackup.optional(),
});

export const schemaAddNode = Joi.object({
  serverId: Joi.string().required(),
  role: Joi.string()
    .valid(...databaseNodeRoles)
    .required(),
});

export const schemaDatabaseUpdate = Joi.object<Partial<TDatabase>>({
  name: Joi.string().min(1).max(100).optional(),
  version: Joi.string().optional(),
  status: Joi.string()
    .valid(...databaseStatuses)
    .optional(),
  config: schemaConfigBase.optional(),
  dns: schemaDNS.optional(),
  tls: schemaTLS.optional(),
  backup: schemaBackup.optional(),
});

// =============================================================================
// Model Function
// =============================================================================

/**
 * Validate and normalize database data for creation.
 * - Validates all fields via Joi
 * - Converts string serverIds to ObjectId
 * - Sets initial status to "provisioning"
 * - Sets timestamps
 */
export function modelDatabase(data: Partial<TDatabase> | TDatabaseInput): Omit<TDatabase, "_id"> {
  const { error, value } = schemaDatabaseCreate.validate(data, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    throw new BadRequestError(
      `Database validation error: ${error.details.map((d) => d.message).join(", ")}`
    );
  }

  const now = new Date();

  // Convert string serverIds to ObjectId in nodes array
  const nodes: TDatabaseNode[] = value.nodes.map((node: any) => {
    let serverId: ObjectId;
    try {
      serverId =
        node.serverId instanceof ObjectId
          ? node.serverId
          : new ObjectId(node.serverId);
    } catch {
      throw new BadRequestError(
        `Invalid serverId format in nodes: ${node.serverId}`
      );
    }

    return {
      serverId,
      role: node.role as TDatabaseNodeRole,
      status: node.status as TDatabaseNodeStatus,
      ...(node.sslipHost && { sslipHost: node.sslipHost }),
      ...(node.sslipConnectionHost && {
        sslipConnectionHost: node.sslipConnectionHost,
      }),
    };
  });

  return {
    organizationId: value.organizationId ? new ObjectId(value.organizationId) : undefined,
    name: value.name,
    type: value.type as TDatabaseType,
    version: value.version,
    status: "provisioning", // Always start as provisioning
    credentials: {
      adminUser: value.credentials.adminUser,
      adminPassword: value.credentials.adminPassword,
      connectionString: value.credentials.connectionString || "",
    },
    nodes,
    config: value.config || {},
    ...(value.dns && { dns: value.dns }),
    ...(value.tls && { tls: value.tls }),
    ...(value.backup && { backup: value.backup }),
    createdAt: now,
    updatedAt: now,
  };
}
