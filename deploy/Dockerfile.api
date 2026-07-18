# Control Plane API Dockerfile
# Multi-stage build for production

# ================================
# Stage 1: Build
# ================================
FROM node:22-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package.json yarn.lock ./

# Install all dependencies (including devDependencies for build)
RUN yarn install --frozen-lockfile

# Copy source code
COPY . .

# Build TypeScript
RUN yarn build

# ================================
# Stage 2: Production
# ================================
FROM node:22-alpine AS production

WORKDIR /app

# Install runtime dependencies only
RUN apk add --no-cache \
    openssh-client \
    ansible \
    sshpass \
    python3 \
    py3-pip \
    git \
    curl \
    && pip3 install --break-system-packages pymongo docker

# Create non-root user
RUN addgroup -g 9999 controlplane && \
    adduser -D -u 9999 -G controlplane controlplane

# Copy package files
COPY package.json yarn.lock ./

# Install production dependencies only
RUN yarn install --frozen-lockfile --production && \
    yarn cache clean

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Copy Ansible playbooks
COPY ansible ./ansible

# Create necessary directories
RUN mkdir -p /data/control-plane/{ssh,logs,backups} && \
    chown -R controlplane:controlplane /data/control-plane

# Set environment
ENV NODE_ENV=production
ENV PORT=5005

# Expose port
EXPOSE 5005

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:5005/api/health || exit 1

# Run as non-root user
USER controlplane

# Start the application
CMD ["node", "dist/server.js"]
