<template>
  <div class="flex justify-center p-1">
    <div class="w-full max-w-4xl">
      <div class="mb-1 text-xl font-bold text-highlighted">
        {{ title }}
      </div>
      <div
        v-if="subtitle"
        class="mb-6 text-sm text-muted"
      >
        {{ subtitle }}
      </div>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <component
          :is="isActive(item) ? NuxtLink : 'div'"
          v-for="item in items"
          :key="item.title"
          :to="isActive(item) ? item.to : undefined"
          class="flex items-center gap-3 rounded-lg border border-default p-4 transition-colors"
          :class="
            isActive(item)
              ? 'hover:border-inverted/30 hover:bg-elevated'
              : 'pointer-events-none opacity-50'
          "
        >
          <div
            class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-elevated"
          >
            <UIcon
              :name="item.icon"
              class="size-5 text-muted"
            />
          </div>
          <div>
            <div class="font-medium text-highlighted">
              {{ item.title }}
            </div>
            <div class="text-xs text-muted">
              {{ isActive(item) ? item.description : "Coming soon" }}
            </div>
          </div>
        </component>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * HubLinks — a centered hub page with icon cards that link to sub-pages.
 * Items with `status: "soon"` render as disabled "Coming soon" cards.
 */
import { NuxtLink } from '#components'

interface HubLinkItem {
  title: string
  description?: string
  icon: string
  to?: string | { name: string, params?: Record<string, string> }
  status?: 'active' | 'soon'
}

defineProps<{
  title: string
  subtitle?: string
  items: HubLinkItem[]
}>()

function isActive(item: HubLinkItem) {
  return (item.status ?? 'active') === 'active' && !!item.to
}
</script>
