---
name: api-core-resource
description: control-plane-api (Express + MongoDB + TypeScript) backend resource pattern. Use whenever you create or modify a control-plane-api resource, repository, query, aggregation, route, or controller. Enforces the model/repository/service/controller layering, typed errors (from src/utils/error.ts), Joi validation, and the four non-negotiables for every query — it must be INDEXED, CACHED (Redis namespace with write invalidation), shaped PROPERLY (equality-first compound index matching the query, no COLLSCAN), and covered by TESTS. Covers createIndexes registration in setup.ts, makeCacheKey + repo.delCachedData, pagination via aggregate + countDocuments + paginate, session transactions, and the mocha/chai test harness.
---

# control-plane-api Resource Pattern

Apply this whenever you touch a resource in `control-plane-api/` (Express + MongoDB Atlas +
TypeScript). The per-codebase guide is `control-plane-api/CLAUDE.md`. This skill is the
operational pattern with the backend priorities front and center: **every query must be
indexed, cached, properly shaped, and tested.**

## Layering — `src/resources/<resource-name>/`

```
<resource>.model.ts       # Types, enums, Joi schemas, model<Resource>() factory
<resource>.repository.ts  # DB-only: queries, createIndexes(), cache read/invalidate
<resource>.service.ts     # Business logic + transactions (OPTIONAL — only if needed)
<resource>.controller.ts  # HTTP: validate req, delegate, next(error)
index.ts                  # Barrel: export * from each layer
```

Naming: `T<Resource>` type, `schema<Resource>`, `model<Resource>()`,
`use<Resource>Repo()`, `use<Resource>Service()`, `use<Resource>Controller()`.
Multi-word files use dot notation: `ssh.key.repository.ts`, `api.token.model.ts`.

Strict layering — each layer has exactly one job:

- **`model`** — TS types, enums, Joi schemas, `model<Resource>()` factory (validates,
  casts ObjectIds, enforces cross-field rules, returns a clean normalized object)
- **`repository`** — the **only** layer that touches Mongo: queries, `createIndexes()`,
  cache read/invalidate. Pure data access — **never build business logic on repo fns**
- **`service`** — business logic: composes repo fns + third-party deps (Docker, SSH, …)
  and owns transactions. Never hits DB directly. **Optional** — only when needed
- **`controller`** — HTTP only: validate `req`, delegate, `next(error)`. No business
  logic, no raw queries

Never throw `new Error()` — import typed errors from `src/utils/error.ts`:
```typescript
import { BadRequestError, NotFoundError, ForbiddenError,
         ConflictError, InternalServerError, AppError } from '../../utils/error'
```
In every `catch`, re-throw typed errors as-is (`if (error instanceof AppError) throw error`)
before wrapping the rest in `InternalServerError`.

## The four non-negotiables for every query

A query is not done until all four are true.

### 1. INDEXED — back every query with an index

- Every field used in `find`, `findOne`, aggregation `$match`/`$sort`, or
  `countDocuments` MUST have a matching index. Never ship a `COLLSCAN`.
- Declare indexes in the repository's `createIndexes()`:

```typescript
import { useRepo } from '../../utils/repo'
import { BadRequestError } from '../../utils/error'

const namespace_collection = 'cp_servers'
const repo = useRepo(namespace_collection)

async function createIndexes() {
  try {
    await repo.collection.createIndexes([
      { key: { status: 1 } },
      { key: { name: 'text' } },
      // Compound: equality fields first, then sort/range — match the query shape
      { key: { status: 1, createdAt: -1 } },
    ])
  } catch (error) {
    throw new BadRequestError('Failed to create server indexes.')
  }
}
```

- **Compound rule:** equality-matched fields first, then `$sort`/range fields, in the
  exact order the query uses them.
- **Register the repo in `src/setup.ts → createAllIndexes()`** (`{ name, repo }`), or
  the index never gets built at boot — and the test harness (which calls the same
  `createAllIndexes()`) won't have it either.

### 2. CACHED — read from Redis, invalidate on write

Read paths: build a key, return on hit, query on miss, then set with a TTL.
Write paths: invalidate the whole collection namespace.

```typescript
import { makeCacheKey } from '../../utils/make-cache-key'

// READ
const cacheKey = makeCacheKey(namespace_collection, {
  page, search, status, tag: 'getAll',   // tag distinguishes query kinds
})
const cached = await repo.getCache<Record<string, any>>(cacheKey)
if (cached) return cached
/* ...run the query... */
repo.setCache(cacheKey, result, 600)     // seconds; pick a sensible TTL
return result

// WRITE (add / updateById / deleteById)
repo.delCachedData()    // purges the entire namespace so reads never go stale
```

- Include **every** query param + a `tag` in the key so different query shapes
  (`getAll`, `by-id`, `summary`) never collide.
- `useRepo()` from `src/utils/repo.ts` already wires `getCache`/`setCache`/
  `delCachedData` scoped to the collection namespace.

### 3. PROPER query shape

- Cast ids to `ObjectId` inside `try/catch` → `BadRequestError('Invalid … format.')`.
- Escape user search: `search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')` before `$regex`,
  or use the `escapeRegex` util from `src/utils/escape-regex.ts`.
- Paginate with `find().skip().limit()` (simple) or `aggregate([{ $match }, { $sort },
  { $skip }, { $limit }])` (complex) + `countDocuments(query)` + the `paginate(items,
  page, limit, total)` util from `src/utils/paginate.ts` (returns `{ items, pages }`).
- Build the filter object conditionally — only add a clause when a param is present.

### 4. TESTED — every repo query and service function has tests

- Tests in `test/*.spec.ts` (mocha + chai). Run with `yarn test`.
- Probe MongoDB/Redis first and `this.skip()` when unreachable — tests never hang.
- Cover: happy path, edge cases, error handling (`BadRequestError`, `NotFoundError`),
  cache behavior (hit, miss, invalidation after write), and that the query uses its index.

## `.model.ts`

Export enum values as `as const` arrays so they feed both Joi `.valid(...)` and TS union
types. Define a shared base, then compose `schema<Resource>Create` and
`schema<Resource>Update` (all-optional). `model<Resource>(data)`:
1. validates against the full schema (throws `BadRequestError`)
2. converts string ids → `ObjectId` (throws on bad format)
3. enforces cross-field rules
4. returns a fully-normalized object with every field explicitly set (never spread raw
   input — that's how extra fields leak into the DB)

## `.controller.ts`

Validate the **entire** `req.body`/`req.params`/`req.query` against a Joi schema
(rejects unexpected keys), then destructure only what you need and delegate. Each
handler is `try { … } catch (error) { next(error) }` — never `res.status(500)`.

```typescript
import { requireAuth } from '../../utils/auth.middleware'

export function useServerController() {
  const repo = useServerRepo()
  // const service = useServerService()

  async function add(req: Request, res: Response, next: NextFunction) {
    try {
      const { error, value } = schemaServerCreate.validate(req.body)
      if (error) { next(new BadRequestError(error.message)); return }
      const serverId = await repo.add(value)
      res.status(201).json({ message: 'Server added.', serverId })
    } catch (error) { next(error) }
  }

  return { add, /* … */ }
}
```

## Route guards

```typescript
import { requireAuth } from '../../utils/auth.middleware'

router.get('/servers',        requireAuth, list)
router.post('/servers',       requireAuth, add)
router.delete('/servers/:id', requireAuth, remove)
```

`requireAuth` always. Add additional scope/role checks for sensitive operations.

## Per-resource checklist

1. `model.ts` — enums `as const`, base + create + update schemas, `model<Resource>()`
   validates/normalizes and casts ids.
2. `repository.ts` — `createIndexes()` covering every query; cached reads via
   `makeCacheKey` + `getCache`/`setCache`; `repo.delCachedData()` on every write;
   `ObjectId` casts; escaped regex; paginated query + `countDocuments` + `paginate`.
3. Register the repo in `src/setup.ts → createAllIndexes()`.
4. `service.ts` only if needed; multi-collection writes run in a session transaction.
5. `controller.ts` — full Joi validation, delegate, `next(error)`.
6. Route guarded with `requireAuth` (+ scope checks for sensitive ops).
7. `index.ts` barrel.
8. Tests for every repo query + service fn (happy/edge/error + cache + index); `yarn test`.
9. Verify build: `yarn build`.

## Don't

- Only the repository touches Mongo — no raw DB queries in services or controllers;
  no business logic on repository functions or in controllers
- No `new Error()` — typed errors from `src/utils/error.ts` only
- No Zod — validation is Joi here (Zod is frontend-only)
- No unindexed query / COLLSCAN; no index that isn't registered in `createAllIndexes`
- No uncached read path; no write that forgets `repo.delCachedData()`
- No spreading raw input into the DB; always validate the full body first
- No untested query or service function
