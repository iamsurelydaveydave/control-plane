<script setup lang="ts">
/**
 * ConfirmationPrompt — standard delete/action confirmation dialog following goweekdays-web pattern.
 *
 * Shows a title, content message, and action bar with Cancel + Confirm buttons.
 * Error messages displayed in the dialog via v-model:message.
 */
const _props = withDefaults(
  defineProps<{
    title?: string
    content?: string
    action?: string
    disabled?: boolean
    color?: 'error' | 'warning' | 'primary'
  }>(),
  {
    title: 'Confirm',
    content: 'Are you sure you want to proceed?',
    action: 'Confirm',
    disabled: false,
    color: 'error'
  }
)

const emit = defineEmits<{
  cancel: []
  confirm: []
}>()

const message = defineModel<string>('message', { default: '' })
</script>

<template>
  <div class="p-6 space-y-4">
    <div class="flex items-start gap-4">
      <div
        class="flex size-10 shrink-0 items-center justify-center rounded-full"
        :class="{
          'bg-error/10': color === 'error',
          'bg-warning/10': color === 'warning',
          'bg-primary/10': color === 'primary'
        }"
      >
        <UIcon
          :name="color === 'error' ? 'i-lucide-alert-triangle' : 'i-lucide-alert-circle'"
          class="size-5"
          :class="{
            'text-error': color === 'error',
            'text-warning': color === 'warning',
            'text-primary': color === 'primary'
          }"
        />
      </div>
      <div>
        <h3 class="text-lg font-semibold text-highlighted">
          {{ title }}
        </h3>
        <p class="mt-1 text-muted">
          {{ content }}
        </p>
      </div>
    </div>

    <UAlert
      v-if="message"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      :description="message"
    />

    <div class="flex justify-end gap-2">
      <UButton
        color="neutral"
        variant="outline"
        label="Cancel"
        :disabled="disabled"
        @click="emit('cancel')"
      />
      <UButton
        :color="color"
        :label="action"
        :loading="disabled"
        @click="emit('confirm')"
      />
    </div>
  </div>
</template>
