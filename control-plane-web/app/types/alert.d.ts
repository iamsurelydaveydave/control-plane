declare type TAlertSeverity = 'info' | 'warning' | 'critical'
declare type TAlertStatus = 'active' | 'acknowledged' | 'resolved'
declare type TAlertSource = 'system' | 'database' | 'app' | 'cluster' | 'node'

declare type TAlert = {
  _id: string
  title: string
  message: string
  severity: TAlertSeverity
  status: TAlertStatus
  source: TAlertSource
  sourceId?: string
  metadata?: Record<string, any>
  acknowledgedAt?: string
  resolvedAt?: string
  createdAt: string
}

declare type TAlertFilters = {
  page?: number
  severity?: TAlertSeverity
  status?: TAlertStatus
  source?: TAlertSource
  search?: string
}
