# Control Plane API - Load Testing Suite

Load testing setup using [Grafana k6](https://k6.io/) to test rate limiting and API performance.

## Overview

This suite tests three categories of API endpoints with their respective rate limits:

| Category | Rate Limit | Endpoints |
|----------|------------|-----------|
| **Auth** | 5 req / 15 min | `/api/auth/login`, `/api/auth/token` |
| **General API** | 100 req / min | All `/api/*` endpoints |
| **Heavy Ops** | 10 req / min | Deploy, create cluster, delete cluster |
| **Moderate Ops** | 20 req / min | Sync, update operations |

## Prerequisites

### Install k6

```bash
# macOS
brew install k6

# Linux (Debian/Ubuntu)
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6

# Docker
docker pull grafana/k6
```

### Verify Installation

```bash
k6 version
```

## Quick Start

### 1. Start the API

Make sure the Control Plane API is running:

```bash
cd control-plane-api
yarn dev
```

### 2. Run a Quick Smoke Test

```bash
cd test/load
chmod +x run-tests.sh
./run-tests.sh smoke
```

### 3. Run Auth Tests (No Token Required)

```bash
./run-tests.sh auth
```

### 4. Run CRUD Tests (Token Required)

```bash
API_TOKEN=your_api_token ./run-tests.sh api-crud
```

## Test Scenarios

### `scenarios/auth.js` - Authentication Tests

Tests authentication endpoints with strict rate limiting (5 req / 15 min):

- **Login rate limit test** - Attempts multiple logins to verify 429 response after 5 attempts
- **Auth flow test** - Login → Get /me → Logout cycle
- **Me endpoint load** - High-frequency requests to `/api/auth/me`

```bash
# Basic run
./run-tests.sh auth

# With test credentials
TEST_EMAIL=admin@example.com TEST_PASSWORD=secret ./run-tests.sh auth
```

### `scenarios/api-crud.js` - CRUD Operations

Tests standard CRUD operations with general API rate limit (100 req / min):

- **Read load** - List apps, organizations
- **Write load** - Create, update, delete apps
- **Full CRUD cycle** - Complete create → read → update → delete cycle
- **Rate limit stress** - Intentionally exceeds rate limit

```bash
API_TOKEN=xxx ./run-tests.sh api-crud
```

### `scenarios/heavy-ops.js` - Heavy Operations

Tests resource-intensive operations with heavy rate limit (10 req / min):

- **Deploy operations** - App deploy, redeploy, rollback
- **Cluster operations** - Create, delete, sync clusters
- **Mixed operations** - Alternating heavy/moderate operations
- **Sustained load** - Below-limit sustained traffic

```bash
API_TOKEN=xxx ./run-tests.sh heavy-ops
```

> ⚠️ **Warning:** Heavy ops tests create and delete test resources. Run with caution in non-test environments.

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ENV` | Target environment (`local`, `staging`, `production`) | `local` |
| `API_TOKEN` | API authentication token | - |
| `BASE_URL` | Override API base URL | Per environment |
| `VUS` | Override virtual users count | Per environment |
| `DURATION` | Override test duration | Per environment |
| `TEST_EMAIL` | Test user email for auth tests | `loadtest@example.com` |
| `TEST_PASSWORD` | Test user password | `LoadTest123!` |
| `OUTPUT_DIR` | Results output directory | `./results` |

### Environment Defaults

| Environment | Base URL | VUs | Duration |
|-------------|----------|-----|----------|
| `local` | `http://localhost:3030` | 10 | 1m |
| `staging` | `https://api.staging.control-plane.example.com` | 20 | 2m |
| `production` | `https://api.control-plane.example.com` | 5 | 30s |

## Running Tests

### Run All Scenarios

```bash
./run-tests.sh all
```

### Run Individual Scenarios

```bash
./run-tests.sh auth
./run-tests.sh api-crud
./run-tests.sh heavy-ops
```

### Run with Custom Environment

```bash
ENV=staging API_TOKEN=xxx ./run-tests.sh api-crud
```

### Run k6 Directly

```bash
k6 run -e ENV=local scenarios/auth.js
k6 run -e ENV=local -e API_TOKEN=xxx scenarios/api-crud.js
k6 run -e ENV=local -e API_TOKEN=xxx scenarios/heavy-ops.js
```

### Docker

```bash
docker run --rm -i \
  -e ENV=local \
  -e API_TOKEN=xxx \
  -v $(pwd):/scripts \
  --network host \
  grafana/k6 run /scripts/scenarios/api-crud.js
```

## Understanding Results

### Metrics

| Metric | Description |
|--------|-------------|
| `http_req_duration` | Response time |
| `http_req_failed` | Failed request rate |
| `http_reqs` | Total requests |
| `login_rate_limited` | Count of 429 responses on login |
| `api_rate_limited` | Count of 429 responses on API |
| `heavy_ops_rate_limited` | Count of 429 responses on heavy ops |

### Thresholds

Default thresholds that will cause test failure:

```javascript
thresholds: {
  http_req_duration: ['p(95)<500'],  // 95% of requests under 500ms
  http_req_failed: ['rate<0.1'],     // Less than 10% failures
}
```

### Rate Limit Headers

The API returns rate limit information in response headers:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1690000000
```

The tests parse and log these headers to help understand rate limit behavior.

## Output

Test results are saved to `./results/` as JSON files:

```
results/
├── auth_local_20240101_120000.json
├── api-crud_local_20240101_121500.json
├── heavy-ops_local_20240101_123000.json
└── all_tests_summary_20240101_120000.txt
```

### Viewing Results

The JSON output can be analyzed with:

```bash
# Summary statistics
jq '.metrics.http_req_duration.values' results/auth_local_*.json

# Rate limit counts
jq '.metrics.login_rate_limited.values.count' results/auth_local_*.json
```

## Best Practices

1. **Always run smoke test first** - Verify API is accessible before full tests
2. **Start with local environment** - Test locally before staging/production
3. **Monitor API logs** - Watch for errors during load tests
4. **Use appropriate rate limits** - Don't stress production unnecessarily
5. **Clean up test data** - Heavy ops tests create resources; verify cleanup
6. **Review rate limit hits** - Some 429s are expected; too many indicate issues

## Troubleshooting

### "k6 is not installed"

Install k6 following the [prerequisites](#prerequisites).

### "API health check failed"

Make sure the API is running:

```bash
cd control-plane-api
yarn dev
```

### "401 Unauthorized" on most requests

Provide an API token:

```bash
API_TOKEN=your_token ./run-tests.sh api-crud
```

### "429 Too Many Requests" immediately

The rate limiter may have state from previous tests. Wait for the rate limit window to reset:

- Auth: 15 minutes
- API: 1 minute
- Heavy: 1 minute

Or restart the API to clear Redis rate limit state.

### Tests pass but thresholds fail

Threshold failures (exit code 99) indicate performance degradation. Review:

- `http_req_duration` - Response times too high
- `http_req_failed` - Too many failures
- Check API logs for errors

## File Structure

```
test/load/
├── README.md           # This file
├── k6-config.js        # Shared configuration and utilities
├── run-tests.sh        # Test runner script
├── scenarios/
│   ├── auth.js         # Authentication endpoint tests
│   ├── api-crud.js     # CRUD operation tests
│   └── heavy-ops.js    # Heavy operation tests
└── results/            # Test output (gitignored)
```

## References

- [k6 Documentation](https://k6.io/docs/)
- [k6 Thresholds](https://k6.io/docs/using-k6/thresholds/)
- [k6 Scenarios](https://k6.io/docs/using-k6/scenarios/)
- [Control Plane API Rate Limiting](../../control-plane-api/src/utils/rate-limiter.ts)
