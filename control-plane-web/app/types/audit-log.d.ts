declare type TAuditAction =
  | 'create' | 'read' | 'update' | 'delete'
  | 'login' | 'logout' | 'login_failed'
  | 'deploy' | 'rollback' | 'scale'
  | 'backup' | 'restore'
  | 'permission_change' | 'role_change'
  | 'export' | 'api_token_create' | 'api_token_revoke'
  | 'restart' | 'stop' | 'start'

declare type TAuditResource =
  | 'user' | 'server' | 'app' | 'database' | 'instance'
  | 'deployment' | 'settings' | 'cluster' | 'node'
  | 'api_token' | 'ssh_key' | 'secret' | 'alert' | 'audit_log'

declare type TAuditChange = {
  field: string
  oldValue: unknown
  newValue: unknown
}

declare type TAuditLog = {
  _id: string
  userId?: string
  userEmail?: string
  action: TAuditAction
  resource: TAuditResource
  resourceId?: string
  resourceName?: string
  details?: Record<string, unknown>
  changes?: TAuditChange[]
  ip?: string
  userAgent?: string
  sessionId?: string
  apiTokenId?: string
  success: boolean
  errorMessage?: string
  duration?: number
  createdAt: string
}

declare type TAuditLogFilters = {
  page?: number
  limit?: number
  userId?: string
  action?: TAuditAction
  resource?: TAuditResource
  startDate?: string
  endDate?: string
  success?: boolean
  search?: string
}

declare type TAuditStats = {
  totalLogs: number
  logsByAction: Record<string, number>
  logsByResource: Record<string, number>
  logsByDay: { date: string; count: number }[]
  failureRate: number
  topUsers: { email: string; count: number }[]
}

declare type TExportFormat = 'json' | 'csv' | 'pdf'

declare type TComplianceReportType = 'soc2' | 'gdpr' | 'hipaa' | 'general'

declare type TUserActivity = {
  userId: string
  email: string
  actionCount: number
  lastActivity: string
}

declare type TSecurityEvents = {
  failedLogins: TAuditLog[]
  permissionChanges: TAuditLog[]
  apiTokenActivity: TAuditLog[]
}

declare type TResourceChanges = {
  apps: { created: number; deleted: number; deployed: number }
  databases: { created: number; deleted: number; backed_up: number }
  users: { created: number; deleted: number; permission_changes: number }
}

declare type TComplianceReport = {
  generatedAt: string
  period: { start: string; end: string }
  type: TComplianceReportType
  summary: {
    totalActions: number
    uniqueUsers: number
    failedActions: number
    securityEvents: number
  }
  userActivity: TUserActivity[]
  securityEvents: TSecurityEvents
  resourceChanges: TResourceChanges
}

declare type TRetentionPreview = {
  count: number
  retentionDays: number
  message: string
}

declare type TRetentionResult = {
  message: string
  deletedCount: number
  retentionDays: number
}
