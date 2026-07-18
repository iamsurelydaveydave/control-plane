<script setup lang="ts">
/**
 * ConfirmDialog — Self-contained confirmation modal (UModal wrapper).
 *
 * Drive it with `v-model:open` and listen for `@confirm`. The parent stays in
 * control of async work + closing:
 *
 *   <ConfirmDialog
 *     v-model:open="dialogDelete"
 *     v-model:message="message"
 *     title="Delete member"
 *     content="This cannot be undone."
 *     confirm-label="Delete"
 *     color="error"
 *     :loading="loading"
 *     @confirm="submitDelete"
 *   />
 */
const open = defineModel<boolean>('open', { default: false })
const message = defineModel<string>('message', { default: '' })

withDefaults(
  defineProps<{
    title?: string
    /** Body copy. */
    content?: string
    confirmLabel?: string
    cancelLabel?: string
    color?: 'primary' | 'error' | 'warning' | 'success' | 'neutral'
    loading?: boolean
    disabled?: boolean
  }>(),
  {
    title: 'Are you sure?',
    content: '',
    confirmLabel: 'Confirm',
    cancelLabel: 'Cancel',
    color: 'primary',
    loading: false,
    disabled: false
  }
)

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

function onCancel() {
  emit('cancel')
  open.value = false
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="title"
    :dismissible="!loading"
  >
    <template #body>
      <div class="flex items-start gap-4">
        <div
          class="flex size-10 shrink-0 items-center justify-center rounded-full"
          :class="{
            'bg-error/10': color === 'error',
            'bg-warning/10': color === 'warning',
            'bg-primary/10': color === 'primary',
            'bg-success/10': color === 'success',
            'bg-muted': color === 'neutral'
          }"
        >
          <UIcon
            :name="color === 'error' ? 'i-lucide-alert-triangle' : 'i-lucide-alert-circle'"
            class="size-5"
            :class="{
              'text-error': color === 'error',
              'text-warning': color === 'warning',
              'text-primary': color === 'primary',
              'text-success': color === 'success',
              'text-muted': color === 'neutral'
            }"
          />
        </div>
        <p class="text-muted">
          {{ content }}
        </p>
      </div>

      <UAlert
        v-if="message"
        class="mt-4"
        color="error"
        variant="soft"
        :title="message"
      />
    </template>

    <template #footer>
      <UButton
        :label="cancelLabel"
        color="neutral"
        variant="outline"
        :disabled="disabled || loading"
        @click="onCancel"
      />
      <UButton
        :label="confirmLabel"
        :color="color"
        :loading="loading"
        :disabled="disabled"
        @click="emit('confirm')"
      />
    </template>
  </UModal>
</template>
