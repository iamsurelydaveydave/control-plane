/**
 * useNode — node resource composable for Kubernetes cluster nodes.
 *
 * Returns reactive state and API functions. No side effects on call.
 * API functions return raw promises — pages handle useLazyAsyncData wrapping.
 */
export default function useNode() {
  const node = ref<TNode>({
    _id: '',
    clusterId: '',
    name: '',
    role: 'worker',
    host: '',
    status: 'pending',
    createdAt: '',
    updatedAt: ''
  })

  function getAll() {
    return useNuxtApp().$api<{ items: TNode[], pages: number }>('/nodes', {
      method: 'GET'
    })
  }

  function getAllByCluster(clusterId: string, options: { page?: number, role?: TNodeRole, status?: TNodeStatus } = {}) {
    return useNuxtApp().$api<{ items: TNode[], pages: number }>(`/nodes/cluster/${clusterId}`, {
      method: 'GET',
      query: {
        page: options.page ?? 1,
        ...(options.role && { role: options.role }),
        ...(options.status && { status: options.status })
      }
    })
  }

  function getById(id: string) {
    return useNuxtApp().$api<{ node: TNode }>(`/nodes/${id}`, {
      method: 'GET'
    })
  }

  function generateJoinToken(clusterId: string, nodeName: string) {
    return useNuxtApp().$api<{ node: TNode, joinCommand: string }>('/nodes/join-token', {
      method: 'POST',
      body: { clusterId, nodeName }
    })
  }

  function sync(id: string) {
    return useNuxtApp().$api<{ message: string, node: TNode }>(`/nodes/${id}/sync`, {
      method: 'POST'
    })
  }

  function syncAll(clusterId: string) {
    return useNuxtApp().$api<{ message: string, nodes: TNode[] }>('/nodes/sync-all', {
      method: 'POST',
      body: { clusterId }
    })
  }

  function cordon(id: string) {
    return useNuxtApp().$api<{ message: string, node: TNode }>(`/nodes/${id}/cordon`, {
      method: 'POST'
    })
  }

  function uncordon(id: string) {
    return useNuxtApp().$api<{ message: string, node: TNode }>(`/nodes/${id}/uncordon`, {
      method: 'POST'
    })
  }

  function drain(id: string, options?: { gracePeriod?: number, force?: boolean, ignoreDaemonSets?: boolean }) {
    return useNuxtApp().$api<{ message: string, node: TNode }>(`/nodes/${id}/drain`, {
      method: 'POST',
      body: options
    })
  }

  function remove(id: string) {
    return useNuxtApp().$api<{ message: string }>(`/nodes/${id}`, {
      method: 'DELETE'
    })
  }

  function addLabel(id: string, key: string, value: string) {
    return useNuxtApp().$api<{ message: string, node: TNode }>(`/nodes/${id}/labels`, {
      method: 'POST',
      body: { key, value }
    })
  }

  function removeLabel(id: string, key: string) {
    return useNuxtApp().$api<{ message: string, node: TNode }>(`/nodes/${id}/labels/${key}`, {
      method: 'DELETE'
    })
  }

  // ---------------------------------------------------------------------------
  // Provisioning
  // ---------------------------------------------------------------------------

  function testConnection(params: { host: string, sshPort?: number, sshUser?: string, sshKeyId: string }) {
    return useNuxtApp().$api<TTestConnectionResponse>('/nodes/test-connection', {
      method: 'POST',
      body: params
    })
  }

  function provision(data: TNodeProvisionInput) {
    return useNuxtApp().$api<{ message: string, node: TNode }>('/nodes/provision', {
      method: 'POST',
      body: data
    })
  }

  function getProvisioningStatus(id: string) {
    return useNuxtApp().$api<{
      node: TNode
      provisioningStatus: 'idle' | 'running' | 'success' | 'failed'
      provisioningLog: TProvisioningStep[]
      provisioningStartedAt?: string
      provisioningCompletedAt?: string
    }>(`/nodes/${id}/provisioning-status`, {
      method: 'GET'
    })
  }

  function retryProvision(id: string) {
    return useNuxtApp().$api<{ message: string, node: TNode }>(`/nodes/${id}/retry-provision`, {
      method: 'POST'
    })
  }

  return {
    node,
    getAll,
    getAllByCluster,
    getById,
    generateJoinToken,
    sync,
    syncAll,
    cordon,
    uncordon,
    drain,
    remove,
    addLabel,
    removeLabel,
    // Provisioning
    testConnection,
    provision,
    getProvisioningStatus,
    retryProvision
  }
}
