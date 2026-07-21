<script setup lang="ts">
/**
 * GitHubSettingsForm — GitHub integration settings for an app.
 *
 * Allows users to:
 * - Enable/disable GitHub integration
 * - Configure repository owner and name
 * - Set the branch to deploy from
 * - Toggle auto-deploy on push
 */
const props = defineProps<{
  appId: string
  github?: TAppGitHub
  loading?: boolean
}>()

const emit = defineEmits<{
  save: [github: TAppGitHub]
}>()

const { updateGitHubSettings } = useApp()
const toast = useToast()

// Local form state
const form = ref<TAppGitHub>({
  enabled: props.github?.enabled ?? false,
  owner: props.github?.owner ?? '',
  repo: props.github?.repo ?? '',
  branch: props.github?.branch ?? 'main',
  autoDeployOnPush: props.github?.autoDeployOnPush ?? false,
  installationId: props.github?.installationId ?? ''
})

// Watch for prop changes
watch(() => props.github, (newGithub) => {
  if (newGithub) {
    form.value = { ...newGithub }
  }
}, { deep: true })

const saving = ref(false)
const message = ref('')

// Validation
const isValid = computed(() => {
  if (!form.value.enabled) return true
  return form.value.owner.trim() !== '' && form.value.repo.trim() !== ''
})

// Parse a full GitHub URL into owner/repo
function parseGitHubUrl(url: string) {
  // Handle URLs like:
  // - https://github.com/owner/repo
  // - https://github.com/owner/repo.git
  // - git@github.com:owner/repo.git
  // - owner/repo
  
  const httpsMatch = url.match(/github\.com[\/:](\S+?)\/(\S+?)(?:\.git)?$/)
  if (httpsMatch && httpsMatch[1] && httpsMatch[2]) {
    form.value.owner = httpsMatch[1]
    form.value.repo = httpsMatch[2]
    return
  }
  
  // Simple owner/repo format
  const simpleMatch = url.match(/^([^\/]+)\/([^\/]+)$/)
  if (simpleMatch && simpleMatch[1] && simpleMatch[2]) {
    form.value.owner = simpleMatch[1]
    form.value.repo = simpleMatch[2]
  }
}

async function handleSave() {
  if (!isValid.value) return
  
  saving.value = true
  message.value = ''
  
  try {
    await updateGitHubSettings(props.appId, form.value)
    toast.add({
      title: 'Settings saved',
      description: 'GitHub integration settings have been updated.',
      color: 'success'
    })
    emit('save', form.value)
  } catch (error: any) {
    message.value = error.data?.message || 'Failed to save settings'
    toast.add({
      title: 'Error',
      description: message.value,
      color: 'error'
    })
  } finally {
    saving.value = false
  }
}

async function handleCopyWebhookUrl() {
  await navigator.clipboard.writeText(webhookUrl.value)
}

// Computed webhook URL for display
const webhookUrl = computed(() => {
  const baseUrl = window.location.origin
  return `${baseUrl}/api/webhooks/github`
})
</script>

<template>
  <div class="space-y-6">
    <!-- Enable Toggle -->
    <div class="flex items-center justify-between">
      <div>
        <p class="font-medium">GitHub Integration</p>
        <p class="text-sm text-muted">
          Link this app to a GitHub repository for CI/CD integration
        </p>
      </div>
      <USwitch v-model="form.enabled" />
    </div>

    <!-- Settings (visible when enabled) -->
    <div
      v-if="form.enabled"
      class="space-y-4 pt-4 border-t border-default"
    >
      <!-- Repository -->
      <UFormField
        label="Repository"
        hint="Enter owner/repo or paste a GitHub URL"
        required
      >
        <div class="flex gap-2">
          <UInput
            v-model="form.owner"
            placeholder="owner"
            class="flex-1"
          />
          <span class="flex items-center text-muted">/</span>
          <UInput
            v-model="form.repo"
            placeholder="repo"
            class="flex-1"
            @paste.prevent="(e: ClipboardEvent) => parseGitHubUrl(e.clipboardData?.getData('text') || '')"
          />
        </div>
      </UFormField>

      <!-- Branch -->
      <UFormField
        label="Branch"
        hint="The branch to deploy from"
      >
        <UInput
          v-model="form.branch"
          placeholder="main"
        />
      </UFormField>

      <!-- Auto-deploy Toggle -->
      <div class="flex items-center justify-between py-2">
        <div>
          <p class="font-medium">Auto-deploy on push</p>
          <p class="text-sm text-muted">
            Automatically deploy when commits are pushed to the branch
          </p>
        </div>
        <USwitch v-model="form.autoDeployOnPush" />
      </div>

      <!-- Webhook URL -->
      <UFormField label="Webhook URL">
        <div class="flex gap-2">
          <UInput
            :model-value="webhookUrl"
            readonly
            class="flex-1 font-mono text-sm"
          />
          <UTooltip text="Copy to clipboard">
            <UButton
              icon="i-lucide-copy"
              color="neutral"
              variant="ghost"
              @click="handleCopyWebhookUrl"
            />
          </UTooltip>
        </div>
        <template #hint>
          <p class="text-xs text-muted">
            Add this URL as a webhook in your GitHub repository settings.
            <a
              :href="`https://github.com/${form.owner}/${form.repo}/settings/hooks/new`"
              target="_blank"
              class="text-primary hover:underline"
            >
              Configure webhook →
            </a>
          </p>
        </template>
      </UFormField>

      <!-- Installation ID (advanced) -->
      <UCollapsible>
        <UButton
          variant="ghost"
          color="neutral"
          size="sm"
          class="gap-1"
        >
          <template #leading>
            <UIcon
              name="i-lucide-settings-2"
              class="w-4 h-4"
            />
          </template>
          Advanced settings
        </UButton>
        <template #content>
          <div class="pt-4 space-y-4">
            <UFormField
              label="GitHub App Installation ID"
              hint="Required for updating GitHub deployment status"
            >
              <UInput
                v-model="form.installationId"
                placeholder="12345678"
              />
            </UFormField>
          </div>
        </template>
      </UCollapsible>
    </div>

    <!-- Error Message -->
    <UAlert
      v-if="message"
      color="error"
      variant="soft"
      icon="i-lucide-circle-alert"
      :description="message"
    />

    <!-- Save Button -->
    <div class="flex justify-end pt-4 border-t border-default">
      <UButton
        label="Save changes"
        :loading="saving"
        :disabled="!isValid || loading"
        @click="handleSave"
      />
    </div>
  </div>
</template>
