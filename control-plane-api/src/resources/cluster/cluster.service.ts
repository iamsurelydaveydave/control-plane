import fs from "fs";
import { useClusterRepo } from "./cluster.repository";
import { useKubernetesService } from "../../services/kubernetes.service";
import { TCluster, modelCluster } from "./cluster.model";
import { BadRequestError, InternalServerError } from "../../utils/error";
import { logger } from "../../utils";

// k3s join token file path (only available on master node)
const K3S_TOKEN_PATH = "/var/lib/rancher/k3s/server/token";

export function useClusterService() {
  const repo = useClusterRepo();
  const k8s = useKubernetesService();

  /**
   * Read the k3s join token from the token file.
   * Returns null if the file doesn't exist (not running on master node).
   */
  function readJoinToken(): string | null {
    try {
      const token = fs.readFileSync(K3S_TOKEN_PATH, "utf-8").trim();
      logger.log({ level: "debug", message: "Successfully read k3s join token" });
      return token;
    } catch (error: any) {
      if (error.code === "ENOENT") {
        logger.log({
          level: "warn",
          message: `k3s token file not found at ${K3S_TOKEN_PATH} - not running on master node?`,
        });
      } else if (error.code === "EACCES") {
        logger.log({
          level: "warn",
          message: `Permission denied reading k3s token at ${K3S_TOKEN_PATH}`,
        });
      } else {
        logger.log({
          level: "error",
          message: `Failed to read k3s token: ${error.message}`,
        });
      }
      return null;
    }
  }

  /**
   * Get the API server URL from environment, kubeconfig, or cluster record.
   */
  function getApiServerUrl(existingUrl?: string): string | undefined {
    // First try environment variables
    const k3sUrl = process.env.K3S_URL;
    if (k3sUrl) {
      logger.log({ level: "debug", message: `Using K3S_URL from environment: ${k3sUrl}` });
      return k3sUrl;
    }

    const k8sHost = process.env.KUBERNETES_SERVICE_HOST;
    const k8sPort = process.env.KUBERNETES_SERVICE_PORT || "443";
    if (k8sHost) {
      const url = `https://${k8sHost}:${k8sPort}`;
      logger.log({ level: "debug", message: `Using KUBERNETES_SERVICE_HOST from environment: ${url}` });
      return url;
    }

    // Try to get from kubeconfig via the k8s service
    try {
      const kubeConfig = k8s.getKubeConfig();
      if (kubeConfig) {
        const currentCluster = kubeConfig.getCurrentCluster();
        if (currentCluster?.server) {
          logger.log({ level: "debug", message: `Using API server from kubeconfig: ${currentCluster.server}` });
          return currentCluster.server;
        }
      }
    } catch (error) {
      logger.log({ level: "debug", message: "Could not get API server URL from kubeconfig" });
    }

    // Fall back to existing URL
    if (existingUrl) {
      logger.log({ level: "debug", message: `Using existing API server URL: ${existingUrl}` });
      return existingUrl;
    }

    return undefined;
  }

  /**
   * Initialize the local cluster on first run.
   * Called during setup if no clusters exist.
   */
  async function initLocalCluster(): Promise<TCluster> {
    // Check if local cluster already exists
    const existing = await repo.getLocalCluster();
    if (existing) {
      // Update join token and API server URL if they weren't set before
      const joinToken = readJoinToken();
      const apiServerUrl = getApiServerUrl();
      const updates: Record<string, string> = {};

      if (joinToken && !existing.joinToken) {
        updates.joinToken = joinToken;
      }
      if (apiServerUrl && !existing.apiServerUrl) {
        updates.apiServerUrl = apiServerUrl;
      }

      if (Object.keys(updates).length > 0) {
        await repo.updateById(existing._id!.toString(), updates as Partial<TCluster>);
        logger.log({
          level: "info",
          message: `Updated local cluster with ${Object.keys(updates).join(", ")}`,
        });
      }

      // Always sync status on startup
      await syncClusterStatus(existing._id!.toString());

      return repo.getById(existing._id!.toString());
    }

    // Read join token and API server URL
    const joinToken = readJoinToken();
    const apiServerUrl = getApiServerUrl();

    // Create local cluster record
    const cluster = modelCluster({
      name: "local",
      type: "local",
    });

    // Add join token and API server URL if available
    if (joinToken) {
      (cluster as TCluster).joinToken = joinToken;
    }
    if (apiServerUrl) {
      (cluster as TCluster).apiServerUrl = apiServerUrl;
    }

    const id = await repo.add(cluster);
    logger.log({
      level: "info",
      message: `Initialized local cluster${joinToken ? " with join token" : ""}${apiServerUrl ? ` at ${apiServerUrl}` : ""}`,
    });

    // Sync status from K8s
    await syncClusterStatus(id);

    return repo.getById(id);
  }

  /**
   * Sync cluster status from K8s API
   */
  async function syncClusterStatus(id: string): Promise<void> {
    const cluster = await repo.getById(id);

    try {
      // Initialize K8s client
      k8s.init();

      // Check if cluster is reachable
      const available = await k8s.isAvailable();
      if (!available) {
        await repo.updateStatus(id, "unreachable");
        return;
      }

      // Get cluster info
      const info = await k8s.getClusterInfo();
      const nodes = await k8s.listNodes();

      await repo.updateStatus(id, "connected", {
        version: info.version,
        platform: info.platform,
        nodesCount: nodes.length,
      });

      logger.log({
        level: "info",
        message: `Cluster ${cluster.name} synced: ${info.version}, ${nodes.length} nodes`,
      });
    } catch (error) {
      logger.log({
        level: "error",
        message: `Failed to sync cluster ${cluster.name}: ${error}`,
      });
      await repo.updateStatus(id, "unreachable");
    }
  }

  /**
   * Get or create the local cluster
   */
  async function getOrCreateLocalCluster(): Promise<TCluster> {
    const existing = await repo.getLocalCluster();
    if (existing) return existing;
    return initLocalCluster();
  }

  /**
   * Add a remote cluster (future feature)
   */
  async function addRemoteCluster(
    name: string,
    kubeconfig: string,
    context?: string
  ): Promise<TCluster> {
    // Check if name is taken
    const existing = await repo.getByName(name);
    if (existing) {
      throw new BadRequestError(`Cluster with name '${name}' already exists.`);
    }

    const cluster = modelCluster({
      name,
      type: "remote",
      kubeconfig,
      context,
    });

    const id = await repo.add(cluster);

    // TODO: Validate connection to remote cluster
    // await syncClusterStatus(id);

    return repo.getById(id);
  }

  /**
   * Get all clusters
   */
  async function getAll(): Promise<TCluster[]> {
    return repo.getAll();
  }

  /**
   * Get cluster by ID
   */
  async function getById(id: string): Promise<TCluster> {
    return repo.getById(id);
  }

  /**
   * Delete a cluster
   * Note: Cannot delete the local cluster
   */
  async function deleteCluster(id: string): Promise<void> {
    const cluster = await repo.getById(id);

    if (cluster.type === "local") {
      throw new BadRequestError("Cannot delete the local cluster.");
    }

    await repo.deleteById(id);
  }

  /**
   * Refresh the join token for a cluster.
   * Only works for local clusters where the token file is accessible.
   */
  async function refreshJoinToken(clusterId: string): Promise<TCluster> {
    const cluster = await repo.getById(clusterId);

    if (cluster.type !== "local") {
      throw new BadRequestError("Join token can only be refreshed for local clusters.");
    }

    const joinToken = readJoinToken();
    if (!joinToken) {
      throw new BadRequestError(
        "Unable to read join token. Ensure this is running on the master node with access to the k3s token file."
      );
    }

    // Also refresh API server URL
    const apiServerUrl = getApiServerUrl(cluster.apiServerUrl);

    await repo.updateById(clusterId, {
      joinToken,
      ...(apiServerUrl && { apiServerUrl }),
    });

    logger.log({
      level: "info",
      message: `Refreshed join token for cluster ${cluster.name}`,
    });

    return repo.getById(clusterId);
  }

  return {
    initLocalCluster,
    syncClusterStatus,
    getOrCreateLocalCluster,
    addRemoteCluster,
    getAll,
    getById,
    deleteCluster,
    refreshJoinToken,
  };
}
