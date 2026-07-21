declare type TAddonType = 
  // Databases
  | 'mongodb'
  | 'postgresql'
  | 'mysql'
  | 'mariadb'
  | 'clickhouse'
  // Caching
  | 'redis'
  | 'keydb'
  | 'dragonfly'
  | 'memcached'
  // Search
  | 'elasticsearch'
  | 'meilisearch'
  | 'typesense'
  // Queues
  | 'rabbitmq'
  | 'nats'
  | 'kafka'
  // Storage
  | 'minio'
  | 'seaweedfs'
  // Analytics
  | 'plausible'
  | 'umami'
  | 'matomo'
  | 'posthog'
  // Automation
  | 'n8n'
  | 'activepieces'
  | 'windmill'
  | 'temporal'
  // Development
  | 'gitea'
  | 'gitlab'
  | 'forgejo'
  | 'codeserver'
  // Monitoring
  | 'grafana'
  | 'uptimekuma'
  | 'prometheus'
  | 'healthchecks'
  // CMS
  | 'ghost'
  | 'strapi'
  | 'directus'
  | 'wordpress'
  // Communication
  | 'mattermost'
  | 'rocketchat'
  | 'listmonk'

declare type TAddonStatus = 'pending' | 'provisioning' | 'deploying' | 'running' | 'stopped' | 'failed'

declare type TAddonConnectionInfo = {
  host: string
  port: number
  username?: string
  password?: string
  connectionString?: string
}

declare type TAddon = {
  _id: string
  name: string
  type: TAddonType
  status: TAddonStatus
  namespace: string
  connectionInfo?: TAddonConnectionInfo
  config?: Record<string, unknown>
  createdAt?: string
  updatedAt?: string
}

declare type TAddonForm = {
  name: string
  type: TAddonType
  namespace?: string
  config?: Record<string, unknown>
}
