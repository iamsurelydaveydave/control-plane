# AGENTS.md — Control Plane Workspace

Workspace-level guidance for AI agents. This repo contains two codebases:

| Path | Stack | Per-codebase guide |
| --- | --- | --- |
| `control-plane-api/` | Express + MongoDB (Atlas) + TypeScript | `control-plane-api/CLAUDE.md` |
| `control-plane-web/` | Nuxt 4 + @nuxt/ui + Tailwind CSS + TypeScript | `control-plane-web/CLAUDE.md` |

**Always read the relevant per-codebase `CLAUDE.md` before editing that codebase.**

## Agent skills (load the matching one before you build)

These live in `.agents/skills/`. Each holds the operational pattern + a checklist for
its area — use them; don't re-derive the conventions.

| Skill | Use it when… |
| --- | --- |
| `api-core-resource` | Creating/modifying any `control-plane-api` resource, repository, query, aggregation, route, or controller. Enforces the model/repository/service/controller layering and the four query non-negotiables: **indexed, cached, properly shaped, tested**. |
| `web-crud-ui` | Building/modifying a `control-plane-web` page with a table, an add/edit/view/delete dialog, an operation dialog, or any form. Enforces the Main + Form two-component pattern, the single `setItem`/`set<Action>` setter. |
| `nuxt-ui` | Any UI work in `control-plane-web` — components, theming, forms, layouts. @nuxt/ui v4 is the component library; consult this skill for component selection and conventions. |

## House rules (summary — see the CLAUDE.md files for detail)

- **control-plane-api:** strict resource-layer pattern, one job per layer — **`model`**
  shapes and validates the data (Joi), **`repository`** is the only layer that touches
  the DB (no business logic on repo functions), **`service`** holds business logic over
  repos + third-party deps (optional), **`controller`** validates then delegates to the
  service (the usual case) or the repository directly when there's no service; typed
  errors (`BadRequestError`, etc. from `src/utils/error.ts`) — never `new Error()`.
  **Every query must be indexed (and registered in `setup.ts → createAllIndexes`),
  cached (Redis namespace with write invalidation via `repo.delCachedData()`), properly
  shaped (equality-first compound index, no `COLLSCAN`), and tested** (`yarn test`).
  See the `api-core-resource` skill.

- **control-plane-web:** `<script setup>` only; state via `useState` + composables
  (no Pinia/Vuex); all HTTP through `useNuxtApp().$api`; resource types as
  `declare type T<Resource>` in `app/types/`; layout with Tailwind flex/grid (no
  `v-row`/`v-col` — this is Nuxt UI, not Vuetify). A page with a single table uses
  the Main + Form two-component pattern with one `setItem`/`set<Action>` setter.
  Forms use `UForm` with a Zod schema. Modals use `UModal`. Every data-mutating
  action is confirmed through a `ConfirmationPrompt` component. See the `web-crud-ui`
  and `nuxt-ui` skills.

- Don't commit changes or create branches unless asked. Validate your work
  (build/tests) before claiming completion.
