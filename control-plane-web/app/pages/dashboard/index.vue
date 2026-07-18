<script setup lang="ts">
/**
 * Dashboard index page — infrastructure overview.
 */
definePageMeta({
  layout: 'dashboard',
  middleware: 'auth',
  secured: true
})

const { getAll: getServers } = useServer()
const { getAll: getApps } = useApp()
const { getAll: getDatabases } = useDatabase()

// Fetch all stats in parallel
const { data: statsData, status } = await useLazyAsyncData(
  'dashboard-stats',
  async () => {
    const [servers, apps, databases] = await Promise.all([
      getServers({ page: 1 }).catch(() => ({ items: [], pages: 0 })),
      getApps({ page: 1 }).catch(() => ({ items: [], pages: 0 })),
      getDatabases({ page: 1 }).catch(() => ({ items: [], pages: 0 }))
    ])
    return { servers, apps, databases }
  },
  { immediate: true }
)

const loading = computed(() => status.value === 'pending')

// Compute stats
const serverCount = computed(() => statsData.value?.servers?.items?.length ?? 0)
const appCount = computed(() => statsData.value?.apps?.items?.length ?? 0)
const databaseCount = computed(() => statsData.value?.databases?.items?.length ?? 0)
const runningApps = computed(() =>
  statsData.value?.apps?.items?.filter((a: TApp) => a.status === 'running')?.length ?? 0
)
const onlineServers = computed(() =>
  statsData.value?.servers?.items?.filter((s: TServer) => s.status === 'online')?.length ?? 0
)

// Recent items
const recentServers = computed(() => statsData.value?.servers?.items?.slice(0, 5) ?? [])
const recentApps = computed(() => statsData.value?.apps?.items?.slice(0, 5) ?? [])

function getStatusColor(status: string) {
  switch (status) {
    case 'online':
    case 'running':
      return 'success'
    case 'offline':
    case 'failed':
      return 'error'
    case 'deploying':
    case 'provisioning':
      return 'warning'
    default:
      return 'neutral'
  }
}

useHead({ title: 'Dashboard · Control Plane' })
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-highlighted">
          Dashboard
        </h1>
        <p class="text-muted">
          Overview of your infrastructure.
        </p>
      </div>
      <div class="flex gap-2">
        <UButton
          to="/dashboard/servers"
          variant="soft"
          color="neutral"
          icon="i-lucide-plus"
          label="Add Server"
        />
        <UButton
          to="/dashboard/apps"
          icon="i-lucide-plus"
          label="Deploy App"
        />
      </div>
    </div>

    <!-- Stats Grid -->
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div class="rounded-lg border border-default bg-elevated p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm text-muted">
              Servers
            </p>
            <p class="text-2xl font-semibold text-highlighted">
              <template v-if="loading">
                <span class="inline-block w-8 h-7 bg-muted rounded animate-pulse" />
              </template>
              <template v-else>
                {{ serverCount }}
              </template>
            </p>
          </div>
          <div class="flex size-12 items-center justify-center rounded-lg bg-primary/10">
            <UIcon
              name="i-lucide-server"
              class="size-6 text-primary"
            />
          </div>
        </div>
        <p class="mt-2 text-xs text-muted">
          <span class="text-success">{{ onlineServers }}</span> online
        </p>
      </div>

      <div class="rounded-lg border border-default bg-elevated p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm text-muted">
              Apps
            </p>
            <p class="text-2xl font-semibold text-highlighted">
              <template v-if="loading">
                <span class="inline-block w-8 h-7 bg-muted rounded animate-pulse" />
              </template>
              <template v-else>
                {{ appCount }}
              </template>
            </p>
          </div>
          <div class="flex size-12 items-center justify-center rounded-lg bg-success/10">
            <UIcon
              name="i-lucide-box"
              class="size-6 text-success"
            />
          </div>
        </div>
        <p class="mt-2 text-xs text-muted">
          <span class="text-success">{{ runningApps }}</span> running
        </p>
      </div>

      <div class="rounded-lg border border-default bg-elevated p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm text-muted">
              Databases
            </p>
            <p class="text-2xl font-semibold text-highlighted">
              <template v-if="loading">
                <span class="inline-block w-8 h-7 bg-muted rounded animate-pulse" />
              </template>
              <template v-else>
                {{ databaseCount }}
              </template>
            </p>
          </div>
          <div class="flex size-12 items-center justify-center rounded-lg bg-info/10">
            <UIcon
              name="i-lucide-database"
              class="size-6 text-info"
            />
          </div>
        </div>
        <p class="mt-2 text-xs text-muted">
          MongoDB, Redis, PostgreSQL
        </p>
      </div>

      <div class="rounded-lg border border-default bg-elevated p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm text-muted">
              Health
            </p>
            <p class="text-2xl font-semibold text-success">
              <template v-if="loading">
                <span class="inline-block w-8 h-7 bg-muted rounded animate-pulse" />
              </template>
              <template v-else>
                OK
              </template>
            </p>
          </div>
          <div class="flex size-12 items-center justify-center rounded-lg bg-success/10">
            <UIcon
              name="i-lucide-heart-pulse"
              class="size-6 text-success"
            />
          </div>
        </div>
        <p class="mt-2 text-xs text-muted">
          All systems operational
        </p>
      </div>
    </div>

    <!-- Recent Activity -->
    <div class="grid gap-6 lg:grid-cols-2">
      <!-- Recent Servers -->
      <div class="rounded-lg border border-default bg-elevated">
        <div class="flex items-center justify-between border-b border-default p-4">
          <h2 class="font-semibold text-highlighted">
            Servers
          </h2>
          <UButton
            to="/dashboard/servers"
            variant="link"
            color="neutral"
            label="View all"
            trailing-icon="i-lucide-arrow-right"
            size="sm"
          />
        </div>
        <div class="divide-y divide-default">
          <template v-if="loading">
            <div
              v-for="i in 3"
              :key="i"
              class="p-4"
            >
              <div class="flex items-center gap-3">
                <div class="size-8 rounded bg-muted animate-pulse" />
                <div class="flex-1 space-y-2">
                  <div class="h-4 w-32 bg-muted rounded animate-pulse" />
                  <div class="h-3 w-24 bg-muted rounded animate-pulse" />
                </div>
              </div>
            </div>
          </template>
          <template v-else-if="recentServers.length">
            <NuxtLink
              v-for="server in recentServers"
              :key="server._id"
              to="/dashboard/servers"
              class="flex items-center gap-3 p-4 hover:bg-muted transition-colors"
            >
              <div class="flex size-8 items-center justify-center rounded bg-muted">
                <UIcon
                  name="i-lucide-server"
                  class="size-4 text-muted"
                />
              </div>
              <div class="flex-1 min-w-0">
                <p class="font-medium text-highlighted truncate">
                  {{ server.name }}
                </p>
                <p class="text-xs text-muted truncate">
                  {{ server.host }}
                </p>
              </div>
              <UBadge
                :color="getStatusColor(server.status)"
                :label="server.status"
                variant="subtle"
                size="sm"
              />
            </NuxtLink>
          </template>
          <div
            v-else
            class="p-8 text-center"
          >
            <UIcon
              name="i-lucide-server"
              class="size-8 text-muted mx-auto mb-2"
            />
            <p class="text-sm text-muted">
              No servers yet
            </p>
            <UButton
              to="/dashboard/servers"
              variant="link"
              size="sm"
              label="Add your first server"
              class="mt-2"
            />
          </div>
        </div>
      </div>

      <!-- Recent Apps -->
      <div class="rounded-lg border border-default bg-elevated">
        <div class="flex items-center justify-between border-b border-default p-4">
          <h2 class="font-semibold text-highlighted">
            Apps
          </h2>
          <UButton
            to="/dashboard/apps"
            variant="link"
            color="neutral"
            label="View all"
            trailing-icon="i-lucide-arrow-right"
            size="sm"
          />
        </div>
        <div class="divide-y divide-default">
          <template v-if="loading">
            <div
              v-for="i in 3"
              :key="i"
              class="p-4"
            >
              <div class="flex items-center gap-3">
                <div class="size-8 rounded bg-muted animate-pulse" />
                <div class="flex-1 space-y-2">
                  <div class="h-4 w-32 bg-muted rounded animate-pulse" />
                  <div class="h-3 w-24 bg-muted rounded animate-pulse" />
                </div>
              </div>
            </div>
          </template>
          <template v-else-if="recentApps.length">
            <NuxtLink
              v-for="app in recentApps"
              :key="app._id"
              to="/dashboard/apps"
              class="flex items-center gap-3 p-4 hover:bg-muted transition-colors"
            >
              <div class="flex size-8 items-center justify-center rounded bg-muted">
                <UIcon
                  name="i-lucide-box"
                  class="size-4 text-muted"
                />
              </div>
              <div class="flex-1 min-w-0">
                <p class="font-medium text-highlighted truncate">
                  {{ app.name }}
                </p>
                <p class="text-xs text-muted font-mono truncate">
                  {{ app.image }}
                </p>
              </div>
              <UBadge
                :color="getStatusColor(app.status)"
                :label="app.status"
                variant="subtle"
                size="sm"
              />
            </NuxtLink>
          </template>
          <div
            v-else
            class="p-8 text-center"
          >
            <UIcon
              name="i-lucide-box"
              class="size-8 text-muted mx-auto mb-2"
            />
            <p class="text-sm text-muted">
              No apps deployed
            </p>
            <UButton
              to="/dashboard/apps"
              variant="link"
              size="sm"
              label="Deploy your first app"
              class="mt-2"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Quick Start Guide (only show when empty) -->
    <div
      v-if="!loading && serverCount === 0"
      class="rounded-lg border border-default bg-elevated p-6"
    >
      <h2 class="font-semibold text-highlighted mb-4">
        Getting Started
      </h2>
      <div class="grid gap-4 sm:grid-cols-3">
        <div class="flex items-start gap-4 rounded-lg bg-muted p-4">
          <div class="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-inverted text-sm font-medium">
            1
          </div>
          <div>
            <p class="font-medium text-highlighted">
              Add a server
            </p>
            <p class="text-sm text-muted mt-1">
              Connect your VPS via SSH to start deploying.
            </p>
            <UButton
              to="/dashboard/servers"
              variant="link"
              size="sm"
              label="Add Server →"
              class="mt-2 -ml-2"
            />
          </div>
        </div>

        <div class="flex items-start gap-4 rounded-lg bg-muted p-4">
          <div class="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-inverted text-sm font-medium">
            2
          </div>
          <div>
            <p class="font-medium text-highlighted">
              Deploy an app
            </p>
            <p class="text-sm text-muted mt-1">
              Pull a Docker image and run it on your servers.
            </p>
            <UButton
              to="/dashboard/apps"
              variant="link"
              size="sm"
              label="Deploy App →"
              class="mt-2 -ml-2"
            />
          </div>
        </div>

        <div class="flex items-start gap-4 rounded-lg bg-muted p-4">
          <div class="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-inverted text-sm font-medium">
            3
          </div>
          <div>
            <p class="font-medium text-highlighted">
              Provision a database
            </p>
            <p class="text-sm text-muted mt-1">
              Create MongoDB, Redis, or PostgreSQL clusters.
            </p>
            <UButton
              to="/dashboard/databases"
              variant="link"
              size="sm"
              label="Create Database →"
              class="mt-2 -ml-2"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
