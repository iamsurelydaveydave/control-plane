declare type TDatabase = {
  _id: string
  name: string
  type: string
  version: string
  status: string
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
