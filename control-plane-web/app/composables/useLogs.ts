/**
 * useLogs — log resource composable.
 *
 * Returns API functions for fetching logs from various sources.
 * API functions return raw promises — pages handle useLazyAsyncData wrapping.
 */
export default function useLogs() {
  function getAppLogs(appId: string, options?: { tailLines?: number }) {
    return useNuxtApp().$api<TAppLogsResponse>(`/logs/apps/${appId}`, {
      method: 'GET',
      query: options?.tailLines ? { tailLines: options.tailLines } : undefined
    })
  }

  function getSystemLogs(options?: { tailLines?: number }) {
    return useNuxtApp().$api<TSystemLogsResponse>('/logs/system', {
      method: 'GET',
      query: options?.tailLines ? { tailLines: options.tailLines } : undefined
    })
  }

  function getOperatorLogs(options?: { tailLines?: number }) {
    return useNuxtApp().$api<TOperatorLogsResponse>('/logs/operator', {
      method: 'GET',
      query: options?.tailLines ? { tailLines: options.tailLines } : undefined
    })
  }

  function searchLogs(query: string, sources?: string[], tailLines?: number) {
    return useNuxtApp().$api<TLogSearchResponse>('/logs/search', {
      method: 'GET',
      query: {
        query,
        ...(sources?.length ? { sources } : {}),
        ...(tailLines ? { tailLines } : {})
      }
    })
  }

  return {
    getAppLogs,
    getSystemLogs,
    getOperatorLogs,
    searchLogs
  }
}
