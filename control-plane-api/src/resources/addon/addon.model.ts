import Joi from "joi";
import { ObjectId } from "mongodb";
import { BadRequestError } from "../../utils/error";

// =============================================================================
// Enums
// =============================================================================

export const addonTypes = [
  // Databases
  "mongodb",
  "mongodb-replicaset",  // Production MongoDB replica set
  "postgresql",
  "mysql",
  "mariadb",
  "clickhouse",
  // Caching
  "redis",
  "keydb",
  "dragonfly",
  "memcached",
  // Search
  "elasticsearch",
  "meilisearch",
  "typesense",
  // Queues
  "rabbitmq",
  "nats",
  "kafka",
  // Storage
  "minio",
  "seaweedfs",
  // Analytics
  "plausible",
  "umami",
  "matomo",
  "posthog",
  // Automation
  "n8n",
  "activepieces",
  "windmill",
  "temporal",
  // Development
  "gitea",
  "gitlab",
  "forgejo",
  "codeserver",
  // Monitoring
  "grafana",
  "uptimekuma",
  "prometheus",
  "healthchecks",
  // CMS
  "ghost",
  "strapi",
  "directus",
  "wordpress",
  // Communication
  "mattermost",
  "rocketchat",
  "listmonk",
] as const;
export type TAddonType = (typeof addonTypes)[number];

export const addonStatuses = ["pending", "deploying", "running", "stopped", "failed", "deleting"] as const;
export type TAddonStatus = (typeof addonStatuses)[number];

// =============================================================================
// Helm Chart Catalog — Chart name, version, and default Helm values
// =============================================================================

export type TAddonCatalogEntry = {
  chart: string;
  version: string;
  defaultPort: number;
  defaultValues: Record<string, any>;
  connectionTemplate?: {
    usernameKey?: string;
    passwordKey?: string;
    defaultUsername?: string;
    portOverride?: number;
  };
};

export const ADDON_CATALOG: Record<TAddonType, TAddonCatalogEntry> = {
  // Databases
  mongodb: {
    chart: "bitnami/mongodb",
    version: "15.0.0",
    defaultPort: 27017,
    defaultValues: {
      architecture: "standalone",
      auth: { enabled: true },
    },
    connectionTemplate: {
      usernameKey: "auth.rootUser",
      passwordKey: "auth.rootPassword",
      defaultUsername: "root",
    },
  },
  "mongodb-replicaset": {
    chart: "control-plane/mongodb-replicaset",  // Local chart at deploy/helm/mongodb-replicaset
    version: "1.0.0",
    defaultPort: 27017,
    defaultValues: {
      mongodb: {
        architecture: "replicaset",
        replicaCount: 3,
        replicaSetName: "rs0",
        auth: { enabled: true },
        tls: { enabled: false },
        persistence: { enabled: true, size: "20Gi" },
        pdb: { create: true, minAvailable: 2 },
      },
      dns: {
        enabled: false,
      },
      backup: {
        enabled: false,
        schedule: "0 2 * * *",
        retention: 7,
        s3: {
          bucket: "",
          region: "us-east-1",
          prefix: "mongodb-backups",
        },
      },
    },
    connectionTemplate: {
      usernameKey: "mongodb.auth.rootUser",
      passwordKey: "mongodb.auth.rootPassword",
      defaultUsername: "root",
    },
  },
  postgresql: {
    chart: "bitnami/postgresql",
    version: "15.0.0",
    defaultPort: 5432,
    defaultValues: {
      auth: { postgresPassword: "" },
    },
    connectionTemplate: {
      usernameKey: "auth.username",
      passwordKey: "auth.postgresPassword",
      defaultUsername: "postgres",
    },
  },
  mysql: {
    chart: "bitnami/mysql",
    version: "11.0.0",
    defaultPort: 3306,
    defaultValues: {
      auth: { rootPassword: "" },
    },
    connectionTemplate: {
      usernameKey: "auth.username",
      passwordKey: "auth.rootPassword",
      defaultUsername: "root",
    },
  },
  mariadb: {
    chart: "bitnami/mariadb",
    version: "18.0.0",
    defaultPort: 3306,
    defaultValues: {
      auth: { rootPassword: "" },
    },
    connectionTemplate: {
      usernameKey: "auth.username",
      passwordKey: "auth.rootPassword",
      defaultUsername: "root",
    },
  },
  clickhouse: {
    chart: "bitnami/clickhouse",
    version: "6.0.0",
    defaultPort: 9000,
    defaultValues: {
      auth: { username: "default" },
    },
    connectionTemplate: {
      defaultUsername: "default",
      passwordKey: "auth.password",
    },
  },

  // Caching
  redis: {
    chart: "bitnami/redis",
    version: "19.0.0",
    defaultPort: 6379,
    defaultValues: {
      auth: { enabled: true },
      architecture: "standalone",
    },
    connectionTemplate: {
      passwordKey: "auth.password",
    },
  },
  keydb: {
    chart: "enapter/keydb",
    version: "0.50.0",
    defaultPort: 6379,
    defaultValues: {
      password: "",
    },
    connectionTemplate: {
      passwordKey: "password",
    },
  },
  dragonfly: {
    chart: "dragonflydb/dragonfly",
    version: "1.0.0",
    defaultPort: 6379,
    defaultValues: {
      auth: { enabled: true },
    },
    connectionTemplate: {
      passwordKey: "auth.password",
    },
  },
  memcached: {
    chart: "bitnami/memcached",
    version: "7.0.0",
    defaultPort: 11211,
    defaultValues: {},
  },

  // Search
  elasticsearch: {
    chart: "bitnami/elasticsearch",
    version: "21.0.0",
    defaultPort: 9200,
    defaultValues: {
      master: { replicaCount: 1 },
      data: { replicaCount: 1 },
      security: { enabled: false },
    },
    connectionTemplate: {
      defaultUsername: "elastic",
      passwordKey: "security.elasticPassword",
    },
  },
  meilisearch: {
    chart: "meilisearch/meilisearch",
    version: "0.7.0",
    defaultPort: 7700,
    defaultValues: {
      auth: { enabled: true },
    },
    connectionTemplate: {
      passwordKey: "auth.masterKey",
    },
  },
  typesense: {
    chart: "typesense/typesense",
    version: "0.4.0",
    defaultPort: 8108,
    defaultValues: {},
    connectionTemplate: {
      passwordKey: "apiKey",
    },
  },

  // Queues
  rabbitmq: {
    chart: "bitnami/rabbitmq",
    version: "14.0.0",
    defaultPort: 5672,
    defaultValues: {
      auth: { username: "admin" },
    },
    connectionTemplate: {
      usernameKey: "auth.username",
      passwordKey: "auth.password",
      defaultUsername: "admin",
    },
  },
  nats: {
    chart: "nats/nats",
    version: "1.1.0",
    defaultPort: 4222,
    defaultValues: {},
  },
  kafka: {
    chart: "bitnami/kafka",
    version: "28.0.0",
    defaultPort: 9092,
    defaultValues: {
      listeners: {
        client: { protocol: "PLAINTEXT" },
      },
    },
  },

  // Storage
  minio: {
    chart: "bitnami/minio",
    version: "14.0.0",
    defaultPort: 9000,
    defaultValues: {
      auth: { rootUser: "admin" },
      mode: "standalone",
    },
    connectionTemplate: {
      usernameKey: "auth.rootUser",
      passwordKey: "auth.rootPassword",
      defaultUsername: "admin",
      portOverride: 9000,
    },
  },
  seaweedfs: {
    chart: "seaweedfs/seaweedfs",
    version: "3.0.0",
    defaultPort: 8333,
    defaultValues: {},
  },

  // Analytics
  plausible: {
    chart: "plausible/plausible",
    version: "0.1.0",
    defaultPort: 8000,
    defaultValues: {},
  },
  umami: {
    chart: "umami/umami",
    version: "0.1.0",
    defaultPort: 3000,
    defaultValues: {},
  },
  matomo: {
    chart: "bitnami/matomo",
    version: "7.0.0",
    defaultPort: 8080,
    defaultValues: {},
    connectionTemplate: {
      defaultUsername: "admin",
      passwordKey: "matomoPassword",
    },
  },
  posthog: {
    chart: "posthog/posthog",
    version: "30.0.0",
    defaultPort: 8000,
    defaultValues: {},
  },

  // Automation
  n8n: {
    chart: "8gears/n8n",
    version: "0.23.0",
    defaultPort: 5678,
    defaultValues: {},
  },
  activepieces: {
    chart: "activepieces/activepieces",
    version: "0.1.0",
    defaultPort: 8080,
    defaultValues: {},
  },
  windmill: {
    chart: "windmill/windmill",
    version: "2.0.0",
    defaultPort: 8000,
    defaultValues: {},
  },
  temporal: {
    chart: "temporal/temporal",
    version: "0.33.0",
    defaultPort: 7233,
    defaultValues: {},
  },

  // Development
  gitea: {
    chart: "gitea/gitea",
    version: "10.0.0",
    defaultPort: 3000,
    defaultValues: {
      gitea: { admin: { username: "gitea_admin" } },
    },
    connectionTemplate: {
      usernameKey: "gitea.admin.username",
      passwordKey: "gitea.admin.password",
      defaultUsername: "gitea_admin",
    },
  },
  gitlab: {
    chart: "gitlab/gitlab",
    version: "7.0.0",
    defaultPort: 80,
    defaultValues: {},
    connectionTemplate: {
      defaultUsername: "root",
    },
  },
  forgejo: {
    chart: "codeberg/forgejo",
    version: "7.0.0",
    defaultPort: 3000,
    defaultValues: {},
    connectionTemplate: {
      defaultUsername: "admin",
    },
  },
  codeserver: {
    chart: "coder/code-server",
    version: "3.0.0",
    defaultPort: 8080,
    defaultValues: {},
    connectionTemplate: {
      passwordKey: "password",
    },
  },

  // Monitoring
  grafana: {
    chart: "grafana/grafana",
    version: "7.0.0",
    defaultPort: 3000,
    defaultValues: {
      adminUser: "admin",
    },
    connectionTemplate: {
      usernameKey: "adminUser",
      passwordKey: "adminPassword",
      defaultUsername: "admin",
    },
  },
  uptimekuma: {
    chart: "dirsigler/uptime-kuma",
    version: "2.0.0",
    defaultPort: 3001,
    defaultValues: {},
  },
  prometheus: {
    chart: "prometheus-community/prometheus",
    version: "25.0.0",
    defaultPort: 9090,
    defaultValues: {
      server: { persistentVolume: { enabled: false } },
    },
  },
  healthchecks: {
    chart: "healthchecks/healthchecks",
    version: "0.1.0",
    defaultPort: 8000,
    defaultValues: {},
  },

  // CMS
  ghost: {
    chart: "bitnami/ghost",
    version: "21.0.0",
    defaultPort: 2368,
    defaultValues: {},
    connectionTemplate: {
      usernameKey: "ghostEmail",
      passwordKey: "ghostPassword",
    },
  },
  strapi: {
    chart: "strapi/strapi",
    version: "0.1.0",
    defaultPort: 1337,
    defaultValues: {},
  },
  directus: {
    chart: "directus/directus",
    version: "10.0.0",
    defaultPort: 8055,
    defaultValues: {},
    connectionTemplate: {
      defaultUsername: "admin@example.com",
      passwordKey: "adminPassword",
    },
  },
  wordpress: {
    chart: "bitnami/wordpress",
    version: "22.0.0",
    defaultPort: 80,
    defaultValues: {},
    connectionTemplate: {
      usernameKey: "wordpressUsername",
      passwordKey: "wordpressPassword",
      defaultUsername: "user",
    },
  },

  // Communication
  mattermost: {
    chart: "mattermost/mattermost-team-edition",
    version: "6.0.0",
    defaultPort: 8065,
    defaultValues: {},
  },
  rocketchat: {
    chart: "rocketchat/rocketchat",
    version: "6.0.0",
    defaultPort: 3000,
    defaultValues: {},
  },
  listmonk: {
    chart: "listmonk/listmonk",
    version: "0.1.0",
    defaultPort: 9000,
    defaultValues: {},
    connectionTemplate: {
      defaultUsername: "listmonk",
      passwordKey: "adminPassword",
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
  password?: string;
  connectionString?: string;
};

export type TAddon = {
  _id?: ObjectId;
  name: string;
  type: TAddonType;
  namespace: string;
  releaseName: string;
  version: string;
  status: TAddonStatus;
  values: Record<string, any>;
  connectionInfo?: TAddonConnectionInfo;
  config?: Record<string, any>;  // User-provided config (replicas, TLS, users)
  organizationId?: ObjectId;
  lastError?: string;
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
  config?: Record<string, any>;
  organizationId?: string;
};

export type TAddonUpdateInput = {
  name?: string;
  version?: string;
  values?: Record<string, any>;
  config?: Record<string, any>;
};

// =============================================================================
// Joi Schemas
// =============================================================================

const schemaConnectionInfo = Joi.object({
  host: Joi.string().required(),
  port: Joi.number().integer().min(1).max(65535).required(),
  username: Joi.string().optional(),
  password: Joi.string().optional(),
  connectionString: Joi.string().optional(),
});

const schemaAddonBase = {
  name: Joi.string().min(1).max(100).pattern(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/).required()
    .messages({
      "string.pattern.base": "Name must be lowercase alphanumeric with optional hyphens, cannot start or end with a hyphen",
    }),
  type: Joi.string().valid(...addonTypes).required(),
  namespace: Joi.string().default("cp-addons"),
  version: Joi.string().optional(),
  values: Joi.object().default({}),
  config: Joi.object().default({}),
  organizationId: Joi.string().length(24).optional(),
};

export const schemaAddonCreate = Joi.object({
  ...schemaAddonBase,
});

export const schemaAddonUpdate = Joi.object<Partial<TAddonUpdateInput>>({
  name: Joi.string().min(1).max(100).pattern(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/).optional(),
  version: Joi.string().optional(),
  values: Joi.object().optional(),
  config: Joi.object().optional(),
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
    config: value.config || {},
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

/**
 * Get default port for an addon type.
 */
export function getAddonDefaultPort(type: TAddonType): number {
  return ADDON_CATALOG[type]?.defaultPort ?? 80;
}

/**
 * Check if an addon type is a database type (needs replica/TLS config).
 */
export function isDatabaseType(type: TAddonType): boolean {
  return ["mongodb", "mongodb-replicaset", "postgresql", "mysql", "mariadb", "clickhouse"].includes(type);
}

/**
 * Check if an addon type is a Redis-like type (needs cluster/password config).
 */
export function isRedisType(type: TAddonType): boolean {
  return ["redis", "keydb", "dragonfly"].includes(type);
}
