/**
 * useSSO — SSO configuration resource composable following control-plane-web pattern.
 *
 * Returns reactive state and API functions. No side effects on call.
 * API functions return raw promises — pages handle useLazyAsyncData wrapping.
 */
export default function useSSO() {
  const config = ref<TSSConfig>({
    _id: '',
    name: '',
    type: 'saml',
    status: 'pending',
    domain: '',
    isDefault: false
  })

  function getAll(options: { page?: number, search?: string } = {}) {
    return useNuxtApp().$api<{ items: TSSConfig[], pages: number }>('/sso/configs', {
      method: 'GET',
      query: { page: options.page ?? 1, search: options.search ?? '' }
    })
  }

  function getById(id: string) {
    return useNuxtApp().$api<{ config: TSSConfig }>(`/sso/configs/${id}`, {
      method: 'GET'
    })
  }

  function add(value: TSSOConfigForm) {
    return useNuxtApp().$api<{ message: string, configId: string }>('/sso/configs', {
      method: 'POST',
      body: value
    })
  }

  function updateById(id: string, value: Partial<TSSOConfigForm>) {
    return useNuxtApp().$api<{ message: string }>(`/sso/configs/${id}`, {
      method: 'PATCH',
      body: value
    })
  }

  function deleteById(id: string) {
    return useNuxtApp().$api<{ message: string }>(`/sso/configs/${id}`, {
      method: 'DELETE'
    })
  }

  function testConnection(id: string) {
    return useNuxtApp().$api<{ success: boolean, error?: string, details?: Record<string, unknown> }>(`/sso/configs/${id}/test`, {
      method: 'POST'
    })
  }

  function setDefault(id: string) {
    return useNuxtApp().$api<{ message: string }>(`/sso/configs/${id}/default`, {
      method: 'POST'
    })
  }

  function getMetadata(id: string) {
    return useNuxtApp().$api<{ metadata: string }>(`/sso/configs/${id}/metadata`, {
      method: 'GET'
    })
  }

  return {
    config,
    getAll,
    getById,
    add,
    updateById,
    deleteById,
    testConnection,
    setDefault,
    getMetadata
  }
}
