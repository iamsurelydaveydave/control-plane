# MongoDB Backup Image
# Contains mongodump (MongoDB Database Tools) + AWS CLI v2
# Used by the mongodb-replicaset Helm chart backup CronJob.
#
# Build:
#   docker build --platform linux/amd64,linux/arm64 \
#     -t ghcr.io/<your-org>/cp-mongodb-backup:7.0 \
#     deploy/docker/mongodb-backup/
#
# Push:
#   docker push ghcr.io/<your-org>/cp-mongodb-backup:7.0
#
# Then set in values.yaml:
#   backup.image.repository: ghcr.io/<your-org>/cp-mongodb-backup
#   backup.image.tag: "7.0"

FROM debian:bookworm-slim

ARG TARGETARCH

# Install MongoDB Database Tools (mongodump, mongorestore, etc.)
# and AWS CLI v2 in a single layer to minimise image size.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        gnupg \
        curl \
        unzip \
    ; \
    # --- MongoDB Database Tools ---
    curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc \
        | gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor; \
    echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] \
          https://repo.mongodb.org/apt/debian bookworm/mongodb-org/7.0 main" \
        > /etc/apt/sources.list.d/mongodb-org-7.0.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends mongodb-database-tools; \
    # --- AWS CLI v2 (multi-arch) ---
    case "${TARGETARCH}" in \
        arm64) AWS_ARCH="aarch64" ;; \
        *)     AWS_ARCH="x86_64"  ;; \
    esac; \
    curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-${AWS_ARCH}.zip" -o awscliv2.zip; \
    unzip -q awscliv2.zip; \
    ./aws/install; \
    # --- Cleanup ---
    rm -rf awscliv2.zip aws; \
    apt-get remove -y gnupg unzip; \
    apt-get autoremove -y; \
    rm -rf /var/lib/apt/lists/*

# Smoke-test: both tools must be on PATH
RUN mongodump --version && aws --version

CMD ["/bin/bash"]
