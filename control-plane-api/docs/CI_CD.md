# CI/CD Integration

Control Plane supports automated deployments via API tokens, enabling integration with CI/CD systems like GitHub Actions, GitLab CI, Jenkins, and custom scripts.

## Quick Start

1. **Create an API Token** — Go to Settings → API Tokens and create a token with `deployments:write` scope
2. **Configure Your CI/CD** — Use the token to trigger deployments via HTTP requests
3. **Optional: Enable GitHub Integration** — Link your repository for auto-deploy on push

---

## GitHub Actions

### Deploy on Push to Main

```yaml
name: Deploy to Control Plane

on:
  push:
    branches: [main]

env:
  CONTROL_PLANE_URL: ${{ secrets.CONTROL_PLANE_URL }}  # e.g., https://cp.example.com
  CONTROL_PLANE_TOKEN: ${{ secrets.CONTROL_PLANE_TOKEN }}
  APP_ID: ${{ secrets.CONTROL_PLANE_APP_ID }}

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Deploy to Control Plane
        run: |
          RESPONSE=$(curl -s -X POST \
            -H "Authorization: Bearer $CONTROL_PLANE_TOKEN" \
            -H "Content-Type: application/json" \
            -d '{"version": "${{ github.sha }}"}' \
            "$CONTROL_PLANE_URL/api/apps/$APP_ID/deploy")
          
          echo "$RESPONSE" | jq .
          
          # Check for errors
          if echo "$RESPONSE" | jq -e '.error' > /dev/null 2>&1; then
            echo "Deployment failed!"
            exit 1
          fi

      - name: Wait for Deployment
        run: |
          echo "Waiting for deployment to complete..."
          for i in {1..60}; do
            STATUS=$(curl -s -H "Authorization: Bearer $CONTROL_PLANE_TOKEN" \
              "$CONTROL_PLANE_URL/api/apps/$APP_ID/deployments/latest" | jq -r '.status')
            
            echo "Status: $STATUS"
            
            if [ "$STATUS" = "success" ]; then
              echo "Deployment successful!"
              exit 0
            elif [ "$STATUS" = "failed" ]; then
              echo "Deployment failed!"
              exit 1
            fi
            
            sleep 5
          done
          
          echo "Deployment timed out"
          exit 1
```

### Deploy with Environment Selection

```yaml
name: Deploy to Environment

on:
  workflow_dispatch:
    inputs:
      environment:
        description: 'Target environment'
        required: true
        type: choice
        options:
          - development
          - staging
          - production

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: ${{ github.event.inputs.environment }}
    steps:
      - name: Deploy to Control Plane
        run: |
          curl -X POST \
            -H "Authorization: Bearer ${{ secrets.CONTROL_PLANE_TOKEN }}" \
            -H "Content-Type: application/json" \
            -d '{
              "version": "${{ github.sha }}",
              "environment": "${{ github.event.inputs.environment }}"
            }' \
            "${{ secrets.CONTROL_PLANE_URL }}/api/apps/${{ secrets.APP_ID }}/deploy"
```

### Production Deployment with Approval

```yaml
name: Production Deploy

on:
  workflow_dispatch:

jobs:
  request-approval:
    runs-on: ubuntu-latest
    outputs:
      approval_id: ${{ steps.request.outputs.approval_id }}
    steps:
      - name: Request Deployment Approval
        id: request
        run: |
          RESPONSE=$(curl -s -X POST \
            -H "Authorization: Bearer ${{ secrets.CONTROL_PLANE_TOKEN }}" \
            -H "Content-Type: application/json" \
            -d '{"version": "${{ github.sha }}", "environment": "production"}' \
            "${{ secrets.CONTROL_PLANE_URL }}/api/apps/${{ secrets.APP_ID }}/deploy/request")
          
          APPROVAL_ID=$(echo "$RESPONSE" | jq -r '.approvalId')
          echo "approval_id=$APPROVAL_ID" >> "$GITHUB_OUTPUT"
          echo "Approval requested: $APPROVAL_ID"

  deploy:
    needs: request-approval
    runs-on: ubuntu-latest
    environment: production  # Requires GitHub environment approval
    steps:
      - name: Approve and Deploy
        run: |
          # Approve the deployment
          curl -X POST \
            -H "Authorization: Bearer ${{ secrets.CONTROL_PLANE_TOKEN }}" \
            "${{ secrets.CONTROL_PLANE_URL }}/api/deployments/${{ needs.request-approval.outputs.approval_id }}/approve"
```

---

## GitLab CI

### Deploy on Merge to Main

```yaml
# .gitlab-ci.yml
stages:
  - deploy

deploy-production:
  stage: deploy
  image: curlimages/curl:latest
  only:
    - main
  script:
    - |
      curl -X POST \
        -H "Authorization: Bearer ${CONTROL_PLANE_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "{\"version\": \"${CI_COMMIT_SHA}\"}" \
        "${CONTROL_PLANE_URL}/api/apps/${CONTROL_PLANE_APP_ID}/deploy"
  environment:
    name: production
    url: https://myapp.example.com
```

### Multi-Environment Pipeline

```yaml
# .gitlab-ci.yml
stages:
  - deploy-staging
  - deploy-production

.deploy-template:
  image: curlimages/curl:latest
  script:
    - |
      curl -X POST \
        -H "Authorization: Bearer ${CONTROL_PLANE_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "{\"version\": \"${CI_COMMIT_SHA}\", \"environment\": \"${DEPLOY_ENV}\"}" \
        "${CONTROL_PLANE_URL}/api/apps/${APP_ID}/deploy"

deploy-staging:
  extends: .deploy-template
  stage: deploy-staging
  variables:
    DEPLOY_ENV: staging
    APP_ID: ${STAGING_APP_ID}
  only:
    - main
  environment:
    name: staging

deploy-production:
  extends: .deploy-template
  stage: deploy-production
  variables:
    DEPLOY_ENV: production
    APP_ID: ${PRODUCTION_APP_ID}
  only:
    - main
  when: manual
  environment:
    name: production
```

---

## Jenkins

### Jenkinsfile Example

```groovy
pipeline {
    agent any
    
    environment {
        CONTROL_PLANE_URL = credentials('control-plane-url')
        CONTROL_PLANE_TOKEN = credentials('control-plane-token')
        APP_ID = credentials('control-plane-app-id')
    }
    
    stages {
        stage('Build') {
            steps {
                sh 'docker build -t myapp:${GIT_COMMIT} .'
                sh 'docker push myapp:${GIT_COMMIT}'
            }
        }
        
        stage('Deploy') {
            steps {
                script {
                    def response = sh(
                        script: """
                            curl -s -X POST \
                                -H "Authorization: Bearer ${CONTROL_PLANE_TOKEN}" \
                                -H "Content-Type: application/json" \
                                -d '{"version": "${GIT_COMMIT}"}' \
                                "${CONTROL_PLANE_URL}/api/apps/${APP_ID}/deploy"
                        """,
                        returnStdout: true
                    ).trim()
                    
                    echo "Deployment response: ${response}"
                }
            }
        }
        
        stage('Verify') {
            steps {
                script {
                    timeout(time: 5, unit: 'MINUTES') {
                        waitUntil {
                            def status = sh(
                                script: """
                                    curl -s -H "Authorization: Bearer ${CONTROL_PLANE_TOKEN}" \
                                        "${CONTROL_PLANE_URL}/api/apps/${APP_ID}/deployments/latest" \
                                        | jq -r '.status'
                                """,
                                returnStdout: true
                            ).trim()
                            
                            echo "Deployment status: ${status}"
                            return status == 'success' || status == 'failed'
                        }
                    }
                }
            }
        }
    }
}
```

---

## CLI / Shell Script

### Simple Deploy Script

```bash
#!/bin/bash
# deploy.sh — Deploy an app to Control Plane
# Usage: ./deploy.sh <app-id> [version]

set -e

API_URL="${CONTROL_PLANE_URL:-http://localhost:5005}"
TOKEN="${CONTROL_PLANE_TOKEN}"
APP_ID="$1"
VERSION="${2:-latest}"

if [ -z "$TOKEN" ]; then
  echo "Error: CONTROL_PLANE_TOKEN environment variable not set"
  exit 1
fi

if [ -z "$APP_ID" ]; then
  echo "Usage: $0 <app-id> [version]"
  exit 1
fi

echo "Deploying version '$VERSION' to app '$APP_ID'..."

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"version\": \"$VERSION\"}" \
  "$API_URL/api/apps/$APP_ID/deploy")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo "$BODY" | jq . 2>/dev/null || echo "$BODY"

if [ "$HTTP_CODE" -ge 400 ]; then
  echo "Error: HTTP $HTTP_CODE"
  exit 1
fi

echo "Deployment triggered successfully!"
```

### Check Deployment Status

```bash
#!/bin/bash
# status.sh — Check latest deployment status
# Usage: ./status.sh <app-id>

API_URL="${CONTROL_PLANE_URL:-http://localhost:5005}"
TOKEN="${CONTROL_PLANE_TOKEN}"
APP_ID="$1"

if [ -z "$APP_ID" ]; then
  echo "Usage: $0 <app-id>"
  exit 1
fi

curl -s -H "Authorization: Bearer $TOKEN" \
  "$API_URL/api/apps/$APP_ID/deployments/latest" | jq .
```

### Wait for Deployment

```bash
#!/bin/bash
# wait-deploy.sh — Wait for deployment to complete
# Usage: ./wait-deploy.sh <app-id> [timeout-seconds]

API_URL="${CONTROL_PLANE_URL:-http://localhost:5005}"
TOKEN="${CONTROL_PLANE_TOKEN}"
APP_ID="$1"
TIMEOUT="${2:-300}"

if [ -z "$APP_ID" ]; then
  echo "Usage: $0 <app-id> [timeout-seconds]"
  exit 1
fi

echo "Waiting for deployment (timeout: ${TIMEOUT}s)..."

END=$((SECONDS + TIMEOUT))
while [ $SECONDS -lt $END ]; do
  STATUS=$(curl -s -H "Authorization: Bearer $TOKEN" \
    "$API_URL/api/apps/$APP_ID/deployments/latest" | jq -r '.status')
  
  echo "Status: $STATUS"
  
  case "$STATUS" in
    success)
      echo "✓ Deployment succeeded!"
      exit 0
      ;;
    failed)
      echo "✗ Deployment failed!"
      exit 1
      ;;
  esac
  
  sleep 5
done

echo "Timeout waiting for deployment"
exit 1
```

---

## API Reference

### Trigger Deployment

```http
POST /api/apps/:id/deploy
Authorization: Bearer <token>
Content-Type: application/json

{
  "version": "v1.2.0",           // Optional: version/tag to deploy
  "environment": "production"    // Optional: target environment
}
```

**Response:**
```json
{
  "message": "Deployment started",
  "appId": "...",
  "deploymentId": "...",
  "version": "v1.2.0"
}
```

### Get Latest Deployment Status

```http
GET /api/apps/:id/deployments/latest
Authorization: Bearer <token>
```

**Response:**
```json
{
  "deploymentId": "...",
  "status": "running",
  "startedAt": "2024-01-15T10:00:00Z",
  "completedAt": null,
  "version": "v1.2.0",
  "logs": "Pulling image...\nStarting container..."
}
```

### Get Specific Deployment

```http
GET /api/apps/:id/deployments/:deploymentId/status
Authorization: Bearer <token>
```

### Request Deployment Approval (Production)

```http
POST /api/apps/:id/deploy/request
Authorization: Bearer <token>
Content-Type: application/json

{
  "version": "v1.2.0",
  "environment": "production"
}
```

**Response:**
```json
{
  "message": "Deployment approval requested",
  "approvalId": "...",
  "status": "pending"
}
```

### Approve/Reject Deployment

```http
POST /api/deployments/:approvalId/approve
POST /api/deployments/:approvalId/reject
Authorization: Bearer <token>
```

### Deployment History

```http
GET /api/apps/:id/deployments?limit=10
Authorization: Bearer <token>
```

---

## Webhooks

Control Plane can send webhooks when deployments complete. Configure webhooks in Settings → Webhooks.

### Deployment Completed Webhook

```json
{
  "event": "app.deployed",
  "timestamp": "2024-01-15T10:05:00Z",
  "data": {
    "appId": "...",
    "appName": "my-app",
    "deploymentId": "...",
    "status": "success",
    "version": "v1.2.0",
    "duration": 45000,
    "environment": "production",
    "url": "https://my-app.example.com"
  }
}
```

### Deployment Failed Webhook

```json
{
  "event": "app.failed",
  "timestamp": "2024-01-15T10:05:00Z",
  "data": {
    "appId": "...",
    "appName": "my-app",
    "deploymentId": "...",
    "status": "failed",
    "version": "v1.2.0",
    "error": "Image pull failed: unauthorized",
    "logs": "..."
  }
}
```

---

## GitHub App Integration

For automatic deployments when you push to GitHub, you can link your repository:

1. Go to the App's Settings → CI/CD
2. Enable "GitHub Integration"
3. Enter your repository (owner/repo)
4. Select the branch to deploy from
5. Optionally enable "Auto-deploy on push"

When enabled, Control Plane will:
- Receive push events via webhook
- Automatically trigger deployments for the configured branch
- Update GitHub deployment status (pending → success/failure)

### Required GitHub App Permissions

If you're setting up the GitHub App yourself:
- **Repository permissions:**
  - Contents: Read
  - Deployments: Read & Write
  - Metadata: Read
- **Webhook events:**
  - Push

---

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `CONTROL_PLANE_URL` | Base URL of Control Plane API | Yes |
| `CONTROL_PLANE_TOKEN` | API token with `deployments:write` scope | Yes |
| `CONTROL_PLANE_APP_ID` | ID of the app to deploy | Yes |

---

## Required Token Scopes

| Operation | Required Scope |
|-----------|---------------|
| Trigger deployment | `deployments:write` |
| Check deployment status | `deployments:read` |
| Request approval | `deployments:write` |
| Approve/reject | `deployments:write` (admin only) |
| View app details | `apps:read` |

---

## Troubleshooting

### Common Issues

**401 Unauthorized**
- Check that `CONTROL_PLANE_TOKEN` is set correctly
- Verify the token hasn't expired
- Ensure the token has the required scopes

**403 Forbidden**
- The token may not have the required scope for this operation
- For approvals, you may need admin privileges

**404 Not Found**
- Verify the `APP_ID` is correct
- Ensure the app exists in Control Plane

**409 Conflict**
- A deployment is already in progress
- Wait for the current deployment to complete

### Debug Mode

Add `-v` to curl commands for verbose output:
```bash
curl -v -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"version": "v1.0.0"}' \
  "$API_URL/api/apps/$APP_ID/deploy"
```
