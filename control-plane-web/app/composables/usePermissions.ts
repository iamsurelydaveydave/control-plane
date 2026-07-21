/**
 * usePermissions — RBAC permission checking composable
 *
 * Provides reactive permission checking based on the current user's permissions.
 * Works with the RBAC system implemented in control-plane-api.
 */
export default function usePermissions() {
  const { currentUser } = useAuth()

  /**
   * Check if the current user has a specific permission.
   * Considers admin:* as having all permissions.
   */
  function hasPermission(permission: TPermission): boolean {
    const permissions = currentUser.value?.permissions
    if (!permissions || !Array.isArray(permissions)) {
      return false
    }

    // Check for exact match
    if (permissions.includes(permission)) {
      return true
    }

    // Check for admin wildcard (admin:* grants all permissions)
    if (permissions.includes('admin:*')) {
      return true
    }

    return false
  }

  /**
   * Check if the current user can perform an action on a resource.
   * Shorthand for hasPermission(`${resource}:${action}`).
   *
   * @example
   * can('read', 'apps') // checks 'apps:read'
   * can('create', 'databases') // checks 'databases:create'
   */
  function can(action: string, resource: string): boolean {
    return hasPermission(`${resource}:${action}` as TPermission)
  }

  /**
   * Check if the current user has any of the specified permissions.
   */
  function hasAnyPermission(permissions: TPermission[]): boolean {
    return permissions.some(p => hasPermission(p))
  }

  /**
   * Check if the current user has all of the specified permissions.
   */
  function hasAllPermissions(permissions: TPermission[]): boolean {
    return permissions.every(p => hasPermission(p))
  }

  /**
   * Check if the current user is an admin (has admin:* permission).
   */
  const isAdmin = computed(() => hasPermission('admin:*'))

  // ---------------------------------------------------------------------------
  // Apps
  // ---------------------------------------------------------------------------
  const canReadApps = computed(() => hasPermission('apps:read'))
  const canCreateApps = computed(() => hasPermission('apps:create'))
  const canUpdateApps = computed(() => hasPermission('apps:update'))
  const canDeleteApps = computed(() => hasPermission('apps:delete'))
  const canDeployApps = computed(() => hasPermission('apps:deploy'))

  // ---------------------------------------------------------------------------
  // Databases
  // ---------------------------------------------------------------------------
  const canReadDatabases = computed(() => hasPermission('databases:read'))
  const canCreateDatabases = computed(() => hasPermission('databases:create'))
  const canUpdateDatabases = computed(() => hasPermission('databases:update'))
  const canDeleteDatabases = computed(() => hasPermission('databases:delete'))
  const canBackupDatabases = computed(() => hasPermission('databases:backup'))

  // ---------------------------------------------------------------------------
  // Addons (Helm-deployed services)
  // ---------------------------------------------------------------------------
  const canReadAddons = computed(() => hasPermission('addons:read'))
  const canCreateAddons = computed(() => hasPermission('addons:create'))
  const canUpdateAddons = computed(() => hasPermission('addons:update'))
  const canDeleteAddons = computed(() => hasPermission('addons:delete'))

  // ---------------------------------------------------------------------------
  // Pipelines (deployment stages and promotions)
  // ---------------------------------------------------------------------------
  const canReadPipelines = computed(() => hasPermission('pipelines:read'))
  const canCreatePipelines = computed(() => hasPermission('pipelines:create'))
  const canUpdatePipelines = computed(() => hasPermission('pipelines:update'))
  const canDeletePipelines = computed(() => hasPermission('pipelines:delete'))
  const canDeployPipelines = computed(() => hasPermission('pipelines:deploy'))
  const canApprovePipelines = computed(() => hasPermission('pipelines:approve'))

  // ---------------------------------------------------------------------------
  // Registries (container registries)
  // ---------------------------------------------------------------------------
  const canReadRegistries = computed(() => hasPermission('registries:read'))
  const canCreateRegistries = computed(() => hasPermission('registries:create'))
  const canUpdateRegistries = computed(() => hasPermission('registries:update'))
  const canDeleteRegistries = computed(() => hasPermission('registries:delete'))

  // ---------------------------------------------------------------------------
  // Pods (K8s pod operations)
  // ---------------------------------------------------------------------------
  const canReadPods = computed(() => hasPermission('pods:read'))
  const canExecPods = computed(() => hasPermission('pods:exec'))

  // ---------------------------------------------------------------------------
  // Nodes
  // ---------------------------------------------------------------------------
  const canReadNodes = computed(() => hasPermission('nodes:read'))
  const canCreateNodes = computed(() => hasPermission('nodes:create'))
  const canUpdateNodes = computed(() => hasPermission('nodes:update'))
  const canDeleteNodes = computed(() => hasPermission('nodes:delete'))

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------
  const canReadSettings = computed(() => hasPermission('settings:read'))
  const canUpdateSettings = computed(() => hasPermission('settings:update'))

  // ---------------------------------------------------------------------------
  // Users
  // ---------------------------------------------------------------------------
  const canReadUsers = computed(() => hasPermission('users:read'))
  const canCreateUsers = computed(() => hasPermission('users:create'))
  const canUpdateUsers = computed(() => hasPermission('users:update'))
  const canDeleteUsers = computed(() => hasPermission('users:delete'))

  // ---------------------------------------------------------------------------
  // Roles
  // ---------------------------------------------------------------------------
  const canReadRoles = computed(() => hasPermission('roles:read'))
  const canCreateRoles = computed(() => hasPermission('roles:create'))
  const canUpdateRoles = computed(() => hasPermission('roles:update'))
  const canDeleteRoles = computed(() => hasPermission('roles:delete'))

  // ---------------------------------------------------------------------------
  // Alerts
  // ---------------------------------------------------------------------------
  const canReadAlerts = computed(() => hasPermission('alerts:read'))
  const canAcknowledgeAlerts = computed(() => hasPermission('alerts:acknowledge'))
  const canResolveAlerts = computed(() => hasPermission('alerts:resolve'))

  // ---------------------------------------------------------------------------
  // Webhooks
  // ---------------------------------------------------------------------------
  const canReadWebhooks = computed(() => hasPermission('webhooks:read'))
  const canCreateWebhooks = computed(() => hasPermission('webhooks:create'))
  const canUpdateWebhooks = computed(() => hasPermission('webhooks:update'))
  const canDeleteWebhooks = computed(() => hasPermission('webhooks:delete'))

  // ---------------------------------------------------------------------------
  // Scheduled Tasks
  // ---------------------------------------------------------------------------
  const canReadTasks = computed(() => hasPermission('tasks:read'))
  const canCreateTasks = computed(() => hasPermission('tasks:create'))
  const canUpdateTasks = computed(() => hasPermission('tasks:update'))
  const canDeleteTasks = computed(() => hasPermission('tasks:delete'))

  return {
    // Methods
    hasPermission,
    can,
    hasAnyPermission,
    hasAllPermissions,

    // Computed
    isAdmin,

    // Apps
    canReadApps,
    canCreateApps,
    canUpdateApps,
    canDeleteApps,
    canDeployApps,

    // Databases
    canReadDatabases,
    canCreateDatabases,
    canUpdateDatabases,
    canDeleteDatabases,
    canBackupDatabases,

    // Addons
    canReadAddons,
    canCreateAddons,
    canUpdateAddons,
    canDeleteAddons,

    // Pipelines
    canReadPipelines,
    canCreatePipelines,
    canUpdatePipelines,
    canDeletePipelines,
    canDeployPipelines,
    canApprovePipelines,

    // Registries
    canReadRegistries,
    canCreateRegistries,
    canUpdateRegistries,
    canDeleteRegistries,

    // Pods
    canReadPods,
    canExecPods,

    // Nodes
    canReadNodes,
    canCreateNodes,
    canUpdateNodes,
    canDeleteNodes,

    // Settings
    canReadSettings,
    canUpdateSettings,

    // Users
    canReadUsers,
    canCreateUsers,
    canUpdateUsers,
    canDeleteUsers,

    // Roles
    canReadRoles,
    canCreateRoles,
    canUpdateRoles,
    canDeleteRoles,

    // Alerts
    canReadAlerts,
    canAcknowledgeAlerts,
    canResolveAlerts,

    // Webhooks
    canReadWebhooks,
    canCreateWebhooks,
    canUpdateWebhooks,
    canDeleteWebhooks,

    // Scheduled Tasks
    canReadTasks,
    canCreateTasks,
    canUpdateTasks,
    canDeleteTasks,
  }
}
