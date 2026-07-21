<script setup lang="ts">
/**
 * Pipelines list page — manage deployment pipelines (dev → staging → prod)
 */
definePageMeta({
  layout: 'dashboard',
  middleware: 'auth',
  secured: true
})

const toast = useToast()
const { getAll, add, deleteById } = usePipeline()
const { getAll: getApps } = useApp()

// Search and pagination
const search = ref('')
const page = ref(1)

// Apps dropdown
const { data: appsData } = useLazyAsyncData(
  'apps-dropdown-pipelines',
  () => getApps({ page: 1 }).catch(() => ({ items: [] as TApp[], pages: 0 })),
  { server: false }
)
const appOptions = computed(() => {
  const apps = appsData.value?.items ?? []
  return apps.map(a => ({ value: a._id, label: a.name }))
})

// Table columns
const columns = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'status', header: 'Status' },
  { accessorKey: 'stages', header: 'Stages' },
  { id: 'actions', header: '' }
]

// Data fetching
const { data, status, refresh } = await useLazyAsyncData(
  'pipelines',
  () => getAll({ page: page.value, search: search.value }),
  { immediate: true, watch: [page], server: false }
)

const loading = computed(() => status.value === 'pending')
const items = computed(() => data.value?.items ?? [])

// Filtered items
const filteredItems = computed(() => {
  if (!search.value) return items.value
  const s = search.value.toLowerCase()
  return items.value.filter(
    (item: TPipeline) =>
      item.name.toLowerCase().includes(s)
      || item.appName?.toLowerCase().includes(s)
  )
})

// Add dialog
const dialogAdd = ref(false)
const loadingForm = ref(false)
const message = ref('')

const form = reactive<TPipelineForm>({
  name: '',
  description: '',
  appId: '',
  stages: [
    { name: 'dev' },
    { name: 'staging' },
    { name: 'prod' }
  ]
})

function openAdd() {
  Object.assign(form, {
    name: '',
    description: '',
    appId: '',
    stages: [
      { name: 'dev' },
      { name: 'staging' },
      { name: 'prod' }
    ]
  })
  message.value = ''
  dialogAdd.value = true
}

async function submitAdd() {
  if (!form.name || !form.appId) {
    message.value = 'Name and app are required.'
    return
  }

  loadingForm.value = true
  message.value = ''
  try {
    const result = await add(form)
    toast.add({
      title: 'Pipeline created',
      description: `${form.name} has been created successfully.`,
      color: 'success',
      icon: 'i-lucide-check-circle'
    })
    dialogAdd.value = false
    await navigateTo(`/pipelines/${result.pipelineId}`)
  } catch (error: unknown) {
    const err = error as { data?: { message?: string } }
    message.value = err?.data?.message ?? 'Failed to create pipeline.'
  } finally {
    loadingForm.value = false
  }
}

// Delete dialog
const deleteTarget = ref<TPipeline | null>(null)
const dialogDelete = ref(false)
const deleting = ref(false)

function openDelete(pipeline: TPipeline) {
  deleteTarget.value = pipeline
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
      title: err?.data?.message || 'Failed to delete pipeline',
      color: 'error'
    })
  } finally {
    deleting.value = false
  }
}

function handleRowClick(_e: Event, row: { original: TPipeline }) {
  navigateTo(`/pipelines/${row.original._id}`)
}

// Status helpers
const statusColor: Record<string, 'success' | 'error' | 'warning' | 'neutral'> = {
  idle: 'neutral',
  deploying: 'warning',
  failed: 'error'
}

function getStagesSummary(stages: TPipelineStageConfig[]): string {
  return stages.map(s => s.name).join(' → ')
}

function getDeployedCount(stages: TPipelineStageConfig[]): number {
  return stages.filter(s => s.status === 'deployed').length
}

// Watch search and reset page
watch(search, () => {
  page.value = 1
  refresh()
})

useHead({ title: 'Pipelines · Control Plane' })
</script>

<template>
  <div>
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold text-highlighted">
            Pipelines
          </h1>
          <p class="text-muted">
            Manage deployment pipelines across environments.
          </p>
        </div>
        <UButton
          icon="i-lucide-plus"
          label="Create Pipeline"
          @click="openAdd"
        />
      </div>

      <div class="flex items-center gap-3">
        <UInput
          v-model="search"
          icon="i-lucide-search"
          placeholder="Search pipelines..."
          class="w-64"
        />
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="ghost"
          :loading="loading"
          @click="() => refresh()"
        />
      </div>

      <div class="rounded-lg border border-default bg-elevated">
        <UTable
          :data="filteredItems"
          :columns="columns"
          :loading="loading"
          @select="handleRowClick"
        >
          <template #name-cell="{ row }">
            <div class="flex items-center gap-2">
              <UIcon
                name="i-lucide-git-branch"
                class="size-4 text-muted"
              />
              <div>
                <span class="font-medium">{{ row.original.name }}</span>
                <p
                  v-if="row.original.appName"
                  class="text-xs text-muted"
                >
                  {{ row.original.appName }}
                </p>
              </div>
            </div>
          </template>

          <template #status-cell="{ row }">
            <div class="flex items-center gap-2">
              <UBadge
                :color="statusColor[row.original.status] || 'neutral'"
                :label="row.original.status"
                variant="subtle"
              />
              <UIcon
                v-if="row.original.status === 'deploying'"
                name="i-lucide-loader-2"
                class="size-4 animate-spin text-warning"
              />
            </div>
          </template>

          <template #stages-cell="{ row }">
            <div class="flex items-center gap-2">
              <span class="text-sm font-mono text-muted">
                {{ getStagesSummary(row.original.stages) }}
              </span>
              <UBadge
                :label="`${getDeployedCount(row.original.stages)}/${row.original.stages.length}`"
                color="neutral"
                variant="subtle"
                size="xs"
              />
            </div>
          </template>

          <template #actions-cell="{ row }">
            <UDropdownMenu
              :items="[
                [
                  { label: 'View Details', icon: 'i-lucide-eye', onSelect: () => navigateTo(`/pipelines/${row.original._id}`) }
                ],
                [{ label: 'Delete', icon: 'i-lucide-trash', color: 'error' as const, onSelect: () => openDelete(row.original) }]
              ]"
            >
              <UButton
                icon="i-lucide-ellipsis"
                color="neutral"
                variant="ghost"
                @click.stop
              />
            </UDropdownMenu>
          </template>

          <template #empty>
            <div class="flex flex-col items-center justify-center py-12 text-center">
              <UIcon
                name="i-lucide-git-branch"
                class="size-12 text-muted mb-4"
              />
              <p class="text-lg font-medium text-highlighted">
                No pipelines
              </p>
              <p class="text-sm text-muted mt-1">
                Create your first pipeline to automate deployments.
              </p>
              <UButton
                class="mt-4"
                icon="i-lucide-plus"
                label="Create Pipeline"
                @click="openAdd"
              />
            </div>
          </template>
        </UTable>
      </div>
    </div>

    <!-- Create Pipeline Modal -->
    <UModal
      v-model:open="dialogAdd"
      class="max-w-lg"
    >
      <template #header>
        <h3 class="text-lg font-semibold">
          Create Pipeline
        </h3>
      </template>

      <template #body>
        <div class="p-6 space-y-4">
          <UAlert
            v-if="message"
            color="error"
            variant="soft"
            icon="i-lucide-alert-triangle"
            :title="message"
          />

          <UFormField label="Pipeline name">
            <UInput
              v-model="form.name"
              placeholder="my-app-pipeline"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Description">
            <UInput
              v-model="form.description"
              placeholder="Optional description..."
              class="w-full"
            />
          </UFormField>

          <UFormField label="Application">
            <USelect
              v-model="form.appId"
              :items="appOptions"
              placeholder="Select application..."
              class="w-full"
            />
            <template #hint>
              <span
                v-if="!appOptions.length"
                class="text-xs text-muted"
              >
                No applications available.
                <NuxtLink
                  to="/apps"
                  class="text-primary underline"
                >Create an app</NuxtLink> first.
              </span>
            </template>
          </UFormField>

          <div>
            <label class="text-sm font-medium text-highlighted">Stages</label>
            <p class="text-xs text-muted mt-1 mb-3">
              Your pipeline will deploy through these stages in order.
            </p>
            <div class="flex items-center gap-2">
              <div
                v-for="(stage, index) in form.stages"
                :key="stage.name"
                class="flex items-center gap-2"
              >
                <UBadge
                  :label="stage.name"
                  color="primary"
                  variant="soft"
                />
                <UIcon
                  v-if="index < form.stages.length - 1"
                  name="i-lucide-arrow-right"
                  class="size-4 text-muted"
                />
              </div>
            </div>
          </div>
        </div>
      </template>

      <template #footer>
        <UButton
          color="neutral"
          variant="ghost"
          @click="dialogAdd = false"
        >
          Cancel
        </UButton>
        <UButton
          :loading="loadingForm"
          :disabled="!form.name || !form.appId"
          icon="i-lucide-plus"
          @click="submitAdd"
        >
          Create Pipeline
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
                <span class="font-medium text-highlighted">{{ deleteTarget?.name }}</span>?
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
          :loading="deleting"
          icon="i-lucide-trash"
          @click="submitDelete"
        >
          Delete Pipeline
        </UButton>
      </template>
    </UModal>
  </div>
</template>
