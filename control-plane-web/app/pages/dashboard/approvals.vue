<script setup lang="ts">
/**
 * Deployment Approvals Page
 *
 * Lists all pending deployment approvals and allows admins to approve/reject them.
 */
definePageMeta({
  layout: 'dashboard'
})

const { getPending, approve, reject } = useDeploymentApproval()
const { getById: getApp } = useApp()
const toast = useToast()

// Fetch pending approvals
const page = ref(1)
const environment = ref<TDeploymentEnvironment | undefined>(undefined)

const { data, status, refresh } = await useLazyAsyncData(
  'pending-approvals',
  () => getPending({ page: page.value, environment: environment.value }),
  { watch: [page, environment] }
)

const approvals = computed(() => data.value?.items || [])
const totalPages = computed(() => data.value?.pages || 1)
const total = computed(() => data.value?.total || 0)
const loading = computed(() => status.value === 'pending')

// App names cache
const appNames = ref<Record<string, string>>({})

// Fetch app names for display
watch(approvals, async (newApprovals) => {
  for (const approval of newApprovals) {
    if (!appNames.value[approval.appId]) {
      try {
        const { app } = await getApp(approval.appId)
        appNames.value[approval.appId] = app?.name || approval.appId
      } catch {
        appNames.value[approval.appId] = approval.appId
      }
    }
  }
}, { immediate: true })

// Action handlers
const processingIds = ref<Set<string>>(new Set())

async function handleApprove(id: string) {
  processingIds.value.add(id)
  try {
    await approve(id)
    toast.add({
      title: 'Deployment approved',
      description: 'The deployment has been approved and started.',
      color: 'success'
    })
    refresh()
  } catch (error: any) {
    toast.add({
      title: 'Failed to approve',
      description: error.data?.message || 'An error occurred',
      color: 'error'
    })
  } finally {
    processingIds.value.delete(id)
  }
}

async function handleReject(id: string) {
  processingIds.value.add(id)
  try {
    await reject(id)
    toast.add({
      title: 'Deployment rejected',
      description: 'The deployment request has been rejected.',
      color: 'warning'
    })
    refresh()
  } catch (error: any) {
    toast.add({
      title: 'Failed to reject',
      description: error.data?.message || 'An error occurred',
      color: 'error'
    })
  } finally {
    processingIds.value.delete(id)
  }
}

// Environment filter options
const environmentOptions = [
  { label: 'All environments', value: undefined },
  { label: 'Production', value: 'production' },
  { label: 'Staging', value: 'staging' },
  { label: 'Development', value: 'development' }
]
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold">Deployment Approvals</h1>
        <p class="text-muted">
          Review and approve pending deployment requests
        </p>
      </div>
      <UBadge
        v-if="total > 0"
        color="warning"
        variant="soft"
        size="lg"
      >
        {{ total }} pending
      </UBadge>
    </div>

    <!-- Filters -->
    <div class="flex items-center gap-4">
      <UFormField label="Environment">
        <USelectMenu
          v-model="environment"
          :items="environmentOptions"
          value-key="value"
          placeholder="All environments"
          class="w-48"
        />
      </UFormField>
      <UButton
        icon="i-lucide-refresh-cw"
        color="neutral"
        variant="ghost"
        :loading="loading"
        @click="() => refresh()"
      >
        Refresh
      </UButton>
    </div>

    <!-- Loading State -->
    <div
      v-if="loading && !approvals.length"
      class="space-y-4"
    >
      <USkeleton class="h-24" />
      <USkeleton class="h-24" />
      <USkeleton class="h-24" />
    </div>

    <!-- Empty State -->
    <UCard
      v-else-if="!approvals.length"
      class="text-center py-12"
    >
      <UIcon
        name="i-lucide-check-circle-2"
        class="w-12 h-12 text-success mx-auto mb-4"
      />
      <h3 class="text-lg font-semibold">All caught up!</h3>
      <p class="text-muted">
        No pending deployment approvals
      </p>
    </UCard>

    <!-- Approvals List -->
    <div
      v-else
      class="space-y-4"
    >
      <DeploymentApprovalCard
        v-for="approval in approvals"
        :key="approval._id"
        :approval="approval"
        :app-name="appNames[approval.appId]"
        :loading="processingIds.has(approval._id)"
        @approve="handleApprove"
        @reject="handleReject"
      />
    </div>

    <!-- Pagination -->
    <div
      v-if="totalPages > 1"
      class="flex justify-center"
    >
      <UPagination
        v-model:page="page"
        :total="totalPages * 20"
        :page-size="20"
      />
    </div>
  </div>
</template>
