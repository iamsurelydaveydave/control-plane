---
name: web-crud-ui
description: control-plane-web (Nuxt 4 + @nuxt/ui + Tailwind CSS) conventions for a list/table page and its CRUD modals and forms. Use whenever you build or modify a page that shows a data table, an add/edit/view/delete modal, an operation modal, or any form. Enforces the two-component pattern (Main hosts the table + modals + CRUD state; Form is UI-only and emits), the single setItem/set<Action> state setter (never toggle a modal ref directly), data via useLazyAsyncData, all HTTP through useNuxtApp().$api composables, defineModel two-way binding, UForm + Zod validation, and Tailwind layout (not v-row/v-col). Uses @nuxt/ui components: UTable, UModal, UButton, UCard, UForm, UFormField, UInput, UDropdownMenu, UPagination.
---

# Web CRUD UI: table pages, modals & forms

Apply this whenever you build or modify a page in `control-plane-web` that shows a
data table with add/edit/view/delete or operation modals. Full reference in
`control-plane-web/CLAUDE.md`. Load the `nuxt-ui` skill for component selection.

## The shape (two layers, always)

```
<Resource>Main.vue   — list page: table + all modals + CRUD state
<Resource>Form.vue   — form UI only: fields + footer, emits events (never calls API)
```

A page imports `<ResourceMain />` and nothing else. All dialog/modal state, data
fetching, and submit logic lives in Main. The Form only emits `close`, `submit`,
`edit`, `delete`.

---

## Table page convention

```vue
<template>
  <ServerMain />
</template>

<script setup lang="ts">
definePageMeta({ middleware: ['auth'] })
</script>
```

---

## Main component (`<Resource>Main.vue`)

```typescript
// Data fetching
const { server, getAll, add, updateById, deleteById } = useServer()
const resource = ref({ ...server.value })
const resourceId = computed(() => resource.value._id ?? '')

const page = ref(1)
const search = ref('')
const { data, refresh, status } = useLazyAsyncData(
  'servers-list',
  () => getAll({ page: page.value, search: search.value }),
  { watch: [page, search] }
)
const loadingItems = computed(() => status.value === 'pending')
const items = computed(() => data.value?.items ?? [])
const totalPages = computed(() => data.value?.pages ?? 1)

// Modal state
const openAdd = ref(false)
const openPreview = ref(false)
const openEdit = ref(false)
const openDelete = ref(false)
const loadingForm = ref(false)
const message = ref('')
```

### One `setItem` setter for all modals (never toggle a modal ref directly)

```typescript
function setItem({
  value = { ...server.value },
  mode = '',
  open = false,
} = {}) {
  Object.assign(resource.value, JSON.parse(JSON.stringify(value)))
  message.value = ''
  if (mode === 'add')    openAdd.value = open
  if (mode === 'view')   openPreview.value = open
  if (mode === 'edit')   openEdit.value = open
  if (mode === 'delete') openDelete.value = open
}

function handleRowClick(row: TServer) {
  setItem({ value: row, mode: 'view', open: true })
}

function handleEdit(openModal = false) {
  if (openModal) openPreview.value = false
  openEdit.value = openModal
}

function setDeleteModal(value = false) {
  if (value) setItem({ mode: 'view' })
  openDelete.value = value
}
```

### CRUD submit functions (exact shape)

```typescript
async function submitAdd() {
  loadingForm.value = true; message.value = ''
  try {
    await add({ name: resource.value.name /* fields */ })
    setItem({ mode: 'add' })  // closes + resets
    await refresh()
  } catch (error: any) {
    message.value = error?.data?.message ?? 'Failed to add.'
  } finally { loadingForm.value = false }
}

async function submitEdit() {
  loadingForm.value = true; message.value = ''
  try {
    await updateById(resourceId.value, { name: resource.value.name /* fields */ })
    await refresh()
    setItem({ mode: 'edit' })
  } catch (error: any) {
    message.value = error?.data?.message ?? 'Failed to update.'
  } finally { loadingForm.value = false }
}

async function submitDelete() {
  loadingForm.value = true; message.value = ''
  try {
    await deleteById(resourceId.value)
    await refresh()
    setItem({ mode: 'view' })
    openDelete.value = false
  } catch (error: any) {
    message.value = error?.data?.message ?? 'Failed to delete.'
  } finally { loadingForm.value = false }
}
```

### Template structure

```vue
<template>
  <div class="space-y-4">
    <!-- Header + Add button -->
    <div class="flex items-center justify-between">
      <h2 class="text-xl font-semibold">Servers</h2>
      <UButton icon="i-lucide-plus" @click="setItem({ mode: 'add', open: true })">
        Add Server
      </UButton>
    </div>

    <!-- Data table -->
    <UCard>
      <UTable :rows="items" :columns="columns" :loading="loadingItems"
        @select="handleRowClick" />
      <div class="flex justify-end p-2 border-t border-default">
        <UPagination v-model:page="page" :total="totalPages * 20" :page-size="20" />
      </div>
    </UCard>

    <!-- Add modal -->
    <UModal v-model:open="openAdd">
      <template #content>
        <ServerForm v-model="resource" v-model:message="message"
          title="Add Server" mode="add" :loading="loadingForm"
          @close="setItem({ mode: 'add' })" @submit="submitAdd" />
      </template>
    </UModal>

    <!-- View modal -->
    <UModal v-model:open="openPreview">
      <template #content>
        <ServerForm v-model="resource" title="Server Details" mode="view"
          @close="setItem({ mode: 'view' })"
          @edit="handleEdit(true)" @delete="setDeleteModal(true)" />
      </template>
    </UModal>

    <!-- Edit modal -->
    <UModal v-model:open="openEdit">
      <template #content>
        <ServerForm v-model="resource" v-model:message="message"
          title="Edit Server" mode="edit" :loading="loadingForm"
          @close="setItem({ mode: 'edit' })" @submit="submitEdit" />
      </template>
    </UModal>

    <!-- Delete confirmation -->
    <UModal v-model:open="openDelete">
      <template #content>
        <ConfirmationPrompt title="Delete Server" action="Delete"
          content="Are you sure you want to delete this server?"
          v-model:message="message" :disabled="loadingForm"
          @cancel="setDeleteModal()" @confirm="submitDelete" />
      </template>
    </UModal>
  </div>
</template>
```

---

## Form component (`<Resource>Form.vue`)

```vue
<template>
  <div class="flex flex-col min-h-0">
    <!-- scrollable body -->
    <div class="p-4 space-y-4 overflow-y-auto">
      <div class="font-semibold text-lg">{{ props.title ?? 'Server' }}</div>

      <UForm :schema="schema" :state="resource" @submit="emit('submit')">
        <UFormField label="Name" name="name">
          <UInput v-model="resource.name" :readonly="!isMutable" />
        </UFormField>
        <UFormField label="Host" name="host">
          <UInput v-model="resource.host" :readonly="!isMutable" />
        </UFormField>
      </UForm>

      <!-- Error message -->
      <UAlert v-if="message" color="error" variant="soft"
        :description="message" @close="message = ''" />
    </div>

    <!-- sticky footer action bar -->
    <div class="sticky bottom-0 border-t border-default bg-default flex p-3 gap-2">
      <UButton class="flex-1" variant="ghost" :disabled="props.loading"
        @click="emit('close')">
        {{ isMutable ? 'Cancel' : 'Close' }}
      </UButton>

      <!-- View mode: More actions -->
      <UDropdownMenu v-if="mode === 'view'" :items="moreActions" class="flex-1">
        <UButton class="w-full" color="neutral">More actions</UButton>
      </UDropdownMenu>

      <!-- Add/Edit mode: Submit -->
      <UButton v-if="isMutable" class="flex-1" :loading="props.loading"
        @click="emit('submit')">
        {{ submitTitle }}
      </UButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { z } from 'zod'

const props = defineProps<{
  title?: string
  mode?: 'add' | 'edit' | 'view'
  loading?: boolean
}>()
const emit = defineEmits<{ close: []; submit: []; edit: []; delete: [] }>()

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  host: z.string().min(1, 'Host is required'),
})

const isMutable = computed(() => !props.mode || ['add', 'edit'].includes(props.mode))
const submitTitle = computed(() => props.mode === 'edit' ? 'Save changes' : 'Submit')
const message = defineModel<string>('message', { default: '' })
const resource = defineModel<TServer>({ required: true })

const moreActions = computed(() => [[
  { label: 'Edit', onSelect: () => emit('edit') },
  { label: 'Delete', class: 'text-error', onSelect: () => emit('delete') },
]])
</script>
```

Key rules:

- `defineModel()` for two-way binding of the resource and error `message`
- `isMutable` controls `:readonly` on fields and which footer action renders
- The form never calls API functions — it only emits events
- Error `UAlert` sits in the scrollable body, above the sticky footer
- Action bar has exactly two action slots (Cancel + Submit, or Close + More actions)

---

## Operation dialogs (non-CRUD forms)

```typescript
const openDeploy = ref(false)
const deployLoading = ref(false)
const deployMessage = ref('')
const deployForm = ref({ version: '', env: '' })

function setDeploy({ open = false } = {}) {
  deployForm.value = { version: '', env: '' }
  deployMessage.value = ''
  openDeploy.value = open
}

async function handleDeploySubmit() {
  deployLoading.value = true; deployMessage.value = ''
  try {
    await deploy(appId, deployForm.value)
    setDeploy()   // closes + resets
    await refresh()
  } catch (error: any) {
    deployMessage.value = error?.data?.message ?? 'Deployment failed.'
  } finally { deployLoading.value = false }
}
```

- **One `set<Action>({ open })` per operation modal** — always resets form + message
- `set<Action>({ open: true })` opens with a clean form; `set<Action>()` closes + resets
- Never set the modal ref directly (`openDeploy.value = true/false`)

---

## Confirm every mutation (`ConfirmationPrompt`)

Every data-mutating action (delete, revoke, stop, reset) goes through a
`ConfirmationPrompt` inside a `UModal` — nothing changes on an accidental click.

```vue
<UModal v-model:open="openDelete">
  <template #content>
    <ConfirmationPrompt
      title="Delete Server"
      action="Delete"
      content="Are you sure? This cannot be undone."
      v-model:message="message"
      :disabled="loadingForm"
      @cancel="setDeleteModal()"
      @confirm="submitDelete"
    />
  </template>
</UModal>
```

---

## Composables, HTTP, types, state

- All HTTP through `useNuxtApp().$api<T>('/path', { method, body, query })`
- State: `useState` + composable refs — no Pinia or Vuex
- Types: `declare type T<Resource>` in `app/types/*.d.ts`
- Composables return reactive refs + raw-promise API fns; pages wrap with `useLazyAsyncData`

---

## Validation

- **Forms:** `UForm` with `z.object(...)` schema from Zod
- **Route params:** Zod `safeParse` in middleware
- **No Joi** in the frontend — Joi is backend-only

---

## Don't

- **No Pinia or Vuex** — `useState` + composable refs only
- **No direct fetch/axios** — always `useNuxtApp().$api`
- **No Joi in the frontend** — Zod only
- **No `<Options API>`** — `<script setup>` everywhere
- **No business logic in pages** — delegate to composables
- **No `interface` for resource types** — `declare type T<Resource>`
- **No `v-row`/`v-col`** — this is Nuxt UI + Tailwind, not Vuetify
- **No raw palette colors** (`text-gray-500`) — always semantic (`text-muted`, `text-default`)
- **No direct modal toggling** — never set a modal ref like `open.value = true/false`;
  route every open/close through `setItem` or `set<Action>` so the form always resets
- **No ungated mutations without a `ConfirmationPrompt`** — every delete/revoke/stop
  goes through confirmation
