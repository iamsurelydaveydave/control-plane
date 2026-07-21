<script setup lang="ts">
/**
 * DeploymentApprovalCard — displays a pending deployment approval request.
 *
 * Shows:
 * - App name/version/environment
 * - Requested by and when
 * - Approve/Reject actions
 */
const props = defineProps<{
  approval: TDeploymentApproval
  appName?: string
  loading?: boolean
}>()

const emit = defineEmits<{
  approve: [id: string]
  reject: [id: string]
}>()

const showRejectDialog = ref(false)
const rejectReason = ref('')
const rejecting = ref(false)

// Format relative time
function formatRelativeTime(date: string) {
  const now = new Date()
  const then = new Date(date)
  const diffMs = now.getTime() - then.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  return `${diffDays}d ago`
}

// Check if approval is expiring soon (within 2 hours)
const isExpiringSoon = computed(() => {
  const expiresAt = new Date(props.approval.expiresAt)
  const now = new Date()
  const hoursLeft = (expiresAt.getTime() - now.getTime()) / 3600000
  return hoursLeft < 2 && hoursLeft > 0
})

// Environment badge color
const envColor = computed(() => {
  switch (props.approval.environment) {
    case 'production': return 'error'
    case 'staging': return 'warning'
    default: return 'info'
  }
})

function handleReject() {
  emit('reject', props.approval._id)
  showRejectDialog.value = false
  rejectReason.value = ''
}
</script>

<template>
  <UCard>
    <div class="flex items-start justify-between">
      <div class="space-y-1">
        <div class="flex items-center gap-2">
          <p class="font-semibold">{{ appName || approval.appId }}</p>
          <UBadge
            :color="envColor"
            variant="subtle"
            :label="approval.environment"
          />
        </div>
        <p class="text-sm text-muted">
          Version: <code class="text-xs bg-muted px-1 rounded">{{ approval.version }}</code>
        </p>
        <p class="text-xs text-muted">
          Requested {{ formatRelativeTime(approval.requestedAt) }}
        </p>
        <UAlert
          v-if="isExpiringSoon"
          color="warning"
          variant="soft"
          icon="i-lucide-clock"
          class="mt-2"
        >
          <template #description>
            <span class="text-xs">Expires soon</span>
          </template>
        </UAlert>
      </div>
      
      <div class="flex gap-2">
        <UButton
          color="error"
          variant="soft"
          size="sm"
          icon="i-lucide-x"
          :loading="loading"
          @click="showRejectDialog = true"
        >
          Reject
        </UButton>
        <UButton
          color="success"
          size="sm"
          icon="i-lucide-check"
          :loading="loading"
          @click="emit('approve', approval._id)"
        >
          Approve
        </UButton>
      </div>
    </div>

    <!-- Reject Dialog -->
    <UModal v-model:open="showRejectDialog">
      <template #content>
        <div class="p-4 space-y-4">
          <h3 class="text-lg font-semibold">Reject Deployment</h3>
          <p class="text-sm text-muted">
            Are you sure you want to reject this deployment request?
          </p>
          
          <UFormField label="Reason (optional)">
            <UTextarea
              v-model="rejectReason"
              placeholder="Provide a reason for rejection..."
              :rows="3"
            />
          </UFormField>

          <div class="flex justify-end gap-2 pt-2">
            <UButton
              color="neutral"
              variant="ghost"
              @click="showRejectDialog = false"
            >
              Cancel
            </UButton>
            <UButton
              color="error"
              :loading="rejecting"
              @click="handleReject"
            >
              Reject
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </UCard>
</template>
