declare type TPipelineStage = 'dev' | 'staging' | 'prod'

declare type TPipelineStatus = 'idle' | 'deploying' | 'failed'

declare type TPipelineStageConfig = {
  name: TPipelineStage
  appId?: string
  serverId?: string
  version?: string
  deployedAt?: string
  status: 'pending' | 'deployed' | 'failed'
}

declare type TPromotionHistoryEntry = {
  _id: string
  fromStage: TPipelineStage
  toStage: TPipelineStage
  version: string
  promotedBy: string
  promotedAt: string
  status: 'success' | 'failed'
  error?: string
}

declare type TPipeline = {
  _id: string
  name: string
  description?: string
  appId: string
  appName?: string
  status: TPipelineStatus
  stages: TPipelineStageConfig[]
  promotionHistory?: TPromotionHistoryEntry[]
  createdAt?: string
  updatedAt?: string
}

declare type TPipelineForm = {
  name: string
  description?: string
  appId: string
  stages: Array<{
    name: TPipelineStage
    serverId?: string
  }>
}
