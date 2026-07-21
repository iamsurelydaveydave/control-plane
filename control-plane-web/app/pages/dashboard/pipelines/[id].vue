<script setup lang="ts">
/**
 * Pipeline detail page — manage deployment stages and promotions
 */
definePageMeta({
  layout: 'dashboard',
  middleware: 'auth',
  secured: true
})

const route = useRoute()
const router = useRouter()
const toast = useToast()
const pipelineId = route.params.id as string

const { getById, deployToStage, promoteStage, getPromotionHistory, deleteById } = usePipeline()

// Data fetching
const { data: pipelineData, status, refresh } = await useLazyAsyncData(
  `pipeline-${pipelineId}`,
  () => getById(pipelineId),
  { immediate: true, server: false }
)

const pipeline = computed(() => pipelineData.value?.pipeline)
const loading = computed(() => status.value === 'pending')

// Promotion history
const { data: historyData, refresh: refreshHistory } = await useLazyAsyncData(
  `pipeline-${pipelineId}-history`,
  () => getPromotionHistory(pipelineId),
  { immediate: true, server: false }
)
const promotionHistory = computed(() => historyData.value?.items ?? [])

// Deploy dialog
const dialogDeploy = ref(false)
const deployStage = ref<TPipelineStage>('dev')
const deployVersion = ref('')
const deploying = ref(false)

function openDeploy(stage: TPipelineStage) {
  deployStage.value = stage
  deployVersion.value = ''
  dialogDeploy.value = true
}

async function submitDeploy() {
  if (deploying.value) return
  deploying.value = true
  try {
    await deployToStage(pipelineId, deployStage.value, { version: deployVersion.value || undefined })
    toast.add({
      title: 'Deployment started',
      description: `Deploying to ${deployStage.value}...`,
      color: 'info',
      icon: 'i-lucide-rocket'
    })
    dialogDeploy.value = false
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

// Promote dialog
const dialogPromote = ref(false)
const promoteFrom = ref<TPipelineStage>('dev')
const promoteTo = ref<TPipelineStage>('staging')
const promoting = ref(false)

function openPromote(from: TPipelineStage, to: TPipelineStage) {
  promoteFrom.value = from
  promoteTo.value = to
  dialogPromote.value = true
}

async function submitPromote() {
  if (promoting.value) return
  promoting.value = true
  try {
    await promoteStage(pipelineId, promoteFrom.value, promoteTo.value)
    toast.add({
      title: 'Promotion started',
      description: `Promoting from ${promoteFrom.value} to ${promoteTo.value}...`,
      color: 'info',
      icon: 'i-lucide-arrow-right'
    })
    dialogPromote.value = false
    await refresh()
    await refreshHistory()
  } catch (error: unknown) {
    const err = error as { data?: { message?: string } }
    toast.add({
      title: 'Promotion failed',
      description: err?.data?.message ?? 'Failed to promote.',
      color: 'error'
    })
  } finally {
    promoting.value = false
  }
}

// Delete dialog
const dialogDelete = ref(false)
const deleteLoading = ref(false)

async function submitDelete() {
  if (deleteLoading.value) return
  deleteLoading.value = true
  try {
    await deleteById(pipelineId)
    toast.add({
      title: 'Pipeline deleted',
      color: 'success',
      icon: 'i-lucide-check-circle'
    })
    await router.push('/dashboard/pipelines')
  } catch (error: unknown) {
    const err = error as { data?: { message?: string } }
    toast.add({
      title: err?.data?.message || 'Failed to delete pipeline',
      color: 'error'
    })
  } finally {
    deleteLoading.value = false
  }
}

// Helpers
const statusColor: Record<string, 'success' | 'error' | 'warning' | 'neutral'> = {
  idle: 'neutral',
  deploying: 'warning',
  failed: 'error',
  pending: 'neutral',
  deployed: 'success'
}

const stageOrder: TPipelineStage[] = ['dev', 'staging', 'prod']

function getNextStage(current: TPipelineStage): TPipelineStage | null {
  const idx = stageOrder.indexOf(current)
  if (idx < stageOrder.length - 1) {
    return stageOrder[idx + 1] ?? null
  }
  return null
}

function formatDate(value?: string) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

useHead({
  title: computed(() => pipeline.value ? `${pipeline.value.name} · Pipelines · Control Plane` : 'Pipeline · Control Plane')
})
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
          to="/dashboard/pipelines"
        />
        <div v-if="pipeline">
          <div class="flex items-center gap-2">
            <h1 class="text-2xl font-bold text-highlighted">
              {{ pipeline.name }}
            </h1>
            <UBadge
              :color="statusColor[pipeline.status] || 'neutral'"
              :label="pipeline.status"
              variant="subtle"
            />
          </div>
          <p
            v-if="pipeline.description"
            class="text-sm text-muted mt-0.5"
          >
            {{ pipeline.description }}
          </p>
          <p
            v-if="pipeline.appName"
            class="text-sm text-muted mt-0.5"
          >
            Application: {{ pipeline.appName }}
          </p>
        </div>
        <USkeleton
          v-else
          class="h-10 w-48"
        />
      </div>

      <div
        v-if="pipeline"
        class="flex items-center gap-2"
      >
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="ghost"
          :loading="loading"
          @click="() => refresh()"
        />
        <UDropdownMenu
          :items="[
            [{ label: 'Delete Pipeline', icon: 'i-lucide-trash', color: 'error' as const, onSelect: () => dialogDelete = true }]
          ]"
        >
          <UButton
            icon="i-lucide-ellipsis"
            color="neutral"
            variant="ghost"
          />
        </UDropdownMenu>
      </div>
    </div>

    <!-- Loading -->
    <div
      v-if="loading && !pipeline"
      class="space-y-4"
    >
      <USkeleton class="h-32 rounded-xl" />
      <USkeleton class="h-48 rounded-xl" />
    </div>

    <!-- Content -->
    <div
      v-else-if="pipeline"
      class="space-y-6"
    >
      <!-- Stages -->
      <div class="rounded-xl border border-default bg-elevated/50 p-6">
        <h2 class="text-lg font-semibold text-highlighted mb-4">
          Deployment Stages
        </h2>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div
            v-for="(stage, index) in pipeline.stages"
            :key="stage.name"
            class="relative rounded-lg border border-default bg-elevated p-4"
          >
            <!-- Stage arrow -->
            <div
              v-if="index < pipeline.stages.length - 1"
              class="hidden md:flex absolute -right-6 top-1/2 -translate-y-1/2 z-10"
            >
              <UIcon
                name="i-lucide-arrow-right"
                class="size-5 text-muted"
              />
            </div>

            <div class="flex items-center justify-between mb-3">
              <div class="flex items-center gap-2">
                <span class="font-medium text-highlighted capitalize">{{ stage.name }}</span>
                <UBadge
                  :color="statusColor[stage.status] || 'neutral'"
                  :label="stage.status"
                  variant="subtle"
                  size="xs"
                />
              </div>
            </div>

            <div
              v-if="stage.version"
              class="mb-3"
            >
              <p class="text-xs text-muted">
                Version
              </p>
              <code class="text-sm font-mono">{{ stage.version }}</code>
            </div>

            <div
              v-if="stage.deployedAt"
              class="mb-4"
            >
              <p class="text-xs text-muted">
                Deployed
              </p>
              <p class="text-sm">
                {{ formatDate(stage.deployedAt) }}
              </p>
            </div>

            <div class="flex flex-col gap-2">
              <UButton
                icon="i-lucide-rocket"
                size="sm"
                variant="soft"
                class="w-full"
                @click="openDeploy(stage.name)"
              >
                Deploy to {{ stage.name }}
              </UButton>

              <UButton
                v-if="stage.status === 'deployed' && getNextStage(stage.name)"
                icon="i-lucide-arrow-right"
                size="sm"
                variant="outline"
                color="neutral"
                class="w-full"
                @click="openPromote(stage.name, getNextStage(stage.name)!)"
              >
                Promote to {{ getNextStage(stage.name) }}
              </UButton>
            </div>
          </div>
        </div>
      </div>

      <!-- Promotion History -->
      <div class="rounded-xl border border-default bg-elevated/50 p-6">
        <h2 class="text-lg font-semibold text-highlighted mb-4">
          Promotion History
        </h2>

        <div
          v-if="!promotionHistory.length"
          class="text-center py-8"
        >
          <UIcon
            name="i-lucide-history"
            class="size-10 text-muted mb-2"
          />
          <p class="text-muted">
            No promotions yet.
          </p>
        </div>

        <div
          v-else
          class="space-y-3"
        >
          <div
            v-for="entry in promotionHistory"
            :key="entry._id"
            class="flex items-center justify-between rounded-lg border border-default bg-elevated px-4 py-3"
          >
            <div class="flex items-center gap-3">
              <div class="flex items-center gap-2">
                <UBadge
                  :label="entry.fromStage"
                  color="neutral"
                  variant="soft"
                  size="xs"
                />
                <UIcon
                  name="i-lucide-arrow-right"
                  class="size-4 text-muted"
                />
                <UBadge
                  :label="entry.toStage"
                  color="primary"
                  variant="soft"
                  size="xs"
                />
              </div>
              <code class="text-xs text-muted">{{ entry.version }}</code>
            </div>

            <div class="flex items-center gap-3">
              <span class="text-xs text-muted">{{ formatDate(entry.promotedAt) }}</span>
              <UBadge
                :color="entry.status === 'success' ? 'success' : 'error'"
                :label="entry.status"
                variant="subtle"
                size="xs"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Not found -->
    <div
      v-else
      class="text-center py-12"
    >
      <UIcon
        name="i-lucide-alert-circle"
        class="size-12 text-muted mb-4"
      />
      <h2 class="text-lg font-semibold text-highlighted">
        Pipeline not found
      </h2>
      <p class="text-muted mt-1">
        The pipeline you're looking for doesn't exist.
      </p>
      <UButton
        class="mt-4"
        to="/dashboard/pipelines"
        icon="i-lucide-arrow-left"
      >
        Back to Pipelines
      </UButton>
    </div>

    <!-- Deploy Modal -->
    <UModal
      v-model:open="dialogDeploy"
      class="max-w-sm"
    >
      <template #header>
        <h3 class="text-lg font-semibold">
          Deploy to {{ deployStage }}
        </h3>
      </template>

      <template #body>
        <div class="p-6 space-y-4">
          <p class="text-muted">
            Deploy the application to the
            <span class="font-medium text-highlighted">{{ deployStage }}</span>
            environment.
          </p>

          <UFormField label="Version (optional)">
            <UInput
              v-model="deployVersion"
              placeholder="latest"
              class="w-full"
            />
            <template #hint>
              <span class="text-xs text-muted">
                Leave empty to deploy the latest version.
              </span>
            </template>
          </UFormField>
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
          icon="i-lucide-rocket"
          @click="submitDeploy"
        >
          Deploy
        </UButton>
      </template>
    </UModal>

    <!-- Promote Modal -->
    <UModal
      v-model:open="dialogPromote"
      class="max-w-sm"
    >
      <template #header>
        <h3 class="text-lg font-semibold">
          Promote to {{ promoteTo }}
        </h3>
      </template>

      <template #body>
        <div class="p-6">
          <div class="flex items-start gap-4">
            <div class="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <UIcon
                name="i-lucide-arrow-right"
                class="size-5 text-primary"
              />
            </div>
            <div>
              <p class="text-muted">
                Promote the current version from
                <span class="font-medium text-highlighted">{{ promoteFrom }}</span>
                to
                <span class="font-medium text-highlighted">{{ promoteTo }}</span>?
              </p>
              <p class="text-sm text-muted mt-2">
                This will deploy the same version that is currently running in {{ promoteFrom }}.
              </p>
            </div>
          </div>
        </div>
      </template>

      <template #footer>
        <UButton
          color="neutral"
          variant="ghost"
          @click="dialogPromote = false"
        >
          Cancel
        </UButton>
        <UButton
          :loading="promoting"
          icon="i-lucide-arrow-right"
          @click="submitPromote"
        >
          Promote
        </UButton>
      </template>
    </UModal>

    <!-- Delete Modal -->
    <UModal
      v-model:open="dialogDelete"
      class="max-w-sm"
    >
      <template #header>
        <h3 class="text-lg font-semibold">
          Delete Pipeline
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
                <span class="font-medium text-highlighted">{{ pipeline?.name }}</span>?
                This will not affect deployed applications.
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
          :loading="deleteLoading"
          icon="i-lucide-trash"
          @click="submitDelete"
        >
          Delete Pipeline
        </UButton>
      </template>
    </UModal>
  </div>
</template>
