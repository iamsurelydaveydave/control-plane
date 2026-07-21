#!/bin/bash
# Install Percona Server for MongoDB Operator on K3s

set -e

# Configuration
NAMESPACE="cp-databases"
OPERATOR_VERSION="1.16.0"

# Check if kubectl is available
if ! command -v kubectl &> /dev/null; then
    echo "Error: kubectl is not installed"
    exit 1
fi

# Check if cluster is accessible
if ! kubectl cluster-info &> /dev/null; then
    echo "Error: Cannot connect to Kubernetes cluster"
    exit 1
fi

echo "Installing Percona MongoDB Operator v${OPERATOR_VERSION}..."

# Create namespace
kubectl create namespace ${NAMESPACE} --dry-run=client -o yaml | kubectl apply -f -

# Add CRDs
kubectl apply --server-side -f https://raw.githubusercontent.com/percona/percona-server-mongodb-operator/v${OPERATOR_VERSION}/deploy/crd.yaml

# Create RBAC
kubectl apply -n ${NAMESPACE} -f https://raw.githubusercontent.com/percona/percona-server-mongodb-operator/v${OPERATOR_VERSION}/deploy/rbac.yaml

# Deploy operator
kubectl apply -n ${NAMESPACE} -f https://raw.githubusercontent.com/percona/percona-server-mongodb-operator/v${OPERATOR_VERSION}/deploy/operator.yaml

# Wait for operator to be ready
echo "Waiting for operator to be ready..."
kubectl wait --for=condition=available --timeout=120s deployment/percona-server-mongodb-operator -n ${NAMESPACE}

echo "✅ Percona MongoDB Operator installed successfully!"
echo ""
echo "Namespace: ${NAMESPACE}"
echo "Operator version: ${OPERATOR_VERSION}"

# Show operator status
kubectl get pods -n ${NAMESPACE}
