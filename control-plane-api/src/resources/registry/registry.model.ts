import Joi from "joi";
import { ObjectId } from "mongodb";
import { BadRequestError } from "../../utils";

// =============================================================================
// Registry Types & Enums
// =============================================================================

export const registryTypes = [
  "docker-hub",
  "gcr",
  "ecr",
  "acr",
  "ghcr",
  "harbor",
  "custom",
] as const;
export type TRegistryType = (typeof registryTypes)[number];

export const registryStatuses = ["active", "error", "pending"] as const;
export type TRegistryStatus = (typeof registryStatuses)[number];

// =============================================================================
// Credentials Type
// =============================================================================

export type TRegistryCredentials = {
  username?: string;
  password?: string;            // Encrypted at rest
  accessKeyId?: string;         // For ECR
  secretAccessKey?: string;     // For ECR (encrypted)
  serviceAccountKey?: string;   // For GCR (JSON, encrypted)
};

// =============================================================================
// Main Registry Type
// =============================================================================

export type TRegistry = {
  _id?: ObjectId;
  name: string;
  type: TRegistryType;
  url: string;                  // e.g., 'docker.io', 'ghcr.io', 'registry.example.com'

  // Credentials
  credentials: TRegistryCredentials;

  // K8s integration
  pullSecretName?: string;      // Auto-generated K8s imagePullSecret name
  namespaces?: string[];        // Namespaces where secret is deployed

  // Status
  status: TRegistryStatus;
  lastVerifiedAt?: Date;
  verificationError?: string;

  // Multi-tenancy
  organizationId?: ObjectId;

  // Timestamps
  createdAt?: Date;
  updatedAt?: Date;
};

// =============================================================================
// Response Type (excludes sensitive data)
// =============================================================================

export type TRegistryResponse = Omit<TRegistry, "credentials"> & {
  credentials: {
    username?: string;
    hasPassword?: boolean;
    accessKeyId?: string;
    hasSecretAccessKey?: boolean;
    hasServiceAccountKey?: boolean;
  };
};

// =============================================================================
// Joi Schemas
// =============================================================================

const schemaCredentials = Joi.object({
  username: Joi.string().allow(""),
  password: Joi.string().allow(""),
  accessKeyId: Joi.string().allow(""),
  secretAccessKey: Joi.string().allow(""),
  serviceAccountKey: Joi.string().allow(""),
});

const schemaRegistryBase = {
  name: Joi.string()
    .min(2)
    .max(100)
    .pattern(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/)
    .required()
    .messages({
      "string.pattern.base":
        "Name must be lowercase alphanumeric with dashes (like DNS name)",
    }),
  type: Joi.string()
    .valid(...registryTypes)
    .required(),
  url: Joi.string().required(),
  credentials: schemaCredentials.required(),
  namespaces: Joi.array().items(Joi.string()),
  organizationId: Joi.string().hex().length(24),
};

export const schemaRegistryCreate = Joi.object({
  ...schemaRegistryBase,
});

export const schemaRegistryUpdate = Joi.object({
  name: Joi.string()
    .min(2)
    .max(100)
    .pattern(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/),
  type: Joi.string().valid(...registryTypes),
  url: Joi.string(),
  credentials: schemaCredentials,
  namespaces: Joi.array().items(Joi.string()),
  organizationId: Joi.string().hex().length(24),
});

// =============================================================================
// Model Factory
// =============================================================================

export function modelRegistry(data: Partial<TRegistry>): Omit<TRegistry, "_id"> {
  const { error, value } = schemaRegistryCreate.validate(data);
  if (error) {
    throw new BadRequestError(error.message);
  }

  let organizationId: ObjectId | undefined;
  if (value.organizationId) {
    try {
      organizationId = new ObjectId(value.organizationId);
    } catch {
      throw new BadRequestError("Invalid organizationId format.");
    }
  }

  // Generate pull secret name
  const pullSecretName = `registry-${value.name}`;

  return {
    name: value.name,
    type: value.type,
    url: normalizeRegistryUrl(value.url),
    credentials: value.credentials,
    pullSecretName,
    namespaces: value.namespaces || [],
    status: "pending",
    organizationId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Normalize registry URL (ensure no trailing slash, no protocol for docker config)
 */
export function normalizeRegistryUrl(url: string): string {
  // Remove protocol if present
  let normalized = url.replace(/^https?:\/\//, "");
  // Remove trailing slash
  normalized = normalized.replace(/\/$/, "");
  return normalized;
}

/**
 * Convert registry to safe response (no sensitive credentials)
 */
export function registryToResponse(registry: TRegistry): TRegistryResponse {
  return {
    ...registry,
    credentials: {
      username: registry.credentials.username,
      hasPassword: !!registry.credentials.password,
      accessKeyId: registry.credentials.accessKeyId,
      hasSecretAccessKey: !!registry.credentials.secretAccessKey,
      hasServiceAccountKey: !!registry.credentials.serviceAccountKey,
    },
  };
}

/**
 * Get default registry URL for known registry types
 */
export function getDefaultUrlForType(type: TRegistryType): string {
  const defaultUrls: Record<TRegistryType, string> = {
    "docker-hub": "docker.io",
    gcr: "gcr.io",
    ecr: "", // Region-specific, e.g., 123456789012.dkr.ecr.us-east-1.amazonaws.com
    acr: "", // Instance-specific, e.g., myregistry.azurecr.io
    ghcr: "ghcr.io",
    harbor: "", // Self-hosted
    custom: "",
  };
  return defaultUrls[type];
}
