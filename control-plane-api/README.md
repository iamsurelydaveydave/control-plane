# Control Plane API

Backend API for the Control Plane infrastructure management platform. Built with Express + MongoDB + TypeScript, following the same patterns as `goweekdays/api-core`.

## Quick Start

```bash
# Install dependencies
yarn install

# Copy environment file
cp .env.example .env
# Edit .env with your MongoDB URI and other settings

# Development
yarn dev

# Build
yarn build

# Production
yarn start
```

## Architecture

This API follows the **resource layer pattern** from api-core:

```
src/
├── config.ts           # Environment configuration
├── app.ts              # Express app setup
├── server.ts           # Server entry point
├── setup.ts            # Index creation and initialization
├── routes/             # Route definitions
│   ├── index.ts        # Route registry
│   ├── auth.route.ts
│   ├── server.route.ts
│   ├── app.route.ts
│   └── ...
├── resources/          # Business logic
│   ├── user/
│   │   ├── user.model.ts       # Types + Joi schemas
│   │   ├── user.repository.ts  # DB operations + caching
│   │   ├── user.service.ts     # Business logic
│   │   └── index.ts
│   ├── server/
│   ├── app/
│   ├── database/
│   └── ...
└── utils/              # Shared utilities
    ├── error.ts        # Typed errors
    ├── atlas.ts        # MongoDB connection
    ├── repo.ts         # Repository factory
    ├── cache.ts        # Redis caching
    └── ...
```

## Layer Responsibilities

1. **Model** (`*.model.ts`) — Types, Joi schemas, `model<Resource>()` factory
2. **Repository** (`*.repository.ts`) — DB operations only, caching, indexes
3. **Service** (`*.service.ts`) — Business logic (optional)
4. **Controller** (`*.controller.ts`) — HTTP handling, validation, delegation

## API Endpoints

### Setup & Health

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/setup/status` | GET | Check if initialized |
| `/api/setup/init` | POST | Initialize platform |
| `/api/health` | GET | Basic health check |
| `/api/health/detailed` | GET | Detailed health info |

### Authentication

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/login` | POST | Login |
| `/api/auth/logout` | DELETE | Logout |
| `/api/auth/me` | GET | Get current user |
| `/api/auth/token` | POST | Issue JWT tokens |

### Servers

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/servers` | GET | List servers |
| `/api/servers` | POST | Add server |
| `/api/servers/:id` | GET | Get server |
| `/api/servers/:id` | PATCH | Update server |
| `/api/servers/:id` | DELETE | Remove server |
| `/api/servers/:id/status` | GET | Get server status |

### Apps

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/apps` | GET | List apps |
| `/api/apps` | POST | Create app |
| `/api/apps/:id` | GET | Get app |
| `/api/apps/:id` | PATCH | Update app |
| `/api/apps/:id` | DELETE | Delete app |
| `/api/apps/:id/scale` | PATCH | Scale app |
| `/api/apps/:id/restart` | POST | Restart app |
| `/api/apps/:id/deploy` | POST | Deploy app |

### Databases

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/databases` | GET | List databases |
| `/api/databases` | POST | Provision database |
| `/api/databases/:id` | GET | Get database |
| `/api/databases/:id` | DELETE | Delete database |
| `/api/databases/:id/reprovision` | POST | Reprovision |
| `/api/databases/:id/backup` | POST | Trigger backup |
| `/api/databases/:id/credentials` | GET | Get connection string |

### Audit Logs

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/audit-logs` | GET | List audit logs |

## Collections

| Collection | Description |
|------------|-------------|
| `cp_users` | Admin users |
| `cp_servers` | Managed servers |
| `cp_apps` | Deployed applications |
| `cp_instances` | App instances (containers) |
| `cp_databases` | Provisioned databases |
| `cp_deployments` | Deployment history |
| `cp_audit_logs` | Audit trail |
| `cp_settings` | Platform settings |

## Environment Variables

See `.env.example` for all available options.

## Development

```bash
# Run tests
yarn test

# Lint
yarn lint

# Build
yarn build
```

## TODO

- [x] MongoDB provisioning via Ansible + Docker
- [ ] Redis provisioning
- [ ] PostgreSQL provisioning
- [ ] SSH executor for server operations
- [ ] Docker/Kamal integration for app deployments
- [ ] Health check worker (background job)
- [ ] Self-healing reconciler
- [ ] Backup scheduler
- [ ] TLS/SSL support for databases
