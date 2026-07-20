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

  function add(value: TDatabaseForm & {
    nodes: { serverId: string, role: string }[]
    config?: Record<string, unknown>
  }) {
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
        nodes: value.nodes,
        config: value.config ?? {},
      }
    })
  }

  function deleteById(id: string, options?: { keepData?: boolean, force?: boolean }) {
    const query: Record<string, string> = {}
    if (options?.keepData) query.keep_data = 'true'
    if (options?.force) query.force = 'true'
    return useNuxtApp().$api<{ message: string, databaseId: string, status: string }>(`/databases/${id}`, {
      method: 'DELETE',
      query
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

  function configureDNS(id: string) {
    return useNuxtApp().$api<{
      message: string
      clusterHost: string
      nodeHosts: string[]
      srvConnectionString: string
      recordCount: number
    }>(`/databases/${id}/dns`, { method: 'POST' })
  }

  function removeDNS(id: string) {
    return useNuxtApp().$api<{ message: string, removed?: number }>(`/databases/${id}/dns`, {
      method: 'DELETE'
    })
  }

  function getLogs(id: string) {
    return useNuxtApp().$api<{
      deployments: Array<{
        _id: string
        status: 'pending' | 'running' | 'success' | 'failed'
        logs?: string
        startedAt?: string
        completedAt?: string
        image?: string
      }>
    }>(`/databases/${id}/logs`, { method: 'GET' })
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
    getHealth,
    configureDNS,
    removeDNS,
    getLogs,
  }
}
