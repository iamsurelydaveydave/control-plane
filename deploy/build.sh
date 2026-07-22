#!/bin/bash
# =============================================================================
# Multi-architecture Docker Build Script (API only)
# Builds and pushes images for both amd64 and arm64
# =============================================================================

set -e

# Configuration
REGISTRY="${REGISTRY:-ghcr.io}"
OWNER="${OWNER:-iamsurelydaveydave}"
VERSION="${VERSION:-latest}"
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"

# Image names
API_IMAGE="$REGISTRY/$OWNER/control-plane-api"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}[BUILD]${NC} $1"; }
log_success() { echo -e "${GREEN}[BUILD] ✓${NC} $1"; }
log_error() { echo -e "${RED}[BUILD] ✗${NC} $1"; }

# ---------------------------------------------------------------------------
# Check prerequisites
# ---------------------------------------------------------------------------

if ! docker buildx version >/dev/null 2>&1; then
    log_error "Docker buildx is required for multi-arch builds"
    log "Install with: docker buildx install"
    exit 1
fi

# ---------------------------------------------------------------------------
# Create/use buildx builder with multi-arch support
# ---------------------------------------------------------------------------

BUILDER_NAME="control-plane-builder"

if ! docker buildx inspect "$BUILDER_NAME" >/dev/null 2>&1; then
    log "Creating buildx builder: $BUILDER_NAME"
    docker buildx create --name "$BUILDER_NAME" --driver docker-container --bootstrap
fi

docker buildx use "$BUILDER_NAME"

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------

PUSH=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --push)      PUSH=true;     shift ;;
        --version)   VERSION="$2";  shift 2 ;;
        --platform)  PLATFORMS="$2"; shift 2 ;;
        *)           log_error "Unknown option: $1"; exit 1 ;;
    esac
done

# ---------------------------------------------------------------------------
# Build options
# ---------------------------------------------------------------------------

BUILD_OPTS="--platform $PLATFORMS"

if [ "$PUSH" = true ]; then
    BUILD_OPTS="$BUILD_OPTS --push"
    log "Will push images to registry"
else
    BUILD_OPTS="$BUILD_OPTS --load"
    # --load only works with single platform
    if [[ "$PLATFORMS" == *","* ]]; then
        log_error "--load doesn't support multi-platform. Use --push or specify single --platform"
        log "Example: ./build.sh --platform linux/amd64"
        log "Example: ./build.sh --push"
        exit 1
    fi
fi

# ---------------------------------------------------------------------------
# Build API
# ---------------------------------------------------------------------------

log "Building API image: $API_IMAGE:$VERSION"
log "Platforms: $PLATFORMS"

docker buildx build \
    $BUILD_OPTS \
    -t "$API_IMAGE:$VERSION" \
    -t "$API_IMAGE:latest" \
    -f deploy/Dockerfile.api \
    control-plane-api/

log_success "API image built: $API_IMAGE:$VERSION"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

echo ""
echo -e "${GREEN}Build complete!${NC}"
echo ""
echo "Image:"
echo "  - $API_IMAGE:$VERSION"
echo ""
echo "Platforms: $PLATFORMS"
echo ""

if [ "$PUSH" = true ]; then
    echo "Image pushed to registry."
else
    echo "To push image, run with --push flag:"
    echo "  ./deploy/build.sh --push"
fi
