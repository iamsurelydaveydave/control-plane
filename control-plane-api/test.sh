#!/bin/bash

# Control Plane API - Test Runner
# Usage: ./test.sh [unit|integration|all|setup|teardown]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test environment configuration
export MONGO_URI="mongodb://localhost:27018"
export MONGO_DB="control_plane_test"
export REDIS_URL="redis://localhost:6380"
export NODE_ENV="test"
export CADDY_ENABLED="false"  # Disable Caddy for tests

function print_header() {
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}$1${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
}

function print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

function print_error() {
    echo -e "${RED}❌ $1${NC}"
}

function print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

function setup_test_env() {
    print_header "Setting up test environment"
    
    # Check if Docker is running
    if ! docker info > /dev/null 2>&1; then
        print_error "Docker is not running. Please start Docker and try again."
        exit 1
    fi
    
    # Start test containers
    echo "Starting MongoDB and Redis containers..."
    docker compose -f docker-compose.test.yml up -d
    
    # Wait for services to be healthy
    echo "Waiting for services to be ready..."
    
    # Wait for MongoDB
    echo -n "  MongoDB: "
    for i in {1..30}; do
        if docker exec cp-mongo-test mongosh --eval "db.adminCommand('ping')" > /dev/null 2>&1; then
            echo "ready"
            break
        fi
        if [ $i -eq 30 ]; then
            print_error "MongoDB failed to start"
            exit 1
        fi
        sleep 1
        echo -n "."
    done
    
    # Wait for Redis
    echo -n "  Redis: "
    for i in {1..30}; do
        if docker exec cp-redis-test redis-cli ping > /dev/null 2>&1; then
            echo "ready"
            break
        fi
        if [ $i -eq 30 ]; then
            print_error "Redis failed to start"
            exit 1
        fi
        sleep 1
        echo -n "."
    done
    
    print_success "Test environment ready"
}

function teardown_test_env() {
    print_header "Tearing down test environment"
    
    docker compose -f docker-compose.test.yml down -v
    
    print_success "Test environment stopped"
}

function run_unit_tests() {
    print_header "Running Unit Tests"
    
    yarn test:unit
    
    print_success "Unit tests completed"
}

function run_integration_tests() {
    print_header "Running Integration Tests"
    
    # Ensure test environment is running
    if ! docker ps | grep -q cp-mongo-test; then
        print_warning "Test environment not running. Starting it now..."
        setup_test_env
    fi
    
    # Run all tests
    yarn test
    
    print_success "Integration tests completed"
}

function run_all_tests() {
    print_header "Running All Tests"
    
    # Run unit tests first (fast, no deps)
    run_unit_tests
    
    # Then run integration tests
    run_integration_tests
    
    print_success "All tests completed"
}

function show_usage() {
    echo "Usage: ./test.sh [command]"
    echo ""
    echo "Commands:"
    echo "  unit        Run unit tests only (no Docker required)"
    echo "  integration Run integration tests (requires Docker)"
    echo "  all         Run all tests (default)"
    echo "  setup       Start test environment (MongoDB + Redis)"
    echo "  teardown    Stop test environment"
    echo "  watch       Run tests in watch mode"
    echo "  coverage    Run tests with coverage report"
    echo ""
    echo "Examples:"
    echo "  ./test.sh              # Run all tests"
    echo "  ./test.sh unit         # Run only unit tests"
    echo "  ./test.sh setup        # Start test containers"
    echo "  ./test.sh teardown     # Stop test containers"
}

function run_watch_mode() {
    print_header "Running Tests in Watch Mode"
    
    # Ensure test environment is running
    if ! docker ps | grep -q cp-mongo-test; then
        print_warning "Test environment not running. Starting it now..."
        setup_test_env
    fi
    
    yarn test:watch
}

function run_coverage() {
    print_header "Running Tests with Coverage"
    
    # Ensure test environment is running
    if ! docker ps | grep -q cp-mongo-test; then
        print_warning "Test environment not running. Starting it now..."
        setup_test_env
    fi
    
    # Check if c8 is installed
    if ! yarn list --pattern c8 --depth=0 2>/dev/null | grep -q c8; then
        print_warning "Coverage tool (c8) is not installed."
        echo "To enable coverage, run:"
        echo "  yarn add -D c8"
        echo ""
        echo "Then you can run tests with coverage using:"
        echo "  npx c8 yarn test"
        echo ""
        echo "Running tests without coverage for now..."
        yarn test
        return
    fi
    
    # Run with c8 coverage
    npx c8 --reporter=text --reporter=html yarn test
    
    print_success "Coverage report generated in ./coverage/"
}

# Main command handler
case "${1:-all}" in
    unit)
        run_unit_tests
        ;;
    integration)
        run_integration_tests
        ;;
    all)
        run_all_tests
        ;;
    setup)
        setup_test_env
        ;;
    teardown)
        teardown_test_env
        ;;
    watch)
        run_watch_mode
        ;;
    coverage)
        run_coverage
        ;;
    help|--help|-h)
        show_usage
        ;;
    *)
        print_error "Unknown command: $1"
        show_usage
        exit 1
        ;;
esac
