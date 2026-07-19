declare type TAppSource = {
  type: 'image' | 'git'
  image?: string
  gitUrl?: string
  gitBranch?: string
  dockerfile?: string
}

declare type TAppProxy = {
  ssl: boolean
  host: string
  appPort: number
  healthcheckPath?: string
  healthcheckInterval?: number
}

declare type TAppRegistry = {
  server: string
  username: string
  password: string
}

declare type TAppResources = {
  memory?: string
  cpus?: number
}

declare type TAppHealthCheck = {
  path: string
  interval?: number
  timeout?: number
}

declare type TAppVolume = {
  host: string
  container: string
  readonly?: boolean
}

declare type TApp = {
  _id: string
  name: string
  source: TAppSource
  registry?: TAppRegistry
  serverIds: string[]
  proxy?: TAppProxy
  env: Record<string, string>
  secretNames: string[]
  resources?: TAppResources
  healthCheck?: TAppHealthCheck
  volumes?: TAppVolume[]
  status: 'pending' | 'deploying' | 'running' | 'stopped' | 'failed'
  currentVersion?: string
  currentImage?: string
  deployedAt?: string
  createdAt?: string
}

declare type TAppForm = {
  name: string
  source: TAppSource
  registry?: TAppRegistry
  serverIds: string[]
  proxy?: TAppProxy
  env?: Record<string, string>
  resources?: TAppResources
  healthCheck?: TAppHealthCheck
  volumes?: TAppVolume[]
}
