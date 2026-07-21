/**
 * useRoles — roles management composable
 *
 * Provides CRUD operations for roles and permission management.
 */
export default function useRoles() {
  const roles = useState<TRole[]>('roles', () => [])
  const loading = useState<boolean>('roles-loading', () => false)
  const allPermissions = useState<{
    permissions: TPermission[]
    grouped: Record<string, TPermission[]>
  } | null>('all-permissions', () => null)

  /**
   * Fetch all roles
   */
  async function fetchRoles(page = 1, limit = 50) {
    loading.value = true
    try {
      const data = await useNuxtApp().$api<{
        items: TRole[]
        total: number
        page: number
        limit: number
        totalPages: number
      }>('/roles', {
        method: 'GET',
        params: { page, limit }
      })
      roles.value = data.items
      return data
    } finally {
      loading.value = false
    }
  }

  /**
   * Get a single role by ID
   */
  async function getRole(id: string) {
    return await useNuxtApp().$api<TRole>(`/roles/${id}`, {
      method: 'GET'
    })
  }

  /**
   * Create a new role
   */
  async function createRole(role: {
    name: string
    description?: string
    permissions: TPermission[]
  }) {
    const data = await useNuxtApp().$api<{ message: string; roleId: string }>('/roles', {
      method: 'POST',
      body: role
    })
    await fetchRoles() // Refresh the list
    return data
  }

  /**
   * Update an existing role
   */
  async function updateRole(
    id: string,
    updates: {
      name?: string
      description?: string
      permissions?: TPermission[]
    }
  ) {
    const data = await useNuxtApp().$api<{ message: string }>(`/roles/${id}`, {
      method: 'PATCH',
      body: updates
    })
    await fetchRoles() // Refresh the list
    return data
  }

  /**
   * Delete a role
   */
  async function deleteRole(id: string) {
    const data = await useNuxtApp().$api<{ message: string }>(`/roles/${id}`, {
      method: 'DELETE'
    })
    await fetchRoles() // Refresh the list
    return data
  }

  /**
   * Fetch all available permissions
   */
  async function fetchPermissions() {
    if (allPermissions.value) {
      return allPermissions.value
    }

    const data = await useNuxtApp().$api<{
      permissions: TPermission[]
      grouped: Record<string, TPermission[]>
    }>('/roles/permissions', {
      method: 'GET'
    })
    allPermissions.value = data
    return data
  }

  /**
   * Get permissions for a specific user
   */
  async function getUserPermissions(userId: string) {
    return await useNuxtApp().$api<{
      userId: string
      permissions: TPermission[]
    }>(`/users/${userId}/permissions`, {
      method: 'GET'
    })
  }

  /**
   * Assign a role to a user
   */
  async function assignRoleToUser(userId: string, roleId: string | null) {
    return await useNuxtApp().$api<{ message: string }>(`/users/${userId}/role`, {
      method: 'PATCH',
      body: { roleId }
    })
  }

  return {
    // State
    roles,
    loading,
    allPermissions,

    // Methods
    fetchRoles,
    getRole,
    createRole,
    updateRole,
    deleteRole,
    fetchPermissions,
    getUserPermissions,
    assignRoleToUser
  }
}
