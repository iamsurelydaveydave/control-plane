/**
 * useServer — server resource composable following goweekdays-web pattern.
 *
 * Returns reactive state and API functions. No side effects on call.
 * API functions return raw promises — pages handle useLazyAsyncData wrapping.
 */
export default function useServer() {
  const server = ref<TServer>({
    _id: '',
    name: '',
    host: '',
    status: 'unknown',
    provider: '',
    sshUser: 'root',
    sshPort: 22
  })

  function getAll(options: { page?: number, search?: string } = {}) {
    return useNuxtApp().$api<{ items: TServer[], pages: number }>('/servers', {
      method: 'GET',
      query: { page: options.page ?? 1, search: options.search ?? '' }
    })
  }

  function getById(id: string) {
    return useNuxtApp().$api<{ server: TServer }>(`/servers/${id}`, {
      method: 'GET'
    })
  }

  function add(value: TServerForm) {
    return useNuxtApp().$api<{ message: string, serverId: string }>('/servers', {
      method: 'POST',
      body: value
    })
  }

  function updateById(id: string, value: Partial<TServerForm>) {
    return useNuxtApp().$api<{ message: string }>(`/servers/${id}`, {
      method: 'PATCH',
      body: value
    })
  }

  function deleteById(id: string) {
    return useNuxtApp().$api<{ message: string }>(`/servers/${id}`, {
      method: 'DELETE'
    })
  }

  function testConnection(params: { host: string, sshUser: string, sshPort: number, sshKeyId: string }) {
    return useNuxtApp().$api<{ success: boolean, error?: string, serverInfo?: { os: string, hostname: string, uptime: string } }>('/servers/test-connection', {
      method: 'POST',
      body: params
    })
  }

  function validate(id: string) {
    return useNuxtApp().$api<{ success: boolean, error?: string, serverInfo?: { os: string, hostname: string, uptime: string } }>(`/servers/${id}/validate`, {
      method: 'POST'
    })
  }

  function checkHealth(id: string) {
    return useNuxtApp().$api<{
      success: boolean
      error?: string
      serverInfo?: { os: string, hostname: string, uptime: string }
      resources?: TServerResources
      healthChecks: THealthCheck[]
    }>(`/servers/${id}/check-health`, {
      method: 'POST'
    })
  }

  /** Kick off async server setup (Docker + firewall + system info). Returns immediately. */
  function setupServer(id: string) {
    return useNuxtApp().$api<{ message: string, setupStatus: string }>(`/servers/${id}/setup`, {
      method: 'POST'
    })
  }

  /** Poll for setup progress — returns step log and current status. */
  function getSetupStatus(id: string) {
    return useNuxtApp().$api<TSetupStatusResponse>(`/servers/${id}/setup-status`, {
      method: 'GET'
    })
  }

  /** List apps deployed to this server. */
  function getServerApps(id: string) {
    return useNuxtApp().$api<{ items: TApp[], total: number }>(`/servers/${id}/apps`, { method: 'GET' })
  }

  /** List databases hosted on this server. */
  function getServerDatabases(id: string) {
    return useNuxtApp().$api<{ items: TDatabase[], total: number }>(`/servers/${id}/databases`, { method: 'GET' })
  }

  return {
    server,
    getAll,
    getById,
    add,
    updateById,
    deleteById,
    testConnection,
    validate,
    checkHealth,
    setupServer,
    getSetupStatus,
    getServerApps,
    getServerDatabases
  }
}
