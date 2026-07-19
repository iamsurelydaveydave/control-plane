import Joi from "joi";
import { ObjectId } from "mongodb";
import { BadRequestError } from "../../utils";

// =============================================================================
// Types
// =============================================================================

export type TSecret = {
  _id?: ObjectId;
  name: string;                // Secret name (e.g., "DATABASE_URL", "API_KEY")
  value: string;               // Encrypted value
  appId?: ObjectId;            // If set, scoped to specific app; null = global
  description?: string;        // Optional description
  createdAt?: Date;
  updatedAt?: Date;
};

// Response type (value is never returned)
export type TSecretResponse = {
  _id: string;
  name: string;
  appId?: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
};

// =============================================================================
// Joi Schemas
// =============================================================================

export const schemaSecretCreate = Joi.object({
  name: Joi.string()
    .max(100)
    .pattern(/^[A-Z][A-Z0-9_]*$/)
    .required()
    .messages({
      'string.pattern.base': 'Secret name must be uppercase with underscores (e.g., DATABASE_URL)',
    }),
  value: Joi.string().required(),
  appId: Joi.string().optional().allow(null, ""),
  description: Joi.string().max(500).optional().allow(""),
});

export const schemaSecretUpdate = Joi.object({
  value: Joi.string().optional(),
  description: Joi.string().max(500).optional().allow(""),
});

// =============================================================================
// Model Function
// =============================================================================

export function modelSecret(data: Partial<TSecret>): TSecret {
  const { error, value } = schemaSecretCreate.validate(data);

  if (error) {
    throw new BadRequestError(`Secret validation error: ${error.message}`);
  }

  if (data._id && typeof data._id === "string") {
    try {
      data._id = new ObjectId(data._id);
    } catch {
      throw new BadRequestError(`Invalid _id format: ${data._id}`);
    }
  }

  const appId = value.appId ? new ObjectId(value.appId) : undefined;

  return {
    _id: data._id,
    name: value.name,
    value: value.value, // Will be encrypted by repository
    appId,
    description: value.description ?? "",
    createdAt: data.createdAt ?? new Date(),
    updatedAt: data.updatedAt ?? new Date(),
  };
}

// =============================================================================
// Helper to convert to response (strips value)
// =============================================================================

export function secretToResponse(secret: TSecret): TSecretResponse {
  return {
    _id: secret._id!.toString(),
    name: secret.name,
    appId: secret.appId?.toString(),
    description: secret.description,
    createdAt: secret.createdAt!,
    updatedAt: secret.updatedAt!,
  };
}
