/**
 * useAPIToken — API token resource composable.
 *
 * Returns reactive state and API functions. No side effects on call.
 */
export default function useAPIToken() {
  function getAll() {
    return useNuxtApp().$api<{ items: TAPIToken[] }>('/api-tokens', {
      method: 'GET'
    })
  }

  function getScopes() {
    return useNuxtApp().$api<{ scopes: TAPITokenScope[] }>('/api-tokens/scopes', {
      method: 'GET'
    })
  }

  function create(data: TAPITokenCreate) {
    return useNuxtApp().$api<TAPIToken & { token: string, message: string }>('/api-tokens', {
      method: 'POST',
      body: data
    })
  }

  function deleteById(id: string) {
    return useNuxtApp().$api<{ message: string }>(`/api-tokens/${id}`, {
      method: 'DELETE'
    })
  }

  return {
    getAll,
    getScopes,
    create,
    deleteById
  }
}
