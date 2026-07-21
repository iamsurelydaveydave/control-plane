<script setup lang="ts">
/**
 * Resources Catalog — browse and deploy one-click services via Helm
 * Similar to Coolify's service marketplace.
 */
definePageMeta({
  layout: 'dashboard',
  middleware: 'auth',
  secured: true
})

const toast = useToast()
const { getAll, add, deleteById, getConnectionInfo, start, stop, restart } = useAddon()

// ---------------------------------------------------------------------------
// Catalog definition — available resource templates
// ---------------------------------------------------------------------------

type TResourceCategory = 
  | 'database' 
  | 'cache' 
  | 'search' 
  | 'queue' 
  | 'storage' 
  | 'analytics'
  | 'automation'
  | 'development'
  | 'monitoring'
  | 'cms'
  | 'communication'

type TResourceCatalogItem = {
  type: string
  name: string
  description: string
  icon: string
  iconColor: string
  category: TResourceCategory
  tags: string[]
  defaultPort: number
  hasConfig?: boolean
}

const catalog: TResourceCatalogItem[] = [
  // ── Databases ──────────────────────────────────────────────────────────────
  {
    type: 'mongodb',
    name: 'MongoDB',
    description: 'Document database with replica set support for high availability.',
    icon: 'i-simple-icons-mongodb',
    iconColor: 'text-green-500',
    category: 'database',
    tags: ['nosql', 'document', 'replica set'],
    defaultPort: 27017,
    hasConfig: true
  },
  {
    type: 'postgresql',
    name: 'PostgreSQL',
    description: 'Powerful relational database with advanced features and JSON support.',
    icon: 'i-simple-icons-postgresql',
    iconColor: 'text-blue-500',
    category: 'database',
    tags: ['sql', 'relational', 'acid'],
    defaultPort: 5432,
    hasConfig: true
  },
  {
    type: 'mysql',
    name: 'MySQL',
    description: 'Popular relational database known for reliability and ease of use.',
    icon: 'i-simple-icons-mysql',
    iconColor: 'text-orange-500',
    category: 'database',
    tags: ['sql', 'relational', 'acid'],
    defaultPort: 3306,
    hasConfig: true
  },
  {
    type: 'mariadb',
    name: 'MariaDB',
    description: 'MySQL-compatible database with enhanced features and performance.',
    icon: 'i-simple-icons-mariadb',
    iconColor: 'text-amber-700',
    category: 'database',
    tags: ['sql', 'relational', 'mysql'],
    defaultPort: 3306,
    hasConfig: true
  },
  {
    type: 'clickhouse',
    name: 'ClickHouse',
    description: 'Fast open-source columnar database for real-time analytics.',
    icon: 'i-simple-icons-clickhouse',
    iconColor: 'text-yellow-500',
    category: 'database',
    tags: ['analytics', 'columnar', 'olap'],
    defaultPort: 8123
  },

  // ── Caching ────────────────────────────────────────────────────────────────
  {
    type: 'redis',
    name: 'Redis',
    description: 'In-memory data store for caching, sessions, queues, and pub/sub.',
    icon: 'i-simple-icons-redis',
    iconColor: 'text-red-500',
    category: 'cache',
    tags: ['cache', 'session', 'queue', 'pubsub'],
    defaultPort: 6379,
    hasConfig: true
  },
  {
    type: 'keydb',
    name: 'KeyDB',
    description: 'Multi-threaded Redis fork with better performance.',
    icon: 'i-lucide-key',
    iconColor: 'text-purple-500',
    category: 'cache',
    tags: ['cache', 'redis', 'fast'],
    defaultPort: 6379
  },
  {
    type: 'dragonfly',
    name: 'Dragonfly',
    description: 'Modern Redis replacement with 25x better throughput.',
    icon: 'i-lucide-zap',
    iconColor: 'text-green-400',
    category: 'cache',
    tags: ['cache', 'redis', 'fast'],
    defaultPort: 6379
  },
  {
    type: 'memcached',
    name: 'Memcached',
    description: 'High-performance distributed memory caching system.',
    icon: 'i-lucide-cpu',
    iconColor: 'text-green-500',
    category: 'cache',
    tags: ['cache', 'memory', 'fast'],
    defaultPort: 11211
  },

  // ── Search ─────────────────────────────────────────────────────────────────
  {
    type: 'elasticsearch',
    name: 'Elasticsearch',
    description: 'Distributed search and analytics engine for logs and full-text search.',
    icon: 'i-simple-icons-elasticsearch',
    iconColor: 'text-yellow-500',
    category: 'search',
    tags: ['search', 'logs', 'analytics'],
    defaultPort: 9200
  },
  {
    type: 'meilisearch',
    name: 'Meilisearch',
    description: 'Lightning-fast search engine with typo tolerance.',
    icon: 'i-simple-icons-meilisearch',
    iconColor: 'text-pink-500',
    category: 'search',
    tags: ['search', 'fast', 'typo-tolerant'],
    defaultPort: 7700
  },
  {
    type: 'typesense',
    name: 'Typesense',
    description: 'Fast, typo-tolerant search engine optimized for instant search.',
    icon: 'i-lucide-search',
    iconColor: 'text-blue-400',
    category: 'search',
    tags: ['search', 'fast', 'instant'],
    defaultPort: 8108
  },

  // ── Message Queues ─────────────────────────────────────────────────────────
  {
    type: 'rabbitmq',
    name: 'RabbitMQ',
    description: 'Message broker for reliable async communication between services.',
    icon: 'i-simple-icons-rabbitmq',
    iconColor: 'text-orange-400',
    category: 'queue',
    tags: ['message', 'queue', 'amqp'],
    defaultPort: 5672
  },
  {
    type: 'nats',
    name: 'NATS',
    description: 'High-performance cloud-native messaging system.',
    icon: 'i-simple-icons-nats-dot-io',
    iconColor: 'text-green-500',
    category: 'queue',
    tags: ['message', 'pubsub', 'fast'],
    defaultPort: 4222
  },
  {
    type: 'kafka',
    name: 'Apache Kafka',
    description: 'Distributed event streaming platform for high-throughput pipelines.',
    icon: 'i-simple-icons-apachekafka',
    iconColor: 'text-gray-400',
    category: 'queue',
    tags: ['streaming', 'events', 'pipelines'],
    defaultPort: 9092
  },

  // ── Storage ────────────────────────────────────────────────────────────────
  {
    type: 'minio',
    name: 'MinIO',
    description: 'S3-compatible object storage for files, backups, and media.',
    icon: 'i-simple-icons-minio',
    iconColor: 'text-red-400',
    category: 'storage',
    tags: ['s3', 'storage', 'files'],
    defaultPort: 9000
  },
  {
    type: 'seaweedfs',
    name: 'SeaweedFS',
    description: 'Fast distributed storage system for billions of files.',
    icon: 'i-lucide-hard-drive',
    iconColor: 'text-green-600',
    category: 'storage',
    tags: ['storage', 'files', 'distributed'],
    defaultPort: 9333
  },

  // ── Analytics ──────────────────────────────────────────────────────────────
  {
    type: 'plausible',
    name: 'Plausible',
    description: 'Privacy-friendly Google Analytics alternative.',
    icon: 'i-simple-icons-plausibleanalytics',
    iconColor: 'text-indigo-500',
    category: 'analytics',
    tags: ['analytics', 'privacy', 'web'],
    defaultPort: 8000
  },
  {
    type: 'umami',
    name: 'Umami',
    description: 'Simple, fast, privacy-focused web analytics.',
    icon: 'i-simple-icons-umami',
    iconColor: 'text-gray-600',
    category: 'analytics',
    tags: ['analytics', 'privacy', 'simple'],
    defaultPort: 3000
  },
  {
    type: 'matomo',
    name: 'Matomo',
    description: 'Full-featured web analytics platform you control.',
    icon: 'i-simple-icons-matomo',
    iconColor: 'text-blue-600',
    category: 'analytics',
    tags: ['analytics', 'enterprise', 'gdpr'],
    defaultPort: 80
  },
  {
    type: 'posthog',
    name: 'PostHog',
    description: 'Product analytics with session replay, feature flags, and A/B testing.',
    icon: 'i-simple-icons-posthog',
    iconColor: 'text-blue-500',
    category: 'analytics',
    tags: ['analytics', 'product', 'features'],
    defaultPort: 8000
  },

  // ── Automation ─────────────────────────────────────────────────────────────
  {
    type: 'n8n',
    name: 'n8n',
    description: 'Workflow automation tool to connect apps and automate tasks.',
    icon: 'i-simple-icons-n8n',
    iconColor: 'text-orange-500',
    category: 'automation',
    tags: ['automation', 'workflow', 'integration'],
    defaultPort: 5678
  },
  {
    type: 'activepieces',
    name: 'Activepieces',
    description: 'Open-source Zapier alternative for workflow automation.',
    icon: 'i-lucide-puzzle',
    iconColor: 'text-purple-500',
    category: 'automation',
    tags: ['automation', 'zapier', 'nocode'],
    defaultPort: 8080
  },
  {
    type: 'windmill',
    name: 'Windmill',
    description: 'Developer platform for scripts, workflows, and UIs.',
    icon: 'i-lucide-wind',
    iconColor: 'text-blue-400',
    category: 'automation',
    tags: ['automation', 'scripts', 'developer'],
    defaultPort: 8000
  },
  {
    type: 'temporal',
    name: 'Temporal',
    description: 'Durable workflow execution platform for microservices.',
    icon: 'i-lucide-clock',
    iconColor: 'text-indigo-400',
    category: 'automation',
    tags: ['workflow', 'durable', 'microservices'],
    defaultPort: 7233
  },

  // ── Development ────────────────────────────────────────────────────────────
  {
    type: 'gitea',
    name: 'Gitea',
    description: 'Lightweight self-hosted Git service.',
    icon: 'i-simple-icons-gitea',
    iconColor: 'text-green-600',
    category: 'development',
    tags: ['git', 'code', 'lightweight'],
    defaultPort: 3000
  },
  {
    type: 'gitlab',
    name: 'GitLab',
    description: 'Complete DevOps platform with Git, CI/CD, and more.',
    icon: 'i-simple-icons-gitlab',
    iconColor: 'text-orange-500',
    category: 'development',
    tags: ['git', 'cicd', 'devops'],
    defaultPort: 80
  },
  {
    type: 'forgejo',
    name: 'Forgejo',
    description: 'Community-driven Gitea fork focused on sustainability.',
    icon: 'i-simple-icons-forgejo',
    iconColor: 'text-orange-400',
    category: 'development',
    tags: ['git', 'code', 'community'],
    defaultPort: 3000
  },
  {
    type: 'codeserver',
    name: 'Code Server',
    description: 'VS Code in the browser for remote development.',
    icon: 'i-simple-icons-visualstudiocode',
    iconColor: 'text-blue-500',
    category: 'development',
    tags: ['ide', 'vscode', 'remote'],
    defaultPort: 8080
  },

  // ── Monitoring ─────────────────────────────────────────────────────────────
  {
    type: 'grafana',
    name: 'Grafana',
    description: 'Observability platform for metrics, logs, and traces.',
    icon: 'i-simple-icons-grafana',
    iconColor: 'text-orange-500',
    category: 'monitoring',
    tags: ['monitoring', 'metrics', 'dashboards'],
    defaultPort: 3000
  },
  {
    type: 'uptimekuma',
    name: 'Uptime Kuma',
    description: 'Self-hosted monitoring tool for websites and services.',
    icon: 'i-lucide-activity',
    iconColor: 'text-green-500',
    category: 'monitoring',
    tags: ['monitoring', 'uptime', 'alerts'],
    defaultPort: 3001
  },
  {
    type: 'prometheus',
    name: 'Prometheus',
    description: 'Monitoring system with time-series database.',
    icon: 'i-simple-icons-prometheus',
    iconColor: 'text-orange-400',
    category: 'monitoring',
    tags: ['monitoring', 'metrics', 'alerting'],
    defaultPort: 9090
  },
  {
    type: 'healthchecks',
    name: 'Healthchecks',
    description: 'Cron job monitoring service with alerts.',
    icon: 'i-lucide-heart-pulse',
    iconColor: 'text-green-500',
    category: 'monitoring',
    tags: ['monitoring', 'cron', 'alerts'],
    defaultPort: 8000
  },

  // ── CMS ────────────────────────────────────────────────────────────────────
  {
    type: 'ghost',
    name: 'Ghost',
    description: 'Modern publishing platform for blogs and newsletters.',
    icon: 'i-simple-icons-ghost',
    iconColor: 'text-gray-500',
    category: 'cms',
    tags: ['blog', 'publishing', 'newsletter'],
    defaultPort: 2368
  },
  {
    type: 'strapi',
    name: 'Strapi',
    description: 'Headless CMS with customizable API and admin panel.',
    icon: 'i-simple-icons-strapi',
    iconColor: 'text-indigo-500',
    category: 'cms',
    tags: ['cms', 'headless', 'api'],
    defaultPort: 1337
  },
  {
    type: 'directus',
    name: 'Directus',
    description: 'Open data platform for managing any SQL database.',
    icon: 'i-simple-icons-directus',
    iconColor: 'text-purple-500',
    category: 'cms',
    tags: ['cms', 'headless', 'database'],
    defaultPort: 8055
  },
  {
    type: 'wordpress',
    name: 'WordPress',
    description: 'The world\'s most popular CMS for websites and blogs.',
    icon: 'i-simple-icons-wordpress',
    iconColor: 'text-blue-600',
    category: 'cms',
    tags: ['cms', 'blog', 'website'],
    defaultPort: 80
  },

  // ── Communication ──────────────────────────────────────────────────────────
  {
    type: 'mattermost',
    name: 'Mattermost',
    description: 'Secure collaboration platform, Slack alternative.',
    icon: 'i-simple-icons-mattermost',
    iconColor: 'text-blue-500',
    category: 'communication',
    tags: ['chat', 'team', 'slack'],
    defaultPort: 8065
  },
  {
    type: 'rocketchat',
    name: 'Rocket.Chat',
    description: 'Open-source team communication platform.',
    icon: 'i-simple-icons-rocket-dot-chat',
    iconColor: 'text-red-500',
    category: 'communication',
    tags: ['chat', 'team', 'omnichannel'],
    defaultPort: 3000
  },
  {
    type: 'listmonk',
    name: 'Listmonk',
    description: 'High-performance self-hosted newsletter and mailing list manager.',
    icon: 'i-lucide-mail',
    iconColor: 'text-orange-500',
    category: 'communication',
    tags: ['email', 'newsletter', 'marketing'],
    defaultPort: 9000
  }
]

const categories = [
  { value: '__all__', label: 'All', icon: 'i-lucide-grid-3x3' },
  { value: 'database', label: 'Databases', icon: 'i-lucide-database' },
  { value: 'cache', label: 'Caching', icon: 'i-lucide-zap' },
  { value: 'queue', label: 'Queues', icon: 'i-lucide-mail' },
  { value: 'search', label: 'Search', icon: 'i-lucide-search' },
  { value: 'storage', label: 'Storage', icon: 'i-lucide-hard-drive' },
  { value: 'analytics', label: 'Analytics', icon: 'i-lucide-bar-chart-3' },
  { value: 'automation', label: 'Automation', icon: 'i-lucide-workflow' },
  { value: 'development', label: 'Development', icon: 'i-lucide-code' },
  { value: 'monitoring', label: 'Monitoring', icon: 'i-lucide-activity' },
  { value: 'cms', label: 'CMS', icon: 'i-lucide-file-text' },
  { value: 'communication', label: 'Communication', icon: 'i-lucide-message-circle' }
]

// ---------------------------------------------------------------------------
// Tab & filter state
// ---------------------------------------------------------------------------

const activeTab = ref<'catalog' | 'deployed'>('catalog')
const selectedCategory = ref('__all__')
const searchQuery = ref('')

const filteredCatalog = computed(() => {
  let items = catalog
  if (selectedCategory.value !== '__all__') {
    items = items.filter(i => i.category === selectedCategory.value)
  }
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    items = items.filter(i =>
      i.name.toLowerCase().includes(q)
      || i.description.toLowerCase().includes(q)
      || i.tags.some(t => t.includes(q))
    )
  }
  return items
})

// ---------------------------------------------------------------------------
// Deployed resources
// ---------------------------------------------------------------------------

const page = ref(1)

const { data, status, refresh } = await useLazyAsyncData(
  'resources',
  () => getAll({ page: page.value }),
  { immediate: true, watch: [page], server: false }
)

const loading = computed(() => status.value === 'pending')
const deployedResources = computed(() => data.value?.items ?? [])

// Count deployed instances per type
const deployedCounts = computed(() => {
  const counts: Record<string, number> = {}
  for (const resource of deployedResources.value) {
    counts[resource.type] = (counts[resource.type] ?? 0) + 1
  }
  return counts
})

// ---------------------------------------------------------------------------
// Deploy dialog
// ---------------------------------------------------------------------------

const deployTarget = ref<TResourceCatalogItem | null>(null)
const dialogDeploy = ref(false)
const deploying = ref(false)

const deployForm = reactive({
  name: '',
  namespace: 'cp-resources',
  // Database common options
  replicas: 1,
  tls: true,
  rootPassword: '',
  // Additional user
  createUser: false,
  username: '',
  password: '',
  database: '',
  // Redis-specific
  clusterMode: false,
  redisPassword: ''
})

function generatePassword(length = 24): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*'
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

function openDeploy(item: TResourceCatalogItem) {
  deployTarget.value = item
  deployForm.name = item.type
  deployForm.namespace = 'cp-resources'
  // Reset all config
  deployForm.replicas = item.type === 'mongodb' ? 3 : 1
  deployForm.tls = true
  deployForm.rootPassword = generatePassword()
  deployForm.createUser = false
  deployForm.username = ''
  deployForm.password = ''
  deployForm.database = ''
  deployForm.clusterMode = false
  deployForm.redisPassword = generatePassword(32)
  dialogDeploy.value = true
}

async function submitDeploy() {
  if (!deployTarget.value || !deployForm.name) return
  deploying.value = true
  try {
    // Build config based on resource type
    const config: Record<string, unknown> = {}
    const type = deployTarget.value.type
    
    // MongoDB config
    if (type === 'mongodb') {
      config.replicas = deployForm.replicas
      config.tls = deployForm.tls
      config.rootPassword = deployForm.rootPassword
      if (deployForm.createUser && deployForm.username && deployForm.password && deployForm.database) {
        config.users = [{
          username: deployForm.username,
          password: deployForm.password,
          database: deployForm.database
        }]
      }
    }
    
    // PostgreSQL config
    if (type === 'postgresql') {
      config.replicas = deployForm.replicas
      config.tls = deployForm.tls
      config.rootPassword = deployForm.rootPassword
      if (deployForm.createUser && deployForm.username && deployForm.password && deployForm.database) {
        config.users = [{
          username: deployForm.username,
          password: deployForm.password,
          database: deployForm.database
        }]
      }
    }
    
    // MySQL/MariaDB config
    if (type === 'mysql' || type === 'mariadb') {
      config.replicas = deployForm.replicas
      config.tls = deployForm.tls
      config.rootPassword = deployForm.rootPassword
      if (deployForm.createUser && deployForm.username && deployForm.password && deployForm.database) {
        config.users = [{
          username: deployForm.username,
          password: deployForm.password,
          database: deployForm.database
        }]
      }
    }
    
    // Redis config
    if (type === 'redis' || type === 'keydb' || type === 'dragonfly') {
      config.password = deployForm.redisPassword
      config.clusterMode = deployForm.clusterMode
      if (deployForm.clusterMode) {
        config.replicas = deployForm.replicas
      }
    }

    await add({
      name: deployForm.name,
      type: deployTarget.value.type as TAddonType,
      namespace: deployForm.namespace,
      config: Object.keys(config).length ? config : undefined
    })
    toast.add({
      title: `${deployTarget.value.name} deploying`,
      description: `${deployForm.name} is being deployed via Helm.`,
      color: 'success',
      icon: 'i-lucide-rocket'
    })
    dialogDeploy.value = false
    activeTab.value = 'deployed'
    await refresh()
  } catch (error: unknown) {
    const err = error as { data?: { message?: string } }
    toast.add({
      title: 'Deploy failed',
      description: err?.data?.message ?? 'Unknown error',
      color: 'error'
    })
  } finally {
    deploying.value = false
  }
}

// ---------------------------------------------------------------------------
// Connection info dialog
// ---------------------------------------------------------------------------

const connectionTarget = ref<TAddon | null>(null)
const dialogConnection = ref(false)
const connectionInfo = ref<TAddonConnectionInfo | null>(null)
const loadingConnection = ref(false)

async function openConnectionInfo(resource: TAddon) {
  connectionTarget.value = resource
  connectionInfo.value = null
  dialogConnection.value = true
  loadingConnection.value = true
  try {
    const result = await getConnectionInfo(resource._id)
    connectionInfo.value = result.connectionInfo
  } catch (error: unknown) {
    const err = error as { data?: { message?: string } }
    toast.add({
      title: err?.data?.message || 'Failed to get connection info',
      color: 'error'
    })
    dialogConnection.value = false
  } finally {
    loadingConnection.value = false
  }
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text)
  toast.add({ title: 'Copied to clipboard', color: 'success', icon: 'i-lucide-copy' })
}

// ---------------------------------------------------------------------------
// Delete dialog
// ---------------------------------------------------------------------------

const deleteTarget = ref<TAddon | null>(null)
const dialogDelete = ref(false)
const deleting = ref(false)

function openDelete(resource: TAddon) {
  deleteTarget.value = resource
  dialogDelete.value = true
}

async function submitDelete() {
  if (!deleteTarget.value || deleting.value) return
  deleting.value = true
  try {
    await deleteById(deleteTarget.value._id)
    toast.add({
      title: `${deleteTarget.value.name} deleted`,
      color: 'success',
      icon: 'i-lucide-check-circle'
    })
    dialogDelete.value = false
    deleteTarget.value = null
    await refresh()
  } catch (error: unknown) {
    const err = error as { data?: { message?: string } }
    toast.add({
      title: err?.data?.message || 'Failed to delete',
      color: 'error'
    })
  } finally {
    deleting.value = false
  }
}

// ---------------------------------------------------------------------------
// Resource actions (start/stop/restart)
// ---------------------------------------------------------------------------

const actionLoading = ref<string | null>(null)

async function handleStart(resource: TAddon) {
  actionLoading.value = resource._id
  try {
    await start(resource._id)
    toast.add({ title: `${resource.name} starting...`, color: 'success', icon: 'i-lucide-play' })
    await refresh()
  } catch (error: unknown) {
    const err = error as { data?: { message?: string } }
    toast.add({ title: err?.data?.message || 'Failed to start', color: 'error' })
  } finally {
    actionLoading.value = null
  }
}

async function handleStop(resource: TAddon) {
  actionLoading.value = resource._id
  try {
    await stop(resource._id)
    toast.add({ title: `${resource.name} stopping...`, color: 'warning', icon: 'i-lucide-pause' })
    await refresh()
  } catch (error: unknown) {
    const err = error as { data?: { message?: string } }
    toast.add({ title: err?.data?.message || 'Failed to stop', color: 'error' })
  } finally {
    actionLoading.value = null
  }
}

async function handleRestart(resource: TAddon) {
  actionLoading.value = resource._id
  try {
    await restart(resource._id)
    toast.add({ title: `${resource.name} restarting...`, color: 'info', icon: 'i-lucide-refresh-cw' })
    await refresh()
  } catch (error: unknown) {
    const err = error as { data?: { message?: string } }
    toast.add({ title: err?.data?.message || 'Failed to restart', color: 'error' })
  } finally {
    actionLoading.value = null
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const statusColor: Record<string, 'success' | 'error' | 'warning' | 'neutral'> = {
  pending: 'neutral',
  provisioning: 'warning',
  deploying: 'warning',
  running: 'success',
  stopped: 'neutral',
  failed: 'error',
  deleting: 'warning'
}

function getCatalogItem(type: string): TResourceCatalogItem | undefined {
  return catalog.find(c => c.type === type)
}

// Check if type is a database that needs config
const isDatabaseType = computed(() => {
  const t = deployTarget.value?.type
  return t === 'mongodb' || t === 'postgresql' || t === 'mysql' || t === 'mariadb'
})

const isRedisType = computed(() => {
  const t = deployTarget.value?.type
  return t === 'redis' || t === 'keydb' || t === 'dragonfly'
})

useHead({ title: 'Resources · Control Plane' })
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div>
      <h1 class="text-2xl font-bold text-highlighted">
        Resources
      </h1>
      <p class="text-muted">
        One-click services deployed via Helm — databases, caches, analytics, and more.
      </p>
    </div>

    <!-- Tabs -->
    <div class="flex items-center justify-between border-b border-default">
      <div class="flex gap-1">
        <button
          class="px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px"
          :class="activeTab === 'catalog'
            ? 'border-primary text-primary'
            : 'border-transparent text-muted hover:text-highlighted'"
          @click="activeTab = 'catalog'"
        >
          <UIcon
            name="i-lucide-grid-3x3"
            class="size-4 mr-1.5 inline"
          />
          Catalog
          <UBadge
            :label="String(catalog.length)"
            color="neutral"
            variant="subtle"
            size="xs"
            class="ml-1.5"
          />
        </button>
        <button
          class="px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px"
          :class="activeTab === 'deployed'
            ? 'border-primary text-primary'
            : 'border-transparent text-muted hover:text-highlighted'"
          @click="activeTab = 'deployed'"
        >
          <UIcon
            name="i-lucide-server"
            class="size-4 mr-1.5 inline"
          />
          Deployed
          <UBadge
            v-if="deployedResources.length"
            :label="String(deployedResources.length)"
            color="success"
            variant="subtle"
            size="xs"
            class="ml-1.5"
          />
        </button>
      </div>

      <UButton
        v-if="activeTab === 'deployed'"
        icon="i-lucide-refresh-cw"
        color="neutral"
        variant="ghost"
        size="sm"
        :loading="loading"
        @click="() => refresh()"
      />
    </div>

    <!-- Catalog Tab -->
    <div
      v-if="activeTab === 'catalog'"
      class="space-y-6"
    >
      <!-- Search -->
      <UInput
        v-model="searchQuery"
        icon="i-lucide-search"
        placeholder="Search services..."
        class="max-w-sm"
      />

      <!-- Category filters -->
      <div class="flex flex-wrap gap-2">
        <UButton
          v-for="cat in categories"
          :key="cat.value"
          :color="selectedCategory === cat.value ? 'primary' : 'neutral'"
          :variant="selectedCategory === cat.value ? 'soft' : 'ghost'"
          size="xs"
          @click="selectedCategory = cat.value"
        >
          <UIcon
            :name="cat.icon"
            class="size-3.5 mr-1"
          />
          {{ cat.label }}
        </UButton>
      </div>

      <!-- Catalog Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        <div
          v-for="item in filteredCatalog"
          :key="item.type"
          class="group relative rounded-xl border border-default bg-elevated/50 p-4 hover:border-primary/50 hover:bg-elevated transition-all cursor-pointer"
          @click="openDeploy(item)"
        >
          <!-- Deployed count badge -->
          <UBadge
            v-if="deployedCounts[item.type]"
            :label="`${deployedCounts[item.type]}`"
            color="success"
            variant="subtle"
            size="xs"
            class="absolute top-3 right-3"
          />

          <div class="flex items-start gap-3">
            <div
              class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-default border border-default"
            >
              <UIcon
                :name="item.icon"
                :class="[item.iconColor, 'size-5']"
              />
            </div>
            <div class="flex-1 min-w-0">
              <h3 class="font-semibold text-highlighted text-sm group-hover:text-primary transition-colors">
                {{ item.name }}
              </h3>
              <p class="text-xs text-muted mt-0.5 line-clamp-2">
                {{ item.description }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div
        v-if="!filteredCatalog.length"
        class="text-center py-12"
      >
        <UIcon
          name="i-lucide-search-x"
          class="size-12 text-muted mx-auto mb-4"
        />
        <p class="text-lg font-medium text-highlighted">
          No services found
        </p>
        <p class="text-muted mt-1">
          Try a different search or category.
        </p>
      </div>
    </div>

    <!-- Deployed Tab -->
    <div
      v-if="activeTab === 'deployed'"
      class="space-y-4"
    >
      <!-- Empty state -->
      <div
        v-if="!deployedResources.length && !loading"
        class="text-center py-12"
      >
        <UIcon
          name="i-lucide-puzzle"
          class="size-12 text-muted mx-auto mb-4"
        />
        <p class="text-lg font-medium text-highlighted">
          No resources deployed
        </p>
        <p class="text-muted mt-1">
          Browse the catalog and deploy your first service.
        </p>
        <UButton
          class="mt-4"
          icon="i-lucide-grid-3x3"
          label="Browse Catalog"
          @click="activeTab = 'catalog'"
        />
      </div>

      <!-- Loading skeleton -->
      <div
        v-else-if="loading && !deployedResources.length"
        class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
      >
        <USkeleton
          v-for="i in 3"
          :key="i"
          class="h-36 rounded-xl"
        />
      </div>

      <!-- Deployed resources grid -->
      <div
        v-else
        class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
      >
        <div
          v-for="resource in deployedResources"
          :key="resource._id"
          class="rounded-xl border border-default bg-elevated/50 p-5"
        >
          <div class="flex items-start justify-between">
            <div class="flex items-start gap-3">
              <div
                class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-default border border-default"
              >
                <UIcon
                  :name="getCatalogItem(resource.type)?.icon ?? 'i-lucide-box'"
                  :class="[getCatalogItem(resource.type)?.iconColor ?? 'text-muted', 'size-5']"
                />
              </div>
              <div>
                <h3 class="font-semibold text-highlighted">
                  {{ resource.name }}
                </h3>
                <p class="text-xs text-muted">
                  {{ getCatalogItem(resource.type)?.name ?? resource.type }}
                </p>
              </div>
            </div>

            <div class="flex items-center gap-1">
              <UBadge
                :color="statusColor[resource.status] ?? 'neutral'"
                :label="resource.status"
                variant="subtle"
                size="xs"
              />
              <UIcon
                v-if="resource.status === 'deploying' || resource.status === 'provisioning'"
                name="i-lucide-loader-2"
                class="size-3 animate-spin text-warning ml-1"
              />
            </div>
          </div>

          <div class="mt-4 flex items-center gap-2 text-xs text-muted">
            <code class="bg-muted px-1.5 py-0.5 rounded">
              {{ resource.namespace }}
            </code>
            <span>·</span>
            <span>Port {{ getCatalogItem(resource.type)?.defaultPort }}</span>
          </div>

          <!-- Actions -->
          <div class="mt-4 flex items-center gap-2 border-t border-default pt-4">
            <UButton
              v-if="resource.status === 'running'"
              icon="i-lucide-link"
              color="neutral"
              variant="outline"
              size="xs"
              label="Connect"
              @click="openConnectionInfo(resource)"
            />
            <UButton
              v-if="resource.status === 'stopped'"
              icon="i-lucide-play"
              color="success"
              variant="soft"
              size="xs"
              label="Start"
              :loading="actionLoading === resource._id"
              @click="handleStart(resource)"
            />
            <UButton
              v-if="resource.status === 'running'"
              icon="i-lucide-pause"
              color="warning"
              variant="ghost"
              size="xs"
              label="Stop"
              :loading="actionLoading === resource._id"
              @click="handleStop(resource)"
            />
            <UButton
              v-if="resource.status === 'running'"
              icon="i-lucide-refresh-cw"
              color="neutral"
              variant="ghost"
              size="xs"
              :loading="actionLoading === resource._id"
              @click="handleRestart(resource)"
            />
            <div class="flex-1" />
            <UButton
              icon="i-lucide-trash"
              color="error"
              variant="ghost"
              size="xs"
              @click="openDelete(resource)"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Deploy Modal -->
    <UModal
      v-model:open="dialogDeploy"
      :class="deployTarget?.hasConfig ? 'max-w-lg' : 'max-w-md'"
    >
      <template #header>
        <div class="flex items-center gap-3">
          <div
            class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-default border border-default"
          >
            <UIcon
              v-if="deployTarget"
              :name="deployTarget.icon"
              :class="[deployTarget.iconColor, 'size-5']"
            />
          </div>
          <div>
            <h3 class="text-lg font-semibold">
              Deploy {{ deployTarget?.name }}
            </h3>
            <p class="text-sm text-muted">
              Configure and deploy via Helm
            </p>
          </div>
        </div>
      </template>

      <template #body>
        <div class="p-6 space-y-4">
          <UFormField
            label="Instance Name"
            required
          >
            <UInput
              v-model="deployForm.name"
              :placeholder="`my-${deployTarget?.type}`"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Namespace">
            <UInput
              v-model="deployForm.namespace"
              placeholder="cp-resources"
              class="w-full"
            />
          </UFormField>

          <!-- Database config (MongoDB, PostgreSQL, MySQL, MariaDB) -->
          <template v-if="isDatabaseType">
            <USeparator label="Database Configuration" />

            <UFormField label="Replicas">
              <USelect
                v-model="deployForm.replicas"
                :items="[
                  { value: 1, label: '1 (Standalone)' },
                  { value: 2, label: '2 (Primary + Replica)' },
                  { value: 3, label: '3 (Recommended)' }
                ]"
                class="w-full"
              />
            </UFormField>

            <div class="flex items-center justify-between rounded-lg border border-default bg-default/30 px-4 py-3">
              <div>
                <p class="font-medium text-sm">TLS Encryption</p>
                <p class="text-xs text-muted">Encrypt client connections</p>
              </div>
              <USwitch v-model="deployForm.tls" />
            </div>

            <UFormField label="Root Password">
              <div class="flex gap-2">
                <UInput
                  v-model="deployForm.rootPassword"
                  type="password"
                  placeholder="••••••••"
                  class="flex-1"
                />
                <UButton
                  icon="i-lucide-refresh-cw"
                  color="neutral"
                  variant="outline"
                  @click="deployForm.rootPassword = generatePassword()"
                />
              </div>
            </UFormField>

            <USeparator label="Application User (Optional)" />

            <div class="flex items-center justify-between rounded-lg border border-default bg-default/30 px-4 py-3">
              <div>
                <p class="font-medium text-sm">Create Application User</p>
                <p class="text-xs text-muted">Add a user with access to a database</p>
              </div>
              <USwitch v-model="deployForm.createUser" />
            </div>

            <template v-if="deployForm.createUser">
              <div class="grid grid-cols-2 gap-3">
                <UFormField label="Username">
                  <UInput
                    v-model="deployForm.username"
                    placeholder="appuser"
                    class="w-full"
                  />
                </UFormField>

                <UFormField label="Password">
                  <div class="flex gap-1">
                    <UInput
                      v-model="deployForm.password"
                      type="password"
                      placeholder="••••••••"
                      class="flex-1"
                    />
                    <UButton
                      icon="i-lucide-refresh-cw"
                      color="neutral"
                      variant="ghost"
                      size="sm"
                      @click="deployForm.password = generatePassword(16)"
                    />
                  </div>
                </UFormField>
              </div>

              <UFormField label="Database">
                <UInput
                  v-model="deployForm.database"
                  placeholder="myapp"
                  class="w-full"
                />
              </UFormField>
            </template>
          </template>

          <!-- Redis config -->
          <template v-if="isRedisType">
            <USeparator label="Redis Configuration" />

            <UFormField label="Password">
              <div class="flex gap-2">
                <UInput
                  v-model="deployForm.redisPassword"
                  type="password"
                  placeholder="••••••••"
                  class="flex-1"
                />
                <UButton
                  icon="i-lucide-refresh-cw"
                  color="neutral"
                  variant="outline"
                  @click="deployForm.redisPassword = generatePassword(32)"
                />
              </div>
            </UFormField>

            <div class="flex items-center justify-between rounded-lg border border-default bg-default/30 px-4 py-3">
              <div>
                <p class="font-medium text-sm">Cluster Mode</p>
                <p class="text-xs text-muted">Enable Redis Cluster for horizontal scaling</p>
              </div>
              <USwitch v-model="deployForm.clusterMode" />
            </div>

            <UFormField
              v-if="deployForm.clusterMode"
              label="Cluster Nodes"
            >
              <USelect
                v-model="deployForm.replicas"
                :items="[
                  { value: 3, label: '3 nodes (minimum)' },
                  { value: 6, label: '6 nodes (3 primary + 3 replica)' }
                ]"
                class="w-full"
              />
            </UFormField>
          </template>

          <!-- Generic info for other services -->
          <UAlert
            v-if="!isDatabaseType && !isRedisType"
            color="info"
            variant="soft"
            icon="i-lucide-info"
          >
            <template #description>
              <p class="text-sm">
                {{ deployTarget?.name }} will be deployed with default settings.
                Connection info will be available once running.
              </p>
            </template>
          </UAlert>
        </div>
      </template>

      <template #footer>
        <UButton
          color="neutral"
          variant="ghost"
          @click="dialogDeploy = false"
        >
          Cancel
        </UButton>
        <UButton
          :loading="deploying"
          :disabled="!deployForm.name"
          icon="i-lucide-rocket"
          @click="submitDeploy"
        >
          Deploy
        </UButton>
      </template>
    </UModal>

    <!-- Connection Info Modal -->
    <UModal
      v-model:open="dialogConnection"
      class="max-w-lg"
    >
      <template #header>
        <div class="flex items-center gap-3">
          <div
            v-if="connectionTarget"
            class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-default border border-default"
          >
            <UIcon
              :name="getCatalogItem(connectionTarget.type)?.icon ?? 'i-lucide-box'"
              :class="[getCatalogItem(connectionTarget.type)?.iconColor ?? 'text-muted', 'size-5']"
            />
          </div>
          <div>
            <h3 class="text-lg font-semibold">
              {{ connectionTarget?.name }}
            </h3>
            <p class="text-sm text-muted">
              Connection details
            </p>
          </div>
        </div>
      </template>

      <template #body>
        <div class="p-6">
          <div
            v-if="loadingConnection"
            class="space-y-4"
          >
            <USkeleton class="h-10 w-full" />
            <USkeleton class="h-10 w-full" />
            <USkeleton class="h-16 w-full" />
          </div>

          <div
            v-else-if="connectionInfo"
            class="space-y-4"
          >
            <div class="grid grid-cols-2 gap-4">
              <UFormField label="Host">
                <div class="flex items-center gap-2">
                  <code class="flex-1 text-sm bg-muted px-3 py-2 rounded font-mono truncate">
                    {{ connectionInfo.host }}
                  </code>
                  <UButton
                    icon="i-lucide-copy"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    @click="copyToClipboard(connectionInfo.host)"
                  />
                </div>
              </UFormField>

              <UFormField label="Port">
                <div class="flex items-center gap-2">
                  <code class="flex-1 text-sm bg-muted px-3 py-2 rounded font-mono">
                    {{ connectionInfo.port }}
                  </code>
                  <UButton
                    icon="i-lucide-copy"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    @click="copyToClipboard(String(connectionInfo.port))"
                  />
                </div>
              </UFormField>
            </div>

            <div
              v-if="connectionInfo.username"
              class="grid grid-cols-2 gap-4"
            >
              <UFormField label="Username">
                <div class="flex items-center gap-2">
                  <code class="flex-1 text-sm bg-muted px-3 py-2 rounded font-mono">
                    {{ connectionInfo.username }}
                  </code>
                  <UButton
                    icon="i-lucide-copy"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    @click="copyToClipboard(connectionInfo.username!)"
                  />
                </div>
              </UFormField>

              <UFormField
                v-if="connectionInfo.password"
                label="Password"
              >
                <div class="flex items-center gap-2">
                  <code class="flex-1 text-sm bg-muted px-3 py-2 rounded font-mono">
                    ••••••••
                  </code>
                  <UButton
                    icon="i-lucide-copy"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    @click="copyToClipboard(connectionInfo.password!)"
                  />
                </div>
              </UFormField>
            </div>

            <UFormField
              v-if="connectionInfo.connectionString"
              label="Connection String"
            >
              <div class="flex items-center gap-2">
                <code class="flex-1 text-xs bg-muted px-3 py-2 rounded font-mono break-all">
                  {{ connectionInfo.connectionString }}
                </code>
                <UButton
                  icon="i-lucide-copy"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  @click="copyToClipboard(connectionInfo.connectionString!)"
                />
              </div>
            </UFormField>

            <UAlert
              color="warning"
              variant="soft"
              icon="i-lucide-shield"
              title="Keep credentials secure"
              description="These credentials provide full access to your service."
            />
          </div>

          <div
            v-else
            class="text-center py-8"
          >
            <UIcon
              name="i-lucide-alert-circle"
              class="size-10 text-muted mx-auto mb-3"
            />
            <p class="text-muted">
              Unable to retrieve connection info.
            </p>
          </div>
        </div>
      </template>

      <template #footer>
        <UButton
          color="neutral"
          variant="ghost"
          @click="dialogConnection = false"
        >
          Close
        </UButton>
      </template>
    </UModal>

    <!-- Delete Confirmation Modal -->
    <UModal
      v-model:open="dialogDelete"
      class="max-w-sm"
    >
      <template #header>
        <h3 class="text-lg font-semibold">
          Delete Resource
        </h3>
      </template>

      <template #body>
        <div class="p-6">
          <div class="flex items-start gap-4">
            <div class="flex size-10 shrink-0 items-center justify-center rounded-full bg-error/10">
              <UIcon
                name="i-lucide-alert-triangle"
                class="size-5 text-error"
              />
            </div>
            <div>
              <p class="text-muted">
                Are you sure you want to delete
                <span class="font-medium text-highlighted">{{ deleteTarget?.name }}</span>?
              </p>
              <p class="text-sm text-muted mt-2">
                This will uninstall the Helm release and remove all data. This cannot be undone.
              </p>
            </div>
          </div>
        </div>
      </template>

      <template #footer>
        <UButton
          color="neutral"
          variant="ghost"
          @click="dialogDelete = false"
        >
          Cancel
        </UButton>
        <UButton
          color="error"
          :loading="deleting"
          icon="i-lucide-trash"
          @click="submitDelete"
        >
          Delete
        </UButton>
      </template>
    </UModal>
  </div>
</template>
