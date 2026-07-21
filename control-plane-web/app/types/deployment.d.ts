declare type TDeploymentStatus = 'pending' | 'running' | 'success' | 'failed'

declare type TDeployment = {
  _id: string
  appId: string
  image: string
  version?: string
  environment?: string
  status: TDeploymentStatus
  logs?: string
  startedAt?: string
  completedAt?: string
  duration?: number
  url?: string
  gitSha?: string
  gitRef?: string
}

declare type TDeploymentApprovalStatus = 'pending' | 'approved' | 'rejected'
declare type TDeploymentEnvironment = 'development' | 'staging' | 'production'

declare type TDeploymentApproval = {
  _id: string
  appId: string
  version: string
  environment: TDeploymentEnvironment
  status: TDeploymentApprovalStatus
  requestedBy: string
  requestedAt: string
  approvedBy?: string
  approvedAt?: string
  rejectedBy?: string
  rejectedAt?: string
  rejectionReason?: string
  deploymentId?: string
  expiresAt: string
}

declare type TDeploymentLatest = {
  deploymentId: string | null
  status: TDeploymentStatus | 'none'
  startedAt?: string
  completedAt?: string
  version?: string
  environment?: string
  logs?: string
  duration?: number
  url?: string
  message?: string
}
