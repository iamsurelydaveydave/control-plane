#!/usr/bin/env bash
#
# run-tests.sh - Run k6 load tests for Control Plane API
#
# Usage:
#   ./run-tests.sh                     # Run all tests with default settings
#   ./run-tests.sh auth                # Run only auth tests
#   ./run-tests.sh api-crud            # Run only CRUD tests
#   ./run-tests.sh heavy-ops           # Run only heavy operation tests
#   ./run-tests.sh all                 # Run all tests sequentially
#
# Environment variables:
#   ENV         - Target environment (local, staging, production) [default: local]
#   API_TOKEN   - API authentication token (required for most tests)
#   BASE_URL    - Override base URL
#   VUS         - Override virtual users count
#   DURATION    - Override test duration
#   TEST_EMAIL  - Test user email for auth tests
#   TEST_PASSWORD - Test user password for auth tests
#   OUTPUT_DIR  - Directory for test results [default: ./results]
#
# Examples:
#   ENV=local API_TOKEN=xxx ./run-tests.sh
#   ENV=staging API_TOKEN=xxx ./run-tests.sh api-crud
#   ENV=production API_TOKEN=xxx VUS=5 ./run-tests.sh auth

set -euo pipefail

# =============================================================================
# Configuration
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCENARIOS_DIR="${SCRIPT_DIR}/scenarios"
OUTPUT_DIR="${OUTPUT_DIR:-${SCRIPT_DIR}/results}"

# Default environment
ENV="${ENV:-local}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# =============================================================================
# Helper Functions
# =============================================================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_banner() {
    echo ""
    echo "============================================================"
    echo " Control Plane API - Load Testing Suite"
    echo "============================================================"
    echo " Environment: ${ENV}"
    echo " Output Dir:  ${OUTPUT_DIR}"
    echo " Timestamp:   $(date '+%Y-%m-%d %H:%M:%S')"
    echo "============================================================"
    echo ""
}

check_k6() {
    if ! command -v k6 &> /dev/null; then
        log_error "k6 is not installed!"
        echo ""
        echo "Install k6:"
        echo "  macOS:    brew install k6"
        echo "  Linux:    sudo apt install k6  # or snap install k6"
        echo "  Windows:  choco install k6"
        echo "  Docker:   docker pull grafana/k6"
        echo ""
        echo "See: https://k6.io/docs/get-started/installation/"
        exit 1
    fi
    log_info "k6 version: $(k6 version)"
}

ensure_output_dir() {
    if [[ ! -d "${OUTPUT_DIR}" ]]; then
        mkdir -p "${OUTPUT_DIR}"
        log_info "Created output directory: ${OUTPUT_DIR}"
    fi
}

# Build k6 command with environment variables
build_k6_cmd() {
    local scenario="$1"
    local cmd="k6 run"
    
    # Add environment variables
    cmd+=" -e ENV=${ENV}"
    
    [[ -n "${API_TOKEN:-}" ]] && cmd+=" -e API_TOKEN=${API_TOKEN}"
    [[ -n "${BASE_URL:-}" ]] && cmd+=" -e BASE_URL=${BASE_URL}"
    [[ -n "${VUS:-}" ]] && cmd+=" -e VUS=${VUS}"
    [[ -n "${DURATION:-}" ]] && cmd+=" -e DURATION=${DURATION}"
    [[ -n "${TEST_EMAIL:-}" ]] && cmd+=" -e TEST_EMAIL=${TEST_EMAIL}"
    [[ -n "${TEST_PASSWORD:-}" ]] && cmd+=" -e TEST_PASSWORD=${TEST_PASSWORD}"
    
    # Output options
    local timestamp=$(date '+%Y%m%d_%H%M%S')
    local result_file="${OUTPUT_DIR}/${scenario}_${ENV}_${timestamp}.json"
    cmd+=" --out json=${result_file}"
    
    # Summary output
    cmd+=" --summary-trend-stats='avg,min,med,max,p(90),p(95),p(99)'"
    
    # Scenario file
    cmd+=" ${SCENARIOS_DIR}/${scenario}.js"
    
    echo "${cmd}"
}

# =============================================================================
# Test Runner Functions
# =============================================================================

run_scenario() {
    local scenario="$1"
    local scenario_file="${SCENARIOS_DIR}/${scenario}.js"
    
    if [[ ! -f "${scenario_file}" ]]; then
        log_error "Scenario not found: ${scenario_file}"
        return 1
    fi
    
    echo ""
    echo "------------------------------------------------------------"
    echo " Running: ${scenario}"
    echo "------------------------------------------------------------"
    
    local cmd=$(build_k6_cmd "${scenario}")
    log_info "Command: ${cmd}"
    echo ""
    
    # Run k6 and capture exit code
    local exit_code=0
    eval "${cmd}" || exit_code=$?
    
    if [[ ${exit_code} -eq 0 ]]; then
        log_success "Scenario ${scenario} completed successfully"
    elif [[ ${exit_code} -eq 99 ]]; then
        log_warning "Scenario ${scenario} completed with threshold violations"
    else
        log_error "Scenario ${scenario} failed with exit code ${exit_code}"
    fi
    
    return ${exit_code}
}

run_auth_tests() {
    log_info "Running authentication endpoint tests..."
    run_scenario "auth"
}

run_crud_tests() {
    log_info "Running CRUD operation tests..."
    
    if [[ -z "${API_TOKEN:-}" ]]; then
        log_warning "API_TOKEN not set - CRUD tests may fail with 401"
    fi
    
    run_scenario "api-crud"
}

run_heavy_tests() {
    log_info "Running heavy operation tests..."
    
    if [[ -z "${API_TOKEN:-}" ]]; then
        log_warning "API_TOKEN not set - heavy operation tests may fail with 401"
    fi
    
    log_warning "This test creates and deletes test resources!"
    echo ""
    
    run_scenario "heavy-ops"
}

run_all_tests() {
    local failed=0
    local timestamp=$(date '+%Y%m%d_%H%M%S')
    local summary_file="${OUTPUT_DIR}/all_tests_summary_${timestamp}.txt"
    
    echo "Running all test scenarios..."
    echo ""
    echo "Test Run Summary - ${timestamp}" > "${summary_file}"
    echo "Environment: ${ENV}" >> "${summary_file}"
    echo "========================================" >> "${summary_file}"
    
    # Auth tests
    echo ""
    if run_auth_tests; then
        echo "auth: PASSED" >> "${summary_file}"
    else
        echo "auth: FAILED" >> "${summary_file}"
        ((failed++)) || true
    fi
    
    # Wait between scenarios
    log_info "Waiting 30 seconds between scenarios..."
    sleep 30
    
    # CRUD tests
    if run_crud_tests; then
        echo "api-crud: PASSED" >> "${summary_file}"
    else
        echo "api-crud: FAILED" >> "${summary_file}"
        ((failed++)) || true
    fi
    
    # Wait between scenarios
    log_info "Waiting 30 seconds between scenarios..."
    sleep 30
    
    # Heavy ops tests
    if run_heavy_tests; then
        echo "heavy-ops: PASSED" >> "${summary_file}"
    else
        echo "heavy-ops: FAILED" >> "${summary_file}"
        ((failed++)) || true
    fi
    
    echo "" >> "${summary_file}"
    echo "Total failed: ${failed}" >> "${summary_file}"
    
    echo ""
    echo "============================================================"
    echo " All Tests Complete"
    echo "============================================================"
    echo " Summary saved to: ${summary_file}"
    echo " Failed scenarios: ${failed}"
    echo "============================================================"
    
    return ${failed}
}

# =============================================================================
# Quick Test Functions
# =============================================================================

run_quick_smoke_test() {
    log_info "Running quick smoke test..."
    
    local base_url="${BASE_URL:-http://localhost:3030}"
    
    echo "Testing API health endpoint..."
    if command -v curl &> /dev/null; then
        local health_status=$(curl -s -o /dev/null -w "%{http_code}" "${base_url}/api/health" || echo "000")
        
        if [[ "${health_status}" == "200" ]]; then
            log_success "API health check passed (${base_url})"
        else
            log_error "API health check failed: HTTP ${health_status}"
            log_error "Make sure the API is running at ${base_url}"
            exit 1
        fi
    else
        log_warning "curl not available, skipping health check"
    fi
}

# =============================================================================
# Help Text
# =============================================================================

show_help() {
    cat << EOF
Control Plane API Load Testing Suite

Usage: $(basename "$0") [COMMAND] [OPTIONS]

Commands:
    auth        Run authentication endpoint tests (login, me, logout)
    api-crud    Run CRUD operation tests (apps, organizations)
    heavy-ops   Run heavy operation tests (deploy, clusters)
    all         Run all test scenarios sequentially
    smoke       Quick smoke test (health check only)
    help        Show this help message

Environment Variables:
    ENV           Target environment: local, staging, production (default: local)
    API_TOKEN     API authentication token (required for most tests)
    BASE_URL      Override the base API URL
    VUS           Override virtual users count
    DURATION      Override test duration
    TEST_EMAIL    Test user email for auth tests
    TEST_PASSWORD Test user password for auth tests
    OUTPUT_DIR    Directory for test results (default: ./results)

Examples:
    # Run all tests locally
    ./run-tests.sh all

    # Run auth tests with credentials
    TEST_EMAIL=admin@example.com TEST_PASSWORD=secret ./run-tests.sh auth

    # Run CRUD tests in staging with token
    ENV=staging API_TOKEN=xxx ./run-tests.sh api-crud

    # Run heavy ops with custom settings
    ENV=production API_TOKEN=xxx VUS=5 ./run-tests.sh heavy-ops

Rate Limits Tested:
    - Auth (login):    5 requests / 15 minutes
    - API (general):   100 requests / minute
    - Heavy ops:       10 requests / minute
    - Moderate ops:    20 requests / minute

Notes:
    - The API must be running before starting tests
    - Production tests use conservative settings by default
    - Test results are saved to OUTPUT_DIR as JSON files
    - heavy-ops tests create and delete test resources - use with caution!

For more information, see: test/load/README.md
EOF
}

# =============================================================================
# Main
# =============================================================================

main() {
    local command="${1:-help}"
    
    # Show help if requested
    if [[ "${command}" == "help" || "${command}" == "-h" || "${command}" == "--help" ]]; then
        show_help
        exit 0
    fi
    
    print_banner
    check_k6
    ensure_output_dir
    
    # Run quick smoke test first
    if [[ "${command}" != "smoke" ]]; then
        run_quick_smoke_test
    fi
    
    case "${command}" in
        auth)
            run_auth_tests
            ;;
        api-crud|crud)
            run_crud_tests
            ;;
        heavy-ops|heavy)
            run_heavy_tests
            ;;
        all)
            run_all_tests
            ;;
        smoke)
            run_quick_smoke_test
            ;;
        *)
            log_error "Unknown command: ${command}"
            echo ""
            show_help
            exit 1
            ;;
    esac
}

main "$@"
