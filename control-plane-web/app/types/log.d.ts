declare type TLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal'
declare type TLogSource = 'app' | 'resource' | 'system' | 'operator'

declare type TLogEntry = {
  _id: string
  timestamp: string
  level: TLogLevel
  message: string
  source: TLogSource
  sourceId?: string
  sourceName?: string
  metadata?: Record<string, any>
}

declare type TLogFilters = {
  page?: number
  level?: TLogLevel
  source?: TLogSource
  sourceId?: string
  search?: string
  startTime?: string
  endTime?: string
}
