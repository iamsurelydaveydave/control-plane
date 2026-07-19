declare type TDatabaseNode = {
  serverId: string
  role: 'primary' | 'secondary' | 'arbiter' | 'standalone'
  status: 'running' | 'stopped' | 'syncing' | 'unhealthy'
}

declare type TDatabaseDNS = {
  enabled: boolean
  provider: string
  clusterHost: string
  nodeHosts: string[]
  srvConnectionString: string
  records: Array<{ id: string; type: string; name: string }>
  configuredAt: string
}

declare type TDatabase = {
  _id: string
  name: string
  type: string
  version: string
  status: string
  nodes?: TDatabaseNode[]
  config?: Record<string, unknown>
  dns?: TDatabaseDNS
}

declare type TDatabaseForm = {
  name: string
  type: string
  version: string
  serverId: string
  adminUser: string
  adminPassword: string
}

declare type TDatabaseCredentials = {
  adminUser: string
  adminPassword: string
  connectionString: string
  srvConnectionString?: string  // mongodb+srv:// — present when DNS is configured
}

declare type TDatabaseHealth = {
  status: string
  members: Array<{
    host: string
    state: string
    health: number
  }>
}
