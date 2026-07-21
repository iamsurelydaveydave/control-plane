import { useKubernetesService } from "./kubernetes.service";
import { logger } from "../utils";

/**
 * Percona MongoDB Operator configuration
 */
export const PERCONA_CONFIG = {
  namespace: "cp-databases",
  deploymentName: "percona-server-mongodb-operator",
  group: "psmdb.percona.com",
  version: "v1",
  plural: "perconaservermongodbs",
  defaultVersion: "1.16.0",
} as const;

export type TPerconaOperatorStatus = "running" | "pending" | "failed" | "unknown";

export type TPerconaOperatorInfo = {
  installed: boolean;
  version: string | null;
  namespace: string;
  status: TPerconaOperatorStatus;
  replicas?: {
    desired: number;
    ready: number;
    available: number;
  };
  error?: string;
};

/**
 * Service for managing the Percona MongoDB Operator
 */
export function usePerconaService() {
  const k8s = useKubernetesService();

  /**
   * Check if the Percona MongoDB Operator is installed and running
   */
  async function isOperatorInstalled(): Promise<boolean> {
    try {
      const deployment = await k8s.getDeployment(
        PERCONA_CONFIG.deploymentName,
        PERCONA_CONFIG.namespace
      );
      return deployment !== null;
    } catch (err: any) {
      // 404 means not found - operator is not installed
      if (err.statusCode === 404 || err.message?.includes("not found")) {
        return false;
      }
      // Other errors might indicate the namespace doesn't exist
      logger.log({
        level: "warn",
        message: `[Percona] Error checking operator installation: ${err.message}`,
      });
      return false;
    }
  }

  /**
   * Get the installed operator version from the deployment image tag
   */
  async function getOperatorVersion(): Promise<string | null> {
    try {
      const deployment = await k8s.getDeployment(
        PERCONA_CONFIG.deploymentName,
        PERCONA_CONFIG.namespace
      );

      if (!deployment) {
        return null;
      }

      // Extract version from container image
      // Image format: percona/percona-server-mongodb-operator:1.16.0
      const containers = (deployment as any).spec?.template?.spec?.containers || [];
      const operatorContainer = containers.find(
        (c: any) => c.name === PERCONA_CONFIG.deploymentName || c.name === "percona-server-mongodb-operator"
      );

      if (operatorContainer?.image) {
        const imageTag = operatorContainer.image.split(":").pop();
        // Remove 'v' prefix if present
        return imageTag?.replace(/^v/, "") || null;
      }

      return null;
    } catch (err: any) {
      logger.log({
        level: "warn",
        message: `[Percona] Error getting operator version: ${err.message}`,
      });
      return null;
    }
  }

  /**
   * Get detailed operator status
   */
  async function getOperatorStatus(): Promise<TPerconaOperatorInfo> {
    const result: TPerconaOperatorInfo = {
      installed: false,
      version: null,
      namespace: PERCONA_CONFIG.namespace,
      status: "unknown",
    };

    try {
      // First check if K8s is available
      const k8sAvailable = await k8s.isAvailable();
      if (!k8sAvailable) {
        result.error = "Kubernetes cluster is not available";
        return result;
      }

      // Get deployment
      const deployment = await k8s.getDeployment(
        PERCONA_CONFIG.deploymentName,
        PERCONA_CONFIG.namespace
      );

      if (!deployment) {
        result.error = "Operator deployment not found";
        return result;
      }

      result.installed = true;

      // Extract version from image
      const containers = (deployment as any).spec?.template?.spec?.containers || [];
      const operatorContainer = containers.find(
        (c: any) => c.name === PERCONA_CONFIG.deploymentName || c.name === "percona-server-mongodb-operator"
      );
      if (operatorContainer?.image) {
        const imageTag = operatorContainer.image.split(":").pop();
        result.version = imageTag?.replace(/^v/, "") || null;
      }

      // Get replica status
      const status = (deployment as any).status || {};
      result.replicas = {
        desired: status.replicas || 0,
        ready: status.readyReplicas || 0,
        available: status.availableReplicas || 0,
      };

      // Determine status based on deployment conditions and replicas
      const conditions = status.conditions || [];
      const availableCondition = conditions.find(
        (c: any) => c.type === "Available"
      );
      const progressingCondition = conditions.find(
        (c: any) => c.type === "Progressing"
      );

      if (availableCondition?.status === "True" && result.replicas.ready > 0) {
        result.status = "running";
      } else if (progressingCondition?.status === "True") {
        result.status = "pending";
      } else if (availableCondition?.status === "False") {
        result.status = "failed";
        result.error = availableCondition.message || "Deployment not available";
      } else {
        result.status = "unknown";
      }

      return result;
    } catch (err: any) {
      // Check for specific error types
      if (err.statusCode === 404 || err.message?.includes("not found")) {
        result.error = "Operator deployment not found";
      } else if (err.statusCode === 403) {
        result.error = "Insufficient permissions to check operator status";
      } else {
        result.error = err.message || "Failed to get operator status";
      }

      logger.log({
        level: "warn",
        message: `[Percona] Error getting operator status: ${result.error}`,
      });

      return result;
    }
  }

  /**
   * List all PerconaServerMongoDB resources in the namespace
   */
  async function listDatabases(): Promise<any[]> {
    try {
      return await k8s.listCustomResources(
        PERCONA_CONFIG.group,
        PERCONA_CONFIG.version,
        PERCONA_CONFIG.namespace,
        PERCONA_CONFIG.plural
      );
    } catch (err: any) {
      logger.log({
        level: "warn",
        message: `[Percona] Error listing databases: ${err.message}`,
      });
      return [];
    }
  }

  /**
   * Get a specific PerconaServerMongoDB resource by name
   */
  async function getDatabase(name: string): Promise<any | null> {
    try {
      return await k8s.getCustomResource(
        PERCONA_CONFIG.group,
        PERCONA_CONFIG.version,
        PERCONA_CONFIG.namespace,
        PERCONA_CONFIG.plural,
        name
      );
    } catch (err: any) {
      if (err.statusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  return {
    isOperatorInstalled,
    getOperatorVersion,
    getOperatorStatus,
    listDatabases,
    getDatabase,
  };
}
