declare type TLogSource = 'system' | 'operator' | 'app'

declare type TLogPod = {
  podName: string
  logs: string
}

declare type TAppLogsResponse = {
  appId: string
  appName: string
  pods: TLogPod[]
}

declare type TSystemLogsResponse = {
  source: 'system'
  sourceName: string
  logs: string
}

declare type TOperatorLogsResponse = {
  source: 'operator'
  pods: TLogPod[]
}

declare type TLogSearchResult = {
  source: string
  sourceName: string
  logs: string
}

declare type TLogSearchResponse = {
  query: string
  results: TLogSearchResult[]
}
