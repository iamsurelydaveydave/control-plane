import Joi from "joi";
import { ObjectId } from "mongodb";
import { BadRequestError } from "../../utils/error";

// =============================================================================
// Enums
// =============================================================================

export const addonTypes = ["redis", "postgresql", "mysql", "rabbitmq", "elasticsearch"] as const;
export type TAddonType = (typeof addonTypes)[number];

export const addonStatuses = ["pending", "deploying", "running", "failed", "deleting"] as const;
export type TAddonStatus = (typeof addonStatuses)[number];

// =============================================================================
// Addon Catalog — Default Helm chart versions
// =============================================================================

export const ADDON_CATALOG: Record<TAddonType, { chart: string; version: string; defaultValues: Record<string, any> }> = {
  redis: {
    chart: "bitnami/redis",
    version: "18.0.0",
    defaultValues: {
      auth: { enabled: true },
      architecture: "standalone",
    },
  },
  postgresql: {
    chart: "bitnami/postgresql",
    version: "13.0.0",
    defaultValues: {
      auth: { postgresPassword: "" }, // Will be set at deploy time
    },
  },
  mysql: {
    chart: "bitnami/mysql",
    version: "9.0.0",
    defaultValues: {
      auth: { rootPassword: "" }, // Will be set at deploy time
    },
  },
  rabbitmq: {
    chart: "bitnami/rabbitmq",
    version: "12.0.0",
    defaultValues: {
      auth: { username: "admin" },
    },
  },
  elasticsearch: {
    chart: "bitnami/elasticsearch",
    version: "19.0.0",
    defaultValues: {
      master: { replicaCount: 1 },
      data: { replicaCount: 1 },
    },
  },
};

// =============================================================================
// Types
// =============================================================================

export type TAddonConnectionInfo = {
  host: string;
  port: number;
  username?: string;
  password?: string; // Reference to secret or encrypted value
};

export type TAddon = {
  _id?: ObjectId;
  name: string;              // User-friendly name
  type: TAddonType;
  namespace: string;         // K8s namespace (default: cp-addons)
  releaseName: string;       // Helm release name
  version: string;           // Chart version
  status: TAddonStatus;
  values: Record<string, any>;  // Helm values override
  connectionInfo?: TAddonConnectionInfo;
  organizationId?: ObjectId;   // For multi-tenancy
  lastError?: string;          // Last error message if status is failed
  createdAt: Date;
  updatedAt: Date;
};

// =============================================================================
// Input type for creating an addon
// =============================================================================

export type TAddonInput = {
  name: string;
  type: TAddonType;
  namespace?: string;
  version?: string;
  values?: Record<string, any>;
  organizationId?: string;
};

export type TAddonUpdateInput = {
  name?: string;
  version?: string;
  values?: Record<string, any>;
};

// =============================================================================
// Joi Schemas
// =============================================================================

const schemaConnectionInfo = Joi.object({
  host: Joi.string().required(),
  port: Joi.number().integer().min(1).max(65535).required(),
  username: Joi.string().optional(),
  password: Joi.string().optional(),
});

const schemaAddonBase = {
  name: Joi.string().min(1).max(100).pattern(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/).required()
    .messages({
      "string.pattern.base": "Name must be lowercase alphanumeric with optional hyphens, cannot start or end with a hyphen",
    }),
  type: Joi.string().valid(...addonTypes).required(),
  namespace: Joi.string().default("cp-addons"),
  version: Joi.string().optional(), // Will default to catalog version
  values: Joi.object().default({}),
  organizationId: Joi.string().length(24).optional(),
};

export const schemaAddonCreate = Joi.object({
  ...schemaAddonBase,
});

export const schemaAddonUpdate = Joi.object<Partial<TAddonUpdateInput>>({
  name: Joi.string().min(1).max(100).pattern(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/).optional(),
  version: Joi.string().optional(),
  values: Joi.object().optional(),
});

// =============================================================================
// Model Function
// =============================================================================

/**
 * Validate and normalize addon data for creation.
 * - Validates all fields via Joi
 * - Generates a unique release name
 * - Sets initial status to "pending"
 * - Sets timestamps
 */
export function modelAddon(data: Partial<TAddon> | TAddonInput): Omit<TAddon, "_id"> {
  const { error, value } = schemaAddonCreate.validate(data, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    throw new BadRequestError(
      `Addon validation error: ${error.details.map((d) => d.message).join(", ")}`
    );
  }

  const now = new Date();
  const addonType = value.type as TAddonType;
  const catalogEntry = ADDON_CATALOG[addonType];

  // Generate a unique release name from name + random suffix
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  const releaseName = `${value.name}-${randomSuffix}`;

  // Convert organizationId if provided
  let organizationId: ObjectId | undefined;
  if (value.organizationId) {
    try {
      organizationId = new ObjectId(value.organizationId);
    } catch {
      throw new BadRequestError("Invalid organizationId format.");
    }
  }

  return {
    name: value.name,
    type: addonType,
    namespace: value.namespace || "cp-addons",
    releaseName,
    version: value.version || catalogEntry.version,
    status: "pending",
    values: {
      ...catalogEntry.defaultValues,
      ...value.values,
    },
    organizationId,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Get catalog info for a specific addon type.
 */
export function getAddonCatalogEntry(type: TAddonType) {
  return ADDON_CATALOG[type];
}
