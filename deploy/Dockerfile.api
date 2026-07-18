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
    curl

# Copy package files
COPY package.json yarn.lock ./

# Install production dependencies only
RUN yarn install --frozen-lockfile --production && \
    yarn cache clean

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Copy Ansible playbooks if they exist
COPY --from=builder /app/ansible ./ansible 2>/dev/null || true

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

# Start the application
CMD ["node", "dist/server.js"]
