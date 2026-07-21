// =============================================================================
// System Metrics
// =============================================================================

declare type TSystemMetrics = {
  hostname: string
  platform: string
  arch: string
  uptime: number
  cpu: {
    cores: number
    model: string
    loadAverage: number[]
    usagePercent: number
  }
  memory: {
    total: number       // bytes
    free: number        // bytes
    used: number        // bytes
    usagePercent: number
  }
  process: {
    uptime: number
    memoryUsed: number  // bytes
    memoryTotal: number // bytes
  }
}

// =============================================================================
// Cluster Metrics
// =============================================================================

declare type TClusterNodeMetrics = {
  name: string
  status: 'Ready' | 'NotReady' | 'Unknown'
  cpu?: { capacity: string; usage?: string; usagePercent?: number }
  memory?: { capacity: string; usage?: string; usagePercent?: number }
  pods?: { capacity: number; running: number }
}

declare type TClusterMetrics = {
  available: boolean
  nodes: {
    total: number
    ready: number
    items: TClusterNodeMetrics[]
  }
  pods: {
    total: number
    running: number
    pending: number
    failed: number
  }
  totals?: {
    cpuCapacity: string
    cpuUsage?: string
    memoryCapacity: string
    memoryUsage?: string
  }
}

// =============================================================================
// Database Metrics
// =============================================================================

declare type TDatabaseMetricItem = {
  _id: string
  name: string
  type: string
  status: string
  nodeCount: number
}

declare type TDatabaseMetrics = {
  total: number
  byType: Record<string, number>
  byStatus: Record<string, number>
  items: TDatabaseMetricItem[]
}

// =============================================================================
// App Metrics
// =============================================================================

declare type TAppMetricItem = {
  _id: string
  name: string
  status: string
  serverCount: number
  deployedAt?: string
}

declare type TAppMetrics = {
  total: number
  byStatus: Record<string, number>
  items: TAppMetricItem[]
}

// =============================================================================
// Overview Metrics
// =============================================================================

declare type TMetricsOverview = {
  timestamp: string
  system: {
    cpuUsagePercent: number
    memoryUsagePercent: number
    uptime: number
  }
  cluster: {
    available: boolean
    nodesTotal: number
    nodesReady: number
    podsRunning: number
  }
  databases: {
    total: number
    healthy: number
  }
  apps: {
    total: number
    running: number
  }
}
