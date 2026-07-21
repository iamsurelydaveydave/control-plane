# Changelog

All notable changes to Control Plane are documented here.

## [Unreleased]

### Added
- Comprehensive documentation
  - Root README with architecture overview
  - API documentation with full endpoint reference
  - Frontend documentation with component patterns
  - Architecture diagrams
  - Deployment and development guides

---

## Phase 13: Additional Modules

### Added
- **Addons Catalog** (`/api/addons/*`)
  - Deploy Redis, PostgreSQL, MySQL, RabbitMQ, Elasticsearch via Helm
  - Auto-generated connection strings and credentials
  - Status sync with Helm releases
  - Helm service for chart management
- **Pipeline Stages** (`/api/pipelines/*`)
  - Dev → Staging → Production environments
  - Promotion workflows with approval gates
  - Auto-promote on successful deploy option
  - Rollback support per stage
- **Container Registry** (`/api/registries/*`)
  - Support for Docker Hub, GCR, ECR, ACR, GHCR, Harbor, custom
  - Encrypted credential storage (AES-256-GCM)
  - Auto-create K8s imagePullSecrets
  - Browse repositories and tags via registry v2 API

### Frontend
- Addons management page
- Pipelines list and detail pages
- Container registries page

---

## Phase 12: Production Deployment

### Added
- **Helm Chart** (`deploy/helm/control-plane/`)
  - Full production Helm chart with API, Web, RBAC
  - Configurable ingress (standard + Traefik IngressRoute)
  - Optional Redis subchart
  - ServiceAccount with ClusterRole for K8s API access
- **GitHub Actions Workflows**
  - `ci.yaml` — Tests and builds on PR/push
  - `build-push.yaml` — Multi-arch Docker builds to GHCR
  - `release.yaml` — Auto-generate release notes
  - `deploy.yaml` — Manual Helm deployment to K8s
- **Dockerfiles Enhanced**
  - 3-stage builds with layer caching
  - OCI labels and version metadata

---

## Phase 11: Missing Features

### Added
- **SSO/SAML Integration** (`/api/sso/*`)
  - SAML 2.0 support (Okta, Azure AD, generic)
  - OAuth2/OIDC support (Google, GitHub, Azure AD, Okta, generic)
  - Auto-provision users on first SSO login
  - Attribute mapping for email, name, groups
  - SP metadata generation for SAML
- **Email Service** (`src/services/email.service.ts`)
  - Multi-provider: SMTP, Resend, SendGrid, console
  - Pre-built templates: alerts, deployments, invitations
  - Webhook type 'email' now actually sends emails
- **PDF Export** for audit logs
  - `GET /api/audit-logs/export?format=pdf`
  - Professional report with headers, pagination, footer
- **Pod Shell (xterm.js)**
  - WebSocket endpoint: `ws://host/api/pods/:ns/:pod/exec`
  - Interactive shell with resize support
  - One-shot command execution
  - Pod listing and logs endpoints

### Frontend
- SSO configuration page in settings

---

## Phase 10: Polish & QA

### Added
- **Integration Tests**
  - `test/role.spec.ts` — RBAC tests
  - `test/organization.spec.ts` — Multi-tenancy tests
  - `test/addon.spec.ts` — Addon tests
  - `test/sso-config.spec.ts` — SSO tests

### Fixed
- Frontend TypeScript errors in `nuxt.config.ts`
- UTable typing for TanStack Table format
- Component prop type mismatches

---

## Phase 5: Monitoring, Alerts, Logs

### Added
- **Metrics Service** (`/api/metrics/*`)
  - System metrics (CPU, memory, disk)
  - Cluster metrics (K8s resources)
  - Database metrics summary
  - App metrics summary
  - Combined overview endpoint
- **Monitoring Dashboard** (`/dashboard/monitoring`)
  - Real-time system metrics
  - Cluster health overview
  - Resource utilization graphs
- **Audit Logging**
  - All user actions logged to `cp_audit_logs`
  - Action, resource, user, timestamp, IP tracking
  - Filterable audit log endpoint

### Changed
- Health endpoint now includes K8s status
- Dashboard shows metrics overview

---

## Phase 4: App Deployment

### Added
- **App Management** (`/api/apps/*`)
  - Create, read, update, delete apps
  - Deploy with version tracking
  - Redeploy current version
  - Rollback to previous/specific version
  - Start, stop, restart operations
  - Scale replicas
  - Get logs and status
- **Deployment History**
  - Full deployment tracking
  - Version history with timestamps
  - Deployment logs storage
- **SSE Deployment Streaming**
  - Real-time deployment log streaming
  - Progress tracking via Server-Sent Events
- **Environment Variables**
  - Per-app environment configuration
  - Secret references support
- **Secrets Management** (`/api/secrets/*`)
  - Global and app-specific secrets
  - Encrypted storage
  - Metadata-only listing (values never exposed)

### Changed
- K8s integration for app deployments
- Deployments create K8s Deployment, Service, and Ingress

---

## Phase 3: MongoDB Provisioning

### Added
- **Database Management** (`/api/databases/*`)
  - Create MongoDB replica sets via Percona Operator
  - Provision with configurable replicas, storage, version
  - Get credentials and connection strings
  - Health monitoring for replica sets
- **TLS Management**
  - Enable/disable TLS for databases
  - Download CA certificates
  - Let's Encrypt integration
- **Backup Management**
  - Configure backup schedules
  - Manual backup triggering
  - List and restore from backups
  - S3-compatible storage support
- **DNS Configuration**
  - Automatic subdomain creation
  - SRV record management for replica sets
  - Cloudflare integration
- **Percona MongoDB Operator**
  - Automated operator installation
  - Custom resource management
  - Operator status monitoring

### Changed
- Database provisioning uses K8s Custom Resources
- Credentials stored with encryption

---

## Phase 2: K8s Cluster Management

### Added
- **Cluster Management** (`/api/clusters/*`)
  - Create and manage K3s clusters
  - Sync cluster status from K8s API
  - Join token management
  - Token refresh functionality
- **Node Management** (`/api/nodes/*`)
  - List nodes across clusters
  - Provision new worker nodes via SSH
  - Node cordon/uncordon operations
  - Node drain and removal
  - Label management
  - Provisioning status tracking
- **SSH Key Management** (`/api/ssh-keys/*`)
  - Generate ED25519 keypairs
  - Import existing keys
  - Set default key
  - Fingerprint tracking
- **K8s Service**
  - K8s API client integration
  - Node operations (get, label, taint)
  - Namespace management
- **K8s Settings Endpoints**
  - `/api/settings/k8s` — cluster status
  - `/api/settings/k8s/nodes` — node listing
  - `/api/settings/k8s/agent-command` — join instructions
  - `/api/settings/k8s/operator` — Percona status

### Changed
- K3s installation integrated into installer
- Node provisioning runs K3s agent install via SSH

---

## Phase 1: Core Infrastructure

### Added
- **Project Structure**
  - Express + MongoDB + TypeScript backend
  - Nuxt 4 + @nuxt/ui + Tailwind CSS frontend
  - Strict 4-layer resource pattern (model, repository, service, controller)
- **Authentication System**
  - Session-based auth with Redis storage
  - JWT bearer token support
  - API tokens with scope-based permissions
  - Password hashing with bcrypt
- **User Management**
  - Admin user creation
  - Password updates
  - Current user endpoints
- **API Tokens** (`/api/api-tokens/*`)
  - Create tokens with scopes
  - List tokens (hash never exposed)
  - Revoke tokens
  - Available scopes:
    - `apps:read`, `apps:write`
    - `databases:read`, `databases:write`
    - `deployments:read`, `deployments:write`
    - `settings:read`, `settings:write`
    - `*` (full access)
- **Settings Management** (`/api/settings/*`)
  - Key-value settings storage
  - DNS configuration for apps and databases
  - Cloudflare integration and verification
- **Health Endpoints**
  - Basic health check
  - Detailed health with system metrics
- **Setup Flow** (`/api/setup/*`)
  - Platform initialization check
  - First admin user creation
  - SSH key bootstrapping
- **Error Handling**
  - Typed error classes
  - Consistent error response format
  - Proper HTTP status codes
- **Caching**
  - Redis-based caching
  - Cache key generation with `makeCacheKey`
  - Automatic cache invalidation on writes
- **Installer**
  - One-liner installation script
  - Docker Compose deployment
  - K3s installation
  - Caddy reverse proxy with automatic HTTPS
  - Auto-update support

### Technical
- MongoDB collections prefixed with `cp_`
- Index creation at startup
- Request sanitization for MongoDB operators
- CORS configuration
- Helmet security headers

---

## Version History

| Version | Date | Highlights |
|---------|------|------------|
| 0.1.0 | — | Initial release with core infrastructure |

---

## Migration Notes

### From Development to Production

1. Set `MONGODB_URI` to MongoDB Atlas connection string
2. Set `DOMAIN` for HTTPS access
3. Run the installer: `curl -fsSL https://get.controlplane.dev/install.sh | bash`

### Upgrading

Re-run the installer or use the upgrade script:

```bash
/data/control-plane/source/upgrade.sh
```
