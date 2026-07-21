# Development Guide

Local development setup for Control Plane.

## Prerequisites

- **Node.js** 20+
- **Yarn** 1.x (for API)
- **pnpm** 9+ (for Web)
- **Docker** and **Docker Compose**
- **MongoDB** (local or Atlas)
- **Redis**

---

## Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/your-org/control-plane.git
cd control-plane
```

### 2. Start Infrastructure

```bash
# Start MongoDB and Redis containers
cd control-plane-api
docker compose -f docker-compose.test.yml up -d
```

### 3. Setup API

```bash
cd control-plane-api

# Install dependencies
yarn install

# Create .env file
cp .env.example .env
# Edit .env with your settings

# Start development server
yarn dev
```

### 4. Setup Web

```bash
cd control-plane-web

# Install dependencies
pnpm install

# Start development server
pnpm dev
```

### 5. Access

- **Web UI**: http://localhost:3000
- **API**: http://localhost:3001
- **API Docs**: http://localhost:3001/api/v1

---

## API Development

### Directory Structure

```
control-plane-api/
├── src/
│   ├── resources/           # Resource modules (CRUD)
│   │   ├── app/
│   │   │   ├── app.model.ts
│   │   │   ├── app.repository.ts
│   │   │   ├── app.service.ts
│   │   │   ├── app.controller.ts
│   │   │   └── index.ts
│   │   ├── database/
│   │   ├── node/
│   │   └── ...
│   ├── routes/              # Express routes
│   ├── services/            # Shared services
│   ├── utils/               # Utilities
│   ├── workers/             # Background workers
│   ├── app.ts               # Express app
│   ├── config.ts            # Configuration
│   ├── server.ts            # Entry point
│   └── setup.ts             # Initialization
├── test/                    # Test files
├── ansible/                 # Ansible playbooks
├── k8s/                     # K8s manifests
└── scripts/                 # Utility scripts
```

### Environment Variables

Create `control-plane-api/.env`:

```env
# MongoDB
MONGODB_URI=mongodb://localhost:27017
MONGO_DB=control_plane

# Redis
REDIS_URL=redis://localhost:6379

# Server
PORT=3001
SECRET_KEY=dev-secret-key-change-in-production

# JWT
ACCESS_TOKEN_SECRET=dev-access-token-secret
REFRESH_TOKEN_SECRET=dev-refresh-token-secret
ACCESS_TOKEN_EXPIRY=15m
REFRESH_TOKEN_EXPIRY=30d

# Session
SESSION_TTL_SECONDS=14400

# Cookie
COOKIE_SAMESITE=lax
COOKIE_DOMAIN=localhost

# Kubernetes (optional for local dev)
K8S_ENABLED=false
# K8S_KUBECONFIG=/path/to/kubeconfig
```

### Commands

```bash
# Development (hot reload)
yarn dev

# Build
yarn build

# Production
yarn start

# Lint
yarn lint

# Tests
yarn test           # All tests
yarn test:unit      # Unit tests only
yarn test:watch     # Watch mode
yarn test:app       # App tests only
yarn test:database  # Database tests only
```

### Creating a New Resource

1. **Create directory**: `src/resources/widget/`

2. **Create model** (`widget.model.ts`):
```typescript
import Joi from 'joi'
import { BadRequestError } from '../../utils/error'

export const widgetStatuses = ['active', 'inactive'] as const
export type TWidgetStatus = typeof widgetStatuses[number]

export type TWidget = {
  _id: string
  name: string
  status: TWidgetStatus
  createdAt: Date
  updatedAt: Date
}

const schemaWidgetBase = {
  name: Joi.string().min(1).max(100).required(),
}

export const schemaWidgetCreate = Joi.object(schemaWidgetBase)
export const schemaWidgetUpdate = Joi.object({
  name: Joi.string().min(1).max(100),
})

export function modelWidget(data: Partial<TWidget>): Omit<TWidget, '_id'> {
  const { error, value } = schemaWidgetCreate.validate(data)
  if (error) throw new BadRequestError(error.message)
  
  return {
    name: value.name,
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}
```

3. **Create repository** (`widget.repository.ts`):
```typescript
import { ObjectId } from 'mongodb'
import { useRepo } from '../../utils/repo'
import { makeCacheKey } from '../../utils/make-cache-key'
import { paginate } from '../../utils/paginate'
import { BadRequestError, NotFoundError } from '../../utils/error'
import type { TWidget } from './widget.model'

const namespace = 'cp_widgets'
const repo = useRepo(namespace)

export function useWidgetRepo() {
  async function createIndexes() {
    await repo.collection.createIndexes([
      { key: { name: 1 }, unique: true },
      { key: { status: 1 } },
      { key: { createdAt: -1 } },
    ])
  }

  async function getAll({ page = 1, search = '' } = {}) {
    const cacheKey = makeCacheKey(namespace, { page, search, tag: 'getAll' })
    const cached = await repo.getCache<any>(cacheKey)
    if (cached) return cached

    const query: Record<string, any> = {}
    if (search) query.name = { $regex: search, $options: 'i' }

    const limit = 20
    const skip = (page - 1) * limit
    const [items, total] = await Promise.all([
      repo.collection.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
      repo.collection.countDocuments(query),
    ])
    const result = paginate(items, page, limit, total)
    repo.setCache(cacheKey, result, 600)
    return result
  }

  async function getById(id: string) {
    let oid: ObjectId
    try { oid = new ObjectId(id) } catch { throw new BadRequestError('Invalid widget ID') }

    const cacheKey = makeCacheKey(namespace, { id, tag: 'by-id' })
    const cached = await repo.getCache<TWidget>(cacheKey)
    if (cached) return cached

    const widget = await repo.collection.findOne({ _id: oid })
    if (!widget) throw new NotFoundError('Widget not found')
    repo.setCache(cacheKey, widget, 600)
    return widget as unknown as TWidget
  }

  async function add(data: Omit<TWidget, '_id'>) {
    const result = await repo.collection.insertOne(data as any)
    repo.delCachedData()
    return result.insertedId.toString()
  }

  async function updateById(id: string, data: Partial<TWidget>) {
    let oid: ObjectId
    try { oid = new ObjectId(id) } catch { throw new BadRequestError('Invalid widget ID') }
    const result = await repo.collection.updateOne(
      { _id: oid },
      { $set: { ...data, updatedAt: new Date() } }
    )
    if (!result.matchedCount) throw new NotFoundError('Widget not found')
    repo.delCachedData()
  }

  async function deleteById(id: string) {
    let oid: ObjectId
    try { oid = new ObjectId(id) } catch { throw new BadRequestError('Invalid widget ID') }
    const result = await repo.collection.deleteOne({ _id: oid })
    if (!result.deletedCount) throw new NotFoundError('Widget not found')
    repo.delCachedData()
  }

  return { createIndexes, getAll, getById, add, updateById, deleteById }
}
```

4. **Create controller** (`widget.controller.ts`):
```typescript
import { Request, Response, NextFunction } from 'express'
import { schemaWidgetCreate, schemaWidgetUpdate, modelWidget } from './widget.model'
import { useWidgetRepo } from './widget.repository'
import { BadRequestError } from '../../utils/error'

export function useWidgetController() {
  const repo = useWidgetRepo()

  async function list(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await repo.getAll({
        page: Number(req.query.page) || 1,
        search: String(req.query.search || ''),
      })
      res.json(result)
    } catch (error) { next(error) }
  }

  async function getById(req: Request, res: Response, next: NextFunction) {
    try {
      const widget = await repo.getById(req.params.id)
      res.json(widget)
    } catch (error) { next(error) }
  }

  async function add(req: Request, res: Response, next: NextFunction) {
    try {
      const { error } = schemaWidgetCreate.validate(req.body)
      if (error) { next(new BadRequestError(error.message)); return }
      const data = modelWidget(req.body)
      const id = await repo.add(data)
      res.status(201).json({ message: 'Widget created', widgetId: id })
    } catch (error) { next(error) }
  }

  async function updateById(req: Request, res: Response, next: NextFunction) {
    try {
      const { error, value } = schemaWidgetUpdate.validate(req.body)
      if (error) { next(new BadRequestError(error.message)); return }
      await repo.updateById(req.params.id, value)
      res.json({ message: 'Widget updated' })
    } catch (error) { next(error) }
  }

  async function deleteById(req: Request, res: Response, next: NextFunction) {
    try {
      await repo.deleteById(req.params.id)
      res.json({ message: 'Widget deleted' })
    } catch (error) { next(error) }
  }

  return { list, getById, add, updateById, deleteById }
}
```

5. **Create barrel** (`index.ts`):
```typescript
export * from './widget.model'
export * from './widget.repository'
export * from './widget.controller'
```

6. **Create route** (`src/routes/widgets.route.ts`):
```typescript
import express from 'express'
import { requireAuth, requireScope } from '../utils'
import { useWidgetController } from '../resources/widget'

const router = express.Router()
const controller = useWidgetController()

router.get('/', requireAuth, requireScope('settings:read'), controller.list)
router.post('/', requireAuth, requireScope('settings:write'), controller.add)
router.get('/:id', requireAuth, requireScope('settings:read'), controller.getById)
router.patch('/:id', requireAuth, requireScope('settings:write'), controller.updateById)
router.delete('/:id', requireAuth, requireScope('settings:write'), controller.deleteById)

export default router
```

7. **Register route** in `src/routes/index.ts`:
```typescript
import widgets from './widgets.route'
router.use('/widgets', widgets)
```

8. **Register indexes** in `src/setup.ts`:
```typescript
import { useWidgetRepo } from './resources/widget'

export async function createAllIndexes() {
  await useWidgetRepo().createIndexes()
  // ... other repos
}
```

---

## Web Development

### Directory Structure

```
control-plane-web/
├── app/
│   ├── assets/css/          # Styles
│   ├── components/          # Vue components
│   ├── composables/         # Data fetching
│   ├── layouts/             # Nuxt layouts
│   ├── middleware/          # Route middleware
│   ├── pages/               # File-based routes
│   ├── plugins/             # Nuxt plugins
│   ├── types/               # TypeScript types
│   ├── app.vue              # Root component
│   └── app.config.ts        # App config
├── public/                  # Static assets
├── server/                  # Server routes
└── nuxt.config.ts           # Nuxt configuration
```

### Commands

```bash
# Development (hot reload)
pnpm dev

# Build
pnpm build

# Preview production build
pnpm preview

# Type checking
pnpm typecheck

# Lint
pnpm lint
```

### Creating a New Page

1. **Create type** (`app/types/widget.d.ts`):
```typescript
declare type TWidget = {
  _id: string
  name: string
  status: 'active' | 'inactive'
  createdAt: string
  updatedAt: string
}

declare type TWidgetForm = Pick<TWidget, 'name'>
```

2. **Create composable** (`app/composables/useWidget.ts`):
```typescript
export default function useWidget() {
  const widget = ref<TWidget>({
    _id: '',
    name: '',
    status: 'active',
    createdAt: '',
    updatedAt: '',
  })

  function getAll(options: { page?: number; search?: string } = {}) {
    return useNuxtApp().$api<{ items: TWidget[]; pages: number; total: number }>('/widgets', {
      method: 'GET',
      query: { page: options.page ?? 1, search: options.search ?? '' },
    })
  }

  function getById(id: string) {
    return useNuxtApp().$api<TWidget>(`/widgets/${id}`, { method: 'GET' })
  }

  function add(data: TWidgetForm) {
    return useNuxtApp().$api<{ message: string; widgetId: string }>('/widgets', {
      method: 'POST',
      body: data,
    })
  }

  function updateById(id: string, data: Partial<TWidgetForm>) {
    return useNuxtApp().$api<{ message: string }>(`/widgets/${id}`, {
      method: 'PATCH',
      body: data,
    })
  }

  function deleteById(id: string) {
    return useNuxtApp().$api<{ message: string }>(`/widgets/${id}`, { method: 'DELETE' })
  }

  return { widget, getAll, getById, add, updateById, deleteById }
}
```

3. **Create form component** (`app/components/WidgetForm.vue`):
```vue
<template>
  <div class="space-y-4 p-4">
    <div class="font-semibold text-lg">
      {{ mode === 'add' ? 'Add Widget' : mode === 'edit' ? 'Edit Widget' : 'Widget Details' }}
    </div>

    <UForm :schema="schema" :state="form" @submit="emit('submit')">
      <UFormField label="Name" name="name">
        <UInput v-model="form.name" :readonly="mode === 'view'" />
      </UFormField>

      <UAlert v-if="error" color="error" variant="soft" :description="error" class="mt-4" />
    </UForm>

    <div class="sticky bottom-0 border-t border-default bg-default flex gap-2 p-3">
      <UButton variant="ghost" class="flex-1" @click="emit('close')">
        {{ mode === 'view' ? 'Close' : 'Cancel' }}
      </UButton>
      <UButton v-if="mode !== 'view'" class="flex-1" :loading="loading" @click="emit('submit')">
        {{ mode === 'add' ? 'Create' : 'Save' }}
      </UButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { z } from 'zod'

const props = defineProps<{
  mode: 'add' | 'edit' | 'view'
  widget?: TWidget
  loading?: boolean
  error?: string
}>()

const emit = defineEmits<{
  close: []
  submit: []
}>()

const schema = z.object({
  name: z.string().min(1, 'Required'),
})

const form = ref<TWidgetForm>({
  name: props.widget?.name ?? '',
})

watch(() => props.widget, (w) => {
  if (w) form.value = { name: w.name }
})

defineExpose({ form })
</script>
```

4. **Create page** (`app/pages/dashboard/widgets/index.vue`):
```vue
<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h2 class="text-xl font-semibold">Widgets</h2>
      <UButton icon="i-lucide-plus" @click="setItem({ mode: 'add', open: true })">
        Add Widget
      </UButton>
    </div>

    <UCard>
      <UTable :rows="items" :columns="columns" :loading="loading" @row-click="handleRowClick" />
      <div class="flex justify-end p-2">
        <UPagination v-model:page="page" :total="total" :page-size="pageSize" />
      </div>
    </UCard>

    <!-- Add Modal -->
    <UModal v-model:open="openAdd">
      <template #content>
        <WidgetForm ref="addFormRef" mode="add" :loading="formLoading" :error="formError" @close="openAdd = false" @submit="submitAdd" />
      </template>
    </UModal>

    <!-- Edit Modal -->
    <UModal v-model:open="openEdit">
      <template #content>
        <WidgetForm ref="editFormRef" mode="edit" :widget="selectedWidget" :loading="formLoading" :error="formError" @close="openEdit = false" @submit="submitEdit" />
      </template>
    </UModal>

    <!-- Delete Modal -->
    <UModal v-model:open="openDelete">
      <template #content>
        <ConfirmationPrompt
          title="Delete Widget"
          :description="`Delete widget '${selectedWidget?.name}'? This cannot be undone.`"
          confirm-text="Delete"
          :loading="formLoading"
          @cancel="openDelete = false"
          @confirm="submitDelete"
        />
      </template>
    </UModal>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'default' })

const { getAll, add, updateById, deleteById } = useWidget()
const toast = useToast()

const page = ref(1)
const pageSize = 20
const items = ref<TWidget[]>([])
const total = ref(0)
const loading = ref(false)

const openAdd = ref(false)
const openEdit = ref(false)
const openDelete = ref(false)
const selectedWidget = ref<TWidget | null>(null)
const formLoading = ref(false)
const formError = ref('')

const addFormRef = ref()
const editFormRef = ref()

const columns = [
  { key: 'name', label: 'Name' },
  { key: 'status', label: 'Status' },
  { key: 'createdAt', label: 'Created' },
]

async function fetchData() {
  loading.value = true
  try {
    const data = await getAll({ page: page.value })
    items.value = data.items
    total.value = data.total
  } catch (err: any) {
    toast.add({ title: err.data?.message || 'Failed to load widgets', color: 'error' })
  } finally {
    loading.value = false
  }
}

function setItem({ mode, open, widget }: { mode: string; open: boolean; widget?: TWidget }) {
  selectedWidget.value = widget || null
  formError.value = ''
  if (mode === 'add') openAdd.value = open
  else if (mode === 'edit') openEdit.value = open
  else if (mode === 'delete') openDelete.value = open
}

function handleRowClick(row: TWidget) {
  setItem({ mode: 'edit', open: true, widget: row })
}

async function submitAdd() {
  formLoading.value = true
  formError.value = ''
  try {
    await add(addFormRef.value.form)
    toast.add({ title: 'Widget created', color: 'success' })
    openAdd.value = false
    fetchData()
  } catch (err: any) {
    formError.value = err.data?.message || 'Failed to create widget'
  } finally {
    formLoading.value = false
  }
}

async function submitEdit() {
  if (!selectedWidget.value) return
  formLoading.value = true
  formError.value = ''
  try {
    await updateById(selectedWidget.value._id, editFormRef.value.form)
    toast.add({ title: 'Widget updated', color: 'success' })
    openEdit.value = false
    fetchData()
  } catch (err: any) {
    formError.value = err.data?.message || 'Failed to update widget'
  } finally {
    formLoading.value = false
  }
}

async function submitDelete() {
  if (!selectedWidget.value) return
  formLoading.value = true
  try {
    await deleteById(selectedWidget.value._id)
    toast.add({ title: 'Widget deleted', color: 'success' })
    openDelete.value = false
    fetchData()
  } catch (err: any) {
    toast.add({ title: err.data?.message || 'Failed to delete widget', color: 'error' })
  } finally {
    formLoading.value = false
  }
}

watch(page, fetchData)
onMounted(fetchData)
</script>
```

---

## Testing

### API Tests

```bash
cd control-plane-api

# Start test infrastructure
./test.sh setup

# Run all tests
yarn test

# Run specific test file
yarn test test/app.service.spec.ts

# Watch mode
yarn test:watch

# Cleanup
./test.sh teardown
```

### Writing Tests

```typescript
// test/widget.spec.ts
import { expect } from 'chai'
import { useWidgetRepo } from '../src/resources/widget'

describe('Widget Repository', () => {
  const repo = useWidgetRepo()

  beforeEach(async () => {
    // Clean up before each test
  })

  describe('add', () => {
    it('should create a widget', async () => {
      const id = await repo.add({
        name: 'Test Widget',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      expect(id).to.be.a('string')
      expect(id).to.have.length(24)
    })
  })

  describe('getById', () => {
    it('should return widget by ID', async () => {
      const id = await repo.add({ name: 'Test', status: 'active', createdAt: new Date(), updatedAt: new Date() })
      const widget = await repo.getById(id)
      expect(widget.name).to.equal('Test')
    })

    it('should throw NotFoundError for invalid ID', async () => {
      try {
        await repo.getById('507f1f77bcf86cd799439011')
        expect.fail('Should have thrown')
      } catch (err: any) {
        expect(err.statusCode).to.equal(404)
      }
    })
  })
})
```

---

## Debugging

### API Debugging

```bash
# Enable debug logging
DEBUG=* yarn dev

# Or specific namespaces
DEBUG=express:* yarn dev
```

### VS Code Launch Configuration

```json
// .vscode/launch.json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug API",
      "runtimeExecutable": "yarn",
      "runtimeArgs": ["dev"],
      "cwd": "${workspaceFolder}/control-plane-api",
      "console": "integratedTerminal"
    },
    {
      "type": "chrome",
      "request": "launch",
      "name": "Debug Web",
      "url": "http://localhost:3000",
      "webRoot": "${workspaceFolder}/control-plane-web"
    }
  ]
}
```

---

## Code Style

### API (TypeScript)

- Use `async/await` over callbacks
- Always type function parameters and return values
- Use typed errors from `src/utils/error.ts`
- Follow the 4-layer resource pattern

### Web (Vue + TypeScript)

- Use `<script setup>` syntax
- Use composables for data fetching
- Use Zod for form validation
- Use `ref`/`reactive` for local state
- Use `useState` for global state

### Formatting

Both projects use Prettier and ESLint:

```bash
# API
cd control-plane-api && yarn lint

# Web
cd control-plane-web && pnpm lint
```
