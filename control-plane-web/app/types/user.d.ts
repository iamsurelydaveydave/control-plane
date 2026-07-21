/**
 * All available permissions in the Control Plane.
 * Format: `resource:action`
 */
declare type TPermission =
  // Apps
  | 'apps:read'
  | 'apps:create'
  | 'apps:update'
  | 'apps:delete'
  | 'apps:deploy'
  // Addons / Resources (Helm-deployed services — databases, caches, analytics)
  | 'addons:read'
  | 'addons:create'
  | 'addons:update'
  | 'addons:delete'
  // Pipelines (deployment stages and promotions)
  | 'pipelines:read'
  | 'pipelines:create'
  | 'pipelines:update'
  | 'pipelines:delete'
  | 'pipelines:deploy'
  | 'pipelines:approve'
  // Registries (container registries)
  | 'registries:read'
  | 'registries:create'
  | 'registries:update'
  | 'registries:delete'
  // Pods (K8s pod operations)
  | 'pods:read'
  | 'pods:exec'
  // Nodes
  | 'nodes:read'
  | 'nodes:create'
  | 'nodes:update'
  | 'nodes:delete'
  // Settings
  | 'settings:read'
  | 'settings:update'
  // Users
  | 'users:read'
  | 'users:create'
  | 'users:update'
  | 'users:delete'
  // Roles
  | 'roles:read'
  | 'roles:create'
  | 'roles:update'
  | 'roles:delete'
  // Alerts
  | 'alerts:read'
  | 'alerts:acknowledge'
  | 'alerts:resolve'
  // Webhooks
  | 'webhooks:read'
  | 'webhooks:create'
  | 'webhooks:update'
  | 'webhooks:delete'
  // Scheduled Tasks
  | 'tasks:read'
  | 'tasks:create'
  | 'tasks:update'
  | 'tasks:delete'
  // Admin (super admin - all permissions)
  | 'admin:*'

declare type TUser = {
  _id: string
  email: string
  role: string // Legacy field
  roleId?: string
  roleName?: string
  customPermissions?: TPermission[]
  permissions?: TPermission[] // Effective permissions (from role + custom)
}

declare type TRole = {
  _id: string
  name: string
  description?: string
  permissions: TPermission[]
  isSystem: boolean
  createdAt: string
  updatedAt: string
}
