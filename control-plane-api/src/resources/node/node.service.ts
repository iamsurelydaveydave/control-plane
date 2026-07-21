import { useNodeRepo } from "./node.repository";
import { useClusterRepo } from "../cluster/cluster.repository";
import { useKubernetesService } from "../../services/kubernetes.service";
import { TNode, TNodeInput, TNodeCondition, TNodeTaint, TNodeResources, modelNode } from "./node.model";
import { BadRequestError, NotFoundError, InternalServerError } from "../../utils/error";
import { logger } from "../../utils";
import { useWebhookService } from "../webhook/webhook.service";
import * as k8s from "@kubernetes/client-node";

export function useNodeService() {
  const repo = useNodeRepo();
  const clusterRepo = useClusterRepo();
  const k8sService = useKubernetesService();
  const webhookService = useWebhookService();

  /**
   * List all nodes for a cluster
   */
  async function listNodes(
    clusterId: string,
    options?: { page?: number; role?: string; status?: string }
  ): Promise<{ items: TNode[]; pages: number; total: number }> {
    return repo.getAllByCluster(clusterId, options);
  }

  /**
   * Get a single node by ID
   */
  async function getNode(id: string): Promise<TNode> {
    return repo.getById(id);
  }

  /**
   * Generate a join token for adding a new worker node.
   * Creates a pending node record and returns the join command.
   */
  async function generateJoinToken(
    clusterId: string,
    nodeName: string
  ): Promise<{ node: TNode; joinCommand: string }> {
    // Validate cluster exists
    const cluster = await clusterRepo.getById(clusterId);

    // Check if node name already exists in this cluster
    const existing = await repo.getByName(clusterId, nodeName);
    if (existing) {
      throw new BadRequestError(`Node with name '${nodeName}' already exists in this cluster.`);
    }

    // Get the join token from the cluster
    let joinToken = cluster.joinToken;
    if (!joinToken) {
      // Try to get it from k3s
      // In production, this would read from /var/lib/rancher/k3s/server/token
      // For now, we'll use a placeholder
      logger.log({
        level: "warn",
        message: "Join token not set on cluster. Using placeholder.",
      });
      joinToken = "K10placeholder-token-set-via-installer";
    }

    // Get the API server URL
    const apiServerUrl = cluster.apiServerUrl || "https://localhost:6443";

    // Build the join command
    const joinCommand = `curl -sfL https://get.k3s.io | K3S_URL="${apiServerUrl}" K3S_TOKEN="${joinToken}" sh -s - agent`;

    // Create the node record
    const nodeData = modelNode({
      clusterId,
      name: nodeName,
      role: "worker",
    });

    const nodeId = await repo.add(nodeData);
    await repo.updateJoinToken(nodeId, joinToken, joinCommand);

    const node = await repo.getById(nodeId);

    logger.log({
      level: "info",
      message: `Generated join token for node '${nodeName}' in cluster '${cluster.name}'`,
    });

    return { node, joinCommand };
  }

  /**
   * Sync all nodes from K8s API to database.
   * Discovers new nodes and updates existing ones.
   */
  async function syncAllNodes(clusterId: string): Promise<TNode[]> {
    const cluster = await clusterRepo.getById(clusterId);

    try {
      k8sService.init();

      // Get nodes from K8s
      const k8sNodes = await k8sService.listNodes();

      // Get existing nodes from DB
      const dbNodesResult = await repo.getAllByCluster(clusterId, { page: 1 });
      const dbNodes = dbNodesResult.items;
      const dbNodesByK8sName = new Map(
        dbNodes.filter((n) => n.k8sName).map((n) => [n.k8sName, n])
      );

      const syncedNodes: TNode[] = [];

      for (const k8sNode of k8sNodes) {
        const k8sName = k8sNode.metadata?.name || "";
        const existingNode = dbNodesByK8sName.get(k8sName);

        // Parse K8s node data
        const nodeData = parseK8sNode(k8sNode);

        if (existingNode) {
          // Check if node was previously offline and is now back online
          const wasOffline = existingNode.status === "offline" || existingNode.status === "not-ready";

          // Update existing node
          await repo.syncFromK8s(existingNode._id!.toString(), nodeData);
          const updatedNode = await repo.getById(existingNode._id!.toString());
          syncedNodes.push(updatedNode);
          dbNodesByK8sName.delete(k8sName);

          // Trigger webhook if node came back online
          if (wasOffline && updatedNode.status === "ready") {
            webhookService.trigger("node.online", {
              nodeId: existingNode._id?.toString(),
              nodeName: existingNode.name,
              nodeHost: existingNode.host,
              nodeRole: existingNode.role,
              onlineAt: new Date().toISOString(),
            });
          }
        } else {
          // New node discovered - create it
          const newNode = modelNode({
            clusterId,
            name: k8sName,
            role: isControlPlaneNode(k8sNode) ? "master" : "worker",
            host: getNodeIP(k8sNode),
          });

          const nodeId = await repo.add(newNode);
          await repo.syncFromK8s(nodeId, nodeData);
          syncedNodes.push(await repo.getById(nodeId));

          logger.log({
            level: "info",
            message: `Discovered new node: ${k8sName}`,
          });
        }
      }

      // Mark nodes that are in DB but not in K8s as offline
      for (const [k8sName, dbNode] of dbNodesByK8sName) {
        if (dbNode.status !== "pending" && dbNode.status !== "offline") {
          await repo.updateStatus(dbNode._id!.toString(), "offline", "Node not found in K8s cluster");

          // Trigger webhook notification for node going offline
          webhookService.trigger("node.offline", {
            nodeId: dbNode._id?.toString(),
            nodeName: dbNode.name,
            nodeHost: dbNode.host,
            nodeRole: dbNode.role,
            reason: "Node not found in K8s cluster",
            offlineAt: new Date().toISOString(),
          });

          logger.log({
            level: "warn",
            message: `Node '${dbNode.name}' not found in K8s - marked offline`,
          });
        }
      }

      // Update cluster node count
      const readyCount = syncedNodes.filter((n) => n.status === "ready").length;
      await clusterRepo.updateStatus(clusterId, "connected", {
        nodesCount: syncedNodes.length,
      });

      logger.log({
        level: "info",
        message: `Synced ${syncedNodes.length} nodes (${readyCount} ready) for cluster '${cluster.name}'`,
      });

      return syncedNodes;
    } catch (error) {
      logger.log({
        level: "error",
        message: `Failed to sync nodes for cluster '${cluster.name}': ${error}`,
      });
      throw error;
    }
  }

  /**
   * Sync a single node from K8s
   */
  async function syncNode(id: string): Promise<TNode> {
    const node = await repo.getById(id);

    if (!node.k8sName) {
      throw new BadRequestError("Node has no K8s name - cannot sync.");
    }

    try {
      k8sService.init();

      const k8sNode = await k8sService.getNode(node.k8sName);
      if (!k8sNode) {
        await repo.updateStatus(id, "offline", "Node not found in K8s cluster");
        return repo.getById(id);
      }

      const nodeData = parseK8sNode(k8sNode);
      await repo.syncFromK8s(id, nodeData);

      return repo.getById(id);
    } catch (error) {
      logger.log({
        level: "error",
        message: `Failed to sync node '${node.name}': ${error}`,
      });
      throw error;
    }
  }

  /**
   * Cordon a node (mark as unschedulable)
   */
  async function cordonNode(id: string): Promise<TNode> {
    const node = await repo.getById(id);

    if (!node.k8sName) {
      throw new BadRequestError("Node has no K8s name - cannot cordon.");
    }

    try {
      k8sService.init();
      await k8sService.cordonNode(node.k8sName);
      await repo.updateById(id, { unschedulable: true });

      logger.log({
        level: "info",
        message: `Cordoned node '${node.name}'`,
      });

      return repo.getById(id);
    } catch (error) {
      logger.log({
        level: "error",
        message: `Failed to cordon node '${node.name}': ${error}`,
      });
      throw error;
    }
  }

  /**
   * Uncordon a node (mark as schedulable)
   */
  async function uncordonNode(id: string): Promise<TNode> {
    const node = await repo.getById(id);

    if (!node.k8sName) {
      throw new BadRequestError("Node has no K8s name - cannot uncordon.");
    }

    try {
      k8sService.init();
      await k8sService.uncordonNode(node.k8sName);
      await repo.updateById(id, { unschedulable: false });

      logger.log({
        level: "info",
        message: `Uncordoned node '${node.name}'`,
      });

      return repo.getById(id);
    } catch (error) {
      logger.log({
        level: "error",
        message: `Failed to uncordon node '${node.name}': ${error}`,
      });
      throw error;
    }
  }

  /**
   * Drain a node (evict all pods)
   */
  async function drainNode(
    id: string,
    options?: {
      gracePeriodSeconds?: number;
      ignoreDaemonSets?: boolean;
      deleteEmptyDirData?: boolean;
    }
  ): Promise<TNode> {
    const node = await repo.getById(id);

    if (!node.k8sName) {
      throw new BadRequestError("Node has no K8s name - cannot drain.");
    }

    try {
      k8sService.init();

      // First cordon the node
      await k8sService.cordonNode(node.k8sName);
      await repo.updateStatus(id, "draining", "Draining node...");

      // Get all pods on this node
      const pods = await k8sService.listPods("", `spec.nodeName=${node.k8sName}`);

      // Filter out DaemonSet pods if ignoreDaemonSets is true (default)
      const ignoreDaemonSets = options?.ignoreDaemonSets ?? true;
      const podsToEvict = pods.filter((pod) => {
        if (ignoreDaemonSets) {
          const ownerRefs = pod.metadata?.ownerReferences || [];
          const isDaemonSet = ownerRefs.some((ref) => ref.kind === "DaemonSet");
          if (isDaemonSet) return false;
        }
        return true;
      });

      // Evict each pod
      for (const pod of podsToEvict) {
        const podName = pod.metadata?.name;
        const podNamespace = pod.metadata?.namespace || "default";

        if (podName) {
          try {
            await k8sService.deletePod(podNamespace, podName);
            logger.log({
              level: "debug",
              message: `Evicted pod ${podNamespace}/${podName} from node '${node.name}'`,
            });
          } catch (err) {
            logger.log({
              level: "warn",
              message: `Failed to evict pod ${podNamespace}/${podName}: ${err}`,
            });
          }
        }
      }

      await repo.updateById(id, { unschedulable: true });
      await repo.updateStatus(id, "ready", `Drained ${podsToEvict.length} pods`);

      logger.log({
        level: "info",
        message: `Drained node '${node.name}' (${podsToEvict.length} pods evicted)`,
      });

      return repo.getById(id);
    } catch (error) {
      logger.log({
        level: "error",
        message: `Failed to drain node '${node.name}': ${error}`,
      });
      await repo.updateStatus(id, "not-ready", `Drain failed: ${error}`);
      throw error;
    }
  }

  /**
   * Remove a node from the cluster
   */
  async function removeNode(id: string): Promise<void> {
    const node = await repo.getById(id);

    // Cannot remove master nodes
    if (node.role === "master") {
      throw new BadRequestError("Cannot remove master nodes via API. Remove manually if needed.");
    }

    await repo.updateStatus(id, "deleting", "Removing from cluster...");

    try {
      k8sService.init();

      if (node.k8sName) {
        // Drain first
        await drainNode(id);

        // Delete from K8s
        await k8sService.deleteNode(node.k8sName);
      }

      // Delete from DB
      await repo.deleteById(id);

      logger.log({
        level: "info",
        message: `Removed node '${node.name}' from cluster`,
      });
    } catch (error) {
      logger.log({
        level: "error",
        message: `Failed to remove node '${node.name}': ${error}`,
      });
      await repo.updateStatus(id, "not-ready", `Remove failed: ${error}`);
      throw error;
    }
  }

  /**
   * Add a label to a node
   */
  async function addLabel(id: string, key: string, value: string): Promise<TNode> {
    const node = await repo.getById(id);

    if (!node.k8sName) {
      throw new BadRequestError("Node has no K8s name - cannot add label.");
    }

    // TODO: Implement label addition via K8s API
    // For now, just update in DB
    const labels = { ...(node.labels || {}), [key]: value };
    await repo.updateById(id, { labels });

    logger.log({
      level: "info",
      message: `Added label ${key}=${value} to node '${node.name}'`,
    });

    return repo.getById(id);
  }

  /**
   * Remove a label from a node
   */
  async function removeLabel(id: string, key: string): Promise<TNode> {
    const node = await repo.getById(id);

    if (!node.k8sName) {
      throw new BadRequestError("Node has no K8s name - cannot remove label.");
    }

    // TODO: Implement label removal via K8s API
    const labels = { ...(node.labels || {}) };
    delete labels[key];
    await repo.updateById(id, { labels });

    logger.log({
      level: "info",
      message: `Removed label ${key} from node '${node.name}'`,
    });

    return repo.getById(id);
  }

  return {
    listNodes,
    getNode,
    generateJoinToken,
    syncAllNodes,
    syncNode,
    cordonNode,
    uncordonNode,
    drainNode,
    removeNode,
    addLabel,
    removeLabel,
  };
}

// =============================================================================
// Helper functions
// =============================================================================

/**
 * Parse K8s node object into our format
 */
function parseK8sNode(k8sNode: k8s.V1Node): {
  k8sName: string;
  k8sStatus: string;
  k8sVersion?: string;
  containerRuntime?: string;
  osImage?: string;
  architecture?: string;
  resources?: TNodeResources;
  conditions?: TNodeCondition[];
  labels?: Record<string, string>;
  taints?: TNodeTaint[];
  unschedulable?: boolean;
} {
  const status = k8sNode.status;
  const spec = k8sNode.spec;

  // Get Ready condition
  const readyCondition = status?.conditions?.find((c) => c.type === "Ready");
  const k8sStatus = readyCondition?.status || "Unknown";

  // Parse resources
  const resources: TNodeResources | undefined = status?.capacity && status?.allocatable
    ? {
        cpuCapacity: status.capacity.cpu || "0",
        cpuAllocatable: status.allocatable.cpu || "0",
        memoryCapacity: status.capacity.memory || "0",
        memoryAllocatable: status.allocatable.memory || "0",
        podsCapacity: status.capacity.pods || "0",
      }
    : undefined;

  // Parse conditions
  const conditions: TNodeCondition[] | undefined = status?.conditions?.map((c) => ({
    type: c.type || "",
    status: c.status || "",
    reason: c.reason,
    message: c.message,
    lastTransitionTime: c.lastTransitionTime ? new Date(c.lastTransitionTime) : undefined,
  }));

  // Parse taints
  const taints: TNodeTaint[] | undefined = spec?.taints?.map((t) => ({
    key: t.key || "",
    value: t.value,
    effect: t.effect || "",
  }));

  return {
    k8sName: k8sNode.metadata?.name || "",
    k8sStatus,
    k8sVersion: status?.nodeInfo?.kubeletVersion,
    containerRuntime: status?.nodeInfo?.containerRuntimeVersion,
    osImage: status?.nodeInfo?.osImage,
    architecture: status?.nodeInfo?.architecture,
    resources,
    conditions,
    labels: k8sNode.metadata?.labels,
    taints,
    unschedulable: spec?.unschedulable,
  };
}

/**
 * Check if a node is a control plane node
 */
function isControlPlaneNode(k8sNode: k8s.V1Node): boolean {
  const labels = k8sNode.metadata?.labels || {};
  return (
    labels["node-role.kubernetes.io/control-plane"] !== undefined ||
    labels["node-role.kubernetes.io/master"] !== undefined
  );
}

/**
 * Get the IP address of a node
 */
function getNodeIP(k8sNode: k8s.V1Node): string {
  const addresses = k8sNode.status?.addresses || [];
  
  // Prefer InternalIP, then ExternalIP, then Hostname
  const internalIP = addresses.find((a) => a.type === "InternalIP");
  if (internalIP?.address) return internalIP.address;

  const externalIP = addresses.find((a) => a.type === "ExternalIP");
  if (externalIP?.address) return externalIP.address;

  const hostname = addresses.find((a) => a.type === "Hostname");
  if (hostname?.address) return hostname.address;

  return "";
}
