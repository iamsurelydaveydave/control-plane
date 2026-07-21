/**
 * useCluster — cluster resource composable following control-plane-web pattern.
 *
 * Returns reactive state and API functions. No side effects on call.
 * API functions return raw promises — pages handle useLazyAsyncData wrapping.
 */
export default function useCluster() {
  const cluster = ref<TCluster>({
    _id: '',
    name: '',
    type: 'local',
    status: 'unknown',
    createdAt: '',
    updatedAt: ''
  })

  function getAll(options: { page?: number; search?: string } = {}) {
    return useNuxtApp().$api<{ items: TCluster[]; pages: number }>('/clusters', {
      method: 'GET',
      query: { page: options.page ?? 1, search: options.search ?? '' }
    })
  }

  function getById(id: string) {
    return useNuxtApp().$api<{ cluster: TCluster }>(`/clusters/${id}`, {
      method: 'GET'
    })
  }

  function add(value: TClusterForm) {
    return useNuxtApp().$api<{ message: string; clusterId: string }>('/clusters', {
      method: 'POST',
      body: value
    })
  }

  function updateById(id: string, value: Partial<TClusterForm>) {
    return useNuxtApp().$api<{ message: string }>(`/clusters/${id}`, {
      method: 'PATCH',
      body: value
    })
  }

  function deleteById(id: string) {
    return useNuxtApp().$api<{ message: string }>(`/clusters/${id}`, {
      method: 'DELETE'
    })
  }

  function sync(id: string) {
    return useNuxtApp().$api<{ message: string; cluster: TCluster }>(`/clusters/${id}/sync`, {
      method: 'POST'
    })
  }

  return {
    cluster,
    getAll,
    getById,
    add,
    updateById,
    deleteById,
    sync
  }
}
