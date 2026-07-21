/**
 * useDeploymentApproval — composable for deployment approvals.
 *
 * Returns reactive state and API functions. No side effects on call.
 * API functions return raw promises — pages handle useLazyAsyncData wrapping.
 */
export default function useDeploymentApproval() {
  function getPending(options?: { page?: number; environment?: TDeploymentEnvironment }) {
    return useNuxtApp().$api<{
      items: TDeploymentApproval[]
      pages: number
      total: number
    }>('/deployments/approvals/pending', {
      method: 'GET',
      query: options
    })
  }

  function getById(id: string) {
    return useNuxtApp().$api<{ approval: TDeploymentApproval }>(`/deployments/${id}`, {
      method: 'GET'
    })
  }

  function approve(id: string) {
    return useNuxtApp().$api<{ message: string; deploymentId?: string }>(
      `/deployments/${id}/approve`,
      { method: 'POST' }
    )
  }

  function reject(id: string, reason?: string) {
    return useNuxtApp().$api<{ message: string }>(`/deployments/${id}/reject`, {
      method: 'POST',
      body: reason ? { reason } : undefined
    })
  }

  return {
    getPending,
    getById,
    approve,
    reject
  }
}
