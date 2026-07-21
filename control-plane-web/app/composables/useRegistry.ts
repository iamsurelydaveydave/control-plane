/**
 * useRegistry — container registry resource composable following control-plane-web pattern.
 *
 * Returns reactive state and API functions. No side effects on call.
 * API functions return raw promises — pages handle useLazyAsyncData wrapping.
 */
export default function useRegistry() {
  const registry = ref<TRegistry>({
    _id: '',
    name: '',
    type: 'dockerhub',
    url: '',
    status: 'pending',
    isDefault: false
  })

  function getAll(options: { page?: number, search?: string } = {}) {
    return useNuxtApp().$api<{ items: TRegistry[], pages: number }>('/registries', {
      method: 'GET',
      query: { page: options.page ?? 1, search: options.search ?? '' }
    })
  }

  function getById(id: string) {
    return useNuxtApp().$api<{ registry: TRegistry }>(`/registries/${id}`, {
      method: 'GET'
    })
  }

  function add(value: TRegistryForm) {
    return useNuxtApp().$api<{ message: string, registryId: string }>('/registries', {
      method: 'POST',
      body: value
    })
  }

  function updateById(id: string, value: Partial<TRegistryForm>) {
    return useNuxtApp().$api<{ message: string }>(`/registries/${id}`, {
      method: 'PATCH',
      body: value
    })
  }

  function deleteById(id: string) {
    return useNuxtApp().$api<{ message: string }>(`/registries/${id}`, {
      method: 'DELETE'
    })
  }

  function verifyCredentials(id: string) {
    return useNuxtApp().$api<{ message: string, valid: boolean }>(`/registries/${id}/verify`, {
      method: 'POST'
    })
  }

  function setDefault(id: string) {
    return useNuxtApp().$api<{ message: string }>(`/registries/${id}/default`, {
      method: 'POST'
    })
  }

  return {
    registry,
    getAll,
    getById,
    add,
    updateById,
    deleteById,
    verifyCredentials,
    setDefault
  }
}
