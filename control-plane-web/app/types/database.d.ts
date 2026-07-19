declare type TDatabaseNode = {
  serverId: string
  role: 'primary' | 'secondary' | 'arbiter' | 'standalone'
  status: 'running' | 'stopped' | 'syncing' | 'unhealthy'
}

declare type TDatabase = {
  _id: string
  name: string
  type: string
  version: string
  status: string
  nodes?: TDatabaseNode[]
  config?: Record<string, any>
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
}

declare type TDatabaseHealth = {
  status: string
  members: Array<{
    host: string
    state: string
    health: number
  }>
}
