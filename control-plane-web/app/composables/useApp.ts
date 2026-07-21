/**
 * useApp — app resource composable for Kamal-based deployment.
 *
 * Returns reactive state and API functions. No side effects on call.
 * API functions return raw promises — pages handle useLazyAsyncData wrapping.
 */
export default function useApp() {
  const app = ref<TApp>({
    _id: '',
    name: '',
    image: '',
    status: 'pending',
    desiredReplicas: 1
  })

  function getAll(options: { page?: number, search?: string } = {}) {
    return useNuxtApp().$api<{ items: TApp[], pages: number }>('/apps', {
      method: 'GET',
      query: { page: options.page ?? 1, search: options.search ?? '' }
    })
  }

  function getById(id: string) {
    return useNuxtApp().$api<{ app: TApp }>(`/apps/${id}`, {
      method: 'GET'
    })
  }

  function add(value: TAppForm) {
    return useNuxtApp().$api<{ message: string, appId: string }>('/apps', {
      method: 'POST',
      body: value
    })
  }

  function updateById(id: string, value: Partial<TAppForm>) {
    return useNuxtApp().$api<{ message: string }>(`/apps/${id}`, {
      method: 'PATCH',
      body: value
    })
  }

  function deleteById(id: string) {
    return useNuxtApp().$api<{ message: string }>(`/apps/${id}`, {
      method: 'DELETE'
    })
  }

  function deploy(id: string, options?: { version?: string }) {
    return useNuxtApp().$api<{ message: string }>(`/apps/${id}/deploy`, {
      method: 'POST',
      body: options
    })
  }

  function redeploy(id: string) {
    return useNuxtApp().$api<{ message: string }>(`/apps/${id}/redeploy`, {
      method: 'POST'
    })
  }

  function rollback(id: string, version?: string) {
    return useNuxtApp().$api<{ message: string }>(`/apps/${id}/rollback`, {
      method: 'POST',
      body: version ? { version } : undefined
    })
  }

  function stop(id: string) {
    return useNuxtApp().$api<{ message: string }>(`/apps/${id}/stop`, {
      method: 'POST'
    })
  }

  function start(id: string) {
    return useNuxtApp().$api<{ message: string }>(`/apps/${id}/start`, {
      method: 'POST'
    })
  }

  function restart(id: string) {
    return useNuxtApp().$api<{ message: string }>(`/apps/${id}/restart`, {
      method: 'POST'
    })
  }

  function getLogs(id: string, lines?: number) {
    return useNuxtApp().$api<{ logs: string }>(`/apps/${id}/logs`, {
      method: 'GET',
      query: lines ? { lines } : undefined
    })
  }

  function getVersion(id: string) {
    return useNuxtApp().$api<{ version: string, image?: string }>(`/apps/${id}/version`, {
      method: 'GET'
    })
  }

  function exec(id: string, command: string) {
    return useNuxtApp().$api<{ output: string, exitCode: number }>(`/apps/${id}/exec`, {
      method: 'POST',
      body: { command }
    })
  }

  function getDeployments(id: string) {
    return useNuxtApp().$api<{
      deployments: Array<{
        _id: string
        status: 'pending' | 'running' | 'success' | 'failed'
        logs?: string
        startedAt?: string
        completedAt?: string
        image?: string
      }>
    }>(`/apps/${id}/deployments`, { method: 'GET' })
  }

  function getLatestDeployment(id: string) {
    return useNuxtApp().$api<TDeploymentLatest>(`/apps/${id}/deployments/latest`, {
      method: 'GET'
    })
  }

  function getDeploymentStatus(appId: string, deploymentId: string) {
    return useNuxtApp().$api<TDeploymentLatest>(
      `/apps/${appId}/deployments/${deploymentId}/status`,
      { method: 'GET' }
    )
  }

  function requestDeploymentApproval(
    id: string,
    params: { version: string; environment: TDeploymentEnvironment }
  ) {
    return useNuxtApp().$api<{ message: string; approvalId: string; status: string }>(
      `/apps/${id}/deploy/request`,
      { method: 'POST', body: params }
    )
  }

  function getApprovals(id: string, options?: { page?: number; limit?: number }) {
    return useNuxtApp().$api<{
      items: TDeploymentApproval[]
      pages: number
    }>(`/apps/${id}/approvals`, {
      method: 'GET',
      query: options
    })
  }

  function updateGitHubSettings(id: string, github: TAppGitHub) {
    return useNuxtApp().$api<{ message: string }>(`/apps/${id}`, {
      method: 'PATCH',
      body: { github }
    })
  }

  return {
    app,
    getAll,
    getById,
    add,
    updateById,
    deleteById,
    deploy,
    redeploy,
    rollback,
    stop,
    start,
    restart,
    getLogs,
    getDeployments,
    getLatestDeployment,
    getDeploymentStatus,
    requestDeploymentApproval,
    getApprovals,
    updateGitHubSettings,
    getVersion,
    exec
  }
}
