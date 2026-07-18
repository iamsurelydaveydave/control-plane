/**
 * useSSHKey — SSH key resource composable.
 *
 * Returns reactive state and API functions. No side effects on call.
 */
export default function useSSHKey() {
  function getAll() {
    return useNuxtApp().$api<{ items: TSSHKey[] }>('/ssh-keys', {
      method: 'GET'
    })
  }

  function getById(id: string) {
    return useNuxtApp().$api<TSSHKey>(`/ssh-keys/${id}`, {
      method: 'GET'
    })
  }

  function create(data: TSSHKeyCreate) {
    return useNuxtApp().$api<TSSHKey & { privateKey: string, message: string }>('/ssh-keys', {
      method: 'POST',
      body: data
    })
  }

  function importKey(data: TSSHKeyImport) {
    return useNuxtApp().$api<TSSHKey>('/ssh-keys/import', {
      method: 'POST',
      body: data
    })
  }

  function updateById(id: string, data: TSSHKeyUpdate) {
    return useNuxtApp().$api<{ message: string }>(`/ssh-keys/${id}`, {
      method: 'PATCH',
      body: data
    })
  }

  function deleteById(id: string) {
    return useNuxtApp().$api<{ message: string }>(`/ssh-keys/${id}`, {
      method: 'DELETE'
    })
  }

  function setDefault(id: string) {
    return useNuxtApp().$api<{ message: string }>(`/ssh-keys/${id}/default`, {
      method: 'POST'
    })
  }

  return {
    getAll,
    getById,
    create,
    importKey,
    updateById,
    deleteById,
    setDefault
  }
}
