declare type TAppSource = {
  type: 'image' | 'git'
  image?: string
  gitUrl?: string
  repository?: string
  branch?: string
  dockerfile?: string
}

declare type TAppProxy = {
  ssl: boolean
  host: string
  port: number
  appPort?: number
  healthcheckPath?: string
  healthcheckInterval?: number
}

declare type TAppResources = {
  memory?: string
  cpu?: string
}

declare type TAppHealthCheck = {
  path: string
  interval?: number
  timeout?: number
}

declare type TAppK8sConfig = {
  replicas: number
  image: string
  port: number
  domain?: string
  envVars: Record<string, string>
  resourceRequests?: TAppResources
  resourceLimits?: TAppResources
}

declare type TAppGitHub = {
  enabled: boolean
  owner: string
  repo: string
  branch?: string
  autoDeployOnPush?: boolean
  installationId?: string
}

declare type TAppEnvironment = 'development' | 'staging' | 'production'

declare type TApp = {
  _id: string
  name: string
  image?: string
  source?: TAppSource
  k8s?: TAppK8sConfig
  proxy?: TAppProxy
  env?: Record<string, string>
  secretNames?: string[]
  resources?: TAppResources
  healthCheck?: TAppHealthCheck
  status: 'pending' | 'deploying' | 'running' | 'stopped' | 'failed' | 'unknown'
  currentVersion?: string
  currentImage?: string
  desiredReplicas?: number
  deployedAt?: string
  createdAt?: string
  updatedAt?: string
  // CI/CD Integration
  github?: TAppGitHub
  environment?: TAppEnvironment
  requireApproval?: boolean
  // Registry reference
  registryId?: string
}

declare type TAppForm = {
  name: string
  source: TAppSource
  k8s?: Partial<TAppK8sConfig>
  proxy?: TAppProxy
  env?: Record<string, string>
  resources?: TAppResources
  healthCheck?: TAppHealthCheck
  github?: TAppGitHub
  environment?: TAppEnvironment
  requireApproval?: boolean
  registryId?: string
}
