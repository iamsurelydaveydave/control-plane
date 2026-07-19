/**
 * useDatabase — database resource composable following goweekdays-web pattern.
 *
 * Returns reactive state and API functions. No side effects on call.
 * API functions return raw promises — pages handle useLazyAsyncData wrapping.
 */
export default function useDatabase() {
  const database = ref<TDatabase>({
    _id: '',
    name: '',
    type: 'mongodb',
    version: '7.0',
    status: 'unknown'
  })

  function getAll(options: { page?: number, search?: string } = {}) {
    return useNuxtApp().$api<{ items: TDatabase[], pages: number }>('/databases', {
      method: 'GET',
      query: { page: options.page ?? 1, search: options.search ?? '' }
    })
  }

  function getById(id: string) {
    return useNuxtApp().$api<{ database: TDatabase }>(`/databases/${id}`, {
      method: 'GET'
    })
  }

  function add(value: TDatabaseForm & { nodes: { serverId: string, role: string }[] }) {
    return useNuxtApp().$api<{ message: string, databaseId: string }>('/databases', {
      method: 'POST',
      body: {
        name: value.name,
        type: value.type,
        version: value.version,
        credentials: {
          adminUser: value.adminUser,
          adminPassword: value.adminPassword
        },
        nodes: value.nodes
      }
    })
  }

  function deleteById(id: string, deleteRecord = true) {
    return useNuxtApp().$api<{ message: string }>(`/databases/${id}/remove`, {
      method: 'POST',
      body: { delete_record: deleteRecord }
    })
  }

  function reprovision(id: string) {
    return useNuxtApp().$api<{ message: string }>(`/databases/${id}/reprovision`, {
      method: 'POST'
    })
  }

  function getCredentials(id: string) {
    return useNuxtApp().$api<{ credentials: TDatabaseCredentials }>(`/databases/${id}/credentials`, {
      method: 'GET'
    })
  }

  function addNode(databaseId: string, serverId: string, role: 'secondary' | 'arbiter') {
    return useNuxtApp().$api<{ message: string }>(`/databases/${databaseId}/nodes`, {
      method: 'POST',
      body: { serverId, role }
    })
  }

  function removeNode(databaseId: string, serverId: string) {
    return useNuxtApp().$api<{ message: string }>(`/databases/${databaseId}/nodes/${serverId}`, {
      method: 'DELETE'
    })
  }

  function getHealth(id: string) {
    return useNuxtApp().$api<{ status: string, members: Array<{ host: string, state: string, health: number }> }>(`/databases/${id}/health`, {
      method: 'GET'
    })
  }

  return {
    database,
    getAll,
    getById,
    add,
    deleteById,
    reprovision,
    getCredentials,
    addNode,
    removeNode,
    getHealth
  }
}
