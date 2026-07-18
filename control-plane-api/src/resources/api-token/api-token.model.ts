import Joi from "joi";
import { ObjectId } from "mongodb";
import { BadRequestError } from "../../utils";

export type TAPIToken = {
  _id?: ObjectId;
  name: string;
  token: string; // Hashed, never returned after creation
  tokenPrefix: string; // First 8 chars for identification
  userId: ObjectId;
  scopes: string[];
  expiresAt?: Date;
  lastUsedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
};

export type TAPITokenPublic = Omit<TAPIToken, "token">;

export const availableScopes = [
  "servers:read",
  "servers:write",
  "apps:read",
  "apps:write",
  "databases:read",
  "databases:write",
  "deployments:read",
  "deployments:write",
  "settings:read",
  "settings:write",
  "*", // Full access
] as const;

export type TAPITokenScope = (typeof availableScopes)[number];

const schemaAPITokenBase = {
  name: Joi.string().max(100).required(),
  token: Joi.string().required(),
  tokenPrefix: Joi.string().length(8).required(),
  userId: Joi.any().required(),
  scopes: Joi.array().items(Joi.string().valid(...availableScopes)).default(["*"]),
  expiresAt: Joi.date().optional().allow(null),
};

export const schemaAPITokenCreate = Joi.object({
  ...schemaAPITokenBase,
});

export function modelAPIToken(data: Partial<TAPIToken>): TAPIToken {
  const { error, value } = schemaAPITokenCreate.validate(data);

  if (error) {
    throw new BadRequestError(`API Token validation error: ${error.message}`);
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
    token: value.token,
    tokenPrefix: value.tokenPrefix,
    userId: value.userId instanceof ObjectId ? value.userId : new ObjectId(value.userId),
    scopes: value.scopes,
    expiresAt: value.expiresAt,
    lastUsedAt: data.lastUsedAt,
    createdAt: data.createdAt ?? new Date(),
    updatedAt: data.updatedAt ?? new Date(),
  };
}

/** Strip token hash for API responses */
export function toPublicAPIToken(token: TAPIToken): TAPITokenPublic {
  const { token: _, ...publicToken } = token;
  return publicToken;
}
