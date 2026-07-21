/**
 * useMetrics — metrics composable for monitoring dashboard.
 *
 * Returns API functions for fetching metrics data. No side effects on call.
 * API functions return raw promises — pages handle useLazyAsyncData wrapping.
 */
export default function useMetrics() {
  /**
   * Get combined overview metrics for dashboard
   */
  function getOverview() {
    return useNuxtApp().$api<TMetricsOverview>('/metrics/overview', {
      method: 'GET'
    })
  }

  /**
   * Get system metrics (CPU, memory, etc.)
   */
  function getSystemMetrics() {
    return useNuxtApp().$api<TSystemMetrics>('/metrics/system', {
      method: 'GET'
    })
  }

  /**
   * Get K8s cluster metrics
   */
  function getClusterMetrics() {
    return useNuxtApp().$api<TClusterMetrics>('/metrics/cluster', {
      method: 'GET'
    })
  }

  /**
   * Get database metrics summary
   */
  function getDatabaseMetrics() {
    return useNuxtApp().$api<TDatabaseMetrics>('/metrics/databases', {
      method: 'GET'
    })
  }

  /**
   * Get app metrics summary
   */
  function getAppMetrics() {
    return useNuxtApp().$api<TAppMetrics>('/metrics/apps', {
      method: 'GET'
    })
  }

  return {
    getOverview,
    getSystemMetrics,
    getClusterMetrics,
    getDatabaseMetrics,
    getAppMetrics
  }
}
