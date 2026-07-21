/**
 * useLogs — log resource composable.
 *
 * Returns API functions for fetching logs from various sources.
 * API functions return raw promises — pages handle useLazyAsyncData wrapping.
 */
export default function useLogs() {
  function getAppLogs(id: string, options: Omit<TLogFilters, 'source' | 'sourceId'> = {}) {
    return useNuxtApp().$api<{ items: TLogEntry[], pages: number, total: number }>(`/apps/${id}/logs`, {
      method: 'GET',
      query: {
        page: options.page ?? 1,
        level: options.level,
        search: options.search ?? '',
        startTime: options.startTime,
        endTime: options.endTime
      }
    })
  }

  function getDatabaseLogs(id: string, options: Omit<TLogFilters, 'source' | 'sourceId'> = {}) {
    return useNuxtApp().$api<{ items: TLogEntry[], pages: number, total: number }>(`/databases/${id}/logs`, {
      method: 'GET',
      query: {
        page: options.page ?? 1,
        level: options.level,
        search: options.search ?? '',
        startTime: options.startTime,
        endTime: options.endTime
      }
    })
  }

  function getSystemLogs(options: Omit<TLogFilters, 'source' | 'sourceId'> = {}) {
    return useNuxtApp().$api<{ items: TLogEntry[], pages: number, total: number }>('/logs/system', {
      method: 'GET',
      query: {
        page: options.page ?? 1,
        level: options.level,
        search: options.search ?? '',
        startTime: options.startTime,
        endTime: options.endTime
      }
    })
  }

  function getOperatorLogs(options: Omit<TLogFilters, 'source' | 'sourceId'> = {}) {
    return useNuxtApp().$api<{ items: TLogEntry[], pages: number, total: number }>('/logs/operator', {
      method: 'GET',
      query: {
        page: options.page ?? 1,
        level: options.level,
        search: options.search ?? '',
        startTime: options.startTime,
        endTime: options.endTime
      }
    })
  }

  function searchLogs(query: string, options: Omit<TLogFilters, 'search'> = {}) {
    return useNuxtApp().$api<{ items: TLogEntry[], pages: number, total: number }>('/logs/search', {
      method: 'GET',
      query: {
        search: query,
        page: options.page ?? 1,
        level: options.level,
        source: options.source,
        sourceId: options.sourceId,
        startTime: options.startTime,
        endTime: options.endTime
      }
    })
  }

  function getAllLogs(options: TLogFilters = {}) {
    return useNuxtApp().$api<{ items: TLogEntry[], pages: number, total: number }>('/logs', {
      method: 'GET',
      query: {
        page: options.page ?? 1,
        level: options.level,
        source: options.source,
        sourceId: options.sourceId,
        search: options.search ?? '',
        startTime: options.startTime,
        endTime: options.endTime
      }
    })
  }

  return {
    getAppLogs,
    getDatabaseLogs,
    getSystemLogs,
    getOperatorLogs,
    searchLogs,
    getAllLogs
  }
}
