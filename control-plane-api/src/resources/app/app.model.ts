import Joi from "joi";
import { ObjectId } from "mongodb";
import { BadRequestError } from "../../utils";

export const appStatuses = ["running", "stopped", "deploying", "failed"] as const;
export type TAppStatus = (typeof appStatuses)[number];

export const appPlacements = ["spread", "pack", "manual"] as const;
export type TAppPlacement = (typeof appPlacements)[number];

export type TAppResources = {
  memoryLimit?: string;
  cpuQuota?: number;
};

export type TAppHealthCheck = {
  path: string;
  interval: number;
  timeout: number;
};

export type TApp = {
  _id?: ObjectId;
  name: string;
  image: string;
  domain?: string;
  desiredReplicas: number;
  placement: TAppPlacement;
  serverIds: ObjectId[]; // Servers to deploy to
  env: Record<string, string>;
  resources?: TAppResources;
  healthCheck?: TAppHealthCheck;
  status: TAppStatus;
  createdAt?: Date;
  updatedAt?: Date;
  deployedAt?: Date;
};

const schemaAppBase = {
  name: Joi.string().max(100).required(),
  image: Joi.string().required(),
  domain: Joi.string().optional().allow(null, ""),
  desiredReplicas: Joi.number().min(0).default(1),
  placement: Joi.string().valid(...appPlacements).default("spread"),
  serverIds: Joi.array().items(Joi.string()).min(1).required(),
  env: Joi.object().pattern(Joi.string(), Joi.string()).default({}),
  resources: Joi.object({
    memoryLimit: Joi.string().optional(),
    cpuQuota: Joi.number().optional(),
  }).optional(),
  healthCheck: Joi.object({
    path: Joi.string().required(),
    interval: Joi.number().required(),
    timeout: Joi.number().required(),
  }).optional(),
};

export const schemaAppCreate = Joi.object({
  ...schemaAppBase,
});

export const schemaAppUpdate = Joi.object({
  name: Joi.string().max(100).optional(),
  image: Joi.string().optional(),
  domain: Joi.string().optional().allow(null, ""),
  desiredReplicas: Joi.number().min(0).optional(),
  placement: Joi.string().valid(...appPlacements).optional(),
  serverIds: Joi.array().items(Joi.string()).min(1).optional(),
  env: Joi.object().pattern(Joi.string(), Joi.string()).optional(),
  resources: Joi.object({
    memoryLimit: Joi.string().optional(),
    cpuQuota: Joi.number().optional(),
  }).optional(),
  healthCheck: Joi.object({
    path: Joi.string().required(),
    interval: Joi.number().required(),
    timeout: Joi.number().required(),
  }).optional(),
});

export const schemaAppScale = Joi.object({
  desiredReplicas: Joi.number().min(0).required(),
});

export const schemaAppDeploy = Joi.object({
  image: Joi.string().optional(),
});

export function modelApp(data: Partial<TApp>): TApp {
  const { error, value } = schemaAppCreate.validate(data);

  if (error) {
    throw new BadRequestError(`App validation error: ${error.message}`);
  }

  if (data._id && typeof data._id === "string") {
    try {
      data._id = new ObjectId(data._id);
    } catch {
      throw new BadRequestError(`Invalid _id format: ${data._id}`);
    }
  }

  // Convert serverIds strings to ObjectIds
  const serverIds = value.serverIds.map((id: string) => new ObjectId(id));

  return {
    _id: data._id,
    name: value.name,
    image: value.image,
    domain: value.domain ?? "",
    desiredReplicas: value.desiredReplicas,
    placement: value.placement,
    serverIds,
    env: value.env,
    resources: value.resources,
    healthCheck: value.healthCheck,
    status: "stopped",
    createdAt: data.createdAt ?? new Date(),
    updatedAt: data.updatedAt ?? new Date(),
  };
}
