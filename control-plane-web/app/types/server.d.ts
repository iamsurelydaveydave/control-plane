declare type TSetupStepStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped'

declare type TSetupStep = {
  name: string
  label: string
  status: TSetupStepStatus
  output?: string
  error?: string
  duration?: number
}

declare type TServerResources = {
  cpuCores: number
  memoryMb: number
  diskGb: number
}

declare type THealthCheck = {
  timestamp: string
  status: 'online' | 'offline'
  resources?: TServerResources
  serverInfo?: { os: string; hostname: string; uptime: string }
  error?: string
  durationMs?: number
}

declare type TServer = {
  _id: string
  name: string
  host: string
  status: 'online' | 'offline' | 'unknown' | 'provisioning'
  provider?: string
  sshUser: string
  sshPort: number
  sshKeyId?: string
  sshConnectTimeout?: number
  timezone?: string
  dockerInstalled?: boolean
  bootstrappedAt?: string
  setupStatus?: 'idle' | 'running' | 'success' | 'failed'
  setupLog?: TSetupStep[]
  setupStartedAt?: string
  setupCompletedAt?: string
  resources?: TServerResources
  lastHealthCheck?: string
  healthChecks?: THealthCheck[]
}

declare type TServerForm = {
  name: string
  host: string
  sshUser: string
  sshPort: number
  sshKeyId?: string
  sshConnectTimeout?: number
  timezone?: string
}

declare type TSetupStatusResponse = {
  setupStatus: 'idle' | 'running' | 'success' | 'failed'
  setupLog: TSetupStep[]
  setupStartedAt?: string
  setupCompletedAt?: string
  status: string
  dockerInstalled: boolean
  resources?: TServerResources
}
