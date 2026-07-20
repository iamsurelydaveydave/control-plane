export default function useSettings() {
  // ---------------------------------------------------------------------------
  // DNS
  // ---------------------------------------------------------------------------

  function getDNSConfig() {
    return useNuxtApp().$api<{
      provider: string | null
      apiToken?: string  // masked
      apps: { configured: boolean; zoneId?: string; baseDomain?: string }
      db:   { configured: boolean; zoneId?: string; baseDomain?: string }
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
    apiToken?: string   // omit to reuse the token already saved in settings
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

  return {
    getDNSConfig,
    verifyDNS,
    saveToken,
    saveDNSConfig,
    removeDNSConfig,
  }
}
