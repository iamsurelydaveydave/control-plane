# Control Plane API Dockerfile
# Multi-stage build for production

# Build arguments for metadata
ARG VERSION=dev
ARG BUILD_DATE
ARG VCS_REF

# ================================
# Stage 1: Dependencies
# ================================
FROM node:22-alpine AS deps

WORKDIR /app

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++

# Copy package files first for better layer caching
COPY package.json yarn.lock ./

# Install all dependencies (including devDependencies for build)
RUN yarn install --frozen-lockfile

# ================================
# Stage 2: Build
# ================================
FROM deps AS builder

WORKDIR /app

# Copy source code
COPY . .

# Build TypeScript
RUN yarn build

# ================================
# Stage 2: Production
# ================================
FROM node:22-alpine AS production

# Re-declare ARGs so they're available in this stage
ARG VERSION=dev
ARG BUILD_DATE
ARG VCS_REF

WORKDIR /app

# Install runtime dependencies only
RUN apk add --no-cache \
    openssh-client \
    curl

# Copy package files
COPY package.json yarn.lock ./

# Install production dependencies only
RUN yarn install --frozen-lockfile --production && \
    yarn cache clean

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Create necessary directories with proper permissions
RUN mkdir -p /app/logs /data/control-plane/ssh /data/control-plane/logs && \
    chown -R node:node /app /data/control-plane

# Set environment
ENV NODE_ENV=production
ENV PORT=5005

# Expose port
EXPOSE 5005

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:5005/api/health || exit 1

# Run as non-root user
USER node

# Labels for metadata
LABEL org.opencontainers.image.title="Control Plane API" \
      org.opencontainers.image.description="Control Plane API Server" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.source="https://github.com/goweekdays/control-plane"

# Start the application
CMD ["node", "dist/server.js"]
