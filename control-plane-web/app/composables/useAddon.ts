/**
 * useAddon — addon resource composable following control-plane-web pattern.
 *
 * Returns reactive state and API functions. No side effects on call.
 * API functions return raw promises — pages handle useLazyAsyncData wrapping.
 */
export default function useAddon() {
  const addon = ref<TAddon>({
    _id: '',
    name: '',
    type: 'redis',
    status: 'pending',
    namespace: 'default'
  })

  function getAll(options: { page?: number, search?: string } = {}) {
    return useNuxtApp().$api<{ items: TAddon[], pages: number }>('/addons', {
      method: 'GET',
      query: { page: options.page ?? 1, search: options.search ?? '' }
    })
  }

  function getById(id: string) {
    return useNuxtApp().$api<{ addon: TAddon }>(`/addons/${id}`, {
      method: 'GET'
    })
  }

  function add(value: TAddonForm) {
    return useNuxtApp().$api<{ message: string, addonId: string }>('/addons', {
      method: 'POST',
      body: value
    })
  }

  function deleteById(id: string) {
    return useNuxtApp().$api<{ message: string }>(`/addons/${id}`, {
      method: 'DELETE'
    })
  }

  function getConnectionInfo(id: string) {
    return useNuxtApp().$api<{ connectionInfo: TAddonConnectionInfo }>(`/addons/${id}/connection-info`, {
      method: 'GET'
    })
  }

  function start(id: string) {
    return useNuxtApp().$api<{ message: string }>(`/addons/${id}/start`, {
      method: 'POST'
    })
  }

  function stop(id: string) {
    return useNuxtApp().$api<{ message: string }>(`/addons/${id}/stop`, {
      method: 'POST'
    })
  }

  function restart(id: string) {
    return useNuxtApp().$api<{ message: string }>(`/addons/${id}/restart`, {
      method: 'POST'
    })
  }

  return {
    addon,
    getAll,
    getById,
    add,
    deleteById,
    getConnectionInfo,
    start,
    stop,
    restart
  }
}
