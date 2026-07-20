# control-plane-api (`@control-plane/api`)

Express + MongoDB (Atlas) + TypeScript backend for the Control Plane.

## Agent skills (load before building)

Operational patterns + checklists live in `../.agents/skills/`:

- **`api-core-resource`** — any resource/repository/query/aggregation/route/controller.
  Enforces the layering + the four query non-negotiables (**indexed, cached, properly
  shaped, tested**). This doc is the long-form reference behind it.

---

## Resource Layer Pattern

Each resource lives under `src/resources/<resource-name>/` and follows this structure:

```
resource-name/
  resource.model.ts       # Types, Joi schemas, model<Resource>() factory
  resource.repository.ts  # DB-only: queries, createIndexes(), cache read/invalidate
  resource.service.ts     # Business logic + transactions (OPTIONAL)
  resource.controller.ts  # HTTP: validate req, delegate, next(error)
  index.ts                # Barrel: export * from each layer
```

Strict layering — each layer has exactly one job; respect it at all times:

- **`model`** — models the data and its **schema validation**: TypeScript types, enums,
  Joi schemas, and the `model<Resource>()` factory. The source of truth for a record's
  shape.
- **`repository`** — the **only** layer that touches Mongo: queries, `createIndexes()`,
  and cache read/invalidate. Pure data access — **never build business logic on
  repository functions**.
- **`service`** — the **business logic**: composes repository functions + third-party
  dependencies (hashing, Docker, SSH, …) and owns transactions. Never hits the DB
  directly. **Optional** — add it only when there's real logic to host.
- **`controller`** — HTTP only: validate `req`, delegate, `next(error)`. Holds no
  business logic and runs no raw queries.

---

## Naming Conventions

| Layer      | Pattern                     | Example                                 |
| ---------- | --------------------------- | --------------------------------------- |
| File       | `<resource>.<layer>.ts`     | `server.model.ts`, `app.service.ts`     |
| Type       | `T<Resource>`               | `TServer`, `TApp`, `TDatabase`          |
| Schema     | `schema<Resource>`          | `schemaServer`, `schemaApp`             |
| Model fn   | `model<Resource>()`         | `modelServer()`, `modelApp()`           |
| Repository | `use<Resource>Repo()`       | `useServerRepo()`, `useAppRepo()`       |
| Service    | `use<Resource>Service()`    | `useAppService()`, `useCaddyService()`  |
| Controller | `use<Resource>Controller()` | `useServerController()`                 |

Multi-word resource names use dot notation: `ssh.key.repository.ts`, `api.token.model.ts`.

---

## Error Handling

Always use the typed error classes from `src/utils/error.ts` — never throw a generic
`new Error()`.

```typescript
import { BadRequestError, NotFoundError, ForbiddenError,
         ConflictError, InternalServerError, AppError } from '../../utils/error'
```

- `BadRequestError` — invalid input or violated business rule (400)
- `UnauthorizedError` — not authenticated (401)
- `ForbiddenError` — authenticated but not allowed (403)
- `NotFoundError` — resource does not exist (404)
- `ConflictError` — unique constraint violation (409)
- `InternalServerError` — unexpected system failure (500)
- `AppError` — base class; use `instanceof AppError` to re-throw typed errors as-is

---

## `.model.ts`

```typescript
import Joi from 'joi'

// Enum values as const arrays — feeds both Joi .valid() and TS union types
export const serverStatuses = ['unknown', 'online', 'offline', 'provisioning'] as const
export type TServerStatus = typeof serverStatuses[number]

export type TServer = {
  _id: string
  name: string
  host: string
  status: TServerStatus
  // ...
}

// Shared base, then compose into create / update schemas
const schemaServerBase = {
  name: Joi.string().required(),
  host: Joi.string().required(),
}

export const schemaServerCreate = Joi.object({ ...schemaServerBase })
export const schemaServerUpdate = Joi.object<Partial<TServer>>({
  name: Joi.string(),
  host: Joi.string(),
})

// model<Resource>(): validates → casts ObjectIds → enforces cross-field rules → returns clean object
export function modelServer(data: Partial<TServer>): Omit<TServer, '_id'> {
  const { error, value } = schemaServerCreate.validate(data)
  if (error) throw new BadRequestError(error.message)
  return {
    name: value.name,
    host: value.host,
    status: 'unknown',
  }
}
```

---

## `.repository.ts`

```typescript
import { ObjectId } from 'mongodb'
import { useRepo } from '../../utils/repo'
import { makeCacheKey } from '../../utils/make-cache-key'
import { paginate } from '../../utils/paginate'
import { BadRequestError, NotFoundError } from '../../utils/error'

const namespace_collection = 'cp_servers'
const repo = useRepo(namespace_collection)

export function useServerRepo() {
  async function createIndexes() {
    try {
      await repo.collection.createIndexes([
        { key: { status: 1 } },
        { key: { name: 'text' } },
        { key: { name: 1, status: 1 } },
      ])
    } catch (error) {
      throw new BadRequestError('Failed to create server indexes.')
    }
  }

  async function getAll({ page = 1, search = '', status = '' } = {}) {
    const cacheKey = makeCacheKey(namespace_collection, { page, search, status, tag: 'getAll' })
    const cached = await repo.getCache<Record<string, any>>(cacheKey)
    if (cached) return cached

    const query: Record<string, any> = {}
    if (status) query.status = status
    if (search) query.$text = { $search: search }

    const limit = 20
    const skip = (page > 0 ? page - 1 : 0) * limit
    const [items, total] = await Promise.all([
      repo.collection.find(query).skip(skip).limit(limit).toArray(),
      repo.collection.countDocuments(query),
    ])
    const result = paginate(items, page, limit, total)
    repo.setCache(cacheKey, result, 600)
    return result
  }

  async function getById(id: string) {
    let oid: ObjectId
    try { oid = new ObjectId(id) } catch { throw new BadRequestError('Invalid server ID format.') }

    const cacheKey = makeCacheKey(namespace_collection, { id, tag: 'by-id' })
    const cached = await repo.getCache<TServer>(cacheKey)
    if (cached) return cached

    const server = await repo.collection.findOne({ _id: oid })
    if (!server) throw new NotFoundError('Server not found.')
    repo.setCache(cacheKey, server, 600)
    return server
  }

  async function add(data: Omit<TServer, '_id'>) {
    const result = await repo.collection.insertOne(data as any)
    repo.delCachedData()
    return result.insertedId.toString()
  }

  async function updateById(id: string, data: Partial<TServer>) {
    let oid: ObjectId
    try { oid = new ObjectId(id) } catch { throw new BadRequestError('Invalid server ID format.') }
    const result = await repo.collection.updateOne({ _id: oid }, { $set: data })
    if (!result.matchedCount) throw new NotFoundError('Server not found.')
    repo.delCachedData()
  }

  async function deleteById(id: string) {
    let oid: ObjectId
    try { oid = new ObjectId(id) } catch { throw new BadRequestError('Invalid server ID format.') }
    const result = await repo.collection.deleteOne({ _id: oid })
    if (!result.deletedCount) throw new NotFoundError('Server not found.')
    repo.delCachedData()
  }

  return { createIndexes, getAll, getById, add, updateById, deleteById }
}
```

---

## `.controller.ts`

```typescript
import { Request, Response, NextFunction } from 'express'
import { schemaServerCreate, schemaServerUpdate } from './server.model'
import { useServerRepo } from './server.repository'
import { BadRequestError } from '../../utils/error'

export function useServerController() {
  const repo = useServerRepo()
  // const service = useServerService()  // use when there's business logic

  async function list(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await repo.getAll({ page: Number(req.query.page) || 1, search: String(req.query.search || '') })
      res.json(result)
    } catch (error) { next(error) }
  }

  async function add(req: Request, res: Response, next: NextFunction) {
    try {
      const { error, value } = schemaServerCreate.validate(req.body)
      if (error) { next(new BadRequestError(error.message)); return }
      const serverId = await repo.add(value)
      res.status(201).json({ message: 'Server added.', serverId })
    } catch (error) { next(error) }
  }

  return { list, add, /* ... */ }
}
```

Always call `next(error)` in catch blocks — never `res.status(500).json(...)` directly.

---

## Queries, Indexing & Caching

### The four non-negotiables — a query is not done until all four are true

**1. INDEXED** — every field used in `find`, `findOne`, `$match`, `$sort`, or
`countDocuments` must have a matching MongoDB index. No `COLLSCAN` ever.

- Declare indexes in the repository's `createIndexes()`.
- Compound rule: equality-matched fields first, then sort/range fields.
- **Register the repo in `src/setup.ts → createAllIndexes()`** — or the index never
  gets built at boot (the test harness also calls `createAllIndexes`).

**2. CACHED** — read paths serve from Redis; write paths invalidate the namespace.

```typescript
// READ — check cache first
const cacheKey = makeCacheKey(namespace_collection, { page, search, tag: 'getAll' })
const cached = await repo.getCache<T>(cacheKey)
if (cached) return cached
// ...run query...
repo.setCache(cacheKey, result, 600)   // TTL in seconds

// WRITE — always invalidate
repo.delCachedData()   // purges the entire collection namespace
```

Include every query param + a `tag` in the key so different query shapes never collide.

**3. PROPER query shape** — cast `ObjectId` in `try/catch → BadRequestError("Invalid …
format.")`; escape user search with `escapeRegex`; paginate with aggregate `$skip`/
`$limit` + `countDocuments` + `paginate()`.

**4. TESTED** — tests in `test/*.spec.ts` (mocha + chai). Cover happy path, edge cases,
error handling (`BadRequestError`, `NotFoundError`), cache hit/miss/invalidation, and
index usage. Run with `yarn test`.

---

## Transactions

Use a MongoDB session whenever a service function writes to more than one collection.
Transactions belong in the **service layer only**.

```typescript
const session = client.startSession()
try {
  session.startTransaction()
  await repoA.add(dataA, { session })
  await repoB.add(dataB, { session })
  await session.commitTransaction()
} catch (error) {
  await session.abortTransaction()
  throw error
} finally {
  await session.endSession()
}
```

---

## Route Guards

Gate every route with auth middleware from `src/utils/auth.middleware.ts`:

```typescript
import { requireAuth, requireAdmin } from '../../utils/auth.middleware'

router.get('/servers',     requireAuth, list)
router.post('/servers',    requireAuth, add)
router.delete('/servers/:id', requireAuth, requireAdmin, remove)
```

- `requireAuth` — always; validates the session/token
- `requireAdmin` — for admin-only operations
- API token scope checks happen inside `requireAuth` for token-authenticated requests

---

## Per-resource Checklist

1. `model.ts` — enums `as const`, base + create + update schemas, `model<Resource>()`
   validates/normalizes/casts ids.
2. `repository.ts` — `createIndexes()` covering every query; cached reads via
   `makeCacheKey` + `getCache`/`setCache`; `repo.delCachedData()` on every write;
   `ObjectId` casts in try/catch; escaped regex; paginated aggregate + `countDocuments`
   + `paginate`.
3. Register the repo in `src/setup.ts → createAllIndexes()`.
4. `service.ts` only if needed; multi-collection writes use a session transaction.
5. `controller.ts` — full Joi validation, delegate, `next(error)`.
6. Route guarded with `requireAuth` (+ `requireAdmin` for sensitive ops).
7. `index.ts` barrel.
8. Tests: happy path + edge cases + error handling + cache behavior; `yarn test`.
9. Verify build: `yarn build`.

---

## What Not To Do

- **Only the repository touches MongoDB** — no raw DB in services or controllers
- **No business logic on repository functions** — that belongs in the service
- **No `new Error()`** — typed errors from `src/utils/error.ts` only
- **No Zod** — validation is Joi here (Zod is frontend-only)
- **No extra fields into the DB** — validate the full body first, never spread raw input
- **No unindexed query / COLLSCAN** — every query backed by a registered index
- **No uncached read path** — reads serve from cache; writes must call `delCachedData()`
- **No untested query or service function**

---

## Architecture Overview

### Collections (prefixed `cp_`)

- `cp_users` — admin users
- `cp_servers` — managed VPS
- `cp_apps` — deployed applications
- `cp_instances` — app containers
- `cp_databases` — provisioned databases
- `cp_deployments` — deployment history
- `cp_audit_logs` — audit trail
- `cp_settings` — platform configuration
- `ssh_keys` — SSH keypairs for server access
- `api_tokens` — API tokens for programmatic access

### Authentication

Three methods:

1. **Session cookie** (`sid`) — primary for web UI; httpOnly, rolling refresh
2. **JWT Bearer token** — short-lived access tokens
3. **API Token** (`cp_` prefix) — long-lived, for CI/CD; stored as SHA256 hash; scope-based

**Available API token scopes:** `servers:read`, `servers:write`, `apps:read`,
`apps:write`, `databases:read`, `databases:write`, `deployments:read`,
`deployments:write`, `settings:read`, `settings:write`, `*` (full access)

### Key Endpoints

```
# Auth
POST   /api/auth/login          # Login
GET    /api/auth/me             # Get current user
DELETE /api/auth/logout         # Logout

# Setup
POST   /api/setup/init          # First-run setup

# Health
GET    /api/health              # Basic health check
GET    /api/health/detailed     # Detailed health (memory, CPU, Caddy)

# Servers
GET    /api/servers             # List servers
POST   /api/servers             # Add server
GET    /api/servers/:id         # Get server
PATCH  /api/servers/:id         # Update server
DELETE /api/servers/:id         # Remove server

# Apps
GET    /api/apps                # List apps
POST   /api/apps                # Create app
GET    /api/apps/:id            # Get app
PATCH  /api/apps/:id            # Update app
DELETE /api/apps/:id            # Delete app
POST   /api/apps/:id/deploy     # Deploy
POST   /api/apps/:id/stop       # Stop
POST   /api/apps/:id/restart    # Restart
PATCH  /api/apps/:id/scale      # Scale

# Databases
GET    /api/databases           # List databases
POST   /api/databases           # Create database
GET    /api/databases/:id       # Get database

# SSH Keys
GET    /api/ssh-keys            # List keys
POST   /api/ssh-keys            # Generate new key (returns private key once)
POST   /api/ssh-keys/import     # Import existing key
DELETE /api/ssh-keys/:id        # Delete key

# API Tokens
GET    /api/api-tokens          # List tokens
POST   /api/api-tokens          # Create token (returns plaintext once)
DELETE /api/api-tokens/:id      # Revoke token

# Audit
GET    /api/audit-logs          # Audit trail
```

### Testing

```bash
yarn test:unit          # Unit tests only (no DB required)
yarn test               # All tests (requires MongoDB + Redis)
yarn test:watch         # Watch mode

./test.sh setup         # Start MongoDB + Redis containers
./test.sh all           # Run all tests with auto-setup
./test.sh teardown      # Stop test containers
```
