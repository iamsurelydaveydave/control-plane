# control-plane-web

Nuxt 4 + @nuxt/ui + Tailwind CSS + TypeScript frontend for the Control Plane dashboard.
Deployed via Docker (see `Dockerfile`).

## Agent skills (load before building)

Operational patterns live in `../.agents/skills/`:

- **`nuxt-ui`** — any UI work: component selection, theming, forms, layouts. This is the
  reference for which component to use and how to compose them.
- **`web-crud-ui`** — any page with a table, add/edit/view/delete dialogs, operation
  dialogs, or forms. Enforces the Main + Form pattern and the single `setItem`/
  `set<Action>` setter. This doc is the long-form reference behind it.

---

## Project Layout

```
app/
  assets/css/        # main.css (@import "tailwindcss"; @import "@nuxt/ui";)
  components/        # Shared UI components
  composables/       # Data-fetching composables (useServer, useApp, etc.)
  layouts/           # Nuxt layouts
  middleware/        # Route middleware
  pages/             # File-based routing
  plugins/           # api.ts (provides $api), secure.client.ts (auth guard)
  types/             # TypeScript type declarations (*.d.ts)
  app.vue            # Root — must wrap content in <UApp>
```

---

## Naming Conventions

| Entity           | Pattern                              | Example                                   |
| ---------------- | ------------------------------------ | ----------------------------------------- |
| Component        | PascalCase `.vue`                    | `ServerForm.vue`, `AppMain.vue`           |
| Page             | kebab-case or `index.vue`            | `servers/index.vue`, `[id].vue`           |
| Composable       | `use<Resource>.ts`                   | `useServer.ts`, `useApp.ts`               |
| Type declaration | `<resource>.d.ts`                    | `server.d.ts`, `app.d.ts`                 |
| Middleware       | numbered or kebab-case               | `01.auth.ts`                              |

---

## TypeScript Types

Global types live in `app/types/*.d.ts` as `declare type` (no imports needed — Nuxt
auto-includes them).

```typescript
// app/types/server.d.ts
declare type TServer = {
  _id: string;
  name: string;
  host: string;
  status: 'unknown' | 'online' | 'offline' | 'provisioning';
  // ...
};
```

- Type names follow `T<Resource>` — `TServer`, `TApp`, `TDatabase`
- Never use `interface` for resource types; always `declare type`
- Types for form payloads: `T<Resource>Form` (Omit `_id` and server-managed fields)

---

## Composables

All data-fetching and business logic live in `app/composables/`.

**Structure:** plain function (no `defineStore`, no Pinia) that returns reactive state
and API call functions.

```typescript
// app/composables/useServer.ts
export default function useServer() {
  const server = ref<TServer>({ _id: '', name: '', host: '', status: 'unknown', ... })

  function getAll(options: { page?: number; search?: string } = {}) {
    return useNuxtApp().$api<{ items: TServer[]; pages: number }>('/servers', {
      method: 'GET',
      query: { page: options.page ?? 1, search: options.search ?? '' }
    })
  }

  function add(value: TServerForm) {
    return useNuxtApp().$api<{ message: string; serverId: string }>('/servers', {
      method: 'POST',
      body: value
    })
  }

  return { server, getAll, add, /* ... */ }
}
```

Rules:

- Composables only return functions and reactive refs — **no side effects on call**
- API functions return the raw promise from `$api` — pages handle `useLazyAsyncData` wrapping
- Always type the `$api` generic: `$api<ReturnType>(...)`
- Default query params inline with `?? fallback`

---

## API Communication

All HTTP calls go through `useNuxtApp().$api`, which is a typed `$fetch` instance
defined in `app/plugins/api.ts`. It uses a `baseURL` of `/api` (proxied by Nuxt route
rules to the backend). Never call the backend URL directly from components.

```typescript
const { data } = await useNuxtApp().$api<{ items: TServer[] }>('/servers', {
  method: 'GET',
  query: { page: 1 }
})
```

---

## State Management

No Pinia. No Vuex. Use Nuxt's `useState` for app-wide state:

```typescript
const currentUser = useState<TUser | null>('currentUser', () => null)
```

`useState` keys must be unique strings. Local component state uses `ref`/`reactive`.

---

## Pages

Pages use `<script setup>` exclusively with `definePageMeta` for route config:

```typescript
definePageMeta({
  middleware: ['auth'],
})
```

Data fetching uses `useLazyAsyncData`:

```typescript
const { data, refresh, status } = useLazyAsyncData(
  'servers-list',
  () => getAll({ page: page.value, search: search.value }),
  { watch: [page, search] }
)
const loading = computed(() => status.value === 'pending')
```

- Always provide a unique string key to `useLazyAsyncData`
- Derive `loading` from `status` — never a separate boolean flag for fetch state

---

## Components

All components use `<script setup>` with @nuxt/ui primitives. Standard card/modal layout:

```vue
<template>
  <UModal v-model:open="open">
    <template #content>
      <div class="p-4 space-y-4">
        <!-- content -->
      </div>
      <!-- sticky footer -->
      <div class="sticky bottom-0 border-t border-default bg-default flex gap-2 p-3">
        <UButton variant="ghost" @click="open = false">Cancel</UButton>
        <UButton @click="emit('submit')">Submit</UButton>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
const props = defineProps<{ mode?: 'view' | 'edit' }>()
const emit = defineEmits<{ close: []; success: [id: string] }>()
</script>
```

- Use `defineModel()` for two-way binding in input components (Vue 3.4+)
- Emits: `close` to dismiss, `success` with relevant data on completion
- **No `v-row`/`v-col`** — use Tailwind `flex`, `grid`, or `space-y-*` for layout
- **Always use semantic colors**: `text-default`, `bg-elevated`, `border-muted`, etc.
  Never raw Tailwind palette colors like `text-gray-500`

---

## Forms and Validation

Forms use `UForm` with a Zod schema for validation. Zod is the validation library
everywhere in the frontend — never Joi (that's backend-only).

```vue
<template>
  <UForm :schema="schema" :state="form" @submit="onSubmit">
    <UFormField label="Name" name="name">
      <UInput v-model="form.name" />
    </UFormField>
    <UFormField label="Host" name="host">
      <UInput v-model="form.host" />
    </UFormField>
    <UButton type="submit">Submit</UButton>
  </UForm>
</template>

<script setup lang="ts">
import { z } from 'zod'

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  host: z.string().min(1, 'Host is required'),
})

const form = reactive({ name: '', host: '' })

async function onSubmit(event: FormSubmitEvent<typeof schema>) {
  // event.data is the validated, typed form data
}
</script>
```

- **Route params:** Zod `safeParse` in middleware
- **Forms:** `UForm` with `z.object(...)` schema
- **No Joi** — Joi is backend-only

---

## Resource CRUD Pattern (Form + Main Components)

Every resource that needs a list view with add/edit/view/delete follows the two-component
pattern. The **Form** component handles form UI and validation; the **Main** component
manages the list, modals, and CRUD state.

### Form Component (`<Resource>Form.vue`)

Renders inside a `UModal`. Supports three modes: `add`, `edit`, and `view`.

```vue
<template>
  <div class="space-y-4 p-4">
    <!-- modal header -->
    <div class="font-semibold text-lg">{{ title }}</div>

    <!-- form fields (readonly when !isMutable) -->
    <UForm :schema="schema" :state="resource" @submit="emit('submit')">
      <UFormField label="Name" name="name">
        <UInput v-model="resource.name" :readonly="!isMutable" />
      </UFormField>
      <!-- more fields... -->

      <!-- error message -->
      <UAlert v-if="message" color="error" variant="soft" :description="message"
        class="mt-2" @close="message = ''" />
    </UForm>

    <!-- sticky footer action bar -->
    <div class="sticky bottom-0 border-t border-default bg-default flex p-3">
      <!-- Cancel / Close (left half) -->
      <UButton class="flex-1" variant="ghost" @click="emit('close')"
        :disabled="props.loading">
        {{ isMutable ? 'Cancel' : 'Close' }}
      </UButton>

      <!-- View mode: More actions menu -->
      <UDropdownMenu v-if="mode === 'view'" :items="moreActions" class="flex-1">
        <UButton class="w-full" color="neutral">More actions</UButton>
      </UDropdownMenu>

      <!-- Add/Edit mode: Submit button (right half) -->
      <UButton v-if="isMutable" class="flex-1" @click="emit('submit')"
        :loading="props.loading">
        {{ submitTitle }}
      </UButton>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  title?: string
  mode?: 'add' | 'edit' | 'view'
  loading?: boolean
}>()
const emit = defineEmits<{ close: []; submit: []; edit: []; delete: [] }>()

const isMutable = computed(() => !props.mode || ['add', 'edit'].includes(props.mode))
const submitTitle = computed(() => props.mode === 'edit' ? 'Save changes' : 'Submit')
const message = defineModel<string>('message', { default: '' })
const resource = defineModel<TResource>({ required: true })

const moreActions = computed(() => [[
  { label: 'Edit', onSelect: () => emit('edit') },
  { label: 'Delete', class: 'text-error', onSelect: () => emit('delete') },
]])
</script>
```

Key rules:

- `defineModel()` for two-way binding of the resource object and error `message`
- `isMutable` controls `:readonly` on fields and which footer action renders
- The form never calls API functions — it only emits events
- Error alert sits above the sticky footer, inside the scrollable area
- Action bar has exactly two slots (Cancel + Submit, or Close + More actions)

### Main Component (`<Resource>Main.vue`)

Manages the data table, all CRUD modals, and state transitions.

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
      <div class="flex justify-end p-2">
        <UPagination v-model:page="page" :total="totalPages * pageSize" :page-size="pageSize" />
      </div>
    </UCard>

    <!-- Add modal -->
    <UModal v-model:open="openAdd">
      <template #content>
        <ServerForm
          v-model="resource"
          v-model:message="message"
          title="Add Server"
          mode="add"
          :loading="loadingForm"
          @close="setItem({ mode: 'add' })"
          @submit="submitAdd"
        />
      </template>
    </UModal>

    <!-- View/Preview modal -->
    <UModal v-model:open="openPreview">
      <template #content>
        <ServerForm
          v-model="resource"
          title="Server Details"
          mode="view"
          @close="setItem({ mode: 'view' })"
          @edit="handleEdit(true)"
          @delete="setDeleteModal(true)"
        />
      </template>
    </UModal>

    <!-- Edit modal -->
    <UModal v-model:open="openEdit">
      <template #content>
        <ServerForm
          v-model="resource"
          v-model:message="message"
          title="Edit Server"
          mode="edit"
          :loading="loadingForm"
          @close="setItem({ mode: 'edit' })"
          @submit="submitEdit"
        />
      </template>
    </UModal>

    <!-- Delete confirmation modal -->
    <UModal v-model:open="openDelete">
      <template #content>
        <ConfirmationPrompt
          title="Delete Server"
          action="Delete"
          content="Are you sure you want to delete this server?"
          v-model:message="message"
          :disabled="loadingForm"
          @cancel="setDeleteModal()"
          @confirm="submitDelete"
        />
      </template>
    </UModal>
  </div>
</template>
```

**Script conventions — dialog and state management:**

```typescript
const { server, getAll, add, updateById, deleteById } = useServer()
const resource = ref({ ...server.value })
const resourceId = computed(() => resource.value._id ?? '')

const openAdd = ref(false)
const openPreview = ref(false)
const openEdit = ref(false)
const openDelete = ref(false)
const loadingForm = ref(false)
const message = ref('')

// Central state setter — resets the resource, message, and opens/closes the right modal
function setItem({
  value = { ...server.value },
  mode = '',
  open = false,
} = {}) {
  Object.assign(resource.value, JSON.parse(JSON.stringify(value)))
  message.value = ''

  if (mode === 'add') openAdd.value = open
  if (mode === 'view') openPreview.value = open
  if (mode === 'edit') openEdit.value = open
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

**CRUD submit functions — exact shape:**

```typescript
async function submitAdd() {
  loadingForm.value = true
  message.value = ''
  try {
    await add({ name: resource.value.name, host: resource.value.host, /* fields */ })
    setItem({ mode: 'add' }) // closes modal + resets state
    await refresh()
  } catch (error: any) {
    message.value = error?.data?.message ?? 'Failed to add server.'
  } finally {
    loadingForm.value = false
  }
}

async function submitEdit() {
  loadingForm.value = true
  message.value = ''
  try {
    await updateById(resourceId.value, { name: resource.value.name, /* fields */ })
    await refresh()
    setItem({ mode: 'edit' })
  } catch (error: any) {
    message.value = error?.data?.message ?? 'Failed to update server.'
  } finally {
    loadingForm.value = false
  }
}

async function submitDelete() {
  loadingForm.value = true
  message.value = ''
  try {
    await deleteById(resourceId.value)
    await refresh()
    setItem({ mode: 'view' })
    openDelete.value = false
  } catch (error: any) {
    message.value = error?.data?.message ?? 'Failed to delete server.'
  } finally {
    loadingForm.value = false
  }
}
```

Key rules:

- **One `setItem` function** manages all modal open/close and resource state resets — never toggle modal refs individually
- `setItem({ mode: 'add' })` with no `open` param defaults to `false`, closing the modal
- Error messages are extracted from `error?.data?.message` with a fallback string
- Submit functions always: set `loadingForm = true` → clear `message` → try/catch → call `setItem` to close → `refresh()` → set `loadingForm = false` in `finally`

### Operation / Action Dialogs (non-CRUD forms)

The same single-setter convention applies to any dialog that hosts a form. Each
operation dialog gets **one `set<Action>` function** that resets the form to a fresh
default, clears the message, and toggles the modal.

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
  deployLoading.value = true
  deployMessage.value = ''
  try {
    await deploy(appId, deployForm.value)
    setDeploy() // closes + resets
    await refresh()
  } catch (error: any) {
    deployMessage.value = error?.data?.message ?? 'Deployment failed.'
  } finally {
    deployLoading.value = false
  }
}
```

- **One `set<Action>({ open })` per operation modal** — always resets form + message
- `set<Action>({ open: true })` opens with a clean form; `set<Action>()` closes + resets
- Never set the modal ref directly (`openDeploy.value = true`)

---

## What Not To Do

- **No Pinia or Vuex** — state is `useState` + composable refs
- **No direct fetch/axios** — always use `useNuxtApp().$api`
- **No Joi in the frontend** — Zod only (backend uses Joi)
- **No `<Options API>`** — all components use `<script setup>`
- **No business logic in pages** — delegate to composables
- **No `interface` for resource types** — use `declare type T<Resource>`
- **No `v-row`/`v-col`** — this is not Vuetify; use Tailwind `flex`/`grid` for layout
- **No raw Tailwind palette colors** (`text-gray-500`) — always semantic UI colors
  (`text-muted`, `text-default`, `bg-elevated`, `border-muted`)
- **No direct modal toggling** — never set a modal ref like `open.value = true/false`;
  route every open/close through the resource's `setItem` or the operation's `set<Action>`
  so the form is always reset (otherwise fields persist stale values on reopen)
- **No bare `<img>` for remote images** — use `<NuxtImg>` (`@nuxt/image`) so images
  are optimized; show a `USkeleton` while loading
