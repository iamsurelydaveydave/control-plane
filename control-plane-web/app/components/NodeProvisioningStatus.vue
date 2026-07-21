<script setup lang="ts">
/**
 * NodeProvisioningStatus — Shows the provisioning progress for a node.
 *
 * Displays step-by-step progress with status indicators.
 */
const props = defineProps<{
  node: TNode
  loading?: boolean
}>()

const emit = defineEmits<{
  close: []
  retry: []
  refresh: []
}>()

// Computed helpers
const isRunning = computed(() => props.node.provisioningStatus === 'running')
const isSuccess = computed(() => props.node.provisioningStatus === 'success')
const isFailed = computed(() => props.node.provisioningStatus === 'failed')
const canRetry = computed(() => isFailed.value || props.node.status === 'pending')

const steps = computed(() => props.node.provisioningLog || [])

function getStepIcon(status: TProvisioningStepStatus): string {
  switch (status) {
    case 'success':
      return 'i-lucide-check-circle'
    case 'failed':
      return 'i-lucide-x-circle'
    case 'running':
      return 'i-lucide-loader'
    case 'skipped':
      return 'i-lucide-minus-circle'
    default:
      return 'i-lucide-circle'
  }
}

function getStepColor(status: TProvisioningStepStatus): string {
  switch (status) {
    case 'success':
      return 'text-success'
    case 'failed':
      return 'text-error'
    case 'running':
      return 'text-primary animate-spin'
    case 'skipped':
      return 'text-muted'
    default:
      return 'text-muted'
  }
}

function getStepBgColor(status: TProvisioningStepStatus): string {
  switch (status) {
    case 'success':
      return 'bg-success/10'
    case 'failed':
      return 'bg-error/10'
    case 'running':
      return 'bg-primary/10'
    default:
      return 'bg-muted/50'
  }
}

function formatDuration(startedAt?: string, completedAt?: string): string {
  if (!startedAt) return ''
  const start = new Date(startedAt).getTime()
  const end = completedAt ? new Date(completedAt).getTime() : Date.now()
  const seconds = Math.round((end - start) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${remainingSeconds}s`
}

// Auto-refresh while running
const refreshInterval = ref<ReturnType<typeof setInterval> | null>(null)

watch(
  () => props.node.provisioningStatus,
  (status) => {
    if (status === 'running') {
      // Start polling
      refreshInterval.value = setInterval(() => {
        emit('refresh')
      }, 3000)
    } else {
      // Stop polling
      if (refreshInterval.value) {
        clearInterval(refreshInterval.value)
        refreshInterval.value = null
      }
    }
  },
  { immediate: true }
)

onUnmounted(() => {
  if (refreshInterval.value) {
    clearInterval(refreshInterval.value)
  }
})
</script>

<template>
  <div class="space-y-4 p-4">
    <!-- Header -->
    <div class="flex items-center gap-3">
      <div
        class="flex size-10 items-center justify-center rounded-lg"
        :class="{
          'bg-primary/10': isRunning,
          'bg-success/10': isSuccess,
          'bg-error/10': isFailed
        }"
      >
        <UIcon
          :name="isRunning ? 'i-lucide-loader' : isSuccess ? 'i-lucide-check-circle' : 'i-lucide-x-circle'"
          class="size-5"
          :class="{
            'text-primary animate-spin': isRunning,
            'text-success': isSuccess,
            'text-error': isFailed
          }"
        />
      </div>
      <div>
        <h3 class="font-semibold text-highlighted">
          {{ isRunning ? 'Provisioning...' : isSuccess ? 'Provisioning Complete' : 'Provisioning Failed' }}
        </h3>
        <p class="text-sm text-muted">
          {{ node.name }} · {{ node.host }}
        </p>
      </div>
    </div>

    <!-- Steps -->
    <div class="space-y-2">
      <div
        v-for="step in steps"
        :key="step.name"
        class="rounded-lg border border-default p-3"
        :class="getStepBgColor(step.status)"
      >
        <div class="flex items-center gap-3">
          <UIcon
            :name="getStepIcon(step.status)"
            class="size-5 shrink-0"
            :class="getStepColor(step.status)"
          />
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between gap-2">
              <span class="font-medium text-sm">{{ step.label }}</span>
              <span
                v-if="step.startedAt"
                class="text-xs text-muted"
              >
                {{ formatDuration(step.startedAt, step.completedAt) }}
              </span>
            </div>

            <!-- Output -->
            <pre
              v-if="step.output && step.status === 'success'"
              class="mt-2 text-xs text-muted whitespace-pre-wrap font-mono bg-default/50 rounded p-2"
            >{{ step.output }}</pre>

            <!-- Error -->
            <div
              v-if="step.error"
              class="mt-2 text-xs text-error bg-error/10 rounded p-2"
            >
              {{ step.error }}
            </div>
          </div>
        </div>
      </div>

      <!-- Empty state if no steps -->
      <div
        v-if="!steps.length"
        class="text-center py-8 text-muted"
      >
        <UIcon name="i-lucide-clock" class="size-8 mx-auto mb-2" />
        <p>Waiting for provisioning to start...</p>
      </div>
    </div>

    <!-- Status message -->
    <UAlert
      v-if="node.statusMessage && isFailed"
      :description="node.statusMessage"
      color="error"
      variant="soft"
      icon="i-lucide-alert-circle"
    />

    <!-- Success message -->
    <UAlert
      v-if="isSuccess"
      title="Node provisioned successfully!"
      description="The worker node has joined the cluster and is ready to run workloads."
      color="success"
      variant="soft"
      icon="i-lucide-check-circle"
    />

    <!-- Footer -->
    <div class="flex justify-end gap-2 pt-4 border-t border-default">
      <UButton
        v-if="canRetry"
        variant="soft"
        color="warning"
        icon="i-lucide-refresh-cw"
        label="Retry"
        :loading="loading"
        @click="emit('retry')"
      />
      <UButton
        :label="isRunning ? 'Close' : 'Done'"
        @click="emit('close')"
      />
    </div>
  </div>
</template>
