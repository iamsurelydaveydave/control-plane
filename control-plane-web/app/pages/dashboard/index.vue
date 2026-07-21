<script setup lang="ts">
/**
 * Dashboard index page — infrastructure overview.
 */
definePageMeta({
  layout: 'dashboard',
  middleware: 'auth',
  secured: true
})

const { getAll: getApps } = useApp()
const { getAll: getResources } = useAddon()

// Fetch all stats in parallel
const { data: statsData, status } = await useLazyAsyncData(
  'dashboard-stats',
  async () => {
    const [apps, resources] = await Promise.all([
      getApps({ page: 1 }).catch(() => ({ items: [], pages: 0 })),
      getResources({ page: 1 }).catch(() => ({ items: [], pages: 0 }))
    ])
    return { apps, resources }
  },
  { immediate: true, server: false }
)

const loading = computed(() => status.value === 'pending')

// Compute stats
const appCount = computed(() => statsData.value?.apps?.items?.length ?? 0)
const resourceCount = computed(() => statsData.value?.resources?.items?.length ?? 0)
const runningApps = computed(() =>
  statsData.value?.apps?.items?.filter((a: TApp) => a.status === 'running')?.length ?? 0
)
const runningResources = computed(() =>
  statsData.value?.resources?.items?.filter((r: TAddon) => r.status === 'running')?.length ?? 0
)

// Recent items
const recentApps = computed(() => statsData.value?.apps?.items?.slice(0, 5) ?? [])

function getStatusColor(status: string) {
  switch (status) {
    case 'online':
    case 'running':
    case 'ready':
      return 'success'
    case 'offline':
    case 'failed':
    case 'not-ready':
      return 'error'
    case 'deploying':
    case 'provisioning':
    case 'pending':
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
          to="/dashboard/resources"
          variant="soft"
          color="neutral"
          icon="i-lucide-puzzle"
          label="Add Resource"
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
      <NuxtLink
        to="/dashboard/nodes"
        class="rounded-lg border border-default bg-elevated p-4 hover:border-primary/50 transition-colors"
      >
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm text-muted">
              Nodes
            </p>
            <p class="text-2xl font-semibold text-highlighted">
              <template v-if="loading">
                <span class="inline-block w-8 h-7 bg-muted rounded animate-pulse" />
              </template>
              <template v-else>
                —
              </template>
            </p>
          </div>
          <div class="flex size-12 items-center justify-center rounded-lg bg-primary/10">
            <UIcon
              name="i-lucide-hard-drive"
              class="size-6 text-primary"
            />
          </div>
        </div>
        <p class="mt-2 text-xs text-muted">
          K8s worker nodes
        </p>
      </NuxtLink>

      <NuxtLink
        to="/dashboard/apps"
        class="rounded-lg border border-default bg-elevated p-4 hover:border-primary/50 transition-colors"
      >
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
      </NuxtLink>

      <NuxtLink
        to="/dashboard/resources"
        class="rounded-lg border border-default bg-elevated p-4 hover:border-primary/50 transition-colors"
      >
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm text-muted">
              Resources
            </p>
            <p class="text-2xl font-semibold text-highlighted">
              <template v-if="loading">
                <span class="inline-block w-8 h-7 bg-muted rounded animate-pulse" />
              </template>
              <template v-else>
                {{ resourceCount }}
              </template>
            </p>
          </div>
          <div class="flex size-12 items-center justify-center rounded-lg bg-info/10">
            <UIcon
              name="i-lucide-puzzle"
              class="size-6 text-info"
            />
          </div>
        </div>
        <p class="mt-2 text-xs text-muted">
          <span class="text-success">{{ runningResources }}</span> running
        </p>
      </NuxtLink>

      <NuxtLink
        to="/dashboard/monitoring"
        class="rounded-lg border border-default bg-elevated p-4 hover:border-primary/50 transition-colors"
      >
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
      </NuxtLink>
    </div>

    <!-- Recent Apps -->
    <div class="rounded-lg border border-default bg-elevated">
      <div class="flex items-center justify-between border-b border-default p-4">
        <h2 class="font-semibold text-highlighted">
          Recent Apps
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
            :to="`/dashboard/apps/${app._id}`"
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
                {{ app.image || app.source?.image || app.source?.repository || 'No source' }}
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
            No apps deployed yet
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

    <!-- Quick Start Guide (only show when empty) -->
    <div
      v-if="!loading && appCount === 0"
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
              Add worker nodes
            </p>
            <p class="text-sm text-muted mt-1">
              Provision K8s worker nodes to run your workloads.
            </p>
            <UButton
              to="/dashboard/nodes"
              variant="link"
              size="sm"
              label="Add Node →"
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
              Deploy a resource
            </p>
            <p class="text-sm text-muted mt-1">
              Add databases, caches, or other services from the catalog.
            </p>
            <UButton
              to="/dashboard/resources"
              variant="link"
              size="sm"
              label="Browse Catalog →"
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
              Deploy an app
            </p>
            <p class="text-sm text-muted mt-1">
              Deploy containers to your Kubernetes cluster.
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
      </div>
    </div>
  </div>
</template>
