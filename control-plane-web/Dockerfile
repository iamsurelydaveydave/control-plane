# Control Plane Web Dockerfile
# Multi-stage build for Nuxt 4 SSR production

# ================================
# Stage 1: Build
# ================================
FROM node:22-alpine AS builder

WORKDIR /app

# Enable corepack for pnpm
RUN corepack enable && corepack prepare pnpm@11.13.1 --activate

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

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

# Start the Nuxt server
CMD ["node", ".output/server/index.mjs"]
