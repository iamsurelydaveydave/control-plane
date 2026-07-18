/**
 * useApp — app resource composable following goweekdays-web pattern.
 *
 * Returns reactive state and API functions. No side effects on call.
 * API functions return raw promises — pages handle useLazyAsyncData wrapping.
 */
export default function useApp() {
  const app = ref<TApp>({
    _id: '',
    name: '',
    image: '',
    status: 'unknown',
    desiredReplicas: 1,
    serverIds: []
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

  function deploy(id: string) {
    return useNuxtApp().$api<{ message: string }>(`/apps/${id}/deploy`, {
      method: 'POST'
    })
  }

  return {
    app,
    getAll,
    getById,
    add,
    updateById,
    deleteById,
    deploy
  }
}
