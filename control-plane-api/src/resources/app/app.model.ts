import Joi from "joi";
import { ObjectId } from "mongodb";
import { BadRequestError } from "../../utils";

// =============================================================================
// Status & Enums
// =============================================================================

export const appStatuses = [
  "pending",      // Created but never deployed
  "deploying",    // Deployment in progress
  "running",      // Successfully deployed and running
  "stopped",      // Manually stopped
  "failed",       // Last deployment failed
] as const;
export type TAppStatus = (typeof appStatuses)[number];

export const sourceTypes = ["image", "git"] as const;
export type TSourceType = (typeof sourceTypes)[number];

export const appEnvironments = ["development", "staging", "production"] as const;
export type TAppEnvironment = (typeof appEnvironments)[number];

// =============================================================================
// Source Configuration
// =============================================================================

export type TAppSource = {
  type: TSourceType;
  // For pre-built images
  image?: string;              // e.g., "ghcr.io/user/myapp:latest"
  // For git-based builds
  gitUrl?: string;             // e.g., "https://github.com/user/repo.git"
  gitBranch?: string;          // e.g., "main"
  dockerfile?: string;         // e.g., "Dockerfile" or "Dockerfile.production"
  buildContext?: string;       // e.g., "." or "./app"
  buildArgs?: Record<string, string>; // Build-time arguments
};

// =============================================================================
// Registry Configuration
// =============================================================================

export type TAppRegistry = {
  server: string;              // e.g., "ghcr.io", "docker.io", "registry.example.com"
  username: string;
  password: string;            // Will be encrypted at rest
};

// =============================================================================
// Proxy Configuration (kamal-proxy)
// =============================================================================

export type TAppProxy = {
  ssl: boolean;                // Enable automatic SSL via Let's Encrypt
  host: string;                // Domain for the app (e.g., "myapp.example.com")
  appPort: number;             // Container port (default 3000)
  healthcheckPath?: string;    // e.g., "/up" or "/health"
  healthcheckInterval?: number; // Seconds between health checks (default 3)
  responseTimeout?: number;    // Seconds to wait for response (default 30)
  buffering?: {
    requests: boolean;         // Buffer request bodies
    responses: boolean;        // Buffer response bodies
    maxRequestBody?: number;   // Max request body size in bytes
    maxResponseBody?: number;  // Max response body size in bytes
  };
};

// =============================================================================
// Deploy Configuration
// =============================================================================

export type TAppDeploy = {
  timeout?: number;            // Deploy timeout in seconds (default 30)
  drainTimeout?: number;       // Time to drain connections before stopping (default 30)
  readinessDelay?: number;     // Seconds to wait after container starts (default 7)
  stopTimeout?: number;        // Time to wait after SIGTERM (default 10)
};

// =============================================================================
// Resources Configuration
// =============================================================================

export type TAppResources = {
  memory?: string;             // e.g., "512m", "1g"
  cpus?: number;               // e.g., 0.5, 1, 2
};

// =============================================================================
// Health Check Configuration
// =============================================================================

export type TAppHealthCheck = {
  path: string;                // e.g., "/health"
  port?: number;               // Port to check (defaults to appPort)
  interval?: number;           // Seconds between checks
  timeout?: number;            // Seconds to wait for response
  startPeriod?: number;        // Seconds to wait before starting checks
  retries?: number;            // Number of retries before unhealthy
};

// =============================================================================
// Volume Configuration
// =============================================================================

export type TAppVolume = {
  host: string;                // Path on host
  container: string;           // Path in container
  readonly?: boolean;
};

// =============================================================================
// GitHub Integration Configuration
// =============================================================================

export type TAppGitHub = {
  enabled: boolean;
  owner: string;              // GitHub repository owner
  repo: string;               // GitHub repository name
  branch?: string;            // Branch to deploy from (default: main)
  autoDeployOnPush?: boolean; // Auto-deploy when push to branch
  installationId?: string;    // GitHub App installation ID
};

// =============================================================================
// K8s Configuration
// =============================================================================

export type TAppK8sConfig = {
  replicas: number;            // Number of pod replicas (default 1)
  image: string;               // Full image URL (e.g., "ghcr.io/user/myapp:latest")
  port: number;                // Container port (default 3000)
  domain?: string;             // Domain for Ingress routing
  envVars: Record<string, string>; // Environment variables for K8s Secret
  resourceRequests?: {
    memory: string;            // e.g., "128Mi"
    cpu: string;               // e.g., "100m"
  };
  resourceLimits?: {
    memory: string;            // e.g., "512Mi"
    cpu: string;               // e.g., "500m"
  };
};

// =============================================================================
// Main App Type
// =============================================================================

export type TApp = {
  _id?: ObjectId;
  organizationId?: ObjectId;   // Organization this app belongs to (multi-tenancy)
  name: string;                // Unique app name (used as service name)
  
  // Source & Registry
  source: TAppSource;
  registry?: TAppRegistry;     // Inline registry config (legacy, prefer registryId)
  registryId?: ObjectId;       // Reference to cp_registries collection
  
  // Deployment target (legacy - kept for backward compat)
  serverIds: ObjectId[];       // Servers to deploy to
  
  // Proxy & Domain
  proxy?: TAppProxy;
  
  // Environment
  env: Record<string, string>; // Clear environment variables
  secretNames: string[];       // Names of secrets to inject (from secret store)
  
  // Resources & Limits
  resources?: TAppResources;
  healthCheck?: TAppHealthCheck;
  volumes?: TAppVolume[];
  
  // Deploy options
  deploy?: TAppDeploy;
  
  // Labels (for container metadata)
  labels?: Record<string, string>;
  
  // K8s Configuration
  k8s?: TAppK8sConfig;         // Kubernetes-specific deployment config
  
  // GitHub Integration
  github?: TAppGitHub;         // GitHub repository settings for CI/CD
  
  // Environment
  environment?: TAppEnvironment; // Deployment environment (dev/staging/prod)
  requireApproval?: boolean;   // Require approval for deployments
  
  // State
  status: TAppStatus;
  currentVersion?: string;     // Currently deployed image tag/SHA
  currentImage?: string;       // Full image URL of current deployment
  desiredReplicas?: number;    // Desired replica count (stored for stop/start)
  
  // Timestamps
  createdAt?: Date;
  updatedAt?: Date;
  deployedAt?: Date;           // Last successful deployment
};

// =============================================================================
// Joi Schemas
// =============================================================================

const schemaSource = Joi.object({
  type: Joi.string().valid(...sourceTypes).required(),
  image: Joi.string().when('type', {
    is: 'image',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  gitUrl: Joi.string().uri().when('type', {
    is: 'git',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  gitBranch: Joi.string().default('main'),
  dockerfile: Joi.string().default('Dockerfile'),
  buildContext: Joi.string().default('.'),
  buildArgs: Joi.object().pattern(Joi.string(), Joi.string()).optional(),
});

const schemaRegistry = Joi.object({
  server: Joi.string().required(),
  username: Joi.string().required(),
  password: Joi.string().required(),
});

const schemaProxy = Joi.object({
  ssl: Joi.boolean().default(true),
  host: Joi.string().required(),
  appPort: Joi.number().default(3000),
  healthcheckPath: Joi.string().optional(),
  healthcheckInterval: Joi.number().default(3),
  responseTimeout: Joi.number().default(30),
  buffering: Joi.object({
    requests: Joi.boolean().default(true),
    responses: Joi.boolean().default(true),
    maxRequestBody: Joi.number().optional(),
    maxResponseBody: Joi.number().optional(),
  }).optional(),
});

const schemaDeploy = Joi.object({
  timeout: Joi.number().default(30),
  drainTimeout: Joi.number().default(30),
  readinessDelay: Joi.number().default(7),
  stopTimeout: Joi.number().default(10),
});

const schemaResources = Joi.object({
  memory: Joi.string().optional(),
  cpus: Joi.number().optional(),
});

const schemaHealthCheck = Joi.object({
  path: Joi.string().required(),
  port: Joi.number().optional(),
  interval: Joi.number().default(30),
  timeout: Joi.number().default(5),
  startPeriod: Joi.number().default(0),
  retries: Joi.number().default(3),
});

const schemaVolume = Joi.object({
  host: Joi.string().required(),
  container: Joi.string().required(),
  readonly: Joi.boolean().default(false),
});

// =============================================================================
// K8s Config Schema
// =============================================================================

const schemaK8sConfig = Joi.object({
  replicas: Joi.number().min(0).default(1),
  image: Joi.string().required(),
  port: Joi.number().default(3000),
  domain: Joi.string().optional(),
  envVars: Joi.object().pattern(Joi.string(), Joi.string()).default({}),
  resourceRequests: Joi.object({
    memory: Joi.string().default("128Mi"),
    cpu: Joi.string().default("100m"),
  }).optional(),
  resourceLimits: Joi.object({
    memory: Joi.string().default("512Mi"),
    cpu: Joi.string().default("500m"),
  }).optional(),
});

// =============================================================================
// GitHub Config Schema
// =============================================================================

const schemaGitHubConfig = Joi.object({
  enabled: Joi.boolean().default(false),
  owner: Joi.string().when("enabled", {
    is: true,
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  repo: Joi.string().when("enabled", {
    is: true,
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  branch: Joi.string().default("main"),
  autoDeployOnPush: Joi.boolean().default(false),
  installationId: Joi.string().optional(),
});

// =============================================================================
// Create Schema
// =============================================================================

export const schemaAppCreate = Joi.object({
  organizationId: Joi.string().length(24).optional(), // Optional for backwards compat
  name: Joi.string()
    .max(63)
    .pattern(/^[a-z][a-z0-9-]*[a-z0-9]$/)
    .required()
    .messages({
      'string.pattern.base': 'App name must start with a letter, contain only lowercase letters, numbers, and hyphens, and end with a letter or number',
    }),
  source: schemaSource.required(),
  registry: schemaRegistry.optional(),
  registryId: Joi.string().optional(),
  serverIds: Joi.array().items(Joi.string()).min(0).default([]), // Optional now (K8s doesn't need servers)
  proxy: schemaProxy.optional(),
  env: Joi.object().pattern(Joi.string(), Joi.string()).default({}),
  secretNames: Joi.array().items(Joi.string()).default([]),
  resources: schemaResources.optional(),
  healthCheck: schemaHealthCheck.optional(),
  volumes: Joi.array().items(schemaVolume).default([]),
  deploy: schemaDeploy.optional(),
  labels: Joi.object().pattern(Joi.string(), Joi.string()).optional(),
  k8s: schemaK8sConfig.optional(), // K8s-specific config
  github: schemaGitHubConfig.optional(), // GitHub integration
  environment: Joi.string().valid(...appEnvironments).optional(),
  requireApproval: Joi.boolean().default(false),
});

// =============================================================================
// Update Schema
// =============================================================================

export const schemaAppUpdate = Joi.object({
  organizationId: Joi.string().length(24).optional(),
  name: Joi.string()
    .max(63)
    .pattern(/^[a-z][a-z0-9-]*[a-z0-9]$/)
    .optional(),
  source: schemaSource.optional(),
  registry: schemaRegistry.optional().allow(null),
  registryId: Joi.string().optional().allow(null),
  serverIds: Joi.array().items(Joi.string()).min(0).optional(),
  proxy: schemaProxy.optional().allow(null),
  env: Joi.object().pattern(Joi.string(), Joi.string()).optional(),
  secretNames: Joi.array().items(Joi.string()).optional(),
  resources: schemaResources.optional().allow(null),
  healthCheck: schemaHealthCheck.optional().allow(null),
  volumes: Joi.array().items(schemaVolume).optional(),
  deploy: schemaDeploy.optional().allow(null),
  labels: Joi.object().pattern(Joi.string(), Joi.string()).optional().allow(null),
  k8s: schemaK8sConfig.optional().allow(null), // K8s-specific config
  github: schemaGitHubConfig.optional().allow(null), // GitHub integration
  environment: Joi.string().valid(...appEnvironments).optional(),
  requireApproval: Joi.boolean().optional(),
});

// =============================================================================
// Deploy Schema
// =============================================================================

export const schemaAppDeploy = Joi.object({
  version: Joi.string().optional(), // Specific version/tag to deploy
  force: Joi.boolean().default(false), // Force deploy even if same version
  environment: Joi.string().valid(...appEnvironments).optional(), // Target environment
});

// =============================================================================
// Scale Schema (for future use)
// =============================================================================

export const schemaAppScale = Joi.object({
  replicas: Joi.number().min(0).required(),
});

// =============================================================================
// Model Function
// =============================================================================

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

  // Convert registryId if present
  const registryId = value.registryId ? new ObjectId(value.registryId) : undefined;

  // Convert organizationId if present
  let organizationId: ObjectId | undefined;
  if (value.organizationId) {
    try {
      organizationId = new ObjectId(value.organizationId);
    } catch {
      throw new BadRequestError(`Invalid organizationId format: ${value.organizationId}`);
    }
  }

  return {
    _id: data._id,
    organizationId,
    name: value.name,
    source: value.source,
    registry: value.registry,
    registryId,
    serverIds,
    proxy: value.proxy,
    env: value.env,
    secretNames: value.secretNames,
    resources: value.resources,
    healthCheck: value.healthCheck,
    volumes: value.volumes,
    deploy: value.deploy,
    labels: value.labels,
    k8s: value.k8s,
    github: value.github,
    environment: value.environment,
    requireApproval: value.requireApproval ?? false,
    status: "pending",
    desiredReplicas: value.k8s?.replicas ?? 1,
    createdAt: data.createdAt ?? new Date(),
    updatedAt: data.updatedAt ?? new Date(),
  };
}
