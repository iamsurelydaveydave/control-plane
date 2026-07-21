/**
 * useSecret — secret resource composable for Control Plane.
 *
 * Returns reactive state and API functions. No side effects on call.
 * API functions return raw promises — pages handle useLazyAsyncData wrapping.
 */
export default function useSecret() {
  function getAll(options: { appId?: string } = {}) {
    return useNuxtApp().$api<{ items: TSecret[] }>('/secrets', {
      method: 'GET',
      query: options.appId ? { appId: options.appId } : undefined
    })
  }

  function getGlobal() {
    return useNuxtApp().$api<{ items: TSecret[] }>('/secrets/global', {
      method: 'GET'
    })
  }

  function getById(id: string) {
    return useNuxtApp().$api<TSecret>(`/secrets/${id}`, {
      method: 'GET'
    })
  }

  function add(data: { name: string; value: string; type?: string; appId?: string; description?: string }) {
    return useNuxtApp().$api<{ message: string; secretId: string }>('/secrets', {
      method: 'POST',
      body: data
    })
  }

  function updateById(id: string, data: { value?: string; description?: string }) {
    return useNuxtApp().$api<{ message: string }>(`/secrets/${id}`, {
      method: 'PATCH',
      body: data
    })
  }

  function deleteById(id: string) {
    return useNuxtApp().$api<{ message: string }>(`/secrets/${id}`, {
      method: 'DELETE'
    })
  }

  return {
    getAll,
    getGlobal,
    getById,
    add,
    updateById,
    deleteById
  }
}
