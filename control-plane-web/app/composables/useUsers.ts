/**
 * useUsers — user management composable
 *
 * Provides CRUD operations for users and role assignment.
 */
export default function useUsers() {
  const users = useState<TUser[]>('users', () => [])
  const loading = useState<boolean>('users-loading', () => false)

  /**
   * Fetch all users
   */
  async function fetchUsers(page = 1, limit = 20) {
    loading.value = true
    try {
      const data = await useNuxtApp().$api<{
        items: TUser[]
        total: number
        page: number
        limit: number
        totalPages: number
      }>('/users', {
        method: 'GET',
        params: { page, limit }
      })
      users.value = data.items
      return data
    } finally {
      loading.value = false
    }
  }

  /**
   * Get a single user by ID (with role info)
   */
  async function getUser(id: string) {
    return await useNuxtApp().$api<TUser & {
      roleName?: string
      permissions: TPermission[]
    }>(`/users/${id}`, {
      method: 'GET'
    })
  }

  /**
   * Create a new user
   */
  async function createUser(user: {
    email: string
    password: string
    roleId?: string
  }) {
    const data = await useNuxtApp().$api<{ message: string; userId: string }>('/users', {
      method: 'POST',
      body: user
    })
    await fetchUsers() // Refresh the list
    return data
  }

  /**
   * Update an existing user
   */
  async function updateUser(
    id: string,
    updates: {
      email?: string
      password?: string
      roleId?: string | null
      customPermissions?: TPermission[]
    }
  ) {
    const data = await useNuxtApp().$api<{ message: string }>(`/users/${id}`, {
      method: 'PATCH',
      body: updates
    })
    await fetchUsers() // Refresh the list
    return data
  }

  /**
   * Delete a user
   */
  async function deleteUser(id: string) {
    const data = await useNuxtApp().$api<{ message: string }>(`/users/${id}`, {
      method: 'DELETE'
    })
    await fetchUsers() // Refresh the list
    return data
  }

  /**
   * Assign a role to a user
   */
  async function assignRole(userId: string, roleId: string | null) {
    const data = await useNuxtApp().$api<{ message: string }>(`/users/${userId}/role`, {
      method: 'PATCH',
      body: { roleId }
    })
    await fetchUsers() // Refresh the list
    return data
  }

  /**
   * Get effective permissions for a user
   */
  async function getPermissions(userId: string) {
    return await useNuxtApp().$api<{
      userId: string
      permissions: TPermission[]
    }>(`/users/${userId}/permissions`, {
      method: 'GET'
    })
  }

  return {
    // State
    users,
    loading,

    // Methods
    fetchUsers,
    getUser,
    createUser,
    updateUser,
    deleteUser,
    assignRole,
    getPermissions
  }
}
