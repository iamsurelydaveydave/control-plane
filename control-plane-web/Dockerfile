# Control Plane Web Dockerfile
# Multi-stage build for Nuxt 4 SSR production

# Build arguments for metadata
ARG VERSION=dev
ARG BUILD_DATE
ARG VCS_REF

# ================================
# Stage 1: Dependencies
# ================================
FROM node:22-alpine AS deps

WORKDIR /app

# Enable corepack for pnpm
RUN corepack enable && corepack prepare pnpm@11.13.1 --activate

# Copy package files first for better layer caching
COPY package.json pnpm-lock.yaml ./

# Copy workspace config if it exists
COPY pnpm-workspace.yaml* ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# ================================
# Stage 2: Build
# ================================
FROM deps AS builder

WORKDIR /app

# Copy source code
COPY . .

# Set API_URL for the proxy routeRules (internal K8s service URL)
# This gets baked into the Nitro server at build time
ENV API_URL=http://control-plane-api:5005

# Build Nuxt for production
RUN pnpm build

# ================================
# Stage 2: Production
# ================================
FROM node:22-alpine AS production

WORKDIR /app

# Install curl for health checks
RUN apk add --no-cache curl

# Create non-root user
RUN addgroup -g 9999 controlplane && \
    adduser -D -u 9999 -G controlplane controlplane

# Copy the built output from builder
# Nuxt 4 outputs to .output directory
COPY --from=builder --chown=controlplane:controlplane /app/.output ./.output

# Set environment
ENV NODE_ENV=production
ENV NUXT_HOST=0.0.0.0
ENV NUXT_PORT=3000

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Run as non-root user
USER controlplane

# Labels for metadata
LABEL org.opencontainers.image.title="Control Plane Web" \
      org.opencontainers.image.description="Control Plane Web UI" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.source="https://github.com/goweekdays/control-plane"

# Start the Nuxt server
CMD ["node", ".output/server/index.mjs"]
