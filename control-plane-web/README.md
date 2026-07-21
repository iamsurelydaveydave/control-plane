# control-plane-web

Nuxt 4 + @nuxt/ui + Tailwind CSS frontend for the Control Plane dashboard.

## Setup

### Prerequisites

- Node.js 20+
- pnpm 9+

### Installation

```bash
cd control-plane-web
pnpm install
```

### Development

```bash
# Start dev server (http://localhost:3000)
pnpm dev

# Build for production
pnpm build

# Preview production build
pnpm preview

# Type checking
pnpm typecheck

# Linting
pnpm lint
```

### Environment

The frontend proxies API requests to the backend. Configure via `nuxt.config.ts` route rules or environment:

```env
# API URL (proxied in production via Caddy)
NUXT_PUBLIC_API_URL=/api
```

---

## Project Structure

```
app/
├── assets/
│   └── css/
│       └── main.css          # Tailwind + @nuxt/ui imports
├── components/               # Shared UI components
│   ├── AppForm.vue           # App create/edit form
│   ├── AppShell.vue          # Main layout wrapper
│   ├── ConfirmDialog.vue     # Generic confirmation dialog
│   ├── ConfirmationPrompt.vue # Destructive action confirmation
│   ├── DatabaseForm.vue      # Database create/edit form
│   ├── DeploymentHistory.vue # Deployment history list
│   ├── NodeForm.vue          # Node create/edit form
│   ├── NodeProvisionForm.vue # Node provisioning wizard
│   ├── NodeProvisioningStatus.vue # Provisioning progress
│   ├── ProvisionLog.vue      # Live provisioning logs
│   └── ServerForm.vue        # Server form (legacy)
├── composables/              # Data fetching + business logic
│   ├── useAPIToken.ts        # API token management
│   ├── useApp.ts             # App CRUD + operations
│   ├── useAuth.ts            # Authentication
│   ├── useCluster.ts         # Cluster management
│   ├── useDatabase.ts        # Database CRUD + operations
│   ├── useMetrics.ts         # Dashboard metrics
│   ├── useNode.ts            # Node CRUD + operations
│   ├── useSecret.ts          # Secret management
│   ├── useServer.ts          # Server management (legacy)
│   ├── useSettings.ts        # Platform settings
│   ├── useSetup.ts           # Initial setup
│   └── useSSHKey.ts          # SSH key management
├── layouts/
│   └── default.vue           # Main layout with sidebar
├── middleware/
│   └── 01.auth.ts            # Auth guard middleware
├── pages/
│   ├── index.vue             # Redirect to dashboard
│   ├── login.vue             # Login page
│   ├── setup.vue             # Initial setup wizard
│   └── dashboard/
│       ├── index.vue         # Dashboard overview
│       ├── monitoring.vue    # Metrics & monitoring
│       ├── apps/             # App management pages
│       ├── databases/        # Database management pages
│       ├── nodes/            # Node management pages
│       ├── servers/          # Server pages (legacy)
│       └── settings/         # Settings pages
├── plugins/
│   ├── api.ts                # $api fetch instance
│   └── secure.client.ts      # Client-side auth guard
├── types/
│   └── *.d.ts                # TypeScript declarations
├── app.vue                   # Root component (wraps <UApp>)
└── app.config.ts             # App configuration
```

---

## Composables

All data fetching and state logic lives in composables. Each composable returns reactive refs and API functions.

### Pattern

```typescript
// app/composables/useApp.ts
export default function useApp() {
  const app = ref<TApp>({ _id: '', name: '', image: '', status: 'stopped', ... })

  function getAll(options: { page?: number; search?: string } = {}) {
    return useNuxtApp().$api<{ items: TApp[]; pages: number }>('/apps', {
      method: 'GET',
      query: { page: options.page ?? 1, search: options.search ?? '' }
    })
  }

  function deploy(id: string, options: { version?: string } = {}) {
    return useNuxtApp().$api<{ message: string }>(`/apps/${id}/deploy`, {
      method: 'POST',
      body: options
    })
  }

  return { app, getAll, deploy, ... }
}
```

### Available Composables

| Composable | Purpose |
|------------|---------|
| `useApp()` | App CRUD, deploy, stop, start, restart, scale |
| `useDatabase()` | Database CRUD, TLS, backups, credentials |
| `useCluster()` | Cluster management |
| `useNode()` | Node CRUD, provision, cordon, drain |
| `useAuth()` | Login, logout, current user |
| `useSettings()` | DNS, K8s, platform settings |
| `useSSHKey()` | SSH key generation and import |
| `useAPIToken()` | API token management |
| `useSecret()` | Secret management |
| `useMetrics()` | Dashboard metrics |
| `useSetup()` | Initial platform setup |

---

## TypeScript Types

Global types in `app/types/*.d.ts` are auto-imported by Nuxt:

```typescript
// app/types/app.d.ts
declare type TApp = {
  _id: string
  name: string
  image: string
  replicas: number
  status: 'stopped' | 'running' | 'deploying' | 'error'
  // ...
}

declare type TAppForm = Omit<TApp, '_id' | 'status' | 'createdAt' | 'updatedAt'>
```

### Naming Conventions

| Type | Pattern | Example |
|------|---------|---------|
| Resource | `T<Resource>` | `TApp`, `TDatabase`, `TNode` |
| Form payload | `T<Resource>Form` | `TAppForm`, `TDatabaseForm` |
| List response | `{ items: T[]; pages: number }` | — |

---

## Components

### Form + Main Pattern

Pages with CRUD tables follow the two-component pattern:

1. **Main Component** (`<Resource>Main.vue`) — Table, modals, state management
2. **Form Component** (`<Resource>Form.vue`) — Add/edit/view form

```vue
<!-- ResourceMain.vue -->
<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h2 class="text-xl font-semibold">Resources</h2>
      <UButton icon="i-lucide-plus" @click="setItem({ mode: 'add', open: true })">
        Add Resource
      </UButton>
    </div>

    <UCard>
      <UTable :rows="items" :columns="columns" :loading="loading" />
      <div class="flex justify-end p-2">
        <UPagination v-model:page="page" :total="totalPages * pageSize" :page-size="pageSize" />
      </div>
    </UCard>

    <!-- Add Modal -->
    <UModal v-model:open="openAdd">
      <template #content>
        <ResourceForm mode="add" @close="openAdd = false" @submit="submitAdd" />
      </template>
    </UModal>

    <!-- Edit Modal -->
    <UModal v-model:open="openEdit">
      <template #content>
        <ResourceForm mode="edit" :resource="resource" @close="openEdit = false" @submit="submitEdit" />
      </template>
    </UModal>
  </div>
</template>
```

### Confirmation Pattern

All destructive actions use `ConfirmationPrompt`:

```vue
<UModal v-model:open="openDelete">
  <template #content>
    <ConfirmationPrompt
      title="Delete Resource"
      description="Are you sure? This cannot be undone."
      confirm-text="Delete"
      :loading="deleting"
      @cancel="openDelete = false"
      @confirm="submitDelete"
    />
  </template>
</UModal>
```

---

## API Communication

All HTTP calls go through `$api` (defined in `app/plugins/api.ts`):

```typescript
// GET with query params
const { data } = await useNuxtApp().$api<{ items: TApp[] }>('/apps', {
  method: 'GET',
  query: { page: 1, search: 'web' }
})

// POST with body
await useNuxtApp().$api('/apps', {
  method: 'POST',
  body: { name: 'my-app', image: 'nginx:latest' }
})

// DELETE
await useNuxtApp().$api(`/apps/${id}`, { method: 'DELETE' })
```

### Error Handling

API errors are caught and can be displayed via toast:

```typescript
try {
  await useNuxtApp().$api('/apps', { method: 'POST', body: form })
  toast.add({ title: 'App created', color: 'success' })
} catch (err: any) {
  toast.add({ title: err.data?.message || 'Failed', color: 'error' })
}
```

---

## State Management

No Pinia. Use Nuxt's `useState` for global state:

```typescript
// Shared state (survives navigation)
const currentUser = useState<TUser | null>('currentUser', () => null)

// Local state (component-scoped)
const loading = ref(false)
```

---

## Forms and Validation

Forms use `UForm` with Zod schemas:

```vue
<template>
  <UForm :schema="schema" :state="form" @submit="onSubmit">
    <UFormField label="Name" name="name">
      <UInput v-model="form.name" />
    </UFormField>
    <UFormField label="Image" name="image">
      <UInput v-model="form.image" placeholder="nginx:latest" />
    </UFormField>
    <UButton type="submit">Create</UButton>
  </UForm>
</template>

<script setup lang="ts">
import { z } from 'zod'

const schema = z.object({
  name: z.string().min(1, 'Required'),
  image: z.string().min(1, 'Required'),
})

const form = ref({ name: '', image: '' })

async function onSubmit() {
  // form is validated, submit to API
}
</script>
```

---

## Layouts

### Default Layout

The default layout provides the main app shell with sidebar navigation:

```vue
<!-- app/layouts/default.vue -->
<template>
  <AppShell>
    <slot />
  </AppShell>
</template>
```

### AppShell

The `AppShell` component provides:
- Responsive sidebar with navigation
- Header with user menu
- Main content area

---

## Pages

### Authentication

- `/login` — Login form
- `/setup` — Initial platform setup (first admin user)

### Dashboard

- `/dashboard` — Overview with metrics
- `/dashboard/monitoring` — Detailed metrics
- `/dashboard/apps` — App management
- `/dashboard/databases` — Database management
- `/dashboard/nodes` — Node management
- `/dashboard/settings` — Platform settings

---

## Styling

Uses Tailwind CSS v4 with @nuxt/ui theming:

```css
/* app/assets/css/main.css */
@import "tailwindcss";
@import "@nuxt/ui";
```

### Layout Utilities

```vue
<!-- Flex layouts -->
<div class="flex items-center justify-between">
<div class="flex gap-2">

<!-- Grid layouts -->
<div class="grid grid-cols-3 gap-4">

<!-- Spacing -->
<div class="space-y-4">
<div class="p-4">
```

---

## What Not To Do

- ❌ **No Pinia/Vuex** — use `useState` for global state
- ❌ **No Options API** — `<script setup>` only
- ❌ **No direct fetch** — always use `$api`
- ❌ **No v-row/v-col** — this is Nuxt UI, not Vuetify; use Tailwind flex/grid
- ❌ **No Joi validation** — Zod only on frontend
- ❌ **No inline styles** — use Tailwind classes
