/**
 * Node Provisioning Service
 *
 * Handles the automated provisioning of worker nodes:
 * 1. Test SSH connection
 * 2. Install k3s agent
 * 3. Wait for node to join cluster
 * 4. Sync node status
 */

import { useNodeRepo } from "./node.repository";
import { useClusterRepo } from "../cluster/cluster.repository";
import { useSecretRepo } from "../secret/secret.repository";
import { useSSHService } from "../../services/ssh.service";
import { useKubernetesService } from "../../services/kubernetes.service";
import { TNode, TProvisioningStep } from "./node.model";
import { BadRequestError, NotFoundError, InternalServerError } from "../../utils/error";
import { logger } from "../../utils";

// Provisioning steps
const PROVISIONING_STEPS = [
  { name: "ssh_connect", label: "Connect via SSH" },
  { name: "system_check", label: "Check system requirements" },
  { name: "install_k3s", label: "Install k3s agent" },
  { name: "wait_join", label: "Wait for cluster join" },
  { name: "verify_ready", label: "Verify node ready" },
];

export function useNodeProvisioningService() {
  const nodeRepo = useNodeRepo();
  const clusterRepo = useClusterRepo();
  const secretRepo = useSecretRepo();
  const sshService = useSSHService();
  const k8sService = useKubernetesService();

  /**
   * Test SSH connection to a host before provisioning
   */
  async function testConnection(params: {
    host: string;
    sshPort?: number;
    sshUser?: string;
    sshKeyId: string;
  }): Promise<{ success: boolean; error?: string; serverInfo?: { os: string; hostname: string } }> {
    const { host, sshPort = 22, sshUser = "root", sshKeyId } = params;

    // Get SSH private key from secrets
    const secret = await secretRepo.getById(sshKeyId);
    if (!secret || secret.type !== "ssh-private-key") {
      return { success: false, error: "SSH key not found or invalid type" };
    }

    const privateKey = secret.value;

    try {
      const result = await sshService.testConnection({
        host,
        port: sshPort,
        username: sshUser,
        privateKey,
      });

      if (!result.success) {
        return { success: false, error: result.error };
      }

      // Get basic server info
      await sshService.connect({ host, port: sshPort, username: sshUser, privateKey });
      
      const hostnameResult = await sshService.executeCommand("hostname");
      const osResult = await sshService.executeCommand("cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d '\"'");
      
      await sshService.disconnect();

      return {
        success: true,
        serverInfo: {
          hostname: hostnameResult.stdout.trim(),
          os: osResult.stdout.trim() || "Unknown",
        },
      };
    } catch (error: any) {
      return { success: false, error: error.message || "SSH connection failed" };
    }
  }

  /**
   * Start provisioning a node
   * This runs asynchronously and updates the node record as it progresses
   */
  async function startProvisioning(nodeId: string): Promise<void> {
    const node = await nodeRepo.getById(nodeId);
    
    if (!node.sshKeyId) {
      throw new BadRequestError("Node has no SSH key configured");
    }
    if (!node.host) {
      throw new BadRequestError("Node has no host configured");
    }

    // Get cluster for join token and API server URL
    const cluster = await clusterRepo.getById(node.clusterId.toString());
    
    // Get join token - either from cluster or read from k3s
    let joinToken = cluster.joinToken;
    let apiServerUrl = cluster.apiServerUrl;

    if (!joinToken) {
      throw new BadRequestError(
        "Cluster join token not configured. Please set the join token in cluster settings."
      );
    }
    if (!apiServerUrl) {
      throw new BadRequestError(
        "Cluster API server URL not configured. Please set it in cluster settings."
      );
    }

    // Get SSH private key
    const secret = await secretRepo.getById(node.sshKeyId);
    if (!secret || secret.type !== "ssh-private-key") {
      throw new BadRequestError("SSH key not found or invalid type");
    }

    const privateKey = secret.value;

    // Initialize provisioning log
    const log: TProvisioningStep[] = PROVISIONING_STEPS.map((step) => ({
      ...step,
      status: "pending" as const,
    }));

    await nodeRepo.updateProvisioningStatus(nodeId, "running", log);
    await nodeRepo.updateStatus(nodeId, "provisioning", "Starting provisioning...");

    // Run provisioning in background (don't await)
    runProvisioning(nodeId, node, privateKey, joinToken, apiServerUrl, log).catch((error) => {
      logger.log({
        level: "error",
        message: `Provisioning failed for node ${node.name}: ${error.message}`,
      });
    });
  }

  /**
   * Internal function that runs the actual provisioning
   */
  async function runProvisioning(
    nodeId: string,
    node: TNode,
    privateKey: string,
    joinToken: string,
    apiServerUrl: string,
    log: TProvisioningStep[]
  ): Promise<void> {
    const updateStep = async (
      stepName: string,
      status: "running" | "success" | "failed",
      output?: string,
      error?: string
    ) => {
      const step = log.find((s) => s.name === stepName);
      if (step) {
        step.status = status;
        if (status === "running") step.startedAt = new Date();
        if (status === "success" || status === "failed") step.completedAt = new Date();
        if (output) step.output = output;
        if (error) step.error = error;
      }
      await nodeRepo.updateProvisioningStatus(nodeId, "running", log);
    };

    try {
      // Step 1: SSH Connect
      await updateStep("ssh_connect", "running");
      await sshService.connect({
        host: node.host,
        port: node.sshPort || 22,
        username: node.sshUser || "root",
        privateKey,
      });
      await updateStep("ssh_connect", "success", "Connected successfully");

      // Step 2: System Check
      await updateStep("system_check", "running");
      const osCheck = await sshService.executeCommand("cat /etc/os-release | grep -E '^(ID|VERSION_ID)=' || echo 'unknown'");
      const memCheck = await sshService.executeCommand("free -m | awk '/Mem:/ {print $2}'");
      const cpuCheck = await sshService.executeCommand("nproc");
      
      const memMb = parseInt(memCheck.stdout.trim()) || 0;
      const cpuCount = parseInt(cpuCheck.stdout.trim()) || 0;

      if (memMb < 1024) {
        throw new Error(`Insufficient memory: ${memMb}MB (minimum 1024MB required)`);
      }
      if (cpuCount < 1) {
        throw new Error("Could not detect CPU count");
      }

      await updateStep(
        "system_check",
        "success",
        `OS: ${osCheck.stdout.trim()}\nMemory: ${memMb}MB\nCPUs: ${cpuCount}`
      );

      // Step 3: Install k3s agent
      await updateStep("install_k3s", "running");
      
      // Build the k3s install command
      const installCmd = `curl -sfL https://get.k3s.io | K3S_URL="${apiServerUrl}" K3S_TOKEN="${joinToken}" sh -s - agent`;
      
      // Save the join command for reference
      await nodeRepo.updateJoinToken(nodeId, joinToken, installCmd);
      
      // Run the install
      const installResult = await sshService.executeCommand(installCmd, {
        timeout: 300000, // 5 minutes
        stream: true,
      });

      if (installResult.code !== 0) {
        throw new Error(`k3s install failed: ${installResult.stderr}`);
      }

      await updateStep("install_k3s", "success", "k3s agent installed");

      // Disconnect SSH - we're done with it
      await sshService.disconnect();

      // Step 4: Wait for node to join
      await updateStep("wait_join", "running");
      await nodeRepo.updateStatus(nodeId, "joining", "Waiting for node to join cluster...");

      // Poll for node to appear in K8s
      k8sService.init();
      let joined = false;
      let k8sNodeName = "";
      const maxWait = 120000; // 2 minutes
      const startTime = Date.now();

      while (!joined && Date.now() - startTime < maxWait) {
        await sleep(5000); // Check every 5 seconds

        const nodes = await k8sService.listNodes();
        
        // Look for a node with matching IP or hostname
        for (const k8sNode of nodes) {
          const addresses = k8sNode.status?.addresses || [];
          const nodeIP = addresses.find((a) => a.type === "InternalIP")?.address;
          const nodeHostname = addresses.find((a) => a.type === "Hostname")?.address;

          if (nodeIP === node.host || nodeHostname === node.name) {
            joined = true;
            k8sNodeName = k8sNode.metadata?.name || "";
            break;
          }
        }
      }

      if (!joined) {
        throw new Error("Timeout waiting for node to join cluster");
      }

      await updateStep("wait_join", "success", `Node joined as ${k8sNodeName}`);

      // Step 5: Verify Ready
      await updateStep("verify_ready", "running");

      // Wait for node to become Ready
      let ready = false;
      const readyStartTime = Date.now();
      const readyMaxWait = 60000; // 1 minute

      while (!ready && Date.now() - readyStartTime < readyMaxWait) {
        await sleep(5000);

        const k8sNode = await k8sService.getNode(k8sNodeName);
        if (k8sNode) {
          const readyCondition = k8sNode.status?.conditions?.find((c) => c.type === "Ready");
          if (readyCondition?.status === "True") {
            ready = true;
          }
        }
      }

      if (!ready) {
        // Not ready yet, but joined - that's okay, sync will pick it up
        await updateStep("verify_ready", "success", "Node joined but not yet Ready - will sync shortly");
      } else {
        await updateStep("verify_ready", "success", "Node is Ready");
      }

      // Update node record with k8s info
      await nodeRepo.updateById(nodeId, {
        k8sName: k8sNodeName,
        status: ready ? "ready" : "not-ready",
        statusMessage: ready ? "Node is ready" : "Node joined, waiting for Ready status",
        joinedAt: new Date(),
      });

      await nodeRepo.updateProvisioningStatus(nodeId, "success", log);

      logger.log({
        level: "info",
        message: `Node ${node.name} provisioned successfully as ${k8sNodeName}`,
      });
    } catch (error: any) {
      // Find the current running step and mark it as failed
      const runningStep = log.find((s) => s.status === "running");
      if (runningStep) {
        runningStep.status = "failed";
        runningStep.error = error.message;
        runningStep.completedAt = new Date();
      }

      await nodeRepo.updateProvisioningStatus(nodeId, "failed", log);
      await nodeRepo.updateStatus(nodeId, "failed", error.message);

      // Clean up SSH connection
      try {
        await sshService.disconnect();
      } catch {
        // Ignore disconnect errors
      }

      logger.log({
        level: "error",
        message: `Node ${node.name} provisioning failed: ${error.message}`,
      });
    }
  }

  /**
   * Get provisioning status for a node
   */
  async function getProvisioningStatus(nodeId: string): Promise<{
    status: string;
    log: TProvisioningStep[];
    startedAt?: Date;
    completedAt?: Date;
  }> {
    const node = await nodeRepo.getById(nodeId);
    return {
      status: node.provisioningStatus || "idle",
      log: node.provisioningLog || [],
      startedAt: node.provisioningStartedAt,
      completedAt: node.provisioningCompletedAt,
    };
  }

  return {
    testConnection,
    startProvisioning,
    getProvisioningStatus,
  };
}

// Helper
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
