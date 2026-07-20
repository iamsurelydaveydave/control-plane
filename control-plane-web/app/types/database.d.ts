declare type TDatabaseNodeForm = {
  serverId: string
  role: 'primary' | 'secondary' | 'arbiter' | 'standalone'
}

declare type TDatabaseShape = {
  cacheSizeGB: number   // WiredTiger cache size in GB
  port: number          // MongoDB port (default 27017)
  replicaSetName: string
}

declare type TDatabaseNode = {
  serverId: string
  role: 'primary' | 'secondary' | 'arbiter' | 'standalone'
  status: 'running' | 'stopped' | 'syncing' | 'unhealthy'
  // Populated by the API when DB DNS is not configured
  sslipHost?: string              // e.g. "node1-mydb.10.0.0.1.sslip.io"
  sslipConnectionHost?: string    // e.g. "node1-mydb.10.0.0.1.sslip.io:27017"
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

declare type TDatabaseTLS = {
  enabled: boolean
  caCert: string
  tlsConnectionString: string
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
  tls?: TDatabaseTLS
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

declare type TDatabaseTLSStatus = {
  enabled: boolean
  configuredAt?: string
  tlsConnectionString?: string
  hasCaCert?: boolean
  message?: string
}
