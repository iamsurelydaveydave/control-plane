# control-plane-api (`@control-plane/api`)

Express + MongoDB (Atlas) + TypeScript backend for the Control Plane.

## Architecture

Follows the same resource layer pattern as `goweekdays/api-core`:

| Layer | File | Responsibility |
|-------|------|----------------|
| Model | `*.model.ts` | Types, Joi schemas, `model<Resource>()` |
| Repository | `*.repository.ts` | DB operations, caching, indexes |
| Service | `*.service.ts` | Business logic (optional) |
| Controller | `*.controller.ts` | HTTP handling |

## Strict Rules

1. **Only repository touches MongoDB** — no raw DB in services/controllers
2. **Typed errors only** — `BadRequestError`, `NotFoundError`, etc. (never `new Error()`)
3. **Every query indexed** — register in `setup.ts → createAllIndexes()`
4. **Every read cached** — use `makeCacheKey` + `repo.getCache/setCache`
5. **Every write invalidates** — call `repo.delCachedData()`
6. **Full Joi validation** — validate entire `req.body` in controller

## Collections (prefixed `cp_`)

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

## Authentication

The API supports three authentication methods:

1. **Session cookie** (`sid`) — Primary method for web UI. httpOnly cookie with rolling refresh.
2. **JWT Bearer token** — Short-lived access tokens for API calls.
3. **API Token** (`cp_` prefix) — Long-lived tokens for CI/CD and scripts.

### API Tokens

API tokens are used for programmatic access (CI/CD, scripts, integrations):

- Format: `cp_<base64url-random>` (e.g., `cp_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456`)
- Stored as SHA256 hash (fast lookup, high-entropy source is safe)
- Scope-based access control (`servers:read`, `apps:write`, `*`, etc.)
- Optional expiration date
- `lastUsedAt` tracking

**Available scopes:**
- `servers:read`, `servers:write`
- `apps:read`, `apps:write`
- `databases:read`, `databases:write`
- `deployments:read`, `deployments:write`
- `settings:read`, `settings:write`
- `*` (full access)

### SSH Keys

SSH keys are used for connecting to managed servers:

- Generates ED25519 (default) or RSA 4096-bit keys
- Private key returned only at creation time (cannot be retrieved later)
- Import existing keys supported
- One default key per installation

## Key Endpoints

```
# Auth
POST   /api/auth/login          # Login
GET    /api/auth/me             # Get current user
DELETE /api/auth/logout         # Logout

# Setup
POST   /api/setup/init          # First-run setup
GET    /api/health              # Health check

# Servers (requires servers:read/write scope)
GET    /api/servers             # List servers
POST   /api/servers             # Add server
GET    /api/servers/:id         # Get server
PATCH  /api/servers/:id         # Update server
DELETE /api/servers/:id         # Remove server

# Apps (requires apps:read/write scope)
GET    /api/apps                # List apps
POST   /api/apps                # Create app
GET    /api/apps/:id            # Get app
PATCH  /api/apps/:id            # Update app
DELETE /api/apps/:id            # Delete app
POST   /api/apps/:id/deploy     # Deploy (deployments:write)
POST   /api/apps/:id/restart    # Restart (deployments:write)

# Databases (requires databases:read/write scope)
GET    /api/databases           # List databases
POST   /api/databases           # Create database
GET    /api/databases/:id       # Get database

# SSH Keys
GET    /api/ssh-keys            # List keys (public info only)
POST   /api/ssh-keys            # Generate new key (returns private key once)
POST   /api/ssh-keys/import     # Import existing key
PATCH  /api/ssh-keys/:id        # Update key (name, default)
DELETE /api/ssh-keys/:id        # Delete key
POST   /api/ssh-keys/:id/default # Set as default

# API Tokens
GET    /api/api-tokens          # List tokens (hashed, no actual tokens)
GET    /api/api-tokens/scopes   # List available scopes
POST   /api/api-tokens          # Create token (returns plaintext once)
DELETE /api/api-tokens/:id      # Revoke token

# Audit
GET    /api/audit-logs          # Audit trail
```

## Quick Start

```bash
yarn install
cp .env.example .env
# Edit .env with MONGO_URI
yarn dev
```

## Testing

```bash
yarn test                       # Run all tests
MONGO_DB=control_plane_test yarn test  # Use test database
```
