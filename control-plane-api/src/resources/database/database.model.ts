import Joi from "joi";
import { ObjectId } from "mongodb";
import { BadRequestError } from "../../utils";

export const databaseTypes = ["mongodb", "redis", "postgresql", "mysql"] as const;
export type TDatabaseType = (typeof databaseTypes)[number];

export const databaseStatuses = ["provisioning", "running", "failed", "stopped"] as const;
export type TDatabaseStatus = (typeof databaseStatuses)[number];

export const databaseNodeRoles = ["primary", "secondary", "arbiter", "standalone"] as const;
export type TDatabaseNodeRole = (typeof databaseNodeRoles)[number];

export const databaseNodeStatuses = ["running", "stopped", "syncing", "unhealthy"] as const;
export type TDatabaseNodeStatus = (typeof databaseNodeStatuses)[number];

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
  lastBackup?: Date;
};

export type TDatabase = {
  _id?: ObjectId;
  name: string;
  type: TDatabaseType;
  version: string;
  status: TDatabaseStatus;
  config: Record<string, any>;
  credentials: TDatabaseCredentials;
  nodes: TDatabaseNode[];
  backup?: TDatabaseBackup;
  createdAt?: Date;
  updatedAt?: Date;
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
