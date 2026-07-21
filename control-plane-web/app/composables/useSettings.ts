export default function useSettings() {
  // ---------------------------------------------------------------------------
  // DNS
  // ---------------------------------------------------------------------------

  function getDNSConfig() {
    return useNuxtApp().$api<{
      provider: string | null
      apiToken?: string
      apps: { configured: boolean; zoneId?: string; baseDomain?: string }
      db: { configured: boolean; zoneId?: string; baseDomain?: string }
    }>('/settings/dns', { method: 'GET' })
  }

  function verifyDNS(apiToken: string, baseDomain: string) {
    return useNuxtApp().$api<{
      valid: boolean
      zoneId?: string
      zoneName?: string
      tokenId?: string
      error?: string
    }>('/settings/dns/verify', {
      method: 'POST',
      body: { apiToken, baseDomain }
    })
  }

  function saveToken(apiToken: string) {
    return useNuxtApp().$api<{ message: string }>('/settings/dns/token', {
      method: 'PUT',
      body: { apiToken }
    })
  }

  function saveDNSConfig(scope: 'apps' | 'db', payload: {
    baseDomain: string
    zoneId?: string
    apiToken?: string
  }) {
    return useNuxtApp().$api<{
      message: string
      scope: string
      zoneId: string
      zoneName: string
      baseDomain: string
    }>(`/settings/dns/${scope}`, {
      method: 'PUT',
      body: payload
    })
  }

  function removeDNSConfig(scope: 'apps' | 'db') {
    return useNuxtApp().$api<{ message: string }>(`/settings/dns/${scope}`, {
      method: 'DELETE'
    })
  }

  // ---------------------------------------------------------------------------
  // Kubernetes (K3s)
  // ---------------------------------------------------------------------------

  function getK8sConfig() {
    return useNuxtApp().$api<{
      kubernetes: {
        enabled: boolean
        available: boolean
        nodes: number
        serverUrl?: string
        error?: string
      }
      provisioner: 'ansible' | 'k8s'
      hasK3sToken: boolean
    }>('/settings/k8s', { method: 'GET' })
  }

  function getK8sNodes() {
    return useNuxtApp().$api<{
      enabled: boolean
      available?: boolean
      nodes: Array<{
        name: string
        hostname?: string
        internalIP?: string
        ready: boolean
        roles: string[]
        createdAt: string
      }>
    }>('/settings/k8s/nodes', { method: 'GET' })
  }

  function getK8sAgentCommand() {
    return useNuxtApp().$api<{
      serverUrl: string
      command: string
      instructions: string[]
    }>('/settings/k8s/agent-command', { method: 'GET' })
  }

  function refreshK8sToken() {
    return useNuxtApp().$api<{
      message: string
      hasToken: boolean
      apiServerUrl?: string
    }>('/settings/k8s/refresh-token', { method: 'POST' })
  }

  return {
    // DNS
    getDNSConfig,
    verifyDNS,
    saveToken,
    saveDNSConfig,
    removeDNSConfig,
    // Kubernetes
    getK8sConfig,
    getK8sNodes,
    getK8sAgentCommand,
    refreshK8sToken
  }
}
