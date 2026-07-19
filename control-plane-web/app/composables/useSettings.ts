export default function useSettings() {
  // ---------------------------------------------------------------------------
  // DNS
  // ---------------------------------------------------------------------------

  function getDNSConfig() {
    return useNuxtApp().$api<{
      configured: boolean
      provider?: string
      zoneId?: string
      zoneName?: string
      baseDomain?: string
      apiToken?: string  // masked
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

  function saveDNSConfig(payload: {
    provider?: string
    apiToken: string
    baseDomain: string
    zoneId?: string
  }) {
    return useNuxtApp().$api<{
      message: string
      provider: string
      zoneId: string
      zoneName: string
      baseDomain: string
    }>('/settings/dns', {
      method: 'PUT',
      body: payload
    })
  }

  function removeDNSConfig() {
    return useNuxtApp().$api<{ message: string }>('/settings/dns', {
      method: 'DELETE'
    })
  }

  return {
    getDNSConfig,
    verifyDNS,
    saveDNSConfig,
    removeDNSConfig,
  }
}
