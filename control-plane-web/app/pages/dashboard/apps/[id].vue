<script setup lang="ts">
/**
 * App detail page — view app info, manage deployments, view logs.
 */
definePageMeta({
  layout: 'dashboard',
  middleware: 'auth',
  secured: true
})

const route = useRoute()
const router = useRouter()
const toast = useToast()
const appId = route.params.id as string

const {
  getById,
  deploy,
  redeploy,
  rollback,
  stop,
  start,
  restart,
  getLogs,
  getVersion,
  deleteById
} = useApp()
const { getAll: getServers } = useServer()

// Fetch app
const { data: appData, status, refresh } = await useLazyAsyncData(
  `app-${appId}`,
  () => getById(appId),
  { immediate: true, server: false }
)
const app = computed(() => appData.value?.app)
const loading = computed(() => status.value === 'pending')

// Fetch servers for display
const { data: serversData } = await useLazyAsyncData(
  'servers-for-app',
  () => getServers({ page: 1 }).catch(() => ({ items: [] as TServer[], pages: 0 })),
  { server: false }
)

function getServerName(serverId: string) {
  const server = (serversData.value?.items ?? []).find(s => s._id === serverId)
  return server?.name ?? serverId
}

function getServerHost(serverId: string) {
  const server = (serversData.value?.items ?? []).find(s => s._id === serverId)
  return server?.host ?? ''
}

// Logs
const logs = ref('')
const logsLoading = ref(false)

async function fetchLogs() {
  logsLoading.value = true
  try {
    const result = await getLogs(appId, 100)
    logs.value = result.logs
  } catch {
    logs.value = 'Failed to fetch logs.'
  } finally {
    logsLoading.value = false
  }
}

// Environment variables display
const showEnvValues = ref(false)

function maskValue(value: string) {
  if (value.length <= 4) return '••••••'
  return value.slice(0, 2) + '••••' + value.slice(-2)
}

// Deploy dialog
const deployOpen = ref(false)
const deploying = ref(false)

async function handleDeploy() {
  deploying.value = true
  try {
    await deploy(appId)
    toast.add({
      title: 'Deployment started',
      description: `Deploying ${app.value?.name}...`,
      color: 'info',
      icon: 'i-lucide-rocket'
    })
    deployOpen.value = false
    await refresh()
  } catch (error: unknown) {
    const err = error as { data?: { message?: string } }
    toast.add({
      title: 'Deployment failed',
      description: err?.data?.message ?? 'Failed to start deployment.',
      color: 'error'
    })
  } finally {
    deploying.value = false
  }
}

// Rollback dialog
const rollbackOpen = ref(false)
const rollbackVersion = ref('')
const rollingBack = ref(false)

function openRollback() {
  rollbackVersion.value = ''
  rollbackOpen.value = true
}

async function handleRollback() {
  rollingBack.value = true
  try {
    await rollback(appId, rollbackVersion.value || undefined)
    toast.add({
      title: 'Rollback started',
      description: rollbackVersion.value
        ? `Rolling back to version ${rollbackVersion.value}...`
        : 'Rolling back to previous version...',
      color: 'info',
      icon: 'i-lucide-undo-2'
    })
    rollbackOpen.value = false
    await refresh()
  } catch (error: unknown) {
    const err = error as { data?: { message?: string } }
    toast.add({
      title: 'Rollback failed',
      description: err?.data?.message ?? 'Failed to rollback.',
      color: 'error'
    })
  } finally {
    rollingBack.value = false
  }
}

// Stop/Start/Restart
async function handleStop() {
  try {
    await stop(appId)
    toast.add({
      title: `${app.value?.name} stopped`,
      color: 'success',
      icon: 'i-lucide-check-circle'
    })
    await refresh()
  } catch (error: unknown) {
    const err = error as { data?: { message?: string } }
    toast.add({
      title: err?.data?.message || 'Failed to stop app',
      color: 'error'
    })
  }
}

async function handleStart() {
  try {
    await start(appId)
    toast.add({
      title: `${app.value?.name} started`,
      color: 'success',
      icon: 'i-lucide-check-circle'
    })
    await refresh()
  } catch (error: unknown) {
    const err = error as { data?: { message?: string } }
    toast.add({
      title: err?.data?.message || 'Failed to start app',
      color: 'error'
    })
  }
}

async function handleRestart() {
  try {
    await restart(appId)
    toast.add({
      title: `${app.value?.name} restarting`,
      color: 'info',
      icon: 'i-lucide-refresh-cw'
    })
    await refresh()
  } catch (error: unknown) {
    const err = error as { data?: { message?: string } }
    toast.add({
      title: err?.data?.message || 'Failed to restart app',
      color: 'error'
    })
  }
}

// Delete dialog
const deleteOpen = ref(false)
const deleteLoading = ref(false)

async function submitDelete() {
  deleteLoading.value = true
  try {
    await deleteById(appId)
    toast.add({
      title: 'App deleted',
      color: 'success',
      icon: 'i-lucide-check-circle'
    })
    router.push('/dashboard/apps')
  } catch (error: unknown) {
    const err = error as { data?: { message?: string } }
    toast.add({
      title: err?.data?.message || 'Failed to delete app',
      color: 'error'
    })
  } finally {
    deleteLoading.value = false
  }
}

// Status helpers
const statusColor: Record<string, 'success' | 'error' | 'warning' | 'neutral'> = {
  pending: 'neutral',
  deploying: 'warning',
  running: 'success',
  stopped: 'neutral',
  failed: 'error'
}

function formatDate(date?: string) {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// Fetch logs on mount if app is running
watch(app, (val) => {
  if (val && (val.status === 'running' || val.status === 'deploying')) {
    fetchLogs()
  }
}, { immediate: true })

useHead({ title: computed(() => app.value ? `${app.value.name} · Control Plane` : 'App · Control Plane') })
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <UButton
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          size="sm"
          @click="router.push('/dashboard/apps')"
        />
        <div v-if="app">
          <div class="flex items-center gap-2">
            <h1 class="text-2xl font-bold text-highlighted">
              {{ app.name }}
            </h1>
            <UBadge
              :color="statusColor[app.status] || 'neutral'"
              variant="subtle"
            >
              <template v-if="app.status === 'deploying'">
                <UIcon
                  name="i-lucide-loader-2"
                  class="size-3 animate-spin mr-1"
                />
              </template>
              {{ app.status }}
            </UBadge>
          </div>
          <p class="text-sm text-muted mt-0.5">
            <a
              v-if="app.proxy?.host"
              :href="`${app.proxy.ssl ? 'https' : 'http'}://${app.proxy.host}`"
              target="_blank"
              class="text-primary hover:underline"
            >
              {{ app.proxy.host }}
              <UIcon
                name="i-lucide-external-link"
                class="inline-block size-3"
              />
            </a>
            <span v-else>No domain configured</span>
          </p>
        </div>
        <USkeleton
          v-else
          class="h-12 w-48"
        />
      </div>

      <!-- Quick actions -->
      <div
        v-if="app"
        class="flex items-center gap-2"
      >
        <UButton
          icon="i-lucide-rocket"
          color="primary"
          variant="soft"
          size="sm"
          @click="deployOpen = true"
        >
          Deploy
        </UButton>
        <UButton
          v-if="app.status === 'running'"
          icon="i-lucide-square"
          color="neutral"
          variant="soft"
          size="sm"
          @click="handleStop"
        >
          Stop
        </UButton>
        <UButton
          v-if="app.status === 'stopped'"
          icon="i-lucide-play"
          color="success"
          variant="soft"
          size="sm"
          @click="handleStart"
        >
          Start
        </UButton>
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="soft"
          size="sm"
          :disabled="app.status !== 'running'"
          @click="handleRestart"
        >
          Restart
        </UButton>
        <UDropdownMenu
          :items="[
            [
              { label: 'Rollback', icon: 'i-lucide-undo-2', onSelect: openRollback },
              { label: 'Redeploy', icon: 'i-lucide-repeat', onSelect: async () => { await redeploy(appId); toast.add({ title: 'Redeployment started', color: 'info', icon: 'i-lucide-repeat' }); await refresh() } }
            ],
            [{ label: 'Delete', icon: 'i-lucide-trash', color: 'error' as const, onSelect: () => { deleteOpen = true } }]
          ]"
        >
          <UButton
            icon="i-lucide-ellipsis"
            color="neutral"
            variant="ghost"
            size="sm"
          />
        </UDropdownMenu>
      </div>
    </div>

    <!-- Loading state -->
    <div
      v-if="loading"
      class="space-y-4"
    >
      <USkeleton class="h-32 rounded-xl" />
      <USkeleton class="h-48 rounded-xl" />
      <USkeleton class="h-64 rounded-xl" />
    </div>

    <!-- App content -->
    <div
      v-else-if="app"
      class="space-y-6"
    >
      <!-- Deployment Info -->
      <div class="rounded-xl border border-default bg-elevated/50 p-6">
        <h2 class="text-lg font-semibold text-highlighted mb-4">
          Deployment Info
        </h2>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label class="text-xs text-muted uppercase tracking-wide">Current Version</label>
            <p class="font-mono text-sm mt-1">
              {{ app.currentVersion || '—' }}
            </p>
          </div>
          <div>
            <label class="text-xs text-muted uppercase tracking-wide">Current Image</label>
            <p class="font-mono text-sm mt-1 truncate">
              {{ app.currentImage || '—' }}
            </p>
          </div>
          <div>
            <label class="text-xs text-muted uppercase tracking-wide">Last Deployed</label>
            <p class="text-sm mt-1">
              {{ formatDate(app.deployedAt) }}
            </p>
          </div>
          <div>
            <label class="text-xs text-muted uppercase tracking-wide">Source</label>
            <p class="text-sm mt-1 capitalize">
              {{ app.source.type }}
              <span
                v-if="app.source.type === 'image'"
                class="text-muted"
              > · {{ app.source.image }}</span>
              <span
                v-else
                class="text-muted"
              > · {{ app.source.gitUrl }}</span>
            </p>
          </div>
          <div v-if="app.proxy">
            <label class="text-xs text-muted uppercase tracking-wide">Port</label>
            <p class="font-mono text-sm mt-1">
              {{ app.proxy.appPort }}
            </p>
          </div>
          <div>
            <label class="text-xs text-muted uppercase tracking-wide">Created</label>
            <p class="text-sm mt-1">
              {{ formatDate(app.createdAt) }}
            </p>
          </div>
        </div>
      </div>

      <!-- Servers -->
      <div class="rounded-xl border border-default bg-elevated/50 p-6">
        <h2 class="text-lg font-semibold text-highlighted mb-4">
          Servers
        </h2>
        <div
          v-if="!app.serverIds.length"
          class="text-center py-8"
        >
          <UIcon
            name="i-lucide-server"
            class="size-8 text-muted mx-auto mb-2"
          />
          <p class="text-muted">
            No servers assigned.
          </p>
        </div>
        <div
          v-else
          class="space-y-2"
        >
          <div
            v-for="serverId in app.serverIds"
            :key="serverId"
            class="flex items-center gap-3 rounded-lg border border-default bg-elevated px-4 py-3"
          >
            <div class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-elevated border border-default">
              <UIcon
                name="i-lucide-server"
                class="size-4 text-muted"
              />
            </div>
            <div>
              <span class="font-medium text-highlighted">
                {{ getServerName(serverId) }}
              </span>
              <p class="text-xs text-muted font-mono">
                {{ getServerHost(serverId) }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Environment Variables -->
      <div class="rounded-xl border border-default bg-elevated/50 p-6">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-semibold text-highlighted">
            Environment Variables
          </h2>
          <UButton
            :icon="showEnvValues ? 'i-lucide-eye-off' : 'i-lucide-eye'"
            color="neutral"
            variant="ghost"
            size="xs"
            @click="showEnvValues = !showEnvValues"
          >
            {{ showEnvValues ? 'Hide' : 'Show' }} values
          </UButton>
        </div>
        <div v-if="!Object.keys(app.env || {}).length && !app.secretNames?.length">
          <p class="text-sm text-muted text-center py-4">
            No environment variables configured.
          </p>
        </div>
        <div
          v-else
          class="space-y-1"
        >
          <div
            v-for="(value, key) in app.env"
            :key="key"
            class="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-elevated transition-colors font-mono text-sm"
          >
            <span class="text-highlighted">{{ key }}</span>
            <span class="text-muted">
              {{ showEnvValues ? value : maskValue(value) }}
            </span>
          </div>
          <div
            v-for="secret in app.secretNames"
            :key="secret"
            class="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-elevated transition-colors font-mono text-sm"
          >
            <span class="text-highlighted">
              <UIcon
                name="i-lucide-lock"
                class="inline-block size-3 mr-1"
              />
              {{ secret }}
            </span>
            <span class="text-muted">••••••••</span>
          </div>
        </div>
      </div>

      <!-- Logs -->
      <div class="rounded-xl border border-default bg-elevated/50 p-6">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-semibold text-highlighted">
            Logs
          </h2>
          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="ghost"
            size="xs"
            :loading="logsLoading"
            @click="fetchLogs"
          >
            Refresh
          </UButton>
        </div>
        <div
          v-if="logsLoading && !logs"
          class="flex items-center justify-center py-8"
        >
          <UIcon
            name="i-lucide-loader-2"
            class="size-6 animate-spin text-muted"
          />
        </div>
        <div
          v-else-if="logs"
          class="relative"
        >
          <pre class="bg-gray-950 text-gray-200 rounded-lg p-4 text-xs font-mono overflow-auto max-h-96 whitespace-pre-wrap">{{ logs }}</pre>
        </div>
        <div
          v-else
          class="text-center py-8"
        >
          <UIcon
            name="i-lucide-file-text"
            class="size-8 text-muted mx-auto mb-2"
          />
          <p class="text-muted text-sm">
            No logs available. Deploy or start the app to see logs.
          </p>
        </div>
      </div>
    </div>

    <!-- Not found state -->
    <div
      v-else
      class="text-center py-12"
    >
      <UIcon
        name="i-lucide-box"
        class="size-12 text-muted mx-auto mb-4"
      />
      <h2 class="text-lg font-semibold text-highlighted">
        App not found
      </h2>
      <p class="text-muted mt-1">
        The app you're looking for doesn't exist or was deleted.
      </p>
      <UButton
        class="mt-4"
        icon="i-lucide-arrow-left"
        variant="subtle"
        @click="router.push('/dashboard/apps')"
      >
        Back to Apps
      </UButton>
    </div>

    <!-- Deploy Confirmation Modal -->
    <UModal
      v-model:open="deployOpen"
      class="max-w-sm"
    >
      <template #header>
        <h3 class="text-lg font-semibold">
          Deploy App
        </h3>
      </template>

      <template #body>
        <div class="p-6">
          <div class="flex items-start gap-4">
            <div class="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <UIcon
                name="i-lucide-rocket"
                class="size-5 text-primary"
              />
            </div>
            <div>
              <p class="text-muted">
                Deploy
                <span class="font-medium text-highlighted">{{ app?.name }}</span>
                to {{ app?.serverIds.length }} server{{ (app?.serverIds.length ?? 0) > 1 ? 's' : '' }}?
              </p>
              <p class="text-sm text-muted mt-2">
                This will build and deploy the latest version of your application.
              </p>
            </div>
          </div>
        </div>
      </template>

      <template #footer>
        <UButton
          color="neutral"
          variant="ghost"
          @click="deployOpen = false"
        >
          Cancel
        </UButton>
        <UButton
          :loading="deploying"
          icon="i-lucide-rocket"
          @click="handleDeploy"
        >
          Deploy
        </UButton>
      </template>
    </UModal>

    <!-- Rollback Modal -->
    <UModal
      v-model:open="rollbackOpen"
      class="max-w-sm"
    >
      <template #header>
        <h3 class="text-lg font-semibold">
          Rollback App
        </h3>
      </template>

      <template #body>
        <div class="p-6 space-y-4">
          <div class="flex items-start gap-4">
            <div class="flex size-10 shrink-0 items-center justify-center rounded-full bg-warning/10">
              <UIcon
                name="i-lucide-undo-2"
                class="size-5 text-warning"
              />
            </div>
            <div>
              <p class="text-muted">
                Roll back
                <span class="font-medium text-highlighted">{{ app?.name }}</span>
                to a previous version.
              </p>
            </div>
          </div>
          <UFormField label="Version (optional)">
            <UInput
              v-model="rollbackVersion"
              placeholder="Leave empty for previous version"
              class="w-full"
            />
            <template #hint>
              <span class="text-xs text-muted">
                Enter a specific version tag, or leave empty to rollback to the previous deployment.
              </span>
            </template>
          </UFormField>
        </div>
      </template>

      <template #footer>
        <UButton
          color="neutral"
          variant="ghost"
          @click="rollbackOpen = false"
        >
          Cancel
        </UButton>
        <UButton
          color="warning"
          :loading="rollingBack"
          icon="i-lucide-undo-2"
          @click="handleRollback"
        >
          Rollback
        </UButton>
      </template>
    </UModal>

    <!-- Delete Confirmation Modal -->
    <UModal
      v-model:open="deleteOpen"
      class="max-w-sm"
    >
      <template #header>
        <h3 class="text-lg font-semibold">
          Delete App
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
                <span class="font-medium text-highlighted">{{ app?.name }}</span>?
                This will remove the deployment from all servers and cannot be undone.
              </p>
            </div>
          </div>
        </div>
      </template>

      <template #footer>
        <UButton
          color="neutral"
          variant="ghost"
          @click="deleteOpen = false"
        >
          Cancel
        </UButton>
        <UButton
          color="error"
          :loading="deleteLoading"
          icon="i-lucide-trash"
          @click="submitDelete"
        >
          Delete App
        </UButton>
      </template>
    </UModal>
  </div>
</template>
