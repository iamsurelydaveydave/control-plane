<script setup lang="ts">
/**
 * App CI/CD Settings Page
 *
 * Allows users to configure:
 * - GitHub integration
 * - Deployment approvals
 * - View API token for CI/CD
 */
definePageMeta({
  layout: 'dashboard'
})

const route = useRoute()
const appId = computed(() => route.params.id as string)

const { getById } = useApp()
const { getAll: getAPITokens } = useAPIToken()
const toast = useToast()

// Fetch app data
const { data: appData, status, refresh: refreshApp } = await useLazyAsyncData(
  `app-${appId.value}-cicd`,
  () => getById(appId.value),
  { watch: [appId] }
)

const app = computed(() => appData.value?.app)

// Fetch API tokens for display
const { data: tokensData } = await useLazyAsyncData(
  'api-tokens',
  () => getAPITokens()
)

const tokens = computed(() => tokensData.value?.items || [])

// Find a token with deployments:write scope
const deployToken = computed(() => {
  return tokens.value.find(t =>
    t.scopes?.includes('deployments:write') || t.scopes?.includes('*')
  )
})

// Loading state
const loading = computed(() => status.value === 'pending')

// Handle GitHub settings save
function handleGitHubSave(github: TAppGitHub) {
  refreshApp()
}

// Copy to clipboard helper
async function copyToClipboard(text: string, label: string) {
  await navigator.clipboard.writeText(text)
  toast.add({
    title: 'Copied!',
    description: `${label} copied to clipboard`,
    color: 'success'
  })
}

// Compute the API base URL (handles SSR)
const apiBaseUrl = computed(() => {
  if (import.meta.client) {
    return window.location.origin
  }
  return ''
})
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center gap-4">
      <NuxtLink
        :to="`/dashboard/apps/${appId}`"
        class="text-muted hover:text-default"
      >
        <UIcon
          name="i-lucide-arrow-left"
          class="w-5 h-5"
        />
      </NuxtLink>
      <div>
        <h1 class="text-2xl font-bold">CI/CD Settings</h1>
        <p
          v-if="app"
          class="text-muted"
        >
          {{ app.name }}
        </p>
      </div>
    </div>

    <!-- Loading State -->
    <div
      v-if="loading"
      class="space-y-4"
    >
      <USkeleton class="h-32" />
      <USkeleton class="h-48" />
    </div>

    <template v-else-if="app">
      <!-- API Integration Section -->
      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon
              name="i-lucide-terminal"
              class="w-5 h-5"
            />
            <h2 class="font-semibold">API Integration</h2>
          </div>
        </template>

        <div class="space-y-4">
          <p class="text-sm text-muted">
            Use these values to trigger deployments from your CI/CD pipeline.
          </p>

          <!-- App ID -->
          <UFormField label="App ID">
            <div class="flex gap-2">
              <UInput
                :model-value="app._id"
                readonly
                class="flex-1 font-mono text-sm"
              />
              <UButton
                icon="i-lucide-copy"
                color="neutral"
                variant="ghost"
                @click="copyToClipboard(app._id, 'App ID')"
              />
            </div>
          </UFormField>

          <!-- API Token -->
          <UFormField label="API Token">
            <template v-if="deployToken">
              <div class="flex gap-2">
                <UInput
                  model-value="••••••••••••••••"
                  readonly
                  class="flex-1 font-mono text-sm"
                />
                <UButton
                  color="neutral"
                  variant="outline"
                  icon="i-lucide-key"
                  to="/dashboard/settings/api-tokens"
                >
                  View tokens
                </UButton>
              </div>
              <p class="text-xs text-muted mt-1">
                Token: {{ deployToken.name }} (scopes: {{ deployToken.scopes?.join(', ') }})
              </p>
            </template>
            <template v-else>
              <UAlert
                color="warning"
                variant="soft"
                icon="i-lucide-alert-triangle"
              >
                <template #description>
                  <p>
                    No API token found with <code class="text-xs">deployments:write</code> scope.
                    <NuxtLink
                      to="/dashboard/settings/api-tokens"
                      class="underline font-medium"
                    >
                      Create one
                    </NuxtLink>
                  </p>
                </template>
              </UAlert>
            </template>
          </UFormField>

          <!-- Deploy Command -->
          <UFormField label="Deploy Command">
            <div class="bg-muted rounded-lg p-3 font-mono text-xs overflow-x-auto">
              <pre class="whitespace-pre-wrap">curl -X POST \
  -H "Authorization: Bearer $CONTROL_PLANE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"version": "v1.0.0"}' \
  "{{ apiBaseUrl }}/api/apps/{{ app._id }}/deploy"</pre>
            </div>
          </UFormField>

          <!-- Documentation Link -->
          <div class="pt-2">
            <NuxtLink
              to="/docs/ci-cd"
              class="text-sm text-primary hover:underline flex items-center gap-1"
            >
              <UIcon
                name="i-lucide-book-open"
                class="w-4 h-4"
              />
              View CI/CD documentation
            </NuxtLink>
          </div>
        </div>
      </UCard>

      <!-- GitHub Integration Section -->
      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon
              name="i-lucide-github"
              class="w-5 h-5"
            />
            <h2 class="font-semibold">GitHub Integration</h2>
          </div>
        </template>

        <GitHubSettingsForm
          :app-id="app._id"
          :github="app.github"
          :loading="loading"
          @save="handleGitHubSave"
        />
      </UCard>

      <!-- Deployment Approvals Section -->
      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon
              name="i-lucide-shield-check"
              class="w-5 h-5"
            />
            <h2 class="font-semibold">Deployment Approvals</h2>
          </div>
        </template>

        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <div>
              <p class="font-medium">Require approval for deployments</p>
              <p class="text-sm text-muted">
                When enabled, deployments must be approved before they run
              </p>
            </div>
            <UBadge
              v-if="app.environment === 'production'"
              color="info"
              variant="soft"
            >
              Recommended for production
            </UBadge>
          </div>

          <UAlert
            v-if="app.requireApproval"
            color="info"
            variant="soft"
            icon="i-lucide-info"
          >
            <template #description>
              <p>
                Deployment approvals are enabled. Use the
                <code class="text-xs bg-muted px-1 rounded">POST /apps/:id/deploy/request</code>
                endpoint to request approval, then approve via the dashboard or API.
              </p>
            </template>
          </UAlert>

          <p class="text-xs text-muted">
            Configure approval requirements in the app's general settings.
          </p>
        </div>
      </UCard>

      <!-- Environment Section -->
      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon
              name="i-lucide-layers"
              class="w-5 h-5"
            />
            <h2 class="font-semibold">Environment</h2>
          </div>
        </template>

        <div class="space-y-4">
          <UFormField label="Current Environment">
            <UBadge
              :color="app.environment === 'production' ? 'error' : app.environment === 'staging' ? 'warning' : 'info'"
              variant="subtle"
              size="lg"
            >
              {{ app.environment || 'Not set' }}
            </UBadge>
          </UFormField>

          <p class="text-xs text-muted">
            Environment can be set when creating or updating the app.
            Use the <code class="text-xs bg-muted px-1 rounded">environment</code> field in your API requests.
          </p>
        </div>
      </UCard>
    </template>

    <!-- Not Found -->
    <UAlert
      v-else
      color="error"
      variant="soft"
      icon="i-lucide-alert-circle"
      title="App not found"
      description="The app you're looking for doesn't exist or you don't have access to it."
    />
  </div>
</template>
