#!/bin/bash
# Uninstall Percona Server for MongoDB Operator from K3s

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

echo "Uninstalling Percona MongoDB Operator..."

# Check for existing PerconaServerMongoDB resources
PSMDB_COUNT=$(kubectl get psmdb -n ${NAMESPACE} --no-headers 2>/dev/null | wc -l || echo "0")
if [ "$PSMDB_COUNT" -gt 0 ]; then
    echo ""
    echo "⚠️  WARNING: Found ${PSMDB_COUNT} PerconaServerMongoDB resource(s) in namespace ${NAMESPACE}"
    echo "These databases will become orphaned if you proceed."
    echo ""
    read -p "Do you want to delete all database resources first? [y/N] " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Deleting PerconaServerMongoDB resources..."
        kubectl delete psmdb --all -n ${NAMESPACE} --timeout=300s || true
        echo "Waiting for pods to terminate..."
        kubectl wait --for=delete pod -l app.kubernetes.io/managed-by=percona-server-mongodb-operator -n ${NAMESPACE} --timeout=300s || true
    else
        echo "Aborting uninstall. Delete database resources manually first:"
        echo "  kubectl delete psmdb --all -n ${NAMESPACE}"
        exit 1
    fi
fi

# Delete operator deployment
echo "Removing operator deployment..."
kubectl delete -n ${NAMESPACE} -f https://raw.githubusercontent.com/percona/percona-server-mongodb-operator/v${OPERATOR_VERSION}/deploy/operator.yaml --ignore-not-found=true

# Delete RBAC
echo "Removing RBAC resources..."
kubectl delete -n ${NAMESPACE} -f https://raw.githubusercontent.com/percona/percona-server-mongodb-operator/v${OPERATOR_VERSION}/deploy/rbac.yaml --ignore-not-found=true

# Optionally delete CRDs (this will remove ALL PSMDB resources cluster-wide!)
read -p "Delete CRDs? This will remove ALL PerconaServerMongoDB resources cluster-wide! [y/N] " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Removing CRDs..."
    kubectl delete -f https://raw.githubusercontent.com/percona/percona-server-mongodb-operator/v${OPERATOR_VERSION}/deploy/crd.yaml --ignore-not-found=true
fi

# Optionally delete namespace
read -p "Delete namespace ${NAMESPACE}? [y/N] " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Deleting namespace ${NAMESPACE}..."
    kubectl delete namespace ${NAMESPACE} --ignore-not-found=true
fi

echo ""
echo "✅ Percona MongoDB Operator uninstalled successfully!"
