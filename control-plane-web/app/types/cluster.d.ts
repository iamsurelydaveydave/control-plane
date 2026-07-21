declare type TClusterType = 'local' | 'remote'

declare type TClusterStatus = 'connected' | 'unreachable' | 'unknown'

declare type TCluster = {
  _id: string
  name: string
  type: TClusterType
  status: TClusterStatus

  // Connection info (remote clusters only)
  kubeconfig?: string
  context?: string

  // Cluster info (synced from K8s)
  version?: string
  platform?: string
  nodesCount?: number

  // API server URL (for display)
  apiServerUrl?: string

  // Join token for workers (k3s)
  joinToken?: string

  // Timestamps
  lastSyncedAt?: string
  createdAt: string
  updatedAt: string
}

declare type TClusterForm = {
  name: string
  type: TClusterType
  kubeconfig?: string
  context?: string
  apiServerUrl?: string
}
