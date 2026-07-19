# Testing Guide

This document explains how to run tests for the Control Plane API.

## Quick Start

```bash
# Run unit tests (no Docker required)
yarn test:unit

# Run all tests (requires Docker)
./test.sh all
```

## Test Types

### Unit Tests

Unit tests don't require any external services. They test pure functions and logic in isolation.

```bash
yarn test:unit
```

**What's tested:**
- Container name generation
- Load balancer policy validation
- Port assignment logic
- Server distribution (round-robin)
- Environment variable escaping
- Caddy route ID generation
- Health check configuration formatting

### Integration Tests

Integration tests require MongoDB and Redis. Use Docker to run them.

```bash
# Start test environment
./test.sh setup

# Run integration tests
./test.sh integration

# Stop test environment
./test.sh teardown
```

**What's tested:**
- Caddy service (routing, load balancing, health checks)
- Docker executor (container operations via SSH)
- App service (deploy, scale, stop, restart, delete)

## Test Commands

| Command | Description |
|---------|-------------|
| `yarn test:unit` | Run unit tests only |
| `yarn test` | Run all tests (requires DB) |
| `yarn test:watch` | Run tests in watch mode |
| `yarn test:caddy` | Run Caddy service tests only |
| `yarn test:docker` | Run Docker executor tests only |
| `yarn test:app` | Run App service tests only |
| `./test.sh setup` | Start test containers |
| `./test.sh teardown` | Stop test containers |
| `./test.sh all` | Full test suite with auto-setup |

## Test Environment

The test environment uses Docker Compose to run:
- **MongoDB** on port `27018` (to avoid conflicts with dev)
- **Redis** on port `6380`

### Manual Setup (without script)

```bash
# Start test containers
docker compose -f docker-compose.test.yml up -d

# Wait for services
sleep 5

# Run tests with test DB
MONGO_URI="mongodb://localhost:27018" \
MONGO_DB="control_plane_test" \
REDIS_URL="redis://localhost:6380" \
CADDY_ENABLED="false" \
yarn test

# Stop containers
docker compose -f docker-compose.test.yml down -v
```

## Test Configuration

Environment variables for tests:

| Variable | Test Value | Description |
|----------|------------|-------------|
| `MONGO_URI` | `mongodb://localhost:27018` | MongoDB connection |
| `MONGO_DB` | `control_plane_test` | Test database name |
| `REDIS_URL` | `redis://localhost:6380` | Redis connection |
| `CADDY_ENABLED` | `false` | Disable Caddy in tests |
| `NODE_ENV` | `test` | Test environment |

## Writing Tests

### Unit Test Pattern

```typescript
import { expect } from "chai";
import { describe, it } from "mocha";

describe("Feature Name (Unit)", function () {
  it("should do something", () => {
    const result = myFunction(input);
    expect(result).to.equal(expected);
  });
});
```

### Integration Test Pattern

```typescript
import { expect } from "chai";
import { describe, it, beforeEach, afterEach } from "mocha";
import { ObjectId } from "mongodb";
import { useMyRepo } from "../src/resources/my/my.repository";

describe("Feature Name", function () {
  this.timeout(10000);

  // Lazy initialization - repos created after DB connects
  let myRepo: ReturnType<typeof useMyRepo>;
  let testId: ObjectId;

  beforeEach(async () => {
    myRepo = useMyRepo();
    testId = await myRepo.add({ name: "test" });
  });

  afterEach(async () => {
    await myRepo.deleteById(testId);
  });

  it("should do something", async () => {
    const result = await myRepo.getById(testId);
    expect(result).to.exist;
  });
});
```

## Test Coverage

Current test coverage:

| Component | Unit Tests | Integration Tests |
|-----------|------------|-------------------|
| Caddy Service | ✅ | ✅ |
| Docker Executor | ✅ | ✅ |
| App Service | - | ✅ |
| Container Logic | ✅ | - |
| Port Assignment | ✅ | - |
| Server Distribution | ✅ | - |

## CI/CD

For CI pipelines, use:

```yaml
# GitHub Actions example
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      mongo:
        image: mongo:7
        ports:
          - 27017:27017
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: yarn install
      - run: yarn test:unit
      - run: yarn test
        env:
          MONGO_URI: mongodb://localhost:27017
          MONGO_DB: control_plane_test
          REDIS_URL: redis://localhost:6379
          CADDY_ENABLED: false
```

## Troubleshooting

### "Unable to connect to server"

MongoDB isn't running. Either:
1. Start test environment: `./test.sh setup`
2. Or run unit tests only: `yarn test:unit`

### "Connection refused"

Check if containers are running:
```bash
docker ps | grep cp-mongo-test
docker ps | grep cp-redis-test
```

### Slow tests

Integration tests can be slow due to network operations. Use specific test commands to run only what you need:
```bash
yarn test:caddy  # Just Caddy tests
yarn test:app    # Just App service tests
```
