/**
 * useAlerts — alert resource composable.
 *
 * Returns reactive state and API functions. No side effects on call.
 * API functions return raw promises — pages handle useLazyAsyncData wrapping.
 */
export default function useAlerts() {
  const alert = ref<TAlert>({
    _id: '',
    title: '',
    message: '',
    severity: 'info',
    status: 'active',
    source: 'system',
    createdAt: ''
  })

  function getAll(options: TAlertFilters = {}) {
    return useNuxtApp().$api<{ items: TAlert[], pages: number, total: number }>('/alerts', {
      method: 'GET',
      query: {
        page: options.page ?? 1,
        severity: options.severity,
        status: options.status,
        source: options.source,
        search: options.search ?? ''
      }
    })
  }

  function getById(id: string) {
    return useNuxtApp().$api<{ alert: TAlert }>(`/alerts/${id}`, {
      method: 'GET'
    })
  }

  function getActiveCount() {
    return useNuxtApp().$api<{ count: number }>('/alerts/active-count', {
      method: 'GET'
    })
  }

  function acknowledge(id: string) {
    return useNuxtApp().$api<{ message: string, alert: TAlert }>(`/alerts/${id}/acknowledge`, {
      method: 'POST'
    })
  }

  function resolve(id: string) {
    return useNuxtApp().$api<{ message: string, alert: TAlert }>(`/alerts/${id}/resolve`, {
      method: 'POST'
    })
  }

  function bulkAcknowledge(ids: string[]) {
    return useNuxtApp().$api<{ message: string, updated: number }>('/alerts/bulk-acknowledge', {
      method: 'POST',
      body: { ids }
    })
  }

  function bulkResolve(ids: string[]) {
    return useNuxtApp().$api<{ message: string, updated: number }>('/alerts/bulk-resolve', {
      method: 'POST',
      body: { ids }
    })
  }

  return {
    alert,
    getAll,
    getById,
    getActiveCount,
    acknowledge,
    resolve,
    bulkAcknowledge,
    bulkResolve
  }
}
