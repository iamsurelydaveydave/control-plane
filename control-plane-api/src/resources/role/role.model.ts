import Joi from "joi";
import { ObjectId } from "mongodb";
import { BadRequestError } from "../../utils";

/**
 * All available permissions in the Control Plane.
 * Format: `resource:action`
 */
export const permissions = [
  // Apps
  "apps:read",
  "apps:create",
  "apps:update",
  "apps:delete",
  "apps:deploy",
  // Databases
  "databases:read",
  "databases:create",
  "databases:update",
  "databases:delete",
  "databases:backup",
  // Addons (Helm-deployed services)
  "addons:read",
  "addons:create",
  "addons:update",
  "addons:delete",
  // Pipelines (deployment stages and promotions)
  "pipelines:read",
  "pipelines:create",
  "pipelines:update",
  "pipelines:delete",
  "pipelines:deploy",
  "pipelines:approve",
  // Registries (container registries)
  "registries:read",
  "registries:create",
  "registries:update",
  "registries:delete",
  // Pods (K8s pod operations)
  "pods:read",
  "pods:exec",
  // Nodes
  "nodes:read",
  "nodes:create",
  "nodes:update",
  "nodes:delete",
  // Settings
  "settings:read",
  "settings:update",
  // Users
  "users:read",
  "users:create",
  "users:update",
  "users:delete",
  // Roles
  "roles:read",
  "roles:create",
  "roles:update",
  "roles:delete",
  // Alerts
  "alerts:read",
  "alerts:acknowledge",
  "alerts:resolve",
  // Webhooks
  "webhooks:read",
  "webhooks:create",
  "webhooks:update",
  "webhooks:delete",
  // Scheduled Tasks
  "tasks:read",
  "tasks:create",
  "tasks:update",
  "tasks:delete",
  // Deployments
  "deployments:read",
  "deployments:update",
  // Organizations
  "organizations:read",
  "organizations:create",
  "organizations:update",
  "organizations:delete",
  // Monitoring
  "monitoring:read",
  // Admin (super admin - all permissions)
  "admin:*",
] as const;

export type TPermission = (typeof permissions)[number];

/**
 * Role type definition
 */
export type TRole = {
  _id?: ObjectId;
  name: string;
  description?: string;
  permissions: TPermission[];
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Default system roles. These are created on first setup and cannot be deleted.
 */
export const DEFAULT_ROLES: Omit<TRole, "_id" | "createdAt" | "updatedAt">[] = [
  {
    name: "admin",
    description: "Full administrative access to all resources",
    permissions: ["admin:*"],
    isSystem: true,
  },
  {
    name: "developer",
    description: "Can manage apps and pipelines, view databases, addons, and alerts",
    permissions: [
      "apps:read",
      "apps:create",
      "apps:update",
      "apps:delete",
      "apps:deploy",
      "pipelines:read",
      "pipelines:create",
      "pipelines:update",
      "pipelines:deploy",
      "deployments:read",
      "deployments:update",
      "databases:read",
      "addons:read",
      "registries:read",
      "pods:read",
      "pods:exec",
      "alerts:read",
      "alerts:acknowledge",
      "monitoring:read",
    ],
    isSystem: true,
  },
  {
    name: "viewer",
    description: "Read-only access to apps, databases, nodes, pipelines, and alerts",
    permissions: [
      "apps:read",
      "databases:read",
      "addons:read",
      "pipelines:read",
      "deployments:read",
      "registries:read",
      "nodes:read",
      "pods:read",
      "alerts:read",
      "monitoring:read",
    ],
    isSystem: true,
  },
  {
    name: "operator",
    description: "Can manage infrastructure: nodes, databases, addons, registries, and approve pipelines",
    permissions: [
      "apps:read",
      "databases:read",
      "databases:create",
      "databases:update",
      "databases:delete",
      "databases:backup",
      "addons:read",
      "addons:create",
      "addons:update",
      "addons:delete",
      "pipelines:read",
      "pipelines:approve",
      "deployments:read",
      "deployments:update",
      "registries:read",
      "registries:create",
      "registries:update",
      "registries:delete",
      "nodes:read",
      "nodes:create",
      "nodes:update",
      "nodes:delete",
      "pods:read",
      "pods:exec",
      "alerts:read",
      "alerts:acknowledge",
      "alerts:resolve",
      "monitoring:read",
      "tasks:read",
      "tasks:update",
    ],
    isSystem: true,
  },
];

/**
 * Joi schema for creating a role
 */
export const schemaRoleCreate = Joi.object<Omit<TRole, "_id" | "createdAt" | "updatedAt">>({
  name: Joi.string().min(2).max(50).required(),
  description: Joi.string().max(255).optional().allow(""),
  permissions: Joi.array()
    .items(Joi.string().valid(...permissions))
    .min(1)
    .required(),
  isSystem: Joi.boolean().default(false),
});

/**
 * Joi schema for updating a role
 */
export const schemaRoleUpdate = Joi.object<Partial<Omit<TRole, "_id" | "createdAt" | "updatedAt" | "isSystem">>>({
  name: Joi.string().min(2).max(50).optional(),
  description: Joi.string().max(255).optional().allow(""),
  permissions: Joi.array()
    .items(Joi.string().valid(...permissions))
    .min(1)
    .optional(),
});

/**
 * Model function to validate and normalize role data for creation.
 */
export function modelRole(data: Partial<TRole>): Omit<TRole, "_id"> {
  const { error, value } = schemaRoleCreate.validate(data);

  if (error) {
    throw new BadRequestError(`Role validation error: ${error.message}`);
  }

  return {
    name: value.name,
    description: value.description || "",
    permissions: value.permissions,
    isSystem: value.isSystem ?? false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Check if a permission matches (considers wildcard patterns).
 * Examples:
 * - hasPermissionMatch("admin:*", "apps:read") -> true (admin has all)
 * - hasPermissionMatch("apps:read", "apps:read") -> true (exact match)
 * - hasPermissionMatch("apps:read", "apps:create") -> false (different action)
 */
export function hasPermissionMatch(
  userPermission: TPermission,
  requiredPermission: TPermission
): boolean {
  // Exact match
  if (userPermission === requiredPermission) {
    return true;
  }

  // admin:* grants everything
  if (userPermission === "admin:*") {
    return true;
  }

  return false;
}

/**
 * Check if a list of permissions includes the required permission.
 */
export function hasPermission(
  userPermissions: TPermission[],
  requiredPermission: TPermission
): boolean {
  return userPermissions.some((p) => hasPermissionMatch(p, requiredPermission));
}
