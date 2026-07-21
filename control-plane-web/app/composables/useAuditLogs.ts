/**
 * useAuditLogs — audit log resource composable.
 *
 * Returns reactive state and API functions for audit logs, exports, and compliance reports.
 * API functions return raw promises — pages handle useLazyAsyncData wrapping.
 */
export default function useAuditLogs() {
  const auditLog = ref<TAuditLog>({
    _id: '',
    action: 'read',
    resource: 'user',
    success: true,
    createdAt: ''
  })

  /**
   * Get all audit logs with filtering and pagination
   */
  function getAll(options: TAuditLogFilters = {}) {
    return useNuxtApp().$api<{ items: TAuditLog[], pages: number, pageRange: number[] }>('/audit-logs', {
      method: 'GET',
      query: {
        page: options.page ?? 1,
        limit: options.limit ?? 50,
        userId: options.userId,
        action: options.action,
        resource: options.resource,
        startDate: options.startDate,
        endDate: options.endDate,
        success: options.success,
        search: options.search
      }
    })
  }

  /**
   * Get audit statistics
   */
  function getStats(options: { startDate?: string, endDate?: string } = {}) {
    return useNuxtApp().$api<TAuditStats>('/audit-logs/stats', {
      method: 'GET',
      query: {
        startDate: options.startDate,
        endDate: options.endDate
      }
    })
  }

  /**
   * Export audit logs as a downloadable file
   */
  async function exportLogs(options: {
    startDate: string
    endDate: string
    format: TExportFormat
    filters?: TAuditLogFilters
  }): Promise<void> {
    const query = new URLSearchParams({
      startDate: options.startDate,
      endDate: options.endDate,
      format: options.format,
      ...(options.filters?.userId && { userId: options.filters.userId }),
      ...(options.filters?.action && { action: options.filters.action }),
      ...(options.filters?.resource && { resource: options.filters.resource }),
      ...(options.filters?.success !== undefined && { success: String(options.filters.success) })
    })

    // Use native fetch for file download
    const response = await fetch(`/api/audit-logs/export?${query.toString()}`, {
      credentials: 'include'
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Export failed')
    }

    // Get filename from Content-Disposition header or generate one
    const disposition = response.headers.get('Content-Disposition')
    const filenameMatch = disposition?.match(/filename="(.+)"/)
    const filename = filenameMatch?.[1] || `audit-logs-${new Date().toISOString().split('T')[0]}.${options.format}`

    // Download the file
    const blob = await response.blob()
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
  }

  /**
   * Export as CSV (convenience method)
   */
  function exportCSV(options: { startDate: string, endDate: string, filters?: TAuditLogFilters }) {
    return exportLogs({ ...options, format: 'csv' })
  }

  /**
   * Export as JSON (convenience method)
   */
  function exportJSON(options: { startDate: string, endDate: string, filters?: TAuditLogFilters }) {
    return exportLogs({ ...options, format: 'json' })
  }

  /**
   * Generate a compliance report
   */
  function generateComplianceReport(options: {
    startDate: string
    endDate: string
    type: TComplianceReportType
  }) {
    return useNuxtApp().$api<TComplianceReport>('/audit-logs/report', {
      method: 'GET',
      query: {
        startDate: options.startDate,
        endDate: options.endDate,
        type: options.type
      }
    })
  }

  /**
   * Preview retention policy impact
   */
  function previewRetention(retentionDays: number) {
    return useNuxtApp().$api<TRetentionPreview>('/audit-logs/retention/preview', {
      method: 'GET',
      query: { retentionDays }
    })
  }

  /**
   * Enforce retention policy (delete old logs)
   */
  function enforceRetention(retentionDays: number) {
    return useNuxtApp().$api<TRetentionResult>('/audit-logs/retention', {
      method: 'POST',
      body: { retentionDays }
    })
  }

  return {
    auditLog,
    getAll,
    getStats,
    exportLogs,
    exportCSV,
    exportJSON,
    generateComplianceReport,
    previewRetention,
    enforceRetention
  }
}
